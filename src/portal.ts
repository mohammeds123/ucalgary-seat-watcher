/**
 * Wiring the protocol layer to the browser.
 *
 * Requests go out with `credentials: "include"` from the extension's own
 * context, so they carry the session the user established by signing in
 * normally — including the Cloudflare clearance cookie. We never see or store a
 * password; if the session is gone, the parser says so and the UI asks the user
 * to sign in again.
 */

import { PsSession, SessionExpiredError, type Transport } from "./peoplesoft/session.js";
import { searchClasses } from "./peoplesoft/search.js";
import type { ClassRow } from "./peoplesoft/parse.js";
import type { SearchFn } from "./watcher.js";

export const PORTAL_URL =
  "https://portal.my.ucalgary.ca/psp/paprd/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL";

const transport: Transport = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return { status: res.status, text: await res.text() };
};

/**
 * Load the search entry page to seed ICSID and ICStateNum.
 *
 * This is also the re-sync path: whenever the state machine desynchronizes, the
 * fix is to start over from a freshly loaded page rather than retry.
 */
async function fetchEntryPage(): Promise<string> {
  const res = await fetch(`${PORTAL_URL}?Page=SSR_CLSRCH_ENTRY&Action=U`, {
    credentials: "include",
  });
  if (res.status === 401 || res.status === 403) throw new SessionExpiredError();
  return res.text();
}

/**
 * A `SearchFn` that re-syncs once on a desync and then gives up for this pass.
 *
 * Deliberately at most one retry: a loop of retries against a registration
 * system is how an account gets flagged. If the second attempt fails, the error
 * propagates and the next scheduled poll tries again from scratch.
 */
export function createPortalSearch(): SearchFn {
  const session = new PsSession({ url: PORTAL_URL, transport });
  let synced = false;

  return async ({ termCode, subject }): Promise<ClassRow[]> => {
    if (!synced) {
      session.sync(await fetchEntryPage());
      synced = true;
    }

    try {
      return await searchClasses(session, { termCode, subject });
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        synced = false;
        throw error;
      }
      // One re-sync, one retry, then let it fail.
      session.sync(await fetchEntryPage());
      return await searchClasses(session, { termCode, subject });
    }
  };
}
