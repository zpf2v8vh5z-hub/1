import * as THREE from 'three';
import { loadTextures } from './textures.js';
import { createSky } from './sky.js';
import { buildWorld, makeRng } from './world.js';
import { loadPlayerCar } from './car.js';
import { createPostFX } from './postfx.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const QUALITY = params.get('q') === 'low' ? 'low' : 'high';
const REFLECT = params.get('refl') === 'off' ? 0 : Number(params.get('refl') || 768);
const SUN_DIR = new THREE.Vector3(-0.46, 0.105, 1).normalize();
// the visible sun sits on the horizon; shadow casting uses a raised sun so that
// shadows keep sane lengths instead of stretching 100 m across the beach
const SHADOW_DIR = new THREE.Vector3(-0.5, 0.62, 1).normalize();

const loaderEl = document.getElementById('loader');
const barEl = document.getElementById('bar-fill');
const statusEl = document.getElementById('loader-status');
const hudEl = document.getElementById('hud');
const photoEl = document.getElementById('photo-ui');
const toastEl = document.getElementById('toast');
const fpsEl = document.getElementById('fps');

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
  setTimeout(() => { if (!params.get('nohud')) hudEl.classList.remove('hidden'); }, 400);

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
    hud: (on) => { hudEl.classList.toggle('hidden', !on); hudEl.style.display = on ? '' : 'none'; },
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

  window.addEventListener('resize', onResize);
  requestAnimationFrame(loop);
}

/* ---------------------------------------------------------------- */
/* input                                                             */
/* ---------------------------------------------------------------- */
window.addEventListener('keydown', (e) => {
  state.keys[e.code] = true;
  if (e.code === 'KeyP' && state.ready) setPhotoMode(!state.photo);
  if (e.code === 'KeyH') hudEl.classList.toggle('hidden');
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
  if (!state.photo || !look.dragging) return;
  look.yaw -= (e.clientX - look.lastX) * 0.0032;
  look.pitch = THREE.MathUtils.clamp(look.pitch - (e.clientY - look.lastY) * 0.0028, -1.2, 1.2);
  look.lastX = e.clientX; look.lastY = e.clientY;
  state.heroLock = true;
});

/* ---------------------------------------------------------------- */
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

  player.steer += (steerIn - player.steer) * Math.min(1, dt * 7);
  const grip = 1 / (1 + Math.abs(player.speed) * 0.02);
  player.yaw += player.steer * player.speed * 0.045 * grip * dt * 6;

  const dir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  player.position.addScaledVector(dir, player.speed * dt);

  // stay on the boulevard
  player.position.x = THREE.MathUtils.clamp(player.position.x, -12.9, 13.2);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -100, 1180);

  return dir;
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
  if (state.ready) {
    const dir = step(dt);
    playerSync(carGroup, player, car, dt);
    updateCamera(dt, dir);
    world.update(dt);
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
