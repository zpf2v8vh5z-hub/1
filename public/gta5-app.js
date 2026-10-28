/* ==========================================================================
   GTA V — INTERAKTIVE GEBÄUDEKARTE (LOS SANTOS & BLAINE COUNTY)
   Engine: Kalibriertes Rockstar-Koordinatensystem (z5 = 8192×8192, 0.66 px/m),
   High-DPI Canvas-Gebäude-Renderer für alle 3.261 Gebäude, räumlicher Suchindex,
   Echtzeit-Luftbild-Vorschau & interaktives Gebäude-Informationsfenster.
   ========================================================================== */

(function () {
  'use strict';

  const ASSET_ROOT = (window.__GTA5_ASSET_ROOT__ || '.').replace(/\/$/, '');
  const MAP_DATA = window.__GTA5_MAP_DATA__;
  const GEO_DATA = window.__GTA5_GEO__ || { areas: null, streets: null };

  if (!MAP_DATA || !window.L) {
    console.error('GTA5 Kartendaten oder Leaflet konnten nicht geladen werden.');
    return;
  }

  const DEFAULT_CATEGORIES = [
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

  const BUILDINGS = MAP_DATA.buildings;
  const CATEGORIES = MAP_DATA.categories || DEFAULT_CATEGORIES;
  const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  // Exact z5 pixel calibration constants measured from Rockstar coordinate grid
  const Z5_ORIGIN_X = 3755.5;
  const Z5_ORIGIN_Y = 5524.5;
  const Z5_PX_PER_M = 0.66; // 66 px per 100 m at zoom 5
  const Z0_SCALE = Z5_PX_PER_M / 32; // 0.020625 px/m at zoom 0
  const Z0_ORIGIN_X = Z5_ORIGIN_X / 32; // 117.359375
  const Z0_ORIGIN_Y = Z5_ORIGIN_Y / 32; // 172.640625

  // Exact world bounds of the 8192×8192 tile pyramid (prevents out-of-range 404 tile fetches)
  const TILE_WORLD_BOUNDS = L.latLngBounds(
    [-(8192 - Z5_ORIGIN_Y) / Z5_PX_PER_M, -Z5_ORIGIN_X / Z5_PX_PER_M],
    [Z5_ORIGIN_Y / Z5_PX_PER_M, (8192 - Z5_ORIGIN_X) / Z5_PX_PER_M]
  );

  const PAN_BOUNDS = L.latLngBounds([-4600, -6200], [8900, 7200]);

  const QUICK_JUMPS = [
    { label: '🏙️ Downtown LS', x: -145, y: -835, z: 5.25 },
    { label: '🎬 Vinewood', x: 285, y: 185, z: 5.0 },
    { label: '🏖️ Vespucci Beach', x: -1245, y: -1460, z: 5.25 },
    { label: '🎰 Diamond Casino', x: 930, y: 42, z: 5.75 },
    { label: '🏡 Mirror Park', x: 1120, y: -565, z: 5.25 },
    { label: '✈️ LSIA Flughafen', x: -1045, y: -2730, z: 4.5 },
    { label: '🏛️ Kortz Center', x: -2244, y: 265, z: 5.5 },
    { label: '🌵 Sandy Shores', x: 1755, y: 3745, z: 5.0 },
    { label: '🌲 Paleto Bay', x: -175, y: 6320, z: 5.0 },
    { label: '🪖 Fort Zancudo', x: -2050, y: 3140, z: 4.5 },
  ];

  // =========================================================================
  // STATE
  // =========================================================================
  const state = {
    baseMode: 'satelite', // 'satelite' | 'atlas' | 'hybrid' | 'radar'
    showDistricts: false,
    showStreets: false,
    showGrid: false,
    filterMode: 'all', // 'all' | 'named' | 'enterable' | 'favs'
    selectedDistrict: 'ALL',
    searchQuery: '',
    enabledCategories: new Set(CATEGORIES.map((c) => c.id)),
    favorites: loadFavorites(),
    visibleMask: new Uint8Array(BUILDINGS.length),
    filteredIndices: [],
    hoveredIdx: -1,
    selectedIdx: -1,
    previewTab: 'satelite', // 'satelite' | 'atlas' | 'photo'
  };

  function loadFavorites() {
    try {
      const raw = localStorage.getItem('gta5_map_favs_v1');
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem('gta5_map_favs_v1', JSON.stringify([...state.favorites]));
    } catch {
      // ignore storage quota errors
    }
  }

  // Pre-build search string and spatial hash grid (96m cells) for instant hit-testing & neighbors
  const CELL_SIZE = 96;
  const spatialGrid = new Map();
  const idToIndex = new Map();

  BUILDINGS.forEach((b, idx) => {
    idToIndex.set(b.id, idx);
    const cat = CAT_BY_ID[b.category];
    b._color = cat ? cat.color : '#38bdf8';
    b._catLabel = cat ? cat.label : b.category;
    b._search = `${b.name} ${b.subtype} ${b.district} ${b.county} ${b.street} ${b.crossStreet} ${b.slogan} ${b.dlc} ${b._catLabel}`.toLowerCase();

    const gx = Math.floor(b.x / CELL_SIZE);
    const gy = Math.floor(b.y / CELL_SIZE);
    const key = `${gx},${gy}`;
    let arr = spatialGrid.get(key);
    if (!arr) {
      arr = [];
      spatialGrid.set(key, arr);
    }
    arr.push(idx);
  });

  // =========================================================================
  // LEAFLET CRS & MAP INITIALIZATION
  // =========================================================================
  const GTA_CRS = L.extend({}, L.CRS.Simple, {
    projection: L.Projection.LonLat,
    transformation: new L.Transformation(Z0_SCALE, Z0_ORIGIN_X, -Z0_SCALE, Z0_ORIGIN_Y),
    scale(zoom) {
      return Math.pow(2, zoom);
    },
    zoom(scale) {
      return Math.log(scale) / Math.LN2;
    },
    distance(a, b) {
      return Math.hypot(b.lng - a.lng, b.lat - a.lat);
    },
    infinite: true,
  });

  const mapEl = document.getElementById('map');
  const map = L.map(mapEl, {
    crs: GTA_CRS,
    center: [-760, -190], // Downtown Los Santos / Rockford / Vespucci / Pillbox Hill
    zoom: 4.25,
    minZoom: 1,
    maxZoom: 8,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 85,
    maxBounds: PAN_BOUNDS,
    maxBoundsViscosity: 0.75,
    zoomControl: false,
    preferCanvas: true,
    attributionControl: true,
  });

  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution(
    'San Andreas Gebäudekarte · 3.261 Gebäude · GTA V Koordinatensystem'
  );

  // Tile Layers (local WebP pyramids with automatic remote fallback if single tile ever fails)
  function createGtaTileLayer(folder, extraClass = '', opacity = 1) {
    const layer = L.tileLayer(`${ASSET_ROOT}/tiles/${folder}/{z}/{x}-{y}.webp`, {
      minZoom: 0,
      maxNativeZoom: 5,
      maxZoom: 8,
      tileSize: 256,
      noWrap: true,
      bounds: TILE_WORLD_BOUNDS,
      opacity,
      className: `crisp-tiles ${extraClass}`.trim(),
      keepBuffer: 4,
    });
    layer.on('tileerror', (ev) => {
      if (ev.tile && !ev.tile.dataset.fallbackTried) {
        ev.tile.dataset.fallbackTried = '1';
        const c = ev.coords;
        ev.tile.src = `https://viruxe.github.io/gtav-map-tiles/${folder}/${c.z}/${c.x}-${c.y}.webp`;
      }
    });
    return layer;
  }

  const tileLayers = {
    satelite: createGtaTileLayer('satelite'),
    atlas: createGtaTileLayer('atlas'),
    hybridOverlay: createGtaTileLayer('atlas', '', 0.36),
    radar: createGtaTileLayer('atlas', 'radar-tiles'),
  };

  tileLayers.satelite.addTo(map);

  function setMapStyle(mode) {
    state.baseMode = mode;
    Object.values(tileLayers).forEach((tl) => {
      if (map.hasLayer(tl)) map.removeLayer(tl);
    });
    mapEl.classList.remove('ocean-satelite', 'ocean-atlas', 'ocean-radar');

    if (mode === 'satelite') {
      tileLayers.satelite.addTo(map);
      mapEl.classList.add('ocean-satelite');
    } else if (mode === 'atlas') {
      tileLayers.atlas.addTo(map);
      mapEl.classList.add('ocean-atlas');
    } else if (mode === 'hybrid') {
      tileLayers.satelite.addTo(map);
      tileLayers.hybridOverlay.addTo(map);
      mapEl.classList.add('ocean-satelite');
    } else if (mode === 'radar') {
      tileLayers.radar.addTo(map);
      mapEl.classList.add('ocean-radar');
    }

    document.querySelectorAll('[data-map-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mapMode === mode);
    });
    buildingCanvasLayer.redraw();
  }

  // =========================================================================
  // GEOJSON OVERLAYS (DISTRICTS & STREETS)
  // =========================================================================
  let districtsGroup = null;
  let streetsLayer = null;

  function ensureDistrictsLayer() {
    if (districtsGroup || !GEO_DATA.areas) return districtsGroup;
    districtsGroup = L.layerGroup();

    const palette = ['#38bdf8', '#f5b942', '#a855f7', '#22c55e', '#fb923c', '#ec4899', '#14b8a6'];
    let idx = 0;

    const polyLayer = L.geoJSON(GEO_DATA.areas, {
      interactive: false,
      style: () => {
        const col = palette[idx++ % palette.length];
        return {
          color: col,
          weight: 1.5,
          opacity: 0.72,
          fillColor: col,
          fillOpacity: 0.09,
          dashArray: '5,4',
        };
      },
      onEachFeature: (feature, lyr) => {
        const name = feature.properties && feature.properties.name;
        if (name && lyr.getBounds) {
          const center = lyr.getBounds().getCenter();
          const lbl = L.marker(center, {
            interactive: false,
            icon: L.divIcon({
              className: 'district-map-label',
              html: escapeHtml(name),
              iconSize: [140, 18],
              iconAnchor: [70, 9],
            }),
          });
          districtsGroup.addLayer(lbl);
        }
      },
    });
    districtsGroup.addLayer(polyLayer);
    return districtsGroup;
  }

  function ensureStreetsLayer() {
    if (streetsLayer || !GEO_DATA.streets) return streetsLayer;
    streetsLayer = L.geoJSON(GEO_DATA.streets, {
      interactive: false,
      style: {
        color: '#facc15',
        weight: 1.4,
        opacity: 0.62,
      },
    });
    return streetsLayer;
  }

  // =========================================================================
  // HIGH-DPI CANVAS LAYER: COORDINATE GRID + ALL 3,261 BUILDING DOTS
  // =========================================================================
  const BuildingCanvasLayer = L.Layer.extend({
    onAdd(m) {
      this._map = m;
      const pane = m.getPanes().overlayPane;
      const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated', pane);
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '450';
      this._canvas = canvas;
      this._ctx = canvas.getContext('2d');
      this._originLatLng = m.containerPointToLatLng([0, 0]);
      this._canvasZoom = m.getZoom();

      m.on('moveend zoomend viewreset resize', this.redraw, this);
      m.on('move', this._onMove, this);
      if (m.options.zoomAnimation && L.Browser.any3d) {
        m.on('zoomanim', this._onAnimZoom, this);
      }
      this.redraw();
    },

    onRemove(m) {
      m.off('moveend zoomend viewreset resize', this.redraw, this);
      m.off('move', this._onMove, this);
      m.off('zoomanim', this._onAnimZoom, this);
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas);
      }
    },

    _onAnimZoom(e) {
      if (!this._originLatLng) return;
      const scale = this._map.getZoomScale(e.zoom, this._canvasZoom);
      const newPos = this._map._latLngToNewLayerPoint(this._originLatLng, e.zoom, e.center);
      L.DomUtil.setTransform(this._canvas, newPos, scale);
    },

    _onMove() {
      if (!this._map._animatingZoom) {
        this.redraw();
      }
    },

    redraw() {
      if (!this._map || !this._canvas) return;
      const m = this._map;
      const size = m.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const topLeft = m.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, topLeft);
      this._originLatLng = m.containerPointToLatLng([0, 0]);
      this._canvasZoom = m.getZoom();

      const targetW = Math.round(size.x * dpr);
      const targetH = Math.round(size.y * dpr);
      if (this._canvas.width !== targetW || this._canvas.height !== targetH) {
        this._canvas.width = targetW;
        this._canvas.height = targetH;
        this._canvas.style.width = `${size.x}px`;
        this._canvas.style.height = `${size.y}px`;
      }

      const ctx = this._ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);

      const zoom = m.getZoom();
      const center = m.getCenter();
      const pxPerMeter = Math.pow(2, zoom) * Z0_SCALE;
      const halfW = size.x * 0.5;
      const halfH = size.y * 0.5;

      // 1. Optional GTA V Coordinate Grid
      if (state.showGrid) {
        this._drawGrid(ctx, size, center, pxPerMeter, zoom);
      }

      // 2. Draw all visible building dots (Pass 1: Tier 3 footprints, Pass 2: Tier 2 named, Pass 3: Tier 1 landmarks)
      const pad = 18;
      const minX = center.lng - (halfW + pad) / pxPerMeter;
      const maxX = center.lng + (halfW + pad) / pxPerMeter;
      const minY = center.lat - (halfH + pad) / pxPerMeter;
      const maxY = center.lat + (halfH + pad) / pxPerMeter;

      const isRadar = state.baseMode === 'radar';
      const rTier3 = zoom < 2.5 ? 2.1 : zoom < 3.5 ? 2.9 : zoom < 4.5 ? 3.9 : zoom < 5.5 ? 5.1 : zoom < 6.5 ? 6.4 : 8.0;
      const rTier2 = rTier3 * 1.24 + 0.7;
      const rTier1 = rTier3 * 1.48 + 1.4;

      const mask = state.visibleMask;
      const favs = state.favorites;

      for (let tierPass = 3; tierPass >= 1; tierPass--) {
        const radius = tierPass === 1 ? rTier1 : tierPass === 2 ? rTier2 : rTier3;
        const borderW = zoom < 3.2 ? 1.0 : zoom < 5 ? 1.45 : 2.0;

        for (let i = 0; i < BUILDINGS.length; i++) {
          if (!mask[i]) continue;
          const b = BUILDINGS[i];
          if (b.tier !== tierPass) continue;
          if (b.x < minX || b.x > maxX || b.y < minY || b.y > maxY) continue;

          const sx = halfW + (b.x - center.lng) * pxPerMeter;
          const sy = halfH - (b.y - center.lat) * pxPerMeter;

          // Subtle outer glow for Tier 1 or Radar mode
          if (tierPass === 1 || isRadar) {
            ctx.beginPath();
            ctx.arc(sx, sy, radius + (tierPass === 1 ? 3.2 : 1.8), 0, Math.PI * 2);
            ctx.fillStyle = tierPass === 1 ? hexAlpha(b._color, 0.28) : hexAlpha(b._color, 0.16);
            ctx.fill();
          }

          // Main dot
          ctx.beginPath();
          ctx.arc(sx, sy, radius, 0, Math.PI * 2);
          ctx.fillStyle = b._color;
          ctx.fill();

          if (zoom >= 2.2 || tierPass < 3) {
            ctx.lineWidth = borderW;
            ctx.strokeStyle = b.enterable && zoom >= 4.2 ? '#ffffff' : 'rgba(7, 10, 16, 0.88)';
            ctx.stroke();
          }

          // Inner specular core on zoomed-in views
          if (zoom >= 5.0 && radius >= 5.0) {
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(1.5, radius * 0.34), 0, Math.PI * 2);
            ctx.fillStyle = b.enterable ? '#ffffff' : 'rgba(255,255,255,0.68)';
            ctx.fill();
          }

          // Favorite star ring
          if (favs.has(b.id)) {
            ctx.beginPath();
            ctx.arc(sx, sy, radius + 3.4, 0, Math.PI * 2);
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = '#f5b942';
            ctx.stroke();
          }
        }
      }

      // 3. Labels on zoomed-in views for Tier 1 & Tier 2 named buildings
      if (zoom >= 5.5) {
        ctx.font = '700 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const showTier2Labels = zoom >= 6.5;

        for (let i = 0; i < BUILDINGS.length; i++) {
          if (!mask[i] || i === state.selectedIdx) continue;
          const b = BUILDINGS[i];
          if (b.tier > (showTier2Labels ? 2 : 1)) continue;
          if (b.x < minX || b.x > maxX || b.y < minY || b.y > maxY) continue;

          const sx = halfW + (b.x - center.lng) * pxPerMeter;
          const sy = halfH - (b.y - center.lat) * pxPerMeter;
          const offset = (b.tier === 1 ? rTier1 : rTier2) + 6;

          ctx.lineWidth = 3.2;
          ctx.strokeStyle = 'rgba(7, 10, 16, 0.92)';
          ctx.strokeText(b.name, sx + offset, sy);
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(b.name, sx + offset, sy);
        }
      }

      // 4. Hovered Building Highlight Ring
      if (state.hoveredIdx >= 0 && mask[state.hoveredIdx]) {
        const hb = BUILDINGS[state.hoveredIdx];
        const sx = halfW + (hb.x - center.lng) * pxPerMeter;
        const sy = halfH - (hb.y - center.lat) * pxPerMeter;
        const hr = (hb.tier === 1 ? rTier1 : hb.tier === 2 ? rTier2 : rTier3) + 4.5;

        ctx.beginPath();
        ctx.arc(sx, sy, hr, 0, Math.PI * 2);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      // 5. Selected Building Target Reticle
      if (state.selectedIdx >= 0) {
        const sb = BUILDINGS[state.selectedIdx];
        const sx = halfW + (sb.x - center.lng) * pxPerMeter;
        const sy = halfH - (sb.y - center.lat) * pxPerMeter;
        const sr = (sb.tier === 1 ? rTier1 : sb.tier === 2 ? rTier2 : rTier3) + 7;

        ctx.beginPath();
        ctx.arc(sx, sy, sr + 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245, 185, 66, 0.22)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = '#f5b942';
        ctx.stroke();

        // Crosshair ticks
        const c1 = sr + 2;
        const c2 = sr + 8;
        ctx.beginPath();
        ctx.moveTo(sx - c2, sy); ctx.lineTo(sx - c1, sy);
        ctx.moveTo(sx + c1, sy); ctx.lineTo(sx + c2, sy);
        ctx.moveTo(sx, sy - c2); ctx.lineTo(sx, sy - c1);
        ctx.moveTo(sx, sy + c1); ctx.lineTo(sx, sy + c2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    },

    _drawGrid(ctx, size, center, pxPerMeter, zoom) {
      const halfW = size.x * 0.5;
      const halfH = size.y * 0.5;
      const step = zoom >= 5.5 ? 100 : zoom >= 3.5 ? 500 : 1000;
      const majorStep = zoom >= 5.5 ? 500 : 1000;

      const xStart = Math.floor((center.lng - halfW / pxPerMeter) / step) * step;
      const xEnd = Math.ceil((center.lng + halfW / pxPerMeter) / step) * step;
      const yStart = Math.floor((center.lat - halfH / pxPerMeter) / step) * step;
      const yEnd = Math.ceil((center.lat + halfH / pxPerMeter) / step) * step;

      ctx.font = '600 10px JetBrains Mono, monospace';

      for (let gx = xStart; gx <= xEnd; gx += step) {
        const sx = halfW + (gx - center.lng) * pxPerMeter;
        const isZero = gx === 0;
        const isMajor = gx % majorStep === 0;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, size.y);
        ctx.lineWidth = isZero ? 1.8 : isMajor ? 1.0 : 0.6;
        ctx.strokeStyle = isZero
          ? 'rgba(248, 113, 113, 0.78)'
          : isMajor
          ? 'rgba(255, 255, 255, 0.24)'
          : 'rgba(255, 255, 255, 0.1)';
        ctx.stroke();

        if (isMajor) {
          ctx.fillStyle = isZero ? '#fca5a5' : 'rgba(255,255,255,0.65)';
          ctx.textAlign = 'left';
          ctx.fillText(`X:${gx}`, sx + 4, 16);
        }
      }

      for (let gy = yStart; gy <= yEnd; gy += step) {
        const sy = halfH - (gy - center.lat) * pxPerMeter;
        const isZero = gy === 0;
        const isMajor = gy % majorStep === 0;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(size.x, sy);
        ctx.lineWidth = isZero ? 1.8 : isMajor ? 1.0 : 0.6;
        ctx.strokeStyle = isZero
          ? 'rgba(248, 113, 113, 0.78)'
          : isMajor
          ? 'rgba(255, 255, 255, 0.24)'
          : 'rgba(255, 255, 255, 0.1)';
        ctx.stroke();

        if (isMajor) {
          ctx.fillStyle = isZero ? '#fca5a5' : 'rgba(255,255,255,0.65)';
          ctx.textAlign = 'right';
          ctx.fillText(`Y:${gy}`, size.x - 10, sy - 5);
        }
      }
    },
  });

  const buildingCanvasLayer = new BuildingCanvasLayer();
  buildingCanvasLayer.addTo(map);

  // Selected building floating label directly above the clicked map dot
  let selectedPinMarker = null;

  function updateSelectedPinMarker() {
    if (selectedPinMarker) {
      map.removeLayer(selectedPinMarker);
      selectedPinMarker = null;
    }
    if (state.selectedIdx < 0) return;
    const b = BUILDINGS[state.selectedIdx];
    selectedPinMarker = L.marker([b.y, b.x], {
      interactive: false,
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: '',
        html: `<div class="selected-building-label"><span class="tt-dot" style="background:${b._color}"></span>${escapeHtml(b.name)}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    }).addTo(map);
  }

  // =========================================================================
  // SPATIAL HIT-TESTING (HOVER & CLICK ON ANY OF THE 3,261 BUILDINGS)
  // =========================================================================
  function findBuildingAtContainerPoint(pt) {
    const zoom = map.getZoom();
    const center = map.getCenter();
    const size = map.getSize();
    const pxPerMeter = Math.pow(2, zoom) * Z0_SCALE;
    const worldX = center.lng + (pt.x - size.x * 0.5) / pxPerMeter;
    const worldY = center.lat - (pt.y - size.y * 0.5) / pxPerMeter;

    const maxHitPx = zoom < 3 ? 11 : zoom < 5 ? 13 : 16;
    const searchMeters = maxHitPx / pxPerMeter + 24;
    const cellSpan = Math.min(8, Math.ceil(searchMeters / CELL_SIZE));

    const gx0 = Math.floor(worldX / CELL_SIZE);
    const gy0 = Math.floor(worldY / CELL_SIZE);
    const mask = state.visibleMask;

    let bestIdx = -1;
    let bestScore = Infinity;

    for (let dx = -cellSpan; dx <= cellSpan; dx++) {
      for (let dy = -cellSpan; dy <= cellSpan; dy++) {
        const bucket = spatialGrid.get(`${gx0 + dx},${gy0 + dy}`);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const idx = bucket[k];
          if (!mask[idx]) continue;
          const b = BUILDINGS[idx];
          const sx = size.x * 0.5 + (b.x - center.lng) * pxPerMeter;
          const sy = size.y * 0.5 - (b.y - center.lat) * pxPerMeter;
          const distPx = Math.hypot(sx - pt.x, sy - pt.y);
          if (distPx > maxHitPx) continue;
          // Slight tie-breaker for named landmarks when zoomed far out
          const tierBias = zoom < 4.5 ? (b.tier - 1) * 1.15 : (b.tier - 1) * 0.35;
          const score = distPx + tierBias;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
        }
      }
    }
    return bestIdx;
  }

  const tooltipEl = document.getElementById('map-tooltip');
  const coordReadoutEl = document.getElementById('coord-readout');
  const zoomReadoutEl = document.getElementById('zoom-readout');

  map.on('mousemove', (e) => {
    const gx = Math.round(e.latlng.lng);
    const gy = Math.round(e.latlng.lat);
    coordReadoutEl.textContent = `X: ${gx} · Y: ${gy}`;

    const hitIdx = findBuildingAtContainerPoint(e.containerPoint);
    if (hitIdx !== state.hoveredIdx) {
      state.hoveredIdx = hitIdx;
      mapEl.style.cursor = hitIdx >= 0 ? 'pointer' : '';
      buildingCanvasLayer.redraw();
    }

    if (hitIdx >= 0) {
      const b = BUILDINGS[hitIdx];
      tooltipEl.innerHTML = `
        <div class="tt-title">
          <span class="tt-dot" style="background:${b._color}"></span>
          <span>${escapeHtml(b.name)}</span>
        </div>
        <div class="tt-sub">${escapeHtml(b.subtype)} · ${escapeHtml(b.district)}</div>
        <div class="tt-hint">${b.enterable ? '🚪 Betretbar (MLO) · ' : ''}Klicken für Gebäude-Fenster</div>
      `;
      tooltipEl.style.left = `${e.originalEvent.clientX}px`;
      tooltipEl.style.top = `${e.originalEvent.clientY}px`;
      tooltipEl.classList.add('visible');
    } else {
      tooltipEl.classList.remove('visible');
    }
  });

  map.getContainer().addEventListener('mouseleave', () => {
    tooltipEl.classList.remove('visible');
    if (state.hoveredIdx >= 0) {
      state.hoveredIdx = -1;
      buildingCanvasLayer.redraw();
    }
  });

  map.on('zoomend', () => {
    zoomReadoutEl.textContent = `Zoom ${map.getZoom().toFixed(2).replace(/\.00$/, '')}×`;
  });

  map.on('click', (e) => {
    const hitIdx = findBuildingAtContainerPoint(e.containerPoint);
    if (hitIdx >= 0) {
      selectBuilding(hitIdx, { panIfEdge: true });
    }
  });

  // Right-click copies exact coordinates
  map.on('contextmenu', (e) => {
    const gx = e.latlng.lng.toFixed(2);
    const gy = e.latlng.lat.toFixed(2);
    copyText(`${gx}, ${gy}`, `Karten-Koordinaten kopiert: X=${gx}, Y=${gy}`);
  });

  // =========================================================================
  // AERIAL ROOFTOP & BLUEPRINT PREVIEW RENDERER (FOR ALL 3,261 BUILDINGS)
  // =========================================================================
  const tileImgCache = new Map();

  function loadZ5TileImage(folder, tx, ty) {
    const key = `${folder}/${tx}-${ty}`;
    if (tileImgCache.has(key)) return tileImgCache.get(key);

    const p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (!img.dataset.remoteTried) {
          img.dataset.remoteTried = '1';
          img.src = `https://viruxe.github.io/gtav-map-tiles/${folder}/5/${tx}-${ty}.webp`;
        } else {
          resolve(null);
        }
      };
      img.src = `${ASSET_ROOT}/tiles/${folder}/5/${tx}-${ty}.webp`;
    });
    tileImgCache.set(key, p);
    return p;
  }

  let previewReqToken = 0;

  async function renderBuildingVisualPreview(b) {
    const token = ++previewReqToken;
    const canvas = document.getElementById('win-rooftop-canvas');
    const photoImg = document.getElementById('win-photo-img');
    const photoTabBtn = document.getElementById('vis-tab-photo');

    photoTabBtn.style.display = b.image ? 'inline-block' : 'none';
    if (state.previewTab === 'photo' && !b.image) {
      state.previewTab = 'satelite';
    }

    document.querySelectorAll('.vis-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.visTab === state.previewTab);
    });

    if (state.previewTab === 'photo' && b.image) {
      photoImg.src = b.image;
      photoImg.onerror = () => {
        state.previewTab = 'satelite';
        renderBuildingVisualPreview(b);
      };
      photoImg.classList.add('visible');
      return;
    }

    photoImg.classList.remove('visible');
    const folder = state.previewTab === 'atlas' ? 'atlas' : 'satelite';

    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || 415));
    const h = Math.max(155, Math.round(rect.height || 172));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = folder === 'atlas' ? '#0fa8d2' : '#163c6a';
    ctx.fillRect(0, 0, w, h);

    const bx = Z5_ORIGIN_X + Z5_PX_PER_M * b.x;
    const by = Z5_ORIGIN_Y - Z5_PX_PER_M * b.y;
    const area = b.areaM2 || 250;
    const mag = area > 7000 ? 1.05 : area > 2200 ? 1.45 : area > 700 ? 1.85 : 2.25;

    const srcW = w / mag;
    const srcH = h / mag;
    const srcLeft = bx - srcW * 0.5;
    const srcTop = by - srcH * 0.5;

    const txMin = Math.max(0, Math.floor(srcLeft / 256));
    const txMax = Math.min(31, Math.floor((srcLeft + srcW) / 256));
    const tyMin = Math.max(0, Math.floor(srcTop / 256));
    const tyMax = Math.min(31, Math.floor((srcTop + srcH) / 256));

    const jobs = [];
    for (let tx = txMin; tx <= txMax; tx++) {
      for (let ty = tyMin; ty <= tyMax; ty++) {
        jobs.push(loadZ5TileImage(folder, tx, ty).then((img) => ({ img, tx, ty })));
      }
    }

    const loaded = await Promise.all(jobs);
    if (token !== previewReqToken) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    for (const { img, tx, ty } of loaded) {
      if (!img) continue;
      const dx = (tx * 256 - srcLeft) * mag;
      const dy = (ty * 256 - srcTop) * mag;
      ctx.drawImage(img, dx, dy, 256 * mag, 256 * mag);
    }

    // Bottom vignette for HUD legibility
    const grad = ctx.createLinearGradient(0, h * 0.52, 0, h);
    grad.addColorStop(0, 'rgba(8, 12, 19, 0)');
    grad.addColorStop(1, 'rgba(8, 12, 19, 0.82)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Target Reticle on exact rooftop coordinate
    const cx = w * 0.5;
    const cy = h * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 17, 0, Math.PI * 2);
    ctx.fillStyle = hexAlpha(b._color, 0.24);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = b._color;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#090d14';
    ctx.stroke();

    // Scale bar (50m)
    const barMeters = area > 4000 ? 100 : 50;
    const barPx = barMeters * Z5_PX_PER_M * mag;
    const bxRight = w - 12;
    const byBottom = h - 14;
    ctx.beginPath();
    ctx.moveTo(bxRight - barPx, byBottom - 4);
    ctx.lineTo(bxRight - barPx, byBottom);
    ctx.lineTo(bxRight, byBottom);
    ctx.lineTo(bxRight, byBottom - 4);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();

    ctx.font = '700 10px JetBrains Mono, monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'right';
    ctx.fillText(`${barMeters} m`, bxRight, byBottom - 6);
  }

  // =========================================================================
  // BUILDING INFO WINDOW ("GEBÄUDE-INFORMATIONSFENSTER")
  // =========================================================================
  const winEl = document.getElementById('building-window');

  function findNearbyBuildings(idx, count = 5) {
    const b = BUILDINGS[idx];
    const candidates = [];
    const gx0 = Math.floor(b.x / CELL_SIZE);
    const gy0 = Math.floor(b.y / CELL_SIZE);

    for (let span = 1; span <= 6 && candidates.length < count * 3; span++) {
      candidates.length = 0;
      for (let dx = -span; dx <= span; dx++) {
        for (let dy = -span; dy <= span; dy++) {
          const bucket = spatialGrid.get(`${gx0 + dx},${gy0 + dy}`);
          if (!bucket) continue;
          for (const otherIdx of bucket) {
            if (otherIdx === idx) continue;
            const ob = BUILDINGS[otherIdx];
            const dist = Math.hypot(ob.x - b.x, ob.y - b.y);
            candidates.push({ idx: otherIdx, dist });
          }
        }
      }
    }

    candidates.sort((a, b2) => a.dist - b2.dist);
    return candidates.slice(0, count);
  }

  function selectBuilding(idx, opts = {}) {
    if (idx < 0 || idx >= BUILDINGS.length) return;
    state.selectedIdx = idx;
    const b = BUILDINGS[idx];

    if (opts.flyTo) {
      const targetZoom = Math.max(map.getZoom(), b.tier === 3 ? 6.25 : 5.75);
      map.flyTo([b.y, b.x], targetZoom, { duration: 0.65 });
    } else if (opts.panIfEdge) {
      const pt = map.latLngToContainerPoint([b.y, b.x]);
      const size = map.getSize();
      const winW = window.innerWidth > 760 ? 435 : 0;
      const leftSafe = document.getElementById('sidebar').classList.contains('collapsed') ? 40 : 395;
      const rightSafe = size.x - winW - 30;
      if (pt.x < leftSafe || pt.x > rightSafe || pt.y < 70 || pt.y > size.y - 70) {
        const offsetMeters = ((winW - (leftSafe > 100 ? 180 : 0)) * 0.28) / (Math.pow(2, map.getZoom()) * Z0_SCALE);
        map.panTo([b.y, b.x + (window.innerWidth > 900 ? offsetMeters : 0)], { animate: true, duration: 0.35 });
      }
    }

    buildingCanvasLayer.redraw();
    updateSelectedPinMarker();
    populateBuildingWindow(b, idx);
    winEl.classList.add('open');

    // Sync URL hash without scrolling
    if (history.replaceState) {
      history.replaceState(null, '', `#b=${encodeURIComponent(b.id)}`);
    }

    // Highlight active item in sidebar list if visible
    document.querySelectorAll('.result-item').forEach((el) => {
      el.classList.toggle('selected', Number(el.dataset.idx) === idx);
    });
  }

  function closeBuildingWindow() {
    state.selectedIdx = -1;
    winEl.classList.remove('open');
    updateSelectedPinMarker();
    buildingCanvasLayer.redraw();
    if (history.replaceState) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    document.querySelectorAll('.result-item.selected').forEach((el) => el.classList.remove('selected'));
  }

  function populateBuildingWindow(b, idx) {
    const cat = CAT_BY_ID[b.category] || { label: b.category, color: '#38bdf8', icon: '🏢' };

    document.getElementById('win-cat-pill').innerHTML = `
      <span class="tt-dot" style="background:${cat.color}"></span>
      <span>${escapeHtml(cat.label)}</span>
    `;
    document.getElementById('win-id-tag').textContent = `#${b.id.toUpperCase()}`;

    const mloBadge = document.getElementById('win-mlo-pill');
    if (b.enterable) {
      mloBadge.className = 'mlo-pill enterable';
      mloBadge.textContent = b.mloEntities > 0
        ? `🚪 Betretbarer Innenraum (${b.mloEntities} MLO-Objekte)`
        : '🚪 Betretbarer Innenraum / Interieur';
    } else {
      mloBadge.className = 'mlo-pill exterior';
      mloBadge.textContent = '🏢 Außenfassade (Nicht frei begehbar)';
    }

    document.getElementById('win-name').textContent = b.name;
    document.getElementById('win-subtype').textContent = `${b.subtype} · ${
      b.tier === 1 ? 'Haupt-Wahrzeichen' : b.tier === 2 ? 'Benannter Standort' : 'Physischer Gebäudegrundriss'
    }`;

    const sloganEl = document.getElementById('win-slogan');
    if (b.slogan) {
      sloganEl.style.display = 'block';
      sloganEl.textContent = `„${b.slogan}“`;
    } else {
      sloganEl.style.display = 'none';
    }

    document.getElementById('win-desc').textContent = b.description;

    // Favorite state
    const favBtn = document.getElementById('win-fav-btn');
    const isFav = state.favorites.has(b.id);
    favBtn.classList.toggle('fav-active', isFav);
    favBtn.textContent = isFav ? '★ Gemerkt' : '☆ Merken';

    // Structured specification cards
    const specs = [];
    specs.push({
      label: '📍 Straße & Adresse',
      value: b.street || 'Unbenannte Zufahrt',
      sub: b.crossStreet ? `Querstraße: ${b.crossStreet}` : 'Direkte Lage',
    });
    specs.push({
      label: '🏙️ Stadtteil & Region',
      value: b.district,
      sub: b.county,
    });
    specs.push({
      label: '📐 Grundfläche & Maße',
      value: b.areaM2 ? `ca. ${b.areaM2.toLocaleString('de-DE')} m²` : 'Spezialstruktur',
      sub: b.dims ? `Ausdehnung: ${b.dims}` : 'Aus Kartendaten erfasst',
    });
    specs.push({
      label: '⛰️ Höhe über Meeresspiegel',
      value: b.z !== null && b.z !== undefined ? `${b.z} m ü. NN` : 'Oberfläche',
      sub: b.isNamed ? 'Exakter Eingangspunkt' : 'Straßenniveau',
    });

    if (b.hours) {
      specs.push({
        label: '🕒 Öffnungszeiten',
        value: b.hours,
        sub: 'In-Game Geschäftszeiten',
      });
    }
    if (b.price) {
      specs.push({
        label: '💵 Immobilien- / Kaufpreis',
        value: `$ ${Number(b.price).toLocaleString('de-DE')}`,
        sub: 'GTA V / GTA Online Kaufwert',
      });
    }
    specs.push({
      label: '💿 Spiel-Edition / DLC',
      value: b.dlc || 'GTA V Basisspiel',
      sub: b.isNamed ? 'Kuratierter Spieleintrag' : 'Rockstar Atlas-Grundriss',
      full: !b.hours && !b.price ? false : (Boolean(b.hours) === Boolean(b.price)),
    });
    specs.push({
      label: '🎯 GTA-V Weltkoordinaten (Vector3)',
      value: `X: ${b.x}   Y: ${b.y}${b.z !== null && b.z !== undefined ? `   Z: ${b.z}` : ''}`,
      mono: true,
      full: true,
    });

    document.getElementById('win-specs').innerHTML = specs
      .map(
        (s) => `
      <div class="spec-card ${s.full ? 'full' : ''}">
        <div class="spec-label">${escapeHtml(s.label)}</div>
        <div class="spec-value ${s.mono ? 'spec-mono' : ''}">${escapeHtml(s.value)}</div>
        ${s.sub ? `<div class="spec-sub">${escapeHtml(s.sub)}</div>` : ''}
      </div>
    `
      )
      .join('');

    // Nearby buildings
    const neighbors = findNearbyBuildings(idx, 5);
    const nearbyEl = document.getElementById('win-nearby');
    nearbyEl.innerHTML = neighbors
      .map(({ idx: nIdx, dist }) => {
        const nb = BUILDINGS[nIdx];
        return `
        <div class="nearby-item" data-neighbor-idx="${nIdx}">
          <span class="res-dot" style="background:${nb._color}"></span>
          <div class="res-body">
            <div class="res-title">${escapeHtml(nb.name)}</div>
            <div class="res-meta">${escapeHtml(nb.subtype)} · ${escapeHtml(nb.street)}</div>
          </div>
          <span class="nearby-dist">${Math.round(dist)} m</span>
        </div>
      `;
      })
      .join('');

    nearbyEl.querySelectorAll('[data-neighbor-idx]').forEach((item) => {
      item.addEventListener('click', () => {
        const nIdx = Number(item.dataset.neighborIdx);
        selectBuilding(nIdx, { flyTo: true });
      });
    });

    renderBuildingVisualPreview(b);
  }

  // Window action buttons & visual preview tabs
  document.getElementById('win-close').addEventListener('click', closeBuildingWindow);

  document.getElementById('win-zoom-btn').addEventListener('click', () => {
    if (state.selectedIdx < 0) return;
    const b = BUILDINGS[state.selectedIdx];
    map.flyTo([b.y, b.x], 7.0, { duration: 0.65 });
  });

  document.getElementById('win-copy-btn').addEventListener('click', () => {
    if (state.selectedIdx < 0) return;
    const b = BUILDINGS[state.selectedIdx];
    const zPart = b.z !== null && b.z !== undefined ? `, ${b.z}` : ', 30.0';
    copyText(`${b.x}, ${b.y}${zPart}`, `Koordinaten kopiert: ${b.x}, ${b.y}${zPart}`);
  });

  document.getElementById('win-fav-btn').addEventListener('click', () => {
    if (state.selectedIdx < 0) return;
    const b = BUILDINGS[state.selectedIdx];
    if (state.favorites.has(b.id)) {
      state.favorites.delete(b.id);
      showToast(`Aus Merkliste entfernt: ${b.name}`);
    } else {
      state.favorites.add(b.id);
      showToast(`Zur Merkliste hinzugefügt: ${b.name}`);
    }
    saveFavorites();
    populateBuildingWindow(b, state.selectedIdx);
    applyFilters();
  });

  document.querySelectorAll('.vis-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.previewTab = btn.dataset.visTab;
      if (state.selectedIdx >= 0) {
        renderBuildingVisualPreview(BUILDINGS[state.selectedIdx]);
      }
    });
  });

  // Make Building Info Window draggable on desktop via its titlebar
  (function initWindowDrag() {
    const bar = document.getElementById('win-titlebar');
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    bar.addEventListener('mousedown', (e) => {
      if (window.innerWidth <= 760 || e.target.closest('button')) return;
      dragging = true;
      const rect = winEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      winEl.style.right = 'auto';
      winEl.style.left = `${origLeft}px`;
      winEl.style.top = `${origTop}px`;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const nx = Math.max(8, Math.min(window.innerWidth - winEl.offsetWidth - 8, origLeft + (e.clientX - startX)));
      const ny = Math.max(8, Math.min(window.innerHeight - 80, origTop + (e.clientY - startY)));
      winEl.style.left = `${nx}px`;
      winEl.style.top = `${ny}px`;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  })();

  // =========================================================================
  // SIDEBAR: FILTERS, SEARCH, CATEGORIES, DISTRICTS, QUICK JUMPS & RESULTS
  // =========================================================================
  function initSidebarUI() {
    // Stats
    document.getElementById('stat-total').textContent = BUILDINGS.length.toLocaleString('de-DE');
    document.getElementById('stat-named').textContent = MAP_DATA.counts.named.toLocaleString('de-DE');
    const mloCount = BUILDINGS.filter((b) => b.enterable).length;
    document.getElementById('stat-mlo').textContent = mloCount.toLocaleString('de-DE');

    // District dropdown
    const districtCounts = new Map();
    for (const b of BUILDINGS) {
      districtCounts.set(b.district, (districtCounts.get(b.district) || 0) + 1);
    }
    const sortedDistricts = [...districtCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'));
    const distSelect = document.getElementById('district-select');
    distSelect.innerHTML =
      `<option value="ALL">Alle Stadtteile & Regionen (${BUILDINGS.length.toLocaleString('de-DE')})</option>` +
      sortedDistricts
        .map(([d, cnt]) => `<option value="${escapeHtml(d)}">${escapeHtml(d)} (${cnt})</option>`)
        .join('');

    distSelect.addEventListener('change', () => {
      state.selectedDistrict = distSelect.value;
      applyFilters();
      if (state.selectedDistrict !== 'ALL' && state.filteredIndices.length > 0) {
        let sumX = 0;
        let sumY = 0;
        for (const i of state.filteredIndices) {
          sumX += BUILDINGS[i].x;
          sumY += BUILDINGS[i].y;
        }
        const n = state.filteredIndices.length;
        map.flyTo([sumY / n, sumX / n], 5.0, { duration: 0.65 });
      }
    });

    // Category buttons
    renderCategoryButtons();

    document.getElementById('cats-all-btn').addEventListener('click', () => {
      if (state.enabledCategories.size === CATEGORIES.length) {
        state.enabledCategories.clear();
      } else {
        CATEGORIES.forEach((c) => state.enabledCategories.add(c.id));
      }
      renderCategoryButtons();
      applyFilters();
    });

    // Quick jumps
    const jumpsEl = document.getElementById('quick-jumps');
    jumpsEl.innerHTML = QUICK_JUMPS.map(
      (j, idx) => `<button class="jump-pill" data-jump="${idx}" type="button">${j.label}</button>`
    ).join('');
    jumpsEl.querySelectorAll('[data-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const j = QUICK_JUMPS[Number(btn.dataset.jump)];
        map.flyTo([j.y, j.x], j.z, { duration: 0.7 });
      });
    });

    // Filter mode chips
    document.querySelectorAll('[data-filter-mode]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.filterMode = chip.dataset.filterMode;
        document.querySelectorAll('[data-filter-mode]').forEach((c) =>
          c.classList.toggle('active', c.dataset.filterMode === state.filterMode)
        );
        applyFilters();
      });
    });

    // Search input
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    const kbdHint = document.getElementById('search-kbd');

    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value.trim();
      const hasVal = state.searchQuery.length > 0;
      clearBtn.classList.toggle('visible', hasVal);
      kbdHint.style.display = hasVal ? 'none' : 'inline-block';
      applyFilters();
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.filteredIndices.length > 0) {
        selectBuilding(state.filteredIndices[0], { flyTo: true });
      }
    });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearBtn.classList.remove('visible');
      kbdHint.style.display = 'inline-block';
      applyFilters();
    });

    // Sidebar collapse/reopen
    const sidebar = document.getElementById('sidebar');
    document.getElementById('sidebar-collapse').addEventListener('click', () => {
      sidebar.classList.add('collapsed');
    });
    document.getElementById('sidebar-reopen').addEventListener('click', () => {
      sidebar.classList.remove('collapsed');
    });

    // Random building discovery button
    document.getElementById('random-building-btn').addEventListener('click', () => {
      const pool = state.filteredIndices.length > 0 ? state.filteredIndices : BUILDINGS.map((_, i) => i);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      selectBuilding(pick, { flyTo: true });
    });
  }

  function renderCategoryButtons() {
    const catGrid = document.getElementById('cat-grid');
    catGrid.innerHTML = CATEGORIES.map((c) => {
      const on = state.enabledCategories.has(c.id);
      const cnt = MAP_DATA.counts.byCategory[c.id] || 0;
      return `
        <button class="cat-btn ${on ? 'active' : 'off'}" data-cat-id="${c.id}" type="button" title="Klick: Umschalten · Doppelklick: Nur diese Kategorie">
          <span class="cat-dot" style="background:${c.color}; color:${c.color}"></span>
          <span class="cat-name">${escapeHtml(c.label)}</span>
          <span class="cat-count">${cnt}</span>
        </button>
      `;
    }).join('');

    document.getElementById('cats-all-btn').textContent =
      state.enabledCategories.size === CATEGORIES.length ? 'Alle abwählen' : 'Alle aktivieren';

    catGrid.querySelectorAll('[data-cat-id]').forEach((btn) => {
      const cid = btn.dataset.catId;
      btn.addEventListener('click', () => {
        if (state.enabledCategories.has(cid)) {
          state.enabledCategories.delete(cid);
        } else {
          state.enabledCategories.add(cid);
        }
        renderCategoryButtons();
        applyFilters();
      });
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        state.enabledCategories.clear();
        state.enabledCategories.add(cid);
        renderCategoryButtons();
        applyFilters();
      });
    });
  }

  function applyFilters() {
    const q = state.searchQuery.toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const coordMatch = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);

    const mask = state.visibleMask;
    const matched = [];

    for (let i = 0; i < BUILDINGS.length; i++) {
      const b = BUILDINGS[i];
      let ok = state.enabledCategories.has(b.category);

      if (ok && state.selectedDistrict !== 'ALL' && b.district !== state.selectedDistrict) {
        ok = false;
      }
      if (ok) {
        if (state.filterMode === 'named' && !b.isNamed) ok = false;
        else if (state.filterMode === 'enterable' && !b.enterable) ok = false;
        else if (state.filterMode === 'favs' && !state.favorites.has(b.id)) ok = false;
      }
      if (ok && tokens.length > 0) {
        if (coordMatch) {
          const tx = parseFloat(coordMatch[1]);
          const ty = parseFloat(coordMatch[2]);
          if (Math.hypot(b.x - tx, b.y - ty) > 220) ok = false;
        } else {
          for (let t = 0; t < tokens.length; t++) {
            if (!b._search.includes(tokens[t])) {
              ok = false;
              break;
            }
          }
        }
      }

      mask[i] = ok ? 1 : 0;
      if (ok) matched.push(i);
    }

    // Sort results: Tier 1 -> Tier 2 -> MLO -> Name
    matched.sort((ia, ib) => {
      const a = BUILDINGS[ia];
      const b = BUILDINGS[ib];
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.enterable !== b.enterable) return a.enterable ? -1 : 1;
      return a.name.localeCompare(b.name, 'de');
    });

    state.filteredIndices = matched;
    renderResultsList();
    buildingCanvasLayer.redraw();
  }

  function renderResultsList() {
    const listEl = document.getElementById('results-list');
    const countLabel = document.getElementById('results-count-label');
    const totalShown = state.filteredIndices.length;

    countLabel.textContent = `${totalShown.toLocaleString('de-DE')} von ${BUILDINGS.length.toLocaleString('de-DE')} Gebäuden auf der Karte`;

    const slice = state.filteredIndices.slice(0, 75);
    if (slice.length === 0) {
      listEl.innerHTML = `
        <div style="padding:16px 10px;text-align:center;color:var(--text-muted);font-size:12.5px;">
          Keine Gebäude für diesen Filter gefunden. Setze die Filter oder Suche zurück.
        </div>
      `;
      return;
    }

    listEl.innerHTML = slice
      .map((idx) => {
        const b = BUILDINGS[idx];
        const sel = idx === state.selectedIdx ? 'selected' : '';
        return `
        <div class="result-item ${sel}" data-idx="${idx}">
          <span class="res-dot" style="background:${b._color}"></span>
          <div class="res-body">
            <div class="res-title">${escapeHtml(b.name)}</div>
            <div class="res-meta">${escapeHtml(b.subtype)} · ${escapeHtml(b.district)}</div>
          </div>
          ${b.enterable ? '<span class="res-badge">MLO</span>' : ''}
        </div>
      `;
      })
      .join('');

    listEl.querySelectorAll('.result-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = Number(item.dataset.idx);
        selectBuilding(idx, { flyTo: true });
        if (window.innerWidth <= 760) {
          document.getElementById('sidebar').classList.add('collapsed');
        }
      });
    });
  }

  // =========================================================================
  // TOP-RIGHT HUD CONTROLS & KEYBOARD SHORTCUTS
  // =========================================================================
  document.querySelectorAll('[data-map-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setMapStyle(btn.dataset.mapMode));
  });

  document.getElementById('toggle-districts').addEventListener('click', (e) => {
    state.showDistricts = !state.showDistricts;
    e.currentTarget.classList.toggle('active', state.showDistricts);
    const lyr = ensureDistrictsLayer();
    if (!lyr) return;
    if (state.showDistricts) lyr.addTo(map);
    else map.removeLayer(lyr);
  });

  document.getElementById('toggle-streets').addEventListener('click', (e) => {
    state.showStreets = !state.showStreets;
    e.currentTarget.classList.toggle('active', state.showStreets);
    const lyr = ensureStreetsLayer();
    if (!lyr) return;
    if (state.showStreets) lyr.addTo(map);
    else map.removeLayer(lyr);
  });

  document.getElementById('toggle-grid').addEventListener('click', (e) => {
    state.showGrid = !state.showGrid;
    e.currentTarget.classList.toggle('active', state.showGrid);
    buildingCanvasLayer.redraw();
  });

  document.getElementById('overview-island-btn').addEventListener('click', () => {
    map.flyTo([1450, 120], 2.25, { duration: 0.75 });
  });

  document.getElementById('zoom-in-btn').addEventListener('click', () => map.zoomIn(0.75));
  document.getElementById('zoom-out-btn').addEventListener('click', () => map.zoomOut(0.75));

  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== document.getElementById('search-input')) {
      e.preventDefault();
      document.getElementById('sidebar').classList.remove('collapsed');
      document.getElementById('search-input').focus();
    } else if (e.key === 'Escape') {
      if (state.selectedIdx >= 0) {
        closeBuildingWindow();
      }
    }
  });

  // =========================================================================
  // UTILITIES & BOOTSTRAP
  // =========================================================================
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hexAlpha(hex, alpha) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16) || 56;
    const g = parseInt(clean.slice(2, 4), 16) || 189;
    const bl = parseInt(clean.slice(4, 6), 16) || 248;
    return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function copyText(text, toastMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(toastMsg)).catch(() => fallbackCopy(text, toastMsg));
    } else {
      fallbackCopy(text, toastMsg);
    }
  }

  function fallbackCopy(text, toastMsg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(toastMsg);
    } catch {
      showToast(text);
    }
    document.body.removeChild(ta);
  }

  // Initialize everything
  initSidebarUI();
  applyFilters();
  zoomReadoutEl.textContent = `Zoom ${map.getZoom().toFixed(2).replace(/\.00$/, '')}×`;

  // Deep-link support (#b=poi-44) or open Maze Bank Tower as initial showcase?
  // Only open automatically if URL hash specifies a building; otherwise let the clean map shine and show a welcoming toast!
  const hashMatch = window.location.hash.match(/#b=([^&]+)/);
  if (hashMatch) {
    const targetId = decodeURIComponent(hashMatch[1]);
    if (idToIndex.has(targetId)) {
      const idx = idToIndex.get(targetId);
      setTimeout(() => selectBuilding(idx, { flyTo: true }), 200);
    }
  }

  // Hide loading screen smoothly
  requestAnimationFrame(() => {
    const loader = document.getElementById('loading-screen');
    if (loader) loader.classList.add('hidden');
  });
})();
