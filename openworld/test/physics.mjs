/* Vehicle handling + collision tests, headless.
   Run:  node test/physics.mjs  */
import * as THREE from "three";
import { buildColliderGrid, resolveCircle, pointBlocked } from "../src/physics.js";
import { Vehicle } from "../src/vehicle.js";

// Vehicle needs a scene to add its mesh to; a bare object is enough here.
const fakeScene = { add() {}, remove() {} };

let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const grid = buildColliderGrid([]);
const bounds = { min: -400, max: 400 };
const dt = 1 / 60;

function drive(seconds, controls, car) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) car.update(dt, controls, grid, bounds);
}

// --- acceleration -----------------------------------------------------------
const car = new Vehicle(fakeScene, { color: 0xff0000 });
car.setPosition(0, 0, 0);
drive(6, { throttle: 1 }, car);
const topSpeed = car.speed;
console.log(`top speed after 6 s full throttle: ${car.speedKmh.toFixed(0)} km/h`);
if (topSpeed < 30) fail(`car accelerates too slowly (${topSpeed.toFixed(1)} m/s)`);
if (topSpeed > 46) fail(`car exceeds sane top speed (${topSpeed.toFixed(1)} m/s)`);
if (car.pos.z < 40) fail(`car barely moved (z=${car.pos.z.toFixed(1)})`);

// --- braking ----------------------------------------------------------------
const before = car.speed;
drive(2, { brake: 1 }, car);
console.log(`speed after 2 s braking: ${car.speedKmh.toFixed(0)} km/h`);
if (car.speed > before * 0.5) fail("brakes are too weak");

// --- reverse from a standstill ---------------------------------------------
const car2 = new Vehicle(fakeScene, {});
car2.setPosition(0, 0, 0);
drive(2.5, { brake: 1 }, car2);
console.log(`reverse speed: ${(car2.vel.dot(new THREE.Vector3(Math.sin(car2.yaw), 0, Math.cos(car2.yaw)))).toFixed(1)} m/s`);
if (car2.pos.z > -2) fail("car does not reverse");

// --- steering DIRECTION: D (steer +1) must turn towards screen-right --------
// With a camera looking along +Z, screen-right is world -X.
{
  const c = new Vehicle(fakeScene, {});
  c.setPosition(0, 0, 0); // yaw 0 -> forward is +Z
  drive(1.2, { throttle: 1 }, c);
  const x0 = c.pos.x;
  drive(1.2, { throttle: 1, steer: 1 }, c); // "D"
  const dxRight = c.pos.x - x0;
  console.log(`pressing D moved x by ${dxRight.toFixed(2)} m (must be negative = screen right)`);
  if (!(dxRight < -0.5)) fail(`steering inverted: D moved x by ${dxRight.toFixed(2)}`);
}
{
  const c = new Vehicle(fakeScene, {});
  c.setPosition(0, 0, 0);
  drive(1.2, { throttle: 1 }, c);
  const x0 = c.pos.x;
  drive(1.2, { throttle: 1, steer: -1 }, c); // "A"
  const dxLeft = c.pos.x - x0;
  console.log(`pressing A moved x by ${dxLeft.toFixed(2)} m (must be positive = screen left)`);
  if (!(dxLeft > 0.5)) fail(`steering inverted: A moved x by ${dxLeft.toFixed(2)}`);
}

// --- steering actually turns ------------------------------------------------
const car3 = new Vehicle(fakeScene, {});
car3.setPosition(0, 0, 0);
drive(1.5, { throttle: 1 }, car3);
const yawBefore = car3.yaw;
drive(1.5, { throttle: 1, steer: 1 }, car3);
const turned = Math.abs(car3.yaw - yawBefore);
console.log(`heading change in 1.5 s of full steering: ${(turned * 180 / Math.PI).toFixed(0)}°`);
if (turned < 0.35) fail("steering is unresponsive");
if (turned > 3.2) fail("steering is twitchy");

// --- handbrake produces more slip than normal grip ---------------------------
function slipTest(handbrake) {
  const c = new Vehicle(fakeScene, {});
  c.setPosition(0, 0, 0);
  drive(3, { throttle: 1 }, c);
  const forward = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
  // kick the heading the same way the steering will turn (steer +1 lowers yaw)
  c.yaw -= 0.5;
  drive(0.5, { throttle: 1, steer: 1, handbrake }, c);
  const f2 = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
  const along = Math.abs(c.vel.dot(f2));
  const lateral = Math.sqrt(Math.max(0, c.vel.lengthSq() - along * along));
  return lateral / Math.max(0.001, c.vel.length());
}
const gripSlip = slipTest(false);
const driftSlip = slipTest(true);
console.log(`lateral slip: grip ${(gripSlip * 100).toFixed(1)}%  handbrake ${(driftSlip * 100).toFixed(1)}%`);
if (!(driftSlip > gripSlip)) fail("handbrake does not increase slip");

// --- collisions: drive into a wall -----------------------------------------
const walls = buildColliderGrid([
  { minX: 20, maxX: 60, minZ: -50, maxZ: 50, height: 40 },
]);
const car4 = new Vehicle(fakeScene, {});
car4.setPosition(0, 0, 0);
const startYaw = car4.yaw;
car4.yaw = Math.PI / 2; // face +x, straight at the wall
for (let i = 0; i < 60 * 6; i++) car4.update(dt, { throttle: 1 }, walls, bounds);
console.log(`wall test: x=${car4.pos.x.toFixed(2)} speed=${car4.speedKmh.toFixed(0)} km/h health=${car4.health.toFixed(0)}`);
if (car4.pos.x > 20) fail("car penetrated the building");
if (car4.health >= 100) fail("crashing into a wall caused no damage");

// --- circle push-out keeps a pedestrian out of a building -------------------
const pos = { x: 19.8, z: 0 }; // overlapping the wall face at x=20
const hit = resolveCircle(walls, pos, 0.4);
console.log(`circle push-out: hit=${hit} x=${pos.x.toFixed(2)}`);
if (!hit) fail("resolveCircle missed a clear overlap");
if (pointBlocked(walls, pos.x, pos.z, 0)) fail("pushed-out point is still inside the wall");

// --- on foot: camera-relative movement --------------------------------------
{
  const { Player } = await import("../src/characters.js");
  const player = new Player(fakeScene);
  player.setPosition(0, 0);
  const input = { forward: 0, right: 1, run: false, jump: false, camYaw: 0, aiming: false };
  for (let i = 0; i < 60; i++) player.update(dt, input, grid, bounds);
  console.log(`on foot, D pressed, camYaw 0: x=${player.pos.x.toFixed(2)} (must be negative = screen right)`);
  if (!(player.pos.x < -0.8)) fail(`on-foot movement inverted: x=${player.pos.x.toFixed(2)}`);

  const player2 = new Player(fakeScene);
  player2.setPosition(0, 0);
  for (let i = 0; i < 60; i++) player2.update(dt, { ...input, right: -1 }, grid, bounds);
  if (!(player2.pos.x > 0.8)) fail(`on-foot A inverted: x=${player2.pos.x.toFixed(2)}`);

  const player3 = new Player(fakeScene);
  player3.setPosition(0, 0);
  for (let i = 0; i < 60; i++) player3.update(dt, { ...input, right: 0, forward: 1 }, grid, bounds);
  console.log(`on foot, W pressed: z=${player3.pos.z.toFixed(2)} (must be positive)`);
  if (!(player3.pos.z > 0.8)) fail(`on-foot forward inverted: z=${player3.pos.z.toFixed(2)}`);
}

console.log("");
if (failures) {
  console.error(`${failures} physics failure(s)`);
  process.exit(1);
}
console.log("vehicle physics OK: acceleration, braking, reverse, steering, drift, collisions");
