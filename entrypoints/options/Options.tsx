import { useEffect, useState } from "react";

import { generateTopic } from "../../src/alerts.js";
import { PURGE_DAYS, canEnrol } from "../../src/domain/purge.js";
import { formatTerm, fromTermCode, isVerifiedTermCode } from "../../src/domain/terms.js";
import {
  addWatch,
  loadState,
  onStateChanged,
  removeWatch,
  setArmed,
  updateSettings,
} from "../../src/storage.js";
import { DEFAULT_STATE, type ActionMode, type StoredState } from "../../src/config.js";

const MODES: { value: ActionMode; title: string; blurb: string }[] = [
  {
    value: "notify",
    title: "Notify only",
    blurb: "Alert and link to the class. You do everything else.",
  },
  {
    value: "assist",
    title: "Notify + one-click assist",
    blurb:
      "Opens the enrolment page with the class filled in. You press the final button.",
  },
  {
    value: "auto",
    title: "Auto-enrol",
    blurb:
      "Submits the enrolment for you, then tells you what happened. Must be armed per class.",
  },
];

export function Options() {
  const [state, setState] = useState<StoredState>(DEFAULT_STATE);

  useEffect(() => {
    void loadState().then(setState);
    onStateChanged(setState);
  }, []);

  const { settings, watches } = state;
  const now = new Date();

  return (
    <>
      <h1>UCalgary Seat Watcher</h1>

      <section>
        <h2>When a seat opens</h2>
        <p className="hint">
          Applies to every watched class. Auto-enrol additionally requires arming the
          individual class below.
        </p>
        {MODES.map((m) => (
          <label
            key={m.value}
            className={`mode-option ${settings.mode === m.value ? "selected" : ""}`}
          >
            <input
              type="radio"
              name="mode"
              checked={settings.mode === m.value}
              onChange={() => void updateSettings({ mode: m.value })}
            />
            <span>
              <strong>{m.title}</strong>
              <small>{m.blurb}</small>
            </span>
          </label>
        ))}

        <div className="warn">
          <strong>None of these enrol you into a waitlisted course before its purge
          day.</strong>{" "}
          Seats freed before then belong to the waitlist queue. Assist and auto-enrol
          quietly fall back to a plain notification until the purge day passes, and the
          alert tells you why.
        </div>
      </section>

      <section>
        <h2>Waitlist purge days</h2>
        <p className="hint">
          Published by the Registrar, per term. Enrolling is disabled for any term missing
          from this table, or whose code has not been confirmed against a real portal
          response.
        </p>
        <table>
          <thead>
            <tr>
              <th>Term</th>
              <th>Code</th>
              <th>Purge day</th>
              <th>Enrolling now?</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(PURGE_DAYS).map(([code, day]) => {
              const term = fromTermCode(code);
              const gate = canEnrol({ termCode: code, waitlist: "has-waitlist", now });
              return (
                <tr key={code}>
                  <td>{term ? formatTerm(term) : "—"}</td>
                  <td>
                    {code}
                    {!isVerifiedTermCode(code) && " (unconfirmed)"}
                  </td>
                  <td>{day}</td>
                  <td>{gate.allowed ? "allowed" : "blocked"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Watched classes</h2>
        <p className="hint">
          The class number is the 5-digit id in Class Search. Classes in the same subject
          share one request, so watching many courses in one subject costs no more than
          watching one.
        </p>
        <AddWatchForm />
        {watches.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>Term</th>
                <th>Class nbr</th>
                <th>Auto armed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {watches.map((w) => (
                <tr key={w.id}>
                  <td>{w.label}</td>
                  <td>{w.termCode}</td>
                  <td>{w.classNbr}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={w.armedForAutoEnrol}
                      disabled={settings.mode !== "auto"}
                      onChange={(e) => void setArmed(w.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <button className="inline" onClick={() => void removeWatch(w.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Phone alerts</h2>
        <p className="hint">
          Alerts relay to your phone through ntfy.sh. Install the ntfy app and subscribe to
          this topic. Anyone who knows the topic can read your alerts, so it is generated
          rather than chosen.
        </p>
        <label className="row">
          <input type="text" readOnly value={settings.ntfyTopic ?? "(none)"} />
          <button
            className="inline"
            onClick={() => void updateSettings({ ntfyTopic: generateTopic() })}
          >
            {settings.ntfyTopic ? "Regenerate" : "Generate"}
          </button>
        </label>
      </section>

      <section>
        <h2>Polling</h2>
        <label className="row">
          Baseline interval
          <input
            type="number"
            min={10}
            max={3600}
            value={settings.pollSeconds}
            onChange={(e) =>
              void updateSettings({ pollSeconds: Number(e.target.value) || 60 })
            }
          />
          seconds
        </label>
        <p className="hint">
          The extension polls faster on the purge day and around each hour boundary (when
          the waitlist batch runs), and slower overnight. This sets the floor for ordinary
          hours.
        </p>
      </section>
    </>
  );
}

function AddWatchForm() {
  const [termCode, setTermCode] = useState("2267");
  const [subject, setSubject] = useState("");
  const [catalogNbr, setCatalogNbr] = useState("");
  const [classNbr, setClassNbr] = useState("");

  const canSubmit =
    subject.trim() !== "" && catalogNbr.trim() !== "" && /^\d{4,6}$/.test(classNbr.trim());

  return (
    <div className="grid">
      <label className="field">
        <span>Term code</span>
        <input type="text" value={termCode} onChange={(e) => setTermCode(e.target.value)} />
      </label>
      <label className="field">
        <span>Subject</span>
        <input
          type="text"
          placeholder="CPSC"
          value={subject}
          onChange={(e) => setSubject(e.target.value.toUpperCase())}
        />
      </label>
      <label className="field">
        <span>Catalog nbr</span>
        <input
          type="text"
          placeholder="441"
          value={catalogNbr}
          onChange={(e) => setCatalogNbr(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Class nbr</span>
        <input
          type="text"
          placeholder="71003"
          value={classNbr}
          onChange={(e) => setClassNbr(e.target.value)}
        />
      </label>
      <button
        className="inline"
        disabled={!canSubmit}
        onClick={() => {
          const s = subject.trim();
          const c = catalogNbr.trim();
          const n = classNbr.trim();
          void addWatch({
            id: `${termCode}:${n}`,
            termCode: termCode.trim(),
            subject: s,
            catalogNbr: c,
            classNbr: n,
            label: `${s} ${c}`,
            armedForAutoEnrol: false,
            autoEnrolExpiresIso: null,
          });
          setSubject("");
          setCatalogNbr("");
          setClassNbr("");
        }}
      >
        Add
      </button>
    </div>
  );
}
