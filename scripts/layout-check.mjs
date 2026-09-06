/**
 * A layout smoke test.
 *
 * Lint and build both pass on CSS that renders the app unusable — neither one
 * lays anything out. This drives a real browser at the built site and asserts
 * the one property no unit test was ever going to catch: that each tool's
 * canvas actually fills the width it is given.
 *
 * Usage:  npm run preview &  then  node scripts/layout-check.mjs [--shot]
 */
const BASE = process.env.ORBIT_URL ?? "http://localhost:4173/Orbit/";
const ROUTES = ["timer", "dailies", "goals", "calendar", "habits", "activity", "notes", "settings"];
const VIEWPORT = { width: 1280, height: 800 };
const shot = process.argv.includes("--shot");

const CHROME =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const { spawn } = await import("node:child_process");
const { mkdtemp, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const reachable = async (url) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
};

// Serve the build ourselves unless something is already answering, so the whole
// check is one command.
let preview = null;
if (!(await reachable(BASE))) {
  preview = spawn("npx", ["vite", "preview", "--port", "4173"], { stdio: "ignore" });
  for (let i = 0; i < 40 && !(await reachable(BASE)); i += 1) await wait(250);
}
const done = (code) => {
  preview?.kill();
  process.exit(code);
};

const profile = await mkdtemp(join(tmpdir(), "orbit-chrome-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--remote-debugging-port=9222",
  `--user-data-dir=${profile}`,
  `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  "about:blank",
]);
chrome.on("error", (e) => { console.error("could not launch Chrome:", e.message); done(1); });

let target;
for (let i = 0; i < 40 && !target; i += 1) {
  await wait(250);
  try {
    const res = await fetch("http://localhost:9222/json/list");
    target = (await res.json()).find((t) => t.type === "page");
  } catch { /* not up yet */ }
}
if (!target) { console.error("Chrome never came up"); chrome.kill(); done(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let seq = 0;
const waiting = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg.result);
    waiting.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");

const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return res?.result?.value;
};

const MEASURE = `(() => {
  const px = (el) => el ? Math.round(el.getBoundingClientRect().width) : null;
  const main = document.querySelector('.shell-main');
  const canvas = document.querySelector('.canvas');
  const tool = canvas && canvas.firstElementChild;
  return {
    viewport: window.innerWidth,
    rail: px(document.querySelector('.rail')),
    shellMain: px(main),
    canvas: px(canvas),
    tool: px(tool),
    toolClass: tool ? tool.className : null,
    canvasMaxWidth: canvas ? getComputedStyle(canvas).maxWidth : null,
    canvasMargin: canvas ? getComputedStyle(canvas).marginLeft : null,
    canvasContain: canvas ? getComputedStyle(canvas).contain : null,
  };
})()`;

let failures = 0;
console.log(`viewport ${VIEWPORT.width}px\n`);
console.log("route      rail  shell-main   canvas    tool   verdict");
console.log("------------------------------------------------------");

for (const route of ROUTES) {
  await send("Page.navigate", { url: `${BASE}#/${route}` });
  await wait(700);
  const m = await evaluate(MEASURE);
  if (!m) { console.log(`${route.padEnd(9)}  (could not measure)`); failures += 1; continue; }

  // A missing element means the page never rendered — a stale server on the
  // port, a wrong base path, a crash. That has to fail loudly: comparing nulls
  // coerces to `0 >= -2` and reported PASS on a site that was serving 404s.
  if (!Number.isFinite(m.shellMain) || !Number.isFinite(m.canvas)) {
    console.log(`${route.padEnd(9)}  NOTHING RENDERED — no .shell-main/.canvas on the page`);
    failures += 1;
    continue;
  }

  // The canvas should take essentially everything the shell's main column has.
  const expected = m.shellMain;
  const ok = m.canvas >= expected - 2;
  if (!ok) failures += 1;
  console.log(
    `${route.padEnd(9)} ${String(m.rail).padStart(4)}  ${String(m.shellMain).padStart(9)}  ` +
    `${String(m.canvas).padStart(7)} ${String(m.tool).padStart(7)}   ${ok ? "ok" : "COLLAPSED"}`,
  );
  if (!ok && route === ROUTES[0]) {
    console.log(`           .canvas computed: max-width ${m.canvasMaxWidth}, margin-left ${m.canvasMargin}, contain ${m.canvasContain}`);
  }
  if (shot) {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`/tmp/orbit-${route}.png`, Buffer.from(data, "base64"));
  }
}

ws.close();
chrome.kill();
console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} route(s) with a collapsed canvas`}`);
done(failures === 0 ? 0 : 1);
