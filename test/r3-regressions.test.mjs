import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {syncBuiltinESMExports} from 'node:module';
import {createUnifiedController} from '../src/unified-controller.mjs';
import {saveUiMessageTiming,loadUiMessageTiming} from '../src/ui-message-timing.mjs';

async function fixture(){const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await fs.mkdir(base,{recursive:true});return fs.mkdtemp(path.join(base,'r3-'));}

test('R3 official new Codex model is selectable without changing K',async()=>{
 const root=await fixture(),model={model:'gpt-future-official',supportedReasoningEfforts:[{reasoningEffort:'high'}]};
 const c=createUnifiedController({root,codexFactory:()=>({state:{},models:async()=>({models:[model]})}),claudeFactory:()=>({state:{},models:async()=>({models:[]})})});
 const rows=(await c.models()).models;
 assert.deepEqual(rows.find(x=>x.model===model.model),{...model,provider:'codex'});
});

test('R3 timing projection survives a brief Windows replacement conflict',async t=>{
 const root=await fixture(),original=fs.rename;let attempts=0;
 const mock=t.mock.method(fs,'rename',async(a,b)=>{if(++attempts===1)throw Object.assign(Error('reader lock'),{code:'EACCES'});return original(a,b);});
 syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 await saveUiMessageTiming(root,'test',{messages:{one:{startedAt:123}},tools:{}});
 assert.equal(attempts,2);assert.equal((await loadUiMessageTiming(root,'test')).messages.one.startedAt,123);
});
