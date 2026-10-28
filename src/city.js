import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID, crossStreets, planBlocks, makeBlockPicker, BLOCK_LABELS } from './cityplan.js';
import { makePalmGeometry } from './world.js';
import {
  makeCityMaterials, addBuilding, buildPark, buildLandmark, buildPaved, pickTint,
  addStreetLamp, addTrafficLight, addCrosswalk,
} from './cityblocks.js';

/**
 * Builds the district inland of Ocean Drive (positive X): a street grid with
 * one block per cell (housing rows, parks, playgrounds, plaza, school, hospital,
 * police, fire, church, cinema, market, gas station, parking, sports field),
 * street furniture, and a fence + fields border so the player cannot leave.
 *
 * Ocean Drive itself (x = 0) is built by world.js and stays untouched.
 */
export function buildCity(scene, rng, opts = {}) {
  void opts;
  const city = new THREE.Group();
  city.name = 'city';
  scene.add(city);

  const mats = makeCityMaterials();
  const parts = newParts();

  const cross = crossStreets();
  const avenueXs = GRID.avenues;              // [0 (Ocean Dr), 230, 450, 670]
  const gridAvenues = avenueXs.slice(1);      // avenues this module builds
  const zFirst = cross[0];
  const zLast = cross[cross.length - 1];
  const ring = GRID.ring;
  const xEast = ring.xEast;

  const lots = [];
  const palmPositions = [];   // street palms are instanced after the merge
  const blockBoxes = [];      // tight collision boxes for the buildings themselves
  const pickBlock = makeBlockPicker(rng);

  /* =================================================================
   * 1) ASPHALT: avenues, cross streets, ring road
   * ================================================================= */
  const zSpan = (zLast - zFirst) + GRID.crossHalf * 2 + 70;
  const zMid = (zFirst + zLast) / 2;

  for (const ax of gridAvenues) {
    parts.asphalt.push(footprint(GRID.avenueHalf * 2, zSpan, ax, zMid));
    for (let z = zFirst - 26; z < zLast + 26; z += 9) {
      parts.roadPaint.push(flatPlane(0.16, 3.6, ax, z, 0.02));
    }
    for (const side of [-1, 1]) {
      parts.roadPaint.push(flatPlane(0.14, zSpan, ax + side * (GRID.avenueHalf - 0.9), zMid, 0.02));
    }
  }
  const gates = GRID.gates;
  for (const cz of cross) {
    const isGate = gates.some((gz) => Math.abs(gz - cz) < 0.5);
    const xA = isGate ? GRID.avenueHalf * 0.55 : GRID.firstCellInset;   // gates meet Ocean Drive
    const xB = xEast + ring.half;
    parts.asphalt.push(footprint(xB - xA, GRID.crossHalf * 2, (xA + xB) / 2, cz));
    for (let x = xA; x < xB; x += 9) {
      parts.roadPaint.push(flatPlane(3.6, 0.16, x + 1.8, cz, 0.02));
    }
  }
  // ring road: east leg + north/south legs
  parts.asphalt.push(footprint(ring.half * 2, ring.zB - ring.zA, xEast, (ring.zA + ring.zB) / 2));
  for (const legZ of [ring.zA, ring.zB]) {
    parts.asphalt.push(footprint(xEast - 0 - ring.half, ring.half * 2, (xEast + ring.half) / 2, legZ));
    for (let x = 0; x < xEast; x += 9) parts.roadPaint.push(flatPlane(3.6, 0.16, x + 1.8, legZ, 0.02));
  }
  for (let z = ring.zA; z < ring.zB; z += 9) parts.roadPaint.push(flatPlane(0.16, 3.6, xEast, z, 0.02));

  /* =================================================================
   * 1b) GROUND: lawn/verge under the whole district so no dark void shows
   * ================================================================= */
  {
    const gx0 = GRID.avenueHalf;                       // starts at Ocean Drive's kerb
    const gx1 = GRID.border.xEast;
    const gz0 = GRID.border.zA;
    const gz1 = GRID.border.zB;
    parts.grass.push(flatPlane(gx1 - gx0, gz1 - gz0, (gx0 + gx1) / 2, (gz0 + gz1) / 2, -0.02));
  }

  /* =================================================================
   * 2) SIDEWALKS along every road edge
   * ================================================================= */
  const sw = GRID.avenueSidewalk;
  const csw = GRID.crossSidewalk;
  for (const ax of gridAvenues) {
    for (const side of [-1, 1]) {
      parts.sidewalk.push(blockBox(sw, 0.16, zSpan, ax + side * (GRID.avenueHalf + sw / 2), 0.08, zMid));
    }
  }
  for (const cz of cross) {
    const isGate = gates.some((gz) => Math.abs(gz - cz) < 0.5);
    const xA = isGate ? GRID.avenueHalf * 0.55 : GRID.firstCellInset;
    const xB = xEast + ring.half;
    for (const side of [-1, 1]) {
      parts.sidewalk.push(blockBox(xB - xA, 0.16, csw, (xA + xB) / 2, 0.08,
        cz + side * (GRID.crossHalf + csw / 2)));
    }
  }
  // ring road kerbs (inside only, the fence side is field)
  {
    const inner = ring.half + 2.0;
    parts.sidewalk.push(blockBox(4, 0.16, ring.zB - ring.zA, xEast - inner, 0.08, (ring.zA + ring.zB) / 2));
    for (const legZ of [ring.zA, ring.zB]) {
      parts.sidewalk.push(blockBox(xEast - 0, 0.16, 4, xEast / 2, 0.08, legZ - Math.sign(legZ - zMid) * -inner));
    }
  }

  // gate approaches: kerb line and centre line where the streets cross the hotel gap
  for (const gz of gates) {
    for (const side of [-1, 1]) {
      parts.sidewalk.push(blockBox(GRID.firstCellInset - 6, 0.16, 3.2,
        (GRID.firstCellInset + 6) / 2, 0.08, gz + side * (GRID.crossHalf + 1.6)));
    }
    for (let x = 8; x < GRID.firstCellInset; x += 9) {
      parts.roadPaint.push(flatPlane(3.6, 0.16, x + 1.8, gz, 0.02));
    }
  }

  /* =================================================================
   * 3) BLOCKS
   * ================================================================= */
  // columns: hotel row .. avenue 230 .. avenue 450 .. avenue 670
  const colBounds = [];
  for (let i = 0; i < gridAvenues.length; i++) {
    colBounds.push([i === 0 ? GRID.firstCellInset : gridAvenues[i - 1], gridAvenues[i]]);
  }
  // last row of blocks between the eastern avenue and the ring road
  colBounds.push([gridAvenues[gridAvenues.length - 1], ring.xEast - ring.half]);

  // 1) gather the cells, 2) assign the block plan, 3) fill them
  const cells = [];
  for (const [rawA, rawB] of colBounds) {
    const xa = rawA === GRID.firstCellInset ? rawA : rawA + GRID.avenueHalf + sw + GRID.lotInset;
    const xb = rawB - GRID.avenueHalf - sw - GRID.lotInset;
    for (let j = 0; j < cross.length - 1; j++) {
      const za = cross[j] + GRID.crossHalf + csw + GRID.lotInset;
      const zb = cross[j + 1] - GRID.crossHalf - csw - GRID.lotInset;
      if (xb - xa < 40 || zb - za < 40) continue;
      cells.push({ x0: xa, x1: xb, z0: za, z1: zb });
    }
  }
  void pickBlock;
  const plan = planBlocks(rng, cells.length);

  for (let ci = 0; ci < cells.length; ci++) {
    const lot = cells[ci];
    {
      const xa = lot.x0, xb = lot.x1, za = lot.z0, zb = lot.z1;
      const kind = plan[ci];
      lots.push(makeLotInfo(lot, kind));
      fillBlock(parts, blockBoxes, rng, lot, kind);

      // paved apron around built-up lots so buildings never sit on raw asphalt
      // (open lots — parks, plazas, paved — lay their own ground at 0.06+)
      if (kind.col === 'row') {
        parts.sidewalk.push(blockBox(xb - xa + 2.6, 0.16, zb - za + 2.6, (xa + xb) / 2, 0.075, (za + zb) / 2));
      }
    }
  }

  /* =================================================================
   * 4) STREET FURNITURE: lamps, traffic lights, crosswalks, street palms
   * ================================================================= */
  for (const ax of gridAvenues) {
    for (let z = zFirst; z < zLast; z += 34) {
      addStreetLamp(parts, ax - GRID.avenueHalf - 1.6, z, Math.PI / 2);
      addStreetLamp(parts, ax + GRID.avenueHalf + 1.6, z + 17, -Math.PI / 2);
      palmPositions.push({ x: ax + GRID.avenueHalf + 2.3, z: z + 9, s: 0.9 + rng() * 0.3 });
      palmPositions.push({ x: ax - GRID.avenueHalf - 2.3, z: z + 26, s: 0.85 + rng() * 0.3 });
    }
  }
  for (const cz of cross) {
    for (let x = 30; x < xEast - 20; x += 46) {
      addStreetLamp(parts, x, cz - GRID.crossHalf - 1.6, 0);
      palmPositions.push({ x: x + 20, z: cz + GRID.crossHalf + 2.3, s: 0.85 + rng() * 0.3 });
    }
    for (const ax of gridAvenues) {
      addTrafficLight(parts, ax - GRID.avenueHalf - 1.4, cz + GRID.crossHalf + 1.5, 0);
      addTrafficLight(parts, ax + GRID.avenueHalf + 1.4, cz - GRID.crossHalf - 1.5, Math.PI);
      addCrosswalk(parts, ax, true, GRID.avenueHalf, cz + GRID.crossHalf + 2.8);
      addCrosswalk(parts, ax, true, GRID.avenueHalf, cz - GRID.crossHalf - 2.8);
      addCrosswalk(parts, cz, false, GRID.crossHalf, ax + GRID.avenueHalf + 3.4);
      addCrosswalk(parts, cz, false, GRID.crossHalf, ax - GRID.avenueHalf - 3.4);
    }
  }

  /* =================================================================
   * 5) BORDER: fence + fields, the city cannot be left
   * ================================================================= */
  buildBorder(parts, rng, blockBoxes);

  /* =================================================================
   * 6) MERGE into a handful of meshes
   * ================================================================= */
  const merge = makeMerger();

  // parts.colored is a list of { color, geos } — bucketed by colour name
  const coloredBy = new Map();
  for (const entry of parts.colored || []) {
    if (!coloredBy.has(entry.color)) coloredBy.set(entry.color, []);
    coloredBy.get(entry.color).push(...entry.geos);
  }

  const skip = new Set(['colored', 'lampGlow']);
  const missing = [];
  // batch name -> material name (building batches are named after their facade set)
  const MAT_ALIAS = {
    deco: 'facadeDeco', brick: 'facadeBrick', modern: 'facadeModern', shops: 'facadeShops',
    office: 'facadeOffice', civic: 'facadeCivic',
  };
  // ground planes get their UVs rebuilt in world units, otherwise one tile spans a
  // whole block and the surface reads as flat colour
  const GROUND_UV = {
    asphalt: 9, sidewalk: 3.2, plaza: 6, grass: 7, field: 26, pitch: 12, dirt: 7, sand: 4,
  };
  for (const [key, list] of Object.entries(parts)) {
    if (skip.has(key) || !Array.isArray(list) || !list.length) continue;
    const geo = merge(list);
    if (!geo) continue;
    if (GROUND_UV[key]) groundUV(geo, GROUND_UV[key]);
    let mat;
    if (key.startsWith('canopy')) mat = mats.canopy[Number(key.slice(6)) || 0];
    else mat = mats[MAT_ALIAS[key] || key];
    if (!mat) {
      missing.push(key);
      mat = fallbackMaterial(key);
    }
    const mesh = new THREE.Mesh(geo, mat);
    const flatKeys = new Set(['roadPaint', 'plaza', 'asphalt', 'grass', 'sidewalk', 'pitch', 'sand',
      'water', 'dirt', 'field']);
    mesh.castShadow = !flatKeys.has(key);
    mesh.receiveShadow = true;
    mesh.name = `city_${key}`;
    city.add(mesh);
  }

  const colorMap = { red: mats.red, blue: mats.blue, green: mats.green, white: mats.white, yellow: mats.paintYellow };
  for (const [name, geos] of coloredBy) {
    const geo = merge(geos);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, colorMap[name] || mats.white);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    city.add(mesh);
  }

  // instanced palms along the avenues (same geometry as the ocean-front rows)
  {
    const variants = [0, 1, 2].map((v) => makePalmGeometry(rng, 0.8 + v * 0.13));
    const buckets = [[], [], []];
    palmPositions.forEach((p, i) => buckets[i % 3].push(p));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    buckets.forEach((list, v) => {
      if (!list.length) return;
      const { trunk, fronds } = variants[v];
      const trunkMesh = new THREE.InstancedMesh(trunk, mats.bark, list.length);
      const frondMesh = new THREE.InstancedMesh(fronds, mats.frond, list.length);
      trunkMesh.castShadow = frondMesh.castShadow = true;
      trunkMesh.receiveShadow = frondMesh.receiveShadow = true;
      list.forEach((p, i) => {
        e.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.08);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(p.x, 0.16, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
        trunkMesh.setMatrixAt(i, m4);
        frondMesh.setMatrixAt(i, m4);
      });
      trunkMesh.instanceMatrix.needsUpdate = true;
      frondMesh.instanceMatrix.needsUpdate = true;
      trunkMesh.name = 'cityPalmTrunks';
      frondMesh.name = 'cityPalmFronds';
      city.add(trunkMesh, frondMesh);
    });
  }

  // unlit glow batch: windows, lamps, neon
  {
    const geo = merge(parts.lampGlow.length ? parts.lampGlow : [new THREE.SphereGeometry(0.01, 4, 3)]);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffc98a).multiplyScalar(2.2),
    }));
    mesh.name = 'cityLampGlow';
    city.add(mesh);
  }

  /* =================================================================
   * 7) collision boxes
   * ================================================================= */
  const colliders = [...blockBoxes];

  return { group: city, lots, colliders, materials: mats, labels: BLOCK_LABELS, grid: GRID, missingMats: missing };
}

/* ------------------------------------------------------------------ *
 * collector + merge helpers
 * ------------------------------------------------------------------ */
function newParts() {
  return {
    asphalt: [], sidewalk: [], plaza: [], grass: [], hedge: [], dirt: [], field: [],
    roadPaint: [], concrete: [], lightConcrete: [], darkMetal: [], paintWhite: [], paintYellow: [],
    glass: [], water: [], trunk: [], canopy0: [], canopy1: [], canopy2: [], canopy3: [],
    roof: [], roof2: [], roof3: [], roofFlat: [], roofDetail: [], pitch: [], sand: [], wood: [], white: [],
    civicWall: [], landmark: [], lampGlow: [], colored: [],
    deco: [], brick: [], modern: [], shops: [], office: [], civic: [],
  };
}

function makeMerger() {
  return (list) => {
    const geos = list.filter((g) => g && g.attributes && g.attributes.position);
    if (!geos.length) return null;
    // mergeGeometries requires all inputs to either have an index or none of them
    const allIndexed = geos.every((g) => g.index);
    const norm = allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g));
    // …and the same attribute set on every geometry
    const keys = new Set();
    for (const g of norm) for (const k of Object.keys(g.attributes)) keys.add(k);
    for (const g of norm) {
      for (const k of keys) {
        if (g.attributes[k]) continue;
        const count = g.attributes.position.count;
        const size = k === 'uv' ? 2 : k === 'normal' ? 3 : k === 'color' ? 3 : 1;
        const arr = new Float32Array(count * size);
        if (k === 'normal') for (let i = 0; i < count; i++) arr[i * 3 + 1] = 1;
        if (k === 'color') arr.fill(1);
        g.setAttribute(k, new THREE.BufferAttribute(arr, size));
      }
    }
    try {
      return mergeGeometries(norm, false);
    } catch (err) {
      console.warn('city merge failed:', err?.message);
      return null;
    }
  };
}

function makeLotInfo(lot, kind) {
  return {
    ...lot,
    cx: (lot.x0 + lot.x1) / 2,
    cz: (lot.z0 + lot.z1) / 2,
    kind: kind.id,
    label: kind.label,
    open: kind.col !== 'row',
  };
}

/* ------------------------------------------------------------------ *
 * One block
 * ------------------------------------------------------------------ */
function fillBlock(parts, blockBoxes, rng, lot, kind) {
  if (kind.col === 'park') {
    buildPark(parts, rng, lot, kind.feature);
    return;
  }
  if (kind.col === 'pad') {
    buildLandmark(parts, rng, lot, kind.feature);
    // civic grounds are fenced off from the car by the building mass itself
    return;
  }
  if (kind.col === 'paved') {
    buildPaved(parts, rng, lot, kind.feature);
    return;
  }

  const { x0, x1, z0, z1 } = lot;
  const depth = Math.min(19, Math.max(10, (x1 - x0) * 0.28));
  const [hMin, hMax] = kind.h;
  const style = kind.style;

  const rowAlongZ = (xEdge, facing) => {
    let z = z0;
    while (z < z1 - 8) {
      const w = Math.min(11 + rng() * 13, z1 - z - 1);
      if (w < 7) break;
      const h = hMin + rng() * (hMax - hMin);
      addBuilding(parts, rng, {
        cx: xEdge + facing * depth / 2, cz: z + w / 2,
        w, d: depth, h, style,
        tint: pickTint(rng, style === 'modern' ? 0.14 : 0.28, style === 'modern' ? 0.66 : 0.62),
        roofDetail: true,
      });
      if (style === 'shops' || rng() < 0.28) {
        shopStrip(parts, rng, xEdge - facing * 0.06, z + w / 2, w * 0.88, 3.4, facing);
      }
      z += w + (rng() < 0.25 ? 2.4 + rng() * 3 : 0.7);
    }
  };

  const rowAlongX = (zEdge, facing) => {
    let x = x0 + depth + 6;
    while (x < x1 - depth - 6) {
      const w = Math.min(11 + rng() * 13, x1 - depth - 6 - x);
      if (w < 7) break;
      const h = hMin + rng() * (hMax - hMin);
      addBuilding(parts, rng, {
        cx: x + w / 2, cz: zEdge + facing * depth / 2,
        w: depth, d: w, h, style,
        tint: pickTint(rng, style === 'modern' ? 0.14 : 0.28, style === 'modern' ? 0.66 : 0.62),
      });
      x += w + (rng() < 0.25 ? 2.4 + rng() * 3 : 0.7);
    }
  };

  // rows facing the avenues (west and east edge of the block)
  rowAlongZ(x0, +1);
  rowAlongZ(x1, -1);
  // rows facing the cross streets
  if (z1 - z0 > 60) {
    rowAlongX(z0, +1);
    rowAlongX(z1, -1);
  }

  // courtyard: parking pad + trees
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const cw = x1 - x0, cd = z1 - z0;
  if (cw > 70 && cd > 60) {
    parts.asphalt.push(flatPlane(Math.min(26, cw * 0.28), Math.min(16, cd * 0.22), cx, cz, 0.06));
    for (let i = 0; i < 5; i++) parts.roadPaint.push(flatPlane(0.12, 4.6, cx - 10 + i * 5, cz, 0.07));
  }
  for (let i = 0; i < 7; i++) {
    const tx = cx + (rng() - 0.5) * (cw * 0.36);
    const tz = cz + (rng() - 0.5) * (cd * 0.36);
    roundTree(parts, rng, tx, tz, 0.8 + rng() * 0.5);
  }

  // the whole block is solid for the car (buildings + courtyard)
  blockBoxes.push({ x: cx, z: cz, w: cw, d: cd, kind: kind.id });
}

/** A lit shopfront strip on the ground floor. */
function shopStrip(parts, rng, x, cz, width, h, facing) {
  const [tw, th] = [14.6, 8.0];
  const geo = new THREE.PlaneGeometry(width, h, 1, 1);
  const uv = geo.attributes.uv;
  const uOff = Math.floor(rng() * 5) / 5;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * (width / tw) + uOff, uv.getY(i) * (h / th));
  }
  const tint = new THREE.Color().setHSL(0.05 + rng() * 0.1, 0.1, 0.92);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.rotateY(facing > 0 ? Math.PI / 2 : -Math.PI / 2);
  geo.translate(x, h / 2 + 0.2, cz);
  parts.shops.push(geo);
}

/* ------------------------------------------------------------------ *
 * Border: fence + fields (the "do not leave" ring)
 * ------------------------------------------------------------------ */
function buildBorder(parts, rng, blockBoxes) {
  const B = GRID.border;
  const ring = GRID.ring;

  // field ground outside the fence, and between roads and fence
  const fw = 400;
  parts.field.push(flatPlane(fw, B.zB - B.zA + fw * 2, B.xEast + fw / 2, (B.zA + B.zB) / 2, -0.04));
  parts.field.push(flatPlane(B.xEast + 400, fw, (B.xEast - 400) / 2 - 100, B.zB + fw / 2, -0.04));
  parts.field.push(flatPlane(B.xEast + 400, fw, (B.xEast - 400) / 2 - 100, B.zA - fw / 2, -0.04));
  // green verge between the ring road and the fence
  parts.grass.push(flatPlane(B.xEast - ring.xEast + ring.half + 2, B.zB - B.zA, (B.xEast + ring.xEast + ring.half) / 2, (B.zA + B.zB) / 2, 0.005));

  const fx = B.xEast;
  const fzA = B.zA;
  const fzB = B.zB;
  // light concrete posts + steel rails: has to read against the dark fields
  const railGeos = [];
  const postGeos = [];
  const addFenceRun = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 9));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      postGeos.push(blockBox(0.34, 3.0, 0.34, x0 + (x1 - x0) * t, 1.5, z0 + (z1 - z0) * t));
    }
    for (const ry of [0.9, 1.8, 2.7]) {
      const g = new THREE.BoxGeometry(len, 0.12, 0.12);
      g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      g.translate((x0 + x1) / 2, ry, (z0 + z1) / 2);
      railGeos.push(g);
    }
  };
  const fx0 = 14;                                      // starts at the hotel-row kerb
  addFenceRun(fx, fzA, fx, fzB);                       // east
  addFenceRun(fx0, fzB, fx, fzB);                      // north
  addFenceRun(fx0, fzA, fx, fzA);                      // south
  parts.darkMetal.push(...railGeos);
  parts.lightConcrete.push(...postGeos);

  // solid collision wall just outside the ring road so the car never passes
  blockBoxes.push({ x: (fx + ring.xEast) / 2, z: (fzA + fzB) / 2, w: fx - ring.xEast, d: fzB - fzA, kind: 'fence' });
  blockBoxes.push({ x: (fx0 + fx) / 2, z: (fzA + ring.zA) / 2, w: fx - fx0, d: ring.zA - fzA, kind: 'fence' });
  blockBoxes.push({ x: (fx0 + fx) / 2, z: (fzB + ring.zB) / 2, w: fx - fx0, d: fzB - ring.zB, kind: 'fence' });

  // hedge line just inside the fence
  for (const [x, z, w, d] of [
    [fx - 3.4, (fzA + fzB) / 2, 2.4, fzB - fzA],
    [(fx0 + fx) / 2, fzB - 3.4, fx - fx0, 2.4],
    [(fx0 + fx) / 2, fzA + 3.4, fx - fx0, 2.4],
  ]) {
    parts.hedge.push(blockBox(w, 2.0, d, x, 1.0, z));
  }

  // scrub in the fields outside
  for (let i = 0; i < 120; i++) {
    const side = Math.floor(rng() * 3);
    let x, z;
    if (side === 0) { x = fx + 4 + rng() * 260; z = fzA - 80 + rng() * (fzB - fzA + 160); }
    else if (side === 1) { x = 20 + rng() * (fx - 20); z = fzB + 5 + rng() * 200; }
    else { x = 20 + rng() * (fx - 20); z = fzA - 5 - rng() * 200; }
    const r = 0.7 + rng() * 1.7;
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 0.6, 1);
    g.translate(x, r * 0.42, z);
    const k = `canopy${Math.floor(rng() * 4)}`;
    parts[k].push(g);
  }
  // dirt tracks into the fields
  for (const z of [fzA - 120, fzA - 420, fzB + 150, fzB + 460]) {
    parts.dirt.push(flatPlane(300, 4.5, fx + 30, z, 0.0));
  }
}

/* ------------------------------------------------------------------ *
 * geometric helpers
 * ------------------------------------------------------------------ */
function flatPlane(w, d, x, z, y = 0.02) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
function blockBox(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}
function footprint(w, d, x, z) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, 0.0, z);
  return g;
}
function cylAt(rT, rB, h, x, y, z, seg = 7) {
  const g = new THREE.CylinderGeometry(rT, rB, h, seg);
  g.translate(x, y, z);
  return g;
}

function roundTree(parts, rng, x, z, scale) {
  const trunkH = (2.4 + rng() * 1.2) * scale;
  parts.trunk.push(cylAt(0.14 * scale, 0.22 * scale, trunkH, x, trunkH / 2, z));
  const blob = new THREE.IcosahedronGeometry((1.6 + rng() * 0.9) * scale, 1);
  blob.scale(1, 0.9, 1);
  blob.translate(x, trunkH + 1.3 * scale, z);
  parts[`canopy${Math.floor(rng() * 4)}`].push(blob);
}

/** Rebuild UVs from world XZ so ground textures tile at a fixed metre size. */
function groundUV(geo, tile) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / tile;
    uv[i * 2 + 1] = pos.getZ(i) / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function fallbackMaterial(key) {
  return new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8, name: key });
}

/** Exposed for the minimap / tests. */
export const CITY_GRID = GRID;
