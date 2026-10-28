/**
 * San Andreas terrain.
 *
 * The height field comes from `public/gta5/terrain/height.bin` (Int16, 2 cm
 * resolution, 2048 x 2816 texels over 9000 x 12410 m). It is used for three
 * things: building the chunk LOD meshes, sampling ground height for the car, and
 * placing every prop and building exactly on the surface.
 *
 * Chunks are 500 m squares; each keeps three LODs and picks one by distance to the
 * camera. The albedo is the satellite mosaic (the actual GTA V map) modulated by
 * tiled AI detail textures chosen per biome and blended by distance.
 */
import * as THREE from 'three';
import { WORLD, SEA_LEVEL, VIEW } from './config.js';
import { TEX } from '../textures.js';

const CHUNK = 500;                       // metres
const COLS = Math.ceil(WORLD.width / CHUNK);
const ROWS = Math.ceil(WORLD.height / CHUNK);

// The road ribbons are laid on this same height field, so the finest LOD has to be
// dense enough that the drawn ground never bulges through the asphalt. At 5 m a
// 500 m chunk already takes 10 k vertices, which is cheap next to the building set.
const LODS = [
  { step: 5, maxDist: 420 },             // 100 x 100 quads, 25 cm accuracy
  { step: 10, maxDist: 1100 },
  { step: 25, maxDist: 2600 },
  { step: 60, maxDist: VIEW.terrainRadius },
];

export class Terrain {
  constructor() {
    this.meta = null;
    this.heights = null;                  // Int16Array over the height grid
    this.gw = 0;
    this.gh = 0;
    this.chunks = [];
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.material = null;
    this.visibleCount = 0;
  }

  async load(onProgress) {
    const base = '/gta5/terrain/';
    const meta = await (await fetch(base + 'meta.json')).json();
    this.meta = meta;

    onProgress?.(0.15);
    const buf = await (await fetch(base + 'height.bin')).arrayBuffer();
    this.heights = new Int16Array(buf);
    this.gw = meta.heightBin.width;
    this.gh = meta.heightBin.height;
    this.scale = meta.heightBin.scale;    // 0.02 m per unit

    onProgress?.(0.6);
    this.satellite = await loadTex(base + 'satellite.jpg', true);
    this.control = await loadTex(base + 'control.png', false);
    onProgress?.(0.9);
    return this;
  }

  /** bilinear ground height in metres at GTA world (x, y) */
  heightAt(x, y) {
    const m = this.meta;
    const gx = ((x - WORLD.x0) / WORLD.width) * (this.gw - 1);
    const gy = ((WORLD.y1 - y) / WORLD.height) * (this.gh - 1);
    return this.sampleGrid(gx, gy);
  }

  heightAtPixel(gx, gy) {
    return this.sampleGrid(gx, gy);
  }

  sampleGrid(gx, gy) {
    const { gw, gh, heights } = this;
    if (gx < 0 || gy < 0 || gx >= gw - 1 || gy >= gh - 1) return 0;
    const x0 = gx | 0, y0 = gy | 0;
    const fx = gx - x0, fy = gy - y0;
    const i = y0 * gw + x0;
    const h00 = heights[i], h10 = heights[i + 1];
    const h01 = heights[i + gw], h11 = heights[i + gw + 1];
    const a = h00 + (h10 - h00) * fx;
    const b = h01 + (h11 - h01) * fx;
    return (a + (b - a) * fy) * this.scale;
  }

  /** surface normal from the height field, in Three space */
  normalAt(x, y, out = new THREE.Vector3()) {
    const d = 6;
    const hl = this.heightAt(x - d, y);
    const hr = this.heightAt(x + d, y);
    const hd = this.heightAt(x, y - d);
    const hu = this.heightAt(x, y + d);
    out.set(hl - hr, 2 * d, hd - hu).normalize();
    return out;
  }

  slopeAt(x, y) {
    const n = this.normalAt(x, y);
    return 1 - n.y;                       // 0 = flat, 1 = vertical
  }

  /** true where the terrain is at or below sea level */
  isWater(x, y) {
    return this.heightAt(x, y) <= SEA_LEVEL + 0.4;
  }

  /* ---------------------------------------------------------------- *
   * meshes
   * ---------------------------------------------------------------- */
  build(scene) {
    this.material = makeTerrainMaterial(this.satellite, this.control);
    for (let cz = 0; cz < ROWS; cz++) {
      for (let cx = 0; cx < COLS; cx++) {
        this.chunks.push(new TerrainChunk(this, cx, cz));
      }
    }
    scene.add(this.group);
    return this;
  }

  /** pick LODs and rebuild the chunks that changed — call every frame */
  update(camera) {
    const px = camera.position.x, pz = camera.position.z;
    let visible = 0;
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(px - c.centerX) - CHUNK / 2);
      const dz = Math.max(0, Math.abs(pz - c.centerZ) - CHUNK / 2);
      const d = Math.hypot(dx, dz);
      let lod = -1;
      for (let i = 0; i < LODS.length; i++) {
        if (d <= LODS[i].maxDist) { lod = i; break; }
      }
      if (lod < 0) {
        if (c.mesh) c.mesh.visible = false;
        continue;
      }
      c.ensure(lod, this.material);
      c.mesh.visible = true;
      visible++;
    }
    this.visibleCount = visible;
  }
}

function loadTex(url, srgb) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 8;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

class TerrainChunk {
  constructor(terrain, cx, cz) {
    this.terrain = terrain;
    this.cx = cx;
    this.cz = cz;
    this.x0 = WORLD.x0 + cx * CHUNK;
    this.z0 = WORLD.y1 - (cz + 1) * CHUNK;      // north edge of the chunk
    this.centerX = this.x0 + CHUNK / 2;
    this.centerZ = this.z0 + CHUNK / 2;
    this.lod = -1;
    this.mesh = null;
  }

  ensure(lod, material) {
    if (this.lod === lod && this.mesh) return;
    const step = LODS[lod].step;
    // one extra ring of vertices on every side: neighbouring chunks use different LOD
    // steps, and without the overlap their T-junctions open up as black cracks
    const n = Math.ceil(CHUNK / step) + 2;
    const verts = (n + 1) * (n + 1);
    const ox = this.x0 - step;
    const oz = this.z0 - step;
    const pos = new Float32Array(verts * 3);
    const nor = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const t = this.terrain;

    let p = 0, q = 0;
    const nrm = new THREE.Vector3();
    for (let j = 0; j <= n; j++) {
      const wy = oz + j * step;
      for (let i = 0; i <= n; i++) {
        const wx = ox + i * step;
        const h = t.heightAt(wx, wy);
        pos[p] = wx; pos[p + 1] = h; pos[p + 2] = wy;
        t.normalAt(wx, wy, nrm);
        nor[p] = nrm.x; nor[p + 1] = nrm.y; nor[p + 2] = nrm.z;
        p += 3;
        uv[q++] = (wx - WORLD.x0) / WORLD.width;
        uv[q++] = (wy - WORLD.y0) / WORLD.height;
      }
    }

    const idx = new Uint32Array(n * n * 6);
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geo;
    } else {
      this.mesh = new THREE.Mesh(geo, material);
      // the baked shadow map cannot resolve a 400 m ground plane without acne, and
      // the terrain shader already shades slope and sun; buildings cast their own
      this.mesh.receiveShadow = false;
      this.mesh.castShadow = false;
      this.mesh.frustumCulled = true;
      this.mesh.name = `terrain_${this.cx}_${this.cz}`;
      t.group.add(this.mesh);
    }
    this.lod = lod;
  }
}

/* ------------------------------------------------------------------ *
 * material: satellite albedo + AI detail textures per biome
 * ------------------------------------------------------------------ */
function makeTerrainMaterial(satellite, control) {
  const detail = (tex, repeat) => {
    if (!tex) return null;
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    return t;
  };

  return new THREE.ShaderMaterial({
    uniforms: {
      uSat: { value: satellite },
      uControl: { value: control },
      uWorld: { value: new THREE.Vector4(WORLD.x0, WORLD.y0, WORLD.width, WORLD.height) },
      uSun: { value: new THREE.Vector3(-0.46, 0.45, 0.76).normalize() },
      uGrass: { value: detail(TEX.grass, 140) },
      uRock: { value: detail(TEX.rock, 160) },
      uDirt: { value: detail(TEX.dirt, 200) },
      uSand: { value: detail(TEX.sand, 300) },
      uForest: { value: detail(TEX.forest, 90) },
      uPaving: { value: detail(TEX.paving, 120) },
      uDetail: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec2 vWorld;
      varying vec3 vNormal;
      varying float vHeight;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vHeight = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D uSat, uControl, uGrass, uRock, uDirt, uSand, uForest, uPaving;
      uniform vec4 uWorld;
      uniform vec3 uSun;
      uniform float uDetail;
      varying vec2 vWorld;
      varying vec3 vNormal;
      varying float vHeight;

      const vec3 W = vec3(0.299, 0.587, 0.114);

      // The baked images have north at the top and three.js uploads textures flipped,
      // so v = 0 samples the southern edge of the image.
      vec2 satUv(vec2 w) {
        return vec2((w.x - uWorld.x) / uWorld.z,
                    (w.y - uWorld.y) / uWorld.w);
      }

      void main() {
        vec2 suv = satUv(vWorld);
        vec3 sat = texture2D(uSat, suv).rgb;

        vec4 ctrl = texture2D(uControl, suv);
        float water = ctrl.r;
        float road = ctrl.g;
        float trees = ctrl.b;

        float slope = 1.0 - clamp(vNormal.y, 0.0, 1.0);
        float alt = clamp((vHeight - 20.0) / 320.0, 0.0, 1.0);

        // ---- biome weights -----------------------------------------------------
        // built-up ground is grey and bright in the mosaic, vegetation is saturated:
        // that is enough to give every city block kerbs and concrete instead of grass
        float chroma = max(max(sat.r, sat.g), sat.b) - min(min(sat.r, sat.g), sat.b);
        float bright = dot(sat, W);
        float wUrban = smoothstep(0.26, 0.07, chroma) * smoothstep(0.10, 0.28, bright);

        float wForest = smoothstep(0.25, 0.75, trees) * (1.0 - wUrban * 0.7);
        float wRock = smoothstep(0.30, 0.62, slope);
        float wDirt = smoothstep(0.10, 0.45, alt) * 0.55;
        float wSand = smoothstep(0.55, 0.95, water) * 0.40;
        float wGrass = max(1.0 - wForest - wRock - wDirt * 0.5 - wSand - wUrban, 0.0);
        float sum = wGrass + wForest + wRock + wDirt + wSand + wUrban;
        wGrass /= sum; wForest /= sum; wRock /= sum; wDirt /= sum; wSand /= sum; wUrban /= sum;

        // ---- two detail octaves ------------------------------------------------
        // The satellite mosaic is 4.4 m per pixel, so up close it is a smear. Every
        // metre of ground gets AI grain (2.5 m period) plus a mid octave (9 m) so
        // nothing in the world is ever an untextured plane.
        vec3 fGrass = texture2D(uGrass, vWorld * 0.40).rgb;
        vec3 fRock  = texture2D(uRock,  vWorld * 0.30).rgb;
        vec3 fDirt  = texture2D(uDirt,  vWorld * 0.42).rgb;
        vec3 fSand  = texture2D(uSand,  vWorld * 0.62).rgb;
        vec3 fForest = texture2D(uForest, vWorld * 0.26).rgb;
        vec3 fPave = texture2D(uPaving, vWorld * 0.30).rgb;
        vec3 fine = fGrass * wGrass + fForest * wForest + fRock * wRock
                  + fDirt * wDirt + fSand * wSand + fPave * wUrban;

        vec3 cGrass = texture2D(uGrass, vWorld * 0.105).rgb;
        vec3 cRock  = texture2D(uRock,  vWorld * 0.075).rgb;
        vec3 cDirt  = texture2D(uDirt,  vWorld * 0.11).rgb;
        vec3 cSand  = texture2D(uSand,  vWorld * 0.16).rgb;
        vec3 cForest = texture2D(uForest, vWorld * 0.07).rgb;
        vec3 cPave = texture2D(uPaving, vWorld * 0.08).rgb;
        vec3 coarse = cGrass * wGrass + cForest * wForest + cRock * wRock
                    + cDirt * wDirt + cSand * wSand + cPave * wUrban;

        // ---- combine -----------------------------------------------------------
        // Grain is normalised to unit luminance and multiplied onto the satellite
        // colour, so the map keeps its palette but gains structure at every scale.
        float fL = max(dot(fine, W), 0.05);
        float cL = max(dot(coarse, W), 0.05);
        // grain keeps its own chroma but is normalised to mean 1, so multiplying it
        // onto the mosaic adds contrast without washing the island out
        vec3 grain = ((fine / fL) * 0.7 + (coarse / cL) * 0.3);
        grain /= max(dot(grain, W), 0.05);

        float dist = length(cameraPosition - vec3(vWorld.x, vHeight, vWorld.y));
        float nearMix = 1.0 - smoothstep(20.0, 260.0, dist);

        vec3 col = sat * mix(vec3(1.0), mix(vec3(1.0), grain, 0.85), uDetail * (0.45 + nearMix * 0.55));
        // the mosaic is 4.4 m per pixel: up close let the biome albedo carry the hue
        vec3 biome = fine * (dot(sat, W) / max(fL, 0.06));
        col = mix(col, mix(col, biome, 0.45), nearMix * 0.55);

        // roads read as asphalt
        col = mix(col, col * 0.55 + vec3(0.03), road * 0.75);

        vec3 n = normalize(vNormal);
        float ndl = max(dot(n, uSun), 0.0);
        vec3 ambient = vec3(0.38, 0.40, 0.48);
        vec3 lit = col * (ambient + 0.85 * ndl);
        lit *= mix(vec3(1.02, 0.97, 0.94), vec3(1.10, 0.93, 0.82), ndl * 0.6);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}
