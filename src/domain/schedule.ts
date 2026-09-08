/**
 * Adaptive polling cadence.
 *
 * A flat fast rate is both wasteful and conspicuous. The cadence is driven by
 * when seats actually move:
 *
 *  - The **purge day** is the single highest-value window of the term. Every
 *    waitlist in the university empties at once and the freed seats go
 *    first-come-first-served. Three times a year, and worth the fastest tier.
 *  - PeopleSoft runs the waitlist batch **hourly**, so drops cluster around the
 *    hour boundary.
 *  - Overnight, almost nothing happens.
 *
 * Note the ceiling: UCalgary's own Schedule Builder refreshes seat data every
 * 30s, so if that ever becomes the data source, polling faster buys nothing.
 * Against Class Search we don't know the freshness, hence FAST_SECONDS is a
 * deliberate 10s rather than 1s.
 */

import { PURGE_DAYS } from "./purge.js";

export type Tier = "purge-day" | "fast" | "baseline" | "idle";

export const TIER_SECONDS: Readonly<Record<Tier, number>> = Object.freeze({
  "purge-day": 10,
  fast: 20,
  baseline: 60,
  idle: 300,
});

export interface CadenceInput {
  readonly now: Date;
  /** Terms currently being watched, as STRM codes. */
  readonly termCodes: readonly string[];
  /** User's configured baseline, which caps how slow the baseline tier gets. */
  readonly baselineSeconds: number;
  /** True when at least one watched class is not currently enrollable. */
  readonly anyClosed: boolean;
}

/** Local hour in America/Edmonton, which is what the university runs on. */
function edmontonHour(now: Date): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Edmonton",
    hour: "numeric",
    hour12: false,
  }).format(now);
  return Number(s) % 24;
}

function edmontonDate(now: Date): string {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isPurgeDay(now: Date, termCodes: readonly string[]): boolean {
  const today = edmontonDate(now);
  return termCodes.some((code) => PURGE_DAYS[code] === today);
}

/** Minutes either side of the hour when the waitlist batch runs. */
const HOUR_BOUNDARY_WINDOW_MIN = 5;

function nearHourBoundary(now: Date): boolean {
  const m = now.getMinutes();
  return m >= 60 - HOUR_BOUNDARY_WINDOW_MIN || m <= HOUR_BOUNDARY_WINDOW_MIN;
}

export function chooseTier(input: CadenceInput): Tier {
  const { now, termCodes, anyClosed } = input;

  if (isPurgeDay(now, termCodes)) return "purge-day";

  // Nothing to wait for: every watched class is already enrollable.
  if (!anyClosed) return "idle";

  const hour = edmontonHour(now);
  const overnight = hour >= 1 && hour < 6;
  if (overnight) return "idle";

  if (nearHourBoundary(now)) return "fast";

  return "baseline";
}

export function intervalSeconds(input: CadenceInput): number {
  const tier = chooseTier(input);
  if (tier === "baseline") {
    // The user's setting governs the baseline; the other tiers are ours.
    return Math.max(TIER_SECONDS.baseline, input.baselineSeconds);
  }
  return TIER_SECONDS[tier];
}
