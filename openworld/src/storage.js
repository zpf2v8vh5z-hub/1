/* Storage that cannot break the boot sequence.
   In a sandboxed or third-party iframe, touching localStorage throws a
   SecurityError. Reading it at module top level therefore killed the whole
   module before it could render anything — an endless loading screen with no
   error message. Everything goes through here instead, with an in-memory
   fallback so preferences simply do not persist rather than breaking the game. */

const memory = new Map();
let available = null;

function probe() {
  if (available !== null) return available;
  try {
    const key = "__lh_probe__";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function storageAvailable() {
  return probe();
}

export function loadSetting(key, fallback = null) {
  if (probe()) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) return value;
    } catch {
      // fall through to the memory copy
    }
  }
  return memory.has(key) ? memory.get(key) : fallback;
}

export function saveSetting(key, value) {
  memory.set(key, value);
  if (!probe()) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
