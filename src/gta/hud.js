/**
 * San Andreas HUD: rotating satellite minimap (the real GTA V map, bottom-left),
 * speedometer (bottom-right) and a district/street label.
 */
import { WORLD, LANDMARKS } from './config.js';

const MAP_PX = 260;
const SCALE = 0.30;              // canvas px per metre

export class Hud {
  constructor() {
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.speedo = document.getElementById('speedo');
    this.speedCtx = this.speedo.getContext('2d');
    this.labelEl = document.getElementById('district');
    this.img = null;
    this.t = 0;
    this.label = '';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    for (const c of [this.map, this.speedo]) {
      c.width = MAP_PX * dpr;
      c.height = MAP_PX * dpr;
      c.style.width = MAP_PX + 'px';
      c.style.height = MAP_PX + 'px';
    }
  }

  setMapImage(img) {
    this.img = img;
  }

  update(dt, car, info) {
    this.t += dt;
    if (this.t < 1 / 24) return;
    this.t = 0;
    this.drawMap(car);
    this.drawSpeedo(car);
    if (info?.label && info.label !== this.label) {
      this.label = info.label;
      if (this.labelEl) this.labelEl.textContent = info.label;
    }
  }

  project(x, z, car) {
    const dx = x - car.position.x;
    const dz = z - car.position.z;
    const c = Math.cos(-car.yaw), s = Math.sin(-car.yaw);
    const C = MAP_PX / 2;
    return [C + (dx * c - dz * s) * SCALE, C - (dx * s + dz * c) * SCALE];
  }

  drawMap(car) {
    const ctx = this.mapCtx;
    const dpr = this.dpr;
    const C = MAP_PX / 2;
    const R = C - 6;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.map.width, this.map.height);

    // clip to the round map
    ctx.save();
    ctx.beginPath();
    ctx.arc(C * dpr, C * dpr, R * dpr, 0, Math.PI * 2);
    ctx.clip();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a1d24';
    ctx.fillRect(0, 0, MAP_PX, MAP_PX);

    if (this.img) {
      const imgW = this.img.width || this.img.naturalWidth;
      const imgH = this.img.height || this.img.naturalHeight;
      const kx = imgW / WORLD.width;
      const ky = imgH / WORLD.height;
      const cA = Math.cos(-car.yaw), sA = Math.sin(-car.yaw);
      const a = SCALE * cA / kx;
      const c = SCALE * sA / ky;
      const b = -SCALE * sA / kx;
      const d = SCALE * cA / ky;
      const e = C + SCALE * cA * (WORLD.x0 - car.position.x) - SCALE * sA * (WORLD.y1 - car.position.z);
      const f = C - SCALE * sA * (WORLD.x0 - car.position.x) - SCALE * cA * (WORLD.y1 - car.position.z);
      ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * e, dpr * f);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.img, 0, 0, imgW, imgH);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // landmark blips (clamped to the rim when off-map)
    for (const lm of LANDMARKS) {
      let [px, py] = this.project(lm.x, lm.y, car);
      const dx = px - C, dy = py - C;
      const dist = Math.hypot(dx, dy);
      const off = dist > R - 10;
      if (off) {
        px = C + (dx / dist) * (R - 10);
        py = C + (dy / dist) * (R - 10);
      }
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = off ? 'rgba(255,255,255,0.34)' : '#5ef2c0';
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (!off) {
        ctx.font = '600 9px Helvetica, Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'center';
        ctx.fillText(lm.label.split(' ')[0].toUpperCase(), 0, -9);
      }
      ctx.restore();
    }

    // player arrow
    ctx.save();
    ctx.translate(C, C);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(7.5, 9); ctx.lineTo(0, 4); ctx.lineTo(-7.5, 9);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();   // clip

    // rim + north marker
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(C, C, R - 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120, 235, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const nAng = -car.yaw - Math.PI / 2;
    ctx.save();
    ctx.translate(C + Math.cos(nAng) * (R - 12), C + Math.sin(nAng) * (R - 12));
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 12px Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, 0);
    ctx.restore();
  }

  drawSpeedo(car) {
    const ctx = this.speedCtx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = MAP_PX / 2, R = 96;
    const kmh = Math.max(0, car.speed * 3.6);
    ctx.clearRect(0, 0, MAP_PX, MAP_PX);

    const start = Math.PI * 0.78, end = Math.PI * 2.22;
    ctx.beginPath();
    ctx.arc(C, C, R, start, end);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();

    const frac = Math.min(1, kmh / 240);
    if (frac > 0.001) {
      ctx.beginPath();
      ctx.arc(C, C, R, start, start + (end - start) * frac);
      const grad = ctx.createLinearGradient(0, 0, MAP_PX, 0);
      grad.addColorStop(0, '#8ef3ff');
      grad.addColorStop(0.6, '#ffffff');
      grad.addColorStop(1, '#ff4fae');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3.4;
      ctx.shadowColor = 'rgba(140, 240, 255, 0.85)';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    for (let i = 0; i <= 12; i++) {
      const a = start + (end - start) * (i / 12);
      const r1 = R - 12, r2 = R - (i % 3 === 0 ? 22 : 17);
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      ctx.lineTo(C + Math.cos(a) * r2, C + Math.sin(a) * r2);
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = i % 3 === 0 ? 2 : 1;
      ctx.stroke();
    }

    const speedStr = String(Math.round(kmh)).padStart(3, '0');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '300 46px Helvetica, Arial';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(160, 240, 255, 0.75)';
    ctx.shadowBlur = 16;
    ctx.fillText(speedStr, C, C - 2);
    ctx.shadowBlur = 0;

    ctx.font = '400 11px Helvetica, Arial';
    ctx.fillStyle = 'rgba(190, 235, 245, 0.8)';
    ctx.fillText('K M / H', C, C + 30);
  }
}
