/**
 * City plan: the street grid and what is built on every block.
 *
 * Coordinate reminder (see world.js): +Z is "up the boulevard" towards the sun,
 * +X is INLAND (behind the art-déco hotel row) and -X is the ocean promenade.
 * So the district grid lives at positive X, and Ocean Drive itself (x = 0) is its
 * western edge — that keeps the hero shot of the boulevard exactly as it was.
 */

export const GRID = {
  // avenue centre lines, west -> east. 0 = Ocean Drive (already built by world.js)
  avenues: [0, 170, 330, 490, 650],   // Ocean Drive + 4 district avenues
  avenueHalf: 7.6,          // carriageway half width (2 lanes each way)
  avenueSidewalk: 3.6,      // sidewalk strip on each side of an avenue

  // east-west cross streets, south -> north
  crossZ0: 200,
  crossZ1: 2000,
  crossCount: 13,           // 13 streets -> 12 block rows
  crossHalf: 6.4,
  crossSidewalk: 3.2,

  // the ring road around the whole district
  ring: { zA: 110, zB: 2090, xEast: 750, half: 8.4 },

  // fence / field border, outside the ring road
  border: { xEast: 806, zA: 58, zB: 2142 },

  lotInset: 2.4,            // clearance between road edge and lots

  // openings in the art-déco hotel row: these cross streets connect Ocean Drive
  // to the district. world.js leaves a gap in the hotel row here.
  gates: [500, 1100, 1700],
  gateHalf: 14,

  // the art-déco hotel row already occupies x 16.5 … ~58 along Ocean Drive, so the
  // first cell of the grid starts behind it
  firstCellInset: 62,
};

/** Cross-street centre positions along Z. */
export function crossStreets() {
  const out = [];
  const step = (GRID.crossZ1 - GRID.crossZ0) / (GRID.crossCount - 1);
  for (let i = 0; i < GRID.crossCount; i++) out.push(GRID.crossZ0 + i * step);
  return out;
}

/**
 * Block usage. `w` = weight for the random pick.
 *  col: how the block is filled
 *    row   – a row of buildings facing each street
 *    park  – green with paths, trees, benches
 *    pad   – paved plaza with a landmark in the middle
 *    paved – fully paved (parking, market, forecourt)
 */
export const BLOCK_KINDS = [
  // residential / mixed seaside blocks
  { id: 'deco', weight: 8, label: 'Art-déco Wohnblock', col: 'row', style: 'deco', h: [9, 22] },
  { id: 'brick', weight: 5, label: 'Apartmentblock', col: 'row', style: 'brick', h: [10, 26] },
  { id: 'modern', weight: 3, label: 'Wohnhochhaus', col: 'row', style: 'modern', h: [26, 54] },
  { id: 'shops', weight: 6, label: 'Läden & Wohnen', col: 'row', style: 'shops', h: [8, 16] },
  { id: 'office', weight: 4, label: 'Bürohaus', col: 'row', style: 'office', h: [16, 38] },

  // public / civic
  { id: 'park', weight: 9, label: 'Park', col: 'park' },
  { id: 'playground', weight: 5, label: 'Spielplatz', col: 'park', feature: 'playground' },
  { id: 'plaza', weight: 6, label: 'Platz mit Brunnen', col: 'pad', feature: 'fountain' },
  { id: 'school', weight: 3, label: 'Schule', col: 'pad', feature: 'school' },
  { id: 'hospital', weight: 2, label: 'Krankenhaus', col: 'pad', feature: 'hospital' },
  { id: 'police', weight: 2, label: 'Polizei', col: 'pad', feature: 'police' },
  { id: 'fire', weight: 2, label: 'Feuerwehr', col: 'pad', feature: 'fire' },
  { id: 'church', weight: 2, label: 'Kirche', col: 'pad', feature: 'church' },
  { id: 'cinema', weight: 2, label: 'Kino', col: 'pad', feature: 'cinema' },
  { id: 'market', weight: 3, label: 'Marktplatz', col: 'paved', feature: 'market' },
  { id: 'sports', weight: 3, label: 'Sportplatz', col: 'park', feature: 'sports' },
  { id: 'gas', weight: 4, label: 'Tankstelle', col: 'paved', feature: 'gas' },
  { id: 'parking', weight: 4, label: 'Parkplatz', col: 'paved', feature: 'parking' },
];

/**
 * Deterministic pick of a block kind. Public buildings are unique: once used they
 * drop out of the pool (a city has one hospital, one church, …).
 */
export function makeBlockPicker(rng) {
  const used = new Set();
  const unique = new Set(['school', 'hospital', 'police', 'fire', 'church', 'cinema', 'sports', 'market']);
  return function pick() {
    const pool = BLOCK_KINDS.filter((k) => !(unique.has(k.id) && used.has(k.id)));
    let total = 0;
    for (const k of pool) total += k.weight;
    let r = rng() * total;
    for (const k of pool) {
      r -= k.weight;
      if (r <= 0) {
        if (unique.has(k.id)) used.add(k.id);
        return k;
      }
    }
    return pool[pool.length - 1];
  };
}

/**
 * Plan `count` blocks: every unique civic building gets a guaranteed slot,
 * spread out over the district, and the rest is filled by weighted picks.
 */
export function planBlocks(rng, count) {
  const uniques = BLOCK_KINDS.filter((k) => k.feature && ['school', 'hospital', 'police', 'fire',
    'church', 'cinema', 'sports', 'market'].includes(k.id));
  const slots = new Array(count).fill(null);

  // spread the civic buildings: prefer the middle of the district, never neighbours
  const step = Math.max(2, Math.floor(count / uniques.length));
  let cursor = Math.floor(rng() * step);
  for (const kind of uniques) {
    let idx = cursor;
    while (idx < count && (slots[idx] || slots[idx - 1] || slots[idx + 1])) idx++;
    if (idx >= count) idx = cursor % count;
    slots[idx] = kind;
    cursor = (idx + step + Math.floor(rng() * 2)) % count;
  }

  const pool = BLOCK_KINDS.filter((k) => !uniques.includes(k));
  const total = pool.reduce((a, k) => a + k.weight, 0);
  for (let i = 0; i < count; i++) {
    if (slots[i]) continue;
    let r = rng() * total;
    let chosen = pool[pool.length - 1];
    for (const k of pool) {
      r -= k.weight;
      if (r <= 0) { chosen = k; break; }
    }
    slots[i] = chosen;
  }
  return slots;
}

export const BLOCK_LABELS = Object.fromEntries(BLOCK_KINDS.map((k) => [k.id, k.label]));
