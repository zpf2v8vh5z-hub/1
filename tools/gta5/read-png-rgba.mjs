/**
 * Streaming reader for 8-bit PNGs (grey, grey+alpha, RGB, RGBA).
 * Only the first channel plus alpha are ever needed for the masks.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** onRow(y, row /*Uint8Array of RGBA*\/, width, height) */
export function readPngRGBA(file, onRow) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(8);
  fs.readSync(fd, head, 0, 8, 0);
  if (!head.equals(SIGNATURE)) throw new Error('not a PNG: ' + file);

  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  let palette = null, trns = null;
  const idat = [];
  const size = fs.fstatSync(fd).size;
  let pos = 8;
  const lenBuf = Buffer.alloc(4);
  const typeBuf = Buffer.alloc(4);

  while (pos < size) {
    fs.readSync(fd, lenBuf, 0, 4, pos);
    const len = lenBuf.readUInt32BE(0);
    fs.readSync(fd, typeBuf, 0, 4, pos + 4);
    const type = typeBuf.toString('ascii');
    const dataStart = pos + 8;
    if (type === 'IHDR') {
      const b = Buffer.alloc(13);
      fs.readSync(fd, b, 0, 13, dataStart);
      width = b.readUInt32BE(0);
      height = b.readUInt32BE(4);
      bitDepth = b[8];
      colorType = b[9];
      if (b[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') {
      palette = Buffer.alloc(len);
      fs.readSync(fd, palette, 0, len, dataStart);
    } else if (type === 'tRNS') {
      trns = Buffer.alloc(len);
      fs.readSync(fd, trns, 0, len, dataStart);
    } else if (type === 'IDAT') {
      const chunk = Buffer.alloc(len);
      fs.readSync(fd, chunk, 0, len, dataStart);
      idat.push(chunk);
    } else if (type === 'IEND') break;
    pos = dataStart + len + 4;
  }
  fs.closeSync(fd);

  if (bitDepth !== 8) throw new Error('only 8-bit masks supported, got ' + bitDepth);
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2
    : colorType === 3 ? 1 : 4;
  const bpp = channels;
  const rowBytes = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat), { chunkSize: 1 << 24 });

  let prev = Buffer.alloc(rowBytes);
  let cur = Buffer.alloc(rowBytes);
  const out = new Uint8Array(width * 4);
  let off = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[off++];
    raw.copy(cur, 0, off, off + rowBytes);
    off += rowBytes;

    if (filter === 1) {
      for (let i = bpp; i < rowBytes; i++) cur[i] = (cur[i] + cur[i - bpp]) & 0xff;
    } else if (filter === 2) {
      for (let i = 0; i < rowBytes; i++) cur[i] = (cur[i] + prev[i]) & 0xff;
    } else if (filter === 3) {
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 0xff;
      }
    } else if (filter === 4) {
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }

    if (colorType === 3) {
      if (!palette) throw new Error('palette PNG without PLTE: ' + file);
      for (let x = 0; x < width; x++) {
        const idx = cur[x], o = x * 4;
        out[o] = palette[idx * 3];
        out[o + 1] = palette[idx * 3 + 1];
        out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    } else {
      for (let x = 0; x < width; x++) {
        const i = x * bpp, o = x * 4;
        out[o] = cur[i];
        out[o + 1] = channels >= 3 ? cur[i + 1] : cur[i];
        out[o + 2] = channels >= 3 ? cur[i + 2] : cur[i];
        out[o + 3] = channels === 4 ? cur[i + 3] : channels === 2 ? cur[i + 1] : 255;
      }
    }
    onRow(y, out, width, height);

    const tmp = prev; prev = cur; cur = tmp;
  }
  return { width, height, channels };
}
