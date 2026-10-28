/**
 * Bakes the drivable road network from the 1 m GTA V street masks.
 *
 * The street masks store their data in the alpha channel only, so sharp is used
 * to extract it (8-bit — safe, unlike the 16-bit heightmap).
 *
 * Strategy: reduce the mask to 2 m cells, then greedy-mesh the road pixels into
 * rectangles capped at 12 m so every quad still follows the terrain. Output is a
 * flat Float32 buffer of quad corners (x, z pairs) — the Y is sampled from the
 * terrain at runtime, so the asphalt always sits exactly on the rendered surface.
 *
 * Output: public/gta5/terrain/roads-{main,side,rail}.bin
 *   int32 quadCount, then quadCount * 4 * 2 floats (x, z)
 *
 * Mask frame (same as the heightmap): px = x + 4100, py = 13499 - (y + 4300).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { WORLD } from './world-config.mjs';

const SRC = process.env.GTA_SRC || '/tmp/hmap';
const OUT = path.resolve('public/gta5/terrain');
const CELL = 2;                                   // metres per cell
const MAXSPAN = 4;                                // cells per quad side (8 m)
const THRESH = 96;

const COLS = Math.floor(WORLD.width / CELL);      // 4500
const ROWS = Math.floor(WORLD.height / CELL);     // 6205

const PX0 = 4100;                                 // px = x + 4100
const PYX = 4100, PYY = 9199;                     // px = x + 4100, py = 9199 - y

async function gridFor(file) {
  console.log(`→ ${path.basename(file)}`);
  const { data, info } = await readChannelAsync(file);
  const w = info.width, h = info.height;
  const grid = new Uint8Array(COLS * ROWS);

  // world bounds -> mask pixels
  const pxStart = Math.max(0, Math.round(WORLD.x0 + PX0));
  const pxEnd = Math.min(w - 1, Math.round(WORLD.x1 + PX0));
  const pyStart = Math.max(0, Math.round(PYY - WORLD.y1));
  const pyEnd = Math.min(h - 1, Math.round(PYY - WORLD.y0));

  for (let gx = 0; gx < COLS; gx++) {
    const wx = WORLD.x0 + gx * CELL;
    const px0 = Math.round(wx + PX0), px1 = Math.min(w - 1, px0 + CELL);
    if (px0 < 0 || px0 >= w) continue;
    for (let gy = 0; gy < ROWS; gy++) {
      const wy = WORLD.y1 - gy * CELL;
      const py0 = Math.round(PYY - wy), py1 = Math.min(h - 1, py0 + CELL);
      if (py0 < 0 || py0 >= h) continue;
      let hit = 0;
      for (let py = py0; py <= py1 && !hit; py++) {
        const o = py * w;
        for (let px = px0; px <= px1; px++) {
          if (data[o + px] > THRESH) { hit = 1; break; }
        }
      }
      if (hit) grid[gy * COLS + gx] = 1;
    }
  }
  let n = 0;
  for (let i = 0; i < grid.length; i++) n += grid[i];
  console.log(`  ${((n / grid.length) * 100).toFixed(2)} % of the world is covered`);
  return grid;
}

async function readChannelAsync(file) {
  return sharp(file).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
}

function quads(grid) {
  const used = new Uint8Array(grid.length);
  const out = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      if (!grid[i] || used[i]) continue;
      let w = 0;
      while (w < MAXSPAN && x + w < COLS && grid[i + w] && !used[i + w]) w++;
      let h = 1;
      outer:
      while (h < MAXSPAN && y + h < ROWS) {
        const b = (y + h) * COLS + x;
        for (let k = 0; k < w; k++) if (!grid[b + k] || used[b + k]) break outer;
        h++;
      }
      for (let yy = 0; yy < h; yy++) {
        const b = (y + yy) * COLS + x;
        for (let xx = 0; xx < w; xx++) used[b + xx] = 1;
      }
      out.push([x, y, w, h]);
    }
  }
  return out;
}

function writeBin(file, list) {
  const buf = Buffer.alloc(4 + list.length * 4 * 2 * 4);
  buf.writeInt32LE(list.length, 0);
  let o = 4;
  for (const [x, y, w, h] of list) {
    // half a metre of bleed on every side: neighbouring quads are tilted differently
    // on a slope, and the overlap keeps the terrain from showing through the joins
    const PAD = 0.2;
    const wx0 = WORLD.x0 + x * CELL - PAD, wx1 = WORLD.x0 + (x + w) * CELL + PAD;
    const wy1 = WORLD.y1 - y * CELL + PAD, wy0 = WORLD.y1 - (y + h) * CELL - PAD;
    const pts = [[wx0, wy1], [wx1, wy1], [wx0, wy0], [wx1, wy0]];
    for (const [px, py] of pts) {
      buf.writeFloatLE(px, o); o += 4;
      buf.writeFloatLE(py, o); o += 4;
    }
  }
  fs.writeFileSync(file, buf);
  console.log(`  ${path.basename(file)}: ${list.length} quads, ${(buf.length / 1048576).toFixed(2)} MB`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [src, dst] of [
    ['main_streets.png', 'roads-main.bin'],
    ['side_streets.png', 'roads-side.bin'],
    ['train_tracks.png', 'roads-rail.bin'],
  ]) {
    const grid = await gridFor(path.join(SRC, src));
    writeBin(path.join(OUT, dst), quads(grid));
  }
  console.log('done');
}

main();
