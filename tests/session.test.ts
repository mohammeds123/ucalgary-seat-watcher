import { describe, expect, it, vi } from "vitest";

import {
  DesyncError,
  PsSession,
  SessionExpiredError,
  type Transport,
} from "../src/peoplesoft/session.js";
import { buildSearchFields } from "../src/peoplesoft/search.js";

/** Minimal well-formed response carrying the next state number. */
const pageWithState = (n: number, icsid = "SID="): string =>
  `<PAGE><GENSCRIPT><![CDATA[oDoc.win0.ICStateNum.value=${n};]]></GENSCRIPT>` +
  `<FIELD><![CDATA[<input type='hidden' name='ICSID' id='ICSID' value='${icsid}' />]]></FIELD></PAGE>`;

function makeSession(transport: Transport, onExpired?: () => void) {
  const s = new PsSession({
    url: "https://example.invalid/psp",
    transport,
    ...(onExpired ? { onExpired } : {}),
  });
  s.sync(pageWithState(7));
  return s;
}

describe("PsSession state machine", () => {
  it("seeds ICSID and ICStateNum from a loaded page", () => {
    const s = makeSession(async () => ({ status: 200, text: pageWithState(8) }));
    expect(s.state).toEqual({ icsid: "SID=", stateNum: 7 });
  });

  it("sends the current state number and advances from the response", async () => {
    const sent: URLSearchParams[] = [];
    let next = 8;
    const s = makeSession(async (_url, body) => {
      sent.push(body);
      return { status: 200, text: pageWithState(next++) };
    });

    await s.post("ACTION_A");
    expect(sent[0]!.get("ICStateNum")).toBe("7");
    expect(s.state?.stateNum).toBe(8);

    await s.post("ACTION_B");
    expect(sent[1]!.get("ICStateNum")).toBe("8");
    expect(s.state?.stateNum).toBe(9);
  });

  it("serializes concurrent requests instead of interleaving them", async () => {
    // The state number makes parallel requests incorrect by construction: two
    // in flight would both send the same number and the second would be
    // rejected. Assert they queue.
    const order: string[] = [];
    let n = 8;
    const s = makeSession(async (_url, body) => {
      const action = body.get("ICAction")!;
      order.push(`start:${action}`);
      await new Promise((r) => setTimeout(r, action === "SLOW" ? 30 : 1));
      order.push(`end:${action}`);
      return { status: 200, text: pageWithState(n++) };
    });

    await Promise.all([s.post("SLOW"), s.post("FAST")]);

    expect(order).toEqual(["start:SLOW", "end:SLOW", "start:FAST", "end:FAST"]);
  });

  it("gives each queued request the state number left by the previous one", async () => {
    const seen: string[] = [];
    let n = 8;
    const s = makeSession(async (_url, body) => {
      seen.push(body.get("ICStateNum")!);
      return { status: 200, text: pageWithState(n++) };
    });

    await Promise.all([s.post("A"), s.post("B"), s.post("C")]);
    expect(seen).toEqual(["7", "8", "9"]);
  });

  it("keeps the queue usable after a failed request", async () => {
    let calls = 0;
    const s = makeSession(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network blip");
      return { status: 200, text: pageWithState(8) };
    });

    await expect(s.post("A")).rejects.toThrow("network blip");
    // A poisoned queue here would silently stop all polling forever.
    await expect(s.post("B")).resolves.toContain("ICStateNum");
  });

  describe("session expiry", () => {
    it("raises SessionExpiredError on a sign-in page and clears state", async () => {
      const onExpired = vi.fn();
      const s = makeSession(
        async () => ({ status: 200, text: "You must have cookies enabled to sign in" }),
        onExpired,
      );

      await expect(s.post("A")).rejects.toBeInstanceOf(SessionExpiredError);
      expect(onExpired).toHaveBeenCalledOnce();
      expect(s.state).toBeNull();
    });

    it("raises SessionExpiredError on 401/403", async () => {
      const s = makeSession(async () => ({ status: 403, text: "denied" }));
      await expect(s.post("A")).rejects.toBeInstanceOf(SessionExpiredError);
    });

    it("refuses to post once state is cleared, rather than sending a bad request", async () => {
      const s = makeSession(async () => ({ status: 401, text: "" }));
      await expect(s.post("A")).rejects.toBeInstanceOf(SessionExpiredError);
      await expect(s.post("B")).rejects.toBeInstanceOf(DesyncError);
    });
  });

  describe("desync", () => {
    it("clears state when the next state number cannot be read", async () => {
      const s = makeSession(async () => ({ status: 200, text: "<PAGE>garbage</PAGE>" }));

      await expect(s.post("A")).rejects.toBeInstanceOf(DesyncError);
      // Forcing an explicit re-sync is deliberate: retrying a desynced session
      // is what turns one bad response into a retry storm.
      expect(s.state).toBeNull();
    });

    it("recovers after an explicit re-sync", async () => {
      let text = "<PAGE>garbage</PAGE>";
      const s = makeSession(async () => ({ status: 200, text }));

      await expect(s.post("A")).rejects.toBeInstanceOf(DesyncError);

      s.sync(pageWithState(20));
      text = pageWithState(21);
      await expect(s.post("B")).resolves.toContain("ICStateNum");
      expect(s.state?.stateNum).toBe(21);
    });

    it("treats a non-200 as a desync without clobbering the transport", async () => {
      const s = makeSession(async () => ({ status: 500, text: "oops" }));
      await expect(s.post("A")).rejects.toThrow(/HTTP 500/);
    });
  });
});

describe("buildSearchFields", () => {
  it("omits the catalog number so one request covers a whole subject", () => {
    const f = buildSearchFields({ termCode: "2267", subject: "CPSC" });
    expect(f["SSR_CLSRCH_WRK_SUBJECT_SRCH$0"]).toBe("CPSC");
    expect(f).not.toHaveProperty("SSR_CLSRCH_WRK_CATALOG_NBR$1");
  });

  it("includes the catalog number and match mode when narrowing", () => {
    const f = buildSearchFields({ termCode: "2267", subject: "GRST", catalogNbr: "211" });
    expect(f["SSR_CLSRCH_WRK_CATALOG_NBR$1"]).toBe("211");
    expect(f["SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1"]).toBe("C");
  });

  it("maps openOnly to the Y/N checkbox the server expects", () => {
    expect(
      buildSearchFields({ termCode: "2267", subject: "CPSC", openOnly: true })[
        "SSR_CLSRCH_WRK_SSR_OPEN_ONLY$chk$3"
      ],
    ).toBe("Y");
    expect(
      buildSearchFields({ termCode: "2267", subject: "CPSC" })[
        "SSR_CLSRCH_WRK_SSR_OPEN_ONLY$chk$3"
      ],
    ).toBe("N");
  });
});
