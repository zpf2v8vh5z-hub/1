/* Collision helpers: AABB city blocks in a spatial hash, circle push-out. */

const GRID = 24;

export function buildColliderGrid(boxes) {
  const map = new Map();
  const key = (ix, iz) => ix + "," + iz;
  for (const box of boxes) {
    const x0 = Math.floor(box.minX / GRID);
    const x1 = Math.floor(box.maxX / GRID);
    const z0 = Math.floor(box.minZ / GRID);
    const z1 = Math.floor(box.maxZ / GRID);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let arr = map.get(k);
        if (!arr) map.set(k, (arr = []));
        arr.push(box);
      }
    }
  }
  return {
    boxes,
    query(x, z, r, out) {
      out.length = 0;
      const x0 = Math.floor((x - r) / GRID);
      const x1 = Math.floor((x + r) / GRID);
      const z0 = Math.floor((z - r) / GRID);
      const z1 = Math.floor((z + r) / GRID);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const arr = map.get(key(ix, iz));
          if (arr) for (const b of arr) if (!out.includes(b)) out.push(b);
        }
      }
      return out;
    },
  };
}

const scratch = [];

/**
 * Push a circle out of every intersecting building box.
 * Returns true when a collision happened. Mutates `pos` {x,z}.
 */
export function resolveCircle(grid, pos, radius, outNormal) {
  let hit = false;
  grid.query(pos.x, pos.z, radius, scratch);
  for (const b of grid.boxes.length ? scratch : []) {
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;

    hit = true;
    if (d2 < 1e-6) {
      // centre inside the box: push out along the shallowest axis
      const left = pos.x - b.minX;
      const right = b.maxX - pos.x;
      const back = pos.z - b.minZ;
      const front = b.maxZ - pos.z;
      const m = Math.min(left, right, back, front);
      if (m === left) { pos.x = b.minX - radius; dx = -1; dz = 0; }
      else if (m === right) { pos.x = b.maxX + radius; dx = 1; dz = 0; }
      else if (m === back) { pos.z = b.minZ - radius; dx = 0; dz = -1; }
      else { pos.z = b.maxZ + radius; dx = 0; dz = 1; }
    } else {
      const d = Math.sqrt(d2);
      const push = radius - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
      dx /= d;
      dz /= d;
    }
    if (outNormal) { outNormal.x = dx; outNormal.z = dz; outNormal.valid = true; }
  }
  return hit;
}

/** Is a point inside any building footprint? */
export function pointBlocked(grid, x, z, radius = 0) {
  grid.query(x, z, radius, scratch);
  for (const b of scratch) {
    if (x > b.minX - radius && x < b.maxX + radius && z > b.minZ - radius && z < b.maxZ + radius) return b;
  }
  return null;
}
