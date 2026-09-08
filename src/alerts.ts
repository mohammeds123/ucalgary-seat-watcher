/**
 * Getting the user's attention, on the desktop and on their phone.
 *
 * The phone relay uses ntfy.sh: an HTTP POST to a topic URL, with the ntfy app
 * subscribed on the phone. No account, no push certificates, no backend of our
 * own. The tradeoff is that a topic is a shared secret — anyone who knows it can
 * read the alerts — so topics are generated, never user-chosen.
 */

import type { Action } from "./watcher.js";

export interface AlertText {
  readonly title: string;
  readonly body: string;
}

export function describe(action: Action): AlertText {
  const { watch, kind, gate } = action;

  if (kind === "auto") {
    return {
      title: `Enrolling you in ${watch.label}`,
      body: "A seat opened and auto-enrol was armed. Check the result in a moment.",
    };
  }

  if (kind === "assist") {
    return {
      title: `Seat open: ${watch.label}`,
      body: "Opening the enrolment page with the class filled in. Press the final button.",
    };
  }

  // notify — and if enrolling was blocked, say why. A silent no-op reads as a
  // broken extension.
  const why = gate.allowed
    ? "Go grab it."
    : gate.explanation;
  return { title: `Seat open: ${watch.label}`, body: why };
}

export async function notifyDesktop(action: Action): Promise<void> {
  const { title, body } = describe(action);
  await chrome.notifications.create(`seat:${action.watch.id}:${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon/128.png"),
    title,
    message: body,
    priority: 2,
    // The whole point is that a missed alert is a missed seat.
    requireInteraction: true,
  });
}

/** Relay to the user's phone. Best-effort: a failed relay must not break polling. */
export async function relayToPhone(
  topic: string | null,
  action: Action,
): Promise<void> {
  if (topic === null || topic === "") return;
  const { title, body } = describe(action);

  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: "urgent",
        Tags: "rotating_light",
      },
      body,
    });
  } catch (error) {
    console.error("ntfy relay failed; desktop alert still fired.", error);
  }
}

/** Topics are guessable if humans pick them. Generate one. */
export function generateTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ucseat-${hex}`;
}
