/* Bootstrap safety test.

   Two real outages motivated this file, both of which showed up as an endless
   loading screen:
     1. an exception at module top level (localStorage access in a sandboxed
        iframe) killed the module before it rendered, and
     2. the error handler was registered at the END of the module, so it never
        ran when the crash happened earlier.
   A silent freeze is the worst failure mode, so these checks make sure a
   failure is always visible and the boot path stays free of risky top-level work.

   Run:  node test/bootstrap.mjs
*/
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainSrc = readFileSync(path.join(root, "src/main.js"), "utf8");
const indexSrc = readFileSync(path.join(root, "index.html"), "utf8");

let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const pass = (m) => console.log("  " + m);

// ---------------------------------------------------------------- 1. storage
console.log("test 1: storage wrapper survives a throwing localStorage");
{
  // simulate a sandboxed iframe: every access throws SecurityError
  globalThis.window = {
    get localStorage() {
      throw new Error("SecurityError: storage is not available in this context");
    },
  };
  const { loadSetting, saveSetting, storageAvailable } = await import("../src/storage.js");

  let threw = false;
  try {
    if (storageAvailable()) fail("storage reported as available although it throws");
    if (loadSetting("k", "fallback") !== "fallback") fail("loadSetting did not fall back");
    saveSetting("k", "v");           // must not throw
    if (loadSetting("k") !== "v") fail("memory fallback did not keep the value");
  } catch (e) {
    threw = true;
    fail("storage wrapper threw: " + e.message);
  }
  if (!threw) pass("no throw, in-memory fallback works");

  // and with a working storage the value persists
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
  };
  const mod2 = await import("../src/storage.js?a=2");
  if (!mod2.storageAvailable()) fail("working storage reported as unavailable");
  mod2.saveSetting("pref", "on");
  if (mod2.loadSetting("pref") !== "on") fail("setting not persisted");
  pass("persists when storage works");
}

// -------------------------------------------- 2. no risky work at module level
console.log("test 2: no unguarded platform access at module top level");
{
  const lines = mainSrc.split("\n");
  // find where executable top-level code starts vs. the first function/const of
  // the API surface — we simply scan the whole file for unguarded patterns and
  // allow them only inside functions or after a try {
  const risky = [
    { re: /^\s*const savedTouch = localStorage\./, why: "top-level localStorage read" },
    { re: /^\s*localStorage\.(get|set)Item/, why: "bare localStorage call" },
  ];
  for (const { re, why } of risky) {
    if (lines.some((l) => re.test(l))) fail(`${why} found in main.js`);
  }
  if (!/loadSetting\(TOUCH_KEY/.test(mainSrc)) fail("touch preference should be read via loadSetting");
  pass("storage only accessed through the safe wrapper");
}

// ---------------------------------------------------- 3. early error handling
console.log("test 3: error handling exists before the module runs");
{
  const fatalIdx = indexSrc.indexOf("__lhFatal");
  const moduleIdx = indexSrc.indexOf('type="module"');
  if (fatalIdx === -1) fail("no inline __lhFatal handler in index.html");
  if (moduleIdx === -1) fail("no module script in index.html");
  if (fatalIdx > moduleIdx) fail("error handler is declared after the module script");
  if (!indexSrc.includes('window.addEventListener("error"')) fail("no error listener inline");
  if (!indexSrc.includes("unhandledrejection")) fail("no rejection listener inline");
  pass("inline handlers precede the module");

  // the watchdog must exist and be cancellable from the module
  if (!indexSrc.includes("__lhMarkStarted")) fail("watchdog handshake missing");
  if (!mainSrc.includes("__lhMarkStarted")) fail("module never marks itself as started");
  const markIdx = mainSrc.indexOf("__lhMarkStarted");
  const firstImport = mainSrc.indexOf("import ");
  if (markIdx !== -1 && firstImport !== -1 && markIdx > firstImport) {
    // imports are hoisted, so marking after them still runs before other code;
    // what matters is that it is not buried inside boot()
    if (markIdx > mainSrc.indexOf("function boot")) fail("start marker is inside boot(), too late");
  }
  pass("watchdog handshake present and early");

  // a WebGL failure must be caught, not thrown into the void
  if (!/try\s*{\s*renderer = new THREE\.WebGLRenderer/.test(mainSrc)) fail("renderer creation is unguarded");
  pass("renderer creation is guarded");
}

// --------------------------------------------- 4. boot errors reach the banner
console.log("test 4: boot failures are surfaced");
{
  if (!/boot\(\)\.catch\(\(err\) => {[^}]*__lhFatal/s.test(mainSrc)) {
    fail("boot().catch does not call the fatal banner");
  }
  if (!mainSrc.includes("loadTexturesInBackground")) fail("texture loading is not backgrounded");
  pass("boot rejects into the visible banner, textures stay non-blocking");
}

console.log("");
if (failures) {
  console.error(`${failures} bootstrap failure(s)`);
  process.exit(1);
}
console.log("bootstrap OK: storage is safe, failures are visible, no silent hangs");
