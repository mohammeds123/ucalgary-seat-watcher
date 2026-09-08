import { describe, expect, it } from "vitest";

import { chooseTier, intervalSeconds, isPurgeDay } from "../src/domain/schedule.js";

const FALL_2026 = "2267"; // purge day 2026-09-08

/** A UTC instant that lands on the given Edmonton wall-clock hour. */
const edmonton = (date: string, hour: number) =>
  new Date(`${date}T${String(hour + 6).padStart(2, "0")}:30:00Z`);

const base = {
  termCodes: [FALL_2026],
  baselineSeconds: 60,
  anyClosed: true,
};

describe("isPurgeDay", () => {
  it("recognizes the term's purge day in Edmonton local time", () => {
    expect(isPurgeDay(edmonton("2026-09-08", 12), [FALL_2026])).toBe(true);
    expect(isPurgeDay(edmonton("2026-09-07", 12), [FALL_2026])).toBe(false);
    expect(isPurgeDay(edmonton("2026-09-09", 12), [FALL_2026])).toBe(false);
  });

  it("is false for terms with no purge day on file", () => {
    expect(isPurgeDay(edmonton("2026-09-08", 12), ["9999"])).toBe(false);
  });
});

describe("chooseTier", () => {
  it("uses the fastest tier on the purge day", () => {
    // The single highest-value window of the term: every waitlist empties at
    // once and the seats go first-come-first-served.
    expect(chooseTier({ ...base, now: edmonton("2026-09-08", 12) })).toBe("purge-day");
  });

  it("stays fast on the purge day even overnight", () => {
    expect(chooseTier({ ...base, now: edmonton("2026-09-08", 3) })).toBe("purge-day");
  });

  it("goes idle when every watched class is already open", () => {
    expect(
      chooseTier({ ...base, anyClosed: false, now: edmonton("2026-10-01", 12) }),
    ).toBe("idle");
  });

  it("goes idle overnight", () => {
    expect(chooseTier({ ...base, now: edmonton("2026-10-01", 3) })).toBe("idle");
  });

  it("speeds up around the hour boundary, when the waitlist batch runs", () => {
    const at = (min: number) => new Date(`2026-10-01T18:${String(min).padStart(2, "0")}:00Z`);
    expect(chooseTier({ ...base, now: at(2) })).toBe("fast");
    expect(chooseTier({ ...base, now: at(57) })).toBe("fast");
    expect(chooseTier({ ...base, now: at(30) })).toBe("baseline");
  });
});

describe("intervalSeconds", () => {
  it("respects the user's baseline as a floor for ordinary hours", () => {
    const now = new Date("2026-10-01T18:30:00Z"); // baseline tier
    expect(intervalSeconds({ ...base, now, baselineSeconds: 120 })).toBe(120);
    // A baseline shorter than ours does not speed up the ordinary tier.
    expect(intervalSeconds({ ...base, now, baselineSeconds: 15 })).toBe(60);
  });

  it("ignores the user's baseline on the purge day", () => {
    const now = edmonton("2026-09-08", 12);
    expect(intervalSeconds({ ...base, now, baselineSeconds: 600 })).toBe(10);
  });
});
