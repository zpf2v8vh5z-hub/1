/* Invariants for the city layout.  Run: node tools/test_city.js  */
import { generateCity, N_BLOCKS, ROAD_W, BLOCK_S, CELL, SIDEWALK, toWorld, collisionBoxes } from "../src/city.js";

let fails = 0;
const check = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  }
};

const SEEDS = 60;
let minBuildings = Infinity;
let maxBuildings = 0;
let tallest = 0;

for (let s = 0; s < SEEDS; s++) {
  const city = generateCity(s * 977 + 1);
  const n = city.buildings.length;
  minBuildings = Math.min(minBuildings, n);
  maxBuildings = Math.max(maxBuildings, n);
  for (const b of city.buildings) tallest = Math.max(tallest, b.h);

  check(city.blocks.length === N_BLOCKS * N_BLOCKS, `seed ${s}: block count`);

  for (const b of city.buildings) {
    // keep buildings inside their block interior (never on the road or sidewalk)
    const blockBx = Math.floor((b.x - ROAD_W) / CELL);
    const blockBz = Math.floor((b.z - ROAD_W) / CELL);
    check(blockBx >= 0 && blockBx < N_BLOCKS, `seed ${s}: building bx out of range`);
    check(blockBz >= 0 && blockBz < N_BLOCKS, `seed ${s}: building bz out of range`);
    const bx0 = blockBx * CELL + ROAD_W + SIDEWALK;
    const bz0 = blockBz * CELL + ROAD_W + SIDEWALK;
    const bx1 = bx0 + BLOCK_S - SIDEWALK * 2;
    const bz1 = bz0 + BLOCK_S - SIDEWALK * 2;
    check(b.x >= bx0 - 1e-6 && b.x + b.w <= bx1 + 1e-6, `seed ${s}: building overflows block in x`);
    check(b.z >= bz0 - 1e-6 && b.z + b.d <= bz1 + 1e-6, `seed ${s}: building overflows block in z`);
    check(b.w >= 4 && b.d >= 4, `seed ${s}: building too small`);
    check(b.h >= 7, `seed ${s}: building too short`);
  }

  // no two buildings may overlap
  for (let i = 0; i < city.buildings.length; i++) {
    for (let j = i + 1; j < city.buildings.length; j++) {
      const a = city.buildings[i];
      const c = city.buildings[j];
      const overlap =
        a.x < c.x + c.w - 0.01 && a.x + a.w > c.x + 0.01 && a.z < c.z + c.d - 0.01 && a.z + a.d > c.z + 0.01;
      if (overlap) check(false, `seed ${s}: overlapping buildings at ${a.x.toFixed(1)},${a.z.toFixed(1)}`);
    }
  }

  // spawn point must be inside the world and clear of buildings
  check(city.spawn.x > city.bounds.min && city.spawn.x < city.bounds.max, `seed ${s}: spawn outside world`);
  const boxes = collisionBoxes(city);
  for (const box of boxes) {
    const inside = city.spawn.x > box.minX && city.spawn.x < box.maxX && city.spawn.z > box.minZ && city.spawn.z < box.maxZ;
    check(!inside, `seed ${s}: spawn inside a building`);
  }

  check(city.intersections.length === (N_BLOCKS + 1) ** 2, `seed ${s}: intersection count`);
}

console.log(`checked ${SEEDS} cities`);
console.log(`buildings per city: ${minBuildings}..${maxBuildings}`);
console.log(`tallest building: ${tallest.toFixed(1)} m`);
console.log(`world: ${(CELL * N_BLOCKS).toFixed(0)} m per axis (${N_BLOCKS}x${N_BLOCKS} blocks, ${ROAD_W} m roads)`);
if (fails) {
  console.error(`${fails} problems`);
  process.exit(1);
}
console.log("city layout valid: buildings inside blocks, no overlaps, spawn clear");
