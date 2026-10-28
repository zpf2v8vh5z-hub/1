// Prepares the AI-generated source textures in public/textures_src/ for use in-engine:
//  - resizes to game-friendly resolutions (JPEG for opaque, PNG for alpha)
//  - keyeout the black background of the palm frond + tight crop
//  - derives normal maps from the luminance of the asphalt / bark
// Usage: node tools/prepare-textures.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'public/textures_src';
const OUT = 'public/textures';
fs.mkdirSync(OUT, { recursive: true });

const jobs = [
  ['asphalt.jpg', 'asphalt.jpg', 1024, 1024, 84],
  ['sidewalk.jpg', 'sidewalk.jpg', 1024, 1024, 84],
  ['ocean.jpg', 'ocean.jpg', 1024, 1024, 82],
  ['facade_neon.jpg', 'facade_neon.jpg', 1408, 768, 86],
  ['facade_white.jpg', 'facade_white.jpg', 1408, 768, 86],
  ['palm_bark.jpg', 'palm_bark.jpg', 704, 704, 86],
  ['clouds.jpg', 'clouds.jpg', 1408, 768, 86],
  ['sand_src.jpg', 'sand.jpg', 512, 512, 84],
  ['grass.jpg', 'grass.jpg', 1024, 1024, 84],
  ['field.jpg', 'field.jpg', 1024, 1024, 84],
  ['hedge.jpg', 'hedge.jpg', 512, 512, 86],
  ['paving.jpg', 'paving.jpg', 1024, 1024, 86],
  ['facade_brick.jpg', 'facade_brick.jpg', 1024, 1024, 86],
  ['facade_modern.jpg', 'facade_modern.jpg', 1408, 768, 86],
  ['shopfront.jpg', 'shopfront.jpg', 1408, 768, 86],
  ['facade_civic.jpg', 'facade_civic.jpg', 1408, 768, 86],
];

for (const [src, dst, w, h, q] of jobs) {
  await sharp(path.join(SRC, src))
    .resize(w, h, { fit: 'fill' })
    .jpeg({ quality: q, mozjpeg: true })
    .toFile(path.join(OUT, dst));
  console.log('->', dst, w + 'x' + h);
}

// ---- palm frond: black background -> alpha, then tight crop ----
{
  // the generated frond sits slightly diagonal -> level it out before keying
  const levelled = await sharp(path.join(SRC, 'palm_frond.jpg'))
    .rotate(-13, { background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();
  const img = sharp(levelled).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    // soft key: kill the black backdrop, keep the leaf with a clean edge
    const a = Math.max(0, Math.min(1, (lum - 0.045) / 0.14));
    const o = i * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = Math.round(a * 255);
    if (a > 0.5) {
      const x = i % width, y = (i / width) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const pad = 4;
  await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({
      left: Math.max(0, minX - pad), top: Math.max(0, minY - pad),
      width: Math.min(width - Math.max(0, minX - pad), cw + pad * 2),
      height: Math.min(height - Math.max(0, minY - pad), ch + pad * 2),
    })
    .resize(1024, null, { fit: 'inside' })
    .png({ compressionLevel: 9, palette: false })
    .toFile(path.join(OUT, 'palm_frond.jpg'));
  console.log('-> palm_frond.png (alpha keyed, cropped)', cw + 'x' + ch);
}

// ---- derive normal map from luminance ----
async function normalMap(src, dst, strength = 2.2, size = 1024) {
  const { data, info } = await sharp(path.join(SRC, src))
    .resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const out = Buffer.alloc(w * h * 3);
  const at = (x, y) => data[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) / 255;
      const dy = (at(x, y + 1) - at(x, y - 1)) / 255;
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const o = (y * w + x) * 3;
      out[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
    }
  }
  await sharp(out, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 88 }).toFile(path.join(OUT, dst));
  console.log('->', dst, 'normal map');
}
await normalMap('asphalt.jpg', 'asphalt_normal.jpg', 2.4);
await normalMap('sidewalk.jpg', 'sidewalk_normal.jpg', 1.4);

// ---- small radial glow sprite used for lamps / tail lights ----
{
  const size = 128;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
      const d = Math.hypot(dx, dy);
      const a = Math.max(0, 1 - d) ** 2.4;
      const o = (y * size + x) * 4;
      buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; buf[o + 3] = Math.round(a * 255);
    }
  }
  await sharp(buf, { raw: { width: size, height: size, channels: 4 } })
    .png().toFile(path.join(OUT, 'glow.jpg'));
  console.log('-> glow.png');
}
console.log('texture prep done');

// ---- derive emissive masks for the facades (lit windows + neon) ----
async function emissiveMask(src, dst) {
  const meta = await sharp(path.join(SRC, src)).metadata();
  const { data, info } = await sharp(path.join(SRC, src)).resize(meta.width, meta.height, { fit: 'fill' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // bright interior windows
    let e = smooth(0.34, 0.72, lum) * 0.85;
    // saturated neon tubes -> full strength, keep their hue
    const neon = smooth(0.30, 0.62, sat) * smooth(0.35, 0.62, lum);
    e = Math.min(1, Math.max(e, neon * 1.6));
    out[i * 3] = Math.round(Math.min(1, r * (0.5 + e)) * 255 * (0.25 + e * 0.9));
    out[i * 3 + 1] = Math.round(Math.min(1, g * (0.5 + e)) * 255 * (0.25 + e * 0.9));
    out[i * 3 + 2] = Math.round(Math.min(1, b * (0.5 + e)) * 255 * (0.25 + e * 0.9));
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
    .jpeg({ quality: 82 }).toFile(path.join(OUT, dst));
  console.log('->', dst, 'emissive mask');
}
await emissiveMask('facade_neon.jpg', 'facade_neon_emissive.jpg');
await emissiveMask('facade_white.jpg', 'facade_white_emissive.jpg');
await emissiveMask('facade_brick.jpg', 'facade_brick_emissive.jpg');
await emissiveMask('facade_modern.jpg', 'facade_modern_emissive.jpg');
await emissiveMask('shopfront.jpg', 'shopfront_emissive.jpg');
await emissiveMask('facade_civic.jpg', 'facade_civic_emissive.jpg');
console.log('emissive masks done');
