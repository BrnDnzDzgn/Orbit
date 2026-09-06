/**
 * Orbit's persistence layer.
 *
 * The product is a static site with no backend, so everything a user
 * accumulates lives in this browser and nowhere else. Every access is guarded:
 * private windows, cleared site data, and browsers set to block storage all
 * throw rather than returning empty, and a timer that crashes on a privacy
 * setting is worse than one that forgets.
 *
 * Keys are namespaced per tool (`orbit:timer.settings`) so tools added later
 * share this module instead of inventing their own.
 */

const PREFIX = "orbit:";

/** Reads a JSON value. Returns `fallback` when absent, unreadable, or corrupt. */
export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Writes a JSON value. Returns false when this browser refused to store it. */
export function save(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Removes a stored value. Silent when storage is unavailable. */
export function remove(key) {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing to clean up if we could never write it */
  }
}

/**
 * Every Orbit key currently stored, without the prefix.
 *
 * This is the **only** enumeration in the codebase, and it is deliberately
 * scoped to the namespace boundary. Two rules go with it:
 *
 * 1. **Never narrow the prefix.** `startsWith("orbit:goals")` would also match
 *    `orbit:goals.list`, which belongs to a different tool — the same
 *    partial-name collision that has bitten this codebase before. Match
 *    `orbit:` and filter by exact key afterwards.
 * 2. **Never reach for `localStorage.clear()`.** GitHub Pages serves every
 *    project from one origin, so this storage is shared with anything else
 *    deployed under the same account. The prefix is the only thing separating
 *    them, and clearing everything would take a neighbour's data with it.
 *
 * Exists for the whole-app backup and the delete-everything action, which have
 * to see keys no registry knows about: note documents whose page was lost, and
 * the retired `orbit:goals`. Everything else addresses keys by exact name.
 */
export function keys() {
  try {
    const found = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null && key.startsWith(PREFIX)) found.push(key.slice(PREFIX.length));
    }
    return found.sort();
  } catch {
    return [];
  }
}

/**
 * Whether this browser will accept writes at all. Probed once rather than
 * inferred from a failed save, so the UI can be honest about losing data before
 * the user has anything to lose.
 */
export function isAvailable() {
  try {
    const probe = PREFIX + "__probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
