/* Wanted level, pursuit cars and foot officers. */

import * as THREE from "three";
import { Vehicle } from "./vehicle.js?v=1250b65";
import { resolveCircle, pointBlocked } from "./physics.js?v=1250b65";
import { createCharacterMesh, angleDelta } from "./characters.js?v=1250b65";
import { toWorld, CELL, ROAD_W, N_BLOCKS } from "./city.js?v=1250b65";

const MAX_WANTED = 5;

function losClear(grid, a, b) {
  const steps = Math.max(4, Math.floor(a.distanceTo(b) / 3));
  const p = new THREE.Vector3();
  for (let i = 1; i < steps; i++) {
    p.lerpVectors(a, b, i / steps);
    if (pointBlocked(grid, p.x, p.z, 0.2)) return false;
  }
  return true;
}

class CopUnit {
  constructor(scene, x, z) {
    const { group, parts } = createCharacterMesh(
      { jacket: 0x1b2436, pants: 0x151a24, skin: 0xb98a62, shirt: 0xdfe4ea },
      { accent: 0xff4444 }
    );
    this.mesh = group;
    this.parts = parts;
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = 0;
    this.phase = 0;
    this.fireTimer = 1.5 + Math.random();
    this.alive = true;
    this.radius = 0.42;
    scene.add(group);
  }

  update(dt, target, grid, onShoot) {
    if (!this.alive) return;
    const to = new THREE.Vector3().subVectors(target, this.pos);
    const dist = Math.hypot(to.x, to.z);
    to.y = 0;
    if (dist > 0.001) to.normalize();

    this.yaw += angleDelta(this.yaw, Math.atan2(to.x, to.z)) * Math.min(1, 8 * dt);
    if (dist > 6) {
      const speed = 5.6;
      this.pos.x += to.x * speed * dt;
      this.pos.z += to.z * speed * dt;
      resolveCircle(grid, this.pos, this.radius);
      this.phase += speed * dt * 2.2;
    }
    const swing = Math.sin(this.phase) * 0.6;
    this.parts.legL.rotation.x = swing;
    this.parts.legR.rotation.x = -swing;
    this.parts.armL.rotation.x = -0.9;

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;

    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && dist < 26 && losClear(grid, this.pos, target)) {
      this.fireTimer = 1.9 + Math.random() * 1.4;
      onShoot(this, 4 + Math.random() * 3);
    }
  }
}

export class Police {
  constructor(scene, city, grid, { onPlayerDamage, effects, audio }) {
    this.scene = scene;
    this.city = city;
    this.grid = grid;
    this.onPlayerDamage = onPlayerDamage;
    this.effects = effects;
    this.audio = audio;
    this.wanted = 0;
    this.cars = [];
    this.units = [];
    this.spawnTimer = 0;
    this.crimeTimer = 0;
    this.lastSiren = 0;
  }

  addCrime(amount, atPos) {
    this.wanted = Math.min(MAX_WANTED, this.wanted + amount);
    this.crimeTimer = 0;
    if (this.audio) this.audio.sirenPing();
  }

  clearWanted() {
    this.wanted = 0;
    this.crimeTimer = 0;
    for (const car of this.cars) {
      car.mesh.visible = false;
      this.scene.remove(car.mesh);
    }
    for (const u of this.units) {
      u.mesh.visible = false;
      this.scene.remove(u.mesh);
    }
    this.cars.length = 0;
    this.units.length = 0;
  }

  spawnCar(playerPos) {
    const rng = Math.random;
    const axis = rng() < 0.5 ? "x" : "z";
    const centreIdx = Math.floor(rng() * (N_BLOCKS + 1));
    const centre = centreIdx * CELL + ROAD_W / 2;
    const lane = centre + (rng() < 0.5 ? -4.6 : 4.6);

    let x, z;
    if (axis === "x") {
      x = playerPos.x + (rng() < 0.5 ? -1 : 1) * (70 + rng() * 60);
      z = toWorld(lane);
    } else {
      x = toWorld(lane);
      z = playerPos.z + (rng() < 0.5 ? -1 : 1) * (70 + rng() * 60);
    }
    if (pointBlocked(this.grid, x, z, 2)) return null;

    const car = new Vehicle(this.scene, { police: true });
    const yaw = Math.atan2(playerPos.x - x, playerPos.z - z);
    car.setPosition(x, z, yaw);
    car.stuckTimer = 0;
    this.cars.push(car);
    return car;
  }

  spawnUnit(playerPos) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 26 + Math.random() * 16;
    const x = playerPos.x + Math.cos(angle) * dist;
    const z = playerPos.z + Math.sin(angle) * dist;
    if (pointBlocked(this.grid, x, z, 1.2)) return null;
    const unit = new CopUnit(this.scene, x, z);
    this.units.push(unit);
    return unit;
  }

  update(dt, player, onFoot) {
    const playerPos = player.pos;

    // wanted decay when the player stays clean
    if (this.wanted > 0) {
      this.crimeTimer += dt;
      if (this.crimeTimer > 24) {
        this.crimeTimer = 18;
        this.wanted = Math.max(0, this.wanted - 1);
      }
    }

    // reinforcement spawning
    this.spawnTimer -= dt;
    const wantCars = Math.min(4, this.wanted);
    if (this.spawnTimer <= 0 && this.cars.length < wantCars) {
      this.spawnTimer = 2.4;
      this.spawnCar(playerPos);
    }
    if (this.wanted >= 3 && this.units.length < Math.min(3, this.wanted - 1)) {
      this.spawnUnit(playerPos);
    }

    for (const car of this.cars) {
      const dx = playerPos.x - car.pos.x;
      const dz = playerPos.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      const desired = Math.atan2(dx, dz);
      const diff = angleDelta(car.yaw, desired);

      const controls = {
        throttle: 0,
        brake: 0,
        // Vehicle.update negates steer internally, so aim with the opposite sign
        steer: -THREE.MathUtils.clamp(diff * 1.7, -1, 1),
        handbrake: false,
      };

      // simple stuck recovery
      if (car.speed < 1.4) car.stuckTimer += dt;
      else car.stuckTimer = 0;

      if (car.stuckTimer > 1.2) {
        controls.throttle = 0;
        controls.brake = 1;
        controls.steer = -controls.steer;
      } else if (dist > 14) {
        controls.throttle = 1;
      } else if (dist > 8) {
        controls.throttle = 0.45;
      } else {
        controls.brake = 0.6;
      }

      car.update(dt, controls, this.grid, this.city.bounds);

      // ram the player when close
      if (player.alive && dist < 3.4 && car.speed > 5) {
        this.onPlayerDamage(6, playerPos);
      }

      // shoot when they have a clear line
      car.fireTimer = (car.fireTimer || 1.2) - dt;
      if (player.alive && car.fireTimer <= 0 && dist < 32 && losClear(this.grid, car.pos, playerPos)) {
        car.fireTimer = 1.9 + Math.random() * 1.5;
        const from = new THREE.Vector3(car.pos.x, 1.3, car.pos.z);
        const to = new THREE.Vector3(playerPos.x, playerPos.y + 1.2, playerPos.z);
        this.effects.tracer(from, to, 0xffd08a);
        this.audio.gunshot(0.5);
        this.onPlayerDamage(3 + Math.random() * 4, playerPos);
      }
    }

    for (const unit of this.units) {
      unit.update(dt, new THREE.Vector3(playerPos.x, playerPos.y + 1.1, playerPos.z), this.grid, (from, dmg) => {
        const to = new THREE.Vector3(playerPos.x, playerPos.y + 1.2, playerPos.z);
        this.effects.tracer(new THREE.Vector3(from.pos.x, 1.5, from.pos.z), to, 0xffd08a);
        this.audio.gunshot(0.45);
        this.onPlayerDamage(dmg, playerPos);
      });
      if (unit.pos.distanceToSquared(playerPos) > 220 * 220) {
        unit.alive = false;
        unit.mesh.visible = false;
      }
    }
    this.units = this.units.filter((u) => u.alive);

    // siren volume from the closest cruiser
    let nearest = Infinity;
    for (const car of this.cars) nearest = Math.min(nearest, car.pos.distanceTo(playerPos));
    this.audio.siren(nearest < 90 ? 1 - nearest / 90 : 0, dt);
  }

}
