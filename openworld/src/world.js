/* Builds the static city: sky, lighting, ground, roads, markings, buildings,
   trees and street lamps. Merged/instanced geometry keeps draw calls low. */

import * as THREE from "three";
import { boxWithUV, planeWithUV, place, merge, mergeColored } from "./geo.js";
import {
  toWorld,
  BLOCK_S,
  ROAD_W,
  CELL,
  WORLD_SIZE,
  N_BLOCKS,
  SIDEWALK,
  collisionBoxes,
} from "./city.js";
import { buildColliderGrid } from "./physics.js";

const TEX_DIR = "assets/tex/";
const ALBEDO = ["asphalt", "sidewalk", "facade-glass", "facade-concrete", "facade-brick", "grass"];

const FACADE_METERS = { "facade-glass": 13, "facade-concrete": 12, "facade-brick": 15 };

// --------------------------------------------------------------------- textures
function loadTexture(loader, name, { normal = false, setup } = {}) {
  const tex = loader.load(`${TEX_DIR}${name}${normal ? "_n" : ""}.${normal ? "png" : "jpg"}`);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (!normal) tex.colorSpace = THREE.SRGBColorSpace;
  if (setup) setup(tex);
  return tex;
}

export async function loadWorldTextures(onProgress = () => {}) {
  const loader = new THREE.TextureLoader();
  const tex = {};
  let done = 0;
  const total = ALBEDO.length * 2;
  const jobs = [];
  for (const name of ALBEDO) {
    jobs.push(
      new Promise((res) => {
        const t = loadTexture(loader, name);
        t.onLoad = () => { onProgress(++done / total); res(); };
        tex[name] = t;
      })
    );
    jobs.push(
      new Promise((res) => {
        const t = loadTexture(loader, name, { normal: true });
        t.onLoad = () => { onProgress(++done / total); res(); };
        tex[name + "_n"] = t;
      })
    );
  }
  await Promise.all(jobs);
  return tex;
}

function makeMaterials(tex) {
  const std = (albedo, normal, extra = {}) =>
    new THREE.MeshStandardMaterial({
      map: tex[albedo],
      normalMap: tex[normal],
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.9,
      metalness: 0,
      ...extra,
    });

  return {
    asphalt: std("asphalt", "asphalt_n", { roughness: 0.82, color: 0xb9bcc0 }),
    sidewalk: std("sidewalk", "sidewalk_n", { roughness: 0.88, color: 0xdadad4 }),
    grass: std("grass", "grass_n", { roughness: 0.98, color: 0xa8c98a }),
    glass: std("facade-glass", "facade-glass_n", {
      roughness: 0.18,
      metalness: 0.55,
      vertexColors: true,
      emissive: new THREE.Color(0x6b5a3f),
      emissiveMap: tex["facade-glass"],
      emissiveIntensity: 0.85,
    }),
    concrete: std("facade-concrete", "facade-concrete_n", {
      roughness: 0.86,
      metalness: 0.05,
      vertexColors: true,
      emissive: new THREE.Color(0x69563c),
      emissiveMap: tex["facade-concrete"],
      emissiveIntensity: 0.55,
    }),
    brick: std("facade-brick", "facade-brick_n", {
      roughness: 0.92,
      metalness: 0.02,
      vertexColors: true,
      emissive: new THREE.Color(0x5e4a33),
      emissiveMap: tex["facade-brick"],
      emissiveIntensity: 0.5,
    }),
    roof: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.95, metalness: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.55, metalness: 0.7 }),
    curb: new THREE.MeshStandardMaterial({ color: 0x9a9c98, roughness: 0.9 }),
    marking: new THREE.MeshStandardMaterial({ color: 0xc9cfc6, roughness: 0.75 }),
    lampGlow: new THREE.MeshBasicMaterial({ color: 0xffd7a0 }),
  };
}

// -------------------------------------------------------------------------- sky
export function createSky() {
  const uniforms = {
    top: { value: new THREE.Color(0x0a1430) },
    mid: { value: new THREE.Color(0x2f4a74) },
    horizon: { value: new THREE.Color(0xd98a4e) },
    sunDir: { value: new THREE.Vector3(-0.55, 0.16, -0.82).normalize() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(horizon, mid, smoothstep(0.46, 0.62, h));
        col = mix(col, top, smoothstep(0.62, 0.95, h));
        float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 90.0);
        col += vec3(1.0, 0.72, 0.4) * sun * 0.9;
        float halo = pow(max(dot(normalize(vDir), sunDir), 0.0), 6.0);
        col += vec3(0.9, 0.45, 0.2) * halo * 0.22;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------------ world
export function buildWorld(scene, city, tex) {
  const materials = makeMaterials(tex);
  const root = new THREE.Group();
  scene.add(root);

  scene.add(createSky());
  scene.fog = new THREE.Fog(0x3a4a63, 140, 620);

  // ---- lights
  const hemi = new THREE.HemisphereLight(0x9db6d8, 0x2a2a26, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffc38a, 2.4);
  sun.position.set(-260, 130, -320);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -170;
  sun.shadow.camera.right = 170;
  sun.shadow.camera.top = 170;
  sun.shadow.camera.bottom = -170;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.7;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x7fa6d8, 0.5);
  fill.position.set(200, 90, 240);
  scene.add(fill);

  // ---- ground: one asphalt plane under everything
  const groundGeo = planeWithUV(WORLD_SIZE + 400, WORLD_SIZE + 400, 7);
  const ground = new THREE.Mesh(groundGeo, materials.asphalt);
  ground.receiveShadow = true;
  root.add(ground);

  // ---- blocks: sidewalk slabs, curbs, park grass, parking lots
  const sidewalkGeos = [];
  const grassGeos = [];
  const curbGeos = [];
  const markingGeos = [];
  const lotGeos = [];

  for (const block of city.blocks) {
    const x0 = toWorld(block.x);
    const z0 = toWorld(block.z);
    const cx = x0 + BLOCK_S / 2;
    const cz = z0 + BLOCK_S / 2;

    sidewalkGeos.push(place(planeWithUV(BLOCK_S, BLOCK_S, 2), cx, 0.12, cz));

    // curb ring (thin raised border)
    const cw = 0.4;
    curbGeos.push(place(boxWithUV(BLOCK_S, 0.18, cw, 1), cx, 0.09, cz - BLOCK_S / 2 + cw / 2));
    curbGeos.push(place(boxWithUV(BLOCK_S, 0.18, cw, 1), cx, 0.09, cz + BLOCK_S / 2 - cw / 2));
    curbGeos.push(place(boxWithUV(cw, 0.18, BLOCK_S, 1), cx - BLOCK_S / 2 + cw / 2, 0.09, cz));
    curbGeos.push(place(boxWithUV(cw, 0.18, BLOCK_S, 1), cx + BLOCK_S / 2 - cw / 2, 0.09, cz));

    if (block.kind === "park") {
      const inner = BLOCK_S - SIDEWALK * 2;
      grassGeos.push(place(planeWithUV(inner, SIDEWALK, 6), cx, 0.14, cz - BLOCK_S / 2 + SIDEWALK + SIDEWALK / 2));
      grassGeos.push(place(planeWithUV(inner, inner, 6), cx, 0.14, cz));
      // path cross
      markingGeos.push(place(planeWithUV(2.4, inner, 1), cx, 0.15, cz));
      markingGeos.push(place(planeWithUV(inner, 2.4, 1), cx, 0.15, cz));
    }

    if (block.kind === "lot") {
      const inner = BLOCK_S - SIDEWALK * 2;
      const ix0 = x0 + SIDEWALK;
      const iz0 = z0 + SIDEWALK;
      lotGeos.push(place(planeWithUV(inner, inner, 7), ix0 + inner / 2, 0.135, iz0 + inner / 2));
      // parking bay lines
      for (let i = 0; i < 6; i++) {
        const px = ix0 + 4 + i * ((inner - 8) / 5);
        markingGeos.push(place(planeWithUV(0.16, inner - 6, 1), px, 0.145, iz0 + inner / 2));
      }
    }
  }

  // ---- lane markings + crosswalks
  for (let i = 0; i <= N_BLOCKS; i++) {
    const centre = toWorld(i * CELL + ROAD_W / 2);
    const roadStart = toWorld(0) - 40;
    const roadEnd = toWorld(WORLD_SIZE) + 40;

    // dashed centre line along both road directions
    for (const axis of ["x", "z"]) {
      for (let s = roadStart; s < roadEnd; s += 9) {
        const len = 4.5;
        const w = 0.22;
        if (axis === "x") markingGeos.push(place(planeWithUV(w, len, 1), centre, 0.02, s + len / 2));
        else markingGeos.push(place(planeWithUV(len, w, 1), s + len / 2, 0.02, centre));
      }
    }

    // stop lines + zebra crossings at every intersection
    for (let j = 0; j <= N_BLOCKS; j++) {
      const cz = toWorld(j * CELL + ROAD_W / 2);
      for (const [dirX, dirZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const off = ROAD_W / 2 + 2.2;
        const bx = centre + dirX * off;
        const bz = cz + dirZ * off;
        for (let k = -3; k <= 3; k++) {
          const stripe = 0.55;
          if (dirX !== 0) {
            markingGeos.push(place(planeWithUV(2.0, stripe, 1), bx, 0.022, bz + k * 1.15));
          } else {
            markingGeos.push(place(planeWithUV(stripe, 2.0, 1), bx + k * 1.15, 0.022, bz));
          }
        }
      }
    }
  }

  const addMerged = (geos, material, { shadow = false, receive = true } = {}) => {
    if (!geos.length) return null;
    const mesh = new THREE.Mesh(merge(geos), material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = receive;
    root.add(mesh);
    return mesh;
  };

  addMerged(sidewalkGeos, materials.sidewalk);
  addMerged(grassGeos, materials.grass);
  addMerged(curbGeos, materials.curb, { shadow: true });
  addMerged(lotGeos, materials.asphalt);
  addMerged(markingGeos, materials.marking);

  // ---- buildings, merged per facade type with baked vertex tint
  const byType = { "facade-glass": [], "facade-concrete": [], "facade-brick": [] };
  const roofGeos = [];

  for (const b of city.buildings) {
    const key = b.type.startsWith("facade-") ? b.type : `facade-${b.type}`;
    const meters = FACADE_METERS[key] || 12;
    const geo = boxWithUV(b.w, b.h, b.d, meters);
    const cx = toWorld(b.x + b.w / 2);
    const cz = toWorld(b.z + b.d / 2);
    place(geo, cx, b.h / 2, cz);

    const tint = new THREE.Color().setScalar(b.tint);
    tint.b = Math.min(1.15, tint.b * 1.02);
    (byType[key] || byType["facade-concrete"]).push({ geo, color: tint });

    // roof slab + occasional rooftop unit
    const slab = boxWithUV(b.w + 0.6, 0.5, b.d + 0.6, 4);
    roofGeos.push(place(slab, cx, b.h + 0.25, cz));
    const units = 1 + ((b.w * b.d) % 3 | 0);
    for (let u = 0; u < units; u++) {
      const uw = 2 + (u % 2) * 1.5;
      const uh = 1 + (u % 3) * 0.5;
      const ux = cx + ((u % 2 ? 1 : -1) * (b.w * 0.22));
      const uz = cz + ((u % 3 === 0 ? 1 : -1) * (b.d * 0.18));
      const unit = boxWithUV(uw, uh, uw * 0.8, 2);
      roofGeos.push(place(unit, ux, b.h + 0.5 + uh / 2, uz));
    }
  }

  for (const [type, entries] of Object.entries(byType)) {
    if (!entries.length) continue;
    const mesh = new THREE.Mesh(mergeColored(entries), materials[type]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  addMerged(roofGeos, materials.roof, { shadow: true });

  // ---- trees (instanced trunk + foliage)
  const treeCount = city.trees.length;
  if (treeCount) {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6);
    trunkGeo.translate(0, 1.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    trunks.castShadow = true;

    const leafGeo = new THREE.IcosahedronGeometry(2.1, 1);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeCount);
    leaves.castShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const color = new THREE.Color();
    city.trees.forEach((t, i) => {
      const s = t.scale;
      pos.set(toWorld(t.x), 0.12, toWorld(t.z));
      scl.set(s, s * (0.9 + t.seed * 0.4), s);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.seed * Math.PI * 2);
      m.compose(pos, q, scl);
      trunks.setMatrixAt(i, m);
      pos.y = 0.12 + 3.2 * s;
      m.compose(pos, q, scl);
      leaves.setMatrixAt(i, m);
      color.setHSL(0.24 + t.seed * 0.06, 0.42, 0.26 + t.seed * 0.12);
      leaves.setColorAt(i, color);
    });
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    root.add(trunks, leaves);
  }

  // ---- street lamps (instanced pole + emissive head)
  const lampCount = city.lamps.length;
  if (lampCount) {
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 6, 6);
    poleGeo.translate(0, 3, 0);
    const poles = new THREE.InstancedMesh(poleGeo, materials.metal, lampCount);
    poles.castShadow = true;
    const headGeo = new THREE.BoxGeometry(0.7, 0.18, 0.32);
    const heads = new THREE.InstancedMesh(headGeo, materials.lampGlow, lampCount);

    const m = new THREE.Matrix4();
    city.lamps.forEach((l, i) => {
      const x = toWorld(l.x);
      const z = toWorld(l.z);
      m.makeTranslation(x, 0.12, z);
      poles.setMatrixAt(i, m);
      // head points towards the road
      const dx = l.side === 0 ? 0 : l.side === 2 ? 0 : l.side === 1 ? -0.5 : 0.5;
      const dz = l.side === 0 ? 0.5 : l.side === 2 ? -0.5 : 0;
      m.makeTranslation(x + dx, 6.05, z + dz);
      heads.setMatrixAt(i, m);
    });
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    root.add(poles, heads);
  }

  // ---- colliders
  const boxes = collisionBoxes(city);
  const grid = buildColliderGrid(boxes);

  return { materials, sun, grid, boxes, root, hemi };
}
