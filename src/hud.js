/** Canvas HUD: GPS style minimap (bottom-left) + speedometer (bottom-right). */

const MAP_SCALE = 0.62;      // px per metre
const ROAD_HALF = 9.1;
const RAIL_X = 15.1;

export class Hud {
  constructor() {
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.speedo = document.getElementById('speedo');
    this.speedCtx = this.speedo.getContext('2d');
    this.t = 0;
  }

  update(dt, car) {
    this.t += dt;
    if (this.t < 1 / 20) return;   // 20 Hz is plenty for a HUD
    this.t = 0;
    this.drawMap(car);
    this.drawSpeedo(car);
  }

  /** world -> map pixel, rotated so the car always points up */
  project(x, z, car) {
    const dx = x - car.position.x;
    const dz = z - car.position.z;
    const c = Math.cos(-car.yaw), s = Math.sin(-car.yaw);
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    const C = 130;
    return [C + rx * MAP_SCALE, C - rz * MAP_SCALE];
  }

  drawMap(car) {
    const ctx = this.mapCtx;
    const C = 130, R = 122;
    ctx.clearRect(0, 0, 260, 260);

    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.clip();

    // base land
    const g = ctx.createLinearGradient(0, 0, 260, 260);
    g.addColorStop(0, '#0d2b2c');
    g.addColorStop(1, '#0a2022');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 260, 260);

    // ocean on the right (+X)
    ctx.beginPath();
    const p1 = this.project(RAIL_X, car.position.z - 400, car);
    const p2 = this.project(RAIL_X, car.position.z + 400, car);
    const n1 = this.project(RAIL_X + 400, car.position.z - 400, car);
    const n2 = this.project(RAIL_X + 400, car.position.z + 400, car);
    ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(n2[0], n2[1]); ctx.lineTo(n1[0], n1[1]);
    ctx.closePath();
    ctx.fillStyle = '#0b2f38';
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 230, 255, 0.35)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();

    // side streets off the boulevard
    ctx.strokeStyle = 'rgba(150, 220, 214, 0.20)';
    ctx.lineWidth = 3.4;
    for (let z = Math.floor((car.position.z - 320) / 96) * 96; z < car.position.z + 320; z += 96) {
      const a = this.project(-190, z, car);
      const b = this.project(-ROAD_HALF, z, car);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    // the boulevard itself
    const a = this.project(0, car.position.z - 400, car);
    const b = this.project(0, car.position.z + 400, car);
    ctx.strokeStyle = 'rgba(170, 235, 226, 0.30)';
    ctx.lineWidth = ROAD_HALF * 2 * MAP_SCALE;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();

    // magenta route line
    const ra = this.project(0, car.position.z - 12, car);
    const rb = this.project(0, car.position.z + 250, car);
    ctx.strokeStyle = 'rgba(255, 45, 149, 0.95)';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 45, 149, 0.85)';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(ra[0], ra[1]); ctx.lineTo(rb[0], rb[1]); ctx.stroke();
    ctx.shadowBlur = 0;

    // POI blips
    const blip = (x, z, color, kind) => {
      const [px, py] = this.project(x, z, car);
      if (Math.hypot(px - C, py - C) > R - 8) return;
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (kind === 'palm') ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
      else { ctx.moveTo(0, -4); ctx.lineTo(3.4, 3); ctx.lineTo(-3.4, 3); ctx.closePath(); }
      ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    blip(11.6, Math.floor(car.position.z / 200) * 200 + 60, '#7dffa8', 'palm');
    blip(-24, Math.floor(car.position.z / 200) * 200 + 120, '#ffd479', 'poi');

    // north indicator (rotates with the map)
    const nAng = -car.yaw - Math.PI / 2;
    ctx.save();
    ctx.translate(C + Math.cos(nAng) * 104, C + Math.sin(nAng) * 104);
    ctx.rotate(nAng + Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 13px Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, 0);
    ctx.restore();

    // player arrow
    ctx.save();
    ctx.translate(C, C);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 3.5); ctx.lineTo(-7, 8);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    ctx.restore();

    // rim
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(C, C, R - 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120, 235, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawSpeedo(car) {
    const ctx = this.speedCtx;
    const C = 130, R = 96;
    const mph = Math.max(0, car.speed * 2.23694);
    ctx.clearRect(0, 0, 260, 260);

    const start = Math.PI * 0.78, end = Math.PI * 2.22;
    // track
    ctx.beginPath();
    ctx.arc(C, C, R, start, end);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // fill
    const frac = Math.min(1, mph / 120);
    if (frac > 0.001) {
      ctx.beginPath();
      ctx.arc(C, C, R, start, start + (end - start) * frac);
      const grad = ctx.createLinearGradient(0, 0, 260, 0);
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

    // ticks
    for (let i = 0; i <= 10; i++) {
      const a = start + (end - start) * (i / 10);
      const r1 = R - 12, r2 = R - (i % 5 === 0 ? 22 : 17);
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      ctx.lineTo(C + Math.cos(a) * r2, C + Math.sin(a) * r2);
      ctx.strokeStyle = i % 5 === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = i % 5 === 0 ? 2 : 1;
      ctx.stroke();
    }

    // digits
    const speedStr = String(Math.round(mph)).padStart(3, '0');
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
    ctx.fillText('M P H', C, C + 30);
  }
}
