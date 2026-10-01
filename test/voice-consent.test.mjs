import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const read=name=>readFile(new URL(`../frontend/${name}`,import.meta.url),'utf8');
const noNativeConsentStorage={getItem(){throw Error('Native dictation must not consult consent storage');}};

test('native voice skips K consent after every reopen; browser speech still requires consent',async()=>{
 const source=await read('voice-composer.jsx');
 const start=source.indexOf('const start=async()=>{')+'const start=async()=>{'.length;
 const gate=source.slice(start,source.indexOf('  if(native){',start));
 for(let reopen=0;reopen<2;reopen++){
  let prompted=false;
  await runInNewContext(`(async()=>{${gate}})`,{disabled:false,job:{current:null},native:true,sessionStorage:noNativeConsentStorage,setConsent:()=>{prompted=true;}})();
  assert.equal(prompted,false);
 }
 for(const saved of [null,'yes']){
  let prompted=false;
  await runInNewContext(`(async()=>{${gate}})`,{disabled:false,job:{current:null},native:false,consentKey:'k-browser-dictation-consent',sessionStorage:{getItem:()=>saved},setConsent:()=>{prompted=true;},activity:{current(){}}})();
  assert.equal(prompted,saved!=='yes');
 }
});

test('main composer claims the microphone before native start without a consent prompt',async()=>{
 const source=await read('main.jsx');
 const handler=source.match(/const startComposerVoice=(.*);/)[1];
 for(const permitted of [true,false]){
  const calls=[];
  runInNewContext(handler,{voice:{native:true,start:()=>calls.push('start')},voiceOwnerRef:{current:null},sessionStorage:noNativeConsentStorage,claimVoice:()=>{calls.push('claim');return permitted;}})();
  assert.deepEqual(calls,permitted?['claim','start']:['claim']);
 }
 const calls=[];
 runInNewContext(handler,{voice:{native:false,consentKey:'browser',start:()=>calls.push('prompt')},voiceOwnerRef:{current:null},sessionStorage:{getItem:()=>null},claimVoice:()=>calls.push('claim')})();
 assert.deepEqual(calls,['prompt']);
});

test('quote dictation keeps microphone ownership and skips only native consent',async()=>{
 const source=await read('response-annotations.jsx');
 const handler=source.match(/const startVoice=(.*);/)[1];
 for(const permitted of [true,false]){
  const calls=[];
  runInNewContext(handler,{voice:{native:true,start:()=>calls.push('start')},sessionStorage:noNativeConsentStorage,reserveVoice:()=>{calls.push('reserve');return permitted;},setConsent:()=>calls.push('prompt')})();
  assert.deepEqual(calls,permitted?['reserve','start']:['reserve']);
 }
 const calls=[];
 runInNewContext(handler,{voice:{native:false,consentKey:'browser',start:()=>calls.push('start')},sessionStorage:{getItem:()=>null},reserveVoice:()=>calls.push('reserve'),setConsent:()=>calls.push('prompt')})();
 assert.deepEqual(calls,['prompt']);
});
