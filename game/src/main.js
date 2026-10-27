/* Runenlicht — a tiny top-down dungeon demo.
   Everything visual here is built from four AI-generated source images
   (floor, wall, crate, hero portrait) plus procedural canvas drawing. */

(() => {
  "use strict";

  // ---------------------------------------------------------------- constants
  const TILE = 64;
  const MAP_W = Dungeon.MAP_W;
  const MAP_H = Dungeon.MAP_H;
  const PLAYER_R = 15;
  const RUNES_TOTAL = 5;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const lightCanvas = document.createElement("canvas");
  const lctx = lightCanvas.getContext("2d");

  const ui = {
    hud: document.getElementById("hud"),
    hp: document.getElementById("hp"),
    runes: document.getElementById("runes"),
    overlay: document.getElementById("overlay"),
    toast: document.getElementById("toast"),
    touch: document.getElementById("touch"),
    stick: document.getElementById("stick"),
    knob: document.getElementById("knob"),
    dashBtn: document.getElementById("dash"),
  };

  const isTouch = matchMedia("(pointer: coarse)").matches;

  // ------------------------------------------------------------------- helpers
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

  // -------------------------------------------------------------------- assets
  const textures = {};
  const textureVariants = { floor: [], wall: [], crate: [] };
  const TEX_FILES = { floor: "assets/floor.jpg", wall: "assets/wall.jpg", crate: "assets/crate.jpg" };

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("missing " + src));
      img.src = src;
    });
  }

  function makeVariants(img, count, size) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      g.save();
      g.translate(size / 2, size / 2);
      g.rotate((i * Math.PI) / 2);
      if (i >= 2) g.scale(-1, 1);
      g.drawImage(img, -size / 2, -size / 2, size, size);
      g.restore();
      out.push(c);
    }
    return out;
  }

  async function loadAssets() {
    const [floor, wall, crate] = await Promise.all([
      loadImage(TEX_FILES.floor),
      loadImage(TEX_FILES.wall),
      loadImage(TEX_FILES.crate),
    ]);
    textures.floor = floor;
    textures.wall = wall;
    textures.crate = crate;
    textureVariants.floor = makeVariants(floor, 4, 256);
    textureVariants.wall = makeVariants(wall, 4, 256);
    textureVariants.crate = makeVariants(crate, 2, 128);
  }

  // --------------------------------------------------------------------- audio
  let actx = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    return actx;
  }
  function blip(freq, dur, type = "sine", vol = 0.16, slide = 0) {
    const ac = audio();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ac.currentTime + dur);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur + 0.02);
  }
  function noiseBurst(dur = 0.18, vol = 0.2) {
    const ac = audio();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = ac.createBufferSource();
    const g = ac.createGain();
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1400;
    src.buffer = buf;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(ac.destination);
    src.start();
  }

  // ---------------------------------------------------------------------- state
  let world = null;
  let player = null;
  let camera = { x: 0, y: 0, shake: 0 };
  let particles = [];
  let state = "menu"; // menu | playing | paused | dead | won
  let time = 0;
  let view = { w: window.innerWidth, h: window.innerHeight, dpr: 1 };

  const keys = new Set();
  const touchInput = { x: 0, y: 0 };

  // -------------------------------------------------------------------- dungeon
  // Generation lives in src/dungeon.js so it can be unit tested headless.
  function generateDungeon(rng) {
    return Dungeon.generate(rng);
  }

  const idx = (x, y) => y * MAP_W + x;
  const isWall = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
    return world.map[idx(tx, ty)] === 1;
  };
  const isWallAt = (px, py) => isWall(Math.floor(px / TILE), Math.floor(py / TILE));

  // ------------------------------------------------------------- prerender map
  let mapCanvas = null;

  function buildMapCanvas(rng) {
    const c = document.createElement("canvas");
    c.width = MAP_W * TILE;
    c.height = MAP_H * TILE;
    const g = c.getContext("2d");

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const wall = isWall(x, y);
        const px = x * TILE;
        const py = y * TILE;
        const set = wall ? textureVariants.wall : textureVariants.floor;
        const variant = set[Math.floor(rng() * set.length)];
        g.drawImage(variant, px, py, TILE, TILE);

        // per-tile tonal variation so the grid does not look mechanical
        const shade = wall ? rng() * 0.16 : rng() * 0.13;
        if (shade > 0.02) {
          g.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
          g.fillRect(px, py, TILE, TILE);
        }
        if (!wall) {
          // give floors a subtle blue cast so the warm torch reads stronger
          g.fillStyle = "rgba(24,44,66,0.10)";
          g.fillRect(px, py, TILE, TILE);
        }
      }
    }

    // fake ambient occlusion where walls meet floors
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (isWall(x, y)) continue;
        const px = x * TILE;
        const py = y * TILE;
        const grad = (x0, y0, x1, y1) => {
          const gr = g.createLinearGradient(x0, y0, x1, y1);
          gr.addColorStop(0, "rgba(0,0,0,0.5)");
          gr.addColorStop(1, "rgba(0,0,0,0)");
          return gr;
        };
        if (isWall(x, y - 1)) { g.fillStyle = grad(0, py, 0, py + 22); g.fillRect(px, py, TILE, 22); }
        if (isWall(x, y + 1)) { g.fillStyle = grad(0, py + TILE, 0, py + TILE - 22); g.fillRect(px, py + TILE - 22, TILE, 22); }
        if (isWall(x - 1, y)) { g.fillStyle = grad(px, 0, px + 22, 0); g.fillRect(px, py, 22, TILE); }
        if (isWall(x + 1, y)) { g.fillStyle = grad(px + TILE, 0, px + TILE - 22, 0); g.fillRect(px + TILE - 22, py, 22, TILE); }
      }
    }

    return c;
  }

  // ------------------------------------------------------------------ particles
  function spawnParticle(x, y, opts = {}) {
    particles.push({
      x, y,
      vx: opts.vx ?? (Math.random() - 0.5) * 40,
      vy: opts.vy ?? (Math.random() - 0.5) * 40,
      life: opts.life ?? 0.6,
      maxLife: opts.life ?? 0.6,
      size: opts.size ?? 2.5,
      color: opts.color ?? "rgba(200,230,255,1)",
      drag: opts.drag ?? 2.2,
      gravity: opts.gravity ?? 0,
      glow: opts.glow ?? false,
    });
  }

  function burst(x, y, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (opts.speed ?? 90) * (0.35 + Math.random() * 0.85);
      spawnParticle(x, y, {
        ...opts,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: (opts.life ?? 0.7) * (0.6 + Math.random() * 0.7),
        size: (opts.size ?? 3) * (0.6 + Math.random() * 0.8),
      });
    }
  }

  // ------------------------------------------------------------------ new world
  function newGame() {
    const seed = (Math.random() * 1e9) | 0;
    const rng = mulberry32(seed);
    world = generateDungeon(rng);
    world.rng = rng;
    mapCanvas = buildMapCanvas(rng);

    const rooms = world.rooms;
    const center = (r) => ({ x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE });

    // start room = first, goal room = farthest from start
    const startRoom = rooms[0];
    const start = center(startRoom);
    let goalRoom = rooms[rooms.length - 1];
    let best = -1;
    for (const r of rooms) {
      const c = center(r);
      const d = dist2(c.x, c.y, start.x, start.y);
      if (d > best) { best = d; goalRoom = r; }
    }

    player = {
      x: start.x, y: start.y,
      vx: 0, vy: 0,
      hp: 100, maxHp: 100,
      dir: 1,
      facing: { x: 0, y: 1 },
      dashT: 0, dashCd: 0,
      iframes: 0,
      hurtFlash: 0,
      stepT: 0,
    };

    // runes in rooms far from the start, one per room
    const candidates = rooms
      .filter((r) => r !== startRoom && r !== goalRoom)
      .sort(() => rng() - 0.5);
    const runes = [];
    for (const room of candidates) {
      if (runes.length >= RUNES_TOTAL) break;
      const rx = (room.x + 1 + rng() * (room.w - 2)) * TILE;
      const ry = (room.y + 1 + rng() * (room.h - 2)) * TILE;
      if (isWallAt(rx, ry)) continue;
      if (runes.some((r) => dist2(r.x, r.y, rx, ry) < (TILE * 8) ** 2)) continue;
      runes.push({ x: rx, y: ry, taken: false, phase: rng() * Math.PI * 2 });
    }

    // crates: destructible cover scattered through the rooms
    const crates = [];
    for (let i = 0; i < 26; i++) {
      const room = rooms[Math.floor(rng() * rooms.length)];
      const cx = (room.x + 0.8 + rng() * (room.w - 1.6)) * TILE;
      const cy = (room.y + 0.8 + rng() * (room.h - 1.6)) * TILE;
      if (isWallAt(cx, cy)) continue;
      if (dist2(cx, cy, start.x, start.y) < (TILE * 3) ** 2) continue;
      if (crates.some((c) => dist2(c.x, c.y, cx, cy) < (TILE * 0.9) ** 2)) continue;
      if (runes.some((r) => dist2(r.x, r.y, cx, cy) < (TILE * 0.9) ** 2)) continue;
      const gc = center(goalRoom);
      if (dist2(cx, cy, gc.x, gc.y) < (TILE * 2) ** 2) continue;
      crates.push({ x: cx, y: cy, size: 46, hp: 2, hitT: 0 });
    }

    // wraiths haunt the far rooms
    const wraiths = [];
    for (let i = 0; i < 7; i++) {
      const room = rooms[1 + Math.floor(rng() * (rooms.length - 1))];
      const wx = (room.x + 0.7 + rng() * (room.w - 1.4)) * TILE;
      const wy = (room.y + 0.7 + rng() * (room.h - 1.4)) * TILE;
      if (dist2(wx, wy, start.x, start.y) < (TILE * 6) ** 2) continue;
      wraiths.push({
        x: wx, y: wy, vx: 0, vy: 0,
        phase: rng() * Math.PI * 2,
        stunned: 0, cooldown: 0,
      });
    }

    const goal = center(goalRoom);
    world.runes = runes;
    world.crates = crates;
    world.wraiths = wraiths;
    world.portal = { x: goal.x, y: goal.y, open: false, rot: 0 };
    world.collected = 0;

    camera.x = clamp(player.x - view.w / 2, 0, Math.max(0, MAP_W * TILE - view.w));
    camera.y = clamp(player.y - view.h / 2, 0, Math.max(0, MAP_H * TILE - view.h));

    particles = [];
    time = 0;
    updateHud();
  }

  // -------------------------------------------------------------------- physics
  function moveWithCollision(ent, r, nx, ny) {
    // axis-separated resolution against the tile grid
    const tryAxis = (px, py) => {
      const minX = Math.floor((px - r) / TILE);
      const maxX = Math.floor((px + r) / TILE);
      const minY = Math.floor((py - r) / TILE);
      const maxY = Math.floor((py + r) / TILE);
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (!isWall(tx, ty)) continue;
          const cx = clamp(px, tx * TILE, tx * TILE + TILE);
          const cy = clamp(py, ty * TILE, ty * TILE + TILE);
          if ((px - cx) ** 2 + (py - cy) ** 2 < r * r) return true;
        }
      }
      return false;
    };
    if (!tryAxis(nx, ent.y)) ent.x = nx;
    if (!tryAxis(ent.x, ny)) ent.y = ny;
  }

  // ---------------------------------------------------------------------- input
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    keys.add(k);
    if (k === "p" && (state === "playing" || state === "paused")) togglePause();
    if (k === " " && state === "playing") tryDash();
    if (k === "enter" && (state === "won" || state === "dead")) restart();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  function tryDash() {
    if (!player || player.dashCd > 0) return;
    player.dashT = 0.16;
    player.dashCd = 1.1;
    player.iframes = 0.3;
    blip(180, 0.16, "triangle", 0.09, 260);
    burst(player.x, player.y, 10, { speed: 60, size: 2, life: 0.4, color: "rgba(120,200,240,0.9)" });
  }

  // touch controls
  if (isTouch) {
    ui.touch.classList.remove("hidden");
    let stickId = null;
    const rect = () => ui.stick.getBoundingClientRect();
    const setKnob = (dx, dy) => {
      ui.knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
    };
    ui.stick.addEventListener("pointerdown", (e) => {
      stickId = e.pointerId;
      ui.stick.setPointerCapture(e.pointerId);
    });
    ui.stick.addEventListener("pointermove", (e) => {
      if (e.pointerId !== stickId) return;
      const r = rect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      touchInput.x = dx;
      touchInput.y = dy;
      setKnob(dx, dy);
    });
    const endStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      touchInput.x = touchInput.y = 0;
      setKnob(0, 0);
    };
    ui.stick.addEventListener("pointerup", endStick);
    ui.stick.addEventListener("pointercancel", endStick);
    ui.dashBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); if (state === "playing") tryDash(); });
  }

  // ------------------------------------------------------------------- update
  function update(dt) {
    time += dt;

    // --- player -------------------------------------------------------------
    let ix = 0, iy = 0;
    if (keys.has("w") || keys.has("arrowup")) iy -= 1;
    if (keys.has("s") || keys.has("arrowdown")) iy += 1;
    if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
    if (keys.has("d") || keys.has("arrowright")) ix += 1;
    ix += touchInput.x;
    iy += touchInput.y;
    const ilen = Math.hypot(ix, iy);
    if (ilen > 1) { ix /= ilen; iy /= ilen; }

    if (player.dashT > 0) player.dashT -= dt;
    if (player.dashCd > 0) player.dashCd -= dt;
    if (player.iframes > 0) player.iframes -= dt;
    if (player.hurtFlash > 0) player.hurtFlash -= dt * 2.4;

    const speed = player.dashT > 0 ? 520 : 205;
    const accel = player.dashT > 0 ? 40 : 16;
    const targetVx = (player.dashT > 0 ? player.facing.x : ix) * speed;
    const targetVy = (player.dashT > 0 ? player.facing.y : iy) * speed;
    player.vx = lerp(player.vx, targetVx, clamp(accel * dt, 0, 1));
    player.vy = lerp(player.vy, targetVy, clamp(accel * dt, 0, 1));

    if (ilen > 0.05) {
      player.facing.x = ix / (ilen || 1);
      player.facing.y = iy / (ilen || 1);
      if (Math.abs(ix) > 0.15) player.dir = ix > 0 ? 1 : -1;
    }

    moveWithCollision(player, PLAYER_R, player.x + player.vx * dt, player.y + player.vy * dt);

    // footstep dust
    const moving = Math.hypot(player.vx, player.vy) > 40;
    if (moving) {
      player.stepT -= dt;
      if (player.stepT <= 0) {
        player.stepT = player.dashT > 0 ? 0.03 : 0.13;
        spawnParticle(player.x + (Math.random() - 0.5) * 12, player.y + 10, {
          vx: -player.vx * 0.08 + (Math.random() - 0.5) * 22,
          vy: -player.vy * 0.08 - Math.random() * 14,
          life: 0.55, size: 2.2 + Math.random() * 2,
          color: "rgba(150,170,190,0.5)", drag: 3,
        });
      }
    }

    // --- crates -------------------------------------------------------------
    for (const c of world.crates) {
      if (c.dead) continue;
      if (c.hitT > 0) c.hitT -= dt;
      // walking into a crate nudges it apart after a short dash hit
      const d = Math.hypot(player.x - c.x, player.y - c.y);
      if (player.dashT > 0 && d < c.size * 0.62 + PLAYER_R) {
        c.hp -= 1;
        c.hitT = 0.16;
        camera.shake = Math.max(camera.shake, 4);
        noiseBurst(0.12, 0.13);
        burst(c.x, c.y, 12, {
          speed: 120, size: 3, life: 0.6,
          color: "rgba(255,190,120,0.95)", glow: true,
        });
        if (c.hp <= 0) {
          c.dead = true;
          burst(c.x, c.y, 22, { speed: 170, size: 4, life: 0.9, color: "rgba(190,140,90,0.95)" });
          if (Math.random() < 0.45) healPlayer(6);
        }
      } else if (d < c.size * 0.5 + PLAYER_R) {
        // soft push-out so crates block movement
        const a = Math.atan2(player.y - c.y, player.x - c.x);
        const push = (c.size * 0.5 + PLAYER_R - d) * 0.55;
        moveWithCollision(player, PLAYER_R, player.x + Math.cos(a) * push, player.y + Math.sin(a) * push);
      }
    }

    // --- runes --------------------------------------------------------------
    for (const r of world.runes) {
      if (r.taken) continue;
      if (dist2(player.x, player.y, r.x, r.y) < (PLAYER_R + 22) ** 2) {
        r.taken = true;
        world.collected++;
        blip(660, 0.16, "sine", 0.14, 220);
        setTimeout(() => blip(990, 0.22, "sine", 0.1), 90);
        burst(r.x, r.y, 26, { speed: 130, size: 3, life: 0.9, color: "rgba(120,240,255,0.95)", glow: true });
        updateHud();
        if (world.collected >= RUNES_TOTAL) {
          world.portal.open = true;
          toast("Alle Runen! Das Portal ist geöffnet.");
          blip(320, 0.5, "sawtooth", 0.1, 220);
        } else {
          toast(`Rune aufgenommen — ${world.collected} / ${RUNES_TOTAL}`);
        }
      }
    }

    // --- portal -------------------------------------------------------------
    world.portal.rot += dt * (world.portal.open ? 1.6 : 0.3);
    if (world.portal.open && dist2(player.x, player.y, world.portal.x, world.portal.y) < 40 ** 2) {
      win();
      return;
    }

    // --- wraiths ------------------------------------------------------------
    for (const w of world.wraiths) {
      if (w.stunned > 0) { w.stunned -= dt; w.x += w.vx * dt; w.y += w.vy * dt; w.vx *= 0.94; w.vy *= 0.94; continue; }
      if (w.cooldown > 0) w.cooldown -= dt;
      const d = Math.hypot(player.x - w.x, player.y - w.y);
      if (d < 560) {
        const a = Math.atan2(player.y - w.y, player.x - w.x);
        const sp = 68 + Math.sin(time * 2 + w.phase) * 10;
        w.vx = lerp(w.vx, Math.cos(a) * sp, dt * 2.2);
        w.vy = lerp(w.vy, Math.sin(a) * sp, dt * 2.2);
      } else {
        w.vx = lerp(w.vx, Math.cos(time * 0.7 + w.phase) * 14, dt);
        w.vy = lerp(w.vy, Math.sin(time * 0.9 + w.phase) * 14, dt);
      }
      moveWithCollision(w, 16, w.x + w.vx * dt, w.y + w.vy * dt);

      if (d < 30 && player.iframes <= 0) {
        damage(14);
        player.iframes = 0.85;
        const a = Math.atan2(player.y - w.y, player.x - w.x);
        player.vx = Math.cos(a) * 260;
        player.vy = Math.sin(a) * 260;
        w.x -= Math.cos(a) * 26;
        w.y -= Math.sin(a) * 26;
        w.vx = -Math.cos(a) * 130;
        w.vy = -Math.sin(a) * 130;
        w.stunned = 0.45;
      }

      // dashing through a wraith banishes it for a moment
      if (player.dashT > 0 && d < 34 && w.stunned <= 0) {
        w.stunned = 2.2;
        const a = Math.atan2(w.y - player.y, w.x - player.x);
        w.vx = Math.cos(a) * 340;
        w.vy = Math.sin(a) * 340;
        burst(w.x, w.y, 16, { speed: 130, size: 3, life: 0.6, color: "rgba(190,150,255,0.9)", glow: true });
        blip(420, 0.2, "square", 0.08, -180);
        toast("Schatten gebannt");
      }

      if (w.cooldown <= 0 && Math.random() < dt * 0.7) {
        w.cooldown = 2 + Math.random() * 3;
        spawnParticle(w.x, w.y - 8, {
          vx: (Math.random() - 0.5) * 12, vy: -18 - Math.random() * 12,
          life: 1.4, size: 2.4, color: "rgba(160,140,230,0.55)", drag: 0.6,
        });
      }
    }

    // --- particles ----------------------------------------------------------
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vx *= 1 - p.drag * dt;
      p.vy = p.vy * (1 - p.drag * dt) + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // --- camera -------------------------------------------------------------
    const targetX = clamp(player.x - view.w / 2, 0, Math.max(0, MAP_W * TILE - view.w));
    const targetY = clamp(player.y - view.h / 2, 0, Math.max(0, MAP_H * TILE - view.h));
    camera.x = lerp(camera.x, targetX, clamp(dt * 7, 0, 1));
    camera.y = lerp(camera.y, targetY, clamp(dt * 7, 0, 1));
    if (camera.shake > 0) camera.shake = Math.max(0, camera.shake - dt * 22);
  }

  function healPlayer(n) {
    player.hp = Math.min(player.maxHp, player.hp + n);
    updateHud();
    burst(player.x, player.y, 8, { speed: 60, size: 2, life: 0.7, color: "rgba(120,255,180,0.9)", glow: true });
  }

  function damage(n) {
    player.hp -= n;
    player.hurtFlash = 1;
    camera.shake = Math.max(camera.shake, 9);
    noiseBurst(0.22, 0.22);
    blip(110, 0.24, "square", 0.12, -60);
    updateHud();
    if (player.hp <= 0) {
      player.hp = 0;
      updateHud();
      die();
    }
  }

  // ------------------------------------------------------------------- drawing
  function draw() {
    const { w, h, dpr } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const shakeX = (Math.random() - 0.5) * camera.shake;
    const shakeY = (Math.random() - 0.5) * camera.shake;
    const camX = Math.round(camera.x + shakeX);
    const camY = Math.round(camera.y + shakeY);

    // --- ground -------------------------------------------------------------
    const srcW = Math.min(w, mapCanvas.width - camX);
    const srcH = Math.min(h, mapCanvas.height - camY);
    ctx.fillStyle = "#06080c";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(mapCanvas, camX, camY, srcW, srcH, 0, 0, srcW, srcH);

    ctx.save();
    ctx.translate(-camX, -camY);

    // --- portal -------------------------------------------------------------
    const p = world.portal;
    if (p.open) {
      const t = time;
      ctx.save();
      ctx.translate(p.x, p.y);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${120 + i * 30},${220 - i * 40},255,${0.75 - i * 0.18})`;
        ctx.lineWidth = 3 - i * 0.6;
        const r = 30 + i * 9 + Math.sin(t * 2 + i) * 3;
        ctx.arc(0, 0, r, t * (1.4 + i * 0.3), t * (1.4 + i * 0.3) + Math.PI * 1.4);
        ctx.stroke();
      }
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 46);
      g.addColorStop(0, "rgba(190,250,255,0.95)");
      g.addColorStop(0.45, "rgba(90,200,255,0.45)");
      g.addColorStop(1, "rgba(60,120,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "rgba(110,140,170,0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // --- crates -------------------------------------------------------------
    for (const c of world.crates) {
      if (c.dead) continue;
      const s = c.size;
      ctx.save();
      ctx.translate(c.x, c.y);
      // contact shadow
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.ellipse(0, s * 0.42, s * 0.5, s * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      // top
      const tex = textureVariants.crate[0];
      ctx.drawImage(tex, -s / 2, -s / 2, s, s);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      // bevel
      ctx.strokeStyle = "rgba(255,225,190,0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(-s / 2 + 1.5, -s / 2 + 1.5, s - 3, s - 3);
      if (c.hitT > 0) {
        ctx.fillStyle = `rgba(255,220,170,${c.hitT * 3})`;
        ctx.fillRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();
    }

    // --- runes --------------------------------------------------------------
    for (const r of world.runes) {
      if (r.taken) continue;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + r.phase);
      const bob = Math.sin(time * 2 + r.phase) * 3;
      ctx.save();
      ctx.translate(r.x, r.y + bob);

      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 42 + pulse * 10);
      g.addColorStop(0, `rgba(150,250,255,${0.35 + pulse * 0.25})`);
      g.addColorStop(1, "rgba(80,200,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 46, 0, Math.PI * 2);
      ctx.fill();

      ctx.rotate(time * 1.1 + r.phase);
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(11, 0);
      ctx.lineTo(0, 15);
      ctx.lineTo(-11, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(200,255,255,${0.85 + pulse * 0.15})`;
      ctx.shadowColor = "rgba(120,240,255,0.95)";
      ctx.shadowBlur = 24;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(40,140,190,0.9)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // rune glyph
      ctx.rotate(-time * 1.1 - r.phase);
      ctx.strokeStyle = "rgba(30,120,170,0.85)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-4, 5); ctx.lineTo(2, -5); ctx.lineTo(4, 0); ctx.lineTo(-2, 0);
      ctx.stroke();
      ctx.restore();
    }

    // --- wraiths ------------------------------------------------------------
    for (const w of world.wraiths) {
      const bob = Math.sin(time * 2.4 + w.phase) * 4;
      const alpha = w.stunned > 0 ? 0.28 : 0.85;
      ctx.save();
      ctx.translate(w.x, w.y + bob);

      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(0, 20, 15, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      const g = ctx.createRadialGradient(0, -2, 2, 0, 0, 30);
      g.addColorStop(0, `rgba(180,160,255,${alpha})`);
      g.addColorStop(0.55, `rgba(105,85,190,${alpha * 0.55})`);
      g.addColorStop(1, "rgba(60,50,120,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fill();

      // tattered hem
      ctx.beginPath();
      ctx.moveTo(-14, 4);
      for (let i = 0; i <= 6; i++) {
        const xx = -14 + (i * 28) / 6;
        const yy = 14 + Math.sin(time * 4 + i * 1.7 + w.phase) * 4;
        ctx.lineTo(xx, yy);
      }
      ctx.lineTo(14, 4);
      ctx.closePath();
      ctx.fillStyle = `rgba(90,75,165,${alpha * 0.5})`;
      ctx.fill();

      // eyes
      ctx.fillStyle = `rgba(160,245,255,${alpha})`;
      ctx.shadowColor = "rgba(120,240,255,0.9)";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(-6, -5, 3, 2.2, 0, 0, Math.PI * 2);
      ctx.ellipse(6, -5, 3, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // --- player -------------------------------------------------------------
    drawPlayer();

    // --- particles ----------------------------------------------------------
    for (const p of particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 14;
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    if (state === "playing" || state === "paused" || state === "dead") drawLighting(camX, camY);
    else drawLighting(camX, camY, 0.82);
  }

  function drawPlayer() {
    const p = player;
    ctx.save();
    ctx.translate(p.x, p.y);

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(0, 13, 15, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // dash trail
    if (p.dashT > 0) {
      ctx.globalAlpha = 0.35;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(-p.facing.x * i * 9, -p.facing.y * i * 9, 13 - i * 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(120,225,255,0.35)";
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // cloak
    const g = ctx.createRadialGradient(-4, -6, 2, 0, 0, 20);
    g.addColorStop(0, "#3b4d61");
    g.addColorStop(0.65, "#243040");
    g.addColorStop(1, "#141c26");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(140,190,220,0.45)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // hood / head with direction bias
    ctx.fillStyle = "#2c3a4a";
    ctx.beginPath();
    ctx.arc(p.facing.x * 2.5, -3 + p.facing.y * 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#18212c";
    ctx.beginPath();
    ctx.arc(p.facing.x * 3.5, -2 + p.facing.y * 2.5, 6, 0, Math.PI * 2);
    ctx.fill();

    // rune pendant glow
    const pulse = 0.6 + 0.4 * Math.sin(time * 4);
    ctx.shadowColor = "rgba(79,240,255,0.95)";
    ctx.shadowBlur = 16 * pulse;
    ctx.fillStyle = `rgba(150,250,255,${0.75 + pulse * 0.25})`;
    ctx.beginPath();
    ctx.arc(0, 4, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // hurt flash
    if (p.hurtFlash > 0) {
      ctx.globalAlpha = clamp(p.hurtFlash, 0, 1) * 0.65;
      ctx.fillStyle = "#ff5f5f";
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawLighting(camX, camY, darkness = 0.94) {
    const w = view.w;
    const h = view.h;
    if (lightCanvas.width !== w || lightCanvas.height !== h) {
      lightCanvas.width = w;
      lightCanvas.height = h;
    }

    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, w, h);
    lctx.fillStyle = `rgba(3,6,11,${darkness})`;
    lctx.fillRect(0, 0, w, h);

    // punch soft holes in the darkness
    lctx.globalCompositeOperation = "destination-out";
    const punch = (sx, sy, radius, strength) => {
      const g = lctx.createRadialGradient(sx, sy, radius * 0.08, sx, sy, radius);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.45, `rgba(0,0,0,${strength * 0.72})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      lctx.fillStyle = g;
      lctx.beginPath();
      lctx.arc(sx, sy, radius, 0, Math.PI * 2);
      lctx.fill();
    };

    const flicker = 0.92 + Math.sin(time * 9.3) * 0.03 + Math.sin(time * 3.1) * 0.05;
    punch(player.x - camX, player.y - camY, 250 * flicker, 1);

    for (const r of world.runes) {
      if (r.taken) continue;
      punch(r.x - camX, r.y - camY, 95, 0.8);
    }
    for (const w of world.wraiths) punch(w.x - camX, w.y - camY, 70, w.stunned > 0 ? 0.25 : 0.5);
    if (world.portal.open) punch(world.portal.x - camX, world.portal.y - camY, 190, 0.95);

    lctx.globalCompositeOperation = "source-over";
    lctx.globalAlpha = 1;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lightCanvas, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // warm torch tint, additive on top of the darkness
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const tx = player.x - camX;
    const ty = player.y - camY;
    const warm = ctx.createRadialGradient(tx, ty, 10, tx, ty, 240 * flicker);
    warm.addColorStop(0, "rgba(255,186,110,0.20)");
    warm.addColorStop(0.4, "rgba(255,150,80,0.09)");
    warm.addColorStop(1, "rgba(255,120,60,0)");
    ctx.fillStyle = warm;
    ctx.beginPath();
    ctx.arc(tx, ty, 250 * flicker, 0, Math.PI * 2);
    ctx.fill();

    if (world.portal.open) {
      const px = world.portal.x - camX;
      const py = world.portal.y - camY;
      const pg = ctx.createRadialGradient(px, py, 4, px, py, 170);
      pg.addColorStop(0, "rgba(120,220,255,0.28)");
      pg.addColorStop(1, "rgba(80,160,255,0)");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(px, py, 170, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // vignette
    ctx.save();
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.78);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // ---------------------------------------------------------------------- HUD
  function updateHud() {
    ui.hp.style.width = `${clamp((player.hp / player.maxHp) * 100, 0, 100)}%`;
    ui.runes.textContent = `${world.collected} / ${RUNES_TOTAL} Runen`;
  }

  let toastTimer = null;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2200);
  }

  // -------------------------------------------------------------- state switch
  function start() {
    audio();
    newGame();
    state = "playing";
    ui.overlay.classList.add("fade");
    setTimeout(() => ui.overlay.classList.add("hidden"), 420);
    ui.hud.classList.remove("hidden");
    updateHud();
    toast("Finde 5 Runen im Verlies");
  }

  function restart() {
    ui.overlay.classList.add("hidden");
    start();
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      showPanel({
        title: "Pause",
        sub: "Das Verlies wartet.",
        desc: "Bewege dich mit WASD oder den Pfeiltasten. Leertaste lässt dich ausweichen — durch einen Schatten hindurch bannt ihn für kurze Zeit.",
        button: "Weiter",
        action: () => {
          state = "playing";
          hidePanel();
        },
      });
    } else if (state === "paused") {
      state = "playing";
      hidePanel();
    }
  }

  function hidePanel() {
    ui.overlay.classList.add("fade");
    setTimeout(() => ui.overlay.classList.add("hidden"), 400);
  }

  function showPanel({ title, sub, desc, button, action }) {
    ui.overlay.classList.remove("hidden", "fade");
    ui.overlay.innerHTML = `
      <div class="panel">
        <img class="title-portrait" src="assets/hero.jpg" alt="">
        <h1>${title}</h1>
        <p class="sub">${sub}</p>
        <p class="desc">${desc}</p>
        <button id="panel-btn">${button}</button>
      </div>`;
    document.getElementById("panel-btn").addEventListener("click", action);
  }

  function die() {
    state = "dead";
    noiseBurst(0.6, 0.25);
    showPanel({
      title: "Gefallen",
      sub: "Die Schatten waren schneller.",
      desc: "Neuer Versuch? Das Verlies wird jedes Mal neu generiert — andere Räume, andere Runenplätze.",
      button: "Nochmal",
      action: restart,
    });
  }

  function win() {
    state = "won";
    blip(520, 0.14, "sine", 0.12, 200);
    setTimeout(() => blip(780, 0.16, "sine", 0.12, 220), 130);
    setTimeout(() => blip(1040, 0.5, "sine", 0.12, 120), 270);
    burst(player.x, player.y, 40, { speed: 200, size: 3.5, life: 1.4, color: "rgba(150,245,255,0.95)", glow: true });
    showPanel({
      title: "Entkommen",
      sub: "Alle fünf Runen leuchten im Portal.",
      desc: "Dieses Verlies besteht aus vier KI-generierten Texturen plus prozeduralem Canvas-Code — keine Fremd-Assets, keine Lizenzfragen.",
      button: "Neues Verlies",
      action: restart,
    });
  }

  // ----------------------------------------------------------------- main loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === "playing") update(dt);
    else if (state === "menu") time += dt;
    draw();
    requestAnimationFrame(frame);
  }

  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.floor(view.w * view.dpr);
    canvas.height = Math.floor(view.h * view.dpr);
    canvas.style.width = view.w + "px";
    canvas.style.height = view.h + "px";
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  // ------------------------------------------------------------------- startup
  document.getElementById("start").addEventListener("click", start);

  resize();
  loadAssets()
    .then(() => {
      newGame();
      requestAnimationFrame(frame);
    })
    .catch((err) => {
      ui.overlay.innerHTML = `<div class="panel"><h1>Assets fehlen</h1>
        <p class="desc">${err.message}<br><br>Führe <code>python3 tools/prep_assets.py</code> aus.</p></div>`;
    });
})();
