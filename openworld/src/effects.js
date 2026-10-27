/* Pooled visual effects: tracers, impact sparks, smoke and explosions. */

import * as THREE from "three";

const MAX_PARTICLES = 220;
const MAX_TRACERS = 24;

export class Effects {
  constructor(scene) {
    this.scene = scene;

    const geo = new THREE.SphereGeometry(0.09, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    this.pool = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      scene.add(m);
      this.pool.push({
        mesh: m,
        life: 0,
        maxLife: 1,
        vel: new THREE.Vector3(),
        gravity: -9,
        growth: 0.4,
      });
    }
    this.cursor = 0;

    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8 });
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(g, tracerMat.clone());
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerCursor = 0;

    // muzzle flash light, reused
    this.flash = new THREE.PointLight(0xffcb7a, 0, 14, 2);
    scene.add(this.flash);
    this.flashLife = 0;

    // explosion lights
    this.boom = new THREE.PointLight(0xff8a3a, 0, 40, 2);
    scene.add(this.boom);
    this.boomLife = 0;
  }

  particle(pos, { color = 0xffffff, speed = 6, life = 0.6, size = 1, gravity = -9, spread = 1 } = {}) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    p.mesh.visible = true;
    p.mesh.position.copy(pos);
    p.mesh.material.color.setHex(color);
    p.mesh.material.opacity = 1;
    p.mesh.scale.setScalar(size);
    p.baseSize = size;
    p.vel.set(
      (Math.random() - 0.5) * speed * spread,
      Math.random() * speed * 0.7,
      (Math.random() - 0.5) * speed * spread
    );
    p.life = life;
    p.maxLife = life;
    p.gravity = gravity;
    return p;
  }

  burst(pos, opts = {}, count = 8) {
    for (let i = 0; i < count; i++) this.particle(pos, opts);
  }

  tracer(from, to, color = 0xffe0a0) {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    const arr = t.line.geometry.attributes.position.array;
    arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
    arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.geometry.computeBoundingSphere();
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.85;
    t.line.visible = true;
    t.life = 0.07;
  }

  muzzle(pos) {
    this.flash.position.copy(pos);
    this.flash.intensity = 24;
    this.flashLife = 0.06;
  }

  explosion(pos) {
    this.burst(pos, { color: 0xffb347, speed: 16, life: 1.1, size: 1.7, gravity: -6, spread: 1.4 }, 26);
    this.burst(pos, { color: 0x333333, speed: 6, life: 2.0, size: 2.4, gravity: 1.2, spread: 1.2 }, 16);
    this.boom.position.copy(pos);
    this.boom.position.y += 1.5;
    this.boom.intensity = 90;
    this.boomLife = 0.5;
  }

  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const t = Math.max(0, p.life / p.maxLife);
      p.vel.y += p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.material.opacity = t;
      p.mesh.scale.setScalar((p.baseSize || 1) * (0.4 + t * 0.9));
      if (p.life <= 0) p.mesh.visible = false;
    }

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
      if (t.life <= 0) t.line.visible = false;
    }

    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flash.intensity = 0;
    }
    if (this.boomLife > 0) {
      this.boomLife -= dt;
      this.boom.intensity = Math.max(0, this.boom.intensity - dt * 220);
    }
  }
}
