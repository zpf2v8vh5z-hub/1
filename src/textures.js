import * as THREE from 'three';

/**
 * Central texture registry. Everything is AI generated (see public/textures_src
 * and tools/prepare-textures.mjs) and post-processed for real-time use.
 */
const MAX_ANISO = 16;

export const TEX = {};

function load(loader, url, { srgb = true, repeat = [1, 1], aniso = MAX_ANISO } = {}) {
  return new Promise((resolve) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = aniso;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      resolve(t);
    }, undefined, () => {
      console.warn('missing texture', url);
      resolve(null);
    });
  });
}

export async function loadTextures(onProgress) {
  const loader = new THREE.TextureLoader();
  const entries = [
    ['asphalt', '/textures/asphalt.jpg', { repeat: [6, 90] }],
    ['asphaltNormal', '/textures/asphalt_normal.jpg', { srgb: false, repeat: [6, 90] }],
    ['sidewalk', '/textures/sidewalk.jpg', { repeat: [2.2, 42] }],
    ['sidewalkNormal', '/textures/sidewalk_normal.jpg', { srgb: false, repeat: [2.2, 42] }],
    ['facadeNeon', '/textures/facade_neon.jpg', {}],
    ['facadeNeonEmissive', '/textures/facade_neon_emissive.jpg', {}],
    ['facadeWhite', '/textures/facade_white.jpg', {}],
    ['facadeWhiteEmissive', '/textures/facade_white_emissive.jpg', {}],
    ['palmBark', '/textures/palm_bark.jpg', { repeat: [2, 3] }],
    ['palmFrond', '/textures/palm_frond.png', {}],
    ['ocean', '/textures/ocean.jpg', { repeat: [26, 26] }],
    ['sand', '/textures/sand.jpg', { repeat: [7, 155], aniso: 16 }],
    ['grass', '/textures/grass.jpg', { repeat: [14, 14] }],
    ['field', '/textures/field.jpg', { repeat: [40, 40] }],
    ['hedge', '/textures/hedge.jpg', { repeat: [6, 1] }],
    ['paving', '/textures/paving.jpg', { repeat: [10, 10] }],
    ['facadeBrick', '/textures/facade_brick.jpg', {}],
    ['facadeBrickEmissive', '/textures/facade_brick_emissive.jpg', {}],
    ['facadeModern', '/textures/facade_modern.jpg', {}],
    ['facadeModernEmissive', '/textures/facade_modern_emissive.jpg', {}],
    ['shopfront', '/textures/shopfront.jpg', {}],
    ['shopfrontEmissive', '/textures/shopfront_emissive.jpg', {}],
    ['facadeCivic', '/textures/facade_civic.jpg', {}],
    ['facadeCivicEmissive', '/textures/facade_civic_emissive.jpg', {}],
    ['rock', '/textures/rock.jpg', { repeat: [1, 1] }],
    ['dirt', '/textures/dirt.jpg', { repeat: [1, 1] }],
    ['forest', '/textures/forest.jpg', { repeat: [1, 1] }],
    ['foliage', '/textures/foliage.jpg', { repeat: [2, 2] }],
    ['bark', '/textures/bark.jpg', { repeat: [2, 3] }],
    ['roof', '/textures/roof.jpg', { repeat: [1, 1] }],
    ['facadeOffice', '/textures/facade_office.jpg', {}],
    ['facadeOfficeEmissive', '/textures/facade_office_emissive.jpg', {}],
    ['facadeResidential', '/textures/facade_residential.jpg', {}],
    ['facadeResidentialEmissive', '/textures/facade_residential_emissive.jpg', {}],
    ['facadeIndustrial', '/textures/facade_industrial.jpg', {}],
    ['clouds', '/textures/clouds.jpg', {}],
    ['glow', '/textures/glow.png', {}],
  ];

  let done = 0;
  await Promise.all(entries.map(async ([key, url, opts]) => {
    TEX[key] = await load(loader, url, opts);
    done++;
    onProgress?.(done / entries.length);
  }));
  TEX.glow.wrapS = TEX.glow.wrapT = THREE.ClampToEdgeWrapping;
  return TEX;
}
