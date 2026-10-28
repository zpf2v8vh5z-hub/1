/**
 * San Andreas world constants — shared by the runtime and the bake tools.
 *
 * Coordinates are raw GTA V world coordinates: X east, Y north, Z up.
 * The renderer maps them to Three.js as (x, z, y) -> (X, Y, Z): X east, Z north.
 */

export const WORLD = {
  x0: -4100,
  y0: -4040,
  x1: 4900,
  y1: 8370,
};
WORLD.width = WORLD.x1 - WORLD.x0;      // 9000 m
WORLD.height = WORLD.y1 - WORLD.y0;     // 12410 m
WORLD.cx = (WORLD.x0 + WORLD.x1) / 2;
WORLD.cy = (WORLD.y0 + WORLD.y1) / 2;

/** sea level in metres — everything below is under water */
export const SEA_LEVEL = 0.9;

/** calibration constants, mirrored from tools/gta5/world-config.mjs */
export const HEIGHT = { scale: 806.2, offset: 0 };

/** where the player starts: on the beach at Vespucci, facing downtown */
export const SPAWN = { x: -866, y: -944, heading: 0.0 };

/** named places from the map app, used for fast travel / spawn toggles / tests */
export const LANDMARKS = [
  { id: 'downtown', label: 'Downtown Los Santos', x: -145, y: -835 },
  { id: 'vinewood', label: 'Vinewood', x: 285, y: 185 },
  { id: 'vespucci', label: 'Vespucci Beach', x: -1245, y: -1460 },
  { id: 'casino', label: 'Diamond Casino', x: 930, y: 42 },
  { id: 'mirrorpark', label: 'Mirror Park', x: 1120, y: -565 },
  { id: 'lsia', label: 'LSIA Flughafen', x: -1045, y: -2730 },
  { id: 'kortz', label: 'Kortz Center', x: -2244, y: 265 },
  { id: 'sandy', label: 'Sandy Shores', x: 1755, y: 3745 },
  { id: 'paleto', label: 'Paleto Bay', x: -175, y: 6320 },
  { id: 'zancudo', label: 'Fort Zancudo', x: -2050, y: 3140 },
  { id: 'chiliad', label: 'Mount Chiliad', x: 450, y: 6300 },
  { id: 'alamo', label: 'Alamo Sea', x: 300, y: 3900 },
  { id: 'grapeseed', label: 'Grapeseed', x: 1650, y: 4900 },
  { id: 'delperro', label: 'Del Perro Pier', x: -1740, y: -780 },
];

/** how far the terrain and props are streamed in (metres) */
export const VIEW = {
  far: 16000,
  terrainRadius: 4200,
  buildingRadius: 2600,
  propRadius: 1400,
  shadowRadius: 320,
};
