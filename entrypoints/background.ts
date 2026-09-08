/**
 * Background orchestrator.
 *
 * MV3 service workers are torn down after ~30s idle and `chrome.alarms` has a
 * 30s floor, so neither alone can sustain a 10-20s poll. The arrangement:
 *
 *  - An **offscreen document** holds the real timer. It survives independently
 *    of the service worker and also gives us an audio context for the alert
 *    sound, which a service worker cannot have.
 *  - A 30s **alarm** acts as a resurrection heartbeat: if the worker was torn
 *    down and the offscreen document went with it, the alarm brings both back.
 *
 * The worker itself stays stateless between wakeups — everything durable lives
 * in chrome.storage.
 */

import { intervalSeconds } from "../src/domain/schedule.js";
import { loadState } from "../src/storage.js";
import { notifyDesktop, relayToPhone } from "../src/alerts.js";
import { Watcher } from "../src/watcher.js";
import { createPortalSearch } from "../src/portal.js";

const HEARTBEAT_ALARM = "watcher-heartbeat";
const OFFSCREEN_PATH = "offscreen.html";

export default defineBackground(() => {
  const watcher = new Watcher(createPortalSearch());

  chrome.runtime.onInstalled.addListener(() => {
    void ensureOffscreen();
    chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  });

  chrome.runtime.onStartup.addListener(() => {
    void ensureOffscreen();
  });

  // Heartbeat: revive the timer host if the worker was torn down.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM) void ensureOffscreen();
  });

  // The offscreen document owns the clock and pings us each tick.
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    if (isTick(msg)) void runPoll(watcher);
    return undefined;
  });

  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith("seat:")) return;
    void chrome.tabs.create({
      url: "https://portal.my.ucalgary.ca/psp/paprd/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL",
    });
  });
});

function isTick(msg: unknown): boolean {
  return typeof msg === "object" && msg !== null && (msg as { type?: string }).type === "tick";
}

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification:
      "Holds the polling timer (sub-30s, below the alarms floor) and plays the seat-open alert sound.",
  });
}

async function runPoll(watcher: Watcher): Promise<void> {
  const { settings, watches } = await loadState();
  if (watches.length === 0) return;

  const now = new Date();
  const result = await watcher.poll(watches, settings, now);

  for (const action of result.actions) {
    await notifyDesktop(action);
    await relayToPhone(settings.ntfyTopic, action);

    if (action.kind === "assist" || action.kind === "auto") {
      // Phase 3: open the enrolment page pre-filled; Phase 3b submits it.
      // Until that lands, the alert above is the whole behaviour, and the
      // notification text already tells the user what to do.
      console.info(`[${action.kind}] enrolment assist not yet implemented`, action.watch.label);
    }
  }

  if (result.errors.length > 0) {
    console.error("Poll errors", result.errors);
  }

  // Tell the timer how fast to run next, based on where we are in the term.
  const seconds = intervalSeconds({
    now,
    termCodes: [...new Set(watches.map((w) => w.termCode))],
    baselineSeconds: settings.pollSeconds,
    anyClosed: [...result.statuses.values()].some((s) => s !== "open"),
  });
  await chrome.runtime.sendMessage({ type: "set-interval", seconds }).catch(() => {
    // Offscreen document may be gone; the heartbeat will rebuild it.
  });

  await chrome.action.setBadgeText({
    text: result.actions.length > 0 ? String(result.actions.length) : "",
  });
}
