/**
 * Building Class Search requests.
 *
 * Field names captured 2026-09-08 from a live request. The `$n` suffixes are
 * PeopleSoft field instance ids and are part of the wire format, not decoration.
 */

import { parseSearchResults, type ClassRow } from "./parse.js";
import type { PsSession } from "./session.js";

export const SEARCH_ACTION = "CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH";
export const INSTITUTION = "UCALG";

export interface SearchQuery {
  /** STRM code, e.g. "2267" for Fall 2026. */
  readonly termCode: string;
  /** Subject code, e.g. "CPSC". */
  readonly subject: string;
  /**
   * Catalog number. OMIT THIS to return every section of the subject in one
   * request — that is the whole efficiency story of the fast polling tier.
   * Twelve watched CPSC courses cost one request, not twelve.
   */
  readonly catalogNbr?: string;
  /** Ask the server for open classes only, shrinking the response. */
  readonly openOnly?: boolean;
}

export function buildSearchFields(q: SearchQuery): Record<string, string> {
  const fields: Record<string, string> = {
    [`CLASS_SRCH_WRK2_INSTITUTION$31$`]: INSTITUTION,
    [`CLASS_SRCH_WRK2_STRM$35$`]: q.termCode,
    [`SSR_CLSRCH_WRK_SUBJECT_SRCH$0`]: q.subject,
    [`SSR_CLSRCH_WRK_ACAD_CAREER$2`]: "",
    [`SSR_CLSRCH_WRK_SSR_OPEN_ONLY$chk$3`]: q.openOnly ? "Y" : "N",
    [`SSR_CLSRCH_WRK_OEE_IND$chk$4`]: "N",
  };

  if (q.catalogNbr !== undefined && q.catalogNbr !== "") {
    fields[`SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1`] = "C"; // "contains"
    fields[`SSR_CLSRCH_WRK_CATALOG_NBR$1`] = q.catalogNbr;
  }

  return fields;
}

/** Run one search and return every section it found. */
export async function searchClasses(
  session: PsSession,
  q: SearchQuery,
): Promise<ClassRow[]> {
  const xml = await session.post(SEARCH_ACTION, buildSearchFields(q));
  return parseSearchResults(xml);
}

/** The drill-down that reaches a class's detail page, where the seat numbers live. */
export function detailAction(rowIndex: number): string {
  return `MTG_CLASS_NBR$${rowIndex}`;
}
