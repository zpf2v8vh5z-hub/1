/**
 * Persisted, menu-driven game settings.
 *
 * The menu is generated from SCHEMA, so adding an option means adding one row.
 * Values are stored in localStorage and applied by main.js.
 */

const STORAGE_KEY = 'vice306.settings.v1';

export const DEFAULTS = {
  steerSensitivity: 0.75,   // 0.25 … 2.0
  camSensitivity: 1.0,      // photo-mode mouse look, 0.25 … 2.0
  hud: true,
  bloom: true,
  grain: true,
};

export const SCHEMA = [
  {
    key: 'steerSensitivity',
    label: 'Lenk-Empfindlichkeit',
    hint: 'Wie stark ein Tastendruck das Auto dreht',
    type: 'range',
    min: 0.25, max: 2, step: 0.05,
    format: (v) => `${Math.round(v * 100)} %`,
  },
  {
    key: 'camSensitivity',
    label: 'Kamera (Fotomodus)',
    hint: 'Mausgeschwindigkeit beim Umschauen',
    type: 'range',
    min: 0.25, max: 2, step: 0.05,
    format: (v) => `${Math.round(v * 100)} %`,
  },
  { key: 'hud', label: 'HUD anzeigen', hint: 'Minimap, Tacho, Hinweise', type: 'toggle' },
  { key: 'bloom', label: 'Bloom / Neon-Glühen', hint: 'Weiches Leuchten der Lichter', type: 'toggle' },
  { key: 'grain', label: 'Filmkorn', hint: 'Analoger Look über dem Bild', type: 'toggle' },
];

function clampTo(schema, value) {
  if (schema.type === 'range') {
    const v = Number(value);
    if (!Number.isFinite(v)) return DEFAULTS[schema.key];
    return Math.min(schema.max, Math.max(schema.min, v));
  }
  return !!value;
}

export const settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const row of SCHEMA) {
        if (saved[row.key] !== undefined) settings[row.key] = clampTo(row, saved[row.key]);
      }
    }
  } catch {
    /* corrupted storage -> defaults */
  }
  return settings;
}

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode etc. — settings just won't persist */
  }
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  saveSettings();
}

/**
 * Builds the controls into `container`. Calls onChange(key, value, settings)
 * whenever the player changes something.
 */
export function buildSettingsMenu(container, onChange) {
  container.innerHTML = '';
  const controls = new Map();

  for (const row of SCHEMA) {
    const el = document.createElement('div');
    el.className = 'setting';
    el.dataset.key = row.key;

    const head = document.createElement('div');
    head.className = 'setting-head';

    const label = document.createElement('label');
    label.className = 'setting-label';
    label.htmlFor = `set-${row.key}`;
    label.textContent = row.label;

    const value = document.createElement('span');
    value.className = 'setting-value';

    head.append(label, value);

    const hint = document.createElement('div');
    hint.className = 'setting-hint';
    hint.textContent = row.hint || '';

    el.append(head, hint);

    if (row.type === 'range') {
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `set-${row.key}`;
      input.min = row.min;
      input.max = row.max;
      input.step = row.step;
      input.value = settings[row.key];
      const sync = () => { value.textContent = row.format(settings[row.key]); };
      sync();
      input.addEventListener('input', () => {
        settings[row.key] = clampTo(row, input.value);
        sync();
        onChange(row.key, settings[row.key], settings);
      });
      el.append(input);
      controls.set(row.key, { input, sync });
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle';
      btn.id = `set-${row.key}`;
      const sync = () => {
        const on = !!settings[row.key];
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
        btn.textContent = on ? 'AN' : 'AUS';
        value.textContent = on ? 'AN' : 'AUS';
      };
      sync();
      btn.addEventListener('click', () => {
        settings[row.key] = !settings[row.key];
        sync();
        onChange(row.key, settings[row.key], settings);
      });
      el.append(btn);
      controls.set(row.key, { input: btn, sync });
    }

    container.append(el);
  }

  return {
    /** re-read every control from the settings object */
    refresh() {
      for (const row of SCHEMA) {
        const c = controls.get(row.key);
        if (!c) continue;
        if (row.type === 'range') c.input.value = settings[row.key];
        c.sync();
      }
    },
  };
}
