/**
 * Persisted configuration and its schema.
 *
 * Everything the user can change lives here. Validated with Zod on read, so a
 * partially-written or hand-edited storage blob surfaces as a clear error
 * instead of an undefined field halfway through a poll.
 */

import { z } from "zod";

/**
 * What the extension does when a watched class opens.
 *
 * `assist` and `auto` are both subject to the waitlist purge gate — see
 * `domain/purge.ts`. Neither engages while a course's waitlist is still active.
 */
export const ActionMode = z.enum(["notify", "assist", "auto"]);
export type ActionMode = z.infer<typeof ActionMode>;

export const WatchedClass = z.object({
  /** `${termCode}:${classNbr}` — stable across renames. */
  id: z.string(),
  termCode: z.string(),
  subject: z.string(),
  catalogNbr: z.string(),
  classNbr: z.string(),
  /** Display label, e.g. "GRST 211 01-LEC". */
  label: z.string(),
  /**
   * Auto-enrol is armed per class, never globally. Setting the mode to "auto"
   * does nothing until a specific class is armed, so enabling it in September
   * cannot surprise you in January.
   */
  armedForAutoEnrol: z.boolean().default(false),
  /** Arming expires. Default is the term's add/drop deadline. */
  autoEnrolExpiresIso: z.string().nullable().default(null),
});
export type WatchedClass = z.infer<typeof WatchedClass>;

export const Settings = z.object({
  mode: ActionMode.default("assist"),
  /**
   * ntfy.sh topic for phone alerts. Anyone who knows the topic can read it, so
   * use a long random one; the UI generates one rather than letting the user
   * pick something guessable.
   */
  ntfyTopic: z.string().nullable().default(null),
  /** Baseline poll interval. Adaptive tiers scale from this. */
  pollSeconds: z.number().int().min(10).max(3600).default(60),
  /** Halts all automated enrolment submits immediately. Watching continues. */
  killSwitch: z.boolean().default(false),
  soundEnabled: z.boolean().default(true),
});
export type Settings = z.infer<typeof Settings>;

export const StoredState = z.object({
  settings: Settings.default({}),
  watches: z.array(WatchedClass).default([]),
});
export type StoredState = z.infer<typeof StoredState>;

export const DEFAULT_STATE: StoredState = StoredState.parse({});

/** Group watches by the search that covers them. */
export function groupBySearch(
  watches: readonly WatchedClass[],
): Map<string, { termCode: string; subject: string; watches: WatchedClass[] }> {
  const groups = new Map<
    string,
    { termCode: string; subject: string; watches: WatchedClass[] }
  >();
  for (const w of watches) {
    const key = `${w.termCode}:${w.subject}`;
    const existing = groups.get(key);
    if (existing) {
      existing.watches.push(w);
    } else {
      groups.set(key, { termCode: w.termCode, subject: w.subject, watches: [w] });
    }
  }
  return groups;
}
