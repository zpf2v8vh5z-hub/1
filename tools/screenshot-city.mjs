/**
 * City render test / screenshot tool.
 *
 * Boots the app headless, captures the new inland district (gates, avenues,
 * plaza, park, civic buildings, fence) and asserts the things that used to be
 * broken: buildings on carriageways, missing materials, and a city you can
 * drive out of.
 *
 *   node tools/screenshot-city.mjs [url]
 */
import fs from 'node:fs';
import path from 'node:path';
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

console.log('→ loading', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
try {
  await page.waitForFunction('window.__vice && window.__vice.ready === true', { timeout: 240000, polling: 500 });
} catch (e) {
  console.error('✗ game did not become ready');
  await page.screenshot({ path: path.join(outDir, 'FAILED.png') });
  await browser.close();
  process.exit(1);
}
console.log('✓ game ready');

const settle = async (frames = 6) => {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, frames);
};

async function shot(name, setup, ...argv) {
  if (setup) await page.evaluate(setup, ...argv);
  await settle(6);
  const file = path.join(outDir, name + '.png');
  await page.screenshot({ path: file });
  console.log(`✓ ${name}.png (${(fs.statSync(file).size / 1024).toFixed(0)} kB)`);
}

await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 2400)); });

/* ------------------------------------------------------------------ *
 * structural checks
 * ------------------------------------------------------------------ */
const city = await page.evaluate(() => {
  const c = window.__vice.city;
  return {
    lots: c.lots.length,
    kinds: [...new Set(c.lots.map((l) => l.kind))].sort(),
    labels: c.labels,
    missing: c.missingMats || [],
    colliders: c.colliders.length,
    grid: { avenues: c.grid.avenues, gates: c.grid.gates, border: c.grid.border, ring: c.grid.ring },
  };
});
console.log(`→ district: ${city.lots} blocks · ${city.kinds.length} block types`);
console.log(`→ block types: ${city.kinds.join(', ')}`);
console.log(`→ streets: ${city.grid.avenues.join(' / ')} · gates at z ${city.grid.gates.join(', ')}`);

const required = ['school', 'hospital', 'police', 'fire', 'church', 'cinema', 'sports', 'market',
  'park', 'playground', 'plaza', 'gas', 'parking'];
const missingKinds = required.filter((k) => !city.kinds.includes(k));
if (missingKinds.length) { console.error('✗ missing city facilities: ' + missingKinds.join(', ')); process.exit(3); }
if (city.missing.length) { console.error('✗ block batches without a material: ' + city.missing.join(', ')); process.exit(3); }

// nothing may stand on a carriageway
const onStreet = await page.evaluate(() => {
  const V = window.__vice;
  const g = V.city.grid;
  const roads = [];
  for (const ax of g.avenues) {
    roads.push({ x0: ax - g.avenueHalf, x1: ax + g.avenueHalf, z0: g.crossZ0 - 40, z1: g.crossZ1 + 40 });
  }
  const step = (g.crossZ1 - g.crossZ0) / (g.crossCount - 1);
  for (let i = 0; i < g.crossCount; i++) {
    const cz = g.crossZ0 + i * step;
    roads.push({ x0: 0, x1: g.ring.xEast + g.ring.half, z0: cz - g.crossHalf, z1: cz + g.crossHalf });
  }
  roads.push({ x0: g.ring.xEast - g.ring.half, x1: g.ring.xEast + g.ring.half, z0: g.ring.zA, z1: g.ring.zB });
  const hits = [];
  for (const c of V.city.colliders) {
    if (c.kind === 'fence') continue;
    const b = { x0: c.x - c.w / 2, x1: c.x + c.w / 2, z0: c.z - c.d / 2, z1: c.z + c.d / 2 };
    for (const r of roads) {
      if (b.x0 < r.x1 - 0.5 && b.x1 > r.x0 + 0.5 && b.z0 < r.z1 - 0.5 && b.z1 > r.z0 + 0.5) {
        hits.push(`${c.kind} at x${c.x.toFixed(0)} z${c.z.toFixed(0)}`);
        break;
      }
    }
  }
  return hits;
});
console.log(`→ buildings overlapping a carriageway: ${onStreet.length ? onStreet.join(', ') : 'none'}`);
if (onStreet.length) { console.error('✗ a block stands on a road'); process.exit(3); }

/* ------------------------------------------------------------------ *
 * driving checks: in through a gate, blocked by buildings, stopped by the fence
 * ------------------------------------------------------------------ */
const drive = await page.evaluate(() => {
  const V = window.__vice;
  const out = {};
  // 1) from the boulevard east through the gate at z = 500 into the district
  V.placeCar(0.9, 500, Math.PI / 2);          // yaw PI/2 faces +X (inland)
  V.state.keys.KeyW = true;
  V.tick(1 / 30, 300);
  out.throughGate = { x: +V.player.position.x.toFixed(1), z: +V.player.position.z.toFixed(1) };
  // 2) all the way east until the fence stops the car
  V.tick(1 / 30, 900);
  out.atFence = { x: +V.player.position.x.toFixed(1), z: +V.player.position.z.toFixed(1) };
  // 3) straight into a housing block: the car must stop short of it
  const block = V.city.colliders.find((c) => c.kind === 'deco' || c.kind === 'brick' || c.kind === 'shops');
  V.placeCar(block.x, block.z - block.d / 2 - 26, 0);   // 26 m south of the block, facing +Z
  V.tick(1 / 30, 240);
  out.intoBlock = { z: +V.player.position.z.toFixed(1), blockSouth: +(block.z - block.d / 2).toFixed(1) };
  // 4) north out of the district
  V.placeCar(V.city.grid.avenues[1], 1900, 0);
  V.tick(1 / 30, 600);
  out.north = { z: +V.player.position.z.toFixed(1) };
  V.state.keys.KeyW = false;
  return { out, border: V.city.grid.border };
});
const d = drive.out;
const B = drive.border;
console.log(`→ gate crossing: x ${d.throughGate.x} (hotel row ends at x 62) · fence stop at x ${d.atFence.x} (fence x ${B.xEast})`);
console.log(`→ wall test: stopped at z ${d.intoBlock.z}, block face z ${d.intoBlock.blockSouth}`);
console.log(`→ north edge: z ${d.north.z} (fence z ${B.zB})`);
if (d.throughGate.x < 70) { console.error('✗ the car cannot reach the district'); process.exit(3); }
if (d.atFence.x > B.xEast) { console.error('✗ the car drove through the fence'); process.exit(3); }
if (d.intoBlock.z > d.intoBlock.blockSouth - 0.4) { console.error('✗ the car drove into a building'); process.exit(3); }
if (d.north.z > B.zB) { console.error('✗ the car left the district to the north'); process.exit(3); }

/* ------------------------------------------------------------------ *
 * shots
 * ------------------------------------------------------------------ */
const lots = await page.evaluate(() => window.__vice.city.lots.map((l) => ({ k: l.kind, x: l.cx, z: l.cz })));
const by = (k) => lots.find((l) => l.k === k);
const plaza = by('plaza');
const park = by('park');
const hospital = by('hospital');
const market = by('market');
const avenue = city.grid.avenues[2];

await shot('11-city-aerial', () => {
  window.__vice.hud(false);
  window.__vice.placeCar(0, 300, 0);
  window.__vice.setCamera([-60, 190, 120], [400, 0, 1050]);
});

await shot('12-city-gate', () => {
  window.__vice.placeCar(-2, 500, Math.PI / 2);
  window.__vice.setCamera([-6, 3.4, 470], [140, 7, 505]);
});

await shot('13-city-avenue', (av) => {
  window.__vice.hud(true);
  window.__vice.placeCar(av + 2.4, 520, 0);
  window.__vice.setCamera([av + 1.2, 2.4, 506], [av + 1.2, 2.1, 740]);
}, avenue);

await shot('14-city-plaza', (l) => {
  window.__vice.hud(false);
  window.__vice.placeCar(-1000, -5000, 0);
  window.__vice.setCamera([l.x - 105, 38, l.z - 75], [l.x, 5, l.z]);
}, plaza);

await shot('15-city-park', (l) => {
  window.__vice.setCamera([l.x - 95, 30, l.z - 85], [l.x, 4, l.z]);
}, park);

await shot('16-city-hospital', (l) => {
  window.__vice.setCamera([l.x - 80, 34, l.z - 80], [l.x, 8, l.z]);
}, hospital);

await shot('17-city-market', (l) => {
  window.__vice.setCamera([l.x - 60, 26, l.z - 60], [l.x, 5, l.z]);
}, market);

await shot('18-city-border', (bx) => {
  window.__vice.setCamera([bx - 70, 2.2, 1300], [bx + 30, 1.6, 1330]);
}, B.xEast);

await browser.close();

if (errors.length) {
  console.error('\n✗ console errors:\n' + errors.join('\n'));
  process.exit(2);
}
console.log('\n✓ city shots captured, boundary holds, no console errors');
