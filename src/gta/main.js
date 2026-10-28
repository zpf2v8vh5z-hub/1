/**
 * SAN ANDREAS — the complete GTA V map as a drivable open world.
 *
 * Terrain: real GTA V height field + satellite mosaic, 9.0 x 12.4 km.
 * Roads:   the real street network baked from the 1 m masks.
 * City:    3.261 real buildings from the map database.
 * Props:   palms, forest, rocks, scrub placed from the game's own tree mask.
 */
import * as THREE from 'three';
import { loadTextures } from '../textures.js';
import { createSky } from '../sky.js';
import { loadPlayerCar } from '../car.js';
import { createPostFX } from '../postfx.js';
import {
  settings, loadSettings, saveSettings, resetSettings, buildSettingsMenu,
} from '../settings.js';

import { WORLD, SEA_LEVEL, SPAWN, LANDMARKS, VIEW } from './config.js';
import { Terrain } from './terrain.js';
import { Roads, ROAD_LIFT, buildRoadGrid, roadGridAt } from './roads.js';
import { Water } from './water.js';
import { Buildings } from './buildings.js';
import { Props } from './props.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const QUALITY = params.get('q') === 'low' ? 'low' : 'high';
const SUN_DIR = new THREE.Vector3(-0.46, 0.14, 1).normalize();
const SHADOW_DIR = new THREE.Vector3(-0.5, 0.62, 1).normalize();
const TURN_RATE = 1.55;
const CAR_RADIUS = 1.1;

const el = (id) => document.getElementById(id);
const loaderEl = el('loader');
const barEl = el('bar-fill');
const statusEl = el('loader-status');
const hudEl = el('hud');
const photoEl = el('photo-ui');
const toastEl = el('toast');
const fpsEl = el('fps');
const menuEl = el('menu');
const menuSettingsEl = el('menu-settings');
const menuResumeEl = el('menu-resume');
const menuResetEl = el('menu-reset');

loadSettings();

const setProgress = (p, label) => {
  if (barEl) barEl.style.width = `${Math.round(p * 100)}%`;
  if (label && statusEl) statusEl.textContent = label;
};

/* ---------------------------------------------------------------- */
const canvas = el('scene');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: QUALITY === 'high', powerPreference: 'high-performance', stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY === 'high' ? 1.5 : 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = QUALITY === 'high';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x120a18);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xa98eb0, 0.000065);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.4, VIEW.far);
camera.position.set(SPAWN.x, 3, SPAWN.y);

/* lighting ---------------------------------------------------------- */
const sun = new THREE.DirectionalLight(0xffc489, 3.0);
sun.position.copy(SHADOW_DIR).multiplyScalar(400);
sun.castShadow = QUALITY === 'high';
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 900;
sun.shadow.camera.left = -VIEW.shadowRadius;
sun.shadow.camera.right = VIEW.shadowRadius;
sun.shadow.camera.top = VIEW.shadowRadius;
sun.shadow.camera.bottom = -VIEW.shadowRadius;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

scene.add(new THREE.HemisphereLight(0xffc9a8, 0x2c3450, 1.05));
const fill = new THREE.DirectionalLight(0x8f9dff, 0.45);
fill.position.set(120, 80, -200);
scene.add(fill);

/* the baked control map is also the CPU-side road mask: the car has to stand on
   the asphalt ribbon, which sits a little above the coarse terrain mesh */
class RoadMask {
  constructor() { this.data = null; }
  attach(texture) {
    const img = texture?.image;
    if (!img) return;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    this.data = ctx.getImageData(0, 0, img.width, img.height).data;
    this.w = img.width; this.h = img.height;
  }
  at(x, y) {
    if (!this.data) return 0;
    const u = (x - WORLD.x0) / WORLD.width;
    const v = (y - WORLD.y0) / WORLD.height;
    const gx = Math.min(this.w - 1.001, Math.max(0, u * (this.w - 1)));
    const gy = Math.min(this.h - 1.001, Math.max(0, (1 - v) * (this.h - 1)));
    const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0;
    const i = (y0 * this.w + x0) * 4 + 1;
    const s = this.w * 4;
    const a = this.data[i], b = this.data[i + 4];
    const c = this.data[i + s], d = this.data[i + s + 4];
    return ((a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy) / 255;
  }
}
const roadMask = new RoadMask();

/** ground height including the asphalt lift, so wheels sit on the road */
function groundAt(x, y) {
  const h = terrain.heightAt(x, y);
  const r = roadGridAt(state.roadGrid, x, y) ? 1 : roadMask.at(x, y);
  if (r < 0.12) return h;
  const t = Math.min(1, (r - 0.12) / 0.3);
  return h + ROAD_LIFT * t;
}

/* state ------------------------------------------------------------- */
const hud = new Hud();
const state = {
  ready: false, photo: false, heroLock: false, paused: false,
  keys: Object.create(null), errors: [], stats: {},
};
const player = { position: new THREE.Vector3(SPAWN.x, 0, SPAWN.y), yaw: SPAWN.heading, speed: 0, steer: 0 };

let terrain = null, roads = null, water = null, buildings = null, props = null;
let sky = null, postfx = null, car = null, carGroup = null;
let nearby = [];                       // cached building colliders near the car
let nearbyAt = { x: 1e9, y: 1e9 };

/* ---------------------------------------------------------------- */
async function init() {
  setProgress(0.03, 'TEXTUREN WERDEN GELADEN');
  await loadTextures((p) => setProgress(0.03 + p * 0.22, 'TEXTUREN WERDEN GELADEN'));

  sky = createSky(scene, SUN_DIR);

  setProgress(0.27, 'HÖHENFELD VON SAN ANDREAS');
  terrain = await new Terrain().load((p) => setProgress(0.27 + p * 0.2, 'HÖHENFELD VON SAN ANDREAS'));
  terrain.build(scene);

  setProgress(0.5, 'STRASSENNETZ');
  roads = await new Roads(terrain).load();
  roads.build(scene);
  state.roadGrid = buildRoadGrid(roads.raw);

  setProgress(0.6, 'GEBÄUDE');
  buildings = await new Buildings(terrain).load();
  buildings.build(scene, state.roadGrid);
  buildings.addRoofs(scene);

  setProgress(0.7, 'OZEAN');
  water = new Water(terrain).build(scene);

  setProgress(0.76, 'PALMEN, WALD UND FELSEN');
  props = await new Props(terrain, buildings).build(scene);

  setProgress(0.86, 'HIMMEL UND REFLEXIONEN');
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  const envSky = createSky(envScene, SUN_DIR);
  envSky.mesh.scale.setScalar(0.1);
  scene.environment = pmrem.fromScene(envScene, 0.04, 0.1, 900).texture;
  scene.environmentIntensity = 0.7;
  envScene.clear();
  pmrem.dispose();

  setProgress(0.9, 'FAHRZEUG');
  car = await loadPlayerCar(() => {});
  carGroup = new THREE.Group();
  carGroup.add(car.root);
  scene.add(carGroup);

  hud.setMapImage(terrain.satellite?.image || null);
  roadMask.attach(terrain.control);

  setProgress(0.96, 'SHADER');
  postfx = createPostFX(renderer, scene, camera, { quality: QUALITY });
  postfx.setSize(window.innerWidth, window.innerHeight);

  // settle the car on the ground and point it at downtown
  player.position.y = groundAt(player.position.x, player.position.z);
  refreshNearby(true);

  camera.position.set(SPAWN.x - Math.sin(SPAWN.heading) * 9, player.position.y + 4.2, SPAWN.y - Math.cos(SPAWN.heading) * 9);
  camera.lookAt(player.position.x, player.position.y + 1.4, player.position.z);
  await new Promise((r) => requestAnimationFrame(r));
  postfx.render(0.016);

  setProgress(1, 'LOS SANTOS');
  state.ready = true;
  state.stats = {
    buildings: buildings.data.length,
    roads: roads.stats(),
    props: props.counts,
    terrain: { size: [WORLD.width, WORLD.height], chunks: terrain.chunks.length },
  };
  loaderEl?.classList.add('hidden');
  setTimeout(() => { if (loaderEl) loaderEl.style.display = 'none'; }, 900);

  window.__gta = {
    ready: true, THREE, scene, camera, renderer, postfx, terrain, roads, water,
    buildings, props, car, player, state, hud, settings, WORLD, SEA_LEVEL, LANDMARKS,
    capture: () => captureShot(),
    placeCar: (x, z, yaw = 0) => {
      player.position.set(x, groundAt(x, z), z);
      player.yaw = yaw;
      player.speed = 0;
      refreshNearby(true);
    },
    tick: (dt = 1 / 60, steps = 1) => {
      for (let i = 0; i < steps; i++) { step(dt); syncCar(dt); }
      terrain.update(camera);
      return state;
    },
    drive: (seconds, dt = 1 / 60, keys = { KeyW: true }) => {
      const steps = Math.round(seconds / dt);
      for (let i = 0; i < steps; i++) {
        state.keys = { ...state.keys, ...keys };
        step(dt); syncCar(dt);
      }
      terrain.update(camera);
      return { x: player.position.x, y: player.position.y, z: player.position.z, speed: player.speed };
    },
    setCamera: (pos, target) => {
      state.heroLock = true;
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.lookAt(new THREE.Vector3(target[0], target[1], target[2]));
      camera.fov = 55;
      camera.updateProjectionMatrix();
      terrain.update(camera);
    },
    freeCamera: () => { state.heroLock = false; },
    /** camera at a height above the terrain, looking at a ground point */
    setCameraGround: (x, z, up, tx, ty, tz) => {
      state.heroLock = true;
      const gy = Math.max(terrain.heightAt(x, z), SEA_LEVEL) + up;
      camera.position.set(x, gy, z);
      camera.lookAt(new THREE.Vector3(tx, terrain.heightAt(tx, tz) + ty, tz));
      camera.fov = 60;
      camera.updateProjectionMatrix();
      terrain.update(camera);
    },
    /** proper chase camera behind the car, for hero shots */
    chase: (dist = 8, height = 2.4) => {
      const dir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      state.heroLock = true;
      const p = player.position;
      const cx = p.x - dir.x * dist, cz = p.z - dir.z * dist;
      const gy = Math.max(terrain.heightAt(cx, cz), SEA_LEVEL) + height;
      refreshNearby();
      const target = clearCamera(
        new THREE.Vector3(p.x, p.y + 1.6, p.z),
        new THREE.Vector3(cx, Math.max(p.y + height, gy), cz)
      );
      camera.position.copy(target);
      camera.lookAt(p.x + dir.x * 14, p.y + 1.6, p.z + dir.z * 14);
      camera.fov = 56;
      camera.updateProjectionMatrix();
      terrain.update(camera);
    },
    photoMode: (on) => setPhotoMode(!!on),
    menu: (on) => openMenu(!!on),
    hud: (on) => {
      if (!hudEl) return;
      hudEl.classList.toggle('hidden', !on);
      hudEl.style.display = on ? '' : 'none';
    },
    applySettings,
    render: (dt = 0.016) => { terrain.update(camera); postfx.render(dt); return true; },
    errors: state.errors,
    heightAt: (x, y) => terrain.heightAt(x, y),
  };

  setupMenu();
  applySettings();
  window.addEventListener('resize', onResize);
  requestAnimationFrame(loop);
}

/* ---------------------------------------------------------------- */
/* input                                                             */
/* ---------------------------------------------------------------- */
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    e.preventDefault();
    if (state.ready) openMenu(!state.paused);
    return;
  }
  if (state.paused) return;
  state.keys[e.code] = true;
  if (e.code === 'KeyP' && state.ready) setPhotoMode(!state.photo);
  if (e.code === 'KeyH') {
    settings.hud = !settings.hud;
    applySettings(['hud']);
    saveSettings();
  }
  if (e.code === 'KeyM') cycleLandmark(1);
  if (e.code === 'KeyN') cycleLandmark(-1);
  if (e.code === 'Enter') captureShot();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { state.keys[e.code] = false; });

const look = { dragging: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0 };
canvas.addEventListener('pointerdown', (e) => {
  if (!state.photo) return;
  look.dragging = true;
  look.lastX = e.clientX; look.lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => { look.dragging = false; });
canvas.addEventListener('pointermove', (e) => {
  if (!state.photo || !look.dragging || state.paused) return;
  look.yaw -= (e.clientX - look.lastX) * 0.0032 * settings.camSensitivity;
  look.pitch = THREE.MathUtils.clamp(look.pitch - (e.clientY - look.lastY) * 0.0028 * settings.camSensitivity, -1.3, 1.3);
  look.lastX = e.clientX; look.lastY = e.clientY;
  state.heroLock = true;
});

let landmarkIndex = -1;
function cycleLandmark(dir) {
  landmarkIndex = (landmarkIndex + dir + LANDMARKS.length) % LANDMARKS.length;
  const lm = LANDMARKS[landmarkIndex];
  player.position.set(lm.x, groundAt(lm.x, lm.y) + 1, lm.y);
  player.speed = 0;
  player.yaw = 0;
  refreshNearby(true);
  toast(`TELEPORT · ${lm.label.toUpperCase()}`);
}

/* ---------------------------------------------------------------- */
/* settings + pause menu                                             */
/* ---------------------------------------------------------------- */
let menuUi = null;
function applySettings(keys = null) {
  const wants = (k) => !keys || keys.includes(k);
  if (wants('hud')) {
    const on = settings.hud && !params.get('nohud');
    if (hudEl) {
      hudEl.classList.toggle('hidden', !on);
      hudEl.style.display = on ? '' : 'none';
    }
  }
  if (postfx) {
    if (wants('bloom')) postfx.bloom.enabled = settings.bloom;
    if (wants('grain')) postfx.setGrain(settings.grain ? 0.055 : 0);
  }
}

function openMenu(on) {
  state.paused = on;
  menuEl?.classList.toggle('open', on);
  menuEl?.setAttribute('aria-hidden', String(!on));
  if (on) for (const code of Object.keys(state.keys)) state.keys[code] = false;
  menuUi?.refresh();
}

function setupMenu() {
  if (!menuSettingsEl) return;
  menuUi = buildSettingsMenu(menuSettingsEl, (key) => {
    applySettings([key]);
    saveSettings();
  });
  menuResumeEl?.addEventListener('click', () => openMenu(false));
  menuResetEl?.addEventListener('click', () => {
    resetSettings();
    menuUi.refresh();
    applySettings();
    toast('EINSTELLUNGEN ZURÜCKGESETZT');
  });
}

function setPhotoMode(on) {
  state.photo = on;
  photoEl?.classList.toggle('active', on);
  if (on) {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    look.yaw = e.y; look.pitch = e.x;
    state.heroLock = true;
    toast('PHOTO MODE');
  } else {
    state.heroLock = false;
    toast('DRIVE MODE');
  }
}

let toastTimer = null;
function toast(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

function captureShot() {
  postfx.render(0.0001);
  const url = canvas.toDataURL('image/png');
  if (!params.get('nocapture')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `san-andreas-${Date.now()}.png`;
    a.click();
  }
  toast('SCREENSHOT GESPEICHERT');
  return url;
}

/* ---------------------------------------------------------------- */
/* driving physics                                                   */
/* ---------------------------------------------------------------- */
function step(dt) {
  const k = state.keys;
  const dtc = Math.min(dt, 0.05);
  const forward = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  const steerIn = (k.KeyA || k.ArrowLeft ? 1 : 0) - (k.KeyD || k.ArrowRight ? 1 : 0);

  const ground = groundAt(player.position.x, player.position.z);
  const grounded = ground > SEA_LEVEL - 0.4;
  const maxSpeed = (k.ShiftLeft || k.ShiftRight ? 62 : 38) * (grounded ? 1 : 0.45);

  if (forward > 0) player.speed += (player.speed < 0 ? 24 : 12.5) * dtc;
  else if (forward < 0) player.speed -= (player.speed > 0 ? 28 : 9) * dtc;
  if (forward === 0) player.speed *= Math.pow(0.42, dtc);

  // gravity along the slope: uphill slower, downhill faster
  const n = terrain.normalAt(player.position.x, player.position.z);
  const dir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const slopeLean = -(n.x * dir.x + n.z * dir.z);
  player.speed -= slopeLean * 9.8 * 0.42 * dtc;

  player.speed = THREE.MathUtils.clamp(player.speed, -10, maxSpeed);
  if (Math.abs(player.speed) < 0.06) player.speed = 0;

  player.steer += (steerIn - player.steer) * (1 - Math.exp(-6 * dtc));
  const speedAbs = Math.abs(player.speed);
  const speedFactor = THREE.MathUtils.clamp(speedAbs / 4, 0, 1);
  const grip = 1 / (1 + speedAbs * 0.028);
  const yawRate = player.steer * speedFactor * grip * TURN_RATE * settings.steerSensitivity;
  player.yaw += yawRate * Math.sign(player.speed || 1) * dtc;

  const nextX = player.position.x + dir.x * player.speed * dtc;
  const nextZ = player.position.z + dir.z * player.speed * dtc;

  // world boundary: you cannot leave the island
  const bx = THREE.MathUtils.clamp(nextX, WORLD.x0 + 40, WORLD.x1 - 40);
  const bz = THREE.MathUtils.clamp(nextZ, WORLD.y0 + 40, WORLD.y1 - 40);
  const clamped = bx !== nextX || bz !== nextZ;

  // deep water is impassable, shallow water slows you to a crawl
  const targetGround = terrain.heightAt(bx, bz);
  const deep = targetGround < SEA_LEVEL - 1.2;

  if (clamped || deep || hitsBuilding(bx, bz)) {
    player.speed *= clamped || deep ? 0 : -0.16;
    if (Math.abs(player.speed) < 1.0) player.speed = 0;
    if (clamped) player.position.x = bx, player.position.z = bz;
  } else {
    player.position.x = bx;
    player.position.z = bz;
  }

  const h = groundAt(player.position.x, player.position.z);
  player.position.y += (h - player.position.y) * (1 - Math.exp(-18 * dtc));
  if (Math.abs(player.position.y - h) > 2) player.position.y = h;

  // surface drag: sand and dirt are slower than asphalt
  if (ground < SEA_LEVEL + 0.6) player.speed *= Math.pow(0.55, dtc);
  return dir;
}

/**
 * Pull the camera in when a building sits between the car and the wanted camera
 * position, so driving down a narrow street never puts the view inside a wall.
 */
function clearCamera(from, to) {
  const dirX = to.x - from.x, dirY = to.y - from.y, dirZ = to.z - from.z;
  const steps = 12;
  let hitT = 1;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const px = from.x + dirX * t, py = from.y + dirY * t, pz = from.z + dirZ * t;
    let blocked = false;
    for (let i = 0; i < nearby.length && !blocked; i++) {
      const c = nearby[i];
      if (py > c.top + 1) continue;
      const cos = Math.cos(-c.yaw), sin = Math.sin(-c.yaw);
      const dx = px - c.x, dz = pz - c.z;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) < c.w / 2 + 1.0 && Math.abs(lz) < c.d / 2 + 1.0) blocked = true;
    }
    if (blocked) { hitT = (s - 1) / steps; break; }
  }
  if (hitT >= 1) return to;
  // sit at the last clear sample and rise a little as the camera is pushed in
  const t = Math.max(0.25, hitT);
  to.x = from.x + dirX * t;
  to.y = from.y + dirY * t + (1 - t) * 2.2;
  to.z = from.z + dirZ * t;
  return to;
}

function refreshNearby(force = false) {
  if (!buildings) return;
  const dx = player.position.x - nearbyAt.x, dz = player.position.z - nearbyAt.z;
  if (!force && dx * dx + dz * dz < 60 * 60) return;
  nearby = buildings.collisionsNear(player.position.x, player.position.z, 320);
  nearbyAt = { x: player.position.x, y: player.position.z };
}

function hitsBuilding(x, z) {
  refreshNearby();
  for (let i = 0; i < nearby.length; i++) {
    const c = nearby[i];
    if (c.top < player.position.y + 0.6) continue;
    // transform into the box frame (buildings are only slightly rotated)
    const cos = Math.cos(-c.yaw), sin = Math.sin(-c.yaw);
    const dx = x - c.x, dz = z - c.y;
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    if (Math.abs(lx) < c.w / 2 + CAR_RADIUS && Math.abs(lz) < c.d / 2 + CAR_RADIUS) return true;
  }
  return false;
}

/* ---------------------------------------------------------------- */
function syncCar(dt) {
  if (!carGroup) return;
  const p = player.position;
  const ground = groundAt(p.x, p.z);
  carGroup.position.set(p.x, Math.max(ground, p.y - 0.4), p.z);
  carGroup.rotation.y = player.yaw;

  // align to the slope, but keep it subtle so the car does not look glued
  const n = terrain.normalAt(p.x, p.z);
  const up = new THREE.Vector3(n.x, n.y, n.z);
  const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const pitch = Math.asin(THREE.MathUtils.clamp(-up.dot(fwd), -1, 1)) * 0.85;
  const roll = Math.asin(THREE.MathUtils.clamp(up.dot(right), -1, 1)) * 0.6
    - player.steer * Math.min(1, Math.abs(player.speed) / 30) * 0.03;
  carGroup.rotation.set(0, 0, 0);
  carGroup.rotateY(player.yaw);
  carGroup.rotateX(-pitch);
  carGroup.rotateZ(-roll);

  if (car?.spinWheels) car.spinWheels(player.speed * dt);
}

function updateCamera(dt, dir) {
  if (state.photo) {
    const k = state.keys;
    const speed = (k.ShiftLeft ? 90 : 34) * dt;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    if (k.KeyW) camera.position.addScaledVector(fwd, speed);
    if (k.KeyS) camera.position.addScaledVector(fwd, -speed);
    if (k.KeyA) camera.position.addScaledVector(right, -speed);
    if (k.KeyD) camera.position.addScaledVector(right, speed);
    if (k.Space) camera.position.y += speed;
    if (k.KeyQ || k.ControlLeft) camera.position.y -= speed;
    camera.quaternion.setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ'));
    return;
  }
  if (state.heroLock) return;

  const speedAbs = Math.abs(player.speed);
  const dist = 7.4 + speedAbs * 0.075;
  const height = 2.6 + speedAbs * 0.012;
  const desired = player.position.clone()
    .addScaledVector(dir, -dist * Math.cos(0.1))
    .add(new THREE.Vector3(0, height, 0));
  // keep the camera above the ground
  const gh = terrain.heightAt(desired.x, desired.z) + 1.6;
  if (desired.y < gh) desired.y = gh;

  const smooth = 1 - Math.exp(-6 * dt);
  refreshNearby();
  clearCamera(player.position.clone().add(new THREE.Vector3(0, 1.6, 0)), desired);
  camera.position.lerp(desired, smooth);
  const lookAt = player.position.clone().addScaledVector(dir, 13).add(new THREE.Vector3(0, 1.5, 0));
  camera.lookAt(lookAt);

  const targetFov = 55 + Math.min(12, speedAbs * 0.16);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

/* ---------------------------------------------------------------- */
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  postfx?.setSize(w, h);
}

const clock = new THREE.Clock();
let frames = 0, fpsTime = 0;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  try {
    frame(dt);
  } catch (err) {
    if (state.errors.length < 5) { state.errors.push(String(err)); console.error('frame error', err); }
  }
  if (postfx) postfx.render(dt);
}

function frame(dt) {
  if (!state.ready || state.paused) return;
  const dir = step(dt);
  syncCar(dt);
  updateCamera(dt, dir);
  terrain.update(camera);
  water.update(dt);
  sky.update(dt, camera);

  sun.position.copy(player.position).addScaledVector(SHADOW_DIR, 380);
  sun.target.position.copy(player.position);
  sun.target.updateMatrixWorld();

  const near = buildings.nearestNamed(player.position.x, player.position.z, 900);
  hud.update(dt, player, {
    label: near ? `${near.name || near.category} · ${Math.round(near.distance)} m` : 'SAN ANDREAS',
  });

  frames++; fpsTime += dt;
  if (fpsTime > 0.5) {
    if (fpsEl) fpsEl.textContent = `${Math.round(frames / fpsTime)} FPS · ${QUALITY.toUpperCase()}`;
    frames = 0; fpsTime = 0;
  }
}

init().catch((err) => {
  console.error(err);
  state.errors.push(String(err));
  if (statusEl) statusEl.textContent = 'FEHLER: ' + err.message;
});
