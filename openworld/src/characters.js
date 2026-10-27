/* Low-poly character meshes + the on-foot player controller. */

import * as THREE from "three";
import { resolveCircle } from "./physics.js?v=2ea309c";

const PALETTES = [
  { jacket: 0x2b3a4a, pants: 0x23262b, skin: 0xc9a184, shirt: 0x8f9aa6 },
  { jacket: 0x5b2a2a, pants: 0x2b2f36, skin: 0x8d5a3b, shirt: 0xd0c3b0 },
  { jacket: 0x244a3a, pants: 0x1f2226, skin: 0xe0b79a, shirt: 0x394251 },
  { jacket: 0x3d3350, pants: 0x2a2c33, skin: 0xa9774f, shirt: 0xc7ccd4 },
  { jacket: 0x6b5a2e, pants: 0x25282d, skin: 0xd8ac8c, shirt: 0x59606b },
  { jacket: 0x1f3d55, pants: 0x30343a, skin: 0xb98a62, shirt: 0xe2e6ea },
];

export function randomPalette(rng = Math.random) {
  return PALETTES[Math.floor(rng() * PALETTES.length)];
}

/** A stylised humanoid ~1.8 m tall, feet at y = 0. */
export function createCharacterMesh(palette = PALETTES[0], { accent = 0x4ff0ff, gear = false } = {}) {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.72 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: palette.jacket, roughness: 0.85 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: palette.pants, roughness: 0.9 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: palette.shirt, roughness: 0.8 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });

  // torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), jacketMat);
  torso.position.y = 1.18;
  torso.castShadow = true;
  group.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.06), shirtMat);
  chest.position.set(0, 1.22, 0.16);
  group.add(chest);

  // head + hair
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 12), skinMat);
  head.position.y = 1.7;
  head.castShadow = true;
  group.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.163, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new THREE.MeshStandardMaterial({ color: 0x1a1613, roughness: 0.95 })
  );
  hair.position.y = 1.73;
  group.add(hair);

  // limbs
  const limbGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const armL = new THREE.Mesh(limbGeo(0.13, 0.56, 0.16), jacketMat);
  armL.geometry.translate(0, -0.28, 0);
  armL.position.set(-0.33, 1.44, 0);
  armL.castShadow = true;
  const armR = armL.clone();
  armR.position.x = 0.33;
  group.add(armL, armR);

  const legL = new THREE.Mesh(limbGeo(0.17, 0.8, 0.19), pantsMat);
  legL.geometry.translate(0, -0.4, 0);
  legL.position.set(-0.13, 0.87, 0);
  legL.castShadow = true;
  const legR = legL.clone();
  legR.position.x = 0.13;
  group.add(legL, legR);

  const shoeL = new THREE.Mesh(limbGeo(0.18, 0.12, 0.28), shoeMat);
  shoeL.position.set(-0.13, 0.07, 0.04);
  const shoeR = shoeL.clone();
  shoeR.position.x = 0.13;
  group.add(shoeL, shoeR);

  if (gear) {
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.42, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.8 })
    );
    pack.position.set(0, 1.24, -0.22);
    group.add(pack);
  }

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: accent })
  );
  glow.position.set(0, 1.28, 0.2);
  group.add(glow);

  return { group, parts: { torso, head, armL, armR, legL, legR, shoeL, shoeR } };
}

/** Feet-on-ground controller with camera-relative movement. */
export class Player {
  constructor(scene) {
    const { group, parts } = createCharacterMesh(
      { jacket: 0x263442, pants: 0x1f2227, skin: 0xc9a184, shirt: 0x8b95a1 },
      { gear: true }
    );
    this.mesh = group;
    this.parts = parts;
    scene.add(group);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.radius = 0.42;
    this.height = 1.8;
    this.health = 100;
    this.maxHealth = 100;
    this.vy = 0;
    this.grounded = true;
    this.phase = 0;
    this.walkSpeed = 4.3;
    this.runSpeed = 8.2;
    this.alive = true;
    this.moveAmount = 0;
  }

  setPosition(x, z) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
  }

  update(dt, input, grid, bounds) {
    const speedTarget = input.run ? this.runSpeed : this.walkSpeed;
    const wish = new THREE.Vector3(input.right, 0, input.forward);
    if (wish.lengthSq() > 1) wish.normalize();

    // rotate the wish direction into world space using the camera yaw
    const sin = Math.sin(input.camYaw);
    const cos = Math.cos(input.camYaw);
    const wx = wish.x * cos - wish.z * sin;
    const wz = wish.x * sin + wish.z * cos;

    const target = new THREE.Vector3(wx * speedTarget, 0, wz * speedTarget);
    const resp = this.grounded ? 14 : 4;
    this.vel.x += (target.x - this.vel.x) * Math.min(1, resp * dt);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, resp * dt);

    if (input.jump && this.grounded) {
      this.vy = 6.4;
      this.grounded = false;
    }
    this.vy -= 22 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vy = 0;
      this.grounded = true;
    }

    const before = { x: this.pos.x, z: this.pos.z };
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    resolveCircle(grid, this.pos, this.radius);

    // stop against walls instead of sliding forever
    const movedX = this.pos.x - before.x;
    const movedZ = this.pos.z - before.z;
    if (Math.abs(movedX) < Math.abs(this.vel.x * dt) * 0.5) this.vel.x *= 0.3;
    if (Math.abs(movedZ) < Math.abs(this.vel.z * dt) * 0.5) this.vel.z *= 0.3;

    this.pos.x = THREE.MathUtils.clamp(this.pos.x, bounds.min + 2, bounds.max - 2);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, bounds.min + 2, bounds.max - 2);

    // face the direction of travel (or the aim direction when shooting)
    const planar = Math.hypot(this.vel.x, this.vel.z);
    this.moveAmount = Math.min(1, planar / this.walkSpeed);
    if (input.aiming) {
      this.yaw = Math.atan2(wx, wz);
    } else if (planar > 0.4) {
      const targetYaw = Math.atan2(this.vel.x, this.vel.z);
      this.yaw += angleDelta(this.yaw, targetYaw) * Math.min(1, 12 * dt);
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;

    // walk cycle
    this.phase += planar * dt * 1.9;
    const swing = Math.sin(this.phase) * 0.62 * this.moveAmount;
    this.parts.legL.rotation.x = swing;
    this.parts.legR.rotation.x = -swing;
    this.parts.armL.rotation.x = -swing * 0.8;
    this.parts.armR.rotation.x = input.aiming ? -1.2 : swing * 0.8;
    this.parts.torso.position.y = 1.18 + Math.abs(Math.cos(this.phase)) * 0.03 * this.moveAmount;
  }

  damage(amount) {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.alive = false;
    return true;
  }
}

export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
