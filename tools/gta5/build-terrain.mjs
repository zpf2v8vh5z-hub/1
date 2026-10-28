/**
 * Bakes the GTA V world data into the textures the game streams at runtime.
 *
 * Sources (see /tmp/hmap, generated from the game's own heightmap):
 *   heightmap.png     9000 x 13500, 16-bit grey, 1 px = 1 m, origin (-4100, -4300)
 *   water.png         RGBA mask
 *   main_streets.png  RGBA mask (highways)
 *   side_streets.png  RGBA mask (city streets)
 *   tree_mask.png     grey mask
 *
 * Output -> public/gta5/terrain/
 *   height.png     16-bit greyscale, world height in metres / MAX_H
 *   water.png      8-bit mask
 *   roads.png      8-bit mask
 *   trees.png      8-bit mask
 *   meta.json      bounds + calibration
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPngRows } from './read-png16.mjs';
import { readPngRGBA } from './read-png-rgba.mjs';
import { writePng } from './write-png.mjs';
import { WORLD, HEIGHT, TERRAIN_TEX, MASK_TEX } from './world-config.mjs';

const SRC = '/tmp/hmap';
const OUT = path.resolve('public/gta5/terrain');
fs.mkdirSync(OUT, { recursive: true });

// ---- world calibration --------------------------------------------------------
const SRC_X0 = -4100, SRC_Y0 = -4300;     // world coords of source pixel (0,0)
const SRC_W = 9000, SRC_H = 13500;
const HEIGHT_SCALE = HEIGHT.scale;         // h(m) = v/65535 * 672
const HEIGHT_OFFSET = HEIGHT.offset;

// runtime grid: ~4.4 m per texel — enough for hills, cheap enough for the GPU
const OUT_W = TERRAIN_TEX.w, OUT_H = TERRAIN_TEX.h;

function bake(name, opts) {
  const { file, outW, outH, channels = 1, transform, pick } = opts;
  const sum = new Float32Array(outW * outH);
  const cnt = new Uint32Array(outW * outH);
  // source pixel -> output texel mapping over the WORLD rectangle only
  const sx = WORLD.width / outW, sy = WORLD.height / outH;
  const srcX0 = WORLD.x0 - SRC_X0;         // left source column
  const srcY0 = SRC_Y0 + SRC_H - WORLD.y1;   // y = (SRC_Y0 + SRC_H) - py         // flipped source row of WORLD.y1

  const onRow = (y, row, w, h) => {
    const ty = Math.floor((y - srcY0) / sy);
    if (ty < 0 || ty >= outH) return;
    const rowBase = ty * outW;
    for (let x = Math.max(0, Math.floor(srcX0)); x < w; x++) {
      const tx = Math.floor((x - srcX0) / sx);
      if (tx < 0) continue;
      if (tx >= outW) break;
      const i = rowBase + tx;
      sum[i] += transform ? transform(row, x, y, w, h) : row[x];
      cnt[i]++;
    }
  };
  const t0 = Date.now();
  if (channels === 1 && !pick) readPngRows(path.join(SRC, file), onRow);
  else readPngRGBA(path.join(SRC, file), onRow);
  console.log(`  ${file} -> ${outW}x${outH} in ${Date.now() - t0} ms`);

  const out = new Float32Array(outW * outH);
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] ? sum[i] / cnt[i] : 0;
  return out;
}

console.log('→ heightmap');
const heights = bake('height', { file: 'heightmap.png', outW: OUT_W, outH: OUT_H });

// 16-bit png, normalised to the calibrated max
const g16 = Buffer.alloc(OUT_W * OUT_H * 2);
let hMin = Infinity, hMax = -Infinity;
for (let i = 0; i < heights.length; i++) {
  const v = (heights[i] / 65535) * HEIGHT_SCALE + HEIGHT_OFFSET;
  heights[i] = v;
  if (v < hMin) hMin = v;
  if (v > hMax) hMax = v;
}
for (let i = 0; i < heights.length; i++) {
  const n = Math.max(0, Math.min(65535, Math.round((heights[i] / hMax) * 65535)));
  g16.writeUInt16BE(n, i * 2);
}
console.log(`  height range ${hMin.toFixed(1)} .. ${hMax.toFixed(1)} m`);
writePng(path.join(OUT, 'height.png'), OUT_W, OUT_H, 'grey16', g16);

// masks are 8-bit, half resolution is plenty
const MW = MASK_TEX.w, MH = MASK_TEX.h;
function bakeMask(file, transform) {
  console.log(`→ ${file}`);
  const v = bake(file, { file, outW: MW, outH: MH, channels: 4, transform });
  const g8 = Buffer.alloc(MW * MH);
  for (let i = 0; i < v.length; i++) g8[i] = Math.max(0, Math.min(255, Math.round(v[i])));
  writePng(path.join(OUT, file.replace(/\.png$/, '-mask.png')), MW, MH, 'grey8', g8);
  let cov = 0;
  for (let i = 0; i < g8.length; i++) if (g8[i] > 32) cov++;
  console.log(`  ${((cov / g8.length) * 100).toFixed(1)} % covered`);
  return v;
}

bakeMask('water.png', (row, x) => {
  const a = row[x * 4 + 3];
  return a > 8 ? 255 : 0;
});
bakeMask('main_streets.png', (row, x) => {
  const i = x * 4;
  return Math.max(row[i], row[i + 3]);
});
bakeMask('side_streets.png', (row, x) => {
  const i = x * 4;
  return Math.max(row[i], row[i + 3]);
});
bakeMask('tree_mask.png', (row, x) => {
  const i = x * 4;
  return row[i];
});

const meta = {
  world: WORLD,
  height: { scale: HEIGHT_SCALE, offset: HEIGHT_OFFSET, max: hMax, min: hMin, texture: [OUT_W, OUT_H] },
  masks: { width: MW, height: MH },
};
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log('\n✓ terrain baked ->', OUT);
