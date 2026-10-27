/* DOM + canvas HUD: minimap, health, wanted stars, ammo, speedometer. */

import { WORLD_SIZE, BLOCK_S } from "./city.js?v=1250b65";

const MAP_PPM = 2;
const MM_SIZE = 200;

export class HUD {
  constructor(city) {
    this.city = city;
    this.el = {
      hud: document.getElementById("hud"),
      health: document.getElementById("health-fill"),
      armour: document.getElementById("armour-fill"),
      wanted: [...document.getElementById("wanted").children],
      ammo: document.getElementById("ammo"),
      reserve: document.getElementById("ammo-reserve"),
      weaponBox: document.getElementById("weapon-box"),
      prompt: document.getElementById("prompt"),
      crosshair: document.getElementById("crosshair"),
      hitmark: document.getElementById("hitmark"),
      damage: document.getElementById("damage"),
      speedo: document.getElementById("speedo"),
      speedValue: document.getElementById("speed-value"),
      speedoCanvas: document.getElementById("speedo-canvas"),
      carHint: document.getElementById("car-hint"),
      clock: document.getElementById("clock"),
    };

    this.canvas = document.getElementById("minimap");
    this.ctx = this.canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = MM_SIZE * dpr;
    this.canvas.height = MM_SIZE * dpr;

    this.sctx = this.el.speedoCanvas.getContext("2d");
    this.el.speedoCanvas.width = 190 * dpr;
    this.el.speedoCanvas.height = 190 * dpr;

    this.buildMap();
    this.lastWanted = -1;
    this.damageTimer = 0;
    this.hitTimer = 0;
  }

  buildMap() {
    const size = Math.round(WORLD_SIZE * MAP_PPM);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const min = this.city.bounds.min;

    g.fillStyle = "#151a21";
    g.fillRect(0, 0, size, size);

    // road network is the background; blocks sit on top
    for (const b of this.city.blocks) {
      const x = (b.x - min) * MAP_PPM;
      const y = (this.city.bounds.max - (b.z + BLOCK_S)) * MAP_PPM;
      const s = BLOCK_S * MAP_PPM;
      g.fillStyle = b.kind === "park" ? "#24402a" : "#242a33";
      g.fillRect(x, y, s, s);
      g.strokeStyle = "rgba(255,255,255,0.06)";
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    }

    g.fillStyle = "#39424f";
    for (const b of this.city.buildings) {
      const x = (b.x - min) * MAP_PPM;
      const y = (this.city.bounds.max - (b.z + b.d)) * MAP_PPM;
      g.fillRect(x, y, b.w * MAP_PPM, b.d * MAP_PPM);
    }
    this.mapCanvas = c;
    this.mapMin = min;
  }

  show() {
    this.el.hud.classList.remove("hidden");
  }

  hide() {
    this.el.hud.classList.add("hidden");
  }

  setHealth(v) {
    this.el.health.style.width = `${Math.max(0, Math.min(100, v))}%`;
  }

  setArmour(v) {
    this.el.armour.style.width = `${Math.max(0, Math.min(100, v))}%`;
  }

  setWanted(n) {
    if (n === this.lastWanted) return;
    this.el.wanted.forEach((el, i) => {
      const wasOn = el.classList.contains("on");
      el.classList.toggle("on", i < n);
      if (i < n && !wasOn) {
        el.classList.remove("pulse");
        void el.offsetWidth;
        el.classList.add("pulse");
      }
    });
    this.lastWanted = n;
  }

  setAmmo(mag, reserve, reloading = false) {
    this.el.ammo.textContent = mag;
    this.el.reserve.textContent = `/ ${reserve}`;
    this.el.weaponBox.querySelector(".wpn-ammo").classList.toggle("reloading", reloading);
  }

  setPrompt(html) {
    if (html) {
      this.el.prompt.innerHTML = html;
      this.el.prompt.classList.add("show");
    } else {
      this.el.prompt.classList.remove("show");
    }
  }

  setTouchMode(active) {
    this.touchMode = !!active;
    // the HUD sits above the joystick on small screens
    this.el.hud.classList.toggle("touch-layout", !!active);
  }

  setCrosshair(visible) {
    this.el.crosshair.classList.toggle("hidden", !visible);
  }

  setDriving(active, kmh = 0) {
    this.el.speedo.classList.toggle("hidden", !active);
    if (active) this.drawSpeedo(kmh);
  }

  setCarHint(text) {
    this.el.carHint.classList.toggle("hidden", !text);
    if (text) this.el.carHint.textContent = text;
  }

  setClock(minutes) {
    const h = 19 + Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    this.el.clock.textContent = `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  hitMarker() {
    this.el.hitmark.classList.add("show");
    this.hitTimer = 0.12;
  }

  flashDamage() {
    this.el.damage.classList.add("show");
    this.damageTimer = 0.12;
  }

  drawSpeedo(kmh) {
    const g = this.sctx;
    const dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, 190, 190);
    const cx = 95;
    const cy = 95;
    const r = 72;
    const start = Math.PI * 0.78;
    const end = Math.PI * 2.22;
    const maxKmh = 220;
    const t = Math.min(1, kmh / maxKmh);

    g.beginPath();
    g.arc(cx, cy, r, start, end);
    g.strokeStyle = "rgba(255,255,255,0.09)";
    g.lineWidth = 9;
    g.lineCap = "round";
    g.stroke();

    const grad = g.createLinearGradient(20, 170, 170, 20);
    grad.addColorStop(0, "#4ec07a");
    grad.addColorStop(0.55, "#ffcf5a");
    grad.addColorStop(1, "#ff5b4a");
    g.beginPath();
    g.arc(cx, cy, r, start, start + (end - start) * t);
    g.strokeStyle = grad;
    g.lineWidth = 9;
    g.stroke();

    // ticks
    for (let i = 0; i <= 10; i++) {
      const a = start + ((end - start) * i) / 10;
      const r1 = r - 11;
      const r2 = r - (i % 5 === 0 ? 19 : 15);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      g.strokeStyle = i % 5 === 0 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.16)";
      g.lineWidth = i % 5 === 0 ? 2 : 1;
      g.stroke();
    }

    // needle
    const a = start + (end - start) * t;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
    g.strokeStyle = "#ff7a3a";
    g.lineWidth = 2.6;
    g.lineCap = "round";
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 4, 0, Math.PI * 2);
    g.fillStyle = "#ff9a4a";
    g.fill();
  }

  /** Per-frame HUD refresh. */
  update(dt, s) {
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      if (this.damageTimer <= 0) this.el.damage.classList.remove("show");
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.el.hitmark.classList.remove("show");
    }

    this.setHealth(s.health);
    this.setWanted(s.wanted);
    this.setCrosshair(!s.inVehicle && s.alive);
    this.setDriving(s.inVehicle, s.speedKmh);
    this.el.speedValue.textContent = Math.round(s.speedKmh);
    this.setClock(s.clockMinutes);

    if (s.alive) this.drawMinimap(s);
  }

  drawMinimap(s) {
    const g = this.ctx;
    const size = MM_SIZE;
    const k = 0.52; // screen pixels per metre
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, size, size);

    g.save();
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    g.clip();

    g.fillStyle = "#101419";
    g.fillRect(0, 0, size, size);

    const u = (s.pos.x - this.mapMin) * MAP_PPM;
    const v = (this.city.bounds.max - s.pos.z) * MAP_PPM;

    g.save();
    g.translate(size / 2, size / 2);
    g.rotate(-s.yaw);
    g.scale(k / MAP_PPM, k / MAP_PPM);
    g.translate(-u, -v);
    g.drawImage(this.mapCanvas, 0, 0);
    g.restore();

    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    const project = (x, z) => {
      const dx = x - s.pos.x;
      const dz = z - s.pos.z;
      return [(dx * cos - dz * sin) * k, (-dx * sin - dz * cos) * k];
    };

    const dot = (x, z, color, r, alpha = 1) => {
      const [sx, sy] = project(x, z);
      if (Math.hypot(sx, sy) > size / 2 - 3) return;
      g.globalAlpha = alpha;
      g.beginPath();
      g.arc(size / 2 + sx, size / 2 + sy, r, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.globalAlpha = 1;
    };

    for (const ped of s.peds) if (!ped.dead) dot(ped.pos.x, ped.pos.z, "#5b7fbf", 1.7, 0.75);
    for (const car of s.trafficCars) dot(car.mesh.position.x, car.mesh.position.z, "#d9c66a", 2.3, 0.9);
    for (const v of s.parked) if (v !== s.driverVehicle) dot(v.pos.x, v.pos.z, "#c9d3de", 2.3, 0.9);
    for (const car of s.copCars) dot(car.pos.x, car.pos.z, "#ff4d3d", 3.2, 1);
    for (const u2 of s.copUnits) dot(u2.pos.x, u2.pos.z, "#ff8a6a", 2.4, 1);

    // player arrow at the centre, always pointing up
    g.save();
    g.translate(size / 2, size / 2);
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5.2, 6);
    g.lineTo(0, 3);
    g.lineTo(-5.2, 6);
    g.closePath();
    g.fillStyle = "#ffffff";
    g.shadowColor = "rgba(255,255,255,0.9)";
    g.shadowBlur = 8;
    g.fill();
    g.restore();

    // vignette inside the circle
    const vg = g.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.52);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = vg;
    g.fillRect(0, 0, size, size);

    g.restore();

    // north marker rotates with the map
    const north = document.getElementById("north");
    if (north) {
      const nx = Math.sin(s.yaw) * (size / 2 - 14);
      const ny = -Math.cos(s.yaw) * (size / 2 - 14);
      north.style.transform = `translate(${nx}px, ${ny}px)`;
      north.style.left = "50%";
      north.style.top = "50%";
      north.style.marginLeft = "-4px";
      north.style.marginTop = "-7px";
      north.style.position = "absolute";
    }
  }
}
