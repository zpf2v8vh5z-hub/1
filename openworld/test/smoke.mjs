/* Headless smoke test: builds the whole game (city, world, characters, cars,
   traffic, police, effects) with a fake DOM and simulates a few thousand
   frames of gameplay. Catches runtime errors that a syntax check cannot.

   Run:  node test/smoke.mjs
*/

// ------------------------------------------------------------------ fake DOM
class FakeImage {
  constructor() {
    this.width = 512;
    this.height = 512;
    this.listeners = {};
    this.complete = false;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener() {}
  get src() {
    return this._src;
  }
  set src(v) {
    this._src = v;
    setTimeout(() => {
      this.complete = true;
      for (const fn of this.listeners.load || []) fn({ target: this });
      if (this.onload) this.onload({ target: this });
    }, 0);
  }
}

class FakeContext2D {
  constructor() { this.canvas = null; this.calls = 0; }
  setTransform() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  beginPath() {}
  arc() {}
  ellipse() {}
  clip() {}
  fill() {}
  stroke() {}
  fillRect() {}
  strokeRect() {}
  clearRect() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  drawImage() {}
  fillText() {}
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  measureText() { return { width: 10 }; }
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData() {}
}

class FakeCanvas {
  constructor() {
    this.width = 300;
    this.height = 150;
    this.style = {};
    this._ctx = new FakeContext2D();
    this._ctx.canvas = this;
  }
  getContext() { return this._ctx; }
  addEventListener() {}
  removeEventListener() {}
  requestPointerLock() {}
  toDataURL() { return ""; }
}

const elements = new Map();
function makeElement(tag) {
  if (tag === "canvas") return new FakeCanvas();
  if (tag === "img") return new FakeImage();
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    classList: {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      toggle(c, on) { (on === undefined ? !this._set.has(c) : on) ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    children: [],
    dataset: {},
    innerHTML: "",
    textContent: "",
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return makeElement("div"); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    get offsetWidth() { return 100; },
  };
  return el;
}

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = "running"; }
  createGain() { return { gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() { return this; } }; }
  createOscillator() { return { type: "", frequency: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this; }, start() {}, stop() {} }; }
  createBiquadFilter() { return { type: "", frequency: { value: 0, setValueAtTime() {}, setTargetAtTime() {} }, Q: { value: 0 }, connect() { return this; } }; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return { buffer: null, connect() { return this; }, start() {} }; }
  resume() {}
  get destination() { return { connect() {} }; }
};

globalThis.document = {
  createElement: (tag) => makeElement(tag),
  createElementNS: (ns, tag) => makeElement(tag),
  getElementById: (id) => {
    const canvasIds = ["minimap", "speedo-canvas"];
    if (!elements.has(id)) elements.set(id, makeElement(canvasIds.includes(id) ? "canvas" : "div"));
    return elements.get(id);
  },
  addEventListener() {},
  removeEventListener() {},
  exitPointerLock() {},
  pointerLockElement: null,
  body: makeElement("body"),
  hidden: false,
};

globalThis.HTMLCanvasElement = FakeCanvas;

// ------------------------------------------------------------------ harness
let failures = 0;
const fail = (msg) => { console.error("FAIL:", msg); failures++; };

const THREE = await import("three");
const { generateCity, toWorld } = await import("../src/city.js");
const { buildWorld } = await import("../src/world.js");
const { Player } = await import("../src/characters.js");
const { Vehicle } = await import("../src/vehicle.js");
const { Traffic } = await import("../src/traffic.js");
const { Police } = await import("../src/police.js");
const { Effects } = await import("../src/effects.js");
const { GameAudio } = await import("../src/audio.js");
const { HUD } = await import("../src/hud.js");
const { pointBlocked } = await import("../src/physics.js");

// three needs a canvas to derive texture parameters in some paths
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.1, 2000);

function fakeTextureSet() {
  const t = {};
  for (const name of ["asphalt", "sidewalk", "facade-glass", "facade-concrete", "facade-brick", "grass"]) {
    t[name] = new THREE.Texture(new FakeImage());
    t[name].needsUpdate = true;
    t[name + "_n"] = new THREE.Texture(new FakeImage());
    t[name + "_n"].needsUpdate = true;
  }
  return t;
}

console.log("building city …");
const city = generateCity(424242);
console.log(`  ${city.buildings.length} buildings, ${city.trees.length} trees, ${city.lamps.length} lamps`);

console.log("building world …");
const world = buildWorld(scene, city, fakeTextureSet());
if (!world.grid || world.grid.boxes.length !== city.buildings.length) fail("collider grid mismatch");
console.log(`  scene children: ${scene.children.length}`);

// count draw-call-ish objects
let meshes = 0;
let instanced = 0;
scene.traverse((o) => {
  if (o.isInstancedMesh) instanced++;
  else if (o.isMesh) meshes++;
});
console.log(`  meshes: ${meshes} (+${instanced} instanced)`);
if (meshes > 60) fail(`too many meshes for a smooth frame: ${meshes}`);

console.log("spawning entities …");
const player = new Player(scene);
player.setPosition(city.spawn.x, city.spawn.z);

const traffic = new Traffic(scene, city, 987);
const effects = new Effects(scene);
const audio = new GameAudio();

let damageTaken = 0;
const police = new Police(scene, city, world.grid, {
  onPlayerDamage: (n) => { damageTaken += n; player.damage(n); },
  effects,
  audio,
});

const hud = new HUD(city);
console.log(`  traffic cars: ${traffic.cars.length}, peds: ${traffic.peds.length}`);

// ------------------------------------------------------------- simulation
console.log("simulating 2400 frames (40 s of play) …");
const dt = 1 / 60;
let shots = 0;
let crimesCommitted = 0;

for (let frame = 0; frame < 2400; frame++) {
  // wander around, sprint sometimes
  const t = frame * dt;
  const input = {
    forward: Math.sin(t * 0.6) > -0.3 ? 1 : -1,
    right: Math.sin(t * 0.9),
    run: frame % 300 < 90,
    jump: frame % 200 === 0,
    camYaw: t * 0.3,
    aiming: false,
  };
  player.update(dt, input, world.grid, city.bounds);
  player.mesh.position.copy(player.pos);

  traffic.update(dt, player.pos);
  police.update(dt, player, true);
  effects.update(dt);

  if (frame === 120) {
    // commit some crimes so the pursuit kicks in
    for (let i = 0; i < 3; i++) { police.addCrime(1, player.pos); crimesCommitted++; }
  }
  if (frame === 400) {
    // fire a few tracers for the effect system
    for (let i = 0; i < 5; i++) {
      effects.tracer(camera.position, player.pos.clone().setY(1), 0xffe3a8);
      effects.muzzle(camera.position);
      shots++;
    }
  }
  if (frame === 800) {
    // steal a car and drive it
    const car = new Vehicle(scene, { color: 0x2f4f7a });
    car.setPosition(player.pos.x + 2, player.pos.z, 1.2);
    let hitWall = false;
    for (let f = 0; f < 900; f++) {
      car.update(dt, { throttle: 1, brake: 0, steer: Math.sin(f * 0.02), handbrake: f % 120 > 100, boost: true }, world.grid, city.bounds);
      if (pointBlocked(world.grid, car.pos.x, car.pos.z, 1.4)) hitWall = true;
    }
    if (hitWall) fail("car ended up inside a building");
    if (car.speed > car.maxSpeed * 1.02) fail(`car exceeded max speed: ${car.speed.toFixed(1)}`);
    console.log(`  after 15 s of driving: ${car.speedKmh.toFixed(0)} km/h, health ${car.health.toFixed(0)}`);
  }
}

if (damageTaken <= 0) fail("police never dealt damage — pursuit AI may be broken");
if (police.cars.length > 4) fail("too many police cars");
console.log(`  damage taken: ${damageTaken.toFixed(0)}, wanted: ${police.wanted}, cops: ${police.cars.length} cars / ${police.units.length} units`);

// hud calls with a realistic state payload
console.log("exercising HUD …");
hud.update(dt, {
  pos: player.pos,
  yaw: 0.4,
  health: player.health,
  wanted: police.wanted,
  inVehicle: false,
  speedKmh: 42,
  alive: true,
  clockMinutes: 7,
  peds: traffic.peds,
  trafficCars: traffic.cars,
  parked: [],
  copCars: police.cars,
  copUnits: police.units,
  driverVehicle: null,
});
hud.setAmmo(3, 20, true);
hud.setWanted(4);
hud.setPrompt("<kbd>F</kbd> test");
hud.hitMarker();
hud.flashDamage();
hud.drawSpeedo(120);
hud.hide();
hud.show();

// sanity: nothing escaped the world
const b = city.bounds;
if (player.pos.x < b.min - 5 || player.pos.x > b.max + 5) fail("player left the world in x");
if (player.pos.z < b.min - 5 || player.pos.z > b.max + 5) fail("player left the world in z");

console.log("");
if (failures) {
  console.error(`${failures} smoke-test failure(s)`);
  process.exit(1);
}
console.log("smoke test passed: world builds, 40 s of gameplay simulated, no runtime errors");
