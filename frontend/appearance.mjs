export const APPEARANCE_STORAGE_KEY = 'k-appearance';
export const THEME_STORAGE_KEY = 'k-color-theme';
export const THEME_OPTIONS = Object.freeze(['light', 'warm', 'dark']);

export const INTERFACE_SCALE_OPTIONS = Object.freeze([90, 100, 110, 125, 150]);
export const DIALOGUE_FONT_SIZE_OPTIONS = Object.freeze([14, 15, 16, 17, 18, 19, 20, 21, 22]);

export const DEFAULT_APPEARANCE = Object.freeze({
  interfaceScale: 100,
  dialogueFontSize: 18,
});

const nearestOption = (value, options, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return options.reduce((nearest, option) =>
    Math.abs(option - number) < Math.abs(nearest - number) ? option : nearest,
  options[0]);
};

export function normalizeAppearance(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    interfaceScale: nearestOption(source.interfaceScale, INTERFACE_SCALE_OPTIONS, DEFAULT_APPEARANCE.interfaceScale),
    dialogueFontSize: nearestOption(source.dialogueFontSize, DIALOGUE_FONT_SIZE_OPTIONS, DEFAULT_APPEARANCE.dialogueFontSize),
  };
}

function storageOrNull(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readTheme(storage) {
  try {
    const source = storageOrNull(storage);
    const saved = source?.getItem(THEME_STORAGE_KEY);
    if (THEME_OPTIONS.includes(saved)) return saved;
    // The old two-option UI stored the beige palette as "light". Preserve
    // its actual appearance while giving white and warm distinct names.
    const legacy = source?.getItem('k-theme');
    return legacy === 'light' ? 'warm' : legacy === 'dark' ? 'dark' : 'warm';
  } catch { return 'warm'; }
}

export function saveTheme(theme, storage) {
  const value = THEME_OPTIONS.includes(theme) ? theme : 'warm';
  try { storageOrNull(storage)?.setItem(THEME_STORAGE_KEY, value); } catch {}
  return value;
}

export function readAppearance(storage) {
  const source = storageOrNull(storage);
  if (!source) return { ...DEFAULT_APPEARANCE };
  try {
    const raw = source.getItem(APPEARANCE_STORAGE_KEY);
    return normalizeAppearance(raw ? JSON.parse(raw) : DEFAULT_APPEARANCE);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(value, storage) {
  const normalized = normalizeAppearance(value);
  const target = storageOrNull(storage);
  if (target) {
    try {
      target.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Private browsing or a full localStorage quota should not block the UI.
    }
  }
  return normalized;
}

export function applyAppearance(value, target = globalThis.document?.documentElement) {
  const normalized = normalizeAppearance(value);
  if (!target) return normalized;
  target.dataset.kUiScale = String(normalized.interfaceScale);
  target.dataset.kDialogueFontSize = String(normalized.dialogueFontSize);
  target.style.setProperty('--k-ui-scale', String(normalized.interfaceScale / 100));
  target.style.setProperty('--k-dialogue-font-size', `${normalized.dialogueFontSize}px`);
  return normalized;
}
