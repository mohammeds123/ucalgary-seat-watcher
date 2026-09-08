import { describe, expect, it } from "vitest";

import {
  formatTerm,
  fromTermCode,
  isVerifiedTermCode,
  toTermCode,
} from "../src/domain/terms.js";

describe("term codes", () => {
  it("matches the one code observed in a real response", () => {
    // The only ground truth we have: STRM=2267 was Fall 2026, captured
    // 2026-09-08. Everything else below is the formula's prediction.
    expect(toTermCode({ season: "fall", year: 2026 })).toBe("2267");
    expect(fromTermCode("2267")).toEqual({ season: "fall", year: 2026 });
  });

  it("round-trips every season", () => {
    for (const season of ["winter", "spring", "summer", "fall"] as const) {
      const code = toTermCode({ season, year: 2027 });
      expect(fromTermCode(code)).toEqual({ season, year: 2027 });
    }
  });

  it("predicts Winter 2027 as 2271", () => {
    expect(toTermCode({ season: "winter", year: 2027 })).toBe("2271");
  });

  it("treats only observed codes as verified", () => {
    expect(isVerifiedTermCode("2267")).toBe(true);
    // Predicted, not observed. The purge gate refuses to enrol on these until
    // someone confirms one against a real response.
    expect(isVerifiedTermCode("2271")).toBe(false);
  });

  it("rejects codes that do not fit the shape", () => {
    for (const bad of ["", "267", "22670", "2262", "abcd", "1267"]) {
      expect(fromTermCode(bad)).toBeNull();
    }
  });

  it("refuses years the format cannot express", () => {
    expect(() => toTermCode({ season: "fall", year: 1999 })).toThrow(RangeError);
    expect(() => toTermCode({ season: "fall", year: 2100 })).toThrow(RangeError);
  });

  it("formats terms for display", () => {
    expect(formatTerm({ season: "fall", year: 2026 })).toBe("Fall 2026");
  });
});
