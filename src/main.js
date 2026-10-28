import * as THREE from 'three';
import { loadTextures } from './textures.js';
import { createSky } from './sky.js';
import { buildWorld, makeRng } from './world.js';
import { loadPlayerCar } from './car.js';
import { createPostFX } from './postfx.js';
import { Hud } from './hud.js';
import { buildCity } from './city.js';
import { GRID } from './cityplan.js';
import { LAYOUT } from './world.js';
import {
  settings, loadSettings, saveSettings, resetSettings, buildSettingsMenu,
} from './settings.js';

const params = new URLSearchParams(location.search);
const QUALITY = params.get('q') === 'low' ? 'low' : 'high';
const REFLECT = params.get('refl') === 'off' ? 0 : Number(params.get('refl') || 768);
const SUN_DIR = new THREE.Vector3(-0.46, 0.105, 1).normalize();
// the visible sun sits on the horizon; shadow casting uses a raised sun so that
// shadows keep sane lengths instead of stretching 100 m across the beach
const SHADOW_DIR = new THREE.Vector3(-0.5, 0.62, 1).normalize();

// steering: rad/s at full lock, low speed, sensitivity 1.0. Divided down by speed
// (grip) and multiplied by the player's sensitivity setting.
const TURN_RATE = 1.55;

const loaderEl = document.getElementById('loader');
const barEl = document.getElementById('bar-fill');
const statusEl = document.getElementById('loader-status');
const hudEl = document.getElementById('hud');
const photoEl = document.getElementById('photo-ui');
const toastEl = document.getElementById('toast');
const fpsEl = document.getElementById('fps');
const menuEl = document.getElementById('menu');
const menuSettingsEl = document.getElementById('menu-settings');
const menuResumeEl = document.getElementById('menu-resume');
const menuResetEl = document.getElementById('menu-reset');

loadSettings();

const setProgress = (p, label) => {
  barEl.style.width = `${Math.round(p * 100)}%`;
  if (label) statusEl.textContent = label;
};

/* ---------------------------------------------------------------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: QUALITY === 'high',
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY === 'high' ? 1.6 : 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = QUALITY === 'high';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xea7d92, 0.00017);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.12, 5000);
camera.position.set(-0.7, 1.78, -7.6);

let sky = null;

/* lighting ---------------------------------------------------------- */
const sun = new THREE.DirectionalLight(0xffb173, 3.1);
sun.position.copy(SHADOW_DIR).multiplyScalar(160);
sun.castShadow = QUALITY === 'high';
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 420;
sun.shadow.camera.left = -90;
sun.shadow.camera.right = 90;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -60;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.06;
scene.add(sun);
scene.add(sun.target);

const hemi = new THREE.HemisphereLight(0xff88b8, 0x33202c, 0.72);
scene.add(hemi);

const fill = new THREE.DirectionalLight(0x9a86ff, 0.45);
fill.position.set(-80, 40, -60);
scene.add(fill);

// teal rim light from behind: classic orange/teal grade + makes the car body read teal
const rim = new THREE.DirectionalLight(0x2be0d0, 0.75);
rim.position.set(-50, 22, -90);
scene.add(rim);

/* ---------------------------------------------------------------- */
const hud = new Hud();
let car = null;
let carGroup = null;
let world = null;
let postfx = null;
const player = {
  position: new THREE.Vector3(0.9, 0, 8),
  yaw: 0,
  speed: 0,
  steer: 0,
};
const state = {
  ready: false,
  phase: 'loading',
  photo: false,
  heroLock: false,
  paused: false,
  keys: Object.create(null),
  shotIndex: 0,
};

/* ---------------------------------------------------------------- */
async function init() {
  setProgress(0.04, 'GENERATING TEXTURES');
  await loadTextures((p) => setProgress(0.04 + p * 0.5, 'DEPLOYING TEXTURES'));

  sky = createSky(scene, SUN_DIR);

  setProgress(0.6, 'BUILDING OCEAN DRIVE');
  const rng = makeRng(20260601);
  world = buildWorld(scene, rng, { reflectResolution: REFLECT || 256 });

  // the district west of Ocean Drive: grid, blocks, parks, civic buildings, border
  setProgress(0.68, 'LAYING OUT THE DISTRICT');
  const city = buildCity(scene, makeRng(4242), {});
  state.city = city;
  state.world = world;

  // environment map from the sunset sky (drives the wet-road reflections)
  setProgress(0.7, 'BAKING REFLECTIONS');
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  const envSky = createSky(envScene, SUN_DIR);
  envSky.mesh.scale.setScalar(0.1);
  scene.environment = pmrem.fromScene(envScene, 0.04, 0.1, 600).texture;
  scene.environmentIntensity = 0.85;
  envScene.clear();
  pmrem.dispose();

  setProgress(0.82, 'SPAWNING VEHICLE');
  car = await loadPlayerCar((p) => setProgress(0.82 + p * 0.1, 'SPAWNING VEHICLE'));

  carGroup = new THREE.Group();
  carGroup.add(car.root);
  scene.add(carGroup);

  setProgress(0.96, 'COMPILING SHADERS');
  postfx = createPostFX(renderer, scene, camera, { quality: QUALITY });
  postfx.setSize(window.innerWidth, window.innerHeight);

  // warm up (compiles all shader programs before the first visible frame)
  camera.position.set(-0.7, 1.78, -7.6);
  camera.lookAt(-0.3, 1.32, 26);
  await new Promise((r) => requestAnimationFrame(r));
  postfx.render(0.016);
  await new Promise((r) => setTimeout(r, 60));

  setProgress(1, 'WELCOME TO MIAMI');
  state.ready = true;
  state.phase = 'drive';
  loaderEl.classList.add('hidden');
  setTimeout(() => { loaderEl.style.display = 'none'; }, 950);
  setTimeout(() => applySettings(['hud']), 400);

  window.__vice = {
    ready: true,
    THREE, scene, camera, renderer, postfx, world, car, player, state,
    capture: () => captureShot(),
    setHeroView,
    setCamera: (pos, target) => {
      state.heroLock = true;
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.lookAt(new THREE.Vector3(target[0], target[1], target[2]));
    },
    freeCamera: () => { state.heroLock = false; },
    photoMode: (on) => setPhotoMode(!!on),
    city,
    settings,
    applySettings,
    menu: (on) => openMenu(!!on),
    setupMenu,
    hud: (on) => {
      hudEl.classList.toggle('hidden', !on);
      hudEl.style.display = on ? '' : 'none';
    },
    placeCar: (x, z, yaw = 0) => {
      player.position.set(x, 0, z);
      player.yaw = yaw;
      player.speed = 0;
    },
    tick: (dt = 1 / 60, steps = 1) => {
      for (let i = 0; i < steps; i++) step(dt);
      return state;
    },
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
  if (state.paused) return;          // the menu owns the keyboard while open

  state.keys[e.code] = true;
  if (e.code === 'KeyP' && state.ready) setPhotoMode(!state.photo);
  if (e.code === 'KeyH') {
    settings.hud = !settings.hud;
    applySettings(['hud']);
    saveSettings();
    menuUi?.refresh();
  }
  if (e.code === 'Enter') { e.preventDefault(); captureShot(); }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { state.keys[e.code] = false; });

/* photo-mode mouse look */
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
  look.pitch = THREE.MathUtils.clamp(look.pitch - (e.clientY - look.lastY) * 0.0028 * settings.camSensitivity, -1.2, 1.2);
  look.lastX = e.clientX; look.lastY = e.clientY;
  state.heroLock = true;
});

/* ---------------------------------------------------------------- */
/* settings + pause menu                                             */
/* ---------------------------------------------------------------- */
let menuUi = null;

function applySettings(keys = null) {
  const wants = (k) => !keys || keys.includes(k);

  if (wants('hud')) {
    const on = settings.hud && !params.get('nohud');
    hudEl.classList.toggle('hidden', !on);
    hudEl.style.display = on ? '' : 'none';
  }
  if (postfx) {
    if (wants('bloom')) postfx.bloom.enabled = settings.bloom;
    if (wants('grain')) postfx.setGrain(settings.grain ? 0.055 : 0);
  }
}

function openMenu(on) {
  state.paused = on;
  menuEl.classList.toggle('open', on);
  menuEl.setAttribute('aria-hidden', String(!on));
  if (on) {
    // release held keys so the car does not launch when the player resumes
    for (const code of Object.keys(state.keys)) state.keys[code] = false;
  }
  menuUi?.refresh();
}

function setupMenu() {
  menuUi = buildSettingsMenu(menuSettingsEl, (key, value) => {
    applySettings([key]);
    saveSettings();
  });
  menuResumeEl.addEventListener('click', () => openMenu(false));
  menuResetEl.addEventListener('click', () => {
    resetSettings();
    menuUi.refresh();
    applySettings();
    toast('EINSTELLUNGEN ZURÜCKGESETZT');
  });
}

function setPhotoMode(on) {
  state.photo = on;
  photoEl.classList.toggle('active', on);
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
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

/* hero camera exactly matching the reference composition */
function setHeroView() {
  // reference composition: 7.6 m behind the car, 1.78 m high, looking down the boulevard
  state.heroLock = true;
  camera.fov = 50;
  camera.updateProjectionMatrix();
  const dir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  camera.position.copy(player.position)
    .addScaledVector(dir, -7.6)
    .add(new THREE.Vector3(0, 1.78, 0));
  camera.lookAt(
    player.position.clone().addScaledVector(dir, 24).add(new THREE.Vector3(0, 1.45, 0))
  );
}

/* ---------------------------------------------------------------- */
function captureShot() {
  postfx.render(0.0001);
  const url = canvas.toDataURL('image/png');
  if (!params.get('nocapture')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `vice306-miami-${Date.now()}.png`;
    a.click();
  }
  toast('SCREENSHOT SAVED');
  return url;
}

/* ---------------------------------------------------------------- */
function step(dt) {
  const k = state.keys;
  const forward = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  const steerIn = (k.KeyA || k.ArrowLeft ? 1 : 0) - (k.KeyD || k.ArrowRight ? 1 : 0);

  const maxSpeed = k.ShiftLeft || k.ShiftRight ? 58 : 34;
  if (forward > 0) {
    player.speed += (player.speed < 0 ? 22 : 11.5) * dt;
  } else if (forward < 0) {
    player.speed -= (player.speed > 0 ? 26 : 8) * dt;
  }
  if (forward === 0) player.speed *= Math.pow(0.38, dt);

  player.speed = THREE.MathUtils.clamp(player.speed, -9, maxSpeed);
  if (Math.abs(player.speed) < 0.05) player.speed = 0;

  // Steering: the input ramps in/out instead of snapping to full lock, so a short
  // tap only nudges the nose. The yaw rate is speed dependent (grip) and scaled by
  // the sensitivity setting from the ESC menu.
  player.steer += (steerIn - player.steer) * (1 - Math.exp(-6 * dt));

  const speedAbs = Math.abs(player.speed);
  const speedFactor = THREE.MathUtils.clamp(speedAbs / 5, 0, 1);   // no pirouettes at a standstill
  const grip = 1 / (1 + speedAbs * 0.03);
  const yawRate = player.steer * speedFactor * grip * TURN_RATE * settings.steerSensitivity;
  player.yaw += yawRate * Math.sign(player.speed || 1) * dt;

  const dir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const nextX = player.position.x + dir.x * player.speed * dt;
  const nextZ = player.position.z + dir.z * player.speed * dt;

  if (hitsBuilding(nextX, nextZ)) {
    // bump: stop and let the car settle a little
    player.speed *= -0.18;
    player.speed = Math.abs(player.speed) < 1.2 ? 0 : player.speed;
  } else {
    player.position.x = nextX;
    player.position.z = nextZ;
  }

  clampToCity();
  return dir;
}

/* ------------------------------------------------------------------ */
/* city bounds + building collision                                    */
/* ------------------------------------------------------------------ */
const CITY = {
  // -X is the ocean promenade, +X goes inland through the district
  xMin: -12.9,                                   // promenade balustrade
  xMax: GRID.border.xEast - 6,                   // the fence line
  zMin: -100,                                    // Ocean Drive south end (hero shot)
  zMax: GRID.border.zB - 6,                      // north fence
  // inland of the hotel row the district starts at the ring-road fence
  zInlandMin: GRID.border.zA + 6,
  zInlandMax: GRID.border.zB - 6,
};
const OCEAN_STRIP = 30;      // x <= 30 is the ocean-drive corridor (beach + hotels)
const CAR_RADIUS = 1.05;

function clampToCity() {
  const p = player.position;
  p.x = THREE.MathUtils.clamp(p.x, CITY.xMin, CITY.xMax);
  p.z = THREE.MathUtils.clamp(p.z, CITY.zMin, CITY.zMax);
}

/** Cheap AABB check against the city block colliders + the hotel row. */
function hitsBuilding(x, z) {
  // invisible boundary: inland you cannot leave the district at its north/south ends
  if (x > OCEAN_STRIP && (z < CITY.zInlandMin || z > CITY.zInlandMax)) return true;
  const cols = state.city?.colliders;
  if (cols) {
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (x > c.x - c.w / 2 - CAR_RADIUS && x < c.x + c.w / 2 + CAR_RADIUS &&
          z > c.z - c.d / 2 - CAR_RADIUS && z < c.z + c.d / 2 + CAR_RADIUS) {
        return true;
      }
    }
  }
  // the art-déco hotel row belongs to world.js, reuse its boxes
  const hb = world?.buildingBoxes;
  if (hb) {
    for (let i = 0; i < hb.length; i++) {
      const b = hb[i];
      if (x > b.x - b.w / 2 - CAR_RADIUS && x < b.x + b.w / 2 + CAR_RADIUS &&
          z > b.z - b.d / 2 - CAR_RADIUS && z < b.z + b.d / 2 + CAR_RADIUS) {
        return true;
      }
    }
  }
  return false;
}

/* ---------------------------------------------------------------- */
function updateCamera(dt, dir) {
  if (state.photo) {
    const k = state.keys;
    const speed = (k.ShiftLeft ? 26 : 11) * dt;
    const q = camera.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
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

  const back = dir.clone().multiplyScalar(-5.4);
  const desired = player.position.clone().add(back).add(new THREE.Vector3(0, 1.75, 0));
  const smooth = 1 - Math.exp(-7 * dt);
  camera.position.lerp(desired, smooth);

  const lookAt = player.position.clone().addScaledVector(dir, 16).add(new THREE.Vector3(0, 1.3, 0));
  camera.lookAt(lookAt);

  const targetFov = 50 + Math.min(10, Math.abs(player.speed) * 0.16);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

/* ---------------------------------------------------------------- */
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (window.__vice) {
    window.__vice.postfx.setSize(w, h);
    window.__vice.world.road?.setSize(Math.min(1024, w * 0.5), Math.min(1024, h * 0.5));
  }
}

const clock = new THREE.Clock();
let frames = 0, fpsTime = 0;

let loopErrors = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  try {
    frame(dt);
  } catch (err) {
    if (loopErrors++ < 3) console.error('frame error', err);
  }
  if (postfx) postfx.render(dt);
}

function frame(dt) {
  if (state.ready && !state.paused) {
    const dir = step(dt);
    playerSync(carGroup, player, car, dt);
    updateCamera(dt, dir);
    world.update(dt, undefined, player.position);
    sky.update(dt, camera);

    // keep the shadow frustum around the action
    sun.position.copy(player.position).addScaledVector(SHADOW_DIR, 170);
    sun.target.position.copy(player.position);
    sun.target.updateMatrixWorld();

    if (world.road) world.road.update(renderer, scene, camera, dt);

    hud.update(dt, player);
    frames++; fpsTime += dt;
    if (fpsTime > 0.5) {
      fpsEl.textContent = `${Math.round(frames / fpsTime)} FPS · ${QUALITY.toUpperCase()}`;
      frames = 0; fpsTime = 0;
    }
  }
}

function playerSync(group, player, car, dt) {
  group.position.copy(player.position);
  group.rotation.y = player.yaw;
  car.spinWheels(player.speed * dt);
  // body roll + pitch for a bit of life
  const roll = -player.steer * Math.min(1, Math.abs(player.speed) / 30) * 0.035;
  car.root.rotation.z = THREE.MathUtils.lerp(car.root.rotation.z, roll, Math.min(1, dt * 6));
  const accel = dt > 0.0001 ? (player.speed - (player._lastSpeed ?? 0)) / dt : 0;
  const pitch = THREE.MathUtils.clamp(-accel * 0.0012, -0.03, 0.03);
  car.root.rotation.x = THREE.MathUtils.lerp(car.root.rotation.x, pitch, Math.min(1, dt * 4));
  player._lastSpeed = player.speed;
  car.root.position.y = Math.sin(performance.now() * 0.004) * 0.004 * Math.min(1, Math.abs(player.speed) / 10);
}

/* ---------------------------------------------------------------- */
init().catch((err) => {
  console.error(err);
  statusEl.textContent = 'ERROR: ' + err.message;
});
