/**
 * The poll orchestrator.
 *
 * One pass = search once per (term, subject) group, diff the statuses, and turn
 * genuine openings into actions. Kept free of chrome APIs so the whole decision
 * path is testable; the background script supplies the effects.
 */

import { canEnrol, type EnrolDecision } from "./domain/purge.js";
import { TransitionDetector, type OpeningEvent } from "./domain/transitions.js";
import type { ClassRow, ClassStatus } from "./peoplesoft/parse.js";
import { groupBySearch, type ActionMode, type Settings, type WatchedClass } from "./config.js";

export interface SearchFn {
  (query: { termCode: string; subject: string }): Promise<ClassRow[]>;
}

/** What the background script should actually do about one opening. */
export interface Action {
  readonly watch: WatchedClass;
  readonly event: OpeningEvent;
  /**
   * `notify` always happens. `assist` and `auto` are only ever chosen when the
   * purge gate allows enrolling AND the user asked for them.
   */
  readonly kind: ActionMode;
  /** Why enrolling was or wasn't permitted. Shown in the UI. */
  readonly gate: EnrolDecision;
}

export interface PollResult {
  readonly actions: Action[];
  readonly statuses: ReadonlyMap<string, ClassStatus>;
  /** Groups whose search failed, so the UI can show a degraded state. */
  readonly errors: { group: string; error: unknown }[];
}

export class Watcher {
  readonly #detector = new TransitionDetector();

  constructor(private readonly search: SearchFn) {}

  get statuses(): ReadonlyMap<string, ClassStatus> {
    return this.#detector.current;
  }

  forget(classNbr: string): void {
    this.#detector.forget(classNbr);
  }

  /**
   * Run one polling pass.
   *
   * `now` is injected rather than read from the clock so the purge gate is
   * evaluated against a single consistent instant, and so tests can pin it.
   */
  async poll(
    watches: readonly WatchedClass[],
    settings: Settings,
    now: Date,
  ): Promise<PollResult> {
    const groups = groupBySearch(watches);
    const errors: { group: string; error: unknown }[] = [];
    const byClassNbr = new Map<string, WatchedClass>();
    for (const w of watches) byClassNbr.set(w.classNbr, w);

    const rows: ClassRow[] = [];
    for (const [key, group] of groups) {
      try {
        // One request per subject covers every class watched in it.
        const found = await this.search({
          termCode: group.termCode,
          subject: group.subject,
        });
        // Keep only sections we actually watch; a subject search returns many.
        rows.push(...found.filter((r) => byClassNbr.has(r.classNbr)));
      } catch (error) {
        errors.push({ group: key, error });
      }
    }

    const openings = this.#detector.observe(rows);
    const actions: Action[] = [];

    for (const event of openings) {
      const watch = byClassNbr.get(event.classNbr);
      if (watch === undefined) continue;

      const { kind, gate } = this.#decide(watch, settings, event, now);
      actions.push({ watch, event, kind, gate });
    }

    return { actions, statuses: this.#detector.current, errors };
  }

  /**
   * Choose the strongest action that is BOTH requested by the user and allowed
   * by the gate. Every path degrades to `notify` rather than doing nothing, so
   * a blocked enrolment still reaches the user.
   */
  #decide(
    watch: WatchedClass,
    settings: Settings,
    event: OpeningEvent,
    now: Date,
  ): { kind: ActionMode; gate: EnrolDecision } {
    // The status we just saw tells us whether this course carries a waitlist.
    // "open" alone doesn't prove there is no waitlist — a course we have only
    // ever seen open could still have one — so anything other than a confirmed
    // waitlist sighting is treated as unknown, and unknown fails closed.
    const gate = canEnrol({
      termCode: watch.termCode,
      waitlist: event.from === "waitlist" ? "has-waitlist" : "unknown",
      now,
    });

    if (settings.mode === "notify") return { kind: "notify", gate };
    if (!gate.allowed) return { kind: "notify", gate };

    if (settings.mode === "auto") {
      const armed =
        watch.armedForAutoEnrol &&
        !settings.killSwitch &&
        !isArmingExpired(watch, now);
      return { kind: armed ? "auto" : "assist", gate };
    }

    return { kind: "assist", gate };
  }
}

export function isArmingExpired(watch: WatchedClass, now: Date): boolean {
  if (watch.autoEnrolExpiresIso === null) return false;
  const expiry = Date.parse(watch.autoEnrolExpiresIso);
  if (Number.isNaN(expiry)) return true; // unparseable expiry fails closed
  return now.getTime() >= expiry;
}
