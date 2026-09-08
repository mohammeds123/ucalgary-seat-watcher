import { describe, expect, it, vi } from "vitest";

import { Settings, type WatchedClass } from "../src/config.js";
import type { ClassRow } from "../src/peoplesoft/parse.js";
import { Watcher, isArmingExpired, type SearchFn } from "../src/watcher.js";

const FALL_2026 = "2267";
const BEFORE_PURGE = new Date("2026-09-01T18:00:00Z");
const AFTER_PURGE = new Date("2026-09-20T18:00:00Z");

const watch = (over: Partial<WatchedClass> = {}): WatchedClass => ({
  id: `${FALL_2026}:71003`,
  termCode: FALL_2026,
  subject: "GRST",
  catalogNbr: "211",
  classNbr: "71003",
  label: "GRST 211",
  armedForAutoEnrol: false,
  autoEnrolExpiresIso: null,
  ...over,
});

const settings = (over: Partial<Settings> = {}): Settings =>
  Settings.parse({ ...over });

const row = (classNbr: string, status: ClassRow["status"], rowIndex = 0): ClassRow => ({
  classNbr,
  rowIndex,
  section: "01-LEC",
  status,
});

/** Search stub that returns a scripted sequence of results, one per poll. */
function scripted(sequence: ClassRow[][]): SearchFn {
  let i = 0;
  return async () => sequence[Math.min(i++, sequence.length - 1)] ?? [];
}

describe("Watcher.poll", () => {
  it("emits no action on the first poll, whatever the status", async () => {
    const w = new Watcher(scripted([[row("71003", "open")]]));
    const r = await w.poll([watch()], settings(), AFTER_PURGE);
    expect(r.actions).toEqual([]);
  });

  it("emits an action on closed -> open", async () => {
    const w = new Watcher(scripted([[row("71003", "closed")], [row("71003", "open")]]));
    await w.poll([watch()], settings(), AFTER_PURGE);
    const r = await w.poll([watch()], settings(), AFTER_PURGE);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]!.watch.classNbr).toBe("71003");
  });

  it("issues one search per subject, not per watched class", async () => {
    const search = vi.fn<SearchFn>(async () => []);
    const w = new Watcher(search);
    await w.poll(
      [
        watch({ id: "a", classNbr: "1", subject: "CPSC" }),
        watch({ id: "b", classNbr: "2", subject: "CPSC" }),
        watch({ id: "c", classNbr: "3", subject: "CPSC" }),
        watch({ id: "d", classNbr: "4", subject: "MATH" }),
      ],
      settings(),
      AFTER_PURGE,
    );
    // Four classes, two subjects, two requests. This is the whole efficiency
    // argument for dropping the catalog number from the search.
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("ignores sections returned by the subject search that are not watched", async () => {
    const w = new Watcher(
      scripted([
        [row("71003", "closed"), row("99999", "closed", 1)],
        [row("71003", "closed"), row("99999", "open", 1)],
      ]),
    );
    await w.poll([watch()], settings(), AFTER_PURGE);
    const r = await w.poll([watch()], settings(), AFTER_PURGE);
    expect(r.actions).toEqual([]);
    expect(r.statuses.has("99999")).toBe(false);
  });

  it("keeps polling other subjects when one search fails", async () => {
    const search: SearchFn = async ({ subject }) => {
      if (subject === "CPSC") throw new Error("boom");
      return [row("2", "open")];
    };
    const w = new Watcher(search);
    const r = await w.poll(
      [watch({ id: "a", classNbr: "1", subject: "CPSC" }), watch({ id: "b", classNbr: "2", subject: "MATH" })],
      settings(),
      AFTER_PURGE,
    );
    expect(r.errors).toHaveLength(1);
    expect(r.statuses.get("2")).toBe("open");
  });
});

describe("Watcher action mode — the purge gate decides, not the setting", () => {
  /** Drive a class from `from` to open and return the single resulting action. */
  async function openingFrom(
    from: "closed" | "waitlist",
    s: Settings,
    now: Date,
    w = watch(),
  ) {
    const watcher = new Watcher(scripted([[row("71003", from)], [row("71003", "open")]]));
    await watcher.poll([w], s, now);
    const r = await watcher.poll([w], s, now);
    return r.actions[0]!;
  }

  it("downgrades assist to notify for a waitlisted course before the purge day", async () => {
    const a = await openingFrom("waitlist", settings({ mode: "assist" }), BEFORE_PURGE);
    expect(a.kind).toBe("notify");
    expect(a.gate.allowed).toBe(false);
  });

  it("downgrades auto to notify for a waitlisted course before the purge day", async () => {
    const a = await openingFrom(
      "waitlist",
      settings({ mode: "auto" }),
      BEFORE_PURGE,
      watch({ armedForAutoEnrol: true }),
    );
    expect(a.kind).toBe("notify");
  });

  it("allows assist after the purge day", async () => {
    const a = await openingFrom("waitlist", settings({ mode: "assist" }), AFTER_PURGE);
    expect(a.kind).toBe("assist");
    expect(a.gate.allowed).toBe(true);
  });

  it("allows auto after the purge day only when the class is armed", async () => {
    const armed = await openingFrom(
      "waitlist",
      settings({ mode: "auto" }),
      AFTER_PURGE,
      watch({ armedForAutoEnrol: true }),
    );
    expect(armed.kind).toBe("auto");

    // Mode is "auto" but this class was never armed: falls back to assist, not auto.
    const unarmed = await openingFrom("waitlist", settings({ mode: "auto" }), AFTER_PURGE);
    expect(unarmed.kind).toBe("assist");
  });

  it("the kill switch halts auto without stopping the alert", async () => {
    const a = await openingFrom(
      "waitlist",
      settings({ mode: "auto", killSwitch: true }),
      AFTER_PURGE,
      watch({ armedForAutoEnrol: true }),
    );
    expect(a.kind).toBe("assist");
  });

  it("expired arming falls back to assist", async () => {
    const a = await openingFrom(
      "waitlist",
      settings({ mode: "auto" }),
      AFTER_PURGE,
      watch({ armedForAutoEnrol: true, autoEnrolExpiresIso: "2026-09-10T00:00:00Z" }),
    );
    expect(a.kind).toBe("assist");
  });

  it("notify mode never escalates, even when the gate would allow it", async () => {
    const a = await openingFrom(
      "waitlist",
      settings({ mode: "notify" }),
      AFTER_PURGE,
      watch({ armedForAutoEnrol: true }),
    );
    expect(a.kind).toBe("notify");
  });

  it("treats a course never seen on a waitlist as unknown, and fails closed", async () => {
    // closed -> open tells us nothing about whether a waitlist exists. Assuming
    // "no waitlist" here would let assist/auto fire on a pre-purge course whose
    // waitlist we simply never observed.
    const a = await openingFrom("closed", settings({ mode: "auto" }), AFTER_PURGE,
      watch({ armedForAutoEnrol: true }));
    expect(a.kind).toBe("notify");
    expect(a.gate).toMatchObject({ allowed: false, reason: "unknown-waitlist-state" });
  });
});

describe("isArmingExpired", () => {
  const now = new Date("2026-09-20T00:00:00Z");

  it("is false when no expiry is set", () => {
    expect(isArmingExpired(watch(), now)).toBe(false);
  });

  it("is false before the expiry", () => {
    expect(
      isArmingExpired(watch({ autoEnrolExpiresIso: "2026-10-01T00:00:00Z" }), now),
    ).toBe(false);
  });

  it("is true at and after the expiry", () => {
    expect(
      isArmingExpired(watch({ autoEnrolExpiresIso: "2026-09-20T00:00:00Z" }), now),
    ).toBe(true);
  });

  it("fails closed on an unparseable expiry", () => {
    expect(isArmingExpired(watch({ autoEnrolExpiresIso: "not a date" }), now)).toBe(true);
  });
});
