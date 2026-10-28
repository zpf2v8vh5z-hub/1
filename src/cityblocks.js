import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEX } from './textures.js';
import { LAYOUT } from './world.js';

/**
 * Block content generators: buildings and the things a city needs.
 * Everything is merged into a handful of materials so a whole district stays cheap.
 */

const TREE_GREENS = [0x2f5a2a, 0x38682e, 0x27492a, 0x3f7434];

/* ------------------------------------------------------------------ *
 * material book shared by the city generators
 * ------------------------------------------------------------------ */
/**
 * Ground textures are tiled from world-space UVs in city.js, so they must not be
 * pre-tiled again by `repeat` — otherwise one tile ends up smaller than a pixel
 * and mipmapping flattens the whole surface to a single colour.
 */
function worldTex(t) {
  if (!t) return null;
  const c = t.clone();
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(1, 1);
  c.needsUpdate = true;
  return c;
}

export function makeCityMaterials() {
  const m = {};

  m.asphalt = new THREE.MeshStandardMaterial({
    map: worldTex(TEX.asphalt), normalMap: worldTex(TEX.asphaltNormal),
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.4, metalness: 0.06, envMapIntensity: 0.8, color: 0x5c545e,
  });
  m.sidewalk = new THREE.MeshStandardMaterial({
    map: worldTex(TEX.sidewalk), normalMap: worldTex(TEX.sidewalkNormal),
    roughness: 0.66, metalness: 0.02, envMapIntensity: 0.5, color: 0x9a8d94,
  });
  m.plaza = new THREE.MeshStandardMaterial({
    map: worldTex(TEX.paving), roughness: 0.55, metalness: 0.03, envMapIntensity: 0.7, color: 0xd9cfc4,
  });
  m.grass = new THREE.MeshStandardMaterial({
    map: worldTex(TEX.grass), roughness: 0.94, metalness: 0.0, envMapIntensity: 0.4, color: 0x9fbf7e,
  });
  m.field = new THREE.MeshStandardMaterial({
    map: worldTex(TEX.field), roughness: 0.96, metalness: 0.0, envMapIntensity: 0.35, color: 0xa08f72,
  });
  m.hedge = new THREE.MeshStandardMaterial({ map: worldTex(TEX.hedge), roughness: 0.85, color: 0x54703c });
  m.dirt = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 1 });

  const facade = (map, emissiveMap, extra = {}) => new THREE.MeshStandardMaterial({
    map, emissiveMap: emissiveMap || map, emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.95, roughness: 0.78, metalness: 0.05,
    vertexColors: true, envMapIntensity: 0.6, ...extra,
  });
  m.facadeDeco = facade(TEX.facadeNeon, TEX.facadeNeonEmissive);
  m.facadeWhite = facade(TEX.facadeWhite, TEX.facadeWhiteEmissive);
  m.facadeBrick = facade(TEX.facadeBrick, TEX.facadeBrickEmissive, { emissiveIntensity: 1.0 });
  m.facadeModern = facade(TEX.facadeModern, TEX.facadeModernEmissive, {
    roughness: 0.35, metalness: 0.35, emissiveIntensity: 1.1,
  });
  m.facadeShops = facade(TEX.shopfront, TEX.shopfrontEmissive, { emissiveIntensity: 1.35 });
  m.facadeOffice = facade(TEX.facadeModern, TEX.facadeModernEmissive, {
    roughness: 0.3, metalness: 0.45, emissiveIntensity: 0.85,
  });
  m.facadeCivic = facade(TEX.facadeCivic, TEX.facadeCivicEmissive, { emissiveIntensity: 0.85 });

  m.roof = new THREE.MeshStandardMaterial({
    color: 0x8a6e7c, roughness: 0.9, emissive: new THREE.Color(0x241119), emissiveIntensity: 1.0,
  });
  m.roofFlat = new THREE.MeshStandardMaterial({ color: 0x6b5f66, roughness: 0.92 });
  m.roof2 = new THREE.MeshStandardMaterial({
    color: 0xa89a9c, roughness: 0.94, emissive: new THREE.Color(0x1b1016), emissiveIntensity: 0.9,
  });
  m.roof3 = new THREE.MeshStandardMaterial({
    color: 0x5d5560, roughness: 0.9, emissive: new THREE.Color(0x150c11), emissiveIntensity: 0.8,
  });
  m.roofDetail = new THREE.MeshStandardMaterial({ color: 0x7d6f76, roughness: 0.88 });
  m.pitch = new THREE.MeshStandardMaterial({ color: 0x3f6b4a, roughness: 0.95 });
  m.sand = new THREE.MeshStandardMaterial({
    map: worldTex(TEX.sand), color: 0xf0dccb, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.4,
  });
  m.hospitalSign = new THREE.MeshStandardMaterial({
    color: 0xff2a34, emissive: new THREE.Color(0xff2f36), emissiveIntensity: 2.4, roughness: 0.5,
  });
  m.windows = new THREE.MeshStandardMaterial({
    color: 0x2a2b33, roughness: 0.25, metalness: 0.5,
    emissive: new THREE.Color(0xffd9a6), emissiveIntensity: 1.25, envMapIntensity: 0.9,
  });
  m.planter = new THREE.MeshStandardMaterial({ map: worldTex(TEX.sidewalk), color: 0xcfc2bd, roughness: 0.85 });
  m.civicWall = new THREE.MeshStandardMaterial({
    map: TEX.facadeCivic, color: 0xe7ded6, roughness: 0.82, metalness: 0.02, envMapIntensity: 0.5,
    emissive: new THREE.Color(0xffffff), emissiveMap: TEX.facadeCivicEmissive, emissiveIntensity: 0.4,
  });
  m.bark = new THREE.MeshStandardMaterial({
    map: TEX.palmBark, color: 0xcbb6a4, roughness: 0.9, metalness: 0.0,
    emissive: new THREE.Color(0x2a1a1c), emissiveIntensity: 0.85,
  });
  m.frond = new THREE.MeshStandardMaterial({
    map: TEX.palmFrond, alphaTest: 0.3, side: THREE.DoubleSide,
    roughness: 0.74, metalness: 0.0, color: 0x7d9558,
    emissive: new THREE.Color(0x36421a), emissiveIntensity: 1.05,
  });
  m.concrete = new THREE.MeshStandardMaterial({ color: 0xc4b8bd, roughness: 0.82 });
  m.lightConcrete = new THREE.MeshStandardMaterial({ color: 0xd9cfd2, roughness: 0.8 });
  m.darkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5, metalness: 0.75 });
  m.paintWhite = new THREE.MeshStandardMaterial({ color: 0xe8e2de, roughness: 0.5 });
  m.paintYellow = new THREE.MeshStandardMaterial({ color: 0xe8c74a, roughness: 0.55 });
  m.roadPaint = new THREE.MeshStandardMaterial({ color: 0xe6ede4, roughness: 0.5, envMapIntensity: 0.6 });
  m.wood = new THREE.MeshStandardMaterial({ color: 0x6b4a34, roughness: 0.85 });
  m.trunk = new THREE.MeshStandardMaterial({ map: TEX.palmBark, color: 0xb9a595, roughness: 0.9 });
  m.leafy = null;      // created below, one material per colour
  m.canopy = TREE_GREENS.map((c) => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.88, flatShading: true,
  }));
  m.red = new THREE.MeshStandardMaterial({ color: 0xb4382f, roughness: 0.6 });
  m.blue = new THREE.MeshStandardMaterial({ color: 0x2f5fbf, roughness: 0.6 });
  m.green = new THREE.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.6 });
  m.white = new THREE.MeshStandardMaterial({ color: 0xe9e4e6, roughness: 0.6 });
  m.glass = new THREE.MeshStandardMaterial({
    color: 0x121c28, roughness: 0.1, metalness: 0.9, envMapIntensity: 1.3,
  });
  m.water = new THREE.MeshStandardMaterial({
    color: 0x2c6f86, roughness: 0.12, metalness: 0.55, envMapIntensity: 1.4,
  });
  m.landmark = new THREE.MeshStandardMaterial({ color: 0xe0d3cf, roughness: 0.75 });

  return m;
}

/* ------------------------------------------------------------------ *
 * texture helpers
 * ------------------------------------------------------------------ */
const FACADE_TILE = {
  deco: [14.6, 8.0],
  white: [14.6, 8.0],
  brick: [12.0, 12.0],
  modern: [14.6, 8.0],
  shops: [14.6, 8.0],
  office: [14.6, 8.0],
  civic: [14.6, 8.0],
};

const FACADE_MAT = {
  deco: 'facadeDeco', white: 'facadeWhite', brick: 'facadeBrick',
  modern: 'facadeModern', shops: 'facadeShops', office: 'facadeOffice', civic: 'facadeCivic',
};

function tintedWall(w, h, style, uOff, vOff, tint) {
  const [tw, th] = FACADE_TILE[style] || [14.6, 8.0];
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * (w / tw) + uOff, uv.getY(i) * (h / th) + vOff);
  }
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const TINTS = [0.93, 0.95, 0.12, 0.47, 0.02, 0.55, 0.08];
export function pickTint(rng, sat = 0.26, light = 0.62) {
  const h = TINTS[Math.floor(rng() * TINTS.length)];
  return new THREE.Color().setHSL(h + (rng() - 0.5) * 0.05, sat * (0.4 + rng()), light * (0.85 + rng() * 0.3));
}

/* ------------------------------------------------------------------ *
 * Building geometry
 * ------------------------------------------------------------------ */

/**
 * A building box with textured facades on all four sides + a roof.
 * `parts` is the geometry collector: parts[style].push(geo)
 */
export function addBuilding(parts, rng, {
  cx, cz, w, d, h, style = 'deco', tint = null, roofDetail = null, roofMat = 'roof',
}) {
  const key = style === 'office' ? 'office' : style;
  if (!parts[key]) parts[key] = [];
  const t = tint || pickTint(rng);
  const uOff = Math.floor(rng() * 7) / 7;
  const vOff = Math.floor(rng() * 4) / 4;

  const faces = [
    [w, +1, 'x', cx + d / 2],   // +X
    [w, -1, 'x', cx - d / 2],   // -X
    [d, +1, 'z', cz + w / 2],   // +Z
    [d, -1, 'z', cz - w / 2],   // -Z
  ];
  for (const [faceW, sign, axis, offset] of faces) {
    const geo = tintedWall(faceW, h, key, uOff + rng() * 0.1, vOff, t);
    if (axis === 'x') {
      geo.rotateY(sign > 0 ? Math.PI / 2 : -Math.PI / 2);
      geo.translate(offset, h / 2, cz);
    } else {
      geo.rotateY(sign > 0 ? 0 : Math.PI);
      geo.translate(cx, h / 2, offset);
    }
    parts[key].push(geo);
  }

  // roof plate + parapet (roof material varies so the city does not read as one pink mass)
  if (!roofMat || roofMat === 'roof') roofMat = ['roof', 'roof2', 'roof3'][Math.floor(rng() * 3)];
  if (!parts[roofMat]) parts[roofMat] = [];
  const roof = new THREE.PlaneGeometry(w + 0.3, d + 0.3);
  roof.rotateX(-Math.PI / 2);
  roof.translate(cx, h, cz);
  parts[roofMat].push(roof);

  const par = [
    box(d + 0.4, 0.7, 0.35, cx, h + 0.35, cz + w / 2),
    box(d + 0.4, 0.7, 0.35, cx, h + 0.35, cz - w / 2),
    box(0.35, 0.7, w + 0.4, cx + d / 2, h + 0.35, cz),
    box(0.35, 0.7, w + 0.4, cx - d / 2, h + 0.35, cz),
  ];
  if (!parts.concrete) parts.concrete = [];
  parts.concrete.push(...par);

  // rooftop clutter so aerials do not look like empty boxes
  if (roofDetail && roofDetail !== false) {
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const uw = 1.4 + rng() * 2.6, uh = 0.6 + rng() * 1.4, ud = 1.4 + rng() * 2.6;
      if (!parts.roofDetail) parts.roofDetail = [];
      parts.roofDetail.push(box(
        Math.min(uw, d - 2), uh, Math.min(ud, w - 2),
        cx + (rng() - 0.5) * Math.max(0.1, d - uw - 1.5),
        h + uh / 2,
        cz + (rng() - 0.5) * Math.max(0.1, w - ud - 1.5)
      ));
    }
  }
  return { cx, cz, w, d, h, style: key, tint: t };
}

function box(w, h, d, x, y, z, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

/** Simple flat-roof building block used for civic buildings (no facade texture). */
function plainBlock(parts, key, w, h, d, x, y, z, rotY = 0) {
  if (!parts[key]) parts[key] = [];
  parts[key].push(box(w, h, d, x, y + h / 2, z, rotY));
}

/* ------------------------------------------------------------------ *
 * Trees
 * ------------------------------------------------------------------ */
function addRoundTree(parts, rng, x, z, scale = 1) {
  const trunkH = (2.2 + rng() * 1.4) * scale;
  parts.trunk.push(cyl(0.16 * scale, 0.24 * scale, trunkH, x, trunkH / 2, z));

  const blobs = 2 + Math.floor(rng() * 2);
  const ci = Math.floor(rng() * 4);
  for (let i = 0; i < blobs; i++) {
    const r = (1.5 + rng() * 1.1) * scale;
    const s = new THREE.IcosahedronGeometry(r, 1);
    s.scale(1, 0.8 + rng() * 0.3, 1);
    s.translate(x + (rng() - 0.5) * 1.2 * scale, trunkH + (0.7 + rng() * 1.1) * scale, z + (rng() - 0.5) * 1.2 * scale);
    const k = `canopy${(ci + i) % 4}`;
    if (!parts[k]) parts[k] = [];
    parts[k].push(s);
  }
}

function addCypress(parts, rng, x, z, scale = 1) {
  const h = (4.5 + rng() * 3) * scale;
  const g = new THREE.ConeGeometry((0.7 + rng() * 0.4) * scale, h, 6, 2);
  g.translate(x, h / 2, z);
  const k = `canopy${Math.floor(rng() * 4)}`;
  if (!parts[k]) parts[k] = [];
  parts[k].push(g);
  parts.trunk.push(cyl(0.12, 0.18, 0.6, x, 0.3, z));
}

function cyl(rTop, rBot, h, x, y, z, seg = 7) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(x, y, z);
  return g;
}

/* ------------------------------------------------------------------ *
 * Park
 * ------------------------------------------------------------------ */
export function buildPark(parts, rng, lot, kind) {
  const { x0, x1, z0, z1 } = lot;
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

  // lawn
  const lawn = new THREE.PlaneGeometry(w, d);
  lawn.rotateX(-Math.PI / 2);
  lawn.translate(cx, 0.06, cz);
  (parts.grass ||= []).push(lawn);

  // diagonal paths (Miami style), plus a ring path on bigger lots
  const paths = [];
  const addPath = (x, z, pw, pd, rot = 0) => {
    const g = new THREE.PlaneGeometry(pw, pd);
    g.rotateX(-Math.PI / 2);
    if (rot) g.rotateY(rot);
    g.translate(x, 0.14, z);
    paths.push(g);
  };
  addPath(cx, cz, 7, Math.max(w, d) * 1.5, Math.PI / 4);
  addPath(cx, cz, 7, Math.max(w, d) * 0.55, -Math.PI / 4);
  if (Math.min(w, d) > 60) {
    const r = Math.min(w, d) * 0.32;
    const ring = new THREE.RingGeometry(r - 2.4, r + 2.4, 40, 1);
    ring.rotateX(-Math.PI / 2);
    ring.translate(cx, 0.13, cz);
    paths.push(ring);
  }
  (parts.plaza ||= []).push(...paths);

  // trees: jittered grid, kept off the paths
  const stepX = 13, stepZ = 13;
  for (let x = x0 + 7; x < x1 - 6; x += stepX) {
    for (let z = z0 + 7; z < z1 - 6; z += stepZ) {
      const px = x + (rng() - 0.5) * 6;
      const pz = z + (rng() - 0.5) * 6;
      // keep the two diagonals clear
      const onDiag = Math.abs((px - cx) - (pz - cz)) < 6 || Math.abs((px - cx) + (pz - cz)) < 6;
      if (onDiag) continue;
      if (rng() < 0.22) continue;
      if (rng() < 0.18) addCypress(parts, rng, px, pz, 0.9 + rng() * 0.5);
      else addRoundTree(parts, rng, px, pz, 0.85 + rng() * 0.6);
    }
  }

  // benches along the main diagonal
  for (let i = -2; i <= 2; i++) {
    const px = cx + i * 11, pz = cz + i * 11;
    if (px < x0 + 4 || px > x1 - 4) continue;
    (parts.wood ||= []).push(
      box(2.2, 0.12, 0.55, px, 0.65, pz + 3.4, Math.PI / 4),
      box(2.2, 0.5, 0.12, px - 0.2, 0.9, pz + 3.1, Math.PI / 4)
    );
    (parts.darkMetal ||= []).push(
      box(0.1, 0.5, 0.5, px - 0.8, 0.35, pz + 3.4, Math.PI / 4),
      box(0.1, 0.5, 0.5, px + 0.8, 0.35, pz + 3.4, Math.PI / 4)
    );
  }

  // lamp posts
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const px = cx + Math.cos(a) * Math.min(w, d) * 0.3;
    const pz = cz + Math.sin(a) * Math.min(w, d) * 0.3;
    (parts.darkMetal ||= []).push(cyl(0.08, 0.12, 4.6, px, 2.3, pz));
    (parts.lampGlow ||= []).push(sphere(0.22, px, 4.75, pz));
  }

  if (kind === 'playground') addPlayground(parts, rng, cx, cz, Math.min(w, d) * 0.34);
  if (kind === 'sports') addSportsField(parts, rng, x0, x1, z0, z1);
}

function sphere(r, x, y, z, seg = 8) {
  const g = new THREE.SphereGeometry(r, seg, seg - 2);
  g.translate(x, y, z);
  return g;
}

/** Playground: sand pit, climbing frame, slide, swing set, carousel. */
function addPlayground(parts, rng, cx, cz, size) {
  const r = Math.min(15, Math.max(9, size));

  const sand = new THREE.CircleGeometry(r, 24);
  sand.rotateX(-Math.PI / 2);
  sand.translate(cx, 0.16, cz);
  (parts.sand ||= []).push(sand);

  // climbing frame (posts + bars)
  const posts = [];
  for (const [dx, dz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) {
    posts.push(cyl(0.13, 0.13, 3.2, cx + dx, 1.6, cz + dz));
  }
  posts.push(box(8.6, 0.16, 0.16, cx, 3.2, cz - 3));
  posts.push(box(8.6, 0.16, 0.16, cx, 3.2, cz + 3));
  posts.push(box(0.16, 0.16, 6.3, cx - 4, 3.2, cz));
  (parts.colored ||= []).push({ color: 'red', geos: posts });

  // slide: tower + ramp
  const tower = [cyl(0.16, 0.16, 3.4, cx + 6, 1.7, cz - 5)];
  tower.push(box(1.6, 0.16, 1.6, cx + 6, 3.4, cz - 5));
  const slide = new THREE.BoxGeometry(1.1, 0.12, 5.2);
  slide.rotateX(-0.42);
  slide.translate(cx + 6, 2.0, cz - 2.4);
  (parts.colored ||= []).push({ color: 'yellow', geos: [...tower, slide] });

  // swing set
  const swing = [cyl(0.12, 0.12, 3.0, cx - 7, 1.5, cz + 4), cyl(0.12, 0.12, 3.0, cx - 1, 1.5, cz + 4)];
  swing.push(box(6.6, 0.14, 0.14, cx - 4, 3.0, cz + 4));
  (parts.colored ||= []).push({ color: 'blue', geos: swing });
  for (const sx of [-5.4, -2.6]) {
    (parts.darkMetal ||= []).push(box(0.06, 2.0, 0.06, cx + sx, 2.0, cz + 4));
    (parts.colored ||= []).push({ color: 'red', geos: [box(0.7, 0.1, 0.4, cx + sx, 1.0, cz + 4)] });
  }

  // carousel ring
  const ring = new THREE.TorusGeometry(2.6, 0.24, 6, 20);
  ring.rotateX(-Math.PI / 2);
  ring.translate(cx - 1, 1.0, cz - 6);
  (parts.colored ||= []).push({ color: 'green', geos: [ring, cyl(0.2, 0.3, 1.0, cx - 1, 0.5, cz - 6)] });

  // boundary hedge
  const hedgeParts = [];
  const hw = r + 5;
  hedgeParts.push(box(hw * 2, 1.1, 0.8, cx, 0.55, cz - hw));
  hedgeParts.push(box(hw * 2, 1.1, 0.8, cx, 0.55, cz + hw));
  hedgeParts.push(box(0.8, 1.1, hw * 2, cx - hw, 0.55, cz));
  (parts.hedge ||= []).push(...hedgeParts);
  void rng;
}

/** Sports field: pitch with markings, goals, running track corner, bleachers. */
function addSportsField(parts, rng, x0, x1, z0, z1) {
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const pw = Math.min(w - 16, 70), pd = Math.min(d - 16, 105);

  const pitch = new THREE.PlaneGeometry(pw, pd);
  pitch.rotateX(-Math.PI / 2);
  pitch.translate(cx, 0.09, cz);
  (parts.pitch ||= []).push(pitch);

  // lines
  const lines = [];
  const lineW = 0.16;
  lines.push(flat(pw, lineW, cx, cz - pd / 2));
  lines.push(flat(pw, lineW, cx, cz + pd / 2));
  lines.push(flat(lineW, pd, cx - pw / 2, cz));
  lines.push(flat(lineW, pd, cx + pw / 2, cz));
  lines.push(flat(lineW, pd, cx, cz));
  const circle = new THREE.RingGeometry(pw * 0.13, pw * 0.13 + lineW, 28);
  circle.rotateX(-Math.PI / 2);
  circle.translate(cx, 0.11, cz);
  lines.push(circle);
  (parts.roadPaint ||= []).push(...lines);

  // goals
  for (const s of [-1, 1]) {
    const gz = cz + s * pd / 2;
    (parts.white ||= []).push(
      cyl(0.1, 0.1, 2.4, cx - 3.6, 1.2, gz),
      cyl(0.1, 0.1, 2.4, cx + 3.6, 1.2, gz),
      box(7.4, 0.16, 0.16, cx, 2.4, gz)
    );
  }

  // bleachers on one side
  for (let i = 0; i < 4; i++) {
    (parts.concrete ||= []).push(box(28, 0.5, 1.4, cx - pw / 2 - 5 - i * 1.4, 0.25 + i * 0.5, cz));
  }
  void rng;
}

function flat(w, d, x, z, y = 0.1) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/* ------------------------------------------------------------------ *
 * Landmarks for plaza / civic blocks
 * ------------------------------------------------------------------ */
export function buildLandmark(parts, rng, lot, feature) {
  const { x0, x1, z0, z1 } = lot;
  const glassStart = (parts.glass || []).length;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const w = x1 - x0, d = z1 - z0;

  // lawn verge around the whole block, paved deck in the middle
  const lawn = new THREE.PlaneGeometry(w - 2, d - 2);
  lawn.rotateX(-Math.PI / 2);
  lawn.translate(cx, 0.05, cz);
  (parts.grass ||= []).push(lawn);

  const deckW = Math.min(96, w * 0.56), deckD = Math.min(84, d * 0.6);
  const base = new THREE.PlaneGeometry(deckW, deckD);
  base.rotateX(-Math.PI / 2);
  base.translate(cx, 0.12, cz);
  (parts.plaza ||= []).push(base);
  for (const [bw, bd, bx, bz] of [
    [deckW, 3.0, cx, cz - deckD / 2 + 1.5], [deckW, 3.0, cx, cz + deckD / 2 - 1.5],
    [3.0, deckD, cx - deckW / 2 + 1.5, cz], [3.0, deckD, cx + deckW / 2 - 1.5, cz],
  ]) {
    const band = new THREE.PlaneGeometry(bw, bd);
    band.rotateX(-Math.PI / 2);
    band.translate(bx, 0.11, bz);
    (parts.sidewalk ||= []).push(band);
  }

  switch (feature) {
    case 'fountain': {
      const basin = new THREE.CylinderGeometry(9.5, 10.2, 1.1, 28);
      basin.translate(cx, 0.55, cz);
      (parts.lightConcrete ||= []).push(basin);
      const water = new THREE.CylinderGeometry(9.0, 9.0, 0.16, 28);
      water.translate(cx, 1.06, cz);
      (parts.water ||= []).push(water);
      const tier1 = cyl(3.4, 3.9, 2.6, cx, 2.2, cz, 18);
      const tier2 = cyl(1.3, 1.8, 2.2, cx, 4.3, cz, 16);
      (parts.lightConcrete ||= []).push(tier1, tier2);
      const w2 = new THREE.CylinderGeometry(1.9, 1.9, 0.12, 20);
      w2.translate(cx, 3.5, cz);
      const w3 = new THREE.CylinderGeometry(0.9, 0.9, 0.12, 16);
      w3.translate(cx, 5.4, cz);
      (parts.water ||= []).push(w2, w3);
      // planting ring + palms around the basin
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        addRoundTree(parts, rng, cx + Math.cos(a) * 17, cz + Math.sin(a) * 17, 0.95);
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
        (parts.planter ||= []).push(box(7, 0.85, 3, cx + Math.cos(a) * 26, 0.42, cz + Math.sin(a) * 26, -a));
      }
      break;
    }
    case 'school': {
      const bw = Math.min(w - 24, 74), bd = Math.min(d - 26, 30);
      const bh = 11;
      plainBlock(parts, 'civicWall', bw, bh, bd, cx, 0, cz - d * 0.16);
      if (!parts.civicWall) parts.civicWall = [];
      // window bands
      for (let f = 0; f < 3; f++) {
        (parts.glass ||= []).push(box(bw - 4, 1.6, bd + 0.3, cx, 2.6 + f * 3.2, cz - d * 0.16));
      }
      (parts.roofFlat ||= []).push(box(bw + 1, 0.6, bd + 1, cx, bh + 0.3, cz - d * 0.16));
      // sports court behind
      const court = new THREE.PlaneGeometry(bw * 0.7, 22);
      court.rotateX(-Math.PI / 2);
      court.translate(cx + bw * 0.05, 0.1, cz + d * 0.3);
      (parts.pitch ||= []).push(court);
      for (let i = 0; i < 5; i++) {
        addRoundTree(parts, rng, x0 + 10 + i * 9, z0 + 10, 0.9);
      }
      // flag pole
      (parts.white ||= []).push(cyl(0.1, 0.12, 9, cx + bw / 2 + 6, 4.5, cz - d * 0.16));
      break;
    }
    case 'hospital': {
      // a stepped white block with a red cross sign
      plainBlock(parts, 'civicWall', w * 0.52, 26, d * 0.46, cx, 0, cz - 4);
      plainBlock(parts, 'civicWall', w * 0.3, 34, d * 0.3, cx - w * 0.16, 0, cz - 12);
      for (let f = 0; f < 9; f++) {
        (parts.glass ||= []).push(box(w * 0.52 + 0.4, 1.4, d * 0.46 + 0.4, cx, 2.4 + f * 2.8, cz - 4));
      }
      (parts.roofFlat ||= []).push(box(w * 0.54, 0.7, d * 0.48, cx, 26.3, cz - 4));
      // helipad
      const pad = new THREE.CircleGeometry(7, 20);
      pad.rotateX(-Math.PI / 2);
      pad.translate(cx - w * 0.16, 34.1, cz - 12);
      (parts.lightConcrete ||= []).push(pad);
      // red cross on the roof
      (parts.red ||= []).push(
        box(10, 0.4, 3, cx - w * 0.16, 34.3, cz - 12),
        box(3, 0.4, 10, cx - w * 0.16, 34.3, cz - 12)
      );
      // ambulance bay + emergency canopy
      (parts.lightConcrete ||= []).push(box(w * 0.34, 5.5, 1.0, cx, 2.75, cz + d * 0.2));
      (parts.white ||= []).push(box(w * 0.34, 0.5, 7, cx, 5.6, cz + d * 0.2 + 3));
      for (const dx of [-w * 0.15, w * 0.15]) {
        (parts.darkMetal ||= []).push(cyl(0.16, 0.18, 5.5, cx + dx, 2.75, cz + d * 0.2 + 6));
      }
      // the red cross, lit, on both long facades
      for (const side of [-1, 1]) {
        const fz = cz - 4 + side * (d * 0.23 + 0.35);
        (parts.hospitalSign ||= []).push(
          box(9, 2.6, 0.5, cx, 20.5, fz),
          box(2.6, 9, 0.5, cx, 20.5, fz)
        );
      }
      break;
    }
    case 'police': {
      plainBlock(parts, 'civicWall', w * 0.5, 13, d * 0.42, cx, 0, cz);
      for (let f = 0; f < 3; f++) {
        (parts.glass ||= []).push(box(w * 0.5 + 0.4, 1.5, d * 0.42 + 0.4, cx, 2.4 + f * 3.4, cz));
      }
      (parts.roofFlat ||= []).push(box(w * 0.52, 0.6, d * 0.44, cx, 13.3, cz));
      (parts.blue ||= []).push(box(3.2, 0.4, 0.4, cx, 13.8, cz));
      // parking lot in front with bays
      (parts.asphalt ||= []).push(flat(w * 0.7, d * 0.34, cx, cz + d * 0.3, 0.07));
      for (let i = 0; i < 6; i++) {
        (parts.roadPaint ||= []).push(flat(0.12, 5, cx - w * 0.3 + i * 5.2, cz + d * 0.3));
      }
      break;
    }
    case 'fire': {
      plainBlock(parts, 'civicWall', w * 0.46, 9, d * 0.4, cx, 0, cz - d * 0.08);
      for (let i = 0; i < 3; i++) {
        (parts.red ||= []).push(box(7, 6, 0.4, cx - 12 + i * 12, 3, cz - d * 0.08 + d * 0.2 + 0.2));
      }
      (parts.roofFlat ||= []).push(box(w * 0.48, 0.6, d * 0.42, cx, 9.3, cz - d * 0.08));
      // training tower
      plainBlock(parts, 'concrete', 6, 20, 6, cx + w * 0.3, 0, cz - d * 0.3);
      break;
    }
    case 'church': {
      const nw = 16, nl = 30;
      plainBlock(parts, 'civicWall', nw, 12, nl, cx, 0, cz);
      // gable roof
      const roof = new THREE.CylinderGeometry(0.1, nw * 0.78, 5, 4, 1, false, Math.PI / 4);
      roof.scale(1, 1, nl / nw);
      roof.translate(cx, 14.5, cz);
      (parts.roofFlat ||= []).push(roof);
      // bell tower
      plainBlock(parts, 'lightConcrete', 8, 26, 8, cx, 0, cz - nl / 2 - 3);
      const spire = new THREE.ConeGeometry(5.6, 9, 4);
      spire.rotateY(Math.PI / 4);
      spire.translate(cx, 30.5, cz - nl / 2 - 3);
      (parts.lightConcrete ||= []).push(spire);
      // cross
      (parts.white ||= []).push(
        box(0.3, 3, 0.3, cx, 36.5, cz - nl / 2 - 3),
        box(1.6, 0.3, 0.3, cx, 37.2, cz - nl / 2 - 3)
      );
      // rose window
      const rose = new THREE.CircleGeometry(2.2, 16);
      rose.translate(cx, 16, cz - nl / 2 - 0.1);
      (parts.glass ||= []).push(rose);
      // hedges + path
      (parts.plaza ||= []).push(flat(6, nl * 0.8, cx, cz + nl * 0.2, 0.09));
      for (let i = 0; i < 4; i++) {
        addCypress(parts, rng, x0 + 8, z0 + 12 + i * 12, 1.1);
        addCypress(parts, rng, x1 - 8, z0 + 12 + i * 12, 1.1);
      }
      break;
    }
    case 'cinema': {
      plainBlock(parts, 'civicWall', w * 0.62, 14, d * 0.5, cx, 0, cz - 2);
      (parts.roofFlat ||= []).push(box(w * 0.64, 0.6, d * 0.52, cx, 14.3, cz - 2));
      // marquee: lit band + bulbs
      (parts.lampGlow ||= []).push(box(w * 0.5, 1.6, 0.4, cx, 9.5, cz + d * 0.25 - 2));
      for (let i = 0; i < 14; i++) {
        (parts.lampGlow ||= []).push(sphere(0.16, cx - w * 0.24 + i * (w * 0.48 / 13), 8.4, cz + d * 0.25 - 1.9));
      }
      // canopy + entrance
      (parts.darkMetal ||= []).push(box(w * 0.56, 0.4, 5, cx, 6.2, cz + d * 0.25 + 1.5));
      (parts.plaza ||= []).push(flat(w * 0.7, 12, cx, cz + d * 0.33, 0.09));
      break;
    }
    default: {
      // plain plaza with a monument
      const base = new THREE.CylinderGeometry(4, 4.6, 1.2, 12);
      base.translate(cx, 0.6, cz);
      (parts.lightConcrete ||= []).push(base);
      const obelisk = new THREE.CylinderGeometry(0.5, 1.2, 14, 4);
      obelisk.rotateY(Math.PI / 4);
      obelisk.translate(cx, 8.2, cz);
      (parts.landmark ||= []).push(obelisk);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addRoundTree(parts, rng, cx + Math.cos(a) * 16, cz + Math.sin(a) * 16, 1.0);
      }
    }
  }

  // the window bands just added to `glass` are lit interiors here, not dark panes
  if (parts.glass && parts.glass.length > glassStart) {
    const bands = parts.glass.splice(glassStart);
    (parts.windows ||= []).push(...bands);
  }

  dressPlaza(parts, rng, lot, cx, cz, w, d, feature);
}

/**
 * Street furniture for the civic squares: bench clusters, lamp posts, hedge
 * strips along the kerb and a tree row on the long edges.
 */
function dressPlaza(parts, rng, lot, cx, cz, w, d, feature) {
  const { x0, x1, z0, z1 } = lot;
  const benchAt = (bx, bz, rot = 0) => {
    (parts.wood ||= []).push(box(2.4, 0.14, 0.6, bx, 0.72, bz, rot));
    (parts.darkMetal ||= []).push(
      box(0.12, 0.55, 0.55, bx, 0.36, bz, rot),
      box(2.4, 0.5, 0.12, bx, 0.95, bz - 0.26, rot)
    );
  };

  // hedge strips along the kerb, with a gap in the middle on two sides
  const strip = (bx, bz, sw, sd) => (parts.hedge ||= []).push(box(sw, 0.9, sd, bx, 0.45, bz));
  strip(cx, z0 + 3.2, (w - 6) * 0.62, 1.2);
  strip(cx, z1 - 3.2, (w - 6) * 0.62, 1.2);
  strip(x0 + 3.2, cz, 1.2, (d - 6) * 0.62);
  strip(x1 - 3.2, cz, 1.2, (d - 6) * 0.62);

  // lamps on the corners
  for (const [lx, lz] of [[x0 + 7, z0 + 7], [x1 - 7, z0 + 7], [x0 + 7, z1 - 7], [x1 - 7, z1 - 7]]) {
    (parts.darkMetal ||= []).push(cyl(0.09, 0.14, 5.2, lx, 2.6, lz));
    (parts.lampGlow ||= []).push(sphere(0.26, lx, 5.35, lz));
  }

  // benches facing the monument / fountain
  for (const [bx, bz] of [[cx - 14, cz + 14], [cx + 14, cz + 14], [cx - 14, cz - 14], [cx + 14, cz - 14]]) {
    benchAt(bx, bz, Math.PI / 4);
  }

  // tree rows along the long edges
  const rows = Math.max(2, Math.floor((w - 20) / 12));
  for (let i = 0; i < rows; i++) {
    const tx = x0 + 12 + i * ((w - 24) / Math.max(1, rows - 1));
    addRoundTree(parts, rng, tx, z0 + 7.5, 0.85);
    addRoundTree(parts, rng, tx, z1 - 7.5, 0.85);
  }
  if (feature === 'fountain') {
    // lit bollards ring the fountain basin
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      (parts.lampGlow ||= []).push(sphere(0.18, cx + Math.cos(a) * 11.5, 0.6, cz + Math.sin(a) * 11.5));
    }
  }
}

/* ------------------------------------------------------------------ *
 * Paved blocks: market, gas station, parking
 * ------------------------------------------------------------------ */
export function buildPaved(parts, rng, lot, feature) {
  const { x0, x1, z0, z1 } = lot;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const w = x1 - x0, d = z1 - z0;

  // market squares get the paving deck, parking/gas the plain asphalt
  const deckKey = feature === 'market' ? 'plaza' : 'asphalt';
  (parts[deckKey] ||= []).push(flat(w - 4, d - 4, cx, cz, 0.09));

  if (feature === 'parking') {
    // rows of bays with a few parked cars
    for (let r = 0; r < 3; r++) {
      const pz = z0 + 14 + r * (d / 3.2);
      (parts.roadPaint ||= []).push(flat(w - 14, 0.14, cx, pz - 6));
      for (let i = 0; i < 9; i++) {
        const px = x0 + 10 + i * 6.4;
        (parts.roadPaint ||= []).push(flat(0.12, 5.4, px, pz));
        if (rng() < 0.55) {
          const c = ['red', 'blue', 'green', 'white'][Math.floor(rng() * 4)];
          (parts.colored ||= []).push({
            color: c,
            geos: [
              box(2.0, 0.7, 4.2, px + 3.2, 0.45, pz + 3.4),
              box(1.8, 0.55, 2.1, px + 3.2, 1.05, pz + 3.2),
            ],
          });
        }
      }
    }
    // hedge + trees along the edge
    (parts.hedge ||= []).push(box(w - 6, 1.0, 0.7, cx, 0.5, z0 + 3));
    for (let i = 0; i < 4; i++) addRoundTree(parts, rng, x0 + 10 + i * (w / 4.5), z1 - 8, 0.8);
  } else if (feature === 'market') {
    // market hall in the middle, stalls around
    plainBlock(parts, 'civicWall', w * 0.34, 9, d * 0.3, cx, 0, cz - d * 0.1);
    (parts.roofFlat ||= []).push(box(w * 0.36, 0.5, d * 0.32, cx, 9.25, cz - d * 0.1));
    const ring = Math.min(30, Math.min(w, d) * 0.32);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const px = cx + Math.cos(a) * ring;
      const pz = cz + Math.sin(a) * ring;
      // stall: awning on 4 posts
      const c = ['red', 'blue', 'green', 'yellow'][i % 4];
      (parts.colored ||= []).push({
        color: c,
        geos: [box(3.2, 0.2, 2.4, px, 2.4, pz)],
      });
      (parts.wood ||= []).push(
        cyl(0.07, 0.08, 2.4, px - 1.4, 1.2, pz - 1.0),
        cyl(0.07, 0.08, 2.4, px + 1.4, 1.2, pz - 1.0),
        cyl(0.07, 0.08, 2.4, px - 1.4, 1.2, pz + 1.0),
        cyl(0.07, 0.08, 2.4, px + 1.4, 1.2, pz + 1.0),
        box(3.2, 0.7, 2.0, px, 0.75, pz)
      );
      // crates on the counter
      (parts.colored ||= []).push({ color: 'white', geos: [box(0.7, 0.5, 0.7, px - 0.7, 1.3, pz)] });
    }
  } else if (feature === 'gas') {
    // canopy + pumps + shop
    plainBlock(parts, 'white', w * 0.2, 6, d * 0.3, x0 + w * 0.22, 0, cz);
    const canopy = box(w * 0.62, 0.7, d * 0.42, cx - w * 0.05, 5.6, cz);
    (parts.white ||= []).push(canopy);
    for (const [px, pz] of [[cx - 8, cz], [cx + 6, cz], [cx - 1, cz - 6], [cx - 1, cz + 6]]) {
      (parts.darkMetal ||= []).push(cyl(0.14, 0.16, 5.4, px, 2.7, pz));
    }
    for (let i = 0; i < 3; i++) {
      (parts.colored ||= []).push({
        color: 'red',
        geos: [box(1.0, 1.6, 0.8, cx - 10 + i * 6, 0.9, cz + 3)],
      });
    }
    // price sign
    (parts.lampGlow ||= []).push(box(6, 2.4, 0.35, x0 + 8, 7.5, z1 - 10));
    (parts.darkMetal ||= []).push(cyl(0.2, 0.25, 7.5, x0 + 8, 3.75, z1 - 10));
  }
}

/* ------------------------------------------------------------------ *
 * Street furniture along a road segment
 * ------------------------------------------------------------------ */
export function addStreetLamp(parts, x, z, rotY = 0) {
  (parts.darkMetal ||= []).push(
    cyl(0.1, 0.14, 6.0, x, 3.0, z),
    box(1.5, 0.12, 0.12, x + Math.cos(rotY) * 0.75, 6.0, z - Math.sin(rotY) * 0.75, rotY)
  );
  (parts.lampGlow ||= []).push(sphere(0.24, x + Math.cos(rotY) * 1.4, 5.95, z - Math.sin(rotY) * 1.4));
}

export function addTrafficLight(parts, x, z, rotY = 0) {
  (parts.darkMetal ||= []).push(
    cyl(0.11, 0.13, 5.2, x, 2.6, z),
    box(1.6, 0.12, 0.12, x + Math.cos(rotY) * 0.8, 5.2, z - Math.sin(rotY) * 0.8, rotY)
  );
  const hx = x + Math.cos(rotY) * 1.5, hz = z - Math.sin(rotY) * 1.5;
  (parts.darkMetal ||= []).push(box(0.4, 1.1, 0.4, hx, 4.7, hz));
  (parts.colored ||= []).push(
    { color: 'red', geos: [sphere(0.14, hx + 0.22 * Math.cos(rotY), 5.05, hz)] },
    { color: 'green', geos: [sphere(0.14, hx + 0.22 * Math.cos(rotY), 4.4, hz)] }
  );
}

/** Crosswalk stripes across a road at a given z (for N-S roads) or x (for E-W roads). */
export function addCrosswalk(parts, roadCenter, alongZ, roadHalf, at) {
  const geos = [];
  for (let i = -3; i <= 3; i++) {
    if (alongZ) {
      // stripes across an avenue, which runs along Z -> stripes run along X
      const g = new THREE.PlaneGeometry(roadHalf * 1.85, 0.55);
      g.rotateX(-Math.PI / 2);
      g.translate(roadCenter + i * 1.5, 0.02, at);
      geos.push(g);
    } else {
      const g = new THREE.PlaneGeometry(0.55, roadHalf * 1.85);
      g.rotateX(-Math.PI / 2);
      g.translate(at, 0.02, roadCenter + i * 1.5);
      geos.push(g);
    }
  }
  (parts.roadPaint ||= []).push(...geos);
}
