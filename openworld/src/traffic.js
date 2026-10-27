/* Ambient life: lane-following traffic and pedestrians walking block perimeters. */

import * as THREE from "three";
import { createCarMesh, CAR_COLORS } from "./vehicle.js?v=461031c";
import { createCharacterMesh, randomPalette } from "./characters.js?v=461031c";
import { toWorld, CELL, ROAD_W, BLOCK_S, N_BLOCKS } from "./city.js?v=461031c";

const LANE = 4.6;
const ROAD_CENTRES = Array.from({ length: N_BLOCKS + 1 }, (_, i) => i * CELL + ROAD_W / 2);

const wrap = (v, max) => ((v % max) + max) % max;

export class TrafficCar {
  constructor(scene, rng) {
    const color = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
    const built = createCarMesh({ color });
    this.mesh = built.group;
    this.parts = built;
    this.color = color;
    this.axis = rng() < 0.5 ? "x" : "z";
    this.dir = rng() < 0.5 ? 1 : -1;
    const centreIdx = Math.floor(rng() * ROAD_CENTRES.length);
    const centre = ROAD_CENTRES[centreIdx];
    this.lane = centre + (this.dir > 0 ? -LANE : LANE);
    this.s = rng() * N_BLOCKS * CELL;
    this.speed = 9 + rng() * 7;
    this.baseSpeed = this.speed;
    this.nextCentre = this.findNextCentre();
    this.occupied = false;
    this.stunned = 0;
    scene.add(this.mesh);
    this.syncMesh(0);
  }

  findNextCentre() {
    const ahead = ROAD_CENTRES.filter((c) => (this.dir > 0 ? c > this.s + 1 : c < this.s - 1));
    if (!ahead.length) return this.dir > 0 ? ROAD_CENTRES[0] : ROAD_CENTRES[ROAD_CENTRES.length - 1];
    return this.dir > 0 ? ahead[0] : ahead[ahead.length - 1];
  }

  get layoutPos() {
    return this.axis === "x" ? { x: this.s, z: this.lane } : { x: this.lane, z: this.s };
  }

  get worldYaw() {
    if (this.axis === "x") return this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    return this.dir > 0 ? 0 : Math.PI;
  }

  syncMesh(dt) {
    const p = this.layoutPos;
    this.mesh.position.set(toWorld(p.x), 0, toWorld(p.z));
    this.mesh.rotation.y = this.worldYaw;
    for (const w of this.parts.wheels) w.rotation.x += (this.speed * dt) / 0.35;
  }

  update(dt, rng, slowFactor = 1) {
    if (this.occupied) return;
    if (this.stunned > 0) {
      this.stunned -= dt;
      this.speed = Math.max(0, this.speed - 12 * dt);
      this.syncMesh(dt);
      return;
    }
    this.speed += (this.baseSpeed * slowFactor - this.speed) * Math.min(1, dt * 2);
    this.s += this.dir * this.speed * dt;

    // reached the next intersection?
    const reached = this.dir > 0 ? this.s >= this.nextCentre : this.s <= this.nextCentre;
    if (reached) {
      if (rng() < 0.28) {
        // turn into the crossing road
        const centre = this.nextCentre;
        const oldLane = this.lane;
        const newDir = rng() < 0.5 ? 1 : -1;
        this.axis = this.axis === "x" ? "z" : "x";
        this.s = oldLane;
        this.lane = centre + (newDir > 0 ? -LANE : LANE);
        this.dir = newDir;
      }
      this.nextCentre = this.findNextCentre();
    }

    // wrap around the map edges
    const span = N_BLOCKS * CELL;
    if (this.s > span + CELL) this.s = -CELL;
    if (this.s < -CELL) this.s = span + CELL;

    this.syncMesh(dt);
  }
}

export class Ped {
  constructor(scene, city, rng) {
    const palette = randomPalette(rng);
    const { group, parts } = createCharacterMesh(palette);
    this.mesh = group;
    this.parts = parts;
    scene.add(this.mesh);

    const block = city.blocks[Math.floor(rng() * city.blocks.length)];
    this.blockX = block.x;
    this.blockZ = block.z;
    this.inset = 2.2;
    this.L = BLOCK_S - this.inset * 2;
    this.perimeter = this.L * 4;
    this.t = rng() * this.perimeter;
    this.dir = rng() < 0.5 ? 1 : -1;
    this.speed = 1.1 + rng() * 0.7;
    this.phase = rng() * 10;
    this.alive = true;
    this.dead = false;
    this.fleeTime = 0;
    this.fleeDir = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.radius = 0.36;
    this.palette = palette;
    this.deadTimer = 0;
    this.updatePerimeterPos();
  }

  updatePerimeterPos() {
    const t = wrap(this.t, this.perimeter);
    const L = this.L;
    const x0 = toWorld(this.blockX + this.inset);
    const z0 = toWorld(this.blockZ + this.inset);
    let x, z, yaw;
    if (t < L) { x = x0 + t; z = z0; yaw = Math.PI / 2; }
    else if (t < L * 2) { x = x0 + L; z = z0 + (t - L); yaw = 0; }
    else if (t < L * 3) { x = x0 + L - (t - L * 2); z = z0 + L; yaw = -Math.PI / 2; }
    else { x = x0; z = z0 + L - (t - L * 3); yaw = Math.PI; }
    this.pos.set(x, 0, z);
    this.yaw = this.dir > 0 ? yaw : yaw + Math.PI;
  }

  flee(from) {
    if (this.dead || this.fleeTime > 1.6) return;
    this.fleeTime = 4.5;
    this.fleeDir.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (this.fleeDir.lengthSq() < 0.01) this.fleeDir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    this.fleeDir.normalize();
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.alive = false;
    this.mesh.rotation.z = Math.PI / 2.1;
    this.mesh.position.y = 0.22;
    this.deadTimer = 14;
  }

  update(dt, playerPos) {
    if (this.dead) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) this.mesh.visible = false;
      return;
    }

    if (this.fleeTime > 0) {
      this.fleeTime -= dt;
      const speed = 4.6;
      this.pos.addScaledVector(this.fleeDir, speed * dt);
      // keep them inside the block sidewalks-ish: bounce off the ring bounds
      this.yaw = Math.atan2(this.fleeDir.x, this.fleeDir.z);
      this.phase += speed * dt * 1.9;
      this.animate(1);
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = this.yaw;
      return;
    }

    this.t += this.dir * this.speed * dt;
    this.updatePerimeterPos();
    this.phase += this.speed * dt * 2.6;
    this.animate(0.8);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  animate(amount) {
    const swing = Math.sin(this.phase) * 0.5 * amount;
    this.parts.legL.rotation.x = swing;
    this.parts.legR.rotation.x = -swing;
    this.parts.armL.rotation.x = -swing * 0.7;
    this.parts.armR.rotation.x = swing * 0.7;
  }
}

export class Traffic {
  constructor(scene, city, seed = 1) {
    this.cars = [];
    this.peds = [];
    this.rng = mulberry32Local(seed);
    for (let i = 0; i < 14; i++) this.cars.push(new TrafficCar(scene, this.rng));
    for (let i = 0; i < 38; i++) this.peds.push(new Ped(scene, city, this.rng));
  }

  update(dt, playerPos) {
    // traffic slows down near the player, like real drivers rubber-necking
    for (const car of this.cars) {
      const p = car.layoutPos;
      const d = Math.hypot(toWorld(p.x) - playerPos.x, toWorld(p.z) - playerPos.z);
      const slow = d < 12 ? 0.35 : d < 26 ? 0.75 : 1;
      car.update(dt, this.rng, slow);
    }
    for (const ped of this.peds) {
      if (ped.fleeTime <= 0 && ped.pos.distanceToSquared(playerPos) < 25) ped.flee(playerPos);
      ped.update(dt, playerPos);
    }
  }

  scareAt(pos, radius = 26) {
    for (const ped of this.peds) {
      if (ped.pos.distanceToSquared(pos) < radius * radius) ped.flee(pos);
    }
  }

  removeCar(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    car.mesh.visible = false;
  }
}

function mulberry32Local(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
