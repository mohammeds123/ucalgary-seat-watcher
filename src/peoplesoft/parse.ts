/**
 * Parsers for the Class Search response.
 *
 * The response is XML with HTML embedded in CDATA sections. We do not have a DOM
 * in the service worker context and the markup is PeopleSoft-generated soup, so
 * these are deliberately narrow regex extractors over known element ids rather
 * than a general HTML parse.
 *
 * The important property: every extractor either finds what it expects or
 * throws. A silent `undefined` here becomes a missed seat or, worse, a course
 * wrongly reported as closed forever.
 */

export type ClassStatus = "open" | "closed" | "waitlist";

/**
 * Status is encoded as an icon filename, not text. Observed 2026-09-08:
 *   PS_CS_STATUS_OPEN_ICN_1.gif      -> Open
 *   PS_CS_STATUS_CLOSED_ICN_1.gif    -> Closed
 *   PS_CS_STATUS_WAITLIST_ICN_1.JPG  -> Wait List
 *
 * Matched case-insensitively on the distinctive middle token, so a cache-buster
 * change (cache86208/...) or an extension change (.gif -> .JPG, which already
 * differs between these three) does not break the parse.
 */
const STATUS_ICON = /PS_CS_STATUS_(OPEN|CLOSED|WAITLIST)_ICN/i;

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export interface ClassRow {
  /** PeopleSoft class number, e.g. "71003". Stable id for a section in a term. */
  readonly classNbr: string;
  /** Row index within the results grid, needed to build the drill-down ICAction. */
  readonly rowIndex: number;
  /** e.g. "01-LEC". */
  readonly section: string;
  readonly status: ClassStatus;
}

/** Strip CDATA wrappers so the embedded HTML can be scanned directly. */
function unwrapCdata(xml: string): string {
  return xml.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
}

/**
 * The next ICStateNum the server expects, read from the response's onload
 * script: `oDoc.win0.ICStateNum.value=8;`
 *
 * Without this the next request desynchronizes the session.
 */
export function parseNextStateNum(xml: string): number {
  const m = /ICStateNum\.value\s*=\s*(\d+)/.exec(xml);
  if (!m) {
    throw new ParseError(
      "No ICStateNum found in response. The session is desynchronized or the " +
        "response is not a PeopleSoft page delta.",
    );
  }
  return Number(m[1]);
}

/** The session CSRF token, from the hidden field block. */
export function parseIcsid(xml: string): string {
  const m = /name='ICSID'\s+id='ICSID'\s+value='([^']*)'/.exec(xml);
  if (!m || !m[1]) {
    throw new ParseError("No ICSID found in response.");
  }
  return m[1];
}

/** True when PeopleSoft has bounced us to sign-in rather than serving the page. */
export function isSignedOut(xml: string): boolean {
  return (
    /<title>\s*Oracle PeopleSoft Sign-in/i.test(xml) ||
    /signon\.html/i.test(xml) ||
    /You must have cookies enabled/i.test(xml)
  );
}

function statusFromIconMarkup(markup: string, classNbr: string): ClassStatus {
  const m = STATUS_ICON.exec(markup);
  if (!m) {
    // Deliberately an error, not a default. An unrecognized icon means the
    // markup changed; reporting "closed" would silently disable the watcher.
    throw new ParseError(
      `Unrecognized status icon for class ${classNbr}. The status markup changed ` +
        `and the parser needs updating.`,
    );
  }
  const token = m[1]!.toUpperCase();
  if (token === "OPEN") return "open";
  if (token === "CLOSED") return "closed";
  return "waitlist";
}

/**
 * Extract every section in a Class Search result page.
 *
 * Rows are keyed by the `$n` suffix PeopleSoft appends to field ids. A search
 * without a catalog number returns every section of the subject, so one call to
 * this covers a whole subject's worth of watched courses.
 */
export function parseSearchResults(xml: string): ClassRow[] {
  const html = unwrapCdata(xml);

  if (isSignedOut(html)) {
    throw new ParseError("Response is a sign-in page; the session has expired.");
  }

  // Anchor on the class-number links, which carry both the row index and the id.
  const linkRe =
    /id='MTG_CLASS_NBR\$(\d+)'[^>]*>([^<]+)<\/a>/g;

  const rows: ClassRow[] = [];
  for (const m of html.matchAll(linkRe)) {
    const rowIndex = Number(m[1]);
    const classNbr = m[2]!.trim();

    const statusDiv = extractDivById(
      html,
      `win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${rowIndex}`,
    );
    if (statusDiv === null) {
      throw new ParseError(
        `Class ${classNbr} (row ${rowIndex}) has no status cell. The results ` +
          `grid layout changed.`,
      );
    }

    rows.push({
      classNbr,
      rowIndex,
      section: extractSection(html, rowIndex) ?? "",
      status: statusFromIconMarkup(statusDiv, classNbr),
    });
  }

  if (rows.length === 0 && !/class section\(s\) found/i.test(html)) {
    throw new ParseError(
      "No class rows and no result count found. The response is not a search " +
        "results page.",
    );
  }

  return rows;
}

/**
 * Pull the markup of a field div by its exact id.
 *
 * PeopleSoft nests divs and does not close them predictably, so rather than
 * balancing tags we cut at the start of the NEXT field div. Every cell in the
 * results grid is wrapped in its own `id='win0div...'`, so that boundary is
 * reliable and — critically — it stops the window before it reaches the next
 * row.
 *
 * An earlier version took a fixed 2000-character window. That silently bled
 * into the following row, so a closed class whose neighbour was open parsed as
 * OPEN. In this app that is a false alert and, in auto-enrol mode, a wrong
 * enrolment. Never widen this window without a test covering adjacent rows of
 * differing status.
 */
function extractDivById(html: string, id: string): string | null {
  const marker = `id='${id}'`;
  const at = html.indexOf(marker);
  if (at === -1) return null;

  const rest = html.slice(at + marker.length);
  const nextField = rest.indexOf("id='win0div");
  return rest.slice(0, nextField === -1 ? undefined : nextField);
}

function extractSection(html: string, rowIndex: number): string | null {
  const div = extractDivById(html, `win0divMTG_CLASSNAME$${rowIndex}`);
  if (div === null) return null;
  const m = /class='PSHYPERLINK'\s*>([^<]+)/.exec(div);
  return m?.[1]?.trim() ?? null;
}

/** Number of sections the page claims to have found, for a sanity cross-check. */
export function parseResultCount(xml: string): number | null {
  const m = /(\d+)\s+class section\(s\) found/i.exec(xml);
  return m ? Number(m[1]) : null;
}
