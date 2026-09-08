import { describe, expect, it } from "vitest";

// @ts-expect-error - plain .mjs script, no types needed for this smoke test
import { findLeaks, scrub } from "../scripts/scrub-capture.mjs";

/**
 * Shaped like a real DevTools capture, with fake values. Nothing here is a live
 * credential — these are the *patterns* the scrubber must catch.
 */
const CAPTURE = `POST /psp/paprd/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL HTTP/1.1
Host: portal.my.ucalgary.ca
Content-Type: application/x-www-form-urlencoded
Cookie: _ga=GA1.1.111; cf_clearance=abc123XYZ-1788842452-1.2.1.1-deadbeef; paprd-26000-PORTAL-PSJSESSIONID=4e85826161bf!-844547908; PS_TOKEN=pAAAAAQDAgEBAAAAvAIAAAAAAAAsAAAABABTaGRy; lcsrftoken=z5wHAmD9+t/W=; SignOnDefault=30242944
Referer: https://portal.my.ucalgary.ca/

ICSID=YMJHZJzwPs3x5KoXfnjy0l0zRlLLSeEk14vVWANUz3A%3D&ICStateNum=7

<input type='hidden' name='ICSID' id='ICSID' value='YMJHZJzwPs3x5KoXfnjy0l0zRlLLSeEk14vVWANUz3A=' />
<span id='DERIVED_SSTSNAV_PERSON_NAME'>Jane Testperson</span>`;

describe("scrub-capture", () => {
  const scrubbed: string = scrub(CAPTURE);

  it("removes the Cookie header wholesale", () => {
    expect(scrubbed).not.toMatch(/Cookie: _ga/);
    expect(scrubbed).toMatch(/Cookie: \[REDACTED\]/i);
  });

  it("removes every individual session token", () => {
    for (const secret of [
      "pAAAAAQDAgEBAAAAvAIAAAAAAAAsAAAABABTaGRy",
      "abc123XYZ-1788842452",
      "4e85826161bf",
      "30242944",
    ]) {
      expect(scrubbed).not.toContain(secret);
    }
  });

  it("redacts ICSID in both the hidden field and the form body", () => {
    expect(scrubbed).not.toContain("YMJHZJzwPs3x5KoXfnjy0l0zRlLLSeEk14vVWANUz3A");
    // The hidden-field form keeps the shape the parser tests expect.
    expect(scrubbed).toContain("value='REDACTED_SESSION_TOKEN='");
  });

  it("leaves the non-secret protocol fields intact", () => {
    // Scrubbing must not destroy the thing we captured it for.
    expect(scrubbed).toContain("ICStateNum=7");
    expect(scrubbed).toContain("SA_LEARNER_SERVICES.CLASS_SEARCH.GBL");
  });

  it("reports no leaks on scrubbed output", () => {
    expect(findLeaks(scrubbed)).toEqual([]);
  });

  it("catches a token the scrubber missed", () => {
    // The tripwire is the point: a pattern we forgot must fail loudly rather
    // than sail into git.
    expect(findLeaks("PS_TOKEN=stillHere")).toContain("PS_TOKEN");
    expect(findLeaks("Cookie: something=live")).toContain("a Cookie header");
  });

  it("catches a personal name when one is supplied", () => {
    expect(findLeaks(scrubbed, ["Testperson"])).toContain('the name "Testperson"');
  });
});
