import { useRef, useState } from "react";
import { AlertTriangle, Download, Trash2, Upload } from "lucide-react";
import {
  applyBackup,
  backupFilename,
  buildBackup,
  validateBackup,
  wipeAll,
} from "../lib/backup.js";
import { useDailies } from "../lib/dailies.js";
import { downloadFile } from "../lib/download.js";
import { useGoals } from "../lib/goals.js";
import { useNotes } from "../lib/notes.js";
import { useSessions } from "../lib/sessions.js";
import "./Settings.css";

// Typed out in full before the irreversible thing becomes possible. Short
// enough to type, specific enough that it cannot be hit by accident.
const CONFIRM_WORD = "delete";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Settings — where all of Orbit's data can be taken out, put back, or erased.
 *
 * Distinct from the Notes export, which produces a readable Markdown copy of
 * one tool. This is the everything file.
 */
export default function Settings() {
  const dailies = useDailies();
  const goals = useGoals();
  const sessions = useSessions();
  const notes = useNotes();

  const [pending, setPending] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [wiping, setWiping] = useState(false);
  const fileRef = useRef(null);

  // Read from the live stores rather than from storage, so these numbers move
  // the moment an import or a wipe lands — the visible proof that the app
  // refreshed itself without a reload.
  const nodes = Object.values(notes.nodes);
  const here = {
    dailies: dailies.items.length,
    goals: goals.items.length,
    sessions: sessions.items.length,
    notebooks: nodes.filter((node) => node.type === "notebook").length,
    pages: nodes.filter((node) => node.type !== "notebook").length,
  };
  const isEmpty = Object.values(here).every((n) => n === 0);

  const describe = (counts) =>
    [
      plural(counts.dailies, "daily").replace("dailys", "dailies"),
      plural(counts.goals, "goal"),
      plural(counts.sessions, "session"),
      plural(counts.notebooks, "notebook"),
      plural(counts.pages, "page"),
    ].join(" · ");

  const exportAll = () => {
    const backup = buildBackup();
    downloadFile(backupFilename(), JSON.stringify(backup, null, 2), "application/json");
    setNotice({ tone: "good", text: `Backup downloaded — ${describe(backup.counts)}.` });
  };

  const chooseFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setNotice(null);
    const result = validateBackup(await file.text());
    if (!result.ok) {
      setNotice({ tone: "bad", text: `${result.error} Nothing was changed.` });
      return;
    }
    setPending({ ...result, name: file.name });
  };

  const confirmImport = () => {
    const result = applyBackup(pending.backup);
    setPending(null);
    setNotice(
      result.ok
        ? { tone: "good", text: `Restored — ${describe(pending.counts)}. The timer was stopped.` }
        : { tone: "bad", text: result.error },
    );
  };

  const confirmWipe = () => {
    wipeAll();
    setWiping(false);
    setConfirmText("");
    setNotice({ tone: "good", text: "Everything was deleted. Orbit is back to a blank slate." });
  };

  return (
    <div className="settings">
      <div className="settings-column">
        <p className="settings-lede">
          Everything Orbit knows lives in this browser and nowhere else. There is no account and
          nothing syncs, so a backup is the only copy that survives clearing site data, changing
          browser, or changing machine.
        </p>

        <p className="settings-here">
          {isEmpty ? "Nothing stored yet." : `In this browser: ${describe(here)}.`}
        </p>

        {notice && (
          <p className="settings-notice" data-tone={notice.tone} role="status">
            {notice.text}
          </p>
        )}

        <section className="panel">
          <h2 className="panel-title">Full backup</h2>
          <p className="panel-body">
            Every tool&rsquo;s data as one JSON file &mdash; timer settings, dailies, goals, the
            session log, completions, and all your notes. This is the file to keep.
          </p>
          <button type="button" className="button button--primary" onClick={exportAll}>
            <Download size={18} aria-hidden="true" />
            Export full backup (JSON)
          </button>
          <p className="panel-aside">
            Looking for readable notes? The Notes tool exports those as Markdown.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title">Restore from a backup</h2>
          <p className="panel-body">
            Reads a backup file and replaces everything currently here with it. The file is
            checked completely before anything is written, and a file this build can&rsquo;t read
            is refused without touching your data.
          </p>
          <button type="button" className="button button--secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={18} aria-hidden="true" />
            Choose a backup file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="settings-file"
            onChange={chooseFile}
          />
        </section>

        <section className="panel panel--danger">
          <h2 className="panel-title">Delete everything</h2>
          <p className="panel-body">
            Erases every trace of Orbit from this browser &mdash; all seven tools. This cannot be
            undone and there is no nine-second reprieve, so take a backup first if there is any
            chance you want it back.
          </p>

          {/* Adjacent on purpose: backing up before erasing is one click, not a
              trip to another card. */}
          <div className="panel-actions">
            <button type="button" className="button button--secondary" onClick={exportAll}>
              <Download size={18} aria-hidden="true" />
              Export a backup first
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => setWiping(true)}
              disabled={isEmpty}
            >
              <Trash2 size={18} aria-hidden="true" />
              {isEmpty ? "Nothing to delete" : "Delete everything"}
            </button>
          </div>
        </section>
      </div>

      {pending && (
        <Dialog title="Replace everything with this backup?" onCancel={() => setPending(null)}>
          <p className="set-dialog-body">
            <strong>{pending.name}</strong> holds {describe(pending.counts)}.
          </p>
          <p className="set-dialog-body">
            {isEmpty
              ? "Nothing is stored here now, so nothing will be lost."
              : `It replaces what is here now — ${describe(here)} — and that cannot be undone.`}{" "}
            The timer will be stopped.
          </p>
          {pending.unknown.length > 0 && (
            <p className="set-dialog-body set-dialog-body--quiet">
              It also carries {plural(pending.unknown.length, "entry")} this build doesn&rsquo;t
              recognise. They&rsquo;ll be restored untouched.
            </p>
          )}
          <div className="set-dialog-actions">
            <button type="button" className="button button--secondary" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button type="button" className="button button--primary" onClick={confirmImport}>
              Replace everything
            </button>
          </div>
        </Dialog>
      )}

      {wiping && (
        <Dialog
          title="Delete everything in this browser?"
          onCancel={() => {
            setWiping(false);
            setConfirmText("");
          }}
        >
          <p className="set-dialog-body">
            This erases {describe(here)}. It is irreversible &mdash; there is no undo and no copy
            anywhere else.
          </p>
          <label className="set-dialog-label" htmlFor="confirm-word">
            Type <span className="set-dialog-word">{CONFIRM_WORD}</span> to confirm
          </label>
          <input
            id="confirm-word"
            className="field-input set-dialog-input"
            type="text"
            autoComplete="off"
            spellCheck="false"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
          />
          <div className="set-dialog-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setWiping(false);
                setConfirmText("");
              }}
            >
              Keep my data
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={confirmText.trim().toLowerCase() !== CONFIRM_WORD}
              onClick={confirmWipe}
            >
              <AlertTriangle size={18} aria-hidden="true" />
              Delete everything
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Dialog({ title, children, onCancel }) {
  return (
    <div className="set-scrim" role="presentation" onClick={onCancel}>
      <div
        className="set-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="set-dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
