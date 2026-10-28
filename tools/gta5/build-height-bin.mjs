/**
 * Bakes the calibrated heightmap into a raw Int16 binary the game reads directly.
 * Int16 with 0.05 m steps over 0..1600 m — precise enough for terrain and physics,
 * and 11 MB instead of the 4.7 MB 16-bit PNG that a browser would truncate to 8 bit.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { readPngRows } from './read-png16.mjs';
import { WORLD, HEIGHT, TERRAIN_TEX } from './world-config.mjs';

const SRC = '/tmp/hmap/heightmap.png';
const SRC_X0 = -4100, SRC_Y0 = -4300, SRC_W = 9000, SRC_H = 13500;
const OUT = path.resolve('public/gta5/terrain/height.bin');

const W = TERRAIN_TEX.w, H = TERRAIN_TEX.h;
const sx = WORLD.width / W, sy = WORLD.height / H;
const srcX0 = WORLD.x0 - SRC_X0;
const srcY0 = SRC_Y0 + SRC_H - WORLD.y1;   // y = (SRC_Y0 + SRC_H) - py

const sum = new Float64Array(W * H);
const cnt = new Uint32Array(W * H);

readPngRows(SRC, (y, row, w) => {
  const ty = Math.floor((y - srcY0) / sy);
  if (ty < 0 || ty >= H) return;
  const base = ty * W;
  for (let x = Math.max(0, Math.floor(srcX0)); x < Math.min(w, Math.ceil(srcX0 + WORLD.width)); x++) {
    const tx = Math.floor((x - srcX0) / sx);
    if (tx < 0 || tx >= W) continue;
    // 0 in the source means "no data" (open sea) -> keep it at sea level
    const v = row[x];
    sum[base + tx] += (v / 65535) * HEIGHT.scale + (v > 0 ? HEIGHT.offset : 0);
    cnt[base + tx]++;
  }
});

// The GTA V height raycasts hit rooftops as well as the ground, which bakes whole
// city blocks into the field as 50-250 m spikes. A box blur plus a "cannot be higher
// than the neighbourhood plus a cliff allowance" rule removes them while leaving the
// real ridges (which change slowly at 4 m sampling) intact.
function declutter(grid) {
  const R = 5;                                    // 11 x 11 texels = 48 m
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const norm = 2 * R + 1;
  // separable box blur
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = -R; x <= R; x++) sum += grid[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = sum / norm;
      const add = grid[y * W + Math.min(W - 1, x + R + 1)];
      const sub = grid[y * W + Math.max(0, x - R)];
      sum += add - sub;
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = -R; y <= R; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      const blur = sum / norm;
      const i = y * W + x;
      // the allowance grows with elevation: rocky summits may be spikier than a
      // city block, where the allowance only has to cover a rooftop
      out[i] = Math.min(grid[i], blur + 4 + grid[i] * 0.07);
      sum += tmp[Math.min(H - 1, y + R + 1) * W + x] - tmp[Math.max(0, y - R) * W + x];
    }
  }
  return out;
}

const heights = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) heights[i] = cnt[i] ? sum[i] / cnt[i] : 0;
// two passes: the first kills the rooftop blocks, the second flattens the terraces
// they leave behind, while real ridges only lose a couple of metres
let cleaned = declutter(heights);
cleaned = declutter(cleaned);

// ---- urban ground ------------------------------------------------------------
// Downtown Los Santos is full of 60-200 m skyscrapers, so the raw raycast field is
// a forest of building tops and no median filter can find the street level under
// them. The street masks, however, ARE ground truth: roads are never covered. So we
// take the lowest height in a 110 m window wherever a street exists, dilate that
// area over the blocks and clamp the field to it.
const STREET_DIR = process.env.GTA_SRC || '/tmp/hmap';
const urban = await streetMask();
function runningMin(src, radius) {
  const tmp = new Float32Array(W * H);
  const out2 = new Float32Array(W * H);
  const win = 2 * radius + 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = Infinity;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k < 0 ? 0 : x + k >= W ? W - 1 : x + k;
        const v = src[y * W + xx];
        if (v < m) m = v;
      }
      tmp[y * W + x] = m;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = Infinity;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k < 0 ? 0 : y + k >= H ? H - 1 : y + k;
        const v = tmp[yy * W + x];
        if (v < m) m = v;
      }
      out2[y * W + x] = m;
    }
  }
  return out2;
}

async function streetMask() {
  const mask = new Uint8Array(W * H);
  for (const file of ['side_streets.png']) {
    const path1 = `${STREET_DIR}/${file}`;
    const { data, info } = await sharp(path1).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    for (let ty = 0; ty < H; ty++) {
      const wy = WORLD.y1 - (ty / (H - 1)) * WORLD.height;
      const py = Math.round(9199 - wy);
      if (py < 0 || py >= h) continue;
      for (let tx = 0; tx < W; tx++) {
        const wx = WORLD.x0 + (tx / (W - 1)) * WORLD.width;
        const px = Math.round(wx + 4100);
        if (px < 0 || px >= w) continue;
        if (data[py * w + px] > 96) mask[ty * W + tx] = 1;
      }
    }
  }
  // dilate over the blocks: 16 texels ~ 70 m
  const out = new Uint8Array(W * H);
  const R = 16;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let hit = 0;
      for (let dy = -R; dy <= R && !hit; dy += 4) {
        const yy = Math.min(H - 1, Math.max(0, y + dy));
        for (let dx = -R; dx <= R; dx += 4) {
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          if (mask[yy * W + xx]) { hit = 1; break; }
        }
      }
      out[y * W + x] = hit;
    }
  }
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i];
  console.log(`  urban area: ${((n / out.length) * 100).toFixed(1)} % of the world`);
  return out;
}

// ---------------------------------------------------------------------------
// ground shaping
// ---------------------------------------------------------------------------
function blurField(src, R) {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const norm = 2 * R + 1;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let k = -R; k <= R; k++) s += src[y * W + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s / norm;
      s += src[y * W + Math.min(W - 1, x + R + 1)] - src[y * W + Math.max(0, x - R)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -R; k <= R; k++) s += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / norm;
      s += tmp[Math.min(H - 1, y + R + 1) * W + x] - tmp[Math.max(0, y - R) * W + x];
    }
  }
  return out;
}

function medianFilter(src, R) {
  const out = new Float32Array(W * H);
  const win = new Float32Array((2 * R + 1) * (2 * R + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let k = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy)) * W;
        for (let dx = -R; dx <= R; dx++) {
          win[k++] = src[yy + Math.min(W - 1, Math.max(0, x + dx))];
        }
      }
      const sorted = win.subarray(0, k).sort();
      out[y * W + x] = sorted[k >> 1];
    }
  }
  return out;
}

/** 1 where the 1 m street masks cover the texel, dilated by `pad` texels */
async function maskDilated(files, threshold, pad) {
  const mask = new Uint8Array(W * H);
  for (const file of files) {
    const { data, info } = await sharp(`${STREET_DIR}/${file}`)
      .extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    for (let ty = 0; ty < H; ty++) {
      const wy = WORLD.y1 - (ty / (H - 1)) * WORLD.height;
      const py = Math.round(9199 - wy);
      if (py < 0 || py >= h) continue;
      for (let tx = 0; tx < W; tx++) {
        const wx = WORLD.x0 + (tx / (W - 1)) * WORLD.width;
        const px = Math.round(wx + 4100);
        if (px < 0 || px >= w) continue;
        if (data[py * w + px] > threshold) mask[ty * W + tx] = 1;
      }
    }
  }
  if (!pad) return mask;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let hit = 0;
      for (let dy = -pad; dy <= pad && !hit; dy++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy)) * W;
        for (let dx = -pad; dx <= pad; dx++) {
          if (mask[yy + Math.min(W - 1, Math.max(0, x + dx))]) { hit = 1; break; }
        }
      }
      out[y * W + x] = hit;
    }
  }
  return out;
}

// ---- 1. clamp the urban ground to the street level --------------------------
const groundRef = runningMin(cleaned, 8);
for (let i = 0; i < W * H; i++) {
  if (urban[i]) cleaned[i] = Math.min(cleaned[i], groundRef[i] + 3);
  // no terrain feature may tower more than 45 m over its 40 m neighbourhood
  if (cleaned[i] - groundRef[i] > 45) cleaned[i] = groundRef[i] + 45;
}

// ---- 2. smooth the island ---------------------------------------------------
// The source raycast field carries metres of building-top noise on almost every
// texel, and the roads are laid on exactly this surface at runtime: any jitter makes
// the asphalt sink into the ground in one place and float in the next. A 5x5 median
// kills the leftovers, a 35 m blur turns the rest into ground a 5 m terrain mesh can
// follow. After this pass the field is smooth enough that the terrain and the road
// mesh agree to a few centimetres.
let flat = medianFilter(cleaned, 2);
flat = medianFilter(flat, 1);
flat = blurField(blurField(flat, 4), 4);

// ---- 3. flatten the carriageway --------------------------------------------
// Inside the street masks (plus a 13 m shoulder) the ground is a 35 m blur, i.e. a
// graded road bed, so the asphalt quads have nothing to cut through.
const roads = await maskDilated(['main_streets.png', 'side_streets.png'], 80, 3);
const smoothRoad = blurField(blurField(flat, 6), 6);
for (let i = 0; i < W * H; i++) cleaned[i] = roads[i] ? smoothRoad[i] : flat[i];

const bin = Buffer.alloc(W * H * 2);
let min = Infinity, max = -Infinity;
for (let i = 0; i < W * H; i++) {
  const h = cleaned[i];
  if (h < min) min = h;
  if (h > max) max = h;
  // 5 cm resolution (int16 over +/-1600 m, so the 800 m peak never clamps)
  bin.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(h * 20))), i * 2);
}
fs.writeFileSync(OUT, bin);

const meta = JSON.parse(fs.readFileSync('public/gta5/terrain/meta.json', 'utf8'));
meta.heightBin = { file: 'height.bin', width: W, height: H, scale: 1 / 20, min, max };
fs.writeFileSync('public/gta5/terrain/meta.json', JSON.stringify(meta, null, 2));

console.log(`✓ height.bin ${W}x${H} = ${(bin.length / 1e6).toFixed(1)} MB, range ${min.toFixed(1)}..${max.toFixed(1)} m`);
