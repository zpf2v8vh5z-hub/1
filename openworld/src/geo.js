/* Small geometry helpers: baked-UV boxes/planes and a merge utility.
   Merging keeps the whole city at a handful of draw calls. */

import * as THREE from "three";

/** Box with UVs scaled to world metres so textures keep a constant density. */
export function boxWithUV(sx, sy, sz, texMeters = 4) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z (4 verts each)
  const faceScale = [
    [sz / texMeters, sy / texMeters],
    [sz / texMeters, sy / texMeters],
    [sx / texMeters, sz / texMeters],
    [sx / texMeters, sz / texMeters],
    [sx / texMeters, sy / texMeters],
    [sx / texMeters, sy / texMeters],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceScale[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** Ground quad on the XZ plane with UVs in metres. */
export function planeWithUV(w, d, texMeters = 4) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * (w / texMeters), uv.getY(i) * (d / texMeters));
  }
  uv.needsUpdate = true;
  return g;
}

/** Transform a geometry in place. */
export function place(geo, x, y, z, rotY = 0) {
  if (rotY) geo.rotateY(rotY);
  geo.translate(x, y, z);
  return geo;
}

/** Merge geometries that share a material into one buffer geometry. */
export function merge(geometries) {
  const list = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;

  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const u = g.attributes.uv ? g.attributes.uv.array : new Float32Array((p.length / 3) * 2);
    pos.set(p, o * 3);
    nrm.set(n, o * 3);
    uv.set(u, o * 2);
    o += g.attributes.position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  merged.computeBoundingSphere();
  return merged;
}

/** Merge geometries that carry a per-geometry colour into one vertex-coloured mesh. */
export function mergeColored(entries) {
  const list = entries.map((e) => {
    const g = e.geo.index ? e.geo.toNonIndexed() : e.geo;
    return { g, color: e.color };
  });
  let total = 0;
  for (const { g } of list) total += g.attributes.position.count;

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  let o = 0;

  for (const { g, color } of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const u = g.attributes.uv ? g.attributes.uv.array : new Float32Array((p.length / 3) * 2);
    const count = g.attributes.position.count;
    pos.set(p, o * 3);
    nrm.set(n, o * 3);
    uv.set(u, o * 2);
    for (let i = 0; i < count; i++) {
      col[(o + i) * 3] = color.r;
      col[(o + i) * 3 + 1] = color.g;
      col[(o + i) * 3 + 2] = color.b;
    }
    o += count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  merged.setAttribute("color", new THREE.BufferAttribute(col, 3));
  merged.computeBoundingSphere();
  return merged;
}
