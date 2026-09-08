import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ParseError,
  isSignedOut,
  parseIcsid,
  parseNextStateNum,
  parseResultCount,
  parseSearchResults,
} from "../src/peoplesoft/parse.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const grst211 = fixture("class-search-grst211.xml");
const multi = fixture("class-search-multi.xml");

describe("parseNextStateNum", () => {
  it("reads the next state number from the onload script", () => {
    expect(parseNextStateNum(grst211)).toBe(8);
    expect(parseNextStateNum(multi)).toBe(12);
  });

  it("throws rather than guessing when the state number is absent", () => {
    expect(() => parseNextStateNum("<PAGE>nothing useful</PAGE>")).toThrow(ParseError);
  });
});

describe("parseIcsid", () => {
  it("extracts the session CSRF token", () => {
    expect(parseIcsid(grst211)).toBe("REDACTED_SESSION_TOKEN=");
  });

  it("throws when absent", () => {
    expect(() => parseIcsid("<PAGE/>")).toThrow(ParseError);
  });
});

describe("parseSearchResults", () => {
  it("parses the real captured GRST 211 response", () => {
    const rows = parseSearchResults(grst211);
    expect(rows).toEqual([
      { classNbr: "71003", rowIndex: 0, section: "01-LEC", status: "closed" },
    ]);
  });

  it("cross-checks against the page's own result count", () => {
    expect(parseResultCount(grst211)).toBe(1);
    expect(parseSearchResults(grst211)).toHaveLength(1);

    expect(parseResultCount(multi)).toBe(3);
    expect(parseSearchResults(multi)).toHaveLength(3);
  });

  it("distinguishes all three statuses across rows", () => {
    const rows = parseSearchResults(multi);
    expect(rows.map((r) => [r.classNbr, r.status])).toEqual([
      ["71003", "closed"],
      ["71004", "open"],
      ["71005", "waitlist"],
    ]);
  });

  it("is not fooled by the status legend at the top of the page", () => {
    // Every page carries a legend showing all three icons. A parser that just
    // scanned for status icons in document order would read the legend's "Open"
    // as the first row's status and report a closed class as open — which in
    // this app means a false alert, or worse, an auto-enrol attempt.
    expect(grst211).toContain("PS_CS_STATUS_OPEN_ICN_1.gif"); // legend
    expect(parseSearchResults(grst211)[0]!.status).toBe("closed"); // actual row
  });

  it("does not read a neighbouring row's status icon", () => {
    // Regression: the status extractor once took a fixed-width window that ran
    // past the end of the row's own cell. Row 0 is CLOSED and row 1 is OPEN and
    // adjacent, so an over-wide window reports row 0 as open — a false alert,
    // and in auto-enrol mode a wrong enrolment.
    const rows = parseSearchResults(multi);
    expect(rows[0]).toMatchObject({ classNbr: "71003", status: "closed" });
    expect(rows[1]).toMatchObject({ classNbr: "71004", status: "open" });
  });

  it("keeps rows addressable by index for the detail drill-down", () => {
    // rowIndex is what builds ICAction=MTG_CLASS_NBR$n. If it drifts from the
    // response, the drill-down opens the wrong class.
    const rows = parseSearchResults(multi);
    expect(rows.map((r) => r.rowIndex)).toEqual([0, 1, 2]);
  });

  it("throws on an unrecognized status icon instead of defaulting to closed", () => {
    // Target the ROW's icon, not the legend's. The legend lists all three icons
    // at the top of every page, so a naive first-match replace mutates the
    // legend and leaves the row intact — which is itself the hazard the
    // legend-immunity test above covers.
    const mutated = multi.replace(
      /PS_CS_STATUS_CLOSED_ICN_1\.gif" alt="Closed"/,
      'PS_CS_STATUS_SOMETHING_NEW_1.gif" alt="Whatever"',
    );
    expect(mutated).not.toBe(multi);
    // Defaulting here would silently disable the watcher for that course.
    expect(() => parseSearchResults(mutated)).toThrow(/Unrecognized status icon/);
  });

  it("throws when a row has no status cell at all", () => {
    const mutated = multi.replace(
      /id='win0divDERIVED_CLSRCH_SSR_STATUS_LONG\$1'/,
      "id='win0divSOMETHING_ELSE$1'",
    );
    expect(() => parseSearchResults(mutated)).toThrow(/no status cell/);
  });

  it("throws when handed a sign-in page", () => {
    const signin =
      "<html><title>Oracle PeopleSoft Sign-in</title>You must have cookies enabled</html>";
    expect(isSignedOut(signin)).toBe(true);
    expect(() => parseSearchResults(signin)).toThrow(/session has expired/);
  });

  it("throws when the response is not a results page at all", () => {
    expect(() => parseSearchResults("<PAGE id='SOMETHING_ELSE'></PAGE>")).toThrow(
      /not a search results page/,
    );
  });

  it("accepts a genuine zero-result search", () => {
    const empty = multi
      .replace(/3 class section\(s\) found/, "0 class section(s) found")
      .replace(/<DIV id='win0divMTG_CLASS_NBR[\s\S]*?(?=\]\]>)/, "");
    expect(parseSearchResults(empty)).toEqual([]);
  });
});
