/**
 * The PeopleSoft request state machine.
 *
 * Every request carries an `ICStateNum` that the server increments; a stale
 * value is rejected and desynchronizes the session. The next value arrives
 * inside each response's onload script.
 *
 * Two consequences drive this design:
 *
 *  1. Requests must be STRICTLY SEQUENTIAL. There is no correct way to have two
 *     in flight on one session, so everything funnels through one promise chain.
 *  2. A desync is recoverable but not by retrying — the caller must re-sync from
 *     the search entry page. We surface that as a distinct error type rather
 *     than retrying blindly, because a retry storm against a registration
 *     system is exactly what gets an account locked.
 */

import { ParseError, isSignedOut, parseIcsid, parseNextStateNum } from "./parse.js";

export class SessionExpiredError extends Error {
  constructor() {
    super("PeopleSoft session has expired; the user must sign in again.");
    this.name = "SessionExpiredError";
  }
}

export class DesyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesyncError";
  }
}

/** Injected so the same logic runs in a service worker, a test, or a script. */
export type Transport = (
  url: string,
  body: URLSearchParams,
) => Promise<{ status: number; text: string }>;

export interface SessionState {
  readonly icsid: string;
  readonly stateNum: number;
}

export interface PsSessionOptions {
  readonly url: string;
  readonly transport: Transport;
  /** Called when the session dies, so the UI can prompt for re-auth. */
  readonly onExpired?: () => void;
}

/**
 * Fields PeopleSoft expects on every post. Values that never vary are baked in;
 * anything meaningful is passed per request.
 */
function baseFields(state: SessionState, icAction: string): URLSearchParams {
  return new URLSearchParams({
    ICAJAX: "1",
    ICNAVTYPEDROPDOWN: "0",
    ICType: "Panel",
    ICElementNum: "0",
    ICStateNum: String(state.stateNum),
    ICAction: icAction,
    ICModelCancel: "0",
    ICXPos: "0",
    ICYPos: "0",
    ResponsetoDiffFrame: "-1",
    TargetFrameName: "None",
    FacetPath: "None",
    ICFocus: "",
    ICSaveWarningFilter: "0",
    ICChanged: "-1",
    ICSkipPending: "0",
    ICAutoSave: "0",
    ICResubmit: "0",
    ICSID: state.icsid,
    ICActionPrompt: "false",
  });
}

export class PsSession {
  #state: SessionState | null = null;
  /** The serialization point. Every request appends to this chain. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: PsSessionOptions) {}

  get state(): SessionState | null {
    return this.#state;
  }

  /**
   * Seed state from a page the browser already loaded (the search entry page).
   * Also the recovery path after a desync.
   */
  sync(html: string): void {
    if (isSignedOut(html)) {
      this.#state = null;
      this.opts.onExpired?.();
      throw new SessionExpiredError();
    }
    this.#state = {
      icsid: parseIcsid(html),
      stateNum: parseNextStateNum(html),
    };
  }

  /**
   * Post one action. Serialized against every other call on this session.
   *
   * `extraFields` carries the component-specific inputs (subject, term, and so
   * on). Returns the raw response text; parsing is the caller's job.
   */
  post(icAction: string, extraFields: Record<string, string> = {}): Promise<string> {
    const run = async (): Promise<string> => {
      const state = this.#state;
      if (state === null) {
        throw new DesyncError("Session has no state; call sync() with a loaded page first.");
      }

      const body = baseFields(state, icAction);
      for (const [k, v] of Object.entries(extraFields)) body.set(k, v);

      const res = await this.opts.transport(this.opts.url, body);

      if (res.status === 401 || res.status === 403 || isSignedOut(res.text)) {
        this.#state = null;
        this.opts.onExpired?.();
        throw new SessionExpiredError();
      }
      if (res.status !== 200) {
        throw new DesyncError(`PeopleSoft returned HTTP ${res.status}.`);
      }

      // Advance the state machine from the server's own answer.
      try {
        this.#state = { icsid: state.icsid, stateNum: parseNextStateNum(res.text) };
      } catch (err) {
        this.#state = null; // force an explicit re-sync rather than a retry
        throw new DesyncError(
          `Could not read the next ICStateNum: ${
            err instanceof ParseError ? err.message : String(err)
          } Session must be re-synced.`,
        );
      }

      return res.text;
    };

    // Chain onto the queue, and keep the queue alive after a rejection so one
    // failed request does not poison every later one.
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }
}
