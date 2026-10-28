/**
 * Canonical world definition for the San Andreas map.
 *
 * Both the heightmap bake and the satellite mosaic use exactly this rectangle, so
 * terrain height, albedo, masks and buildings all share one coordinate frame.
 *
 * Source heightmap: 1 px per metre, origin (-4100, -4300), 9000 x 13500 px.
 * Satellite z4 mosaic: 0.33 px per metre, top edge of the mosaic is y = 8370.
 */
export const WORLD = {
  x0: -4100,
  y0: -4040,      // southern edge of the available satellite mosaic
  x1: 4900,       // eastern edge
  y1: 8370,       // northern edge; everything north of it is open sea
};
WORLD.width = WORLD.x1 - WORLD.x0;      // 9000 m
WORLD.height = WORLD.y1 - WORLD.y0;     // 12410 m

/** height in metres = (texel / 65535) * scale + offset — calibrated on 3231 buildings */
export const HEIGHT = { scale: 806.2, offset: 0 };

/** runtime terrain texture resolution */
export const TERRAIN_TEX = { w: 2048, h: 2816 };

/** runtime mask resolution (half of the terrain grid) */
export const MASK_TEX = { w: 1024, h: 1152 };
