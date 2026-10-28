import sharp from 'sharp';
const { data, info } = await sharp('/tmp/hmap/heightmap.png').raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
console.log('info', info.width, info.height, 'ch', info.channels, 'depth', info.depth);
const SX = -4100, SY = -4300, W = info.width, H = info.height;
const bpp = info.channels * (info.depth === 'ushort' ? 2 : 1);
const read = (i) => (info.depth === 'ushort' ? data.readUInt16LE(i) : data[i]);
const at = (x, y) => {
  const px = Math.round(x - SX);
  const py = (H - 1) - Math.round(y - SY);
  if (px < 0 || px >= W || py < 0 || py >= H) return null;
  return read((py * W + px) * bpp);
};
for (const [name, x, y] of [['Davis bldg', 187.7, -1812.87], ['Vespucci', -1245, -1460],
  ['Sandy Shores', 1755, 3745], ['Paleto', -175, 6320], ['Chiliad summit', 450, 6300],
  ['Downtown', -145, -835], ['Ocean', -3500, -2000], ['LSIA', -1045, -2730]]) {
  console.log(name.padEnd(14), (x+'').padStart(7), (y+'').padStart(8), '-> raw', at(x, y));
}
console.log('sea far', at(-4000, -4000), '| land far', at(3000, 4000));
