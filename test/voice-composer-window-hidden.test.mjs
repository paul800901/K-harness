import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('voice selects local dictation using the actual native preload after browser cleanup', async () => {
  const preload=await readFile(new URL('../src/electron-owner-preload.cjs',import.meta.url),'utf8');
  const composer=await readFile(new URL('../frontend/voice-composer.jsx',import.meta.url),'utf8');
  const window={};
  runInNewContext(preload,{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{window[name]=value;}},ipcRenderer:{on(){},removeListener(){}}})});
  const expression=composer.match(/const (?:remote|desktop|native)=[^;]+;/g).join('\n')+'\nnative';
  assert.equal(runInNewContext(expression,{window}),true);
  assert.equal(runInNewContext(expression,{window:{}}),false);
  assert.equal(runInNewContext(expression,{}),false);
  assert.equal(runInNewContext(expression,{document:{documentElement:{dataset:{kRemote:'true'}}}}),true,'phone uses private local recognizer, not Web Speech');
});

test('trusted owner window-hidden signal is subscribed by native voice and cancels its current job', async () => {
  const [preload, composer] = await Promise.all([
    readFile(new URL('../src/electron-owner-preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/voice-composer.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(preload, /onWindowHidden:callback=>/u);
  assert.match(preload, /ipcRenderer\.on\('k-native-window-hidden',listener\)/u);
  assert.match(preload, /return\(\)=>ipcRenderer\.removeListener\('k-native-window-hidden',listener\)/u);
  assert.match(composer, /if\(!desktop\)return/u);
  assert.match(composer, /window\.kBrowser\.onWindowHidden\(\(\)=>cancelRef\.current\(\)\)/u);
  assert.match(composer, /const cancel=\(\)=>\{const entry=job\.current;if\(!entry\)return;job\.current=null;entry\.session\?\.cancel\(\)/u);
});
