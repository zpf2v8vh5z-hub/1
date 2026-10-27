/* City layout generation — pure data, no three.js, no DOM.
   Imported by the renderer and by tools/test_city.js.

   Layout (in metres, world spans 0..worldSize on both axes):
     cell   = roadWidth + blockSize
     roads  = 18 m wide corridors between the blocks
     blocks = 56 m squares with a 4 m sidewalk ring and buildings inside
*/

export const N_BLOCKS = 9;
export const ROAD_W = 18;
export const BLOCK_S = 56;
export const CELL = ROAD_W + BLOCK_S;
export const WORLD_SIZE = N_BLOCKS * CELL;
export const SIDEWALK = 4;

export const HALF = WORLD_SIZE / 2;

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** Convert layout coordinates (0..worldSize) to centred world space. */
export const toWorld = (v) => v - HALF;

export function generateCity(seed = 1337) {
  const rng = mulberry32(seed);

  const blocks = [];
  const buildings = [];
  const trees = [];
  const lamps = [];

  for (let bx = 0; bx < N_BLOCKS; bx++) {
    for (let bz = 0; bz < N_BLOCKS; bz++) {
      const x = bx * CELL + ROAD_W;
      const z = bz * CELL + ROAD_W;

      // distance from city centre drives density and height
      const cx = (bx + 0.5) / N_BLOCKS;
      const cz = (bz + 0.5) / N_BLOCKS;
      const centreDist = Math.hypot(cx - 0.5, cz - 0.5) * 2; // 0 centre .. ~1.4 edge
      const downtown = Math.max(0, 1 - centreDist * 1.35);

      const isPark = bx === 4 && bz === 4;
      const isPark2 = (bx === 1 && bz === 7) || (bx === 7 && bz === 1);
      const kind = isPark || isPark2 ? "park" : rng() < 0.1 ? "lot" : "built";

      const block = { bx, bz, x, z, w: BLOCK_S, h: BLOCK_S, kind, downtown };
      blocks.push(block);

      const inner = BLOCK_S - SIDEWALK * 2;
      const ix = x + SIDEWALK;
      const iz = z + SIDEWALK;

      if (kind === "park") {
        const treeCount = 8 + Math.floor(rng() * 8);
        for (let i = 0; i < treeCount; i++) {
          trees.push({
            x: ix + 3 + rng() * (inner - 6),
            z: iz + 3 + rng() * (inner - 6),
            scale: 0.8 + rng() * 0.7,
            seed: rng(),
          });
        }
        continue;
      }

      if (kind === "lot") {
        block.kind = "lot";
        continue;
      }

      // split the block interior into a 2x2 grid, sometimes merging cells
      const split = rng();
      const cells = [];
      if (split < 0.32) {
        cells.push({ x: ix, z: iz, w: inner, d: inner });
      } else if (split < 0.66) {
        const gap = 3 + rng() * 3;
        const firstW = inner * (0.5 + rng() * 0.12);
        cells.push({ x: ix, z: iz, w: firstW, d: inner });
        cells.push({ x: ix + firstW + gap, z: iz, w: inner - firstW - gap, d: inner });
      } else {
        const gap = 4 + rng() * 3;
        const half = (inner - gap) / 2;
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            if (rng() < 0.12) continue; // occasional empty plot
            cells.push({ x: ix + a * (half + gap), z: iz + b * (half + gap), w: half, d: half });
          }
        }
      }

      for (const c of cells) {
        const pad = 0.6 + rng() * 1.6;
        const w = c.w - pad * 2;
        const d = c.d - pad * 2;
        if (w < 4 || d < 4) continue;

        const maxH = 12 + downtown * 78 + rng() * 14;
        const h = Math.max(7, 7 + rng() * maxH * (0.55 + downtown * 0.75));

        const type = downtown > 0.55 ? (rng() < 0.7 ? "glass" : "concrete") : pick(rng, ["concrete", "brick", "brick", "glass"]);

        buildings.push({
          x: c.x + pad,
          z: c.z + pad,
          w,
          d,
          h,
          type,
          // baked-in facade tint so neighbouring towers are not identical
          tint: 0.82 + rng() * 0.3,
          roofTint: 0.55 + rng() * 0.25,
        });
      }

      // street lamps on the sidewalk ring
      const lampCount = 4;
      for (let i = 0; i < lampCount; i++) {
        const side = i % 4;
        const t = 0.15 + rng() * 0.7;
        let lx, lz;
        if (side === 0) { lx = x + t * BLOCK_S; lz = z + 1.2; }
        else if (side === 1) { lx = x + BLOCK_S - 1.2; lz = z + t * BLOCK_S; }
        else if (side === 2) { lx = x + t * BLOCK_S; lz = z + BLOCK_S - 1.2; }
        else { lx = x + 1.2; lz = z + t * BLOCK_S; }
        lamps.push({ x: lx, z: lz, side });
      }
    }
  }

  // road network: one segment per corridor between blocks
  const roads = [];
  for (let i = 0; i <= N_BLOCKS; i++) {
    const centre = i * CELL + ROAD_W / 2;
    roads.push({ axis: "x", pos: centre, length: WORLD_SIZE, width: ROAD_W });
    roads.push({ axis: "z", pos: centre, length: WORLD_SIZE, width: ROAD_W });
  }

  // intersections, used for traffic AI + spawn points
  const intersections = [];
  for (let i = 0; i <= N_BLOCKS; i++) {
    for (let j = 0; j <= N_BLOCKS; j++) {
      intersections.push({ x: i * CELL + ROAD_W / 2, z: j * CELL + ROAD_W / 2, i, j });
    }
  }

  return {
    seed,
    blocks,
    buildings,
    trees,
    lamps,
    roads,
    intersections,
    bounds: { min: toWorld(0), max: toWorld(WORLD_SIZE) },
    spawn: {
      x: toWorld(4 * CELL + ROAD_W / 2 + 6),
      z: toWorld(4 * CELL + ROAD_W / 2 + 6),
    },
  };
}

/** Axis-aligned boxes (already in centred world space) for collision. */
export function collisionBoxes(city) {
  return city.buildings.map((b) => ({
    minX: toWorld(b.x),
    maxX: toWorld(b.x + b.w),
    minZ: toWorld(b.z),
    maxZ: toWorld(b.z + b.d),
    height: b.h,
  }));
}
