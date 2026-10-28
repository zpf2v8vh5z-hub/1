/**
 * Packs the per-texel world masks into one RGBA control texture for the terrain
 * shader:  R = water, G = roads, B = trees, A = height (0..255 over 0..672 m).
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPngRGBA } from './read-png-rgba.mjs';
import { writePng } from './write-png.mjs';
import { MASK_TEX, TERRAIN_TEX, HEIGHT } from './world-config.mjs';

const DIR = 'public/gta5/terrain';
const W = MASK_TEX.w, H = MASK_TEX.h;

const load = (file) => {
  const out = new Float32Array(W * H);
  const cnt = new Uint32Array(W * H);
  const sx = 0, sy = 0; // masks are already at MASK_TEX
  readPngRGBA(path.join(DIR, file), (y, row) => {
    const base = y * W;
    for (let x = 0; x < W; x++) {
      out[base + x] = row[x * 4];
      cnt[base + x] = 1;
    }
  });
  void sx; void sy; void cnt;
  return out;
};

console.log('→ control.png');
const water = load('water-mask.png');
const main = load('main_streets-mask.png');
const side = load('side_streets-mask.png');
const trees = load('tree_mask-mask.png');

// height from the 16-bit png, downsampled to mask resolution (box filter)
const heightRaw = fs.readFileSync(path.join(DIR, 'height.png'));
const { readPngRows } = await import('./read-png16.mjs');
const tmp = path.join(DIR, '_h16.png');
fs.writeFileSync(tmp, heightRaw);
const th = new Float32Array(W * H);
const cnt = new Uint32Array(W * H);
const hx = TERRAIN_TEX.w / W, hy = TERRAIN_TEX.h / H;
readPngRows(tmp, (y, row, w) => {
  const ty = Math.min(H - 1, Math.floor(y / hy));
  const base = ty * W;
  for (let x = 0; x < w; x++) {
    const tx = Math.min(W - 1, Math.floor(x / hx));
    const i = base + tx;
    th[i] += (row[x] / 65535) * HEIGHT.scale;
    cnt[i]++;
  }
});
fs.unlinkSync(tmp);

const px = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  px[i * 4] = Math.min(255, water[i] * 3);
  px[i * 4 + 1] = Math.min(255, Math.max(main[i], side[i] * 0.9) * 2.2);
  px[i * 4 + 2] = Math.min(255, trees[i]);
  px[i * 4 + 3] = Math.min(255, Math.round(((cnt[i] ? th[i] / cnt[i] : 0) / HEIGHT.scale) * 255));
}
const size = writePng(path.join(DIR, 'control.png'), W, H, 'rgba8', px);
console.log(`✓ control.png ${W}x${H} — ${(size / 1024).toFixed(0)} kB`);
