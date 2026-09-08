/**
 * Turning a stream of status snapshots into alerts.
 *
 * The signal the sniper cares about is one edge: a watched class becoming
 * enrollable when it previously was not. Everything else is noise.
 *
 * Two properties matter more than they look:
 *
 *  - ONE alert per opening. A class that stays open across twenty polls must
 *    alert once, not twenty times. Without this the phone relay is unusable and
 *    an auto-enrol mode would fire repeatedly at the same seat.
 *  - No alert on FIRST sight. If a class is already open the first time we look,
 *    that is not an opening — it is the starting state. Alerting there means
 *    every newly-watched course fires immediately.
 */

import type { ClassStatus } from "../peoplesoft/parse.js";

export interface Snapshot {
  readonly classNbr: string;
  readonly status: ClassStatus;
}

export interface OpeningEvent {
  readonly classNbr: string;
  readonly from: ClassStatus;
  readonly to: ClassStatus;
}

/** Statuses a student can actually act on. */
function isEnrollable(status: ClassStatus): boolean {
  return status === "open";
}

/**
 * Tracks the last seen status per class and emits an event only on a genuine
 * not-enrollable -> enrollable edge.
 */
export class TransitionDetector {
  readonly #last = new Map<string, ClassStatus>();

  /** Statuses seen so far, for the popup's live view. */
  get current(): ReadonlyMap<string, ClassStatus> {
    return this.#last;
  }

  /**
   * Feed one poll's worth of snapshots. Returns the openings worth alerting on.
   *
   * Classes absent from `snapshots` are left untouched rather than forgotten —
   * a search that transiently omits a section (paging, a filtered query) must
   * not reset its history and cause a duplicate alert on the next poll.
   */
  observe(snapshots: readonly Snapshot[]): OpeningEvent[] {
    const events: OpeningEvent[] = [];

    for (const { classNbr, status } of snapshots) {
      const previous = this.#last.get(classNbr);
      this.#last.set(classNbr, status);

      // First sighting establishes a baseline; it is never an opening.
      if (previous === undefined) continue;

      if (!isEnrollable(previous) && isEnrollable(status)) {
        events.push({ classNbr, from: previous, to: status });
      }
    }

    return events;
  }

  /** Drop a class's history, e.g. when the user stops watching it. */
  forget(classNbr: string): void {
    this.#last.delete(classNbr);
  }

  reset(): void {
    this.#last.clear();
  }
}
