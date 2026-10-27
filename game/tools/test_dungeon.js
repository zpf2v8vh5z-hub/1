/* Sanity checks for the dungeon generator: every floor tile must be reachable
   from the spawn room, and each map must offer enough rooms for 5 runes.
   Run with:  node tools/test_dungeon.js  */
require("../src/dungeon.js");

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = 200;
let failures = 0;
let minRooms = Infinity;
let maxRooms = 0;
let minFloor = Infinity;

for (let s = 1; s <= SEEDS; s++) {
  const rng = mulberry32(s * 7919);
  const { map, rooms, center } = globalThis.Dungeon.generate(rng);

  minRooms = Math.min(minRooms, rooms.length);
  maxRooms = Math.max(maxRooms, rooms.length);
  minFloor = Math.min(minFloor, globalThis.Dungeon.totalFloor(map));

  if (rooms.length < 8) {
    console.error(`seed ${s}: only ${rooms.length} rooms`);
    failures++;
    continue;
  }

  const start = center(rooms[0]);
  const seen = globalThis.Dungeon.reachableFloor(map, start.x, start.y);
  const floor = globalThis.Dungeon.totalFloor(map);
  if (seen.size !== floor) {
    console.error(`seed ${s}: ${floor - seen.size} unreachable floor tiles`);
    failures++;
  }
}

console.log(`checked ${SEEDS} maps`);
console.log(`rooms per map: ${minRooms}..${maxRooms}`);
console.log(`min walkable tiles: ${minFloor}`);
if (failures) {
  console.error(`${failures} failing seeds`);
  process.exit(1);
}
console.log("all maps fully connected");
