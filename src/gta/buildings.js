/**
 * The 3.261 buildings of the GTA V map database, extruded onto the San Andreas
 * terrain and drawn with instanced meshes (6 draw calls for the whole island).
 *
 * The database only has a footprint *area*, not a shape, so a rectangle is derived
 * from it (aspect from the tier). Height comes from the building's Z where it is
 * plausible, otherwise from its category. Everything is snapped to the terrain
 * height so no building floats or sinks.
 */
import * as THREE from 'three';
import { TEX } from '../textures.js';
import { SEA_LEVEL, WORLD } from './config.js';
import { roadGridAt } from './roads.js';

/** every category mixes two or three facade textures so the city is not one colour */
const CATEGORY_STYLE = {
  landmark:    { tex: ['facadeCivic', 'facadeModern', 'facadeWhite'], aspect: 1.25, tint: 0.10, lit: 0.45, h: [12, 30], tower: 110, uv: [0.033, 0.028] },
  civic:       { tex: ['facadeCivic', 'facadeWhite'],                 aspect: 1.35, tint: 0.08, lit: 0.35, h: [8, 18],  tower: 40, uv: [0.05, 0.055] },
  office:      { tex: ['facadeOffice', 'facadeModern'],               aspect: 1.15, tint: 0.10, lit: 0.60, h: [12, 28], tower: 210, uv: [0.03, 0.026] },
  shop:        { tex: ['facadeBrick', 'shopfront', 'facadeWhite'],    aspect: 1.60, tint: 0.24, lit: 0.60, h: [4, 9],   tower: 14, uv: [0.11, 0.2] },
  food:        { tex: ['facadeBrick', 'shopfront'],                   aspect: 1.55, tint: 0.30, lit: 0.70, h: [4, 8],   tower: 12, uv: [0.11, 0.2] },
  auto:        { tex: ['facadeIndustrial', 'facadeBrick'],            aspect: 1.80, tint: 0.14, lit: 0.15, h: [4, 8],   tower: 10, uv: [0.08, 0.13] },
  online:      { tex: ['facadeModern', 'facadeOffice', 'facadeNeon'], aspect: 1.20, tint: 0.16, lit: 0.55, h: [10, 24], tower: 150, uv: [0.032, 0.028] },
  hotel:       { tex: ['facadeWhite', 'facadeCivic', 'facadeModern'], aspect: 1.30, tint: 0.12, lit: 0.60, h: [10, 26], tower: 90, uv: [0.045, 0.035] },
  residential: { tex: ['facadeResidential', 'facadeWhite', 'facadeBrick'], aspect: 1.45, tint: 0.30, lit: 0.55, h: [5, 11], tower: 26, uv: [0.05, 0.045] },
  industrial:  { tex: ['facadeIndustrial', 'facadeBrick'],            aspect: 1.90, tint: 0.10, lit: 0.18, h: [6, 14],  tower: 20, uv: [0.06, 0.09] },
};

const EMISSIVE_OF = {
  facadeCivic: 'facadeCivicEmissive',
  facadeOffice: 'facadeOfficeEmissive',
  facadeModern: 'facadeModernEmissive',
  facadeWhite: 'facadeWhiteEmissive',
  facadeBrick: 'facadeBrickEmissive',
  facadeResidential: 'facadeResidentialEmissive',
  facadeNeon: 'facadeNeonEmissive',
  shopfront: 'shopfrontEmissive',
  facadeIndustrial: null,
};

/** smooth value noise so neighbouring buildings agree on how tall their block is */
function blockNoise(x, y, cell = 260) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = x / cell - gx, fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (i, j) => hash(((i * 73856093) ^ (j * 19349663)) >>> 0, 7);
  const a = v(gx, gy), b = v(gx + 1, gy), c = v(gx, gy + 1), d = v(gx + 1, gy + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

/** distance falloff from downtown Los Santos — where the skyscrapers are */
const DOWNTOWN = { x: -145, y: -835, r: 460 };
function downtownFactor(x, y) {
  const dx = x - DOWNTOWN.x, dy = y - DOWNTOWN.y;
  return Math.exp(-(dx * dx + dy * dy) / (2 * DOWNTOWN.r * DOWNTOWN.r));
}

/** naive but stable hash so every run builds the identical city */
function hash(i, salt = 0) {
  let h = (i * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Reads the baked road mask so buildings can be aligned to the street they sit on
 * and pushed off the carriageway.
 */
class RoadField {
  constructor(terrain) {
    this.terrain = terrain;
    this.w = 0;
    this.h = 0;
    this.data = null;
  }

  ready() {
    const t = this.terrain.control;
    const img = t?.image;
    if (!img) return false;
    if (this.img === img) return true;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    this.data = ctx.getImageData(0, 0, img.width, img.height).data;
    this.w = img.width; this.h = img.height;
    this.img = img;
    return true;
  }

  at(x, y) {
    if (!this.data) return 0;
    const u = (x - WORLD.x0) / WORLD.width;
    const v = (y - WORLD.y0) / WORLD.height;
    const ix = Math.min(this.w - 1, Math.max(0, Math.round(u * (this.w - 1))));
    const iy = Math.min(this.h - 1, Math.max(0, Math.round((1 - v) * (this.h - 1))));
    return this.data[(iy * this.w + ix) * 4 + 1] / 255;    // G = roads
  }

  /** dominant street direction around (x, y), from the structure tensor of the mask */
  orientation(x, y, radius = 60) {
    let sxx = 0, syy = 0, sxy = 0;
    const step = radius / 3;
    const val = (px, py) => this.at(px, py) > 0.18 ? 1 : 0;
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        const px = x + i * step, py = y + j * step;
        const gx = val(px + step, py) - val(px - step, py);
        const gy = val(px, py + step) - val(px, py - step);
        sxx += gx * gx; syy += gy * gy; sxy += gx * gy;
      }
    }
    if (sxx + syy < 1) return null;
    // gradient is normal to the street, so the street runs along the minor axis
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return theta;                       // radians, angle of the gradient
  }

  /** is any road cell inside a `reach` radius around (x, y)? */
  roadWithin(x, y, reach) {
    if (!this.grid) return this.at(x, y) > 0.2;
    const r = Math.max(1, Math.round(reach / this.grid.cell));
    const cx = Math.floor((x - WORLD.x0) / this.grid.cell);
    const cy = Math.floor((y - WORLD.y0) / this.grid.cell);
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const gx = cx + i, gy = cy + j;
        if (gx < 0 || gy < 0 || gx >= this.grid.w || gy >= this.grid.h) continue;
        if (this.grid.data[gy * this.grid.w + gx]) return true;
      }
    }
    return false;
  }

  /**
   * Move a building off the carriageway: walks perpendicular to the street until the
   * whole footprint (plus a pavement) is clear, then along the street if that fails.
   */
  clearOfRoad(x, y, reach, half) {
    if (!this.roadWithin(x, y, reach)) return [x, y];
    const grad = this.orientation(x, y);
    const ang = grad === null ? Math.PI / 4 : grad;
    const nx = Math.cos(ang), ny = Math.sin(ang);
    for (let k = 1; k <= 12; k++) {
      const d = half + 6 + k * 5;
      for (const sgn of [1, -1]) {
        const px = x + nx * d * sgn, py = y + ny * d * sgn;
        if (!this.roadWithin(px, py, reach)) return [px, py];
      }
    }
    // give up on the perpendicular and slide along the street instead
    const tx = -ny, ty = nx;
    for (let k = 1; k <= 8; k++) {
      for (const sgn of [1, -1]) {
        const px = x + tx * k * 14 * sgn, py = y + ty * k * 14 * sgn;
        if (!this.roadWithin(px, py, reach)) return [px, py];
      }
    }
    return [x, y];
  }

  /** nudge a point off the carriageway, perpendicular to the local street */
  offRoad(x, y, half, maxTries = 8) {
    // already clear of the carriageway AND of its 6 m shoulder?
    if (this.at(x, y) < 0.05 && this.at(x + half, y) < 0.2 && this.at(x - half, y) < 0.2
        && this.at(x, y + half) < 0.2 && this.at(x, y - half) < 0.2) return [x, y];
    const theta = this.orientation(x, y);
    const ang = theta === null ? Math.PI / 4 : theta;
    const nx = Math.cos(ang), ny = Math.sin(ang);
    for (let k = 0; k < maxTries; k++) {
      const d = half + 8 + k * 6;
      for (const sgn of [1, -1]) {
        const px = x + nx * d * sgn, py = y + ny * d * sgn;
        if (this.at(px, py) < 0.2) return [px, py];
      }
    }
    return [x, y];
  }
}

export class Buildings {
  constructor(terrain) {
    this.terrain = terrain;
    this.data = [];
    this.meshes = [];
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    this.instances = [];      // { data, matrix, style }
    this.colliders = [];      // AABB for the car, only near the player
  }

  async load(mapDataUrl = '/gta5/map-data.js') {
    const src = await (await fetch(mapDataUrl)).text();
    // the file is a plain script that assigns window.__GTA5_MAP_DATA__
    const w = {};
    new Function('window', src)(w);
    this.raw = w.__GTA5_MAP_DATA__;
    return this;
  }

  /** turn database rows into boxes sitting on the terrain */
  build(scene, grid = null) {
    const t = this.terrain;
    const rows = this.raw.buildings;
    const byCat = new Map();
    const road = new RoadField(t);
    road.ready();
    road.grid = grid;
    this.road = road;

    for (let i = 0; i < rows.length; i++) {
      const b = rows[i];
      const style = CATEGORY_STYLE[b.category] || CATEGORY_STYLE.residential;
      const field = t.heightAt(b.x, b.y);
      if (field <= SEA_LEVEL - 0.5) continue;           // skip anything in the sea
      // the database z is the building's ground elevation — accurate, use it when sane
      const ground = Math.abs(b.z - field) < 26 ? b.z : field;

      // footprint from the area, shaped by the category aspect
      const area = Math.max(30, Math.min(b.areaM2 || 600, 2600));
      const aspect = style.aspect * (0.8 + hash(i, 1) * 0.45);
      const depth = Math.sqrt(area / aspect);
      const width = area / depth;

      // height: low-rise by default, towers where the district is downtown
      const cluster = blockNoise(b.x, b.y);
      const dn = downtownFactor(b.x, b.y);
      const tierBoost = b.tier === 1 ? 1.25 : b.tier === 3 ? 0.8 : 1;
      const low = style.h[0] + (style.h[1] - style.h[0]) * hash(i, 2);
      const tower = style.tower * Math.pow(dn, 1.5) * (0.45 + cluster * 0.9) * tierBoost;
      let height = Math.max(low, low * (0.7 + cluster * 0.8) + tower * (0.35 + cluster * 0.75));
      if (b.category === 'landmark' && b.isNamed) height = Math.max(height, 18 + dn * 90);
      height = Math.max(3.8, Math.min(height, 320));

      // align to the street grid and keep the footprint off the carriageway
      const grad = road.orientation(b.x, b.y);
      const yaw = grad === null
        ? (hash(i, 3) - 0.5) * 0.5
        : -grad + (hash(i, 3) < 0.15 ? Math.PI / 2 : 0);
      // keep the whole footprint (plus a 4 m pavement) off the carriageway
      const reach = Math.hypot(width, depth) * 0.5 + 4;
      const [px, py] = road.clearOfRoad(b.x, b.y, reach, Math.max(width, depth) * 0.5);
      const tint = 0.72 + hash(i, 5) * style.tint * 2;
      const row = {
        i, name: b.name, category: b.category, subtype: b.subtype,
        district: b.district, street: b.street, x: px, y: py,
        ground: Math.abs(t.heightAt(px, py) - ground) < 6 ? ground : t.heightAt(px, py),
        height, width, depth, yaw, tint,
        named: b.isNamed, area: b.areaM2, style,
      };
      this.data.push(row);
      const variant = Math.floor(hash(i, 21) * style.tex.length);
      const texName = style.tex[variant];
      row.variant = variant;
      row.texName = texName;
      row.emissiveName = EMISSIVE_OF[texName] || null;
      const key = `${b.category}_${variant}`;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push(row);
    }

    // one instanced mesh per category
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();

    for (const [cat, list] of byCat) {
      const baseCat = cat.split('_')[0];
      const style = { ...CATEGORY_STYLE[baseCat], tex: list[0].texName, emissive: list[0].emissiveName };
      const mat = makeFacadeMaterial(style);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.name = `buildings_${cat}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);

      list.forEach((row, idx) => {
        e.set(0, row.yaw, 0);
        q.setFromEuler(e);
        v.set(row.x, row.ground - 0.6, row.y);
        s.set(row.width, row.height + 0.6, row.depth);
        m4.compose(v, q, s);
        mesh.setMatrixAt(idx, m4);
        col.setRGB(row.tint, row.tint, row.tint);
        mesh.setColorAt(idx, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }

    scene.add(this.group);
    return this;
  }

  /** roof plate instanced mesh, added after the bodies so it can share their transform */
  addRoofs(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const map = TEX.roof ? TEX.roof.clone() : null;
    if (map) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true; }
    const mat = new THREE.MeshStandardMaterial({
      map, roughness: 0.88, metalness: 0.04, color: 0xb4b1ac,
    });
    // the plate is scaled to the footprint, so the texture is mapped in world space
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRoofPos;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          #ifdef USE_INSTANCING
            vRoofPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vRoofPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRoofPos;')
        .replace('#include <map_fragment>', 'diffuseColor *= texture2D(map, vRoofPos.xz * 0.07);');
    };
    mat.customProgramCacheKey = () => 'roofplate';
    const mesh = new THREE.InstancedMesh(geo, mat, this.data.length);
    mesh.name = 'building_roofs';
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    this.data.forEach((row, i) => {
      e.set(0, row.yaw, 0);
      q.setFromEuler(e);
      m4.compose(
        new THREE.Vector3(row.x, row.ground + row.height + 0.05, row.y),
        q,
        new THREE.Vector3(row.width * 1.02, 1, row.depth * 1.02)
      );
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.meshes.push(mesh);
    this.group.add(mesh);
    scene.add(this.group);
    return mesh;
  }

  /** AABB collisions for the buildings within `radius` of (x, y) */
  collisionsNear(x, y, radius = 260) {
    const out = [];
    const r2 = radius * radius;
    for (const row of this.data) {
      const dx = row.x - x, dz = row.y - y;
      if (dx * dx + dz * dz > r2) continue;
      out.push({
        x: row.x, z: row.y,
        w: row.width, d: row.depth,
        yaw: row.yaw,
        top: row.ground + row.height,
      });
    }
    return out;
  }

  /** nearest named place, for the HUD */
  nearestNamed(x, y, maxDist = 400) {
    let best = null, bestD = maxDist * maxDist;
    for (const row of this.data) {
      if (!row.named) continue;
      const dx = row.x - x, dz = row.y - y;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = row; }
    }
    return best ? { ...best, distance: Math.sqrt(bestD) } : null;
  }

  stats() {
    const byCat = {};
    for (const r of this.data) byCat[r.category] = (byCat[r.category] || 0) + 1;
    return { total: this.data.length, byCat, meshes: this.meshes.length };
  }
}

function makeFacadeMaterial(style) {
  const map = TEX[style.tex] || null;
  const emissiveMap = style.emissive ? TEX[style.emissive] : null;
  const t = map ? map.clone() : null;
  if (t) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
    t.needsUpdate = true;
  }
  const params = {
    map: t,
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.08,
    envMapIntensity: 0.7,
  };
  if (emissiveMap) {
    params.emissiveMap = emissiveMap;
    params.emissive = new THREE.Color(0xffffff);
    params.emissiveIntensity = 0.22 + style.lit * 0.35;
  }
  const mat = new THREE.MeshStandardMaterial(params);

  // Facades are textured in world space so the window grid stays metre-accurate no
  // matter how large the building is: 8 m of facade per texture repeat, 11 m of
  // storey per repeat vertically.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRoof = { value: TEX.roof || null };
    shader.uniforms.uFacadeUv = { value: new THREE.Vector2(style.uv?.[0] ?? 0.04, style.uv?.[1] ?? 0.035) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        vLocalNormal = normal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uRoof;
        uniform vec2 uFacadeUv;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;`)
      .replace('#include <map_fragment>', `
        vec2 nXZ = normalize(vLocalNormal.xz + vec2(1e-5));
        vec2 tangent = vec2(nXZ.y, -nXZ.x);
        bool isRoof = abs(vLocalNormal.y) > 0.5;
        vec2 facadeUv = isRoof
          ? vWorldPos.xz * 0.055
          : vec2(dot(vWorldPos.xz, tangent) * uFacadeUv.x, vWorldPos.y * uFacadeUv.y);
        vec4 sampledFacade = isRoof
          ? texture2D(uRoof, facadeUv)
          : texture2D(map, facadeUv);
        diffuseColor *= sampledFacade;
      `)
      .replace('#include <emissivemap_fragment>', `
        #ifdef USE_EMISSIVEMAP
          vec4 emissiveColor = texture2D(emissiveMap, facadeUv);
          totalEmissiveRadiance *= emissiveColor.rgb * sampledFacade.rgb * 1.15;
        #endif
      `);
  };
  mat.customProgramCacheKey = () => 'facade';
  return mat;
}
