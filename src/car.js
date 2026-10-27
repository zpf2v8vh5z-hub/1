import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TEX } from './textures.js';

/**
 * Player car — based on the Ferrari 599 GTO asset that ships with three.js
 * (examples/models/gltf/ferrari.glb). Repainted teal, tail lights switched on.
 */
export async function loadPlayerCar(onProgress) {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  const gltf = await loader.loadAsync('/models/ferrari.glb', (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });

  const model = gltf.scene;
  const root = new THREE.Group();
  root.add(model);

  // model faces -Z -> turn it to face +Z (down the boulevard)
  model.rotation.y = Math.PI;

  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0b8f84'),
    metalness: 0.3,
    roughness: 0.26,
    clearcoat: 1.0,
    clearcoatRoughness: 0.07,
    envMapIntensity: 0.12,
    emissive: new THREE.Color('#0a4a44'),
    emissiveIntensity: 1.0,
  });

  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff0a1e).multiplyScalar(1.9) });
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff3d8).multiplyScalar(2.0) });

  const wheels = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    const name = (o.material && o.material.name) || '';
    if (name === 'Body_Color') {
      o.material = paint;
    } else if (name === 'Taillight_Glass' || name === 'Turn_Signal_LED') {
      o.material = tailMat;
    } else if (name === 'Projector_Glass') {
      o.material = headMat;
    } else if (o.material) {
      o.material.envMapIntensity = 0.8;
      if (name === 'Glass_Gray') {
        o.material.color = new THREE.Color(0x0a121c);
        o.material.metalness = 0.9;
        o.material.roughness = 0.08;
        o.material.opacity = 0.85;
        o.material.transparent = true;
      }
      if (name === 'Tires') o.material.color = new THREE.Color(0x08080a);
      if (name === 'metal_chrome') { o.material.metalness = 1.0; o.material.roughness = 0.16; }
    }
    if (/^wheel_/.test(o.parent?.name || '')) wheels.push(o.parent);
  });

  // ---- rear light bar + glow (Vice style, like the reference shot) ----
  const box = new THREE.Box3().setFromObject(model);
  const rearZ = box.min.z;
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const yMid = (box.min.y + box.max.y) / 2;

  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.68, 0.045, 0.03),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1b2c).multiplyScalar(2.4) })
  );
  bar.position.set(0, yMid + height * 0.06, rearZ + 0.01);
  root.add(bar);

  const glowMat = new THREE.SpriteMaterial({
    map: TEX.glow,
    color: new THREE.Color(0xff2338).multiplyScalar(0.9),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
  });
  for (const sx of [-1, 1]) {
    const s = new THREE.Sprite(glowMat);
    s.position.set(sx * width * 0.33, yMid + height * 0.075, rearZ - 0.04);
    s.scale.set(1.0, 0.34, 1);
    root.add(s);
  }
  // soft red wash on the tarmac behind the car
  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 4.2),
    new THREE.MeshBasicMaterial({
      map: TEX.glow, color: new THREE.Color(0xff2a3a), transparent: true,
      opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  wash.rotation.x = -Math.PI / 2;
  wash.position.set(0, 0.03, rearZ - 1.4);
  root.add(wash);

  // headlight cones on the road ahead
  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 16),
    new THREE.MeshBasicMaterial({
      map: TEX.glow, color: new THREE.Color(0xfff0d0), transparent: true,
      opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 0.028, box.max.z + 7);
  root.add(beam);

  return {
    root,
    model,
    wheels,
    dims: { width, height, length: box.max.z - box.min.z },
    spinWheels(dist) {
      for (const w of wheels) w.rotation.x -= dist / 0.36;
    },
  };
}
