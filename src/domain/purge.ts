/**
 * The waitlist purge gate.
 *
 * UCalgary's rule (https://www.ucalgary.ca/registrar/registration/wait-list):
 *
 *   "Each semester, all students are removed from course waitlists on the
 *    designated waitlist purge day. After this date, any available seats are
 *    offered on a first-come, first-served basis."
 *
 * Before that day, a seat vacated in a waitlisted course belongs to the queue.
 * This tool does not take those seats. That is the top invariant of the project:
 * every enrolling code path is gated on `canEnrol`, and the gate FAILS CLOSED —
 * an unknown term, an unknown purge date, or an unknown waitlist state all
 * produce "no".
 *
 * Watching and notifying are never gated. Only enrolling.
 */

import { isVerifiedTermCode } from "./terms.js";

/**
 * Published purge days, keyed by STRM term code.
 *
 * Source: the Wait List page above. Refresh once a year — the Registrar
 * publishes these per term. Dates are stored as ISO calendar dates in
 * America/Edmonton, the university's local time.
 */
export const PURGE_DAYS: Readonly<Record<string, string>> = Object.freeze({
  "2265": "2026-07-02", // Summer 2026
  "2267": "2026-09-08", // Fall 2026
  "2271": "2027-01-18", // Winter 2027
});

export type WaitlistState = "has-waitlist" | "no-waitlist" | "unknown";

export interface EnrolGateInput {
  /** STRM code, e.g. "2267". */
  readonly termCode: string;
  /** Whether the course carries a waitlist. "unknown" fails closed. */
  readonly waitlist: WaitlistState;
  /** Evaluated at alert time, never cached from configuration. */
  readonly now: Date;
}

export type EnrolDecision =
  | { readonly allowed: true; readonly reason: "past-purge" | "no-waitlist" }
  | {
      readonly allowed: false;
      readonly reason:
        | "before-purge"
        | "unknown-purge-date"
        | "unverified-term"
        | "unknown-waitlist-state";
      /** Human-readable, shown in the popup so the user knows why nothing happened. */
      readonly explanation: string;
    };

/**
 * The purge day itself is inclusive: the Registrar says students are removed
 * *on* the purge day and seats are first-come-first-served "after this date".
 * We treat the whole purge day as still belonging to the waitlist, and open the
 * gate at the start of the following day. That is the conservative reading, and
 * conservative is the right direction for this particular gate.
 */
function gateOpensAt(purgeDay: string): Date {
  const [y, m, d] = purgeDay.split("-").map(Number) as [number, number, number];
  // America/Edmonton is UTC-6 (MDT) in September and January is UTC-7 (MST).
  // Using UTC midnight + 7h is the later of the two, so the gate never opens
  // early in either offset.
  return new Date(Date.UTC(y, m - 1, d + 1, 7, 0, 0));
}

export function canEnrol(input: EnrolGateInput): EnrolDecision {
  const { termCode, waitlist, now } = input;

  if (waitlist === "unknown") {
    return {
      allowed: false,
      reason: "unknown-waitlist-state",
      explanation:
        "Could not determine whether this course has a waitlist, so enrolling is disabled.",
    };
  }

  // A course with no waitlist has no queue to jump. An open seat is simply open.
  if (waitlist === "no-waitlist") {
    return { allowed: true, reason: "no-waitlist" };
  }

  if (!isVerifiedTermCode(termCode)) {
    return {
      allowed: false,
      reason: "unverified-term",
      explanation:
        `Term code ${termCode} has not been confirmed against a real response, ` +
        `so its purge date cannot be trusted. Enrolling is disabled for this term.`,
    };
  }

  const purgeDay = PURGE_DAYS[termCode];
  if (purgeDay === undefined) {
    return {
      allowed: false,
      reason: "unknown-purge-date",
      explanation:
        `No published waitlist purge day is on file for term ${termCode}. ` +
        `Enrolling is disabled until the purge date table is updated.`,
    };
  }

  if (now.getTime() < gateOpensAt(purgeDay).getTime()) {
    return {
      allowed: false,
      reason: "before-purge",
      explanation:
        `This course has a waitlist and its purge day (${purgeDay}) has not passed. ` +
        `Seats freed now belong to the waitlist queue.`,
    };
  }

  return { allowed: true, reason: "past-purge" };
}
