/* Boots the real src/main.js in a hostile environment and asserts that the
   failure is reported to the player instead of leaving a frozen loading bar.

   The environment has: a throwing localStorage, a canvas without WebGL and no
   pointer lock. Under the old code this combination produced an endless loading
   screen with nothing in the console.

   Run:  node test/boot-fatal.mjs
*/

let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };

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

function fakeElement(tag = "div") {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    classList: makeClassList(),
    children: [],
    textContent: "",
    innerHTML: "",
    width: 300,
    height: 150,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: () => {},
    appendChild: (c) => { el.children.push(c); return c; },
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => null, // <- no WebGL / no 2D
    requestPointerLock: () => {},
    setPointerCapture: () => {},
    setAttribute: () => {},
  };
  return el;
}

const elements = new Map();
const fatalCalls = [];

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.location = { search: "" };
globalThis.alert = () => {};

// the hostile bit: storage throws the way a sandboxed iframe does
Object.defineProperty(globalThis, "localStorage", {
  get() {
    throw new Error("SecurityError: The operation is insecure.");
  },
  configurable: true,
});

// the inline handler from index.html, captured
globalThis.__lhFatal = (message, detail) => fatalCalls.push({ message, detail });
globalThis.__lhMarkStarted = () => { globalThis.__marked = true; };

globalThis.document = {
  createElement: (tag) => fakeElement(tag),
  createElementNS: (ns, tag) => fakeElement(tag),
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, fakeElement(id === "minimap" ? "canvas" : "div"));
    return elements.get(id);
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelectorAll: () => [],
  body: fakeElement("body"),
  hidden: false,
  pointerLockElement: null,
  exitPointerLock: () => {},
};
globalThis.HTMLCanvasElement = class {};

// ------------------------------------------------------------------- the test
console.log("booting the real module without WebGL and without storage …");

let thrown = null;
try {
  await import("../src/main.js");
} catch (err) {
  thrown = err;
}

if (!globalThis.__marked) {
  fail("module did not reach its start marker (the watchdog would fire in the browser)");
} else {
  console.log("  module reached its start marker");
}

if (!thrown) {
  console.log("  module imported without throwing (a renderer stub was accepted)");
} else {
  console.log(`  module threw as expected: ${thrown.message.slice(0, 70)}`);
}

if (fatalCalls.length === 0) {
  fail("failure was not reported to the player — this is exactly the frozen-loading-screen bug");
} else {
  const msg = fatalCalls[0].message;
  console.log(`  reported: "${msg.slice(0, 80)}…"`);
  if (!/webgl/i.test(msg)) fail(`reported message does not mention WebGL: ${msg}`);
}

// the storage wrapper must not have thrown before the renderer guard
const storageThrown = fatalCalls.some((c) => /SecurityError|insecure/i.test(c.message));
if (storageThrown) fail("storage access leaked out as a fatal error instead of being handled");

console.log("");
if (failures) {
  console.error(`${failures} boot-fatal failure(s)`);
  process.exit(1);
}
console.log("boot-fatal OK: hostile environment produces a visible error, never a silent hang");
