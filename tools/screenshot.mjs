/**
 * Headless render test / screenshot tool.
 *
 * Boots the built (or dev) app in headless Chromium with WebGL enabled, waits for
 * the game to report ready, then captures a set of viewpoints. Also fails loudly on
 * console errors, so it doubles as a smoke test.
 *
 *   node tools/screenshot.mjs [url] [--out screenshots] [--w 1920] [--h 1080]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const chromiumPath = process.env.CHROME_PATH || '/tmp/chromium';
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) || process.env.URL || 'http://127.0.0.1:4173/';
const outDir = path.resolve('screenshots');
fs.mkdirSync(outDir, { recursive: true });

const W = Number(process.env.W || 1920);
const H = Number(process.env.H || 1080);

const browser = await puppeteer.launch({
  executablePath: chromiumPath,
  headless: true,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=' + W + ',' + H,
  ],
  protocolTimeout: 300000,
});

const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

const errors = [];
const logs = [];
page.on('console', (m) => {
  const t = `${m.type()}: ${m.text()}`;
  logs.push(t);
  if (m.type() === 'error') errors.push(t);
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

console.log('→ loading', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

// wait for game ready
try {
  await page.waitForFunction('window.__vice && window.__vice.ready === true', { timeout: 240000, polling: 500 });
} catch (e) {
  console.error('✗ game did not become ready');
  console.error(logs.slice(-40).join('\n'));
  await page.screenshot({ path: path.join(outDir, 'FAILED.png') });
  await browser.close();
  process.exit(1);
}
console.log('✓ game ready');

const settle = async (frames = 10) => {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, frames);
};

async function shot(name, setup) {
  if (setup) await page.evaluate(setup);
  await settle(6);
  const file = path.join(outDir, name + '.png');
  await page.screenshot({ path: file });
  const size = fs.statSync(file).size;
  console.log(`✓ ${name}.png (${(size / 1024).toFixed(0)} kB)`);
}

await page.evaluate(async () => { await new Promise(r => setTimeout(r, 1200)); });
// let the intro loader finish fading before the first capture
await page.evaluate(async () => { await new Promise(r => setTimeout(r, 1600)); });

await shot('01-hero', () => {
  window.__vice.hud(false);
  window.__vice.placeCar(-0.2, 0.5, 0);
  window.__vice.setHeroView();
  window.__vice.tick(1 / 60, 30);
});

await shot('02-hud-drive', () => {
  window.__vice.hud(true);
  window.__vice.freeCamera();
  window.__vice.placeCar(-0.4, 40, 0);
  window.__vice.tick(1 / 60, 60);
});

await shot('03-low-angle', () => {
  window.__vice.hud(false);
  window.__vice.setCamera([3.2, 1.15, -3.4], [1.0, 1.0, 20]);
});

await shot('04-photo-aerial', () => {
  window.__vice.setCamera([-46, 30, -26], [2, 2, 62]);
});

await shot('05-hotel-side', () => {
  window.__vice.setCamera([10.5, 3.2, 24], [-14, 8, 60]);
});

await shot('06-rear-close', () => {
  window.__vice.setCamera([1.0, 1.35, -3.0], [0.9, 1.1, 10]);
});

// the money shot: reference-style frame with the in-game HUD visible
await shot('07-reference-style', () => {
  window.__vice.placeCar(-0.2, 0.5, 0);
  window.__vice.setHeroView();
  window.__vice.hud(true);
  window.__vice.tick(1 / 60, 30);
});

// ---- the stretches affected by the skyline bug ------------------------------
await shot('08-mid-boulevard', () => {
  // purple skyline towers used to stand right here, in the middle of the road
  window.__vice.hud(false);
  window.__vice.placeCar(-0.2, 600, 0);
  window.__vice.setHeroView();
  window.__vice.tick(1 / 60, 30);
});

await shot('09-end-of-boulevard', () => {
  window.__vice.placeCar(-0.2, 1600, 0);
  window.__vice.setHeroView();
  window.__vice.tick(1 / 60, 30);
});

// ---- functional tests -------------------------------------------------------
// The software renderer only manages a few frames per second, so the driving
// checks use the deterministic simulation tick instead of wall-clock time.
const key = (type, code) => page.evaluate(
  ([t, c]) => window.dispatchEvent(new KeyboardEvent(t, { code: c })),
  [type, code]
);

await page.evaluate(() => window.__vice.placeCar(0, 20, 0));
await key('keydown', 'KeyW');
const keySeen = await page.evaluate(() => window.__vice.state.keys.KeyW === true);
const drive = await page.evaluate(() => {
  window.__vice.tick(1 / 60, 120);           // 2 s of simulated driving
  const p = window.__vice.player;
  return { z: p.position.z, speed: p.speed };
});
console.log(`→ input plumbed: ${keySeen} · drive test: z 20.0 -> ${drive.z.toFixed(1)}, speed ${drive.speed.toFixed(1)} m/s`);
if (!keySeen || drive.z < 25 || drive.speed < 5) {
  console.error('✗ car did not drive');
  process.exit(3);
}

await key('keyup', 'KeyW');

// steering feel: a short tap must only nudge the nose, and the ESC-menu
// sensitivity setting must scale the yaw rate
const steer = await page.evaluate(() => {
  const V = window.__vice;
  const run = (holdFrames, sens) => {
    V.settings.steerSensitivity = sens;
    V.placeCar(0, 400, 0);
    V.player.speed = 20;
    V.state.keys.KeyA = true;
    V.tick(1 / 60, holdFrames);
    V.state.keys.KeyA = false;
    return Math.abs(V.player.yaw) * 180 / Math.PI;
  };
  const tap = run(6, 0.75);
  const held = run(60, 0.75);
  const slow = run(60, 0.25);
  const fast = run(60, 2);
  V.settings.steerSensitivity = 0.75;
  V.placeCar(0, 20, 0);
  return { tap, held, slow, fast };
});
console.log(`→ steering @20 m/s — tap 100 ms: ${steer.tap.toFixed(1)}° · hold 1 s: ${steer.held.toFixed(1)}° (setting 25 %: ${steer.slow.toFixed(1)}°, 200 %: ${steer.fast.toFixed(1)}°)`);
if (!(steer.tap > 0.2 && steer.tap < 5)) { console.error('✗ a short tap still over-rotates the car'); process.exit(3); }
if (!(steer.held > 15 && steer.held < 90)) { console.error('✗ unexpected steering rate'); process.exit(3); }
if (!(steer.slow < steer.held && steer.held < steer.fast)) { console.error('✗ sensitivity setting has no effect'); process.exit(3); }

// ---- skyline regression: nothing big may stand on the roadway ----
const onRoad = await page.evaluate(() => {
  const V = window.__vice, out = [];
  // a tower that leaked onto the street is: ground based, tall, and its footprint
  // overlaps the roadway. Palms/lamps are shorter, the car is lower.
  V.scene.traverse((o) => {
    if (!o.isMesh || o.name === 'skyline') return;
    if (o.material?.isShaderMaterial) return;   // sky dome, ocean and road shell
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const height = bb.max.y - bb.min.y;
    const touchesRoad = bb.max.x > -9 && bb.min.x < 9 && bb.max.z > -120 && bb.min.z < 2200;
    if (height > 22 && bb.min.y < 3 && touchesRoad) {
      out.push(`${o.name || o.geometry.type} h${height.toFixed(0)} x[${bb.min.x.toFixed(0)},${bb.max.x.toFixed(0)}] z[${bb.min.z.toFixed(0)},${bb.max.z.toFixed(0)}]`);
    }
  });
  return out;
});
console.log(`→ objects on the roadway / in the sea: ${onRoad.length ? onRoad.join(', ') : 'none'}`);
if (onRoad.length) { console.error('✗ scenery is blocking the boulevard'); process.exit(3); }

// ---- ESC menu: opens, freezes, resumes, persists ----
await page.evaluate(() => { window.__vice.placeCar(0, 300, 0); window.__vice.player.speed = 18; });
await page.keyboard.press('Escape');
await page.evaluate(async () => { await new Promise(r => setTimeout(r, 600)); });
const menuOpen = await page.evaluate(() => ({
  paused: window.__vice.state.paused,
  open: document.getElementById('menu').classList.contains('open'),
  rows: document.querySelectorAll('#menu-settings .setting').length,
  moved: Math.abs(window.__vice.player.position.z - 300),
}));
console.log(`→ ESC menu: open=${menuOpen.open} paused=${menuOpen.paused} rows=${menuOpen.rows} car moved while paused=${menuOpen.moved.toFixed(2)} m`);
if (!menuOpen.open || !menuOpen.paused || menuOpen.rows < 3) { console.error('✗ menu did not open'); process.exit(3); }
if (menuOpen.moved > 0.001) { console.error('✗ game kept running while paused'); process.exit(3); }

await shot('10-settings-menu', () => {});

const persisted = await page.evaluate(() => {
  const el = document.getElementById('set-steerSensitivity');
  el.value = '1.2';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    live: window.__vice.settings.steerSensitivity,
    stored: JSON.parse(localStorage.getItem('vice306.settings.v1')).steerSensitivity,
    label: document.querySelector('[data-key="steerSensitivity"] .setting-value').textContent,
  };
});
console.log(`→ sensitivity slider: ${persisted.label} (live ${persisted.live}, stored ${persisted.stored})`);
if (persisted.live !== 1.2 || persisted.stored !== 1.2) { console.error('✗ sensitivity setting not applied/persisted'); process.exit(3); }

await page.click('#menu-resume');
await page.evaluate(async () => { await new Promise(r => setTimeout(r, 200)); });
const resumed = await page.evaluate(() => ({
  paused: window.__vice.state.paused,
  open: document.getElementById('menu').classList.contains('open'),
}));
console.log(`→ resume: paused=${resumed.paused} open=${resumed.open}`);
if (resumed.paused || resumed.open) { console.error('✗ menu did not close'); process.exit(3); }
await page.evaluate(() => { window.__vice.settings.steerSensitivity = 0.75; });

// photo mode toggle + capture path
await page.keyboard.press('KeyP');
await page.evaluate(async () => { await new Promise(r => setTimeout(r, 400)); });
const photoOn = await page.evaluate(() => window.__vice.state.photo);
if (!photoOn) { console.error('✗ photo mode did not toggle'); process.exit(3); }
const dataUrl = await page.evaluate(() => window.__vice.capture().slice(0, 22));
await page.keyboard.press('KeyP');
console.log(`→ photo mode: on · capture: ${dataUrl}...`);
if (!dataUrl.startsWith('data:image/png')) { console.error('✗ capture failed'); process.exit(3); }

// performance sample
const perf = await page.evaluate(async () => {
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < 4000) {
    await new Promise((r) => requestAnimationFrame(r));
    n++;
  }
  return { fps: n / ((performance.now() - t0) / 1000) };
});
console.log(`→ headless fps ≈ ${perf.fps.toFixed(1)}`);

await browser.close();

if (errors.length) {
  console.error('\n✗ console errors:\n' + errors.join('\n'));
  process.exit(2);
}
console.log('\n✓ all shots captured, no console errors');
