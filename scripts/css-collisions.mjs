/**
 * Fails when two stylesheets define the same bare class.
 *
 * All of Orbit's CSS is bundled into one global sheet, so a class name is a
 * global identifier. When `.canvas` was defined for the app shell and again,
 * later, for the Notes page column, every tool's canvas collapsed to zero
 * width — and lint, build, and the server-render tests all passed, because
 * none of them lay anything out.
 *
 * Only *bare* single-class selectors count. A tool refining something it does
 * not own (`.cal-nav .text-button`) is deliberate and fine; two files both
 * saying what `.canvas` is, is not. Redeclaring a class inside a media query
 * in the same file is also fine.
 *
 * `@keyframes` share the same global namespace and were missed by the first
 * version of this check: `scrim-in` was defined in Timer.css and animated by
 * Notes and Settings, so deleting or renaming it in one tool would have
 * silently stopped two others animating. An animation must be defined in the
 * file that uses it, or in the shared sheet — never borrowed sideways.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (entry.endsWith(".css")) files.push(path);
  }
})("src");

const SHARED = "src/components.css";

const owners = new Map();
const framesDefined = new Map();
const framesUsed = new Map();

for (const file of files) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  for (const [, name] of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
    if (!framesDefined.has(name)) framesDefined.set(name, new Set());
    framesDefined.get(name).add(file);
  }
  for (const [, value] of css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    const name = value.trim().split(/\s+/)[0];
    if (!/^[\w-]+$/.test(name) || name === "none") continue;
    if (!framesUsed.has(name)) framesUsed.set(name, new Set());
    framesUsed.get(name).add(file);
  }

  for (const [, selectors] of css.matchAll(/(?:^|\})\s*([^{}@][^{}]*?)\{/gm)) {
    for (const raw of selectors.split(",")) {
      const selector = raw.trim().replace(/\s+/g, " ");
      if (!/^\.[A-Za-z][\w-]*$/.test(selector)) continue;
      if (!owners.has(selector)) owners.set(selector, new Set());
      owners.get(selector).add(file);
    }
  }
}

const clashes = [...owners].filter(([, where]) => where.size > 1);

// A keyframe borrowed from another tool's stylesheet is the same bug wearing a
// different namespace.
const borrowed = [];
for (const [name, users] of framesUsed) {
  const defined = framesDefined.get(name) ?? new Set();
  for (const user of users) {
    if (!defined.has(user) && !defined.has(SHARED)) {
      borrowed.push([name, user, [...defined]]);
    }
  }
}
const duplicated = [...framesDefined].filter(([, where]) => where.size > 1);

if (clashes.length === 0 && borrowed.length === 0 && duplicated.length === 0) {
  console.log(
    `css-collisions: ${files.length} stylesheets, no class or keyframe shared across two of them.`,
  );
  process.exit(0);
}

if (clashes.length > 0) {
  console.error("css-collisions: the same class is defined in more than one stylesheet.\n");
  for (const [selector, where] of clashes.sort()) {
    console.error(`  ${selector}`);
    for (const file of [...where].sort()) console.error(`      ${file}`);
  }
  console.error("\nAll CSS is bundled globally, so whichever loads last silently wins.");
  console.error("Scope the tool-specific one (.note-page, .timer-controls) or move the");
  console.error(`genuinely shared one into ${SHARED}.\n`);
}

for (const [name, user, defined] of borrowed) {
  console.error(`css-collisions: ${user} animates "${name}", which it does not define.`);
  console.error(`  defined in: ${defined.join(", ") || "(nowhere)"}`);
  console.error(`  Define it in ${user}, or move it to ${SHARED}.\n`);
}

for (const [name, where] of duplicated) {
  console.error(`css-collisions: @keyframes ${name} is defined in more than one stylesheet.`);
  for (const file of [...where].sort()) console.error(`      ${file}`);
}

process.exit(1);
