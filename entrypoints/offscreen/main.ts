/**
 * The timer host.
 *
 * Exists because an MV3 service worker cannot hold a sub-30s interval: it is
 * torn down after ~30s idle, and `chrome.alarms` will not fire faster than every
 * 30s. An offscreen document has no such limit, and it can also play audio,
 * which a service worker cannot.
 *
 * It holds no state worth losing — if it is torn down, the background script's
 * 30s heartbeat alarm rebuilds it.
 */

const DEFAULT_INTERVAL_SECONDS = 60;

let timer: ReturnType<typeof setInterval> | undefined;
let currentSeconds = 0;

function setInterval_(seconds: number): void {
  if (seconds === currentSeconds) return; // avoid resetting the phase needlessly
  currentSeconds = seconds;
  if (timer !== undefined) clearInterval(timer);
  timer = setInterval(tick, seconds * 1000);
}

function tick(): void {
  chrome.runtime.sendMessage({ type: "tick" }).catch(() => {
    // Service worker asleep. It will be woken by the message or the heartbeat.
  });
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (
    typeof msg === "object" &&
    msg !== null &&
    (msg as { type?: string }).type === "set-interval"
  ) {
    const seconds = (msg as { seconds?: number }).seconds;
    if (typeof seconds === "number" && seconds >= 5) setInterval_(seconds);
  }
  return undefined;
});

setInterval_(DEFAULT_INTERVAL_SECONDS);
tick(); // poll immediately on startup rather than waiting a full interval
