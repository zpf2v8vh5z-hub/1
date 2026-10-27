/* Touch controls test: drives the real TouchControls class with fake DOM
   elements and simulated pointer events. Catches dead zones, sticky buttons and
   inverted axes without needing a phone.

   Run:  node test/touch.mjs
*/
import { TouchControls, prefersTouch } from "../src/touch.js";

let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };

// ------------------------------------------------------------------ fake DOM
function fakeElement({ classes = [], data = {} } = {}) {
  const listeners = {};
  const el = {
    classList: {
      _set: new Set(classes),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { (on === undefined ? !this._set.has(c) : on) ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    dataset: data,
    style: {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() { return { left: 100, top: 100, width: 136, height: 136 }; },
    querySelectorAll() { return []; },
    closest() { return null; },
    emit(type, event) {
      const base = { preventDefault() {}, stopPropagation() {}, pointerId: 1, target: el };
      for (const fn of listeners[type] || []) fn({ ...base, ...event });
    },
    _listeners: listeners,
  };
  return el;
}

const stick = fakeElement();
const knob = fakeElement();
const fireBtn = fakeElement({ data: { btn: "fire" } });
const root = fakeElement();
root.querySelectorAll = () => [];
const lookSurface = fakeElement();

globalThis.document = {
  getElementById: (id) => (id === "touch-look" ? lookSurface : null),
  body: { classList: fakeElement().classList },
};
globalThis.location = { search: "" };
// node exposes navigator as getter-only; define our own for the detection test
Object.defineProperty(globalThis, "navigator", {
  value: { maxTouchPoints: 0 },
  writable: true,
  configurable: true,
});
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

const actions = [];
const touch = new TouchControls({
  root,
  stick,
  knob,
  buttons: [fireBtn],
  onAction: (name, phase) => actions.push(`${name}:${phase}`),
});

// --------------------------------------------------------------- enable state
console.log("test 1: disabled controls ignore input");
{
  touch.emit = null;
  stick.emit("pointerdown", { clientX: 100 + 130, clientY: 100 + 68 });
  if (touch.axis.x !== 0) fail("axis moved while disabled");
  if (!root.classList.contains("hidden") === false) {
    // root starts visible in this fake; setEnabled(false) must hide it
  }
  touch.setEnabled(false);
  if (!root.classList.contains("hidden")) fail("root not hidden when disabled");
  console.log("  no movement while disabled");
}

// ------------------------------------------------------------------- joystick
console.log("test 2: joystick axis and dead zone");
{
  touch.setEnabled(true);
  // dead centre
  stick.emit("pointerdown", { clientX: 168, clientY: 168, pointerId: 1 });
  if (touch.axis.x !== 0 || touch.axis.y !== 0) fail(`dead zone broken: ${touch.axis.x},${touch.axis.y}`);

  // full right: centre is 168,168 with half-width 68 -> clientX 236 is the edge
  stick.emit("pointermove", { clientX: 236, clientY: 168, pointerId: 1 });
  if (!(touch.axis.x > 0.9)) fail(`right push not registered: ${touch.axis.x}`);

  // slight push inside the dead zone
  stick.emit("pointermove", { clientX: 172, clientY: 168, pointerId: 1 });
  if (touch.axis.x !== 0) fail(`dead zone should zero a 4px push, got ${touch.axis.x}`);

  // up (negative Y) = forward on the game side
  stick.emit("pointermove", { clientX: 168, clientY: 100, pointerId: 1 });
  if (!(touch.axis.y < -0.9)) fail(`up push not registered: ${touch.axis.y}`);

  // release resets
  stick.emit("pointerup", { pointerId: 1 });
  if (touch.axis.x !== 0 || touch.axis.y !== 0) fail("axis not reset on release");
  console.log("  axis, dead zone and release OK");
}

// -------------------------------------------------------------------- buttons
console.log("test 3: action buttons hold and fire once");
{
  fireBtn.emit("pointerdown", { pointerId: 2 });
  if (!touch.held("fire")) fail("fire not held after press");
  if (!fireBtn.classList.contains("active")) fail("button not highlighted");
  fireBtn.emit("pointerup", { pointerId: 2 });
  if (touch.held("fire")) fail("fire still held after release");
  const presses = actions.filter((a) => a === "fire:press").length;
  if (presses !== 1) fail(`expected exactly one press action, got ${presses}`);
  console.log(`  actions: ${actions.join(", ")}`);
}

// ---------------------------------------------------------------- look delta
console.log("test 4: look drag accumulates and is consumed once");
{
  lookSurface.emit("pointerdown", { clientX: 500, clientY: 300, pointerId: 3 });
  lookSurface.emit("pointermove", { clientX: 530, clientY: 290, pointerId: 3 });
  const look = touch.takeLook();
  if (look.dx !== 30 || look.dy !== -10) fail(`look delta wrong: ${look.dx},${look.dy}`);
  const again = touch.takeLook();
  if (again.dx !== 0 || again.dy !== 0) fail("look delta not cleared after consuming");
  console.log(`  dx=${look.dx} dy=${look.dy}, consumed once`);
}

// -------------------------------------------------------------- disable reset
console.log("test 5: disabling clears held buttons");
{
  fireBtn.emit("pointerdown", { pointerId: 4 });
  touch.setEnabled(false);
  if (touch.held("fire")) fail("button stayed held after disabling touch");
  if (!root.classList.contains("hidden")) fail("touch UI still visible after disabling");
  console.log("  buttons released, ui hidden");
}

// ------------------------------------------------------------ auto detection
console.log("test 6: device detection");
{
  const saved = globalThis.navigator;
  // node exposes navigator as getter-only; define our own for the detection test
Object.defineProperty(globalThis, "navigator", {
  value: { maxTouchPoints: 0 },
  writable: true,
  configurable: true,
});
  globalThis.location = { search: "" };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  if (prefersTouch()) fail("desktop wrongly detected as touch");

  globalThis.location = { search: "?touch=1" };
  if (!prefersTouch()) fail("?touch=1 override ignored");

  globalThis.location = { search: "?touch=0" };
  if (prefersTouch()) fail("?touch=0 override ignored");

  globalThis.location = { search: "" };
  Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 5 }, writable: true, configurable: true });
  if (!prefersTouch()) fail("touch device not detected");
  Object.defineProperty(globalThis, "navigator", { value: saved, writable: true, configurable: true });
  console.log("  overrides and touch detection OK");
}

console.log("");
if (failures) {
  console.error(`${failures} touch failure(s)`);
  process.exit(1);
}
console.log("touch controls OK: dead zone, axes, buttons, look drag, reset, detection");
