/* Arcade car physics + procedurally built car meshes (no external models). */

import * as THREE from "three";
import { resolveCircle } from "./physics.js?v=1250b65";

export const CAR_COLORS = [
  0xa83232, 0x2f4f7a, 0xd9d4c6, 0x2b2b30, 0x44674a,
  0xc2a02b, 0x6b3f8f, 0x1f6f78, 0x8a5a2b, 0x9aa3ad,
];

const WHEEL_R = 0.35;

export function createCarMesh({ color = 0xa83232, police = false } = {}) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: police ? 0x1c2230 : color,
    roughness: 0.38,
    metalness: 0.55,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.7, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x101a24,
    roughness: 0.12,
    metalness: 0.85,
    emissive: 0x0a1620,
    emissiveIntensity: 0.6,
  });

  // body
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.52, 4.3), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 3.9), trim);
  skirt.position.y = 0.36;
  group.add(skirt);

  // cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.56, 2.1), paint);
  cabin.position.set(0, 1.12, -0.15);
  cabin.castShadow = true;
  group.add(cabin);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.44, 0.08), glass);
  windshield.position.set(0, 1.16, 0.92);
  windshield.rotation.x = -0.32;
  group.add(windshield);

  const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.08), glass);
  rearGlass.position.set(0, 1.14, -1.18);
  rearGlass.rotation.x = 0.3;
  group.add(rearGlass);

  const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.4, 1.7), glass);
  sideGlass.position.set(0, 1.16, -0.15);
  group.add(sideGlass);

  // hood / trunk hints
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.2), paint);
  hood.position.set(0, 0.9, 1.45);
  group.add(hood);

  // wheels with steering pivots
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.28, 8);
  rimGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x888f96, roughness: 0.35, metalness: 0.9 });

  const wheels = [];
  const frontPivots = [];
  const offsets = [
    [-0.92, 1.38, true],
    [0.92, 1.38, true],
    [-0.92, -1.38, false],
    [0.92, -1.38, false],
  ];
  for (const [x, z, isFront] of offsets) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    wheel.add(rim);
    pivot.add(wheel);
    group.add(pivot);
    wheels.push(wheel);
    if (isFront) frontPivots.push(pivot);
  }

  // lights
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  const headlights = [];
  const taillights = [];
  for (const x of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), headMat);
    h.position.set(x, 0.68, 2.16);
    group.add(h);
    headlights.push(h);

    const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.06), tailMat);
    t.position.set(x, 0.7, -2.16);
    group.add(t);
    taillights.push(t);
  }

  let lightbar = null;
  let barRed = null;
  let barBlue = null;
  if (police) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.34), trim);
    bar.position.set(0, 1.47, -0.1);
    group.add(bar);
    barRed = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.13, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xff1b1b })
    );
    barRed.position.set(-0.32, 1.53, -0.1);
    barBlue = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.13, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x2b4bff })
    );
    barBlue.position.set(0.32, 1.53, -0.1);
    group.add(barRed, barBlue);
    lightbar = bar;

    // white door panels, the classic black-and-white look
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.4, metalness: 0.4 });
    for (const side of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 1.9), doorMat);
      door.position.set(side * 0.94, 0.66, 0.1);
      group.add(door);
    }
  }

  return { group, wheels, frontPivots, headlights, taillights, barRed, barBlue, paint, glass };
}

export class Vehicle {
  constructor(scene, opts = {}) {
    const built = createCarMesh(opts);
    this.mesh = built.group;
    this.parts = built;
    this.police = !!opts.police;
    scene.add(this.mesh);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.steer = 0;
    this.health = 100;
    this.alive = true;
    this.driver = null;
    this.maxSpeed = this.police ? 40 : 42;
    this.enginePower = this.police ? 26 : 22;
    this.crashCooldown = 0;
    this.wheelSpin = 0;
    this.sirenPhase = 0;
  }

  get speed() {
    return this.vel.length();
  }

  get speedKmh() {
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return Math.abs(this.vel.dot(forward)) * 3.6;
  }

  forwardVector(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  setPosition(x, z, yaw = 0) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = yaw;
  }

  update(dt, controls, grid, bounds) {
    const throttle = controls.throttle || 0;
    const brake = controls.brake || 0;
    const steerInput = controls.steer || 0;
    const handbrake = !!controls.handbrake;

    const heading = this.forwardVector();
    let forwardSpeed = this.vel.dot(heading);

    // --- steering: scales with speed, tightens with the handbrake
    const gripSteer = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 5.5, 0, 1);
    const highSpeedDamp = 1 - 0.5 * Math.min(1, Math.abs(forwardSpeed) / 40);
    const dirSign = forwardSpeed < -0.4 ? -1 : 1;
    this.steer += (steerInput - this.steer) * Math.min(1, 9 * dt);
    // Positive steer must turn the car towards screen-right. With a camera
    // looking along +Z, screen-right is world -X, and increasing yaw swings the
    // forward vector towards +X — hence the minus sign here (and in the wheel
    // visuals). Keeping the sign in one place avoids mirrored input elsewhere.
    this.yaw -= this.steer * 2.4 * gripSteer * highSpeedDamp * dirSign * dt * (handbrake ? 1.35 : 1);

    // --- engine / brakes
    const heading2 = this.forwardVector();
    const speedRatio = Math.min(1, Math.abs(forwardSpeed) / this.maxSpeed);
    if (throttle > 0) {
      const boost = controls.boost ? 1.5 : 1;
      const power = this.enginePower * (1 - speedRatio * 0.72) * boost;
      this.vel.addScaledVector(heading2, power * throttle * dt);
    }
    if (brake > 0) {
      if (forwardSpeed > 0.6) {
        this.vel.addScaledVector(heading2, -30 * brake * dt);
      } else if (forwardSpeed > -12) {
        this.vel.addScaledVector(heading2, -9 * brake * dt); // reverse
      }
    }

    // --- tyre grip: damp the lateral component, less so with the handbrake
    forwardSpeed = this.vel.dot(heading2);
    const lateral = new THREE.Vector3().copy(this.vel).addScaledVector(heading2, -forwardSpeed);
    const grip = handbrake ? 1.1 : 7.0;
    this.vel.addScaledVector(lateral, -Math.min(1, grip * dt));

    // drag + rolling resistance
    const drag = throttle > 0 ? 0.16 : 0.9;
    this.vel.multiplyScalar(1 / (1 + drag * dt));
    const cap = controls.boost ? this.maxSpeed * 1.12 : this.maxSpeed;
    if (this.vel.length() > cap) this.vel.setLength(cap);

    // --- integrate with two-circle collision against buildings
    this.pos.addScaledVector(this.vel, dt);
    const front = { x: this.pos.x + heading2.x * 1.25, z: this.pos.z + heading2.z * 1.25 };
    const rear = { x: this.pos.x - heading2.x * 1.25, z: this.pos.z - heading2.z * 1.25 };
    const hitF = resolveCircle(grid, front, 0.98);
    const hitR = resolveCircle(grid, rear, 0.98);
    if (hitF || hitR) {
      this.pos.x = (front.x + rear.x) / 2;
      this.pos.z = (front.z + rear.z) / 2;
      if (this.crashCooldown <= 0 && this.vel.length() > 4) {
        this.crashCooldown = 0.25;
        this.damage(Math.min(28, this.vel.length() * 1.1), true);
      }
      this.vel.multiplyScalar(0.55);
    } else {
      this.pos.x = (front.x + rear.x) / 2;
      this.pos.z = (rear.z + front.z) / 2;
    }

    if (bounds) {
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, bounds.min + 3, bounds.max - 3);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, bounds.min + 3, bounds.max - 3);
    }
    if (this.crashCooldown > 0) this.crashCooldown -= dt;

    // --- visuals
    this.mesh.position.set(this.pos.x, this.pos.y || 0, this.pos.z);
    this.mesh.rotation.y = this.yaw;

    forwardSpeed = this.vel.dot(heading2);
    this.wheelSpin += (forwardSpeed * dt) / WHEEL_R;
    for (const w of this.parts.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.parts.frontPivots) p.rotation.y = this.steer * 0.42; // matches the yaw sign above

    // brake light glow
    const braking = brake > 0 && forwardSpeed > 0.5;
    for (const t of this.parts.taillights) {
      t.material.color.setHex(braking ? 0xff6a5a : 0x8f1f18);
    }

    if (this.police) {
      this.sirenPhase += dt * 9;
      const red = Math.sin(this.sirenPhase) > 0;
      if (this.parts.barRed) this.parts.barRed.material.color.setHex(red ? 0xff2020 : 0x3a0808);
      if (this.parts.barBlue) this.parts.barBlue.material.color.setHex(red ? 0x0a1440 : 0x3050ff);
    }
  }

  damage(amount, fromCrash = false) {
    this.health = Math.max(0, this.health - amount);
    // paint darkens as the car gets wrecked
    const t = this.health / 100;
    this.parts.paint.color.multiplyScalar(fromCrash ? 0.985 : 0.97);
    if (this.health <= 0) this.alive = false;
    return t;
  }
}
