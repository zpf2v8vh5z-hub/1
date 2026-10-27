import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEX } from './textures.js';
import { WetRoad } from './wetroad.js';

/* ------------------------------------------------------------------ *
 * Layout constants (metres). +Z is "up the boulevard" towards the sun,
 * +X is the ocean side, -X is the hotel side.
 * ------------------------------------------------------------------ */
export const LAYOUT = {
  roadHalf: 9.1,
  buildingX: 16.5,     // art-deco hotel row (left of frame)
  promenadeX: -15.1,   // ocean promenade (right of frame)
  promenadeY: 0.17,
  railX: -15.1,
  seaY: -1.15,
  sandY: -0.62,
  zStart: -120,
  zEnd: 1250,
};

/* deterministic RNG so the city is identical on every load */
export function makeRng(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const NEON = [0xff2f92, 0x00e5ff, 0xff54c8, 0x7a5cff, 0x2fffd0, 0xffa63d];
const CAR_COLORS = [0x0a0b10, 0x121722, 0x1d222c, 0x2b2f38, 0x3b1420, 0x14202a];

/* ------------------------------------------------------------------ */
export function buildWorld(scene, rng = makeRng(), opts = {}) {
  const world = new THREE.Group();
  scene.add(world);

  const animated = [];
  const mats = {};

  /* ------------- shared materials ------------- */
  mats.asphalt = new THREE.MeshStandardMaterial({
    map: TEX.asphalt,
    normalMap: TEX.asphaltNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.26,
    metalness: 0.10,
    envMapIntensity: 1.5,
    color: 0x6f6670,
  });
  mats.sidewalk = new THREE.MeshStandardMaterial({
    map: TEX.sidewalk,
    normalMap: TEX.sidewalkNormal,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.62,
    metalness: 0.02,
    envMapIntensity: 0.65,
    color: 0xb0a2a8,
  });
  mats.concrete = new THREE.MeshStandardMaterial({ color: 0xc9bfc4, roughness: 0.8, metalness: 0.0 });
  mats.darkConcrete = new THREE.MeshStandardMaterial({ color: 0x2a2228, roughness: 0.85 });
  mats.paint = new THREE.MeshStandardMaterial({ color: 0xd9d2d0, roughness: 0.42, metalness: 0.0 });
  mats.metal = new THREE.MeshStandardMaterial({ color: 0x2b2b31, roughness: 0.45, metalness: 0.85 });
  mats.bark = new THREE.MeshStandardMaterial({
    map: TEX.palmBark, color: 0xcbb6a4, roughness: 0.9, metalness: 0.0,
    emissive: new THREE.Color(0x2a1a1c), emissiveIntensity: 0.85,
  });
  mats.frond = new THREE.MeshStandardMaterial({
    map: TEX.palmFrond, alphaTest: 0.3, side: THREE.DoubleSide,
    roughness: 0.74, metalness: 0.0, color: 0x7d9558,
    emissive: new THREE.Color(0x36421a), emissiveIntensity: 1.05,
  });
  mats.roof = new THREE.MeshStandardMaterial({
    color: 0x8a6e7c, roughness: 0.9,
    emissive: new THREE.Color(0x241119), emissiveIntensity: 1.0,
  });
  mats.sand = new THREE.MeshStandardMaterial({
    map: TEX.sand, color: 0xe0b9a4, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.4,
  });
  mats.sandStone = new THREE.MeshStandardMaterial({ color: 0x6b5b5c, roughness: 0.85 });
  mats.glass = new THREE.MeshStandardMaterial({
    color: 0x101a26, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6,
  });

  /* =================================================================
   * GROUND: roadway, sidewalks, kerbs
   * ================================================================= */
  const zLen = LAYOUT.zEnd - LAYOUT.zStart;
  const zMid = (LAYOUT.zEnd + LAYOUT.zStart) / 2;

  const reflectSize = opts.reflectResolution ?? 1024;
  const road = new WetRoad(LAYOUT.roadHalf * 2, zLen, {
    repeat: [4, 150],
    textureWidth: reflectSize,
    textureHeight: reflectSize,
  });
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, zMid);
  world.add(road);

  // wide dark under-plane so nothing shows through at grazing angles
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(400, zLen + 400),
    new THREE.MeshStandardMaterial({ color: 0x241a22, roughness: 0.9 })
  );
  under.rotation.x = -Math.PI / 2;
  under.position.set(0, -2.4, zMid);
  world.add(under);
  road.hide([under]);

  function sidewalk(x0, x1, y = LAYOUT.promenadeY) {
    const w = Math.abs(x1 - x0);
    const g = new THREE.Mesh(new THREE.BoxGeometry(w, y, zLen), mats.sidewalk);
    g.position.set((x0 + x1) / 2, y / 2, zMid);
    g.receiveShadow = true;
    g.castShadow = false;
    world.add(g);
    return g;
  }
  sidewalk(LAYOUT.roadHalf + 0.35, LAYOUT.buildingX);            // hotel side
  sidewalk(-LAYOUT.roadHalf - 0.35, LAYOUT.promenadeX - 0.6);    // ocean side

  // kerbs
  for (const sx of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, zLen), mats.concrete);
    k.position.set(sx * (LAYOUT.roadHalf + 0.18), 0.1, zMid);
    k.receiveShadow = true;
    world.add(k);
  }

  /* road markings -------------------------------------------------- */
  {
    const dashGeo = [];
    const dashLen = 3.4, gap = 5.2;
    for (const x of [-4.55, 4.55]) {
      for (let z = LAYOUT.zStart; z < LAYOUT.zEnd; z += dashLen + gap) {
        const p = new THREE.PlaneGeometry(0.16, dashLen);
        p.rotateX(-Math.PI / 2);
        p.translate(x, 0.012, z);
        dashGeo.push(p);
      }
    }
    // solid edge lines
    for (const x of [-8.35, 8.35]) {
      const p = new THREE.PlaneGeometry(0.14, zLen);
      p.rotateX(-Math.PI / 2);
      p.translate(x, 0.012, zMid);
      dashGeo.push(p);
    }
    const lines = new THREE.Mesh(mergeGeometries(dashGeo), new THREE.MeshStandardMaterial({
      color: 0xece4e0, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.8,
    }));
    lines.receiveShadow = true;
    world.add(lines);
  }

  // manhole covers + tar patches for road detail
  {
    const geos = [];
    for (let i = 0; i < 30; i++) {
      const g = new THREE.CircleGeometry(0.32 + rng() * 0.1, 14);
      g.rotateX(-Math.PI / 2);
      g.translate((rng() - 0.5) * 16, 0.008, LAYOUT.zStart + rng() * zLen);
      geos.push(g);
    }
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({
      color: 0x1b171c, roughness: 0.5, metalness: 0.6,
    }));
    world.add(m);
  }

  /* land mass behind the hotels (keeps the ocean out of the city) */
  {
    const land = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 2200),
      new THREE.MeshStandardMaterial({ color: 0x2b2028, roughness: 0.95, metalness: 0.0 })
    );
    land.rotation.x = -Math.PI / 2;
    land.position.set(LAYOUT.buildingX + 600, -0.02, zMid);
    land.receiveShadow = true;
    world.add(land);
  }

  /* =================================================================
   * ART-DECO HOTEL ROW
   * ================================================================= */
  const facadeMats = {};
  for (const [key, tex, emissiveMap] of [
    ['neon', TEX.facadeNeon, TEX.facadeNeonEmissive],
    ['white', TEX.facadeWhite, TEX.facadeWhiteEmissive],
  ]) {
    facadeMats[key] = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: emissiveMap || tex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.42,
      roughness: 0.78,
      metalness: 0.04,
      vertexColors: true,
      envMapIntensity: 0.7,
    });
  }

  // physical size the facade texture represents
  const FACE_W = 14.6, FACE_H = 8.0;

  function wallGeometry(w, h, uvOffsetX, uvOffsetY) {
    const g = new THREE.PlaneGeometry(w, h, 1, 1);
    const uv = g.attributes.uv;
    const rx = w / FACE_W, ry = h / FACE_H;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * rx + uvOffsetX, uv.getY(i) * ry + uvOffsetY);
    }
    return g;
  }

  const buildingParts = { neon: [], white: [], roof: [], neonTubes: [] };
  const roofDetail = [];
  const inlandParts = [];
  const buildingBoxes = [];   // for collisions / minimap

  let z = LAYOUT.zStart - 30;
  let idx = 0;
  while (z < LAYOUT.zEnd) {
    const w = 16 + rng() * 16;      // along z
    const depth = 18 + rng() * 16;  // along x
    const tall = rng() < 0.16;
    const h = tall ? 30 + rng() * 26 : 9 + Math.pow(rng(), 1.35) * 15;
    const style = rng() < 0.55 ? 'neon' : 'white';
    const xFront = LAYOUT.buildingX;
    const zc = z + w / 2;
    const xc = xFront + depth / 2;
    const uOff = Math.floor(rng() * 7) / 7;
    const vOff = Math.floor(rng() * 4) / 4;

    // facade facing the street (+X)
    const front = wallGeometry(w, h, uOff, vOff);
    front.rotateY(-Math.PI / 2);
    front.translate(xFront, h / 2, zc);
    // side facades
    const sideA = wallGeometry(depth, h, uOff + 0.31, vOff);
    sideA.rotateY(Math.PI);
    sideA.translate(xc, h / 2, zc - w / 2);
    const sideB = wallGeometry(depth, h, uOff + 0.63, vOff);
    sideB.translate(xc, h / 2, zc + w / 2);

    const tintH = [0.93, 0.95, 0.12, 0.47, 0.02][Math.floor(rng() * 5)];
    const tint = new THREE.Color().setHSL(
      tintH + (rng() - 0.5) * 0.04,
      0.10 + rng() * 0.30,
      0.45 + rng() * 0.22
    );
    for (const g of [front, sideA, sideB]) {
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      buildingParts[style].push(g);
    }

    // roof
    const roof = new THREE.PlaneGeometry(w + 0.4, depth + 0.4);
    roof.rotateX(-Math.PI / 2);
    roof.translate(xc, h, zc);
    buildingParts.roof.push(roof);

    // rooftop parapet
    const par = new THREE.BoxGeometry(depth + 0.5, 0.85, w + 0.5);
    par.translate(xc, h + 0.42, zc);
    buildingParts.roof.push(par);

    // rooftop clutter: AC units, stair housings, water tanks
    const units = 2 + Math.floor(rng() * 4);
    for (let u = 0; u < units; u++) {
      const uw = 1.6 + rng() * 3.4, uh = 0.7 + rng() * 1.8, ud = 1.6 + rng() * 3.4;
      const box = new THREE.BoxGeometry(uw, uh, ud);
      box.translate(
        xc + (rng() - 0.5) * (depth - uw - 2),
        h + uh / 2 + 0.1,
        zc + (rng() - 0.5) * (w - ud - 2)
      );
      roofDetail.push(box);
    }

    // a coarser city block behind the deco row
    if (rng() < 0.75) {
      const bw = 10 + rng() * 20, bd = 12 + rng() * 22;
      const bh = 8 + Math.pow(rng(), 1.4) * 34;
      const g = new THREE.BoxGeometry(bd, bh, bw);
      g.translate(LAYOUT.buildingX + depth + 14 + rng() * 26, bh / 2, zc + (rng() - 0.5) * 6);
      inlandParts.push(g);
    }

    // neon: thin vertical tubes at the corners, roof line outline, sign glow
    const c1 = NEON[(idx * 3) % NEON.length];
    const c2 = NEON[(idx * 3 + 2) % NEON.length];
    const tubeMat = (c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3.1) });
    for (const zEdge of [zc - w / 2 + 0.22, zc + w / 2 - 0.22]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.13, h * 0.86, 0.13), tubeMat(c1));
      t.position.set(xFront - 0.1, h * 0.43 + 0.4, zEdge);
      world.add(t);
    }
    {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, w * 0.94), tubeMat(c2));
      bar.position.set(xFront - 0.12, h - 0.55, zc);
      world.add(bar);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, Math.min(7, w * 0.4)), tubeMat(c2));
      sign.position.set(xFront - 0.12, 3.35, zc);
      world.add(sign);
    }

    // ground-floor awning
    {
      const aw = new THREE.Mesh(
        new THREE.BoxGeometry(1.9, 0.1, w * 0.72),
        new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rng(), 0.3, 0.34), roughness: 0.9 })
      );
      aw.position.set(xFront - 0.95, 3.72, zc);
      aw.castShadow = true;
      world.add(aw);
    }

    buildingBoxes.push({ x: xc, z: zc, w: depth, d: w, h });
    z += w + (rng() < 0.22 ? 3.5 + rng() * 4 : 0.2);
    idx++;
  }

  for (const key of ['neon', 'white']) {
    const geo = mergeGeometries(buildingParts[key]);
    const m = new THREE.Mesh(geo, facadeMats[key]);
    m.castShadow = true;
    m.receiveShadow = true;
    world.add(m);
  }
  {
    const roofs = new THREE.Mesh(mergeGeometries(buildingParts.roof), mats.roof);
    roofs.castShadow = true;
    roofs.receiveShadow = true;
    world.add(roofs);
  }
  if (roofDetail.length) {
    const rd = new THREE.Mesh(mergeGeometries(roofDetail), new THREE.MeshStandardMaterial({
      color: 0x8d7a80, roughness: 0.85, metalness: 0.15,
    }));
    rd.castShadow = true;
    rd.receiveShadow = true;
    world.add(rd);
  }
  if (inlandParts.length) {
    const inland = new THREE.Mesh(mergeGeometries(inlandParts), new THREE.MeshStandardMaterial({
      color: 0x4a3a46, roughness: 0.9, metalness: 0.05,
      emissive: new THREE.Color(0x1a0c18), emissiveIntensity: 0.6,
    }));
    inland.castShadow = true;
    inland.receiveShadow = true;
    world.add(inland);
  }

  /* =================================================================
   * PROMENADE: railing / sea wall
   * ================================================================= */
  {
    const railParts = [];
    const zFrom = LAYOUT.zStart, zTo = LAYOUT.zEnd;
    // wall
    const wall = new THREE.BoxGeometry(0.55, 0.95, zTo - zFrom);
    wall.translate(LAYOUT.railX, 0.17 + 0.47, (zFrom + zTo) / 2);
    railParts.push(wall);
    // pillars
    for (let pz = zFrom; pz < zTo; pz += 9) {
      const p = new THREE.BoxGeometry(0.8, 1.25, 0.8);
      p.translate(LAYOUT.railX, 0.17 + 0.62, pz);
      railParts.push(p);
    }
    const rail = new THREE.Mesh(mergeGeometries(railParts), mats.concrete);
    rail.castShadow = true;
    rail.receiveShadow = true;
    world.add(rail);

    // slim white balustrade between the pillars
    const pickets = [];
    for (let pz = zFrom; pz < zTo; pz += 0.55) {
      const pk = new THREE.BoxGeometry(0.07, 0.85, 0.07);
      pk.translate(LAYOUT.railX, 0.17 + 1.05 + 0.42, pz);
      pickets.push(pk);
    }
    const topRail = new THREE.BoxGeometry(0.16, 0.1, zTo - zFrom);
    topRail.translate(LAYOUT.railX, 0.17 + 1.5, (zFrom + zTo) / 2);
    pickets.push(topRail);
    const balustrade = new THREE.Mesh(mergeGeometries(pickets), new THREE.MeshStandardMaterial({
      color: 0x1d1418, roughness: 0.55, metalness: 0.3,
    }));
    // the pickets would stripe the beach with long sunset shadows -> no casting
    world.add(balustrade);
  }

  /* sea wall + sandy beach strip down to the water */
  {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, zLen), mats.sandStone);
    sw.position.set(LAYOUT.railX - 0.8, -0.75, zMid);
    sw.receiveShadow = true;
    world.add(sw);

    const beachW = 22;
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(beachW, zLen, 1, 1), mats.sand);
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(LAYOUT.railX - 1.6 - beachW / 2, LAYOUT.sandY, zMid);
    // no shadow receiving: palm crowns would comb the sand with long stripes
    beach.receiveShadow = false;
    world.add(beach);

    // wet sand at the waterline, slightly darker + glossier
    const wet = new THREE.Mesh(new THREE.PlaneGeometry(6, zLen), new THREE.MeshStandardMaterial({
      color: 0xa9806f, roughness: 0.3, metalness: 0.25, envMapIntensity: 1.2,
    }));
    wet.rotation.x = -Math.PI / 2;
    wet.position.set(LAYOUT.railX - 1.6 - beachW + 2.4, LAYOUT.sandY + 0.01, zMid);
    world.add(wet);
  }

  /* =================================================================
   * OCEAN
   * ================================================================= */
  const oceanUniforms = {
    uTime: { value: 0 },
    uMap: { value: TEX.ocean },
    uSunDir: { value: new THREE.Vector3(-0.46, 0.075, 1).normalize() },
    uDeep: { value: new THREE.Color(0x1c0a22) },
    uShallow: { value: new THREE.Color(0x46203f) },
    uSun: { value: new THREE.Color(0xffb26a) },
  };
  const oceanMat = new THREE.ShaderMaterial({
    uniforms: oceanUniforms,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      varying vec3 vWorld;
      uniform float uTime;
      uniform sampler2D uMap;
      uniform vec3 uSunDir, uDeep, uShallow, uSun;

      void main() {
        vec2 uv1 = vUv * 22.0 + vec2(uTime * 0.005, uTime * 0.018);
        vec2 uv2 = vUv * 41.0 - vec2(uTime * 0.011, uTime * 0.007);
        vec2 uv3 = vUv * 78.0 + vec2(uTime * 0.016, uTime * 0.004);
        float w1 = texture2D(uMap, uv1).g;
        float w2 = texture2D(uMap, uv2).b;
        float w3 = texture2D(uMap, uv3).r;
        float ripple = w1 * 0.5 + w2 * 0.3 + w3 * 0.2;

        vec3 viewDir = normalize(cameraPosition - vWorld);

        // fake wave normal from the ripple layers
        vec3 n = normalize(vec3(
          (w1 - 0.5) * 0.34 + (w3 - 0.5) * 0.16,
          1.0,
          (w2 - 0.5) * 0.34 + (w3 - 0.5) * 0.16
        ));

        vec3 sunDir3 = normalize(vec3(uSunDir.x, 0.055, uSunDir.z));
        vec3 halfV = normalize(viewDir + sunDir3);
        float spec = pow(max(dot(n, halfV), 0.0), 220.0);
        float sheen = pow(max(dot(n, halfV), 0.0), 14.0);

        float fres = pow(1.0 - clamp(dot(viewDir, n), 0.0, 1.0), 3.0);

        vec3 col = mix(uDeep, uShallow, ripple * 0.85);
        // sky reflection: magenta at grazing angles
        col = mix(col, vec3(0.62, 0.16, 0.32), fres * 0.55);
        // warm sun glitter spreading away from the sun azimuth
        col += uSun * spec * 3.4;
        col += uSun * sheen * 0.13;
        // long orange path of light towards the sun (narrow!)
        vec3 sunAz = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
        vec3 toFrag = normalize(vec3(vWorld.x - cameraPosition.x, 0.0, vWorld.z - cameraPosition.z));
        float align = max(dot(toFrag, sunAz), 0.0);
        float path = pow(align, 26.0);
        col += uSun * path * (0.18 + ripple * 0.55) * 0.8;

        // atmospheric haze on the far water
        float dist = length(vWorld.xz - cameraPosition.xz);
        col = mix(col, vec3(0.90, 0.40, 0.30), smoothstep(1500.0, 12000.0, dist) * 0.92);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000, 1, 1), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(LAYOUT.railX - 14000, LAYOUT.seaY, zMid);
  ocean.renderOrder = -5;
  world.add(ocean);
  animated.push((dt) => { oceanUniforms.uTime.value += dt; });

  /* =================================================================
   * PALMS
   * ================================================================= */
  const palmVariants = [];
  for (let v = 0; v < 3; v++) {
    palmVariants.push(makePalmGeometry(rng, 0.85 + v * 0.14));
  }

  const palmPositions = [];
  // ocean-side row (the hero row of the screenshot): irregular spacing, tall crowns
  for (let pz = LAYOUT.zStart + 4; pz < LAYOUT.zEnd; pz += 7 + rng() * 8) {
    palmPositions.push({
      x: -11.2 + (rng() - 0.5) * 1.3,
      z: pz,
      s: 1.0 + rng() * 0.42,
      lean: 1,
    });
  }
  // a few shorter ones hugging the sea wall, further apart
  for (let pz = LAYOUT.zStart + 14; pz < LAYOUT.zEnd; pz += 16 + rng() * 14) {
    palmPositions.push({ x: -14.4 + (rng() - 0.5) * 0.5, z: pz, s: 0.64 + rng() * 0.2, lean: 1 });
  }
  // hotel-side row
  for (let pz = LAYOUT.zStart + 16; pz < LAYOUT.zEnd; pz += 15 + rng() * 9) {
    palmPositions.push({ x: 13.4 + (rng() - 0.5) * 0.6, z: pz + (rng() - 0.5) * 3, s: 0.8 + rng() * 0.28, lean: -1 });
  }

  for (let v = 0; v < 3; v++) {
    const list = palmPositions.filter((_, i) => i % 3 === v);
    if (!list.length) continue;
    const { trunk, fronds, height } = palmVariants[v];

    const trunkMesh = new THREE.InstancedMesh(trunk, mats.bark, list.length);
    const frondMesh = new THREE.InstancedMesh(fronds, mats.frond, list.length);
    trunkMesh.castShadow = frondMesh.castShadow = true;
    trunkMesh.receiveShadow = frondMesh.receiveShadow = true;

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    list.forEach((p, i) => {
      e.set(0, rng() * Math.PI * 2, p.lean * (0.02 + rng() * 0.05));
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(p.x, 0.17, p.z), q, new THREE.Vector3(p.s, p.s * (0.94 + rng() * 0.16), p.s));
      trunkMesh.setMatrixAt(i, m4);
      frondMesh.setMatrixAt(i, m4);
      // frond geometry already sits at the top of the trunk
      const top = new THREE.Matrix4().makeTranslation(0, height, 0);
      const m2 = new THREE.Matrix4().multiplyMatrices(m4, top);
      frondMesh.setMatrixAt(i, m2);
    });
    trunkMesh.instanceMatrix.needsUpdate = true;
    frondMesh.instanceMatrix.needsUpdate = true;
    world.add(trunkMesh, frondMesh);
  }

  /* =================================================================
   * STREET FURNITURE: lamps, benches, planters, hydrants
   * ================================================================= */
  const lampPositions = [];
  for (let pz = LAYOUT.zStart + 12; pz < LAYOUT.zEnd; pz += 26) {
    lampPositions.push({ x: -13.9, z: pz });
  }

  {
    const poleParts = [];
    const H = 6.2;
    const shaft = new THREE.CylinderGeometry(0.09, 0.15, H, 8);
    shaft.translate(0, H / 2, 0);
    poleParts.push(shaft);
    const base = new THREE.CylinderGeometry(0.22, 0.3, 0.7, 8);
    base.translate(0, 0.35, 0);
    poleParts.push(base);
    const arm = new THREE.TorusGeometry(0.75, 0.07, 6, 12, Math.PI / 2);
    arm.rotateY(Math.PI / 2);
    arm.rotateZ(Math.PI / 2);
    arm.translate(0, H, -0.75);
    poleParts.push(arm);

    const poleGeo = mergeGeometries(poleParts);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x241f26, roughness: 0.55, metalness: 0.7 });
    const lampInst = new THREE.InstancedMesh(poleGeo, poleMat, lampPositions.length * 2);
    lampInst.castShadow = true;

    const bulbGeo = new THREE.SphereGeometry(0.19, 12, 10);
    const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd39a).multiplyScalar(4.5) });
    const bulbInst = new THREE.InstancedMesh(bulbGeo, bulbMat, lampPositions.length * 2);

    const lanternGeo = new THREE.ConeGeometry(0.34, 0.36, 10, 1, true);
    const lanternMat = new THREE.MeshStandardMaterial({ color: 0x1b1720, roughness: 0.6, metalness: 0.7, side: THREE.DoubleSide });
    const lanternInst = new THREE.InstancedMesh(lanternGeo, lanternMat, lampPositions.length * 2);

    const m4 = new THREE.Matrix4();
    let i = 0;
    const glowGroup = new THREE.Group();
    const glowMat = new THREE.SpriteMaterial({
      map: TEX.glow, color: new THREE.Color(0xffc078).multiplyScalar(1.6),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85,
    });
    for (const p of lampPositions) {
      for (const side of [1, -1]) {
        m4.makeRotationY(side > 0 ? 0 : Math.PI);
        m4.setPosition(p.x, 0.17, p.z);
        lampInst.setMatrixAt(i, m4);

        const bx = p.x, bz = p.z + side * 0.75;
        m4.identity().setPosition(bx, 0.17 + H - 0.05, bz);
        bulbInst.setMatrixAt(i, m4);
        m4.identity().setPosition(bx, 0.17 + H + 0.17, bz);
        lanternInst.setMatrixAt(i, m4);

        const sp = new THREE.Sprite(glowMat);
        sp.position.set(bx, 0.17 + H - 0.05, bz);
        sp.scale.setScalar(2.2);
        glowGroup.add(sp);
        i++;
      }
    }
    lampInst.instanceMatrix.needsUpdate = true;
    bulbInst.instanceMatrix.needsUpdate = true;
    lanternInst.instanceMatrix.needsUpdate = true;
    world.add(lampInst, bulbInst, lanternInst, glowGroup);
  }

  // benches + planters + hydrants
  {
    const benchParts = [];
    for (let pz = LAYOUT.zStart + 24; pz < LAYOUT.zEnd; pz += 34) {
      const seat = new THREE.BoxGeometry(1.9, 0.12, 0.52);
      seat.translate(-12.4, 0.62, pz);
      benchParts.push(seat);
      const back = new THREE.BoxGeometry(1.9, 0.5, 0.1);
      back.translate(-12.4, 0.9, pz - 0.24);
      benchParts.push(back);
      for (const dx of [-0.75, 0.75]) {
        const leg = new THREE.BoxGeometry(0.12, 0.45, 0.5);
        leg.translate(-12.4 + dx, 0.39, pz);
        benchParts.push(leg);
      }
    }
    // trash bins along the promenade
    for (let pz = LAYOUT.zStart + 20; pz < LAYOUT.zEnd; pz += 41) {
      const bin = new THREE.CylinderGeometry(0.28, 0.24, 0.95, 10);
      bin.translate(-12.9, 0.65, pz);
      benchParts.push(bin);
    }
    // planters near hotels
    for (let pz = LAYOUT.zStart + 30; pz < LAYOUT.zEnd; pz += 27) {
      const pot = new THREE.CylinderGeometry(0.55, 0.42, 0.75, 10);
      pot.translate(11.7, 0.55, pz);
      benchParts.push(pot);
    }
    const bench = new THREE.Mesh(mergeGeometries(benchParts), new THREE.MeshStandardMaterial({
      color: 0x3b2a33, roughness: 0.75, metalness: 0.1,
    }));
    bench.castShadow = true;
    bench.receiveShadow = true;
    world.add(bench);
  }

  /* =================================================================
   * WET-ROAD REFLECTION CHEATS + LIGHT POOLS
   * ================================================================= */
  {
    const refl = new THREE.Group();
    const add = (x, z, w, l, color, opacity, rot = 0) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, l),
        new THREE.MeshBasicMaterial({
          map: TEX.glow, color, transparent: true, opacity,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rot;
      m.position.set(x, 0.02 + rng() * 0.004, z);
      refl.add(m);
    };
    // long neon smears along the left kerb (hotel lights bleeding onto wet asphalt)
    for (let pz = LAYOUT.zStart; pz < 260; pz += 11) {
      const c = new THREE.Color(NEON[(Math.random() * NEON.length) | 0]);
      add(7.4 - Math.random() * 1.6, pz + 6, 2.2 + Math.random() * 1.4, 13 + Math.random() * 10, c, 0.035 + Math.random() * 0.05);
    }
    // warm pools under every street lamp
    for (const p of lampPositions) {
      if (p.z > 340) continue;
      add(-12.9, p.z, 5.0, 8, 0xffb066, 0.07);
      add(-8.4, p.z, 3.6, 11, 0xffa050, 0.04);
    }
    // faint warm sheen far down the boulevard
    add(-1.2, 70, 9, 120, 0xff8f4a, 0.03);
    world.add(refl);
    refl.children.forEach((c) => { c.userData.base = c.material.opacity; });
    animated.push(() => {
      const t = performance.now() * 0.0006;
      refl.children.forEach((c, i) => {
        c.material.opacity = c.userData.base * (0.82 + 0.18 * Math.sin(t + i * 1.7));
      });
    });
  }

  /* =================================================================
   * TRAFFIC
   * ================================================================= */
  const traffic = [];
  {
    const carGeos = makeTrafficCarGeometries();
    const colors = CAR_COLORS;
    const layoutSlots = [
      { x: 6.7, z: 30 }, { x: 2.3, z: 46 }, { x: -2.4, z: 68 },
      { x: 6.7, z: 82 }, { x: -6.9, z: 96 }, { x: 2.3, z: 120 },
      { x: -2.4, z: 146 }, { x: 6.7, z: 176 }, { x: -6.9, z: 214 },
      { x: 2.3, z: 252 },
    ];
    layoutSlots.forEach((slot, i) => {
      const col = new THREE.Color(colors[i % colors.length]);
      const g = new THREE.Group();
      const body = new THREE.Mesh(carGeos.body, new THREE.MeshStandardMaterial({
        color: col, roughness: 0.28, metalness: 0.72, envMapIntensity: 1.1,
      }));
      body.castShadow = true;
      g.add(body);
      const glass = new THREE.Mesh(carGeos.glass, mats.glass);
      g.add(glass);
      const wheels = new THREE.Mesh(carGeos.wheels, new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 }));
      g.add(wheels);
      const tail = new THREE.Mesh(carGeos.tail, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1b34).multiplyScalar(3.4) }));
      g.add(tail);
      const head = new THREE.Mesh(carGeos.head, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0cf).multiplyScalar(3.0) }));
      g.add(head);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.glow, color: new THREE.Color(0xff2233).multiplyScalar(1.4),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8,
      }));
      sp.position.set(0, 0.72, -2.02);
      sp.scale.set(2.4, 0.7, 1);
      g.add(sp);

      g.position.set(slot.x, 0, slot.z);
      world.add(g);
      traffic.push({ obj: g, speed: 5 + Math.random() * 6, lane: slot.x, wheelSpin: Math.random() * 6 });
    });
  }

  /* =================================================================
   * DISTANT SKYLINE + CRUISE SHIP
   * ================================================================= */
  {
    const towerGeos = [];
    const windowsTex = TEX.facadeNeon;
    void windowsTex;
    const srng = makeRng(99);
    for (let i = 0; i < 46; i++) {
      const w = 12 + srng() * 26;
      const d = 12 + srng() * 26;
      const h = 26 + Math.pow(srng(), 1.7) * 135;
      const x = -320 + srng() * 700;
      const z = 640 + srng() * 520;
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, h / 2, z);
      towerGeos.push(g);
    }
    const towers = new THREE.Mesh(mergeGeometries(towerGeos), new THREE.MeshStandardMaterial({
      color: 0x4a3550, roughness: 0.85, metalness: 0.1,
      emissive: new THREE.Color(0x3a1838), emissiveIntensity: 0.8,
    }));
    world.add(towers);

    // hazy skyline silhouette on the far side of the bay (unlit, tinted like the horizon)
    {
      const geos = [];
      const hr = makeRng(7);
      for (let i = 0; i < 26; i++) {
        const h = 30 + Math.pow(hr(), 1.4) * 110;
        const w = 25 + hr() * 45;
        const g = new THREE.BoxGeometry(w, h, w * 0.8);
        g.translate(-1900 - hr() * 900, LAYOUT.seaY + h / 2 - 6, 620 + i * 62 + hr() * 40);
        geos.push(g);
      }
      world.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ color: 0x7a4552 })));
    }

    // cruise ship silhouette on the water
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(150, 16, 26), new THREE.MeshStandardMaterial({ color: 0x3a2b3a, roughness: 0.8 }));
    hull.position.y = 6;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(120, 14, 20), new THREE.MeshStandardMaterial({ color: 0xd9cfd6, roughness: 0.7 }));
    deck.position.y = 20;
    const deck2 = new THREE.Mesh(new THREE.BoxGeometry(56, 12, 14), new THREE.MeshStandardMaterial({ color: 0xe8dee4, roughness: 0.7 }));
    deck2.position.y = 32;
    ship.add(hull, deck, deck2);
    ship.position.set(-1250, LAYOUT.seaY, 520);
    ship.rotation.y = -0.24;
    world.add(ship);

    // sailboat
    const sail = new THREE.Group();
    const keel = new THREE.Mesh(new THREE.BoxGeometry(8, 1.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xe6dfe2 }));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 12, 5), new THREE.MeshStandardMaterial({ color: 0xd8cfd4 }));
    mast.position.y = 6;
    const tri = new THREE.Mesh(new THREE.ConeGeometry(3.4, 9, 3), new THREE.MeshStandardMaterial({ color: 0xf3e9ec, side: THREE.DoubleSide }));
    tri.position.y = 5.5;
    tri.scale.z = 0.2;
    sail.add(keel, mast, tri);
    sail.position.set(-70, LAYOUT.seaY, 150);
    sail.rotation.y = 0.5;
    world.add(sail);
  }

  /* =================================================================
   * update
   * ================================================================= */
  function update(dt, t) {
    for (const fn of animated) fn(dt, t);
    for (const car of traffic) {
      car.obj.position.z += car.speed * dt;
      if (car.obj.position.z > 300) car.obj.position.z = 14 + Math.random() * 10;
    }
  }

  return { group: world, road, update, traffic, buildingBoxes, materials: mats, palmVariants };
}

/* ------------------------------------------------------------------ *
 * Palm geometry: bent tapered trunk + merged alpha-tested fronds.
 * Frond art is levelled in tools/prepare-textures.mjs so the stem runs
 * left -> right with the base at the left edge.
 * ------------------------------------------------------------------ */
export function makePalmGeometry(rng, scale = 1) {
  const height = (12 + rng() * 6) * scale;
  const bendX = (rng() - 0.5) * 1.1;

  // ---- trunk ----
  const seg = 16, rad = 9;
  const trunk = new THREE.CylinderGeometry(0.13, 0.33, height, rad, seg, false);
  {
    const pos = trunk.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = (y + height / 2) / height;
      const bx = bendX * t * t;
      pos.setX(i, pos.getX(i) + bx);
      pos.setZ(i, pos.getZ(i) + bendX * t * t * 0.45);
    }
    trunk.computeVertexNormals();
    trunk.translate(0, height / 2, 0);
    const uv = trunk.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * height * 1.1);
  }

  // ---- crown ----
  const TEX_ASPECT = 1024 / 531;          // levelled frond texture
  const crown = new THREE.Vector3(bendX, height - 0.1, bendX * 0.45);
  const frondGeos = [];

  function ring(count, len, elev, droop, azOffset, yOffset) {
    for (let i = 0; i < count; i++) {
      const L = len * (0.85 + rng() * 0.3);
      const W = L / TEX_ASPECT;
      const g = new THREE.PlaneGeometry(L, W, 8, 1);
      g.translate(L * 0.5, 0, 0);            // pivot at the frond base
      const pos = g.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        const t = x / L;
        // arch: lift, then let the tip fall away
        pos.setY(v, pos.getY(v) + Math.sin(t * Math.PI * 0.85) * 0.22 - t * t * droop);
        pos.setZ(v, pos.getZ(v) + Math.sin(t * Math.PI) * 0.05);
      }
      g.computeVertexNormals();

      const az = azOffset + (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.28;
      const e = elev + (rng() - 0.5) * 0.16;
      const roll = (rng() - 0.5) * 0.85;

      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, az, e, 'YZX'));
      const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
      m.setPosition(crown.x, crown.y + yOffset, crown.z);
      g.applyMatrix4(m);
      frondGeos.push(g);
    }
  }

  ring(6, 3.9 * scale, 1.05, 0.35, 0.0, 0.1);      // young upright fronds
  ring(9, 5.3 * scale, 0.42, 0.75, 0.35, 0.0);     // upper arching layer
  ring(9, 5.9 * scale, -0.16, 1.35, 0.85, -0.15);  // mid spread
  ring(8, 5.0 * scale, -0.62, 1.9, 1.35, -0.3);    // drooping skirt

  return { trunk, fronds: mergeGeometries(frondGeos), height };
}

/* ------------------------------------------------------------------ *
 * Simple but decent sedan/SUV silhouettes for traffic
 * ------------------------------------------------------------------ */
export function makeTrafficCarGeometries() {
  const shape = new THREE.Shape();
  const L = 4.55, H = 1.52;
  shape.moveTo(-L / 2, 0.32);
  shape.lineTo(-L / 2 + 0.12, 0.16);
  shape.lineTo(L / 2 - 0.16, 0.16);
  shape.lineTo(L / 2, 0.34);
  shape.lineTo(L / 2 - 0.05, 0.78);
  shape.lineTo(L / 2 - 0.95, 0.92);
  shape.lineTo(L / 2 - 1.45, H);
  shape.lineTo(-L / 2 + 1.75, H + 0.02);
  shape.lineTo(-L / 2 + 1.05, 0.94);
  shape.lineTo(-L / 2 + 0.14, 0.8);
  shape.closePath();

  const body = new THREE.ExtrudeGeometry(shape, {
    depth: 1.74, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1,
    bevelSegments: 2, curveSegments: 1,
  });
  body.translate(0, 0, -1.74 / 2);
  body.rotateY(Math.PI / 2);
  body.computeVertexNormals();

  // greenhouse (dark, tapered) sitting on the body
  const glassShape = new THREE.Shape();
  glassShape.moveTo(-1.05, 0.86);
  glassShape.lineTo(1.02, 0.86);
  glassShape.lineTo(0.62, 1.42);
  glassShape.lineTo(-0.78, 1.46);
  glassShape.closePath();
  const glass = new THREE.ExtrudeGeometry(glassShape, {
    depth: 1.58, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05,
    bevelSegments: 1, curveSegments: 1,
  });
  glass.translate(0, 0, -1.58 / 2);
  glass.rotateY(Math.PI / 2);
  glass.computeVertexNormals();

  const wheelGeos = [];
  for (const zz of [1.35, -1.35]) {
    for (const xx of [-0.86, 0.86]) {
      const w = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
      w.rotateZ(Math.PI / 2);
      w.translate(xx, 0.38, zz);
      wheelGeos.push(w);
    }
  }

  const tail = new THREE.BoxGeometry(1.5, 0.11, 0.06);
  tail.translate(0, 0.72, -L / 2 + 0.06);
  const head = new THREE.BoxGeometry(1.5, 0.1, 0.06);
  head.translate(0, 0.62, L / 2 - 0.07);

  return {
    body,
    glass,
    wheels: mergeGeometries(wheelGeos),
    tail,
    head,
  };
}
