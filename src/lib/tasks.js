import { createStore, useStore } from "./store.js";
import { load } from "./storage.js";
import { dayKey } from "./completions.js";

/**
 * Tasks — one-off things to get done. Groceries, the dishes, a form to post.
 *
 * Deliberately outside the practice spine: a task is not measured in focus
 * sessions, it does not recur, and it feeds no streak. It is a checkbox, with
 * at most one level of smaller checkboxes under it.
 *
 * Sub-items are notes to self, not a progress mechanic. Ticking every one of
 * them does not finish the task, and finishing the task does not require them —
 * the parent is checked by hand, independently.
 *
 * The one piece of history kept is *when* something was finished, so the
 * Calendar can say "three to-dos done on Monday". That record lives in `log`,
 * apart from the items, for the same reason the session log outlives a deleted
 * daily: clearing a finished task off the list should not rewrite the day you
 * finished it. Reopening a task is different — that withdraws the claim, so its
 * entry comes back out of the day it was logged on.
 */
const TASKS_KEY = "tasks";

export const SCHEMA_VERSION = 1;

export const TITLE_MAX = 120;
export const SUB_MAX = 120;
const SUBS_MAX = 100;

// The same bound the completions record keeps: roughly four years of days.
const MAX_DAYS = 1500;

const newId = (prefix) =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const cleanText = (raw, max) => (typeof raw === "string" ? raw.trim().slice(0, max) : "");

function sanitizeSub(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = cleanText(raw.text, SUB_MAX);
  if (!text) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("s"),
    text,
    done: raw.done === true,
  };
}

function sanitizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = cleanText(raw.title, TITLE_MAX);
  if (!title) return null;

  const subs = Array.isArray(raw.subs)
    ? raw.subs.map(sanitizeSub).filter(Boolean).slice(0, SUBS_MAX)
    : [];

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("t"),
    title,
    subs,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    // A task is done exactly when this is a timestamp. One field, so "done"
    // and "when" can never disagree.
    doneAt: Number.isFinite(raw.doneAt) ? raw.doneAt : null,
  };
}

function sanitizeLog(raw) {
  if (!raw || typeof raw !== "object") return {};
  const log = {};
  for (const [key, entries] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Array.isArray(entries)) continue;
    const seen = new Set();
    const clean = [];
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string" || !entry.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      clean.push({ id: entry.id, title: cleanText(entry.title, TITLE_MAX) || "Untitled task" });
    }
    if (clean.length > 0) log[key] = clean;
  }
  // ISO dates sort lexicographically the same way they sort chronologically.
  const keys = Object.keys(log).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete log[key];
  return log;
}

function hydrate(stored) {
  if (!stored || typeof stored !== "object") return { items: [], log: {} };
  const items = Array.isArray(stored.items) ? stored.items.map(sanitizeTask).filter(Boolean) : [];
  return { items, log: sanitizeLog(stored.log) };
}

export const tasksStore = createStore({
  key: TASKS_KEY,
  initial: { items: [], log: {} },
  hydrate,
  serialize: (state) => ({ version: SCHEMA_VERSION, ...state }),
});

// Only ever write an empty record when nothing is stored, the same guard the
// other stores keep: two tabs opening at once must not let an empty one win.
if (tasksStore.get().items.length > 0 || load(TASKS_KEY, null) === null) {
  tasksStore.checkpoint();
}

export const useTasks = () => useStore(tasksStore);

/* --- The done log ---------------------------------------------------------- */

const withEntry = (log, key, entry) => {
  const day = (log[key] ?? []).filter((e) => e.id !== entry.id);
  return { ...log, [key]: [...day, entry] };
};

const withoutEntry = (log, key, id) => {
  if (!log[key]) return log;
  const day = log[key].filter((e) => e.id !== id);
  const next = { ...log };
  if (day.length > 0) next[key] = day;
  else delete next[key];
  return next;
};

/** What was finished on the local day containing `ts`. */
export const doneOn = (state, ts) => state.log[dayKey(ts)] ?? [];

/* --- Tasks ----------------------------------------------------------------- */

export function addTask(title) {
  const task = sanitizeTask({ title, subs: [], createdAt: Date.now(), doneAt: null });
  if (!task) return null;
  tasksStore.set((state) => ({ ...state, items: [...state.items, task] }));
  return task.id;
}

export function renameTask(id, title) {
  const next = cleanText(title, TITLE_MAX);
  if (!next) return;
  tasksStore.set((state) => ({
    ...state,
    items: state.items.map((task) => (task.id === id ? { ...task, title: next } : task)),
  }));
}

/**
 * Checks or reopens a task, by hand. Sub-items are not touched either way.
 * Finishing stamps the moment and logs it against today; reopening clears the
 * stamp and takes the entry back out of the day it was logged on.
 */
export function toggleTask(id, now = Date.now()) {
  tasksStore.set((state) => {
    const task = state.items.find((t) => t.id === id);
    if (!task) return state;

    if (task.doneAt === null) {
      return {
        items: state.items.map((t) => (t.id === id ? { ...t, doneAt: now } : t)),
        log: withEntry(state.log, dayKey(now), { id, title: task.title }),
      };
    }

    return {
      items: state.items.map((t) => (t.id === id ? { ...t, doneAt: null } : t)),
      log: withoutEntry(state.log, dayKey(task.doneAt), id),
    };
  });
}

/**
 * Takes a task off the list. A finished task keeps its place in the log — it
 * was finished, and clearing it away doesn't change that.
 */
export function removeTask(id) {
  tasksStore.set((state) => ({ ...state, items: state.items.filter((t) => t.id !== id) }));
}

/** Puts a deleted task back where it was. Paired with the undo affordance. */
export function restoreTask(task, index) {
  tasksStore.set((state) => {
    if (state.items.some((t) => t.id === task.id)) return state;
    const items = [...state.items];
    items.splice(Math.min(Math.max(index, 0), items.length), 0, task);
    return { ...state, items };
  });
}

/* --- Sub-items ------------------------------------------------------------- */

const mapSubs = (taskId, fn) =>
  tasksStore.set((state) => ({
    ...state,
    items: state.items.map((task) => (task.id === taskId ? { ...task, subs: fn(task.subs) } : task)),
  }));

export function addSub(taskId, text) {
  const sub = sanitizeSub({ text, done: false });
  if (!sub) return null;
  mapSubs(taskId, (subs) => (subs.length >= SUBS_MAX ? subs : [...subs, sub]));
  return sub.id;
}

export const toggleSub = (taskId, subId) =>
  mapSubs(taskId, (subs) => subs.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)));

/** Renaming to nothing removes the item, the way clearing a line would. */
export function renameSub(taskId, subId, text) {
  const next = cleanText(text, SUB_MAX);
  mapSubs(taskId, (subs) =>
    next ? subs.map((s) => (s.id === subId ? { ...s, text: next } : s)) : subs.filter((s) => s.id !== subId),
  );
}

export const removeSub = (taskId, subId) =>
  mapSubs(taskId, (subs) => subs.filter((s) => s.id !== subId));

/* --- Reading --------------------------------------------------------------- */

/** Open tasks oldest first; finished ones most recent first. */
export function splitTasks(items) {
  return {
    open: items.filter((t) => t.doneAt === null).sort((a, b) => a.createdAt - b.createdAt),
    done: items.filter((t) => t.doneAt !== null).sort((a, b) => b.doneAt - a.doneAt),
  };
}
