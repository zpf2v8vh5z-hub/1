import { readPngRows } from './read-png16.mjs';

global.window = {};
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
require('/home/user/1/public/gta5/map-data.js');
const B = window.__GTA5_MAP_DATA__.buildings;

const W = 9000, H = 13500, SX = -4100, SY = -4300;

// sample the heightmap at a set of world coords, both orientations
const pts = B.filter((b) => b.z > 1 && b.z < 400);
console.log('buildings with z:', pts.length);

const key = (x, y, flipV) => {
  const px = Math.round(x - SX);
  const py = flipV ? (H - 1) - Math.round(y - SY) : Math.round(y - SY);
  if (px < 0 || px >= W || py < 0 || py >= H) return null;
  return py * W + px;
};
const need = new Map();
for (const flip of [true, false]) {
  for (const b of pts) {
    const i = key(b.x, b.y, flip);
    if (i !== null) need.set(i, 0);
  }
}
readPngRows('/tmp/hmap/heightmap.png', (y, row) => {
  const base = y * W;
  for (let x = 0; x < W; x++) {
    const i = base + x;
    if (need.has(i)) need.set(i, row[x]);
  }
});

for (const flip of [true, false]) {
  const pairs = [];
  for (const b of pts) {
    const i = key(b.x, b.y, flip);
    if (i === null) continue;
    const v = need.get(i);
    if (v > 0) pairs.push([v / 65535, b.z]);
  }
  // least squares z = a*v + c
  const n = pairs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [v, z] of pairs) { sx += v; sy += z; sxx += v * v; sxy += v * z; }
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const c = (sy - a * sx) / n;
  let err = 0;
  for (const [v, z] of pairs) err += Math.abs(a * v + c - z);
  console.log(`flip=${flip}  n=${n}  z = ${a.toFixed(1)}*v + ${c.toFixed(1)}  meanAbsErr=${(err / n).toFixed(1)} m`);
}
