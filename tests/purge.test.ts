import { describe, expect, it } from "vitest";

import { canEnrol } from "../src/domain/purge.js";

const FALL_2026 = "2267";

/** Noon Mountain Time on the given calendar day. */
const at = (iso: string): Date => new Date(`${iso}T18:00:00Z`);

describe("canEnrol — the waitlist purge gate", () => {
  it("blocks a waitlisted course before its purge day", () => {
    const d = canEnrol({
      termCode: FALL_2026,
      waitlist: "has-waitlist",
      now: at("2026-09-01"),
    });
    expect(d.allowed).toBe(false);
    expect(d).toMatchObject({ reason: "before-purge" });
  });

  it("still blocks ON the purge day itself", () => {
    // Fall 2026's purge day is 2026-09-08. The Registrar says seats are
    // first-come-first-served "after this date", so the whole day still
    // belongs to the queue. Conservative is the correct direction here.
    const d = canEnrol({
      termCode: FALL_2026,
      waitlist: "has-waitlist",
      now: at("2026-09-08"),
    });
    expect(d.allowed).toBe(false);
    expect(d).toMatchObject({ reason: "before-purge" });
  });

  it("allows the day after the purge day", () => {
    const d = canEnrol({
      termCode: FALL_2026,
      waitlist: "has-waitlist",
      now: at("2026-09-09"),
    });
    expect(d).toEqual({ allowed: true, reason: "past-purge" });
  });

  it("allows a course with no waitlist at any time", () => {
    const d = canEnrol({
      termCode: FALL_2026,
      waitlist: "no-waitlist",
      now: at("2026-08-01"),
    });
    expect(d).toEqual({ allowed: true, reason: "no-waitlist" });
  });

  describe("fails closed", () => {
    it("blocks when the waitlist state is unknown", () => {
      const d = canEnrol({
        termCode: FALL_2026,
        waitlist: "unknown",
        now: at("2027-01-01"), // long past the purge day
      });
      expect(d.allowed).toBe(false);
      expect(d).toMatchObject({ reason: "unknown-waitlist-state" });
    });

    it("blocks on a term whose code has not been verified against a real response", () => {
      // "2271" (Winter 2027) is predicted by the term-code formula but has not
      // been observed. Acting on an unverified code risks watching, and
      // enrolling in, the wrong semester.
      const d = canEnrol({
        termCode: "2271",
        waitlist: "has-waitlist",
        now: at("2027-06-01"),
      });
      expect(d.allowed).toBe(false);
      expect(d).toMatchObject({ reason: "unverified-term" });
    });

    it("blocks on a term with no purge date on file", () => {
      const d = canEnrol({
        termCode: "9999",
        waitlist: "has-waitlist",
        now: at("2030-01-01"),
      });
      expect(d.allowed).toBe(false);
    });
  });

  it("gives every blocked decision a human-readable explanation", () => {
    // The popup shows this. A silent no-op looks like a broken extension.
    const blocked = [
      canEnrol({ termCode: FALL_2026, waitlist: "has-waitlist", now: at("2026-09-01") }),
      canEnrol({ termCode: FALL_2026, waitlist: "unknown", now: at("2027-01-01") }),
      canEnrol({ termCode: "9999", waitlist: "has-waitlist", now: at("2030-01-01") }),
    ];
    for (const d of blocked) {
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.explanation.length).toBeGreaterThan(20);
    }
  });

  it("is a pure function of its inputs, so it can be re-evaluated at alert time", () => {
    const input = {
      termCode: FALL_2026,
      waitlist: "has-waitlist",
      now: at("2026-09-01"),
    } as const;
    expect(canEnrol(input)).toEqual(canEnrol(input));

    // Same course, later clock -> different answer. This is why the gate is
    // evaluated when the alert fires rather than cached when the user configures
    // the watch.
    expect(canEnrol({ ...input, now: at("2026-09-20") }).allowed).toBe(true);
  });
});
