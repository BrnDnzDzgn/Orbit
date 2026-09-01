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

const owners = new Map();
for (const file of files) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
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
if (clashes.length === 0) {
  console.log(`css-collisions: ${files.length} stylesheets, no class defined in two of them.`);
  process.exit(0);
}

console.error("css-collisions: the same class is defined in more than one stylesheet.\n");
for (const [selector, where] of clashes.sort()) {
  console.error(`  ${selector}`);
  for (const file of [...where].sort()) console.error(`      ${file}`);
}
console.error("\nAll CSS is bundled globally, so whichever loads last silently wins.");
console.error("Scope the tool-specific one (.note-page, .timer-controls) or move the");
console.error("genuinely shared one into src/components.css.");
process.exit(1);
