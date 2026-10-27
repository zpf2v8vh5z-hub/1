/* Dungeon generation, kept DOM-free so it can be unit tested in Node.
   Attaches `Dungeon` to globalThis. */
(function (root) {
  "use strict";

  const MAP_W = 52;
  const MAP_H = 38;

  function rectsClose(a, b, pad) {
    return (
      a.x - pad < b.x + b.w &&
      a.x + a.w + pad > b.x &&
      a.y - pad < b.y + b.h &&
      a.y + a.h + pad > b.y
    );
  }

  function generate(rng) {
    const map = new Uint8Array(MAP_W * MAP_H).fill(1);
    const rooms = [];

    for (let i = 0; i < 260 && rooms.length < 15; i++) {
      const w = 4 + Math.floor(rng() * 7);
      const h = 4 + Math.floor(rng() * 6);
      const x = 2 + Math.floor(rng() * (MAP_W - w - 4));
      const y = 2 + Math.floor(rng() * (MAP_H - h - 4));
      const room = { x, y, w, h };
      if (rooms.some((o) => rectsClose(room, o, 2))) continue;
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) map[yy * MAP_W + xx] = 0;
      }
      rooms.push(room);
    }

    const center = (r) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) });

    function carveH(x1, x2, y) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        map[y * MAP_W + x] = 0;
        if (y + 1 < MAP_H) map[(y + 1) * MAP_W + x] = 0;
      }
    }
    function carveV(y1, y2, x) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        map[y * MAP_W + x] = 0;
        if (x + 1 < MAP_W) map[y * MAP_W + x + 1] = 0;
      }
    }

    // connect each room to the previous one -> spanning path, everything reachable
    for (let i = 1; i < rooms.length; i++) {
      const a = center(rooms[i - 1]);
      const b = center(rooms[i]);
      if (rng() > 0.5) { carveH(a.x, b.x, a.y); carveV(a.y, b.y, b.x); }
      else { carveV(a.y, b.y, a.x); carveH(a.x, b.x, b.y); }
    }

    return { map, rooms, center };
  }

  function reachableFloor(map, startX, startY) {
    const seen = new Set();
    const stack = [[startX, startY]];
    const key = (x, y) => y * MAP_W + x;
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      if (map[key(x, y)] === 1) continue;
      if (seen.has(key(x, y))) continue;
      seen.add(key(x, y));
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return seen;
  }

  function totalFloor(map) {
    let n = 0;
    for (let i = 0; i < map.length; i++) if (map[i] === 0) n++;
    return n;
  }

  root.Dungeon = { MAP_W, MAP_H, generate, reachableFloor, totalFloor, rectsClose };
})(typeof globalThis !== "undefined" ? globalThis : this);
