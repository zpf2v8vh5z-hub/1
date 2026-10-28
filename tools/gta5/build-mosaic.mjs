/**
 * Builds the satellite mosaic used as the terrain's macro albedo (and the minimap).
 *
 * The tile pyramids are indexed {z}/{col}-{row}.webp with 256 px tiles. The z5
 * calibration from the map app is px = 3755.5 + x*0.66, py = 5524.5 - y*0.66,
 * so zoom z has 0.66/2^(5-z) px per metre.
 *
 * We composite z4 (0.33 px/m) into 2048x2048 quadrants, join them, crop the
 * world rectangle and resample to the terrain texture size.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { WORLD as W, TERRAIN_TEX } from './world-config.mjs';

const TILES = 'public/tiles/satelite';
const OUT = 'public/gta5/terrain';
const Z = 4;
const N = 2 ** Z;                 // 16 x 16 tiles
const TILE = 256;
const PX_PER_M = 0.66 / 2 ** (5 - Z);   // 0.33
const ORIGIN_X = 3755.5 / 2 ** (5 - Z); // 1877.75
const ORIGIN_Y = 5524.5 / 2 ** (5 - Z); // 2762.25

const WORLD = W;
const OUT_W = TERRAIN_TEX.w, OUT_H = TERRAIN_TEX.h;

const worldToPx = (x) => ORIGIN_X + x * PX_PER_M;
const worldToPy = (y) => ORIGIN_Y - y * PX_PER_M;

/** composites a rectangular region of tiles into one raw RGBA buffer */
async function compose(cols, rows) {
  const W = cols.length * TILE;
  const H = rows.length * TILE;
  const canvas = Buffer.alloc(W * H * 3, 0);
  let missing = 0;
  for (const col of cols) {
    for (const row of rows) {
      const f = path.join(TILES, String(Z), `${col}-${row}.webp`);
      if (!fs.existsSync(f)) { missing++; continue; }
      const { data } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const ox = (col - cols[0]) * TILE;
      const oy = (row - rows[0]) * TILE;
      for (let y = 0; y < TILE; y++) {
        const src = y * TILE * 3;
        const dst = ((oy + y) * W + ox) * 3;
        data.copy(canvas, dst, src, src + TILE * 3);
      }
    }
  }
  if (missing) console.log(`  (${missing} tiles missing in ${cols[0]}..${cols.at(-1)} / ${rows[0]}..${rows.at(-1)})`);
  return { canvas, W, H };
}

console.log('→ compositing satellite quadrants');
const all = [];
for (let qy = 0; qy < 2; qy++) {
  for (let qx = 0; qx < 2; qx++) {
    const cols = [], rows = [];
    for (let i = 0; i < N / 2; i++) cols.push(qx * (N / 2) + i);
    for (let i = 0; i < N / 2; i++) rows.push(qy * (N / 2) + i);
    const { canvas, W, H } = await compose(cols, rows);
    const file = path.join(OUT, `_q${qy}${qx}.png`);
    await sharp(canvas, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(file);
    all.push({ input: file, left: qx * W, top: qy * H });
    console.log(`  quadrant ${qy}${qx} done`);
  }
}

const MOSAIC = N * TILE;   // 4096
const mosaicFile = path.join(OUT, '_mosaic.png');
await sharp({ create: { width: MOSAIC, height: MOSAIC, channels: 3, background: { r: 8, g: 20, b: 34 } } })
  .composite(all)
  .png({ compressionLevel: 9 })
  .toFile(mosaicFile);
console.log('  mosaic', MOSAIC + 'px');

// crop the world rectangle (clamped to the mosaic) and resample
const left = Math.max(0, Math.floor(worldToPx(WORLD.x0)));
const right = Math.min(MOSAIC, Math.ceil(worldToPx(WORLD.x1)));
const top = Math.max(0, Math.floor(worldToPy(WORLD.y1)));
const bottom = Math.min(MOSAIC, Math.ceil(worldToPy(WORLD.y0)));
console.log(`  crop x[${left},${right}] y[${top},${bottom}] = ${right - left}x${bottom - top}`);

await sharp(mosaicFile)
  .extract({ left, top, width: right - left, height: bottom - top })
  .resize(OUT_W, OUT_H, { fit: 'fill', kernel: 'lanczos3' })
  .jpeg({ quality: 84, mozjpeg: true })
  .toFile(path.join(OUT, 'satellite.jpg'));

// a small version for the HUD minimap
await sharp(path.join(OUT, 'satellite.jpg'))
  .resize(512, 768, { fit: 'fill' })
  .jpeg({ quality: 78, mozjpeg: true })
  .toFile(path.join(OUT, 'minimap.jpg'));

for (const f of all) fs.unlinkSync(f.input);
fs.unlinkSync(mosaicFile);

const meta = { world: WORLD, satPx: { left, top, right, bottom }, pxPerM: PX_PER_M, zoom: Z };
fs.writeFileSync(path.join(OUT, 'satellite.json'), JSON.stringify(meta, null, 2));
console.log('✓ satellite mosaic ready');
