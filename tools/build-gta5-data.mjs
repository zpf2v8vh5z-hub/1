import fs from 'fs';
import { createRequire } from 'module'; const sharp = createRequire('/home/user/1/package.json')('sharp');

console.time('total');

// ---------------------------------------------------------------------------
// 1. Load GTA V Zones (DurtyFree 3D/2D bounds + Los Santos RED Economy/Type)
// ---------------------------------------------------------------------------
const rawZones = JSON.parse(fs.readFileSync('/tmp/gtav-research/gta-v-data-dumps/zones.json', 'utf8'));
const zonesCs = fs.readFileSync('/tmp/gtav-research/Los-Santos-RED/Los Santos RED/lsr/Data/Location/Zones.cs', 'utf8');

const zoneMeta = new Map();
{
  const re = /new\s+Zone\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*StaticStrings\.([A-Za-z0-9_]+)\s*,[^,]+,\s*(true|false)\s*,\s*eLocationEconomy\.([A-Za-z]+)\s*,\s*eLocationType\.([A-Za-z]+)\s*\)/g;
  let m;
  while ((m = re.exec(zonesCs)) !== null) {
    const [, code, displayName, countyVar, , economy, locType] = m;
    let county = 'Los Santos';
    if (countyVar.includes('Blaine')) county = 'Blaine County';
    else if (countyVar.includes('Majestic')) county = 'Blaine County (Senora)';
    else if (countyVar.includes('LosSantosCounty')) county = 'Los Santos County';
    else if (countyVar.includes('CityOfLosSantos')) county = 'Los Santos';
    zoneMeta.set(code.toUpperCase(), { code, displayName, county, economy, locType });
  }
}

const ZONE_NAME_OVERRIDES = {
  AIRP: 'Los Santos International Airport',
  ALAMO: 'Alamo Sea',
  ALTA: 'Alta',
  ARMYB: 'Fort Zancudo',
  BANHAMC: 'Banham Canyon',
  BANNING: 'Banning',
  BAYTRE: 'Baytree Canyon',
  BEACH: 'Vespucci Beach',
  BHAMCA: 'Banham Canyon',
  BRADP: 'Braddock Pass',
  BRADT: 'Braddock Tunnel',
  BURTON: 'Burton',
  CALAFB: 'Calafia Bridge',
  CANNY: 'Raton Canyon',
  CCREAK: 'Cassidy Creek',
  CHAMH: 'Chamberlain Hills',
  CHIL: 'Vinewood Hills',
  CHU: 'Chumash',
  CMSW: 'Chiliad Mountain State Wilderness',
  CYPRE: 'Cypress Flats',
  DAVIS: 'Davis',
  DELBE: 'Del Perro Beach',
  DELPE: 'Del Perro',
  DELSOL: 'La Puerta / Puerto Del Sol',
  DESRT: 'Grand Senora Desert',
  DOWNT: 'Downtown Los Santos',
  DTVINE: 'Downtown Vinewood',
  EAST_V: 'East Vinewood',
  EBURO: 'El Burro Heights',
  ELGORL: 'El Gordo Lighthouse',
  ELYSIAN: 'Elysian Island',
  GALFISH: 'Galilee',
  GALLI: 'Galileo Park',
  GOLF: 'Los Santos Golf Club',
  GRAPES: 'Grapeseed',
  GREATC: 'Great Chaparral',
  HARMO: 'Harmony',
  HAWICK: 'Hawick',
  HORS: 'Vinewood Racetrack',
  HUMLAB: 'Humane Labs and Research',
  JAIL: 'Bolingbroke Penitentiary',
  KOREAT: 'Little Seoul',
  LACT: 'Land Act Reservoir',
  LAGO: 'Lago Zancudo',
  LDAM: 'Land Act Dam',
  LEGSQU: 'Legion Square',
  LMESA: 'La Mesa',
  LOSPUER: 'La Puerta',
  MIRR: 'Mirror Park',
  MORN: 'Morningwood',
  MOVIE: 'Richards Majestic',
  MTCHIL: 'Mount Chiliad',
  MTGORDO: 'Mount Gordo',
  MTJOSE: 'Mount Josiah',
  MURRI: 'Murrieta Heights',
  NCHU: 'North Chumash',
  NOOSE: 'N.O.O.S.E. Hauptquartier',
  OBSERV: 'Galileo Observatory',
  OCEANA: 'Pazifischer Ozean',
  PALCOV: 'Paleto Cove',
  PALETO: 'Paleto Bay',
  PALFOR: 'Paleto Forest',
  PALHIGH: 'Palomino Highlands',
  PALMPOW: 'Palmer-Taylor Power Station',
  PBLUFF: 'Pacific Bluffs',
  PBOX: 'Pillbox Hill',
  PROCOB: 'Procopio Beach',
  RANCHO: 'Rancho',
  RGLEN: 'Richman Glen',
  RICHM: 'Richman',
  ROCKF: 'Rockford Hills',
  RTRAK: 'Redwood Lights Track',
  SANCHIA: 'San Chianski Mountain Range',
  SANDY: 'Sandy Shores',
  SKID: 'Mission Row',
  SLAB: 'Stab City',
  STAD: 'Maze Bank Arena',
  STRAW: 'Strawberry',
  TATAMO: 'Tataviam Mountains',
  TERMINA: 'Terminal (Hafen)',
  TEXTI: 'Textile City',
  TONGVAH: 'Tongva Hills',
  TONGVAV: 'Tongva Valley',
  VCANA: 'Vespucci Canals',
  VESP: 'Vespucci',
  VINE: 'Vinewood',
  WINDF: 'Ron Alternates Windpark',
  WVINE: 'West Vinewood',
  ZANCUDO: 'Zancudo River',
  ZP_ORT: 'Port of South Los Santos',
  ZQ_UAR: 'Davis Quartz',
};

function lookupZone(x, y, z = null) {
  let best = null;
  let bestArea = Infinity;
  for (const zn of rawZones) {
    const code = zn.Name.toUpperCase();
    if (code === 'SANAND' || code === 'OCEANA') continue;
    for (const b of (zn.Bounds || [])) {
      if (x >= b.Minimum.X && x <= b.Maximum.X && y >= b.Minimum.Y && y <= b.Maximum.Y) {
        if (z !== null && (z < b.Minimum.Z - 20 || z > b.Maximum.Z + 20)) continue;
        const area = (b.Maximum.X - b.Minimum.X) * (b.Maximum.Y - b.Minimum.Y);
        if (area < bestArea) {
          bestArea = area;
          best = code;
        }
      }
    }
  }
  if (!best) {
    // fallback 2D without Z check
    for (const zn of rawZones) {
      const code = zn.Name.toUpperCase();
      if (code === 'SANAND' || code === 'OCEANA') continue;
      for (const b of (zn.Bounds || [])) {
        if (x >= b.Minimum.X && x <= b.Maximum.X && y >= b.Minimum.Y && y <= b.Maximum.Y) {
          const area = (b.Maximum.X - b.Minimum.X) * (b.Maximum.Y - b.Minimum.Y);
          if (area < bestArea) { bestArea = area; best = code; }
        }
      }
    }
  }
  if (!best) {
    let minD2 = Infinity;
    for (const zn of rawZones) {
      const c = zn.Name.toUpperCase();
      if (c === "SANAND" || c === "OCEANA") continue;
      for (const b of (zn.Bounds || [])) {
        const dx = Math.max(b.Minimum.X - x, 0, x - b.Maximum.X);
        const dy = Math.max(b.Minimum.Y - y, 0, y - b.Maximum.Y);
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) { minD2 = d2; best = c; }
      }
    }
  }
  const code = best || "DOWNT";
  const meta = zoneMeta.get(code) || {};
  const name = ZONE_NAME_OVERRIDES[code] || meta.displayName || code;
  const county = meta.county || (y > 1100 ? 'Blaine County' : 'Los Santos');
  const economy = meta.economy || 'Middle';
  const locType = meta.locType || (y > 1100 ? 'Rural' : 'Downtown');
  return { code, name, county, economy, locType };
}

// ---------------------------------------------------------------------------
// 2. Load GTA V Road Nodes (100m spatial grid for instant street + cross-street + Z)
// ---------------------------------------------------------------------------
console.log('Loading road nodes...');
const roadGrid = new Map();
const CELL = 120;
function gridKey(gx, gy) { return `${gx},${gy}`; }
{
  const cells = JSON.parse(fs.readFileSync('/tmp/gtav-research/nodes_extracted/nodes.json', 'utf8'));
  let count = 0;
  for (const cell of cells) {
    for (const node of (cell.Nodes || [])) {
      if (node.IsOnWater) continue;
      const x = node.Position.X, y = node.Position.Y, z = node.Position.Z;
      if (x < -4000 || x > 4500 || y < -4000 || y > 7500) continue;
      let st = (node.StreetName && node.StreetName !== '0') ? node.StreetName.trim() : '';
      if (!st && node.ConnectedNodes) {
        for (const cn of node.ConnectedNodes) {
          if (cn.Node?.StreetName && cn.Node.StreetName !== '0') {
            st = cn.Node.StreetName.trim();
            break;
          }
        }
      }
      const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
      const k = gridKey(gx, gy);
      let arr = roadGrid.get(k);
      if (!arr) { arr = []; roadGrid.set(k, arr); }
      arr.push({ x, y, z, st });
      count++;
    }
  }
  console.log('Indexed road nodes:', count);
}

function lookupRoad(x, y) {
  const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
  let nearestZ = 30, bestZDist = Infinity;
  let primarySt = '', primaryDist = Infinity;
  let crossSt = '', crossDist = Infinity;

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const arr = roadGrid.get(gridKey(gx + dx, gy + dy));
      if (!arr) continue;
      for (const n of arr) {
        const d2 = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
        if (d2 < bestZDist) { bestZDist = d2; nearestZ = n.z; }
        if (!n.st) continue;
        if (d2 < primaryDist) {
          if (primarySt && primarySt !== n.st && primaryDist < crossDist) {
            crossSt = primarySt;
            crossDist = primaryDist;
          }
          primarySt = n.st;
          primaryDist = d2;
        } else if (n.st !== primarySt && d2 < crossDist) {
          crossSt = n.st;
          crossDist = d2;
        }
      }
    }
  }
  const pDistM = Math.sqrt(primaryDist);
  const cDistM = Math.sqrt(crossDist);
  return {
    street: pDistM < 320 ? primarySt : '',
    crossStreet: cDistM < 140 ? crossSt : '',
    groundZ: Number.isFinite(nearestZ) ? +nearestZ.toFixed(1) : 25.0,
  };
}

// ---------------------------------------------------------------------------
// 3. Extract ALL Physical Building Footprints from 8192x8192 Rockstar Atlas Map
// ---------------------------------------------------------------------------
console.log('Scanning 8192x8192 Atlas map for building footprints...');
const W = 8192, H = 8192;
const mask = new Uint8Array(W * H);

for (let ty = 0; ty < 32; ty++) {
  for (let tx = 0; tx < 32; tx++) {
    const p = `/tmp/gtav-research/gtav-map-tiles/atlas/5/${tx}-${ty}.webp`;
    if (!fs.existsSync(p)) continue;
    const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    for (let ly = 0; ly < 256; ly++) {
      const gy = ty * 256 + ly;
      const rowOff = gy * W + tx * 256;
      for (let lx = 0; lx < 256; lx++) {
        const i = (ly * 256 + lx) * ch;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const isUrban = Math.abs(r - 194) <= 7 && Math.abs(g - 194) <= 7 && Math.abs(b - 194) <= 7 && Math.abs(r - g) <= 4 && Math.abs(g - b) <= 4;
        const isSuburban = Math.abs(r - 154) <= 9 && Math.abs(g - 165) <= 9 && Math.abs(b - 149) <= 9;
        const isDesert = Math.abs(r - 156) <= 10 && Math.abs(g - 134) <= 10 && Math.abs(b - 120) <= 10;
        if (isUrban || isSuburban || isDesert) {
          mask[rowOff + lx] = isUrban ? 1 : (isSuburban ? 2 : 3);
        }
      }
    }
  }
}

const visited = new Uint8Array(W * H);
const stack = new Int32Array(W * H);
const footprints = [];

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    if (!mask[idx] || visited[idx]) continue;
    let sp = 0;
    stack[sp++] = idx;
    visited[idx] = 1;
    const pixels = [];
    let sumX = 0, sumY = 0;
    let minX = x, maxX = x, minY = y, maxY = y;
    let c1 = 0, c2 = 0, c3 = 0;

    while (sp > 0) {
      const cur = stack[--sp];
      const cy = (cur / W) | 0;
      const cx = cur - cy * W;
      pixels.push(cx, cy);
      sumX += cx; sumY += cy;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      const t = mask[cur];
      if (t === 1) c1++; else if (t === 2) c2++; else c3++;

      if (cx > 0 && mask[cur - 1] && !visited[cur - 1]) { visited[cur - 1] = 1; stack[sp++] = cur - 1; }
      if (cx < W - 1 && mask[cur + 1] && !visited[cur + 1]) { visited[cur + 1] = 1; stack[sp++] = cur + 1; }
      if (cy > 0 && mask[cur - W] && !visited[cur - W]) { visited[cur - W] = 1; stack[sp++] = cur - W; }
      if (cy < H - 1 && mask[cur + W] && !visited[cur + W]) { visited[cur + W] = 1; stack[sp++] = cur + W; }
    }

    const count = pixels.length / 2;
    if (count < 10) continue; // ignore tiny <22m² noise specks

    const meanX = sumX / count;
    const meanY = sumY / count;

    // Pick an interior pixel (one surrounded by building pixels on all 4 sides if possible) closest to centroid!
    // This guarantees L-shaped & courtyard buildings get their dot right on the roof, never in the empty courtyard!
    let bestPx = meanX, bestPy = meanY, bestScore = Infinity;
    for (let i = 0; i < pixels.length; i += 2) {
      const px = pixels[i], py = pixels[i + 1];
      const pi = py * W + px;
      const isDeep = px > 1 && px < W - 2 && py > 1 && py < H - 2 &&
        mask[pi - 1] && mask[pi + 1] && mask[pi - W] && mask[pi + W] &&
        mask[pi - 2] && mask[pi + 2] && mask[pi - 2 * W] && mask[pi + 2 * W];
      const d2 = (px - meanX) * (px - meanX) + (py - meanY) * (py - meanY) + (isDeep ? 0 : 2500);
      if (d2 < bestScore) {
        bestScore = d2;
        bestPx = px + 0.5;
        bestPy = py + 0.5;
      }
    }

    // Exact conversion from z5 pixel to GTA V world coordinates:
    // px = 3755.5 + 0.66 * X  =>  X = (px - 3755.5) / 0.66
    // py = 5524.5 - 0.66 * Y  =>  Y = (5524.5 - py) / 0.66
    const gx = +((bestPx - 3755.5) / 0.66).toFixed(2);
    const gy = +((5524.5 - bestPy) / 0.66).toFixed(2);
    const minGX = +((minX - 3755.5) / 0.66).toFixed(1);
    const maxGX = +((maxX + 1 - 3755.5) / 0.66).toFixed(1);
    const minGY = +((5524.5 - (maxY + 1)) / 0.66).toFixed(1);
    const maxGY = +((5524.5 - minY) / 0.66).toFixed(1);

    const areaM2 = Math.round(count * (1 / (0.66 * 0.66)));
    const widthM = Math.max(4, Math.round((maxX - minX + 1) / 0.66));
    const lengthM = Math.max(4, Math.round((maxY - minY + 1) / 0.66));

    footprints.push({
      id: footprints.length,
      x: gx,
      y: gy,
      minGX, maxGX, minGY, maxGY,
      areaM2,
      widthM,
      lengthM,
      terrain: c1 >= c2 && c1 >= c3 ? 'urban' : (c2 >= c3 ? 'suburban' : 'desert'),
      matchedCount: 0,
    });
  }
}
console.log('Extracted footprints:', footprints.length);

// Helper to check if point (x, y) is inside or near a footprint
function findFootprint(x, y, maxDistM = 28) {
  const px = Math.round(3755.5 + 0.66 * x);
  const py = Math.round(5524.5 - 0.66 * y);
  let best = null, bestD2 = maxDistM * maxDistM;
  for (const fp of footprints) {
    // Check bounding box with margin
    if (x >= fp.minGX - 14 && x <= fp.maxGX + 14 && y >= fp.minGY - 14 && y <= fp.maxGY + 14) {
      const dx = Math.max(fp.minGX - x, 0, x - fp.maxGX);
      const dy = Math.max(fp.minGY - y, 0, y - fp.maxGY);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = fp;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 4. Collect Named GTA V Buildings from All Authoritative Sources
// ---------------------------------------------------------------------------
const namedBuildings = [];

function inSanAndreas(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x > -3850 && x < 4250 && y > -3850 && y < 7450;
}

function addNamed(b) {
  if (!inSanAndreas(b.x, b.y)) return;
  if (!b.name || b.name === "Test Fight Club" || b.name === "USS Luxington" || b.name.startsWith("Blank")) return;
  if (b.name === "Be Lucky Los Santos!") b.name = "The Diamond Casino & Resort";
  // Deduplicate exact/near-duplicate entries with similar name within 22m
  const norm = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const ex of namedBuildings) {
    const d2 = (ex.x - b.x) ** 2 + (ex.y - b.y) ** 2;
    if (d2 < 18 * 18) {
      const exNorm = ex.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (exNorm === norm || exNorm.includes(norm) || norm.includes(exNorm) || (d2 < 8 * 8 && ex.category === b.category)) {
        // Merge richer fields into existing
        if (!ex.slogan && b.slogan) ex.slogan = b.slogan;
        if ((!ex.description || ex.description.length < (b.description || '').length) && b.description) ex.description = b.description;
        if (!ex.dlc && b.dlc) ex.dlc = b.dlc;
        if (!ex.price && b.price) ex.price = b.price;
        if (!ex.hours && b.hours) ex.hours = b.hours;
        if (!ex.image && b.image) ex.image = b.image;
        if (b.enterable) ex.enterable = true;
        if (b.preferredName) { ex.name = b.name; ex.subtype = b.subtype; ex.category = b.category; }
        if (b.tier < ex.tier) ex.tier = b.tier;
        return;
      }
    }
  }
  namedBuildings.push(b);
}

// --- 4A. Parse Los Santos RED PlacesOfInterest.cs ---
{
  const cs = fs.readFileSync('/tmp/gtav-research/Los-Santos-RED/Los Santos RED/lsr/Data/Location/PlacesOfInterest.cs', 'utf8');
  const lines = cs.split(/\r?\n/);
  const lcIdx = lines.findIndex(l => l.includes('private void DefaultConfig_LibertyCity()'));
  const mainCs = lines.slice(0, lcIdx > 0 ? lcIdx : lines.length).join('\n');

  const TYPE_MAP = {
    Landmark:            { cat: 'landmark',    sub: 'Wahrzeichen',              tier: 1 },
    CityHall:            { cat: 'civic',       sub: 'Rathaus / Verwaltung',     tier: 1 },
    PoliceStation:       { cat: 'civic',       sub: 'Polizeistation',           tier: 1 },
    Hospital:            { cat: 'civic',       sub: 'Krankenhaus / Klinik',     tier: 1 },
    FireStation:         { cat: 'civic',       sub: 'Feuerwache (LSCFD)',       tier: 1 },
    Prison:              { cat: 'civic',       sub: 'Staatsgefängnis',          tier: 1 },
    Morgue:              { cat: 'civic',       sub: 'Gerichtsmedizin',          tier: 1 },
    MilitaryBase:        { cat: 'civic',       sub: 'Militärstützpunkt',        tier: 1 },
    Airport:             { cat: 'civic',       sub: 'Flughafen / Flugplatz',    tier: 1 },
    SubwayStation:       { cat: 'civic',       sub: 'U-Bahn-Station (LS Transit)', tier: 2 },
    Bank:                { cat: 'office',      sub: 'Bankfiliale',              tier: 2 },
    Business:            { cat: 'online',      sub: 'Unternehmen / Immobilie',  tier: 2 },
    Restaurant:          { cat: 'food',        sub: 'Restaurant / Diner',       tier: 2 },
    DriveThru:           { cat: 'food',        sub: 'Fast-Food Drive-Thru',     tier: 2 },
    FoodStand:           { cat: 'food',        sub: 'Imbiss / Bistro',          tier: 2 },
    Bar:                 { cat: 'food',        sub: 'Bar / Club / Lounge',      tier: 2 },
    GamblingDen:         { cat: 'food',        sub: 'Casino / Wettbüro',        tier: 2 },
    Hotel:               { cat: 'hotel',       sub: 'Hotel / Motel',            tier: 2 },
    ApartmentBuilding:   { cat: 'residential', sub: 'Apartmentkomplex',         tier: 2 },
    Residence:           { cat: 'residential', sub: 'Wohngebäude / Safehouse',  tier: 2 },
    ConvenienceStore:    { cat: 'shop',        sub: 'Supermarkt (24/7 / LTD)',  tier: 2 },
    LiquorStore:         { cat: 'shop',        sub: 'Spirituosengeschäft',      tier: 2 },
    ClothingShop:        { cat: 'shop',        sub: 'Bekleidungsgeschäft',      tier: 2 },
    BarberShop:          { cat: 'shop',        sub: 'Friseursalon',             tier: 2 },
    TattooShop:          { cat: 'shop',        sub: 'Tattoo-Studio',            tier: 2 },
    PlasticSurgeryClinic:{ cat: 'shop',        sub: 'Schönheitsklinik',         tier: 2 },
    Pharmacy:            { cat: 'shop',        sub: 'Apotheke',                 tier: 2 },
    Dispensary:          { cat: 'shop',        sub: 'Cannabis-Apotheke',        tier: 2 },
    HeadShop:            { cat: 'shop',        sub: 'Headshop',                 tier: 2 },
    HardwareStore:       { cat: 'shop',        sub: 'Baumarkt & Werkzeuge',     tier: 2 },
    PawnShop:            { cat: 'shop',        sub: 'Pfandleihhaus',            tier: 2 },
    SportingGoodsStore:  { cat: 'shop',        sub: 'Sportgeschäft',            tier: 2 },
    GunStore:            { cat: 'shop',        sub: 'Waffengeschäft (Ammu-Nation)', tier: 2 },
    GasStation:          { cat: 'auto',        sub: 'Tankstelle',               tier: 2 },
    VehicleModShop:      { cat: 'auto',        sub: 'Tuning-Werkstatt',         tier: 2 },
    RepairGarage:        { cat: 'auto',        sub: 'KFZ-Werkstatt',            tier: 2 },
    Dealership:          { cat: 'auto',        sub: 'Autohaus / Fahrzeughandel',tier: 2 },
    VehicleExporter:     { cat: 'industrial',  sub: 'Fahrzeug-Export / Hafen',  tier: 2 },
    ScrapYard:           { cat: 'industrial',  sub: 'Schrottplatz / Verwertung',tier: 2 },
    CarCrusher:          { cat: 'industrial',  sub: 'Schrottpresse / Werk',     tier: 2 },
    GangDen:             { cat: 'online',      sub: 'Fraktions- & Gang-Quartier',tier: 2 },
    Forger:              { cat: 'online',      sub: 'Dokumentenfälscherei',     tier: 2 },
  };

  // Match `new ClassName(new Vector3(x, y, z), heading, "name", "desc"... ) { ... }`
  const re = /new\s+([A-Z][A-Za-z0-9_]*)\s*\(\s*new\s+Vector3\s*\(\s*([-0-9.]+)f?\s*,\s*([-0-9.]+)f?\s*,\s*([-0-9.]+)f?\s*\)\s*,\s*([-0-9.]+)f?\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"[^;\n{]*\)/g;
  let m;
  while ((m = re.exec(mainCs)) !== null) {
    const [fullMatch, cls, xs, ys, zs, , rawName, rawSlogan] = m;
    let body = "";
    let afterIdx = m.index + fullMatch.length;
    while (afterIdx < mainCs.length && /\s/.test(mainCs[afterIdx])) afterIdx++;
    if (mainCs[afterIdx] === "{") {
      let depth = 0, p = afterIdx;
      while (p < mainCs.length) {
        if (mainCs[p] === "{") depth++;
        else if (mainCs[p] === "}") { depth--; if (depth === 0) { p++; break; } }
        p++;
      }
      body = mainCs.slice(afterIdx, p);
    }
    const info = TYPE_MAP[cls];
    if (!info) continue;
    const x = parseFloat(xs), y = parseFloat(ys), z = parseFloat(zs);
    let name = rawName.trim();
    if (name === 'RED Customs') name = 'Los Santos Customs';
    if (name === 'LtD') name = 'LTD Gasoline';
    if (cls === 'GunStore' && /^Guns #\d+/.test(name)) name = `Ammu-Nation (${name.replace('Guns ', 'Filiale ')})`;
    if (cls === 'Hotel' && !/hotel|motel|inn|resort|palace|lodge|suites|manor|arms|towers|castle/i.test(name)) {
      name = `${name} Motel / Hotel`;
    }

    let hours = '';
    let price = null;
    let enterable = false;
    if (body) {
      const om = body.match(/OpenTime\s*=\s*(\d+)/);
      const cm = body.match(/CloseTime\s*=\s*(\d+)/);
      if (om && cm) {
        const o = parseInt(om[1], 10), c = parseInt(cm[1], 10);
        hours = (o === 0 && c === 24) ? '24 Stunden geöffnet (00:00–24:00 Uhr)' : `${String(o).padStart(2,'0')}:00–${String(c).padStart(2,'0')}:00 Uhr`;
      }
      const pm = body.match(/PurchasePrice\s*=\s*(\d+)/);
      if (pm) price = parseInt(pm[1], 10);
      if (/InteriorID\s*=\s*[1-9]/.test(body)) enterable = true;
      const fnm = body.match(/FullName\s*=\s*"([^"]+)"/);
      if (fnm && fnm[1] && fnm[1].length > name.length && !fnm[1].includes(",")) name = fnm[1].trim();
    }

    addNamed({
      name,
      slogan: rawSlogan ? rawSlogan.trim() : '',
      category: info.cat,
      subtype: info.sub,
      x: +x.toFixed(2),
      y: +y.toFixed(2),
      z: +z.toFixed(2),
      hours,
      price,
      enterable,
      tier: info.tier,
      source: 'GTA V Weltdaten',
    });
  }
  console.log('After Los Santos RED:', namedBuildings.length);
}

// --- 4B. Parse GTA Online Properties Gist + online_interiors ---
{
  const gist = JSON.parse(fs.readFileSync('/tmp/gtav-research/properties_gist.json', 'utf8'));
  const lua = Object.values(gist.files)[0].content;
  const sections = lua.split(/tbl_([A-Za-z]+)BlipCoords\s*=\s*\{/);
  for (let i = 1; i < sections.length; i += 2) {
    const secName = sections[i];
    const body = sections[i + 1] || '';
    let currentSlotNote = '';
    for (const line of body.split(/\r?\n/)) {
      const cm = line.match(/--\[\[([^\]]+)\]\]/);
      if (cm) currentSlotNote = cm[1].trim();
      const em = line.match(/\{\s*"([^"]+)"\s*,\s*Vector3\s*\(\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*\)\s*\}/);
      if (!em) continue;
      const [, rawTitle, xs, ys, zs] = em;
      const x = parseFloat(xs), y = parseFloat(ys), z = parseFloat(zs);
      let cat = 'residential', sub = 'GTA Online Apartment', tier = 2, desc = '';
      let title = rawTitle.replace(', Apt XX', '');
      if (currentSlotNote.includes('Office')) {
        cat = 'office'; sub = 'CEO Executive Office'; tier = 1;
        desc = `Exklusives CEO-Bürohochhaus aus GTA Online (Executives & Other Criminals) mit optionaler Firmengarage für bis zu 60 Fahrzeuge, Helipad und Wohnbereich.`;
      } else if (secName === 'Garage') {
        cat = 'auto'; sub = `Kaufbare Garage (${currentSlotNote.includes('10') ? '10 Stellplätze' : currentSlotNote.includes('6') ? '6 Stellplätze' : '2 Stellplätze'})`;
        desc = `Kaufbare Fahrzeuggarage in GTA Online (${currentSlotNote.replace(/\(\d+x\)/,'').trim()}) mit direktem Mechaniker-Service.`;
      } else if (secName === 'Apartment') {
        const cap = currentSlotNote.includes('10') ? 'Luxus-Apartment / Villa (10er Garage)' : currentSlotNote.includes('6') ? 'Mittelklasse-Apartment (6er Garage)' : 'Standard-Apartment (2er Garage)';
        cat = 'residential'; sub = cap;
        if (/Towers|Majestic|Plaza|Heights|Integrity|Alta/i.test(title)) tier = 1;
        desc = `Kaufbare Wohnimmobilie in GTA Online (${cap})${currentSlotNote.includes('10') ? ' inklusive Heist-Planungsraum' : ''}.`;
      } else if (secName === 'Warehouse') {
        const sz = title.includes('[Large]') ? 'Großes Spezialfracht-Lagerhaus (111 Kisten)' : title.includes('[Medium]') ? 'Mittleres Spezialfracht-Lagerhaus (42 Kisten)' : 'Kleines Spezialfracht-Lagerhaus (16 Kisten)';
        title = title.replace(/^\[(Small|Medium|Large)\]\s*/, '');
        cat = 'online'; sub = sz;
        desc = `SecuroServ Spezialfracht-Lagerhaus für CEO-Organisationen (${sz}).`;
      } else if (secName === 'VehicleWarehouse') {
        title = title.replace(/^\[Vehicle\]\s*/, 'Fahrzeug-Lagerhaus ');
        cat = 'online'; sub = 'Import/Export Fahrzeug-Lagerhaus';
        desc = `SecuroServ Import/Export-Lagerhalle mit Platz für bis zu 40 gestohlene Oberklasse- und Spezialfahrzeuge.`;
      }
      addNamed({
        name: title,
        description: desc,
        category: cat,
        subtype: sub,
        x: +x.toFixed(2),
        y: +y.toFixed(2),
        z: +z.toFixed(2),
        enterable: true,
        dlc: 'GTA Online Immobilien',
        tier,
      });
    }
  }

  // Parse online_interiors/client/blips.lua for iconic story houses & online businesses
  const blipsLua = fs.readFileSync('/tmp/gtav-research/online_interiors/client/blips.lua', 'utf8');
  const bre = /\{\s*text\s*=\s*"([^"]+)"[^}]*coord\s*=\s*vector3\s*\(\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*\)\s*\}(?:\s*--\s*(.*))?/g;
  let bm;
  while ((bm = bre.exec(blipsLua)) !== null) {
    const [, text, xs, ys, zs, comment] = bm;
    if (text === 'Apartment' || text === 'House' || text === 'Garage' || text === 'Yacht') continue;
    const x = parseFloat(xs), y = parseFloat(ys), z = parseFloat(zs);
    let name = text;
    let cat = 'online', sub = 'GTA Online Einrichtung', tier = 2, desc = '';
    if (text.includes("Michael's House")) { name = "Michael De Santas Villa"; cat = 'residential'; sub = 'Story-Modus Safehouse'; tier = 1; desc = 'Herrschaftliche Villa der Familie De Santa am Portola Drive in Rockford Hills mit Tennisplatz, Pool und Doppelgarage.'; }
    else if (text.includes("Franklin's House") && y > 0) { name = "Franklin Clintons Villa (3671 Whispymound Dr)"; cat = 'residential'; sub = 'Story-Modus Safehouse'; tier = 1; desc = 'Moderne Luxusvilla in den Vinewood Hills mit Infinity-Pool und Panoramablick über Los Santos, bereitgestellt durch Lester Crest.'; }
    else if (text.includes("Franklin's House")) { name = "Franklins & Tante Denises Haus (Forum Drive)"; cat = 'residential'; sub = 'Story-Modus Safehouse'; tier = 1; desc = 'Franklins ursprüngliches Wohnhaus am Forum Drive in Strawberry.'; }
    else if (text.includes("Trevor's Trailer")) { name = "Trevor Philips' Wohnwagen (Trevor Philips Enterprises)"; cat = 'residential'; sub = 'Story-Modus Safehouse'; tier = 1; desc = 'Trevors Wohnwagen am Zancudo Avenue in Sandy Shores – Hauptquartier von Trevor Philips Enterprises.'; }
    else if (text.includes("Floyd's House")) { name = "Floyd Heberts Apartment"; cat = 'residential'; sub = 'Story-Modus Safehouse'; tier = 1; desc = 'Strandnahes Apartment von Floyd Hebert und Debra am Vespucci Beach, zeitweise von Trevor genutzt.'; }
    else if (text.includes("Lester's House")) { name = "Lester Crests Haus"; cat = 'residential'; sub = 'Story-Modus Schauplatz'; tier = 1; desc = 'Stark gesichertes Wohnhaus des Heist-Masterminds Lester Crest in El Burro Heights / Murrieta Heights.'; }
    else if (text.includes("Lester's Factory")) { name = "Darnell Bros. Textilfabrik (Lesters Heist-Zentrale)"; cat = 'online'; sub = 'Heist-Planungszentrale'; tier = 1; desc = 'Textilfabrik in La Mesa – Planungszentrale für große Raubüberfälle im Story-Modus sowie kaufbare Immobilie (Agents of Sabotage).'; }
    else if (text.includes("Simeon's Dealership")) { name = "Premium Deluxe Motorsport (Simeon Yetarian)"; cat = 'auto'; sub = 'Autohaus (Story & Online)'; tier = 1; desc = 'Bekanntes Autohaus von Simeon Yetarian an der Ecke Power Street & Adam\'s Apple Blvd in Pillbox Hill.'; }
    else if (text.includes("O'Neil Farm")) { name = "O'Neil Brothers Ranch"; cat = 'landmark'; sub = 'Story-Modus Schauplatz'; tier = 1; desc = 'Abgelegenes Farmhaus der O\'Neil-Brüder in Grapeseed mit großem Meth-Labor im Erdgeschoss.'; }
    else if (text.includes("F.I.B Office")) { name = "FIB Headquarters (Federal Investigation Bureau)"; cat = 'office'; sub = 'Bundesbehörde & Wolkenkratzer'; tier = 1; desc = '49-stöckiger Wolkenkratzer des Federal Investigation Bureau am Power Street Plaza neben dem IAA-Turm.'; }
    addNamed({
      name,
      description: desc || (comment ? comment.trim() : ''),
      category: cat,
      subtype: sub,
      x: +x.toFixed(2),
      y: +y.toFixed(2),
      z: +z.toFixed(2),
      enterable: true,
      tier,
    });
  }
  console.log('After Properties + Blips:', namedBuildings.length);
}

// --- 4C. Parse gta-dm-locations (113 Detailed DLC Buildings up to 2026) ---
{
  const dmCode = fs.readFileSync('/tmp/gtav-research/gta-dm-locations/data/locations.js', 'utf8');
  const win = {};
  new Function('window', dmCode)(win);
  for (const e of (win.SNAPSHOT?.entries || [])) {
    for (const pt of (e.points || [])) {
      // Only place surface/real-world coordinates (skip under-map shells z < -15)
      if (!inSanAndreas(pt.x, pt.y) || (pt.z !== null && pt.z < -15)) continue;
      const fullTitle = pt.label ? `${e.title} – ${pt.label}` : e.title;
      let cat = 'online', sub = e.category || 'GTA Online Ort';
      if (/Museum|Art/i.test(sub)) cat = 'landmark';
      else if (/Apartment|House|Mansion/i.test(sub)) cat = 'residential';
      else if (/Office/i.test(sub)) cat = 'office';
      else if (/Garage|Mod|Auto/i.test(sub)) cat = 'auto';
      else if (/Club|Bar|Casino/i.test(sub)) cat = 'food';
      addNamed({
        name: fullTitle,
        description: (e.notes || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(),
        category: cat,
        subtype: sub,
        x: +pt.x.toFixed(2),
        y: +pt.y.toFixed(2),
        z: (pt.z !== null && Number.isFinite(pt.z)) ? +pt.z.toFixed(2) : null,
        enterable: true,
        dlc: e.dlc ? `${e.dlc}${e.release ? ` (${e.release})` : ''}` : '',
        tier: /Kortz|Casino|Mansion|Maze|Observatory|Record A/i.test(fullTitle) ? 1 : 2,
      });
    }
  }
  console.log('After gta-dm-locations:', namedBuildings.length);
}

// --- 4D. Parse Ptr147 GeoJSON POIs (Movie Theaters, Cable Cars, Golf, Fairground, Car Washes, etc.) ---
{
  const geoDir = '/tmp/gtav-research/gta-v-data-dumps/gtav-interactive-map/geojson';
  for (const file of fs.readdirSync(geoDir)) {
    if (!file.endsWith('.json')) continue;
    if (/Race|Triathalon|Tennis/.test(file)) continue;
    const fc = JSON.parse(fs.readFileSync(`${geoDir}/${file}`, 'utf8'));
    for (const feat of (fc.features || [])) {
      const [px, invPy] = feat.geometry.coordinates;
      const py = 8192 - invPy;
      const x = +((px - 3755.5) / 0.66).toFixed(2);
      const y = +((5524.5 - py) / 0.66).toFixed(2);
      const ptype = feat.properties.ptype || file.replace('.json', '');
      const name = feat.properties.name || ptype;
      let cat = 'shop', sub = ptype, tier = 2;
      if (/Safehouse/i.test(ptype)) { cat = 'residential'; sub = 'Story-Modus Safehouse'; tier = 1; }
      else if (/Movie/i.test(ptype)) { cat = 'landmark'; sub = 'Kino (Filmtheater)'; tier = 1; }
      else if (/Cable Car|Fair|Golf/i.test(ptype)) { cat = 'landmark'; sub = 'Freizeit & Wahrzeichen'; tier = 1; }
      else if (/Hanger|Helipad/i.test(ptype)) { cat = 'civic'; sub = 'Hangar / Helipad'; tier = 2; }
      else if (/Repair|Car Wash/i.test(ptype)) { cat = 'auto'; sub = ptype === 'Car Wash' ? 'Autowaschanlage' : 'Los Santos Customs'; }
      else if (/Strip/i.test(ptype)) { cat = 'food'; sub = 'Nachtclub'; tier = 1; }
      const img = feat.properties.imgname ? `https://jgardner117.github.io/gtav-interactive-map/${feat.properties.imgname}` : '';
      addNamed({
        name,
        category: cat,
        subtype: sub,
        x, y, z: null,
        image: img,
        enterable: /Ammu|Barber|Clothing|Tattoo|Repair|Safehouse|Strip|Movie/i.test(ptype),
        tier,
      });
    }
  }
  console.log('After Ptr147 GeoJSON:', namedBuildings.length);
}

// --- 4E. Enrich & Add Remaining Official Engine MLO Buildings from DurtyFree mloInteriors.json ---
const MLO_LABELS = {
  v_janitor: ['Hausmeister-Apartment (FIB-Heist)', 'residential', 'Betretbares Apartment aus der Vorbereitung des FIB-Raubüberfalls.'],
  v_rockclub: ['Tequi-la-la Rockbar', 'food', 'Legendärer Live-Rockclub am Eclipse Boulevard in West Vinewood mit Bühne und VIP-Keller.'],
  ap1_01_b_lsiaterm_subway: ['LSIA U-Bahn-Terminal', 'civic', 'Unterirdischer Stadtbahn-Bahnhof direkt am Los Santos International Airport.'],
  v_hanger: ['Devin Westons Hangar (LSIA)', 'civic', 'Großer Privatjet-Hangar auf dem Gelände des Los Santos International Airport.'],
  v_ap1_01_d_int: ['LSIA Flugschul- & Abfertigungsgebäude', 'civic', 'Abfertigungs- und Verwaltungsgebäude am Los Santos International Airport.'],
  ap1_03_lisapark_subway: ['Puerto Del Sol U-Bahn-Station', 'civic', 'Station der Los Santos Transit Metro nahe Puerto Del Sol.'],
  v_58_sol_office: ['Solomon Richards Büro (Richards Majestic Studios)', 'landmark', 'Klassisches Filmproduzenten-Büro von Solomon Richards auf dem Studiogelände in Backlot City.'],
  v_clotheshi: ['Ponsonbys Luxusboutique', 'shop', 'Exklusives Designer-Modehaus für Maßanzüge und Luxuskleidung in Los Santos.'],
  v_faceoffice: ['Dr. Isiah Friedlanders Praxis', 'landmark', 'Psychiatrische Praxis von Michaels Therapeut Dr. Friedlander mit Meerblick in Pacific Bluffs.'],
  v_refit: ['Vangelico Nachbau / Umbau-Geschäft', 'shop', 'Im Umbau befindliches Ladengeschäft in Rockford Hills.'],
  kt1_09_seoul_subway: ['Little Seoul U-Bahn-Station', 'civic', 'Haltestelle der Los Santos Transit Stadtbahn in Little Seoul.'],
  v_recycle: ['Rogers Salvage & Scrap Recyclinganlage', 'industrial', 'Große industrielle Recycling- und Verschrottungshalle in La Puerta.'],
  v_stadium: ['Maze Bank Arena (Innenraum)', 'landmark', 'Große Multifunktionsarena in La Puerta – Austragungsort von Fame or Shame und Arena War.'],
  sm_15_delperro_subway: ['Del Perro U-Bahn-Station', 'civic', 'U-Bahn-Station der Los Santos Transit Linie in Del Perro.'],
  v_bahama: ['Bahama Mamas West', 'food', 'Bekannter Nachtclub an der Marathon Avenue in Del Perro.'],
  v_jewel2: ['Vangelico Fine Jewelry (Juwelier)', 'shop', 'Berühmtes Luxus-Juweliergeschäft an der Portola Drive in Rockford Hills – Ziel des ersten großen Heists.'],
  bt1_04_burton_subway: ['Burton U-Bahn-Station', 'civic', 'Zentrale U-Bahn-Station unter dem Rockford Plaza in Burton.'],
  v_sweat: ['Darnell Bros. Textilfabrik', 'industrial', 'Mehrstöckige Textilfabrik in La Mesa, genutzt als Lesters Tarnfirma und Heist-Zentrale.'],
  v_dockcontrol: ['Hafenkran- & Pier-400-Kontrollgebäude', 'industrial', 'Logistik- und Kontrollgebäude im Containerhafen von Elysian Island.'],
  v_torture: ['Lagerhaus am Banning-Kai (FIB-Verhörort)', 'industrial', 'Abgelegenes Industrielagerhaus aus der Story-Mission „By the Book“.'],
  v_coroner: ['Los Santos County Coroner Office (Leichenschauhaus)', 'civic', 'Gerichtsmedizinisches Institut am Innocence Boulevard in Strawberry.'],
  v_strip3: ['Vanilla Unicorn Gentlemen\'s Club', 'food', 'Bekannter Stripclub unter dem Olympic Freeway in Strawberry, später unter Trevors Leitung.'],
  v_chopshop: ['Hayes Autos Karosseriewerkstatt', 'auto', 'Autowerkstatt und Zerlegebetrieb in La Mesa.'],
  v_psycheoffice: ['Praxis am Del Perro Beach', 'office', 'Beratungs- und Büroräume nahe der Küste.'],
  v_farmhouse: ['Farmhaus in Grapeseed', 'residential', 'Ländliches Farmgebäude im Agrarbezirk Grapeseed.'],
  v_tower: ['Fort Zancudo Kontrollturm (ATC Tower)', 'civic', 'Mehrstöckiger Flugsicherungs- und Radarturm der Militärbasis Fort Zancudo mit Aufzug und Kommandozentrale.'],
  v_methlab: ['Ace Liquor & Chef\'s Meth-Labor', 'online', 'Spirituosenladen in Sandy Shores mit verstecktem Drogenlabor von Trevor Philips Enterprises im Obergeschoss.'],
  v_sheriff: ['Paleto Bay Sheriff\'s Office', 'civic', 'Dienststelle des Los Santos County Sheriff\'s Department am Paleto Boulevard.'],
  v_sheriff2: ['Sandy Shores Sheriff\'s Station & Klinik', 'civic', 'Kombinierte Sheriff-Wache und medizinische Notfallstation an der Alhambra Drive in Sandy Shores.'],
  v_hicksbar: ['Yellow Jack Inn', 'food', 'Rustikale Wüsten-Bikerbar an der Panorama Drive in der Grand Senora Desert mit Billardtisch und Dartscheibe.'],
  v_lab: ['Humane Labs and Research (Hauptlabor)', 'industrial', 'Hochsicheres Biowaffen- und Chemieforschungszentrum von Merryweather/Regierung in den San Chianski Bergen.'],
  v_ranch: ['La Fuente Blanca (Martin Madrazos Ranch)', 'landmark', 'Weitläufiges Luxus-Anwesen und Pferdegestüt von Kartellboss Martin Madrazo in den Tataviam-Hügeln.'],
  v_bank4: ['Blaine County Savings Bank', 'office', 'Regionalbank am Cascabel Avenue in Paleto Bay – Schauplatz des legendären „Paleto Score“-Überfalls.'],
  v_firedept: ['Los Santos County Feuerwache (LSCFD)', 'civic', 'Einsatzwache des Los Santos County Fire Department mit Fahrzeughalle für Löschzüge.'],
  v_foundry: ['Murrieta Oil Field Eisengießerei (Foundry)', 'industrial', 'Schwere Industrielle Metallgießerei im Osten von Los Santos – Schauplatz des großen Story-Showdowns.'],
  v_abattoir: ['Raven Slaughterhouse (Schlachthof)', 'industrial', 'Großer industrieller Fleischverarbeitungsbetrieb in Cypress Flats.'],
  v_epsilonism: ['Epsilon-Zentrum (Epsilon Program HQ)', 'landmark', 'Prunkvolles Hauptquartier der Sekte „Epsilon Program“ (Kifflom!) in Rockford Hills.'],
  v_carshowroom: ['Premium Deluxe Motorsport Showroom', 'auto', 'Ausstellungsraum und Büro von Simeon Yetarians Fahrzeughandel.'],
  v_fib01: ['FIB Tower (Obere Stockwerke & Büros)', 'office', 'Bundesbehörden-Wolkenkratzer des Federal Investigation Bureau in Downtown Los Santos.'],
  v_cia: ['IAA Headquarters (International Affairs Agency)', 'office', 'Wolkenkratzer des Geheimdienstes IAA direkt gegenüber dem FIB-Gebäude in Pillbox Hill.'],
  v_policehub: ['Mission Row Police Station (LSPD Hauptquartier)', 'civic', 'Zentrales Polizeirevier des Los Santos Police Department mit Zellenblock, Waffenkammer und Büros.'],
  v_finalebank: ['Union Depository (Goldreserve-Tresor)', 'office', 'Streng bewachte Zentralbank und Goldreserve in Pillbox Hill – Ziel des größten Raubüberfalls in GTA V.'],
  v_hospital: ['Pillbox Hill Medical Center (Innenbereich)', 'civic', 'Zentrales Großkrankenhaus in Pillbox Hill.'],
  hei_heist_ornate_bank: ['Pacific Standard Public Deposit Bank', 'office', 'Historische Hauptbank an der Ecke Vinewood Blvd & Alta Street in Downtown Vinewood – Ziel des Pacific-Standard-Heists.'],
  lr_supermod_int: ['Benny\'s Original Motor Works', 'auto', 'Spezialwerkstatt für Lowrider-Umbauten und Custom-Tuning in Strawberry.'],
  tr_tuner_car_meet: ['LS Car Meet (Cypress Flats)', 'auto', 'Treffpunkt der Underground-Tuningszene mit Teststrecke und Tuning-Werkstatt in Cypress Flats.'],
  sf_dlc_office_sec: ['F. Clinton & Partner Celebrity Solutions Agency', 'office', 'Mehrstöckige VIP-Sicherheitsagentur von Franklin Clinton mit Waffenkammer, Garage und Wohnquartier.'],
  m25_2_int_mansion: ['Vinewood Hills Luxusanwesen (Mansions DLC)', 'residential', 'Hochmodernes mehrstöckiges Luxusanwesen in den Hügeln von Los Santos.'],
};

{
  const mlos = JSON.parse(fs.readFileSync('/tmp/gtav-research/gta-v-data-dumps/mloInteriors.json', 'utf8'));
  for (const m of mlos) {
    const nm = m.Name.toLowerCase();
    // Skip underground road/rail/metro tunnel chunks, yachts at sea, aircraft carrier at sea
    if (/tun|metro_|railway|undpass|yacht|carrier|carpark/.test(nm)) continue;
    if (nm === 'v_guardtower') continue; // 28 small perimeter fence towers inside prison/zancudo

    for (const loc of (m.Locations || [])) {
      const { X: x, Y: y, Z: z } = loc.Position;
      if (!inSanAndreas(x, y) || z < -15) continue;

      // Check if an existing named building is within 32m -> enrich it as enterable MLO!
      let matched = null, bestD2 = 32 * 32;
      for (const nb of namedBuildings) {
        const d2 = (nb.x - x) ** 2 + (nb.y - y) ** 2;
        if (d2 < bestD2) { bestD2 = d2; matched = nb; }
      }
      if (matched) {
        matched.enterable = true;
        matched.mloName = m.Name;
        matched.mloEntities = m.TotalEntitiesCount || 0;
        continue;
      }

      const mapped = MLO_LABELS[m.Name];
      let title, cat, desc;
      if (mapped) {
        [title, cat, desc] = mapped;
      } else if (nm.includes('shop_247')) {
        title = '24/7 Supermarket'; cat = 'shop'; desc = 'Rund um die Uhr geöffneter Convenience-Supermarkt mit begehbarem Verkaufsraum und Hinterzimmer.';
      } else if (nm.includes('gen_liquor')) {
        title = 'Rob\'s Liquor Spirituosenmarkt'; cat = 'shop'; desc = 'Begehbarer Getränke- und Spirituosenladen.';
      } else if (nm.includes('gasstation')) {
        title = 'LTD Gasoline Tankstellen-Shop'; cat = 'auto'; desc = 'Tankstelle mit begehbarem Verkaufsraum (LTD Mart).';
      } else if (nm.includes('gun')) {
        title = 'Ammu-Nation Waffengeschäft'; cat = 'shop'; desc = 'Lizenziertes Waffengeschäft für Schusswaffen, Schutzwesen und Ausrüstung.';
      } else if (nm.includes('barber') || nm.includes('hairdresser')) {
        title = 'Friseursalon'; cat = 'shop'; desc = 'Begehbarer Friseur- und Styling-Salon in San Andreas.';
      } else if (nm.includes('tattoo')) {
        title = 'Tattoo-Studio'; cat = 'shop'; desc = 'Begehbares Tätowierstudio mit klassischer GTA-V-Auswahl.';
      } else if (nm.includes('clothes')) {
        title = nm.includes('mid') ? 'Suburban Modegeschäft' : 'Discount Store / Binco Bekleidung';
        cat = 'shop'; desc = 'Begehbares Bekleidungsgeschäft in San Andreas.';
      } else if (nm.includes('carmod')) {
        title = 'Los Santos Customs / Beeker\'s Garage'; cat = 'auto'; desc = 'Begehbare Fahrzeug-Tuning- und Reparaturwerkstatt.';
      } else if (nm.includes('genbank') || nm.includes('bank')) {
        title = 'Fleeca Bank Filiale'; cat = 'office'; desc = 'Begehbare Regionalfiliale des Fleeca-Bankennetzwerks mit Schalterhalle und Tresorraum.';
      } else if (nm.includes('cinema')) {
        title = 'Kino (Ten Cent / Tivoli / Oriental)'; cat = 'landmark'; desc = 'Klassisches GTA-V-Filmtheater mit Kinosaal.';
      } else if (nm.includes('comedy')) {
        title = 'Split Sides West Comedy Club'; cat = 'food'; desc = 'Bekannter Stand-up-Comedy-Club am Eclipse Boulevard.';
      } else if (nm.includes('factory')) {
        title = 'Industrie- & Werkshalle'; cat = 'industrial'; desc = 'Große begehbare Industrie- und Produktionshalle.';
      } else if (nm.includes('apart') || nm.includes('stilts') || nm.includes('mp_h_')) {
        continue; // stacked multiplayer interior shells inside towers already added via ApartmentBlipCoords
      } else if (nm.includes('office_0')) {
        continue; // stacked executive office shells inside the 4 office towers already added
      } else {
        continue;
      }

      addNamed({
        name: title,
        description: desc,
        category: cat,
        subtype: 'Betretbares Gebäude (MLO)',
        x: +x.toFixed(2),
        y: +y.toFixed(2),
        z: +z.toFixed(2),
        enterable: true,
        mloName: m.Name,
        mloEntities: m.TotalEntitiesCount || 0,
        tier: cat === 'landmark' || cat === 'civic' ? 1 : 2,
      });
    }
  }
  console.log('After MLO enrichment & standalone MLOs:', namedBuildings.length);
}

// --- 4F. Add Key Iconic Landmarks Guaranteed to Have Rich German Lore ---
const ICONIC_EXTRAS = [
  { name: 'Maze Bank Tower', x: -75.2, y: -818.9, z: 326.0, category: 'office', subtype: 'Höchstes Gebäude in San Andreas (320 m)', tier: 1, enterable: true, description: 'Mit 96 Stockwerken und 320 Metern Höhe (inspiriert vom U.S. Bank Tower in L.A.) ist der Maze Bank Tower in Pillbox Hill das höchste Bauwerk in ganz GTA V – komplett mit Helipad auf dem Dach und kaufbaren CEO-Büros.' },
  { name: 'Galileo Observatory', x: -438.8, y: 1076.1, z: 352.4, category: 'landmark', subtype: 'Sternwarte & Aussichtspunkt', tier: 1, enterable: false, description: 'Ikonisches Art-déco-Observatorium in den Vinewood Hills (inspiriert vom Griffith Observatory) mit weitläufiger Aussichtsterrasse über ganz Los Santos, Obelisk und Kuppeln.' },
  { name: 'Vinewood Sign', x: 711.2, y: 1197.0, z: 348.5, category: 'landmark', subtype: 'Weltberühmtes Wahrzeichen', tier: 1, enterable: false, description: 'Der weltbekannte weiße VINEWOOD-Schriftzug auf dem Mount Haan hoch über Los Santos – inspiriert vom Hollywood Sign und über Wartungsleitern besteigbar.' },
  { name: 'Vinewood Bowl', x: 682.6, y: 567.7, z: 130.5, category: 'landmark', subtype: 'Freilicht-Amphitheater', tier: 1, enterable: true, description: 'Großes Freilicht-Konzerttheater in den Vinewood Hills (inspiriert vom Hollywood Bowl), Schauplatz von Fame or Shame und Konzerten.' },
  { name: 'The Diamond Casino & Resort', x: 925.3, y: 46.5, z: 81.1, category: 'food', subtype: 'Casino, Luxusresort & Penthouse', tier: 1, enterable: true, dlc: 'The Diamond Casino & Resort', description: 'Prunkvolles Casino- und Hotel-Resort am East Vinewood Racetrack mit Spieltischen, Glücksrad, Dachterrasse mit Infinity-Pool, Luxus-Penthouse und Hochsicherheits-Tresor.' },
  { name: 'Del Perro Pier & Pleasure Pier', x: -1655.4, y: -1082.3, z: 13.1, category: 'landmark', subtype: 'Vergnügungspier & Riesenrad', tier: 1, enterable: false, description: 'Holzpier am Del Perro Beach mit dem Riesenrad „Ferris Whale“, der Achterbahn „Leviathan“, Restaurants, Souvenirläden und Arcade-Ständen.' },
  { name: 'Oriental Theater (Vinewood Blvd)', x: 293.8, y: 180.4, z: 104.3, category: 'landmark', subtype: 'Historisches Premierenkino', tier: 1, enterable: false, description: 'Prachtvolles Premierenkino im chinesischen Tempelstil am Vinewood Boulevard (inspiriert vom Grauman\'s Chinese Theatre) mit dem Walk of Fame davor.' },
  { name: 'Mile High Club (Großbaustelle)', x: -157.8, y: -986.1, z: 21.3, category: 'office', subtype: 'Wolkenkratzer im Bau', tier: 1, enterable: true, description: 'Im Bau befindlicher Megaturm gegenüber dem Pillbox Hill Medical Center – einer der markantesten Schauplätze für Schießereien, Kräne und Missionen in Downtown Los Santos.' },
  { name: 'University of San Andreas, Los Santos (ULSA)', x: -1650.2, y: 186.4, z: 61.8, category: 'landmark', subtype: 'Universitätscampus', tier: 1, enterable: false, description: 'Weitläufiger Campus der Staatsuniversität von San Andreas in Richman (inspiriert von der UCLA) mit historischen Backsteinbauten, Bibliothek und Leichtathletikstadion.' },
  { name: 'GWC and Golfing Society (Clubhaus)', x: -1366.7, y: 56.4, z: 53.7, category: 'landmark', subtype: 'Country- & Golfclub', tier: 1, enterable: false, description: 'Exklusives Clubhaus im Tudor-Stil des Los Santos Golf Clubs in Richman – mit 150.000.000 $ die teuerste kaufbare Immobilie im GTA-V-Story-Modus.' },
  { name: 'Mount Zonah Medical Center', x: -451.8, y: -340.5, z: 34.5, category: 'civic', subtype: 'Großkrankenhaus (Rockford Hills)', tier: 1, enterable: false, description: 'Modernes Privatkrankenhaus im Art-déco-Stil in Rockford Hills (inspiriert vom Cedars-Sinai Medical Center) mit Hubschrauberlandeplatz.' },
  { name: 'Central Los Santos Medical Center', x: 341.4, y: -1396.3, z: 32.5, category: 'civic', subtype: 'Großkrankenhaus & Helipad (Davis)', tier: 1, enterable: false, description: 'Großer Krankenhauskomplex in Davis/Strawberry mit zwei Helipads auf dem Dach.' },
  { name: 'Palmer-Taylor Power Station (Kraftwerk)', x: 2772.0, y: 1528.0, z: 24.5, category: 'industrial', subtype: 'Wärmekraftwerk', tier: 1, enterable: false, description: 'Großes Industrie- und Energieversorgungs-Kraftwerk an der Ostküste von San Andreas mit markanten Schornsteinen und Umspannwerk.' },
  { name: 'Land Act Dam (Staudamm & Wasserkraftwerk)', x: 1660.2, y: -12.5, z: 173.8, category: 'industrial', subtype: 'Staudamm & Kraftwerk', tier: 1, enterable: true, description: 'Massiver Beton-Staudamm am Land Act Reservoir östlich von Los Santos mit Kraftwerkshaus und Wartungsgängen.' },
  { name: 'El Gordo Lighthouse (Leuchtturm)', x: 3430.5, y: 5174.4, z: 41.2, category: 'landmark', subtype: 'Historischer Leuchtturm', tier: 1, enterable: false, description: 'Malerischer Leuchtturm auf einer kleinen Felseninsel vor Cape Catfish am Fuß des Mount Gordo samt Küstenhaus am Ufer.' },
  { name: 'Cluckin\' Bell Farms (Geflügelfabrik Paleto Bay)', x: -72.8, y: 6253.7, z: 31.1, category: 'industrial', subtype: 'Lebensmittelfabrik & Heist-Ort', tier: 1, enterable: true, description: 'Großer Verarbeitungs- und Verpackungskomplex von Cluckin\' Bell am Rand von Paleto Bay – zentraler Schauplatz beim Paleto Score und dem Cluckin\' Bell Farm Raid.' },
  { name: 'Paleto Forest Sawmill (Sägewerk)', x: -552.5, y: 5326.8, z: 73.6, category: 'industrial', subtype: 'Historisches Sägewerk', tier: 1, enterable: false, description: 'Großes Holzverarbeitungs-Sägewerk tief im Paleto Forest am Fuß des Mount Chiliad – Schauplatz der Befreiung von Lamar Davis.' },
  { name: 'Altruistenhöfe (Altruist Camp)', x: -1112.4, y: 4925.1, z: 218.6, category: 'landmark', subtype: 'Bergsiedlung & Kult-Lager', tier: 1, enterable: false, description: 'Abgeriegeltes Klippendorf des technikfeindlichen Altruisten-Kults in der Chiliad Mountain State Wilderness mit Holzhütten, Wasserturm und Opferstein.' },
  { name: 'Dignity Village', x: -125.0, y: 6165.0, z: 31.5, category: 'residential', subtype: 'Zelt- & Hüttensiedlung', tier: 2, enterable: false, description: 'Improvisierte Gemeinschaftssiedlung nahe der Eisenbahnlinie südlich von Paleto Bay.' },
  { name: 'Stab City (Lost MC Trailerpark)', x: 56.2, y: 3715.8, z: 39.8, category: 'residential', subtype: 'Wohnwagensiedlung (The Lost MC)', tier: 1, enterable: false, description: 'Befestigte Trailerpark-Siedlung des Outlaw-Motorradclubs „The Lost MC“ am westlichen Ufer der Alamo Sea.' },
  { name: 'Marlowe Vineyards (Weingut)', x: -1888.5, y: 2049.6, z: 141.0, category: 'landmark', subtype: 'Weingut & Verkostungshaus', tier: 1, enterable: false, description: 'Idyllisches kalifornisch inspiriertes Weingut in den Tongva Hills mit Hauptgebäude, Terrasse und ausgedehnten Weinbergen.' },
  { name: 'NOOSE Hauptquartier (National Office of Security Enforcement)', x: 2535.2, y: -383.8, z: 93.0, category: 'civic', subtype: 'Heimatschutz- & Geheimdienstkomplex', tier: 1, enterable: true, description: 'Streng bewachter Regierungskomplex an der Palomino Freeway mit Serverfarmen und Antiterror-Einheiten.' },
  { name: 'Playboy Mansion / Richman Glen Grotte', x: -1525.8, y: 112.4, z: 56.5, category: 'landmark', subtype: 'Luxus-Partyanwesen', tier: 1, enterable: false, description: 'Berühmte Sandstein-Villa in Richman mit beleuchteter Pool-Grotte, Gartenanlage und Abendpartys.' },
];
for (const item of ICONIC_EXTRAS) addNamed({ ...item, preferredName: true });

console.log('Total Named Buildings after all curated sources:', namedBuildings.length);

// ---------------------------------------------------------------------------
// 5. Match Named Buildings with Physical Atlas Footprints + Enrich ALL Remaining Footprints!
// ---------------------------------------------------------------------------
const allBuildings = [];

// First process all named buildings: attach zone, street, groundZ, and physical footprint dimensions if matched!
for (const nb of namedBuildings) {
  const road = lookupRoad(nb.x, nb.y);
  const z = (nb.z !== null && Number.isFinite(nb.z)) ? nb.z : road.groundZ;
  const zone = lookupZone(nb.x, nb.y, z);
  const fp = findFootprint(nb.x, nb.y, 26);
  if (fp) fp.matchedCount++;

  // Build rich German description if empty or short
  let desc = nb.description || '';
  if (!desc) {
    const sloganPart = nb.slogan ? ` Bekannter Slogan: „${nb.slogan}“.` : '';
    const streetPart = road.street ? ` Gelegen an der ${road.street}${road.crossStreet ? ` (nahe ${road.crossStreet})` : ''}` : '';
    desc = `${nb.subtype} im Stadtteil ${zone.name} (${zone.county}).${streetPart ? streetPart + "." : ""}${sloganPart}${nb.enterable ? ' Dieses Gebäude verfügt in GTA V über einen modellierten Innenraum (MLO).' : ''}`;
  }

  allBuildings.push({
    id: `poi-${allBuildings.length + 1}`,
    name: nb.name,
    slogan: nb.slogan || '',
    category: nb.category,
    subtype: nb.subtype,
    district: zone.name,
    county: zone.county,
    street: road.street || 'Lokale Zufahrtsstraße',
    crossStreet: road.crossStreet || '',
    x: nb.x,
    y: nb.y,
    z: +z.toFixed(1),
    areaM2: fp ? fp.areaM2 : null,
    dims: fp ? `${fp.widthM} × ${fp.lengthM} m` : null,
    enterable: !!nb.enterable,
    hours: nb.hours || '',
    price: nb.price || null,
    dlc: nb.dlc || 'GTA V Basisspiel',
    image: nb.image || '',
    mloEntities: nb.mloEntities || 0,
    tier: nb.tier || 2,
    isNamed: true,
    description: desc,
  });
}

// Second: Add EVERY remaining physical building footprint on the map that doesn't already have a named POI!
let autoCount = 0;
const houseSeqByStreet = new Map();

function classifyFootprint(fp, zone, road) {
  const { code, name: zName, economy, locType } = zone;
  const a = fp.areaM2;

  if (code === 'ARMYB') {
    const sub = a > 900 ? 'Militärhangar / Fahrzeughalle' : a > 250 ? 'Kasernen- & Kommandogebäude' : 'Militär-Nebengebäude / Wachposten';
    return { cat: 'civic', sub, prefix: sub, desc: `${sub} auf dem gesperrten Luftwaffen- und Militärstützpunkt Fort Zancudo (${a} m² Grundfläche). Streng bewachte Sperrzone der U.S. Army / Air Force.` };
  }
  if (code === 'AIRP') {
    const sub = a > 1200 ? 'Flughafen-Terminal / Großhangar' : 'Flughafen-Betriebs- & Frachtgebäude';
    return { cat: 'civic', sub, prefix: sub, desc: `${sub} auf dem Gelände des Los Santos International Airport (LSIA) mit einer Grundfläche von ca. ${a} m².` };
  }
  if (code === 'ZP_ORT' || code === 'TERMINA' || code === 'ELYSIAN') {
    const sub = a > 1000 ? 'Hafen-Lagerhalle & Frachtterminal' : 'Hafen- & Industriegebäude';
    return { cat: 'industrial', sub, prefix: sub, desc: `Industrielles ${sub} im Tiefseehafen von Los Santos (${zName}) mit ca. ${a} m² Gebäudegrundfläche.` };
  }
  if (code === 'HUMLAB' || code === 'PALMPOW' || code === 'LDAM' || code === 'ZQ_UAR') {
    return { cat: 'industrial', sub: 'Industrie- & Versorgungsanlage', prefix: 'Anlagengebäude', desc: `Technisches Betriebs- und Anlagengebäude im Bereich ${zName} (ca. ${a} m² Grundfläche).` };
  }
  if (code === 'JAIL') {
    return { cat: 'civic', sub: 'Gefängnisblock (Bolingbroke)', prefix: 'Zellenblock / Wachgebäude', desc: `Hochsicherheits-Gebäudetrakt der Strafvollzugsanstalt Bolingbroke Penitentiary (${a} m² Grundfläche).` };
  }
  if (code === 'GRAPES' || (locType === 'Rural' && fp.terrain === 'suburban' && a > 180)) {
    const sub = a > 400 ? 'Landwirtschaftliche Scheune / Hofanlage' : 'Ländliches Farm- & Wohngebäude';
    return { cat: a > 400 ? 'industrial' : 'residential', sub, prefix: a > 400 ? 'Farmhalle' : 'Landhaus', desc: `${sub} in der ländlichen Region ${zName} (${zone.county}) mit ca. ${a} m² Grundfläche.` };
  }
  if (code === 'SANDY' || code === 'SLAB' || code === 'HARMO' || code === 'DESRT') {
    const sub = a < 110 ? 'Wüsten-Wohnwagen / Mobilheim' : a < 320 ? 'Wüsten-Wohnhaus / Gewerbe' : 'Gewerbe- & Lagergebäude (Wüste)';
    return { cat: a >= 320 ? 'industrial' : 'residential', sub, prefix: a < 110 ? 'Trailer-Heim' : a < 320 ? 'Wüstenhaus' : 'Gewerbebau', desc: `Typisches ${sub} in ${zName} (Blaine County) nahe der Alamo Sea / Grand Senora Desert mit ca. ${a} m² Grundfläche.` };
  }
  if (code === 'PALETO' || code === 'PROCOB' || code === 'PALCOV' || code === 'CHU' || code === 'NCHU') {
    const sub = a > 450 ? 'Küsten-Geschäfts- & Apartmenthaus' : 'Küsten-Wohnhaus / Strandhaus';
    return { cat: a > 650 ? 'shop' : 'residential', sub, prefix: a > 450 ? 'Geschäftshaus' : 'Küstenhaus', desc: `${sub} im Küstenort ${zName} mit einer Grundfläche von ca. ${a} m².` };
  }
  if (locType === 'Industrial' || code === 'CYPRE' || code === 'LMESA' || code === 'MURRI' || code === 'EBURO' || code === 'BANNING') {
    if (a >= 350) {
      return { cat: 'industrial', sub: a > 1400 ? 'Groß-Lagerhalle / Fabrikkomplex' : 'Industrie- & Gewerbehalle', prefix: a > 1400 ? 'Fabrikkomplex' : 'Lagerhalle', desc: `Gewerblich-industrieller Hallenbau im Industrieviertel ${zName} (${a} m² Grundfläche, ca. ${fp.widthM} × ${fp.lengthM} m).` };
    }
    return { cat: 'residential', sub: 'Vorstadt-Wohnhaus', prefix: 'Wohnhaus', desc: `Kompaktes Wohn- oder Nebengebäude im Viertel ${zName} mit ca. ${a} m² Grundfläche.` };
  }
  if (code === 'DOWNT' || code === 'PBOX' || code === 'LEGSQU' || code === 'TEXTI' || code === 'SKID' || code === 'ALTA') {
    if (a >= 650) {
      return { cat: 'office', sub: a > 1800 ? 'Hochhaus- & Bürokomplex' : 'Geschäfts- & Bürogebäude', prefix: a > 1800 ? 'Büroturm' : 'Geschäftshaus', desc: `Mehrstöckiges ${a > 1800 ? 'Hochhaus- und Büroensemble' : 'Geschäfts- und Bürogebäude'} im Finanz- und Geschäftszentrum ${zName} (${a} m² Grundfläche).` };
    }
    return { cat: 'shop', sub: 'Stadthaus / Ladenzeile', prefix: 'Stadthaus', desc: `Urbanes Geschäfts- und Wohngebäude im Innenstadtbezirk ${zName} mit ca. ${a} m² Grundfläche.` };
  }
  if (code === 'ROCKF' || code === 'RICHM' || code === 'CHIL' || code === 'RGLEN' || code === 'BHAMCA' || code === 'TONGVAH' || code === 'PBLUFF') {
    const sub = a > 380 ? 'Herrschaftliches Anwesen / Luxusvilla' : 'Hangvilla / Einfamilienhaus';
    return { cat: 'residential', sub, prefix: a > 380 ? 'Luxusvilla' : 'Villa', desc: `Exklusive ${sub} in der gehobenen Wohnlage ${zName} mit ca. ${a} m² überbauter Grundfläche.` };
  }
  if (code === 'VCANA') {
    return { cat: 'residential', sub: 'Kanal-Stadthaus (Vespucci Canals)', prefix: 'Kanalhaus', desc: `Maritimes Wohnhaus direkt an den Wasserstraßen der Vespucci Canals (${a} m² Grundfläche).` };
  }
  if (code === 'MIRR') {
    return { cat: 'residential', sub: 'Suburbanes Einfamilienhaus', prefix: 'Einfamilienhaus', desc: `Modernes Einfamilienhaus im beliebten Wohnviertel Mirror Park (${a} m² Grundfläche).` };
  }
  if (code === 'DTVINE' || code === 'WVINE' || code === 'HAWICK' || code === 'BURTON' || code === 'MORN' || code === 'DELPE' || code === 'KOREAT' || code === 'VESP' || code === 'MOVIE') {
    if (a > 700) {
      return { cat: 'office', sub: 'Gewerbe- & Apartmentblock', prefix: 'Gebäudekomplex', desc: `Großer gemischt genutzter Geschäfts-, Laden- und Apartmentblock in ${zName} (${a} m² Grundfläche).` };
    }
    if (a > 320 && fp.terrain === 'urban') {
      return { cat: 'shop', sub: 'Geschäfts- & Wohnhaus', prefix: 'Geschäftshaus', desc: `Städtisches Geschäfts- und Apartmentgebäude in ${zName} mit Ladenfront im Erdgeschoss (${a} m²).` };
    }
    return { cat: 'residential', sub: 'Wohnhaus / Apartmentbau', prefix: 'Wohnhaus', desc: `Städtisches Wohngebäude im Bezirk ${zName} (${a} m² Grundfläche).` };
  }
  // Davis, Strawberry, Rancho, Chamberlain Hills & general fallback
  if (a > 750) {
    return { cat: 'residential', sub: 'Wohnblock / Sozialbau-Komplex', prefix: 'Wohnblock', desc: `Mehrteiliger städtischer Wohnblock oder Gebäudekomplex in ${zName} mit ca. ${a} m² Grundfläche.` };
  }
  return { cat: 'residential', sub: economy === 'Rich' ? 'Villa / Einfamilienhaus' : 'Einfamilien- & Reihenhaus', prefix: 'Wohnhaus', desc: `Freistehendes Wohngebäude im Stadtteil ${zName} (${zone.county}) mit ca. ${a} m² Grundfläche.` };
}

for (const fp of footprints) {
  if (fp.matchedCount > 0) continue;
  // Also double-check no named building sits within 18m of footprint center
  let closeNamed = false;
  for (const nb of namedBuildings) {
    if ((nb.x - fp.x) ** 2 + (nb.y - fp.y) ** 2 < 18 * 18) { closeNamed = true; break; }
  }
  if (closeNamed) continue;

  const road = lookupRoad(fp.x, fp.y);
  const zone = lookupZone(fp.x, fp.y, road.groundZ);
  const cls = classifyFootprint(fp, zone, road);

  const stKey = road.street || zone.name;
  const seq = (houseSeqByStreet.get(stKey) || 100) + 4;
  houseSeqByStreet.set(stKey, seq);

  const title = road.street
    ? `${cls.prefix} · ${seq} ${road.street}`
    : `${cls.prefix} · ${zone.name} #${seq - 100}`;

  allBuildings.push({
    id: `bld-${fp.id}`,
    name: title,
    slogan: '',
    category: cls.cat,
    subtype: cls.sub,
    district: zone.name,
    county: zone.county,
    street: road.street || `Zufahrtsweg (${zone.name})`,
    crossStreet: road.crossStreet || '',
    x: fp.x,
    y: fp.y,
    z: road.groundZ,
    areaM2: fp.areaM2,
    dims: `${fp.widthM} × ${fp.lengthM} m`,
    enterable: false,
    hours: '',
    price: null,
    dlc: 'GTA V Basisspiel (Kartengrundriss)',
    image: '',
    mloEntities: 0,
    tier: 3,
    isNamed: false,
    description: cls.desc,
  });
  autoCount++;
}

console.log('Total buildings compiled:', allBuildings.length, '(Named:', namedBuildings.length, '+ Unmatched physical footprints:', autoCount, ')');
const byCat = {};
for (const b of allBuildings) byCat[b.category] = (byCat[b.category] || 0) + 1;
console.log('By category:', byCat);

// ---------------------------------------------------------------------------
// 6. Write Compact JS Data Bundles to /home/user/1/public/
// ---------------------------------------------------------------------------
// Store compact schema to keep bundle small & instant-loading (< 1.4 MB!)
const CATEGORIES = [
  { id: 'landmark', label: 'Wahrzeichen & Kultur', color: '#f59e0b', icon: '🏛️' },
  { id: 'civic', label: 'Behörden, Polizei & Kliniken', color: '#ef4444', icon: '🚓' },
  { id: 'office', label: 'Bürotürme, Banken & Konzerne', color: '#38bdf8', icon: '🏙️' },
  { id: 'shop', label: 'Geschäfte & Supermärkte', color: '#22c55e', icon: '🛍️' },
  { id: 'food', label: 'Restaurants, Bars & Clubs', color: '#ec4899', icon: '🍔' },
  { id: 'auto', label: 'Werkstätten & Tankstellen', color: '#f97316', icon: '🔧' },
  { id: 'online', label: 'Immobilien & Unternehmen', color: '#a855f7', icon: '💼' },
  { id: 'hotel', label: 'Hotels, Motels & Resorts', color: '#14b8a6', icon: '🏨' },
  { id: 'residential', label: 'Wohnhäuser & Villen', color: '#60a5fa', icon: '🏠' },
  { id: 'industrial', label: 'Industrie & Lagerhallen', color: '#eab308', icon: '🏭' },
];

const compactPayload = {
  generatedAt: new Date().toISOString(),
  crs: {
    // Exact z0 transformation constants verified on the 8192x8192 grid:
    // z0_px = 117.359375 + 0.020625 * X
    // z0_py = 172.640625 - 0.020625 * Y
    centerX: 117.359375,
    centerY: 172.640625,
    scaleX: 0.020625,
    scaleY: 0.020625,
  },
  categories: CATEGORIES,
  counts: {
    total: allBuildings.length,
    named: namedBuildings.length,
    footprints: autoCount,
    byCategory: byCat,
  },
  buildings: allBuildings,
};

const jsOut = `// Auto-generated GTA V Complete Building Database (Los Santos & Blaine County)\nwindow.__GTA5_MAP_DATA__ = ${JSON.stringify(compactPayload)};\n`;
fs.writeFileSync('/home/user/1/public/gta5-map-data.js', jsOut);

// Also write GeoJSON Districts & Streets bundle from Foxxite/GTAV-Geo-Json
const areaGeo = JSON.parse(fs.readFileSync('/tmp/gtav-research/GTAV-Geo-Json/area.geojson', 'utf8'));
const streetGeo = JSON.parse(fs.readFileSync('/tmp/gtav-research/GTAV-Geo-Json/street.geojson', 'utf8'));
fs.writeFileSync(
  '/home/user/1/public/gta5-geo.js',
  `window.__GTA5_GEO__ = ${JSON.stringify({ areas: areaGeo, streets: streetGeo })};\n`
);

console.log('gta5-map-data.js size:', (fs.statSync('/home/user/1/public/gta5-map-data.js').size / 1024 / 1024).toFixed(2), 'MB');
console.log('gta5-geo.js size:', (fs.statSync('/home/user/1/public/gta5-geo.js').size / 1024 / 1024).toFixed(2), 'MB');
console.timeEnd('total');
