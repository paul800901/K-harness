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

test('trusted owner window-hidden signal is subscribed by native voice; it ends capture, cancels only a starting microphone', async () => {
  const [preload, composer] = await Promise.all([
    readSource(new URL('../src/electron-owner-preload.cjs', import.meta.url)),
    readSource(new URL('../frontend/voice-composer.jsx', import.meta.url))
  ]);
  assert.match(preload, /onWindowHidden:callback=>/u);
  assert.match(preload, /ipcRenderer\.on\('k-native-window-hidden',listener\)/u);
  assert.match(preload, /return\(\)=>ipcRenderer\.removeListener\('k-native-window-hidden',listener\)/u);
  assert.match(composer, /if\(!desktop\)return/u);
  assert.match(composer, /window\.kBrowser\.onWindowHidden\(/u);
  // Behavior (starting → canceled, late stream stopped; recording → draft-only; transcribing → continues)
  // is exercised in the UI probes.
  const hidden = composer.slice(composer.indexOf('const stopHiddenRecording='), composer.indexOf('const hiddenRef='));
  assert.match(hidden, /stop\(false\)/u);
  assert.match(hidden, /'starting'\)cancel\(\)/u);
  assert.doesNotMatch(hidden, /transcribing/u);
});
