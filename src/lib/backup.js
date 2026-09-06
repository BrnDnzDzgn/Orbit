import { keys as storageKeys, load, remove, save } from "./storage.js";
import { SCHEMA_VERSION as DAILIES_SCHEMA, dailiesStore } from "./dailies.js";
import { SCHEMA_VERSION as NOTES_SCHEMA, flushDocs, healthStore, notesStore, resetDocCache } from "./notes.js";
import { goalsStore } from "./goals.js";
import { sessionsStore } from "./sessions.js";
import { completionsStore } from "./completions.js";
import { sessionStore, settingsStore, standDown } from "./timer.js";

/**
 * Whole-app backup, restore, and erase.
 *
 * Distinct from the Notes export, which produces a readable Markdown copy of
 * one tool. This is the everything file: every `orbit:` key, exactly as
 * stored, so a restore puts the browser back where it was.
 *
 * Two ways of finding keys, doing two different jobs:
 *
 * - **The registry below** is the contract — the stores that make up "all your
 *   data", and the only ones whose schema version this build claims to
 *   understand. It is also the list that gets rehydrated after a restore.
 * - **`storageKeys()`** is a scoped scan of the namespace, and it is what makes
 *   the backup complete and the erase total. It sees what no registry can:
 *   `notes.doc.<id>` keys, which are unbounded and named at runtime; documents
 *   whose page was lost; and the retired `orbit:goals`. A delete-everything
 *   that quietly left keys behind would be a broken promise about data, not an
 *   untidy implementation.
 */

export const BACKUP_FORMAT = "orbit-backup";

/** The envelope's own version. Bump only when this file's *shape* changes. */
export const BACKUP_VERSION = 1;

/**
 * The stores this build understands, and the schema version each speaks.
 * A backup claiming a higher number was written by a newer Orbit and is
 * refused — `sanitize` would otherwise strip the fields it doesn't recognise
 * and report success, which is data loss wearing a green tick.
 */
const REGISTRY = [
  { key: "timer.settings", store: settingsStore },
  { key: "timer.session", store: sessionStore },
  { key: "dailies", store: dailiesStore, schema: DAILIES_SCHEMA },
  { key: "goals.list", store: goalsStore },
  { key: "sessions", store: sessionsStore },
  { key: "completions", store: completionsStore },
  { key: "notes.tree", store: notesStore, schema: NOTES_SCHEMA },
];

const SCHEMAS = Object.fromEntries(
  REGISTRY.filter((entry) => entry.schema !== undefined).map((e) => [e.key, e.schema]),
);

const DOC_KEY = /^notes\.doc\.[^.]+$/;
const KNOWN = new Set(REGISTRY.map((entry) => entry.key));

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/* --- Reading what is here -------------------------------------------------- */

/** Every stored key and value, straight from the namespace. */
function collectAll() {
  const data = {};
  for (const key of storageKeys()) {
    const value = load(key, null);
    if (value !== null) data[key] = value;
  }
  return data;
}

const arrayLength = (value, field) =>
  isPlainObject(value) && Array.isArray(value[field]) ? value[field].length : 0;

/** What a data map holds, in the terms the confirmations speak. */
export function countsFrom(data) {
  const nodes = isPlainObject(data["notes.tree"]) && isPlainObject(data["notes.tree"].nodes)
    ? Object.values(data["notes.tree"].nodes)
    : [];
  return {
    dailies: arrayLength(data.dailies, "items"),
    goals: arrayLength(data["goals.list"], "items"),
    sessions: arrayLength(data.sessions, "items"),
    notebooks: nodes.filter((node) => node && node.type === "notebook").length,
    pages: nodes.filter((node) => node && node.type !== "notebook").length,
  };
}

/** What is in this browser right now. */
export const currentCounts = () => countsFrom(collectAll());

export function buildBackup(now = Date.now()) {
  // Anything a note is still holding back has to be on disk before we read it.
  flushDocs();
  const data = collectAll();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    schemas: SCHEMAS,
    counts: countsFrom(data),
    data,
  };
}

export const backupFilename = (now = Date.now()) => {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `orbit-backup-${date.getFullYear()}-${month}-${day}.json`;
};

/* --- Reading a file back --------------------------------------------------- */

const refuse = (error) => ({ ok: false, error });

/**
 * Checks a file completely before anything is written. Every failure returns
 * a reason and leaves storage untouched; there is no path here that half-reads
 * a file and starts applying it.
 */
export function validateBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse("That file isn't valid JSON.");
  }

  if (!isPlainObject(parsed)) return refuse("That file isn't an Orbit backup.");

  if (parsed.format !== BACKUP_FORMAT) {
    return parsed.format === "orbit-notes"
      ? refuse("That's a Notes export, not a full backup. Import it from the Notes tool instead.")
      : refuse("That doesn't look like an Orbit backup.");
  }

  const version = Number(parsed.version);
  if (!Number.isInteger(version) || version < 1) return refuse("That backup has no usable version.");
  if (version > BACKUP_VERSION) {
    return refuse("That backup was written by a newer version of Orbit than this one.");
  }

  if (!isPlainObject(parsed.data) || Object.keys(parsed.data).length === 0) {
    return refuse("That backup has no data in it.");
  }

  // The check that matters most. A record from a newer schema would otherwise
  // reach a sanitiser that drops the fields it does not know, quietly.
  const schemas = isPlainObject(parsed.schemas) ? parsed.schemas : {};
  for (const [key, known] of Object.entries(SCHEMAS)) {
    const claimed = Number(schemas[key] ?? parsed.data[key]?.version ?? known);
    if (Number.isFinite(claimed) && claimed > known) {
      return refuse(
        `That backup's ${key} data is version ${claimed}; this build understands up to ${known}.`,
      );
    }
  }

  const unknown = [];
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!isPlainObject(value)) return refuse(`The entry for "${key}" isn't an object.`);
    if (!KNOWN.has(key) && !DOC_KEY.test(key)) unknown.push(key);
  }

  return { ok: true, backup: parsed, counts: countsFrom(parsed.data), unknown };
}

/* --- Applying it ----------------------------------------------------------- */

/**
 * Replaces everything with a validated backup.
 *
 * The write is as close to a transaction as this storage allows: the current
 * namespace is snapshotted in memory first, and if any write fails part-way —
 * a large backup running into the quota — everything is put back exactly as it
 * was. A half-applied restore is worse than a refused one.
 */
export function applyBackup(backup) {
  flushDocs();
  resetDocCache();

  const snapshot = collectAll();

  // Putting everything back is itself a sequence of writes that can fail, so it
  // reports whether it managed the lot. It runs after a full clear, into space
  // the same data occupied a moment ago, so it should always fit — but "should"
  // is not a guarantee worth making silently about somebody's notes.
  const restore = (data) => {
    for (const key of storageKeys()) remove(key);
    let complete = true;
    for (const [key, value] of Object.entries(data)) {
      if (!save(key, value)) complete = false;
    }
    return complete;
  };

  for (const key of storageKeys()) remove(key);

  try {
    for (const [key, value] of Object.entries(backup.data)) {
      if (!save(key, value)) throw new Error(key);
    }
  } catch {
    const recovered = restore(snapshot);
    refresh();
    return refuse(
      recovered
        ? "Ran out of space part-way through, so nothing was changed."
        : "Ran out of space part-way through, and putting your own data back " +
          "failed too. Some of it may be missing — restore from a backup now.",
    );
  }

  refresh();
  return { ok: true };
}

/** Erases the namespace. Irreversible: there is no snapshot and no undo. */
export function wipeAll() {
  flushDocs();
  resetDocCache();
  for (const key of storageKeys()) remove(key);
  refresh({ persistTimer: false });
  return { ok: true };
}

/**
 * Pulls every store back off disk so the running app shows what is now there,
 * with no reload.
 *
 * Each store goes through its own `hydrate`, so anything restored is sanitised
 * and migrated on the way in. The timer is stood down rather than rehydrated —
 * see standDown for why a restored running session must not be resumed.
 */
export function refresh({ persistTimer = true } = {}) {
  resetDocCache();
  for (const { key, store } of REGISTRY) {
    if (key === "timer.session") continue;
    store.rehydrate();
  }
  healthStore.set({ failed: false });
  standDown({ persist: persistTimer });
}
