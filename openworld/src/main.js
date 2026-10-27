/* Liberty Heights — open-world sandbox.
   three.js scene, city generation, third-person controller, vehicles,
   traffic, police pursuit, shooting and the HUD loop. */

import * as THREE from "three";
import { generateCity, toWorld, CELL, ROAD_W, N_BLOCKS, BLOCK_S, WORLD_SIZE } from "./city.js";
import { loadWorldTextures, buildWorld } from "./world.js";
import { Player, angleDelta } from "./characters.js";
import { Vehicle, CAR_COLORS } from "./vehicle.js";
import { Traffic } from "./traffic.js";
import { Police } from "./police.js";
import { Effects } from "./effects.js";
import { GameAudio } from "./audio.js";
import { HUD } from "./hud.js";
import { pointBlocked } from "./physics.js";

// ------------------------------------------------------------------ DOM handles
const canvas = document.getElementById("view");
const loadingEl = document.getElementById("loading");
const loadFill = document.getElementById("load-fill");
const loadText = document.getElementById("load-text");
const startEl = document.getElementById("start");
const pauseEl = document.getElementById("pause");
const deadEl = document.getElementById("dead");

// -------------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 2200);

const audio = new GameAudio();
const effects = new Effects(scene);

// ------------------------------------------------------------------ game state
const G = {
  mode: "loading", // loading | menu | playing | paused | dead
  city: null,
  world: null,
  player: null,
  traffic: null,
  police: null,
  hud: null,
  parked: [],
  driverVehicle: null,
  vehicle: null, // vehicle the player sits in
  cam: { yaw: 0, pitch: 0.26, dist: 6.4, targetDist: 6.4, mouseIdle: 0, shake: 0 },
  weapon: { mag: 12, magSize: 12, reserve: 72, reloading: false, reloadTimer: 0, cooldown: 0, nextCrimeAt: 0 },
  clockMinutes: 2, // starting at 19:44
  elapsed: 0,
  lastDamageAt: -100,
  keys: new Set(),
  mouse: { down: false, aim: false },
  lastShotAt: -10,
  deathTimer: 0,
};

// ---------------------------------------------------------------------- camera
function updateCamera(dt) {
  const target = new THREE.Vector3();
  let desiredYaw = G.cam.yaw;

  if (G.vehicle) {
    target.set(G.vehicle.pos.x, 1.45, G.vehicle.pos.z);
    if (G.cam.mouseIdle > 0.9) {
      // auto-align behind the car while driving
      desiredYaw = G.vehicle.yaw;
      G.cam.yaw += angleDelta(G.cam.yaw, desiredYaw) * Math.min(1, dt * 2.2);
    }
    G.cam.targetDist = G.vehicle.speed > 18 ? 9.5 : 8.2;
  } else if (G.player) {
    target.set(G.player.pos.x, G.player.pos.y + 1.55, G.player.pos.z);
    G.cam.targetDist = G.mouse.aim ? 3.8 : 6.0;
  }

  G.cam.dist += (G.cam.targetDist - G.cam.dist) * Math.min(1, dt * 4);
  const pitch = G.cam.pitch;
  const cosP = Math.cos(pitch);

  let dist = G.cam.dist;
  const dir = new THREE.Vector3(
    -Math.sin(G.cam.yaw) * cosP,
    Math.sin(pitch),
    -Math.cos(G.cam.yaw) * cosP
  ).normalize();

  // pull the camera in when a wall would swallow it
  if (G.world) {
    for (let i = 0; i < 12; i++) {
      const px = target.x + dir.x * dist;
      const pz = target.z + dir.z * dist;
      if (!pointBlocked(G.world.grid, px, pz, 0.4)) break;
      dist *= 0.82;
      if (dist < 1.6) break;
    }
  }

  const desired = new THREE.Vector3(
    target.x + dir.x * dist,
    Math.max(0.85, target.y + dir.y * dist),
    target.z + dir.z * dist
  );

  if (G.cam.shake > 0) {
    desired.x += (Math.random() - 0.5) * G.cam.shake * 0.14;
    desired.y += (Math.random() - 0.5) * G.cam.shake * 0.14;
    G.cam.shake = Math.max(0, G.cam.shake - dt * 5);
  }

  camera.position.lerp(desired, Math.min(1, dt * 12));
  camera.lookAt(target);

  const targetFov = G.mouse.aim && !G.vehicle ? 48 : G.vehicle ? 70 : 64;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------- vehicles
function spawnParkedVehicles() {
  const rng = Math.random;
  G.parked = [];
  const addAt = (x, z, yaw) => {
    if (pointBlocked(G.world.grid, x, z, 2.2)) return null;
    const v = new Vehicle(scene, { color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)] });
    v.setPosition(x, z, yaw);
    G.parked.push(v);
    return v;
  };

  // one right next to the spawn so the player can drive immediately
  const spawn = G.city.spawn;
  addAt(spawn.x + 5, spawn.z + 1, Math.PI / 2);
  addAt(spawn.x - 6, spawn.z - 8, 0);

  for (let i = 0; i < 12; i++) {
    const idx = Math.floor(rng() * (N_BLOCKS + 1));
    const centre = toWorld(idx * CELL + ROAD_W / 2);
    const along = toWorld(rng() * WORLD_SIZE);
    if (rng() < 0.5) addAt(along, centre + (rng() < 0.5 ? -6.5 : 6.5), rng() < 0.5 ? 0 : Math.PI);
    else addAt(centre + (rng() < 0.5 ? -6.5 : 6.5), along, rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
  }
}

function nearestVehicle(maxDist = 4.2) {
  let best = null;
  let bestD = maxDist;
  for (const v of G.parked) {
    const d = Math.hypot(v.pos.x - G.player.pos.x, v.pos.z - G.player.pos.z);
    if (d < bestD) { best = v; bestD = d; }
  }
  let bestTraffic = null;
  for (const c of G.traffic.cars) {
    const d = Math.hypot(c.mesh.position.x - G.player.pos.x, c.mesh.position.z - G.player.pos.z);
    if (d < bestD) { bestTraffic = c; bestD = d; }
  }
  return { vehicle: best, traffic: bestTraffic };
}

function enterVehicle() {
  const { vehicle, traffic } = nearestVehicle();
  if (!vehicle && !traffic) return;

  let target = vehicle;
  if (!target && traffic) {
    // steal an AI car: promote it to a fully simulated vehicle
    target = new Vehicle(scene, { color: traffic.color });
    target.setPosition(traffic.mesh.position.x, traffic.mesh.position.z, traffic.mesh.rotation.y);
    G.parked.push(target);
    G.traffic.removeCar(traffic);
  }

  G.vehicle = target;
  G.vehicle.driver = "player";
  G.player.mesh.visible = false;
  G.cam.dist = 8;
  G.cam.targetDist = 8;
  G.cam.yaw = target.yaw;
  audio.setEngine(true, 0, 0);
  G.hud.setCrosshair(false);
  G.hud.setCarHint("F — Aussteigen · Leertaste — Handbremse");
}

function exitVehicle() {
  if (!G.vehicle) return;
  const v = G.vehicle;
  v.driver = null;
  v.vel.multiplyScalar(0.2);
  G.vehicle = null;

  // step out on the driver's side, nudged out of any geometry
  const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw)).multiplyScalar(2.1);
  const p = { x: v.pos.x + side.x, z: v.pos.z + side.z };
  G.player.setPosition(p.x, p.z);
  G.player.mesh.visible = true;
  G.player.pos.x = p.x;
  G.player.pos.z = p.z;
  G.hud.setCarHint("");
  audio.setEngine(false, 0, 0);
}

// -------------------------------------------------------------------- shooting
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);

function tagEntities() {
  for (const p of G.traffic.peds) if (!p.mesh.userData.entity) p.mesh.userData.entity = { kind: "ped", ref: p };
  for (const u of G.police.units) if (!u.mesh.userData.entity) u.mesh.userData.entity = { kind: "cop", ref: u };
  for (const c of G.traffic.cars) if (!c.mesh.userData.entity) c.mesh.userData.entity = { kind: "traffic", ref: c };
  for (const v of G.parked) if (!v.mesh.userData.entity) v.mesh.userData.entity = { kind: "car", ref: v };
  for (const c of G.police.cars) if (!c.mesh.userData.entity) c.mesh.userData.entity = { kind: "police", ref: c };
}

function findEntity(object) {
  let o = object;
  while (o) {
    if (o.userData && o.userData.entity) return o.userData.entity;
    o = o.parent;
  }
  return null;
}

function shoot() {
  if (G.mode !== "playing" || G.vehicle || !G.player.alive) return;
  const w = G.weapon;
  if (w.reloading || w.cooldown > 0) return;
  if (w.mag <= 0) {
    startReload();
    return;
  }

  w.mag--;
  w.cooldown = 0.15;
  G.lastShotAt = G.elapsed;
  audio.gunshot(1);
  G.cam.shake = 2.2;
  G.cam.pitch = Math.min(0.95, G.cam.pitch + 0.006);

  const muzzle = camera.position
    .clone()
    .add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(1.1))
    .add(new THREE.Vector3(0.15, -0.12, 0));
  effects.muzzle(muzzle);
  effects.burst(muzzle, { color: 0xffd08a, speed: 3, life: 0.16, size: 0.5, gravity: 0 }, 3);

  tagEntities();
  const targets = [G.world.root];
  for (const p of G.traffic.peds) if (!p.dead) targets.push(p.mesh);
  for (const u of G.police.units) if (u.alive) targets.push(u.mesh);
  for (const c of G.traffic.cars) targets.push(c.mesh);
  for (const v of G.parked) targets.push(v.mesh);
  for (const c of G.police.cars) targets.push(c.mesh);

  raycaster.setFromCamera(center, camera);
  raycaster.far = 260;
  const hits = raycaster.intersectObjects(targets, true);
  const hit = hits.find((h) => h.distance > 0.6) || null;
  const end = hit ? hit.point.clone() : camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(200));

  effects.tracer(muzzle, end, 0xffe3a8);

  const entity = hit ? findEntity(hit.object) : null;
  if (entity) {
    const point = hit.point;
    switch (entity.kind) {
      case "ped": {
        entity.ref.kill();
        effects.burst(point, { color: 0xa3202a, speed: 6, life: 0.7, size: 0.9, gravity: -12 }, 12);
        G.traffic.scareAt(G.player.pos, 34);
        G.police.addCrime(2, G.player.pos);
        G.hud.hitMarker();
        break;
      }
      case "cop": {
        entity.ref.alive = false;
        entity.ref.mesh.visible = false;
        effects.burst(point, { color: 0xa3202a, speed: 6, life: 0.7, size: 0.9, gravity: -12 }, 10);
        G.police.addCrime(2, G.player.pos);
        G.hud.hitMarker();
        break;
      }
      case "traffic": {
        entity.ref.stunned = 6;
        entity.ref.speed = 0;
        effects.burst(point, { color: 0xffd08a, speed: 7, life: 0.4, size: 0.6, gravity: -8 }, 8);
        G.traffic.scareAt(point, 26);
        G.hud.hitMarker();
        if (G.police.wanted === 0) G.police.addCrime(1, G.player.pos);
        break;
      }
      case "car":
      case "police": {
        const veh = entity.ref;
        veh.damage(32);
        effects.burst(point, { color: 0xffd08a, speed: 7, life: 0.4, size: 0.6, gravity: -8 }, 8);
        G.hud.hitMarker();
        if (entity.kind === "police") G.police.addCrime(1, G.player.pos);
        if (veh.health <= 0) {
          effects.explosion(new THREE.Vector3(veh.pos.x, 1, veh.pos.z));
          audio.impact();
          veh.mesh.visible = false;
        }
        break;
      }
      default:
        break;
    }
  } else if (hit) {
    // environment: dust puff against a wall or the street
    effects.burst(hit.point, { color: 0xb8b2a4, speed: 3.4, life: 0.5, size: 0.55, gravity: -6 }, 6);
  }

  // a shot near people is a crime
  if (G.elapsed > G.weapon.nextCrimeAt) {
    G.weapon.nextCrimeAt = G.elapsed + 9;
    let nearby = false;
    for (const p of G.traffic.peds) {
      if (!p.dead && p.pos.distanceToSquared(G.player.pos) < 30 * 30) { nearby = true; break; }
    }
    if (nearby) G.police.addCrime(1, G.player.pos);
  }

  G.hud.setAmmo(G.weapon.mag, G.weapon.reserve, false);
}

function startReload() {
  const w = G.weapon;
  if (w.reloading || w.mag === w.magSize || w.reserve <= 0) return;
  w.reloading = true;
  w.reloadTimer = 1.4;
  audio.reloadClick();
  G.hud.setAmmo(w.mag, w.reserve, true);
}

function finishReload() {
  const w = G.weapon;
  const need = w.magSize - w.mag;
  const take = Math.min(need, w.reserve);
  w.mag += take;
  w.reserve -= take;
  w.reloading = false;
  G.hud.setAmmo(w.mag, w.reserve, false);
}

// ------------------------------------------------------------------- game flow
function takeDamage(amount) {
  if (G.mode !== "playing" || !G.player.alive) return;
  G.lastDamageAt = G.elapsed;
  G.player.damage(G.vehicle ? amount * 0.55 : amount); // the car body eats some of it
  G.hud.flashDamage();
  G.cam.shake = Math.max(G.cam.shake, 3.5);
  if (!G.player.alive) die();
}

function die() {
  G.mode = "dead";
  audio.setEngine(false, 0, 0);
  audio.siren(0);
  if (document.pointerLockElement) document.exitPointerLock();
  if (G.vehicle) exitVehicle();
  deadEl.classList.remove("hidden");
  G.hud.setPrompt("");
}

function respawn() {
  deadEl.classList.add("hidden");
  G.hud.hide();
  G.police.clearWanted();
  G.player.alive = true;
  G.player.health = G.player.maxHealth;
  G.player.setPosition(G.city.spawn.x, G.city.spawn.z);
  G.player.mesh.visible = true;
  G.weapon.mag = G.weapon.magSize;
  G.weapon.reserve = 72;
  G.weapon.reloading = false;
  G.hud.setAmmo(G.weapon.mag, G.weapon.reserve, false);
  G.hud.show();
  G.mode = "playing";
  canvas.requestPointerLock();
}

function pause() {
  if (G.mode !== "playing") return;
  G.mode = "paused";
  pauseEl.classList.remove("hidden");
  audio.setEngine(false, 0, 0);
  if (document.pointerLockElement) document.exitPointerLock();
}

function resume() {
  if (G.mode !== "paused") return;
  pauseEl.classList.add("hidden");
  G.mode = "playing";
  canvas.requestPointerLock();
}

// ----------------------------------------------------------------------- input
window.addEventListener("keydown", (e) => {
  const k = e.key === " " ? "space" : e.key.toLowerCase();
  if (["w", "a", "s", "d", "space", "shift", "e", "f", "r", "h", "m", "p", "escape", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
    e.preventDefault();
  }
  G.keys.add(k);

  if (G.mode === "playing") {
    if (k === "f" || k === "e") {
      if (G.vehicle) exitVehicle();
      else if (G.player.alive) enterVehicle();
    }
    if (k === "r") startReload();
    if (k === "h" && G.vehicle) audio.horn();
    if (k === "m") {
      audio.setMuted(!audio.muted);
      audio.muted = !audio.muted;
    }
    if (k === "space" && !G.vehicle && G.player.alive) {
      // jumping is handled inside the player update via the key set
    }
    if (k === "escape") pause();
  } else if (G.mode === "paused" && k === "escape") {
    resume();
  }
});
window.addEventListener("keyup", (e) => {
  const k = e.key === " " ? "space" : e.key.toLowerCase();
  G.keys.delete(k);
});
window.addEventListener("blur", () => G.keys.clear());

canvas.addEventListener("mousedown", (e) => {
  if (G.mode !== "playing") return;
  if (!document.pointerLockElement) {
    canvas.requestPointerLock();
    return;
  }
  if (e.button === 0) {
    G.mouse.down = true;
    shoot();
  }
  if (e.button === 2) G.mouse.aim = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) G.mouse.down = false;
  if (e.button === 2) G.mouse.aim = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("mousemove", (e) => {
  if (G.mode !== "playing" || !document.pointerLockElement) return;
  G.cam.yaw += e.movementX * 0.0024;
  G.cam.pitch = THREE.MathUtils.clamp(G.cam.pitch - e.movementY * 0.0019, -0.12, 0.95);
  G.cam.mouseIdle = 0;
});

canvas.addEventListener("wheel", (e) => {
  if (G.mode !== "playing") return;
  G.cam.targetDist = THREE.MathUtils.clamp(G.cam.targetDist + e.deltaY * 0.005, 3, 14);
  e.preventDefault();
}, { passive: false });

document.addEventListener("pointerlockchange", () => {
  if (!document.pointerLockElement && G.mode === "playing") pause();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let fpsAccum = 0;
let fpsFrames = 0;

function updateDriving(dt) {
  const v = G.vehicle;
  const k = G.keys;
  const controls = {
    throttle: k.has("w") || k.has("arrowup") ? 1 : 0,
    brake: k.has("s") || k.has("arrowdown") ? 1 : 0,
    steer: (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0),
    handbrake: k.has("space"),
    boost: k.has("shift"),
  };
  v.update(dt, controls, G.world.grid, G.city.bounds);
  // the player rides along: traffic, police and the minimap all key off this
  G.player.pos.set(v.pos.x, 0, v.pos.z);
  audio.setEngine(true, Math.min(1, v.speed / v.maxSpeed), controls.throttle);

  // running over pedestrians hurts them (and your record)
  if (v.speed > 4) {
    for (const ped of G.traffic.peds) {
      if (ped.dead) continue;
      if (ped.pos.distanceToSquared(v.pos) < 2.4 * 2.4) {
        ped.kill();
        effects.burst(new THREE.Vector3(ped.pos.x, 0.6, ped.pos.z), { color: 0xa3202a, speed: 5, life: 0.6, size: 0.8, gravity: -12 }, 8);
        G.police.addCrime(2, G.player.pos);
        audio.impact();
        v.vel.multiplyScalar(0.92);
      }
    }
  }

  // bump into other cars
  for (const other of G.parked) {
    if (other === v) continue;
    const d = Math.hypot(other.pos.x - v.pos.x, other.pos.z - v.pos.z);
    if (d < 3.1 && d > 0.001) {
      const push = (3.1 - d) / 2;
      const nx = (other.pos.x - v.pos.x) / d;
      const nz = (other.pos.z - v.pos.z) / d;
      other.pos.x += nx * push;
      other.pos.z += nz * push;
      other.mesh.position.set(other.pos.x, 0, other.pos.z);
      v.pos.x -= nx * push;
      v.pos.z -= nz * push;
      if (v.speed > 5) {
        v.vel.multiplyScalar(0.72);
        effects.burst(new THREE.Vector3(v.pos.x, 0.8, v.pos.z), { color: 0xffd08a, speed: 6, life: 0.4, size: 0.6 }, 5);
        audio.impact();
        G.cam.shake = Math.max(G.cam.shake, 2.4);
      }
    }
  }
  for (const car of G.traffic.cars) {
    const p = car.mesh.position;
    const d = Math.hypot(p.x - v.pos.x, p.z - v.pos.z);
    if (d < 3.3 && v.speed > 6) {
      car.stunned = Math.max(car.stunned || 0, 4);
      car.speed = 0;
      v.vel.multiplyScalar(0.78);
      effects.burst(new THREE.Vector3(p.x, 0.8, p.z), { color: 0xffd08a, speed: 6, life: 0.4, size: 0.6 }, 6);
      audio.impact();
      G.cam.shake = Math.max(G.cam.shake, 2);
    }
  }

  // the wreck you're sitting in can explode
  if (v.health <= 0 && v.alive) {
    v.alive = false;
    effects.explosion(new THREE.Vector3(v.pos.x, 1, v.pos.z));
    audio.impact();
    exitVehicle();
    takeDamage(45);
  }
}

function updateOnFoot(dt) {
  const k = G.keys;
  const input = {
    forward: (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0),
    right: (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0),
    run: k.has("shift"),
    jump: k.has("space"),
    camYaw: G.cam.yaw,
    aiming: G.mouse.aim,
  };
  G.player.update(dt, input, G.world.grid, G.city.bounds);

  // face the camera direction while aiming
  if (G.mouse.aim) G.player.yaw = G.cam.yaw;
  G.player.mesh.rotation.y = G.player.yaw;

  audio.setEngine(false, 0, 0);

  if (G.mouse.down) {
    if (G.elapsed - G.lastShotAt > 0.15) shoot();
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  G.elapsed += dt;

  if (G.mode === "playing" || G.mode === "paused" || G.mode === "dead") {
    const active = G.mode === "playing";
    if (active) {
      G.cam.mouseIdle += dt;
      G.clockMinutes = (G.clockMinutes + dt / 2.4) % (60 * 24);

      if (G.vehicle) updateDriving(dt);
      else updateOnFoot(dt);

      G.player.mesh.position.copy(G.player.pos);

      if (G.weapon.reloading) {
        G.weapon.reloadTimer -= dt;
        if (G.weapon.reloadTimer <= 0) finishReload();
      }
      if (G.weapon.cooldown > 0) G.weapon.cooldown -= dt;

      // slow health regeneration after a few quiet seconds
      if (G.player.alive && G.player.health < G.player.maxHealth && G.elapsed - G.lastDamageAt > 7) {
        G.player.health = Math.min(G.player.maxHealth, G.player.health + 4 * dt);
      }

      G.traffic.update(dt, G.player.pos);
      G.police.update(dt, G.player, !G.vehicle);
      effects.update(dt);
    }

    updateCamera(dt);

    // interaction prompt
    if (G.mode === "playing") {
      if (G.vehicle) {
        G.hud.setPrompt("");
      } else {
        const { vehicle, traffic } = nearestVehicle();
        if (vehicle || traffic) G.hud.setPrompt("<kbd>F</kbd> Fahrzeug übernehmen");
        else G.hud.setPrompt("");
      }
    }

    // keep the shadow frustum around the player
    if (G.world) {
      const p = G.player.pos;
      G.world.sun.position.set(p.x - 150, 120, p.z - 175);
      G.world.sun.target.position.set(p.x, 0, p.z);
      G.world.sun.target.updateMatrixWorld();
    }

    G.hud.update(dt, {
      pos: G.player.pos,
      yaw: G.mode === "playing" ? (G.vehicle ? G.vehicle.yaw : G.cam.yaw) : G.cam.yaw,
      health: G.player.health,
      wanted: G.police.wanted,
      inVehicle: !!G.vehicle,
      speedKmh: G.vehicle ? G.vehicle.speedKmh : 0,
      alive: G.player.alive,
      clockMinutes: G.clockMinutes,
      peds: G.traffic.peds,
      trafficCars: G.traffic.cars,
      parked: G.parked,
      copCars: G.police.cars,
      copUnits: G.police.units,
      driverVehicle: G.vehicle,
    });
  }

  renderer.render(scene, camera);

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum > 0.5) {
    const fps = Math.round(fpsFrames / fpsAccum);
    document.getElementById("subtle").textContent = `Liberty Heights · Sandbox · ${fps} fps`;
    fpsAccum = 0;
    fpsFrames = 0;
  }
}

// ----------------------------------------------------------------------- boot
async function boot() {
  loadText.textContent = "Texturen werden geladen …";
  const tex = await loadWorldTextures((p) => {
    loadFill.style.width = `${Math.round(p * 100)}%`;
  });

  loadText.textContent = "Stadt wird gebaut …";
  loadFill.style.width = "100%";

  const city = generateCity((Math.random() * 1e9) | 0);
  G.city = city;
  G.world = buildWorld(scene, city, tex);

  G.player = new Player(scene);
  G.player.setPosition(city.spawn.x, city.spawn.z);
  G.cam.yaw = 0.35;

  G.traffic = new Traffic(scene, city, (Math.random() * 1e9) | 0);
  G.police = new Police(scene, city, G.world.grid, {
    onPlayerDamage: takeDamage,
    effects,
    audio,
  });
  G.hud = new HUD(city);
  spawnParkedVehicles();

  G.hud.setHealth(100);
  G.hud.setArmour(0);
  G.hud.setAmmo(G.weapon.mag, G.weapon.reserve, false);
  G.hud.setWanted(0);

  loadingEl.classList.add("hidden");
  startEl.classList.remove("hidden");
  G.mode = "menu";

  document.getElementById("play").addEventListener("click", () => {
    audio.init();
    startEl.classList.add("hidden");
    G.hud.show();
    G.mode = "playing";
    canvas.requestPointerLock();
  });
  document.getElementById("resume").addEventListener("click", resume);
  document.getElementById("respawn").addEventListener("click", respawn);

  animate();
}

boot().catch((err) => {
  console.error(err);
  loadText.textContent = `Fehler beim Laden: ${err.message}`;
});
