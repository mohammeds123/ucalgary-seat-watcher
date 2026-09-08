/**
 * PeopleSoft term codes (the `STRM` field in a Class Search request).
 *
 * Observed: Fall 2026 = "2267". That fits the standard PeopleSoft shape of
 * `2` + the last two digits of the year + a season digit.
 *
 * This is a HYPOTHESIS derived from a single observation (see the plan's
 * "Phase 0 findings"). It predicts Winter 2027 = "2271". Until a second term is
 * confirmed, `isVerifiedTermCode` gates anything that would act on a computed
 * code, so a wrong guess surfaces as "unknown term" rather than as silently
 * watching the wrong semester.
 */

export const SEASONS = ["winter", "spring", "summer", "fall"] as const;
export type Season = (typeof SEASONS)[number];

/** Season digit used in the STRM code. */
const SEASON_DIGIT: Record<Season, string> = {
  winter: "1",
  spring: "3",
  summer: "5",
  fall: "7",
};

const DIGIT_SEASON: Record<string, Season> = {
  "1": "winter",
  "3": "spring",
  "5": "summer",
  "7": "fall",
};

export interface Term {
  readonly season: Season;
  readonly year: number;
}

/**
 * Term codes we have actually seen in a real response. Anything else is a
 * prediction from the formula and is treated as unverified.
 */
const VERIFIED_TERM_CODES = new Set<string>([
  "2267", // Fall 2026 — captured 2026-09-08 from a live Class Search request.
]);

export function isVerifiedTermCode(code: string): boolean {
  return VERIFIED_TERM_CODES.has(code);
}

/** Build the STRM code for a term. Throws on years the format cannot express. */
export function toTermCode({ season, year }: Term): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2099) {
    throw new RangeError(
      `Term year ${year} is outside the range this code format can express (2000-2099).`,
    );
  }
  const yy = String(year % 100).padStart(2, "0");
  return `2${yy}${SEASON_DIGIT[season]}`;
}

/** Parse a STRM code back into a term, or null if it is not a shape we recognize. */
export function fromTermCode(code: string): Term | null {
  if (!/^2\d{2}[1357]$/.test(code)) return null;
  const yy = Number(code.slice(1, 3));
  const season = DIGIT_SEASON[code[3]!];
  if (season === undefined) return null;
  return { season, year: 2000 + yy };
}

export function formatTerm({ season, year }: Term): string {
  return `${season[0]!.toUpperCase()}${season.slice(1)} ${year}`;
}
