/* Boots the real src/main.js end to end in a working (fake) browser and asserts
   the game reaches its start menu.

   This is the test that would have caught the last outage: main.js used
   TouchControls / auditMaterials / loadSetting without importing them, which is
   a ReferenceError only at runtime. Syntax checks and every other suite passed,
   because they never execute the module's own top level.

   Run:  node --import ./test/register-three-stub.mjs test/boot-success.mjs
*/

let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const fatalCalls = [];
const consoleErrors = [];

// ---------------------------------------------------------------- fake DOM
const makeClassList = (init = []) => {
  const set = new Set(init);
  return {
    _set: set,
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c, on) => ((on === undefined ? !set.has(c) : on) ? set.add(c) : set.delete(c)),
    contains: (c) => set.has(c),
  };
};

function fake2d() {
  const noop = () => {};
  return {
    canvas: null,
    setTransform: noop, save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    beginPath: noop, arc: noop, ellipse: noop, clip: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop, moveTo: noop, lineTo: noop,
    closePath: noop, drawImage: noop, fillText: noop, strokeText: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: noop,
  };
}

function fakeElement(tag = "div", id = "") {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    id,
    style: {},
    dataset: {},
    classList: makeClassList(),
    children: [],
    textContent: "",
    innerHTML: "",
    width: 200,
    height: 200,
    complete: true,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: () => {},
    emit: (t, e) => (listeners[t] || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {}, ...e })),
    appendChild: (c) => { el.children.push(c); return c; },
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 136, height: 136 }),
    getContext: (kind) => (kind === "2d" ? Object.assign(fake2d(), { canvas: el }) : null),
    requestPointerLock: () => { globalThis.document.pointerLockElement = el; },
    setPointerCapture: () => {},
    setAttribute: () => {},
    get offsetWidth() { return 100; },
    getBoundingClientRect2() { return null; },
  };
  return el;
}

const elements = new Map();
const button = () => {
  const b = fakeElement("button");
  b.dataset.btn = "fire";
  return b;
};
const touchButtons = [button(), button(), button(), button()];

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.devicePixelRatio = 2;
globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const winListeners = {};
globalThis.addEventListener = (t, fn) => { (winListeners[t] ||= []).push(fn); };
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.location = { search: "" };
globalThis.alert = () => {};
// capture console errors without recursing into ourselves
const realConsoleError = console.error.bind(console);
console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); realConsoleError(...a); };

// a frame budget keeps the render loop from spinning forever
let frames = 0;
const MAX_FRAMES = 12;
globalThis.requestAnimationFrame = (fn) => {
  if (frames++ > MAX_FRAMES) return 0;
  return setTimeout(() => fn(performance.now()), 0);
};
globalThis.cancelAnimationFrame = clearTimeout;

const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
  writable: true,
  configurable: true,
});

globalThis.__lhFatal = (message, detail) => fatalCalls.push({ message, detail });
globalThis.__lhMarkStarted = () => { globalThis.__marked = true; };

globalThis.document = {
  createElement: (tag) => fakeElement(tag),
  createElementNS: (ns, tag) => fakeElement(tag),
  getElementById: (id) => {
    if (!elements.has(id)) {
      const isCanvas = ["view", "minimap", "speedo-canvas"].includes(id);
      elements.set(id, fakeElement(isCanvas ? "canvas" : "div", id));
    }
    return elements.get(id);
  },
  querySelectorAll: (sel) => (sel.includes("data-btn") ? touchButtons : []),
  addEventListener: () => {},
  removeEventListener: () => {},
  body: fakeElement("body"),
  hidden: false,
  pointerLockElement: null,
  exitPointerLock: () => { globalThis.document.pointerLockElement = null; },
};

// ------------------------------------------------------------------- the test
console.log("booting the real module in a working environment …");

let threw = null;
try {
  await import("../src/main.js");
} catch (err) {
  threw = err;
}

if (threw) {
  fail(`module failed to load: ${threw.constructor.name}: ${threw.message}`);
  if (/is not defined/.test(threw.message)) {
    fail("a name is used but never imported — check the import list of main.js");
  }
}

if (!globalThis.__marked) fail("module never reached its start marker");

if (fatalCalls.length) {
  fail(`fatal reported: ${fatalCalls.map((c) => c.message).join(" | ")}`);
}

// give boot() and a few frames a chance to run
await new Promise((r) => setTimeout(r, 120));

const loading = elements.get("loading");
const start = elements.get("start");
if (loading && !loading.classList.contains("hidden")) {
  fail("loading overlay is still visible — this is the endless loading screen");
}
if (start && start.classList.contains("hidden")) {
  fail("start menu never appeared");
}

const renderer = elements.get("view");
if (!renderer) fail("canvas element missing");

const importantErrors = consoleErrors.filter((e) => !/WebGL|THREE\.WebGLRenderer/.test(e));
if (importantErrors.length) fail(`console errors: ${importantErrors.slice(0, 3).join(" | ")}`);

console.log(`  frames rendered: ${Math.min(frames, MAX_FRAMES)}`);
console.log(`  loading overlay hidden: ${loading ? loading.classList.contains("hidden") : "n/a"}`);
console.log(`  start menu visible: ${start ? !start.classList.contains("hidden") : "n/a"}`);

console.log("");
if (failures) {
  console.error(`${failures} boot failure(s)`);
  process.exit(1);
}
console.log("boot-success OK: real main.js reaches the start menu, no fatal, no console errors");
