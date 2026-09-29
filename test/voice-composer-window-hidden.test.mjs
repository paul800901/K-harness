import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('trusted owner window-hidden signal is subscribed by native voice and cancels its current job', async () => {
  const [preload, composer] = await Promise.all([
    readFile(new URL('../src/electron-owner-preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/voice-composer.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(preload, /onWindowHidden:callback=>/u);
  assert.match(preload, /ipcRenderer\.on\('k-native-window-hidden',listener\)/u);
  assert.match(preload, /return\(\)=>ipcRenderer\.removeListener\('k-native-window-hidden',listener\)/u);
  assert.match(composer, /if\(!native\|\|typeof window\.kBrowser\?\.onWindowHidden!=='function'\)return/u);
  assert.match(composer, /window\.kBrowser\.onWindowHidden\(\(\)=>cancelRef\.current\(\)\)/u);
  assert.match(composer, /const cancel=\(\)=>\{const entry=job\.current;if\(!entry\)return;job\.current=null;entry\.session\?\.cancel\(\)/u);
});
