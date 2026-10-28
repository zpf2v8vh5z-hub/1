/**
 * Tiny PNG writer (no dependencies). Supports 16-bit and 8-bit greyscale and
 * 8-bit RGB/RGBA. Used to bake the terrain textures the game loads at runtime.
 */
import zlib from 'node:zlib';
import fs from 'node:fs';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/**
 * @param {string} file
 * @param {number} width
 * @param {number} height
 * @param {'grey16'|'grey8'|'rgba8'} mode
 * @param {Buffer|Uint8Array} pixels  grey16: 2 bytes/px BE, grey8: 1, rgba8: 4
 */
export function writePng(file, width, height, mode, pixels) {
  const colorType = mode === 'grey16' || mode === 'grey8' ? 0 : 6;
  const bitDepth = mode === 'grey16' ? 16 : 8;
  const bpp = mode === 'grey16' ? 2 : mode === 'grey8' ? 1 : 4;
  const rowBytes = width * bpp;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // one filter byte (0 = none) per scanline, then a light deflate
  const raw = Buffer.alloc((rowBytes + 1) * height);
  const src = Buffer.isBuffer(pixels) ? pixels : Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  for (let y = 0; y < height; y++) {
    const o = y * (rowBytes + 1);
    raw[o] = 0;
    src.copy(raw, o + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });

  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]));
  return fs.statSync(file).size;
}
