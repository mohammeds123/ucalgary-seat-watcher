import { useEffect, useState } from "react";

import { canEnrol } from "../../src/domain/purge.js";
import { chooseTier } from "../../src/domain/schedule.js";
import { loadState, onStateChanged, updateSettings } from "../../src/storage.js";
import { DEFAULT_STATE, type StoredState } from "../../src/config.js";
import type { ClassStatus } from "../../src/peoplesoft/parse.js";

type StatusMap = Record<string, ClassStatus>;

export function Popup() {
  const [state, setState] = useState<StoredState>(DEFAULT_STATE);
  const [statuses, setStatuses] = useState<StatusMap>({});

  useEffect(() => {
    void loadState().then(setState);
    onStateChanged(setState);
    void chrome.storage.session
      .get("statuses")
      .then((r) => setStatuses((r["statuses"] as StatusMap) ?? {}));
  }, []);

  const { settings, watches } = state;
  const now = new Date();
  const termCodes = [...new Set(watches.map((w) => w.termCode))];
  const tier = chooseTier({
    now,
    termCodes,
    baselineSeconds: settings.pollSeconds,
    anyClosed: watches.some((w) => statuses[w.classNbr] !== "open"),
  });

  // Surface the purge gate up front. If enrolling is blocked for every watched
  // term, the user should learn that here rather than by wondering why an
  // "assist" alert only ever notified.
  const blocked = termCodes
    .map((termCode) => canEnrol({ termCode, waitlist: "has-waitlist", now }))
    .find((d) => !d.allowed);

  return (
    <>
      <header>
        <h1>Seat Watcher</h1>
        <span className="tier">
          {watches.length === 0 ? "idle" : `polling · ${tier}`}
        </span>
      </header>

      {settings.mode !== "notify" && blocked && !blocked.allowed && (
        <div className="gate">{blocked.explanation}</div>
      )}

      {watches.length === 0 ? (
        <p className="empty">
          No classes watched yet.
          <br />
          Add one from the options page.
        </p>
      ) : (
        <ul>
          {watches.map((w) => {
            const status = statuses[w.classNbr] ?? "unknown";
            return (
              <li key={w.id}>
                <div>
                  <div className="label">{w.label}</div>
                  <div className="sub">
                    {w.subject} {w.catalogNbr} · class {w.classNbr}
                    {w.armedForAutoEnrol ? " · auto armed" : ""}
                  </div>
                </div>
                <span className={`status ${status}`}>{status}</span>
              </li>
            );
          })}
        </ul>
      )}

      <footer>
        <button onClick={() => void chrome.runtime.openOptionsPage()}>Options</button>
        <button
          className={settings.killSwitch ? "danger" : ""}
          onClick={() => void updateSettings({ killSwitch: !settings.killSwitch })}
          title="Halts all automated enrolment submits immediately. Watching continues."
        >
          {settings.killSwitch ? "Auto halted" : "Halt auto"}
        </button>
      </footer>
    </>
  );
}
