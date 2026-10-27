/* Regression test for the texture loader.

   The original bug: the code waited on `texture.onLoad`, which three.js never
   calls (completion is reported through the callbacks passed to
   load(url, onLoad, onProgress, onError)). The promises never resolved, so the
   loading screen hung forever while every texture had actually arrived.

   This test drives loadTextureSet() with fake loaders, so a hang shows up as a
   timeout instead of a silent freeze.

   Run:  node test/textures.mjs
*/
import { loadTextureSet, textureUrl, ALBEDO_NAMES } from "../src/world.js";

let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };

const EXPECTED = ALBEDO_NAMES.length * 2;

/** Loader that behaves like three's TextureLoader: async success callbacks. */
function fakeLoader({ failFor = null, delay = 1 } = {}) {
  const loaded = [];
  return {
    loaded,
    load(url, onLoad, onProgress, onError) {
      const tex = { url, isTexture: true, wrapS: 0, wrapT: 0, anisotropy: 1, colorSpace: "" };
      setTimeout(() => {
        if (failFor && url.includes(failFor)) {
          if (onError) onError(new Error("404 " + url));
        } else {
          loaded.push(url);
          if (onLoad) onLoad(tex);
        }
      }, delay);
      return tex;
    },
  };
}

/** Fail the test instead of hanging forever. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms)),
  ]);
}

// ---------------------------------------------------------------- happy path
console.log("test 1: all textures load");
{
  const loader = fakeLoader();
  const progress = [];
  const tex = await withTimeout(
    loadTextureSet(loader, (p, done, total) => progress.push({ p, done, total })),
    3000,
    "loadTextureSet never resolved (the bug is back)"
  );

  const keys = Object.keys(tex);
  if (keys.length !== EXPECTED) fail(`expected ${EXPECTED} textures, got ${keys.length}`);
  if (loader.loaded.length !== EXPECTED) fail(`expected ${EXPECTED} requests, got ${loader.loaded.length}`);

  // every albedo needs its matching normal map
  for (const name of ALBEDO_NAMES) {
    if (!tex[name]) fail(`missing albedo ${name}`);
    if (!tex[`${name}_n`]) fail(`missing normal map ${name}_n`);
  }

  const last = progress[progress.length - 1];
  if (!last || Math.abs(last.p - 1) > 1e-9) fail(`progress did not reach 1 (ended at ${last && last.p})`);
  if (last.done !== EXPECTED || last.total !== EXPECTED) fail("progress counters wrong");
  const monotonic = progress.every((v, i) => i === 0 || v.p >= progress[i - 1].p);
  if (!monotonic) fail("progress went backwards");

  // normal maps must not be treated as sRGB colour data
  if (tex["asphalt"].colorSpace === "") fail("albedo has no sRGB colorSpace");
  if (tex["asphalt_n"].colorSpace !== "") fail("normal map should not be sRGB");
  if (tex["grass"].anisotropy !== 8) fail("anisotropy not applied");

  const urls = loader.loaded.join(" ");
  if (!urls.includes("assets/tex/asphalt.jpg")) fail("albedo URL wrong: " + urls);
  if (!urls.includes("assets/tex/asphalt_n.png")) fail("normal URL wrong: " + urls);
  console.log(`  ${keys.length} textures, progress 1.0, URLs correct`);
}

// ----------------------------------------------------------- error resilience
console.log("test 2: a broken file must not hang the loading screen");
{
  const loader = fakeLoader({ failFor: "grass_n" });
  let resolved = false;
  const tex = await withTimeout(
    loadTextureSet(loader, () => {}).then((t) => { resolved = true; return t; }),
    3000,
    "loadTextureSet hung on a failing texture"
  );
  if (!resolved) fail("did not resolve despite a failing texture");
  if (Object.keys(tex).length !== EXPECTED) fail("missing textures on partial failure");
  console.log("  resolved anyway, fallback material path reachable");
}

// -------------------------------------------------------------- url building
console.log("test 3: texture URLs");
{
  if (textureUrl("asphalt") !== "assets/tex/asphalt.jpg") fail("albedo url: " + textureUrl("asphalt"));
  if (textureUrl("asphalt", true) !== "assets/tex/asphalt_n.png") fail("normal url: " + textureUrl("asphalt", true));
  console.log("  albedo .jpg / normal _n.png");
}

console.log("");
if (failures) {
  console.error(`${failures} texture-loader failure(s)`);
  process.exit(1);
}
console.log("texture loader OK: resolves on completion, survives failures, correct URLs");
