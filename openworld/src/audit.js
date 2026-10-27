/* Texture health check: tells us at runtime whether a material is actually
   using a loaded image or still the procedural placeholder.

   This exists because "the buildings look white" is ambiguous — it can mean
   either over-exposure or a map that never made it onto the material. The
   audit answers that question instead of guessing. */

export function describeMap(map) {
  if (!map) return { kind: "none", size: "-" };
  const img = map.image;
  if (!img) return { kind: "broken", size: "-" };
  if (img instanceof HTMLCanvasElement || (img && img.tagName === "CANVAS")) {
    return { kind: "placeholder", size: `${img.width}×${img.height}` };
  }
  const w = img.width || img.videoWidth || 0;
  const h = img.height || img.videoHeight || 0;
  if (!w || !h) return { kind: "broken", size: "0×0" };
  return { kind: "image", size: `${w}×${h}` };
}

/** Audit every material of the returned world. */
export function auditMaterials(materials) {
  const rows = [];
  for (const [name, mat] of Object.entries(materials || {})) {
    if (!mat || !("map" in mat)) continue;
    const map = describeMap(mat.map);
    rows.push({
      material: name,
      // plain colour materials (roof, metal, markings) legitimately have no map
      expectTexture: !!mat.map || !!mat.normalMap,
      map,
      normalMap: describeMap(mat.normalMap),
      emissiveMap: describeMap(mat.emissiveMap),
      color: mat.color ? `#${mat.color.getHexString()}` : "-",
    });
  }
  return rows;
}

/** Human readable one-liner per material, for the console and the HUD panel. */
export function formatAudit(rows) {
  return rows
    .map((r) => {
      let flag = "OK";
      if (r.map.kind === "placeholder") flag = "FALLBACK";
      else if (r.map.kind === "image") flag = "OK";
      else flag = r.expectTexture ? "PROBLEM" : "FLAT";
      return `${flag.padEnd(9)} ${r.material.padEnd(10)} map=${r.map.kind}(${r.map.size}) normal=${r.normalMap.kind}`;
    })
    .join("\n");
}
