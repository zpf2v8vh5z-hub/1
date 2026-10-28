/**
 * Minimal 16-bit / 8-bit PNG reader that streams row by row.
 *
 * sharp silently drops 16-bit greyscale to 8 bit on `.raw()`, which would quantise
 * the GTA heightmap into ~3 m steps. This reader keeps full precision and lets us
 * box-filter into a smaller grid while the rows scroll past, so a 9000 x 13500
 * image never has to sit in memory.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Walks every pixel of a PNG. `onRow(y, rowView, width, height)` receives a
 * Uint16Array of one scanline (row-major, no filter bytes).
 */
export function readPngRows(file, onRow) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(8);
  fs.readSync(fd, head, 0, 8, 0);
  if (!head.equals(SIGNATURE)) throw new Error('not a PNG: ' + file);

  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let pos = 8;
  const lenBuf = Buffer.alloc(4);
  const buf = Buffer.alloc(1 << 22);

  while (pos < fs.fstatSync(fd).size) {
    fs.readSync(fd, lenBuf, 0, 4, pos);
    const len = lenBuf.readUInt32BE(0);
    const typeBuf = Buffer.alloc(4);
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
      interlace = b[12];
      if (interlace !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') {
      const chunk = Buffer.alloc(len);
      fs.readSync(fd, chunk, 0, len, dataStart);
      idat.push(chunk);
    } else if (type === 'IEND') {
      pos = Infinity;
      break;
    }
    pos = dataStart + len + 4;
  }
  fs.closeSync(fd);

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  if (bitDepth !== 8 && bitDepth !== 16) throw new Error('unsupported bit depth ' + bitDepth);
  const bytesPerSample = bitDepth / 8;
  const bpp = channels * bytesPerSample;          // filter unit
  const rowBytes = width * bpp;

  const inflate = zlib.createInflate({ chunkSize: 1 << 20 });
  const raw = zlib.inflateSync(Buffer.concat(idat), { chunkSize: 1 << 24 });

  let prev = Buffer.alloc(rowBytes);
  let cur = Buffer.alloc(rowBytes);
  const out = new Uint16Array(width);
  let off = 0;
  const scale = bitDepth === 8 ? 257 : 1;

  for (let y = 0; y < height; y++) {
    const filter = raw[off++];
    raw.copy(cur, 0, off, off + rowBytes);
    off += rowBytes;

    // PNG unfiltering
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
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        cur[i] = (cur[i] + pr) & 0xff;
      }
    }

    // sample channel 0 of every pixel
    for (let x = 0; x < width; x++) {
      const i = x * bpp;
      out[x] = bitDepth === 16 ? (cur[i] << 8) | cur[i + 1] : cur[i] * scale;
    }
    onRow(y, out, width, height);

    const tmp = prev; prev = cur; cur = tmp;
  }
  void buf;
  return { width, height, bitDepth, channels };
}
