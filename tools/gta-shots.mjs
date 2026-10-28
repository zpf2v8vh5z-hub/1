/**
 * San Andreas screenshot + assertion harness.
 *
 *   node tools/gta-shots.mjs [url] [outDir]
 *
 * Boots the real page in headless chromium, waits for the world to be ready,
 * checks a handful of hard requirements and writes the screenshot set used to
 * verify the build by eye.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// chromium comes from the sandbox helper install, if present
const HELPER = process.env.HELPER_DIR || '/tmp/bt';
let puppeteer, chromium;
try {
  const from = createRequire(path.join(HELPER, 'package.json'));
  puppeteer = (await import(pathToFileURL(from.resolve('puppeteer-core')).href)).default;
  chromium = (await import(pathToFileURL(from.resolve('@sparticuz/chromium')).href)).default;
} catch {
  console.error('puppeteer-core / @sparticuz/chromium missing in ' + HELPER + ' — run npm i there');
  process.exit(2);
}

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) || process.env.URL || 'http://127.0.0.1:5173/';
const outDir = args.find((a) => !a.startsWith('http')) || process.env.OUT || '/tmp/dev/gta';
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  args: [...chromium.args, '--enable-unsafe-swiftshader'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /Shader Error|ERROR:/.test(t)) errors.push(t.slice(0, 800));
});
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 400)));

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

console.log('→ loading', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.__gta && window.__gta.ready === true', { timeout: 300000 });
console.log('→ world ready');

const stats = await page.evaluate(() => window.__gta.state.stats);
console.log('  stats', JSON.stringify(stats));

/* ---------------------------------------------------------------- *
 * assertions
 * ---------------------------------------------------------------- */
check('buildings placed', stats.buildings > 3000, `${stats.buildings} buildings`);
check('roads baked', stats.roads.main > 100000, `${stats.roads.main} main quads`);
check('props placed', stats.props.palms > 500 && stats.props.forest > 10000,
  `${stats.props.palms} palms, ${stats.props.forest} trees, ${stats.props.rocks} rocks`);

const aligned = await page.evaluate(() => {
  const g = window.__gta;
  // height must match the real GTA V elevations at known spots
  const pts = [
    ['observatory', -438.8, 1076.1, 352, 26],
    ['vinewood bowl', 686.2, 578.0, 130, 26],
    ['kortz center', -2243.8, 264.0, 175, 22],
    ['chumash pier', -3426.7, 967.7, 8, 14],
    ['chiliad summit', 450.7, 5566.6, 806, 90],
  ];
  return pts.map(([name, x, y, z, tol]) => ({
    name, got: +g.heightAt(x, y).toFixed(1), want: z, ok: Math.abs(g.heightAt(x, y) - z) < tol,
  }));
});
for (const a of aligned) check(`height ${a.name}`, a.ok, `${a.got} m vs ${a.want} m`);

const allBuildings = await page.evaluate(() => {
  const g = window.__gta;
  const rows = g.buildings.data;
  return {
    count: rows.length,
    minGround: Math.min(...rows.map((r) => r.ground)),
    maxHeight: Math.max(...rows.map((r) => r.height)),
    downtown: rows.filter((r) => r.height > 120).length,
    floating: rows.filter((r) => Math.abs(r.ground - g.heightAt(r.x, r.y)) > 30).length,
  };
});
check('no building in the sea', allBuildings.minGround >= -1, `min ground ${allBuildings.minGround.toFixed(1)} m`);
check('no floating buildings', allBuildings.floating === 0, `${allBuildings.floating} far from terrain`);
check('downtown has towers', allBuildings.downtown >= 8, `${allBuildings.downtown} buildings above 120 m`);

// drive test: 400 m along the boulevard, must not fall through the ground
const drive = await page.evaluate(() => {
  const g = window.__gta;
  g.placeCar(-1245, -1460, 0.35);
  const start = { x: g.player.position.x, z: g.player.position.z };
  g.drive(9, 1 / 60, { KeyW: true });
  const end = { x: g.player.position.x, z: g.player.position.z };
  const dist = Math.hypot(end.x - start.x, end.z - start.z);
  const ground = g.heightAt(end.x, end.z);
  return { dist: +dist.toFixed(1), speed: +g.player.speed.toFixed(1), dy: +(g.player.position.y - ground).toFixed(2) };
});
check('car drives', drive.dist > 80, `${drive.dist} m in 9 s at ${drive.speed} m/s`);
check('car stays on the ground', Math.abs(drive.dy) < 2, `${drive.dy} m off the surface`);

// steering: full lock for 2 s must turn the nose
const steerTest = await page.evaluate(() => {
  const g = window.__gta;
  g.placeCar(-1245, -1460, 0);
  g.drive(3, 1 / 60, { KeyW: true });
  const a = g.player.yaw;
  g.drive(1.5, 1 / 60, { KeyW: true, KeyA: true });
  return { turned: +(g.player.yaw - a).toFixed(3) };
});
check('steering works', Math.abs(steerTest.turned) > 0.2, `${steerTest.turned} rad`);

// boundary: driving far out must be blocked by the world edge
const bounds = await page.evaluate(() => {
  const g = window.__gta;
  g.placeCar(-4030, -1000, -Math.PI / 2);
  g.drive(6, 1 / 60, { KeyW: true });
  return { x: +g.player.position.x.toFixed(1), min: g.WORLD.x0 + 40 };
});
check('world edge holds', bounds.x >= bounds.min - 0.5, `x ${bounds.x} (edge ${bounds.min})`);

/* ---------------------------------------------------------------- *
 * screenshots
 * ---------------------------------------------------------------- */
const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => window.__gta.render(0.016));
  await page.screenshot({ path: path.join(outDir, name + '.png') });
  console.log('  shot', name);
};

const look = async (name, cam, target) => {
  await page.evaluate((c, t) => window.__gta.setCamera(c, t), cam, target);
  await shot(name);
};

await page.evaluate(() => {
  const g = window.__gta;
  g.placeCar(-1245, -1460, 0.35);
  g.freeCamera();
  g.tick(1 / 60, 90);
});
await shot('01-spawn-vespucci-beach');

await page.evaluate(() => { const g = window.__gta; g.placeCar(-1250, -1475, 0.12); g.tick(1 / 60, 20); g.chase(8.5, 2.6); });
await shot('02-vespucci-chase');

await look('03-downtown-aerial', [-560, 260, -1400], [-145, 120, -835]);

await page.evaluate(() => window.__gta.setCameraGround(-180, -700, 2.2, -60, 20, -780));
await shot('04-downtown-street');

await look('05-del-perro-pier', [-1740, 40, -700], [-1900, 0, -600]);

await page.evaluate(() => window.__gta.setCameraGround(1700, 3600, 40, 1800, 0, 3800));
await shot('06-desert-sandy-shores');

await look('07-chiliad', [200, 500, 5200], [450, 700, 5600]);

await look('08-alamo-sea', [300, 200, 3300], [300, 40, 3900]);

await look('09-paleto-bay', [-175, 120, 6100], [-175, 10, 6320]);

await look('10-island-overview', [1200, 5200, -6000], [-200, 0, 2000]);

await look('11-lsia-airport', [-1045, 180, -2300], [-1045, 10, -2730]);

await page.evaluate(() => {
  const g = window.__gta;
  g.placeCar(-1245, -1460, 0.35);
  g.freeCamera();
  g.tick(1 / 60, 30);
});
await shot('12-hero-beach-sunset');

/* ---------------------------------------------------------------- */
check('no console/shader errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.evaluate(() => window.__gta.hud(true)).catch(() => {});
await browser.close();

console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL CHECKS PASSED'}`);
console.log('screenshots ->', outDir);
if (errors.length) console.log('errors:\n' + errors.slice(0, 10).join('\n'));
process.exit(fails.length ? 1 : 0);
