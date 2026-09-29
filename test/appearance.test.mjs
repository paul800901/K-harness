import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  normalizeAppearance,
  readAppearance,
  saveAppearance,
  readTheme,
  saveTheme,
  THEME_OPTIONS,
  DIALOGUE_FONT_SIZE_OPTIONS,
} from '../frontend/appearance.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('appearance settings use bounded options and persist only to K localStorage', () => {
  const storage = memoryStorage();
  assert.deepEqual(normalizeAppearance({interfaceScale: 149, dialogueFontSize: 19}), {
    interfaceScale: 150,
    dialogueFontSize: 19,
  });
  assert.deepEqual(readAppearance(storage), DEFAULT_APPEARANCE);
  const saved = saveAppearance({interfaceScale: 125, dialogueFontSize: 22}, storage);
  assert.deepEqual(saved, {interfaceScale: 125, dialogueFontSize: 22});
  assert.equal(JSON.parse(storage.getItem(APPEARANCE_STORAGE_KEY)).interfaceScale, 125);
  assert.deepEqual(readAppearance(storage), saved);
});

test('every dialogue font size from 14 through 22 is selectable and preserved',()=>{
  assert.deepEqual(DIALOGUE_FONT_SIZE_OPTIONS,[14,15,16,17,18,19,20,21,22]);
  const storage=memoryStorage();
  for(const size of DIALOGUE_FONT_SIZE_OPTIONS){
    saveAppearance({dialogueFontSize:size},storage);
    assert.equal(readAppearance(storage).dialogueFontSize,size);
  }
});

test('appearance settings apply scale and dialogue font size to the document root', () => {
  const style = new Map();
  const root = {dataset: {}, style: {setProperty: (key, value) => style.set(key, value)}};
  assert.deepEqual(applyAppearance({interfaceScale: 90, dialogueFontSize: 20}, root), {
    interfaceScale: 90,
    dialogueFontSize: 20,
  });
  assert.equal(root.dataset.kUiScale, '90');
  assert.equal(root.dataset.kDialogueFontSize, '20');
  assert.equal(style.get('--k-ui-scale'), '0.9');
  assert.equal(style.get('--k-dialogue-font-size'), '20px');
});

test('three theme choices preserve legacy beige without overriding a new white selection', () => {
  const storage = memoryStorage();
  assert.deepEqual(THEME_OPTIONS, ['light', 'warm', 'dark']);
  assert.equal(readTheme(storage), 'warm');
  storage.setItem('k-theme', 'light');
  assert.equal(readTheme(storage), 'warm');
  for (const theme of THEME_OPTIONS) {
    saveTheme(theme, storage);
    assert.equal(readTheme(storage), theme);
  }
  saveTheme('light', storage);
  assert.equal(readTheme(storage), 'light');
  assert.equal(storage.getItem('k-theme'), 'light');
  const dark = memoryStorage();dark.setItem('k-theme', 'dark');
  assert.equal(readTheme(dark), 'dark');
});

test('visual refresh preserves saved font sizes and scale without migration', () => {
  const storage=memoryStorage();
  storage.setItem(APPEARANCE_STORAGE_KEY,JSON.stringify({interfaceScale:110,dialogueFontSize:18}));
  const before=storage.getItem(APPEARANCE_STORAGE_KEY);
  assert.deepEqual(readAppearance(storage),{interfaceScale:110,dialogueFontSize:18});
  assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY),before);
  assert.equal(DEFAULT_APPEARANCE.dialogueFontSize,18);
  assert.equal(saveTheme('invalid',storage),'warm');
  assert.equal(readTheme({getItem(){throw Error('unavailable');}}),'warm');
});
