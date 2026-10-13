import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {readSource} from './source-text.mjs';

test('voice selects local dictation using the actual native preload after browser cleanup', async () => {
  // Executed as code below, so the preload is read verbatim (compacting would let // comments swallow code).
  const preload = await readFile(new URL('../src/electron-owner-preload.cjs', import.meta.url), 'utf8');
  const composer = await readSource(new URL('../frontend/voice-composer.jsx', import.meta.url));
  const window = {};
  runInNewContext(preload, {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (name, value) => {
          window[name] = value;
        }
      },
      ipcRenderer: {on() {}, removeListener() {}}
    })
  });
  const expression = composer.match(/const (?:remote|desktop|native)=[^;]+;/g).join('\n') + '\nnative';
  assert.equal(runInNewContext(expression, {window}), true);
  assert.equal(runInNewContext(expression, {window: {}}), false);
  assert.equal(runInNewContext(expression, {}), false);
  assert.equal(
    runInNewContext(expression, {document: {documentElement: {dataset: {kRemote: 'true'}}}}),
    true,
    'phone uses private local recognizer, not Web Speech'
  );
});

test('trusted owner window-hidden signal is subscribed by native voice and cancels its current job', async () => {
  const [preload, composer] = await Promise.all([
    readSource(new URL('../src/electron-owner-preload.cjs', import.meta.url)),
    readSource(new URL('../frontend/voice-composer.jsx', import.meta.url))
  ]);
  assert.match(preload, /onWindowHidden:callback=>/u);
  assert.match(preload, /ipcRenderer\.on\('k-native-window-hidden',listener\)/u);
  assert.match(preload, /return\(\)=>ipcRenderer\.removeListener\('k-native-window-hidden',listener\)/u);
  assert.match(composer, /if\(!desktop\)return/u);
  assert.match(
    composer,
    /window\.kBrowser\.onWindowHidden\(\(\)=>\{cancelBackgroundTranscriptions\(\);cancelRef\.current\(\);\}\)/u
  );
  const cancel = composer.slice(composer.indexOf('const cancel=()=>'), composer.indexOf('const attach='));
  assert.match(cancel, /job\.current=null/u);
  assert.match(cancel, /entry\.session\?\.cancel\(\)/u);
  assert.match(cancel, /backgroundTranscriptions\.delete\(entry\.scope\)/u);
});
