/**
 * Road network: the baked quad mesh from tools/gta5/build-roads.mjs, lifted onto
 * the terrain and textured with the AI asphalt so every metre of drivable surface
 * has a material of its own instead of a painted-on stain.
 */
import * as THREE from 'three';
import { WORLD } from './config.js';
import { TEX } from '../textures.js';

const LIFT = 0.22;               // metres above the height field (the coarse terrain
                                 // mesh can bulge up to ~20 cm above the bilinear height)

export class Roads {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'roads';
    this.meshes = [];
  }

  async load(base = '/gta5/terrain/') {
    const [main, side, rail] = await Promise.all([
      fetch(base + 'roads-main.bin').then((r) => r.arrayBuffer()),
      fetch(base + 'roads-side.bin').then((r) => r.arrayBuffer()),
      fetch(base + 'roads-rail.bin').then((r) => r.arrayBuffer()),
    ]);
    this.raw = { main, side, rail };
    return this;
  }

  build(scene) {
    this.add('main', this.raw.main, {
      tex: TEX.asphalt, color: 0x74767e, roughness: 0.82, metalness: 0.02,
      uvScale: 0.16, lift: LIFT,
    });
    this.add('side', this.raw.side, {
      tex: TEX.asphalt, color: 0x6a6c72, roughness: 0.88, metalness: 0.01,
      uvScale: 0.2, lift: LIFT - 0.02,
    });
    this.add('rail', this.raw.rail, {
      tex: TEX.dirt, color: 0x8d8272, roughness: 0.95, metalness: 0.0,
      uvScale: 0.25, lift: LIFT + 0.04,
    });
    scene.add(this.group);
    return this;
  }

  add(name, buffer, opts) {
    const count = new Int32Array(buffer, 0, 1)[0];
    if (!count) return;
    const corners = new Float32Array(buffer, 4, count * 8);
    const pos = new Float32Array(count * 12);
    const uv = new Float32Array(count * 8);
    const idx = new Uint32Array(count * 6);
    const t = this.terrain;

    for (let i = 0; i < count; i++) {
      const base = i * 8;
      for (let c = 0; c < 4; c++) {
        const x = corners[base + c * 2];
        const y = corners[base + c * 2 + 1];
        const h = t.heightAt(x, y) + opts.lift;
        const v = (i * 4 + c) * 3;
        pos[v] = x; pos[v + 1] = h; pos[v + 2] = y;
        uv[(i * 4 + c) * 2] = x * opts.uvScale;
        uv[(i * 4 + c) * 2 + 1] = y * opts.uvScale;
      }
      // counter-clockwise seen from above, otherwise every ribbon faces the ground
      // and the whole network is backface-culled in the default FrontSide material
      const o = i * 4;
      idx[i * 6] = o; idx[i * 6 + 1] = o + 1; idx[i * 6 + 2] = o + 2;
      idx[i * 6 + 3] = o + 1; idx[i * 6 + 4] = o + 3; idx[i * 6 + 5] = o + 2;
    }

    // Every quad owns its vertices, so computed normals would be per-quad and the
    // network would read as a quilt of differently lit plates on a slope. Asphalt is
    // flat: one up-normal for the whole ribbon looks calm and matches the ground.
    const nor = new Float32Array(pos.length);
    for (let i = 0; i < nor.length; i += 3) nor[i + 1] = 1;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const map = opts.tex ? opts.tex.clone() : null;
    if (map) {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1, 1);
      map.needsUpdate = true;
    }
    const mat = new THREE.MeshStandardMaterial({
      map, color: opts.color, roughness: opts.roughness, metalness: opts.metalness,
      side: THREE.FrontSide,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'roads_' + name;
    mesh.receiveShadow = false;   // the coarse shadow map only adds acne here
    mesh.castShadow = false;
    this.group.add(mesh);
    this.meshes.push(mesh);
    this[name + 'Quads'] = count;
  }

  stats() {
    return {
      main: this.mainQuads || 0,
      side: this.sideQuads || 0,
      rail: this.railQuads || 0,
      meshes: this.meshes.length,
    };
  }
}

/** world bounds helper shared by the physics + boundary clamp */
/** metres above the height field where a road surface is drawn */
export const ROAD_LIFT = LIFT;

/**
 * Rasterises the baked road quads into a coarse occupancy grid (4 m cells) so the
 * building placer, the spawn logic and the physics all agree on where the
 * carriageway actually is.
 */
export function buildRoadGrid(raw, cell = 4) {
  const w = Math.ceil(WORLD.width / cell);
  const h = Math.ceil(WORLD.height / cell);
  const data = new Uint8Array(w * h);
  for (const key of ['main', 'side']) {
    const buf = raw[key];
    if (!buf) continue;
    const count = new Int32Array(buf, 0, 1)[0];
    const c = new Float32Array(buf, 4, count * 8);
    for (let i = 0; i < count; i++) {
      const x0 = c[i * 8], y1 = c[i * 8 + 1], x1 = c[i * 8 + 2], y0 = c[i * 8 + 5];
      const gx0 = Math.floor((x0 - WORLD.x0) / cell), gx1 = Math.floor((x1 - WORLD.x0) / cell);
      const gy0 = Math.floor((y0 - WORLD.y0) / cell), gy1 = Math.floor((y1 - WORLD.y0) / cell);
      // quads are (TL, TR, BL, BR) -> x0,y1 / x1,y0
      for (let gy = Math.max(0, gy0); gy <= Math.min(h - 1, gy1); gy++) {
        for (let gx = Math.max(0, gx0); gx <= Math.min(w - 1, gx1); gx++) {
          data[gy * w + gx] = 1;
        }
      }
    }
  }
  return { data, w, h, cell };
}

/** 1 where a road covers the cell, 0 otherwise */
export function roadGridAt(grid, x, y) {
  if (!grid) return 0;
  const gx = Math.floor((x - WORLD.x0) / grid.cell);
  const gy = Math.floor((y - WORLD.y0) / grid.cell);
  if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) return 0;
  return grid.data[gy * grid.w + gx];
}

/** true if any cell within `radius` metres is road */
export function roadNear(grid, x, y, radius = 8) {
  const steps = Math.max(1, Math.round(radius / grid.cell));
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      if (roadGridAt(grid, x + i * grid.cell, y + j * grid.cell)) return true;
    }
  }
  return false;
}

export const BOUNDS = {
  x0: WORLD.x0 + 45,
  x1: WORLD.x1 - 45,
  y0: WORLD.y0 + 45,
  y1: WORLD.y1 - 45,
};
