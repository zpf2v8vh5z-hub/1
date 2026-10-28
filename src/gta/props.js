/**
 * Scattered props that make the island read as a landscape instead of boxes:
 * palms along the coast and boulevards, oak/pine forest inland driven by the tree
 * mask, rocks on the ridgelines, scrub in the desert and beach umbrellas.
 *
 * Everything is placed from the real height/mask data and instanced.
 */
import * as THREE from 'three';
import { TEX } from '../textures.js';
import { WORLD, SEA_LEVEL } from './config.js';

function hash(i, salt = 0) {
  let h = (i * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** the baked control map: R water, G roads, B trees, A height */
async function loadMasks(base = '/gta5/terrain/') {
  const load = (url) => new Promise((res) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      res(t);
    }, undefined, () => res(null));
  });
  return load(base + 'control.png');
}

export class Props {
  constructor(terrain, buildings) {
    this.terrain = terrain;
    this.buildings = buildings;
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.counts = {};
  }

  async build(scene) {
    this.masks = await loadMasks();
    const t = this.terrain;

    // read the control texture back on the CPU for placement decisions
    const img = this.masks.image;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    this.controlW = img.width;
    this.controlH = img.height;
    this.control = px;

    const at = (x, y) => {
      const u = (x - WORLD.x0) / WORLD.width;
      const v = (y - WORLD.y0) / WORLD.height;
      const ix = Math.min(this.controlW - 1, Math.max(0, Math.round(u * (this.controlW - 1))));
      const iy = Math.min(this.controlH - 1, Math.max(0, Math.round((1 - v) * (this.controlH - 1))));
      const i = (iy * this.controlW + ix) * 4;
      return { water: px[i] / 255, road: px[i + 1] / 255, trees: px[i + 2] / 255 };
    };
    this.maskAt = at;

    // the game's own tree mask is only individual roadside trees, so the forest is
    // detected from the satellite mosaic instead: dark, green, unbuilt ground
    this.veg = this.vegetationFromSatellite();

    this.addPalms(scene, at);
    this.addForest(scene, at);
    this.addRocks(scene, at);
    this.addScrub(scene, at);
    scene.add(this.group);
    return this;
  }

  /**
   * greenness / darkness classification of every satellite texel, box-blurred,
   * so forest patches can be placed where the real map has trees.
   */
  vegetationFromSatellite() {
    const img = this.terrain.satellite?.image;
    if (!img) return null;
    const W = 1024, H = 1408;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const green = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
      // vegetation: green dominant and not a bright sand/rock surface
      const v = Math.max(0, (g - (r + b) * 0.5) / 255) * 2.4 + Math.max(0, 0.42 - lum) * 1.1;
      green[i] = Math.min(1, v * 1.7);
    }
    // 3x3 blur so single dark roofs do not become forest
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            sum += green[ny * W + nx]; n++;
          }
        }
        out[y * W + x] = sum / n;
      }
    }
    return { data: out, w: W, h: H };
  }

  /** 0..1 vegetation density at world (x, y) */
  vegAt(x, y) {
    const v = this.veg;
    if (!v) return 0;
    const u = (x - WORLD.x0) / WORLD.width;
    const t = (y - WORLD.y0) / WORLD.height;
    const ix = Math.min(v.w - 1, Math.max(0, Math.round(u * (v.w - 1))));
    const iy = Math.min(v.h - 1, Math.max(0, Math.round((1 - t) * (v.h - 1))));
    return v.data[iy * v.w + ix];
  }

  /* -------------------------------------------------------------- *
   * palms: coast + the wide boulevards, dense near the beaches
   * -------------------------------------------------------------- */
  addPalms(scene, at) {
    const t = this.terrain;
    const spots = [];
    const step = 26;
    for (let x = WORLD.x0 + 40; x < WORLD.x1 - 40; x += step) {
      for (let y = WORLD.y0 + 40; y < WORLD.y1 - 40; y += step) {
        const h = t.heightAt(x, y);
        if (h < SEA_LEVEL + 1.2 || h > 40) continue;
        const m = at(x, y);
        if (m.water > 0.1) continue;
        const jx = x + (hash(x + y * 31, 1) - 0.5) * step;
        const jy = y + (hash(x * 7 + y, 2) - 0.5) * step;
        const hh = t.heightAt(jx, jy);
        if (hh < SEA_LEVEL + 1) continue;
        const coast = hh < SEA_LEVEL + 12;
        const nearRoad = m.road > 0.25;
        const chance = coast ? 0.42 : nearRoad ? 0.30 : 0.04;
        if (hash(x * 13 + y * 3, 3) > chance) continue;
        spots.push({ x: jx, y: jy, h: hh });
      }
    }
    this.counts.palms = spots.length;

    const variants = [0, 1, 2].map((v) => makePalm(v));
    variants.forEach((geo, v) => {
      const list = spots.filter((_, i) => i % 3 === v);
      if (!list.length) return;
      const trunk = new THREE.InstancedMesh(geo.trunk, TEX.palmBark ? mat(TEX.palmBark, 0xcbb6a4, 0.9) : mat(null, 0x9a8771, 0.9), list.length);
      const fronds = new THREE.InstancedMesh(geo.fronds, frondMaterial(), list.length);
      trunk.castShadow = fronds.castShadow = true;
      trunk.receiveShadow = fronds.receiveShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      list.forEach((p, i) => {
        const s = 0.8 + hash(i + v * 97, 4) * 0.5;
        e.set(0, hash(i, 5) * Math.PI * 2, (hash(i, 6) - 0.5) * 0.12);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(p.x, p.h - 0.2, p.y), q, new THREE.Vector3(s, s, s));
        trunk.setMatrixAt(i, m4);
        fronds.setMatrixAt(i, m4);
      });
      trunk.instanceMatrix.needsUpdate = true;
      fronds.instanceMatrix.needsUpdate = true;
      trunk.name = 'palm_trunks';
      fronds.name = 'palm_fronds';
      this.group.add(trunk, fronds);
    });
  }

  /* -------------------------------------------------------------- *
   * forest: driven by the tree mask, densest in the hills
   * -------------------------------------------------------------- */
  addForest(scene, at) {
    const t = this.terrain;
    const spots = [];
    const step = 17;
    for (let x = WORLD.x0 + 20; x < WORLD.x1 - 20; x += step) {
      for (let y = WORLD.y0 + 20; y < WORLD.y1 - 20; y += step) {
        const veg = this.vegAt(x, y);
        if (veg < 0.22) continue;
        const jx = x + (hash(x + y * 17, 7) - 0.5) * step;
        const jy = y + (hash(x * 5 + y, 8) - 0.5) * step;
        const h = t.heightAt(jx, jy);
        if (h < SEA_LEVEL + 1.5 || h > 700) continue;
        if (this.maskAt(jx, jy).road > 0.4) continue;
        if (hash(x * 3 + y * 11, 9) > Math.min(0.92, veg * 1.5)) continue;
        if (t.slopeAt(jx, jy) > 0.6) continue;
        spots.push({ x: jx, y: jy, h });
      }
    }
    this.counts.forest = spots.length;

    // two silhouettes: broadleaf (round crown) and conifer (cone)
    const broad = [], conifer = [];
    spots.forEach((s, i) => (hash(i, 10) < 0.55 ? broad : conifer).push(s));

    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 5, 6);
    trunkGeo.translate(0, 2.5, 0);
    const trunkMat = mat(TEX.bark, 0xffffff, 0.9);
    const crownGeo = new THREE.IcosahedronGeometry(3.6, 1);
    crownGeo.scale(1, 0.85, 1);
    crownGeo.translate(0, 7.2, 0);
    const crownMat = flat(TEX.foliage, 0xc3d193);
    const coneGeo = new THREE.ConeGeometry(3.4, 10, 8);
    coneGeo.translate(0, 8.5, 0);
    const coneMat = flat(TEX.foliage, 0xa8bb80);

    const place = (list, geo, material, name, yScale = 1) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      list.forEach((p, i) => {
        const s = 0.75 + hash(i, 11) * 0.85;
        e.set(0, hash(i, 12) * 6.28, 0);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(p.x, p.h - 0.3, p.y), q, new THREE.Vector3(s, s * yScale, s));
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = name;
      this.group.add(mesh);
    };
    place(broad, trunkGeo, trunkMat, 'forest_trunks');
    place(broad, crownGeo, crownMat, 'forest_crowns');
    place(conifer, coneGeo, coneMat, 'forest_conifers');
  }

  /* -------------------------------------------------------------- *
   * rocks on ridges and cliffs
   * -------------------------------------------------------------- */
  addRocks(scene, at) {
    const t = this.terrain;
    const spots = [];
    const step = 46;
    for (let x = WORLD.x0 + 30; x < WORLD.x1 - 30; x += step) {
      for (let y = WORLD.y0 + 30; y < WORLD.y1 - 30; y += step) {
        const h = t.heightAt(x, y);
        if (h < SEA_LEVEL + 3) continue;
        const slope = t.slopeAt(x, y);
        if (slope < 0.28) continue;
        if (hash(x + y * 3, 13) > slope * 0.9) continue;
        spots.push({ x, y, h, s: 1 + slope * 4 });
      }
    }
    this.counts.rocks = spots.length;
    if (!spots.length) return;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    geo.scale(1, 0.7, 1);
    const mesh = new THREE.InstancedMesh(geo, mat(TEX.rock, 0xffffff, 0.95), spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    spots.forEach((p, i) => {
      const s = 1.5 + hash(i, 14) * 4.5 * p.s * 0.4;
      e.set(hash(i, 15) * 0.4, hash(i, 16) * 6.28, hash(i, 17) * 0.4);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(p.x, p.h - s * 0.25, p.y), q,
        new THREE.Vector3(s, s * 0.8, s * (0.8 + hash(i, 18) * 0.5)));
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'rocks';
    this.group.add(mesh);
  }

  /* -------------------------------------------------------------- *
   * desert scrub
   * -------------------------------------------------------------- */
  addScrub(scene, at) {
    const t = this.terrain;
    const spots = [];
    const step = 22;
    for (let x = WORLD.x0 + 25; x < WORLD.x1 - 25; x += step) {
      for (let y = WORLD.y0 + 25; y < WORLD.y1 - 25; y += step) {
        const h = t.heightAt(x, y);
        if (h < SEA_LEVEL + 1.5) continue;
        const m = at(x, y);
        if (m.road > 0.4 || m.water > 0.1) continue;
        if (this.vegAt(x, y) > 0.18) continue;
        if (hash(x + y * 7, 19) > 0.16) continue;
        if (t.slopeAt(x, y) > 0.5) continue;
        spots.push({ x, y, h });
      }
    }
    this.counts.scrub = spots.length;
    if (!spots.length) return;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    geo.scale(1, 0.62, 1);
    const mesh = new THREE.InstancedMesh(geo, flat(TEX.foliage, 0x9aa06a), spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    spots.forEach((p, i) => {
      const s = 0.7 + hash(i, 20) * 1.8;
      e.set(0, hash(i, 21) * 6.28, 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(p.x, p.h + s * 0.2, p.y), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'scrub';
    this.group.add(mesh);
  }
}

/* ------------------------------------------------------------------ */
function mat(map, color, roughness) {
  const t = map ? map.clone() : null;
  if (t) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
    t.needsUpdate = true;
  }
  return new THREE.MeshStandardMaterial({ map: t, color, roughness, metalness: 0.02 });
}

function flat(map, color) {
  const t = map ? map.clone() : null;
  if (t) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    t.needsUpdate = true;
  }
  return new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.9, flatShading: true });
}

function frondMaterial() {
  return new THREE.MeshStandardMaterial({
    map: TEX.palmFrond, alphaTest: 0.3, side: THREE.DoubleSide,
    roughness: 0.8, color: 0xbfd39a, emissive: 0x22300f, emissiveIntensity: 0.45,
  });
}

/** bent trunk + alpha-cut frond crown, same recipe as the Miami scene */
function makePalm(v) {
  const h = 11 + v * 3;
  const bend = 0.6 + v * 0.4;
  const seg = 10;
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const r = 0.30 * (1 - t * 0.62);
    const x = Math.pow(t, 1.8) * bend;
    const y = t * h;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      pos.push(x + Math.cos(a) * r, y, Math.sin(a) * r);
      nor.push(Math.cos(a), 0.15, Math.sin(a));
      uv.push(k / 7, t * 6);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < 7; k++) {
      const a = i * 7 + k, b = i * 7 + ((k + 1) % 7);
      const c = a + 7, d = b + 7;
      idx.push(a, c, b, b, c, d);
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  trunk.setIndex(idx);

  // fronds: flat alpha-cut quads radiating from the crown
  const fronds = [];
  const rings = 3;
  for (let r = 0; r < rings; r++) {
    const n = 7 + r * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r * 0.4;
      const len = (3.4 - r * 0.5) * (0.85 + ((i * 37) % 10) / 30);
      const g = new THREE.PlaneGeometry(len, 1.1, 3, 1);
      g.translate(len / 2, 0, 0);
      g.rotateZ(-0.25 - r * 0.18);
      g.rotateY(a);
      g.translate(bend, h + r * 0.35, 0);
      fronds.push(g);
    }
  }
  const merged = mergeAll(fronds);
  return { trunk, fronds: merged };
}

function mergeAll(list) {
  // minimal merge: positions + uvs + normals, all non-indexed
  const geos = list.map((g) => g.toNonIndexed());
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
