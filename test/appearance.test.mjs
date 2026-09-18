import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
  assert.equal(readTheme(storage), 'light');
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

test('stylesheet keeps distinct white, warm, dark themes and responsive controls', async () => {
  const css = await readFile(new URL('../frontend/style.css', import.meta.url), 'utf8');
  assert.match(css, /--bg:#fffcf8/);
  assert.match(css, /--side:#f8f3e9/);
  assert.match(css, /--blue:#007acc/);
  assert.match(css, /\[data-theme=dark\]/);
  assert.match(css, /:root\[data-theme=warm\]\{--bg:#fffcf8/);
  assert.match(css, /--bg:#fff;/);
  assert.doesNotMatch(css, /:root:not\(\[data-theme=dark\]\)\{--bg:#fffcf8/);
  assert.match(css, /zoom:var\(--k-ui-scale,1\)/);
  assert.match(css, /--k-dialogue-font-size/);
  assert.match(css, /flex-wrap:wrap/);
});
