import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PassThrough,Writable} from 'node:stream';
import {startNativeHost,encodeNativeMessage,NativeMessageDecoder,K_EXTENSION_ID} from '../scripts/k-browser-native-host.mjs';
import {listChromeProfiles,readChromeProfileDescriptor,openChromeConnectPageViaNative} from '../src/chrome-native-connection.mjs';

const tick=()=>new Promise(r=>setTimeout(r,10));
const ids=['a','b','c','d'].map(c=>c.repeat(32));
function connectUrl(){
 const url=new URL(`chrome-extension://${K_EXTENSION_ID}/connect.html`);
 for(const [key,value] of Object.entries({mcpRelayUrl:`ws://127.0.0.1:43210/extension/${'e'.repeat(64)}`,client:JSON.stringify({name:'profile sentinel fixture'}),protocolVersion:'2',mode:'regular',newTab:'true'}))url.searchParams.set(key,value);
 return url.href;
}

test('four independent native profiles route exact targets; old shutdown and reconnect never erase or switch other profiles',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-native-multi-'));
 const descriptorPath=path.join(root,'link.json'),profileDirectory=path.join(root,'chrome');await mkdir(profileDirectory);
 const hosts=[];
 async function start(profileId,label){
  const stdin=new PassThrough(),requests=[],decoder=new NativeMessageDecoder();
  const stdout=new Writable({write(chunk,_e,callback){for(const m of decoder.push(chunk)){requests.push(m);setImmediate(()=>stdin.write(encodeNativeMessage({id:m.id,ok:true})));}callback();}});
  const host=await startNativeHost({config:{descriptorPath,profileDirectory,extensionId:K_EXTENSION_ID},stdin,stdout,verifyParent:async()=>true,diagnosticPath:path.join(root,'diagnostic.json')});
  hosts.push(host);stdin.write(encodeNativeMessage({type:'profileHello',profileId,incognitoAllowed:profileId!==ids[1]}));
  let descriptor;for(let i=0;i<100;i++){try{descriptor=await readChromeProfileDescriptor({descriptorPath,profileId});if(descriptor.token===host.token)break;}catch{}await tick();}
  assert.equal(descriptor.token,host.token);return {host,requests,label,descriptor};
 }
 try{
  const profiles=[];for(let i=0;i<4;i++)profiles.push(await start(ids[i],`sentinel-${i}`));
  const initial=await listChromeProfiles({descriptorPath});assert.equal(initial.length,4);assert.ok(initial.every(p=>p.connected));assert.deepEqual(initial[1].modes,['regular']);
  assert.doesNotMatch(JSON.stringify(initial),/token|endpoint|pid|sentinel/);
  for(let i=0;i<4;i++){await openChromeConnectPageViaNative({descriptor:profiles[i].descriptor},connectUrl());assert.equal(profiles[i].requests.length,1);}
  const a2=await start(ids[0],'sentinel-0-reconnected');
  await profiles[0].host.close();
  const afterOldClose=await readChromeProfileDescriptor({descriptorPath,profileId:ids[0]});assert.equal(afterOldClose.token,a2.host.token);
  await openChromeConnectPageViaNative({descriptor:afterOldClose},connectUrl());assert.equal(a2.requests.length,1);
  await profiles[2].host.close();
  const after=await listChromeProfiles({descriptorPath,timeoutMs:200});assert.equal(after.find(p=>p.profileId===ids[2]).connected,false);assert.equal(after.filter(p=>p.connected).length,3);
  await assert.rejects(openChromeConnectPageViaNative({descriptor:profiles[2].descriptor,timeoutMs:100},connectUrl()),/不可用|中斷/);
  assert.equal(profiles[1].requests.length,1);assert.equal(profiles[3].requests.length,1,'offline target never falls back to another live profile');
  await assert.rejects(readChromeProfileDescriptor({descriptorPath,profileId:'../../secret'}),/識別碼/);
 }finally{await Promise.all(hosts.map(h=>h.close()));}
});

test('hello timeout destroys only its native input and delayed publication after close cannot overwrite a new instance',async()=>{
 const {writeDescriptor}=await import('../scripts/k-browser-native-host.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'k-native-close-')),profileDirectory=path.join(root,'chrome'),descriptorPath=path.join(root,'link.json');await mkdir(profileDirectory);
 const config={descriptorPath,profileDirectory,extensionId:K_EXTENSION_ID};
 const out=()=>new Writable({write(_c,_e,cb){cb();}});
 const missingInput=new PassThrough();
 const missing=await startNativeHost({config,stdin:missingInput,stdout:out(),verifyParent:async()=>true,requestTimeoutMs:30,diagnosticPath:path.join(root,'timeout.json')});
 await missing.done;assert.equal(missingInput.destroyed,true);
 let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const oldInput=new PassThrough();let publication;
 const old=await startNativeHost({config,stdin:oldInput,stdout:out(),verifyParent:async()=>true,diagnosticPath:path.join(root,'old.json'),writeDescriptorImpl:async(...args)=>{entered();await gate;publication=await writeDescriptor(...args);return publication;}});
 oldInput.write(encodeNativeMessage({type:'profileHello',profileId:ids[0],incognitoAllowed:true}));await started;
 await old.close();assert.equal(oldInput.destroyed,true);
 const input=new PassThrough(),fresh=await startNativeHost({config,stdin:input,stdout:out(),verifyParent:async()=>true,diagnosticPath:path.join(root,'new.json')});
 try{
  input.write(encodeNativeMessage({type:'profileHello',profileId:ids[0],incognitoAllowed:true}));
  for(let i=0;i<100;i++){try{if((await readChromeProfileDescriptor({descriptorPath,profileId:ids[0]})).token===fresh.token)break;}catch{}await tick();}
  release();for(let i=0;i<100&&publication===undefined;i++)await tick();
  assert.equal(publication,false);
  assert.equal((await readChromeProfileDescriptor({descriptorPath,profileId:ids[0]})).token,fresh.token);
 }finally{release();await fresh.close();}
});

test('real fixture process exits after hello timeout while Chrome-side pipe remains open',async()=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const root=await mkdtemp(path.join(os.tmpdir(),'k-native-process-exit-')),profileDirectory=path.join(root,'chrome');await mkdir(profileDirectory);
 const moduleUrl=new URL('../scripts/k-browser-native-host.mjs',import.meta.url).href;
 const source=`import {startNativeHost} from ${JSON.stringify(moduleUrl)};const host=await startNativeHost({config:${JSON.stringify({profileDirectory,descriptorPath:path.join(root,'link.json'),extensionId:K_EXTENSION_ID})},verifyParent:async()=>true,requestTimeoutMs:40,diagnosticPath:${JSON.stringify(path.join(root,'diagnostic.json'))}});await host.done;`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b.toString());child.stdout.resume();
 let timer;try{const result=await Promise.race([once(child,'exit'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture native process did not exit')),3000);})]);assert.equal(result[0],0,stderr);}finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
});
