#!/usr/bin/env node
/**
 * Strips live credentials out of a DevTools capture before it becomes a fixture.
 *
 *   node scripts/scrub-capture.mjs captures/class-detail.raw.xml tests/fixtures/class-detail.xml
 *   cat something.txt | node scripts/scrub-capture.mjs > tests/fixtures/out.xml
 *
 * A raw capture carries PS_TOKEN, PSJSESSIONID, cf_clearance and ICSID — live
 * credentials for a UCalgary account — plus the account holder's name. This
 * removes them and then REFUSES to write if anything credential-shaped survives,
 * so a missed pattern fails loudly instead of landing in git.
 *
 * It is a safety net, not permission to paste raw captures around. Prefer
 * DevTools -> right-click the request -> Copy as fetch, and delete the cookie
 * line at the source.
 */

import { readFileSync, writeFileSync } from "node:fs";

const REDACTIONS = [
  // Whole cookie headers, in every casing DevTools emits.
  [/^\s*(cookie|set-cookie):.*$/gim, "$1: [REDACTED]"],
  // Individual session tokens, wherever they appear.
  [/\bPS_TOKEN=[^;\s"'&]+/g, "PS_TOKEN=[REDACTED]"],
  [/\b[\w-]*PSJSESSIONID=[^;\s"'&]+/g, "PSJSESSIONID=[REDACTED]"],
  [/\bcf_clearance=[^;\s"'&]+/g, "cf_clearance=[REDACTED]"],
  [/\blcsrftoken=[^;\s"'&]+/g, "lcsrftoken=[REDACTED]"],
  [/\bSignOnDefault=[^;\s"'&]+/g, "SignOnDefault=[REDACTED]"],
  [/\bUC-PS-[\w-]*Session-Cookie=[^;\s"'&]+/g, "UC-PS-Session-Cookie=[REDACTED]"],
  [/\bPS_TokenSite=[^;\s"'&]+/g, "PS_TokenSite=[REDACTED]"],
  // The PeopleSoft CSRF token, in both its hidden-field and form-body forms.
  [/(name='ICSID'\s+id='ICSID'\s+value=')[^']*(')/g, "$1REDACTED_SESSION_TOKEN=$2"],
  [/\bICSID=[^&\s]+/g, "ICSID=REDACTED_SESSION_TOKEN%3D"],
  // Analytics ids are not credentials but are identifying; drop them anyway.
  [/\b_ga[\w]*=[^;\s"'&]+/g, "_ga=[REDACTED]"],
];

/** Anything matching these after scrubbing means a pattern was missed. */
const TRIPWIRES = [
  [/PS_TOKEN=(?!\[REDACTED\])\S/, "PS_TOKEN"],
  [/PSJSESSIONID=(?!\[REDACTED\])\S/, "PSJSESSIONID"],
  [/cf_clearance=(?!\[REDACTED\])\S/, "cf_clearance"],
  [/^\s*cookie:\s*(?!\[REDACTED\])\S/im, "a Cookie header"],
];

export function scrub(input) {
  let out = input;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

export function findLeaks(text, extraNames = []) {
  const leaks = [];
  for (const [pattern, label] of TRIPWIRES) {
    if (pattern.test(text)) leaks.push(label);
  }
  for (const name of extraNames) {
    if (name && new RegExp(`\\b${name}\\b`, "i").test(text)) leaks.push(`the name "${name}"`);
  }
  return leaks;
}

// Only run as a CLI, so the functions above stay importable by tests.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [, , inFile, outFile] = process.argv;
  const input = inFile ? readFileSync(inFile, "utf8") : readFileSync(0, "utf8");

  const scrubbed = scrub(input);

  // Names are personal and unguessable by pattern; pass them in to be checked.
  const names = (process.env["SCRUB_NAMES"] ?? "").split(",").map((s) => s.trim());
  const leaks = findLeaks(scrubbed, names);

  if (leaks.length > 0) {
    console.error(
      `REFUSING TO WRITE. Still present after scrubbing: ${leaks.join(", ")}.\n` +
        `Add a pattern to scripts/scrub-capture.mjs, or remove it by hand.`,
    );
    process.exit(1);
  }

  if (outFile) {
    writeFileSync(outFile, scrubbed);
    console.error(`Scrubbed -> ${outFile}`);
  } else {
    process.stdout.write(scrubbed);
  }
}
