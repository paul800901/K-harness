import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PassThrough,Writable} from 'node:stream';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {
 K_EXTENSION_ID,NativeMessageDecoder,encodeNativeMessage,isAuthorizedUpgrade,parseHostArguments,
 inspectChromeParent,isAllowedChromeParent,startNativeHost,validateConnectUrl,validateHostConfig,
} from '../scripts/k-browser-native-host.mjs';

const extensionOrigin=`chrome-extension://${K_EXTENSION_ID}/`;
const connectUrl=()=>{
 const url=new URL(`chrome-extension://${K_EXTENSION_ID}/connect.html`);
 url.searchParams.set('mcpRelayUrl',`ws://127.0.0.1:43210/extension/${'a'.repeat(64)}`);
 url.searchParams.set('client',JSON.stringify({name:'K browser fixture'}));
 url.searchParams.set('protocolVersion','2');url.searchParams.set('mode','regular');url.searchParams.set('newTab','true');
 return url.toString();
};
const waitFor=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Timed out waiting for fixture state.');};

test('native host framing handles fragmented and consecutive length-prefixed JSON messages',()=>{
 const decoder=new NativeMessageDecoder();
 const a=encodeNativeMessage({id:'a',ok:true}),b=encodeNativeMessage({id:'b',ok:false});
 assert.deepEqual(decoder.push(a.subarray(0,3)),[]);
 assert.deepEqual(decoder.push(Buffer.concat([a.subarray(3),b])),[{id:'a',ok:true},{id:'b',ok:false}]);
 assert.throws(()=>decoder.push(Buffer.from([1,0,0,0,0xff])),/JSON/);
 assert.throws(()=>decoder.push(Buffer.from([0,0,0,0])),/size/);
});

test('native host arguments require the fixed extension origin and absolute config path',()=>{
 const configPath=path.join(os.tmpdir(),'k-browser-native-host.json');
 assert.deepEqual(parseHostArguments(['--config',configPath,extensionOrigin,'--parent-window=0']),{configPath});
 assert.throws(()=>parseHostArguments(['--config','relative.json',extensionOrigin]),/arguments/);
 assert.throws(()=>parseHostArguments(['--config',configPath,'chrome-extension://abcdefghijklmnopabcdefghijklmnop/']),/origin/);
 assert.throws(()=>parseHostArguments(['--config',configPath,extensionOrigin,'--parent-window=x']),/arguments/);
});

test('host config accepts only the fixed extension and absolute profile/descriptor paths',()=>{
 const valid={extensionId:K_EXTENSION_ID,profileDirectory:path.resolve('fake-profile'),descriptorPath:path.resolve('bridge.json')};
 assert.equal(validateHostConfig(valid).extensionId,K_EXTENSION_ID);
 assert.throws(()=>validateHostConfig({...valid,extensionId:'abcdefghijklmnopabcdefghijklmnop'}),/extension/);
 assert.throws(()=>validateHostConfig({...valid,profileDirectory:'relative'}),/profile/);
 assert.throws(()=>validateHostConfig({...valid,extra:'not allowed'}),/fields/);
});

test('Chrome parent diagnostics distinguish a profile mismatch from a timeout while preserving the boolean API',async()=>{
 const options={pid:process.pid,profileDirectory:path.resolve('fake-profile'),platform:'win32'};
 assert.deepEqual(await inspectChromeParent({...options,execFileImpl:async()=>({stdout:'MATCH'})}),{allowed:true,errorCode:null});
 assert.deepEqual(await inspectChromeParent({...options,execFileImpl:async()=>{throw Object.assign(new Error('exit'),{code:1,killed:false,signal:null,stdout:'NO_MATCH',stderr:''});}}),{allowed:false,errorCode:'parent_mismatch'});
 assert.deepEqual(await inspectChromeParent({...options,execFileImpl:async()=>{throw Object.assign(new Error('timeout'),{code:null,killed:true,signal:'SIGTERM',stdout:'',stderr:''});}}),{allowed:false,errorCode:'parent_timeout'});
 assert.equal(await isAllowedChromeParent({...options,execFileImpl:async()=>({stdout:'NO_MATCH'})}),false);
 assert.equal(await isAllowedChromeParent({...options,execFileImpl:async()=>({stdout:'MATCH'})}),true);
});

test('host records a bounded parent failure diagnostic without config secrets',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-native-diagnostic-'));
 const profileDirectory=path.join(root,'profile'),descriptorPath=path.join(root,'private','descriptor.json');
 const diagnosticPath=path.join(root,'host','diagnostic.json');
 await mkdir(profileDirectory,{recursive:true});await mkdir(path.dirname(diagnosticPath),{recursive:true});
 const config={extensionId:K_EXTENSION_ID,profileDirectory,descriptorPath};
 const startedAt=process.hrtime.bigint();
 await assert.rejects(startNativeHost({config,verifyParent:async()=>false,diagnosticPath,startedAt}),/Chrome parent/);
 const diagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));
 assert.deepEqual(Object.keys(diagnostic).sort(),['elapsedMs','errorCode','stage','timestamp','version']);
 assert.doesNotThrow(()=>new Date(diagnostic.timestamp).toISOString());
 assert.equal(diagnostic.stage,'parent_check');
 assert.equal(diagnostic.errorCode,'parent_mismatch');
 assert.equal(Number.isFinite(diagnostic.elapsedMs),true);
 assert.equal(JSON.stringify(diagnostic).includes(profileDirectory),false);
});

test('host records parent-check timeout separately from a profile mismatch',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-native-diagnostic-'));
 const profileDirectory=path.join(root,'profile'),descriptorPath=path.join(root,'private','descriptor.json');
 const diagnosticPath=path.join(root,'host','diagnostic.json');
 await mkdir(profileDirectory,{recursive:true});await mkdir(path.dirname(diagnosticPath),{recursive:true});
 const config={extensionId:K_EXTENSION_ID,profileDirectory,descriptorPath};
 await assert.rejects(startNativeHost({config,checkParent:async()=>({allowed:false,errorCode:'parent_timeout'}),diagnosticPath}),/Chrome parent/);
 const diagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));
 assert.equal(diagnostic.stage,'parent_check');
 assert.equal(diagnostic.errorCode,'parent_timeout');
 assert.doesNotThrow(()=>new Date(diagnostic.timestamp).toISOString());
 assert.equal(typeof diagnostic.elapsedMs,'number');
});

test('host records descriptor-write failure separately from parent failures',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-native-diagnostic-'));
 const profileDirectory=path.join(root,'profile'),descriptorPath=path.join(root,'missing','descriptor.json');
 const diagnosticPath=path.join(root,'host','diagnostic.json');
 await mkdir(profileDirectory,{recursive:true});await mkdir(path.dirname(diagnosticPath),{recursive:true});
 const config={extensionId:K_EXTENSION_ID,profileDirectory,descriptorPath};
 const stdin=new PassThrough(),stdout=new Writable({write(_chunk,_encoding,callback){callback();}});
 await assert.rejects(startNativeHost({config,stdin,stdout,verifyParent:async()=>true,diagnosticPath}),/ENOENT/);
 const diagnostic=JSON.parse(await readFile(diagnosticPath,'utf8'));
 assert.equal(diagnostic.stage,'descriptor_write');
 assert.equal(diagnostic.errorCode,'descriptor_write_failed');
 assert.doesNotThrow(()=>new Date(diagnostic.timestamp).toISOString());
 assert.equal(typeof diagnostic.elapsedMs,'number');
 assert.equal(JSON.stringify(diagnostic).includes('descriptor.json'),false);
});

test('connect URL permits only the exact extension page, local relay, supported mode and required new-tab flow',()=>{
 assert.equal(validateConnectUrl(connectUrl()),connectUrl());
 const duplicateRelay=new URL(connectUrl());duplicateRelay.searchParams.append('mcpRelayUrl',duplicateRelay.searchParams.get('mcpRelayUrl'));
 const externalRelay=new URL(connectUrl());externalRelay.searchParams.set('mcpRelayUrl',`ws://localhost:43210/extension/${'a'.repeat(64)}`);
 for(const value of [
  `https://${K_EXTENSION_ID}/connect.html`,
  `chrome-extension://abcdefghijklmnopabcdefghijklmnop/connect.html`,
  connectUrl().replace('/connect.html','/other.html'),
  externalRelay.toString(),
  connectUrl().replace('mode=regular','mode=incog'),
  connectUrl().replace('newTab=true','newTab=false'),
  `${connectUrl()}&unexpected=1`,
  duplicateRelay.toString(),
 ])assert.throws(()=>validateConnectUrl(value));
});

test('WebSocket authorization requires loopback, exact Host, no Origin and constant-time bearer equality',()=>{
 const request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:1234',authorization:'Bearer '+('c'.repeat(64))}};
 assert.equal(isAuthorizedUpgrade(request,'127.0.0.1:1234','c'.repeat(64)),true);
 assert.equal(isAuthorizedUpgrade({...request,headers:{...request.headers,origin:extensionOrigin}},'127.0.0.1:1234','c'.repeat(64)),false);
 assert.equal(isAuthorizedUpgrade({...request,headers:{...request.headers,host:'localhost:1234'}},'127.0.0.1:1234','c'.repeat(64)),false);
 assert.equal(isAuthorizedUpgrade({...request,socket:{remoteAddress:'192.168.1.4'}},'127.0.0.1:1234','c'.repeat(64)),false);
 assert.equal(isAuthorizedUpgrade({...request,headers:{...request.headers,authorization:'Bearer '+'d'.repeat(64)}},'127.0.0.1:1234','c'.repeat(64)),false);
});

test('host exposes only the authenticated openConnectPage relay and marks its descriptor disconnected on stdin EOF',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-native-host-'));
 const profileDirectory=path.join(root,'chrome-profile'),descriptorPath=path.join(root,'private','descriptor.json');
 await mkdir(profileDirectory,{recursive:true});await mkdir(path.dirname(descriptorPath),{recursive:true});
 const stdin=new PassThrough(),nativeMessages=[],decoder=new NativeMessageDecoder();
 const stdout=new Writable({write(chunk,_encoding,callback){try{nativeMessages.push(...decoder.push(Buffer.from(chunk)));callback();}catch(error){callback(error);}}});
 const config={extensionId:K_EXTENSION_ID,profileDirectory,descriptorPath};
 let checked;
 const host=await startNativeHost({config,stdin,stdout,verifyParent:async info=>{checked=info;return true;},requestTimeoutMs:1000});
 const descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));
 assert.deepEqual(checked,{pid:process.pid,profileDirectory});
 assert.deepEqual(Object.keys(descriptor).sort(),['endpoint','pid','token','version']);
 assert.match(descriptor.token,/^[a-f0-9]{64}$/);
 assert.equal(descriptor.endpoint,host.endpoint);
 const owner=new WebSocket(host.endpoint,{headers:{Authorization:`Bearer ${host.token}`}});
 await once(owner,'open');
 const response=once(owner,'message');owner.send(JSON.stringify({id:'fixture-1',type:'openConnectPage',url:connectUrl()}));
 await waitFor(()=>nativeMessages.length===1);
 assert.deepEqual(nativeMessages[0],{id:'fixture-1',type:'openConnectPage',url:connectUrl()});
 stdin.write(encodeNativeMessage({id:'fixture-1',ok:true}));
 const [body]=await response;assert.deepEqual(JSON.parse(body.toString()),{id:'fixture-1',ok:true});
 const rejected=once(owner,'message');owner.send(JSON.stringify({id:'fixture-2',type:'shell',command:'not supported'}));
 const [rejectedBody]=await rejected;assert.deepEqual(JSON.parse(rejectedBody.toString()),{id:'fixture-2',ok:false,error:'Unsupported request.'});
 assert.equal(nativeMessages.length,1,'unsupported owner command never reaches Chrome extension');
 stdin.end();await host.done;
 const disconnected=JSON.parse(await readFile(descriptorPath,'utf8'));
 assert.deepEqual(disconnected,{version:1,connected:false,pid:process.pid});
});
