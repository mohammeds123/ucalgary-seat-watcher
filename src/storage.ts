/**
 * Typed access to chrome.storage.local.
 *
 * Reads validate against the schema so a partially-written or hand-edited blob
 * fails loudly here rather than as an undefined field midway through a poll.
 */

import { DEFAULT_STATE, StoredState, type Settings, type WatchedClass } from "./config.js";

const KEY = "state";

export async function loadState(): Promise<StoredState> {
  const raw = await chrome.storage.local.get(KEY);
  const parsed = StoredState.safeParse(raw[KEY]);
  if (!parsed.success) {
    // Falling back to defaults beats refusing to start, but the user needs to
    // know their watch list did not load.
    console.error("Stored state failed validation; using defaults.", parsed.error);
    return DEFAULT_STATE;
  }
  return parsed.data;
}

export async function saveState(state: StoredState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: StoredState.parse(state) });
}

export async function updateSettings(patch: Partial<Settings>): Promise<StoredState> {
  const state = await loadState();
  const next: StoredState = { ...state, settings: { ...state.settings, ...patch } };
  await saveState(next);
  return next;
}

export async function addWatch(watch: WatchedClass): Promise<StoredState> {
  const state = await loadState();
  if (state.watches.some((w) => w.id === watch.id)) return state;
  const next: StoredState = { ...state, watches: [...state.watches, watch] };
  await saveState(next);
  return next;
}

export async function removeWatch(id: string): Promise<StoredState> {
  const state = await loadState();
  const next: StoredState = {
    ...state,
    watches: state.watches.filter((w) => w.id !== id),
  };
  await saveState(next);
  return next;
}

export async function setArmed(id: string, armed: boolean): Promise<StoredState> {
  const state = await loadState();
  const next: StoredState = {
    ...state,
    watches: state.watches.map((w) =>
      w.id === id ? { ...w, armedForAutoEnrol: armed } : w,
    ),
  };
  await saveState(next);
  return next;
}

export function onStateChanged(fn: (state: StoredState) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(KEY in changes)) return;
    const parsed = StoredState.safeParse(changes[KEY]?.newValue);
    if (parsed.success) fn(parsed.data);
  });
}
