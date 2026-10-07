import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {WebSocketServer} from 'ws';
import {openChromeConnectPageViaNative} from '../src/chrome-native-connection.mjs';

async function fixture(reply){
 const dir=await mkdtemp(path.join(os.tmpdir(),'k-native-client-'));
 const descriptorPath=path.join(dir,'link.json');
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const token='a'.repeat(64),calls=[];
 server.on('connection',(socket,req)=>{assert.equal(req.headers.authorization,`Bearer ${token}`);assert.equal(req.headers.origin,undefined);socket.on('message',data=>{const m=JSON.parse(data);calls.push(m);reply?.(socket,m);});});
 await writeFile(descriptorPath,JSON.stringify({version:2,profileId:'a'.repeat(32),endpoint:`ws://127.0.0.1:${server.address().port}/connect`,token}));
 return {descriptorPath,calls,close:async()=>{for(const s of server.clients)s.terminate();await new Promise(r=>server.close(r));}};
}
test('native opener sends exactly one authenticated request and correlates its acknowledgement',async()=>{
 const f=await fixture((s,m)=>s.send(JSON.stringify({id:m.id,ok:true})));
 try{await openChromeConnectPageViaNative(f,'fixture-connect-url');assert.equal(f.calls.length,1);assert.equal(f.calls[0].type,'openConnectPage');assert.equal(f.calls[0].url,'fixture-connect-url');}finally{await f.close();}
});
test('native opener does not retry a timeout or launch a browser fallback',async()=>{
 const f=await fixture();
 try{await assert.rejects(openChromeConnectPageViaNative({...f,timeoutMs:40},'fixture'),/逾時/);assert.equal(f.calls.length,1);}finally{await f.close();}
});
test('native opener rejects a response for another request',async()=>{
 const f=await fixture(s=>s.send(JSON.stringify({id:'other',ok:true})));
 try{await assert.rejects(openChromeConnectPageViaNative(f,'fixture'),/不符/);}finally{await f.close();}
});
test('native opener rejects missing and non-loopback descriptors without network access',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'k-native-invalid-')),descriptorPath=path.join(dir,'link.json');
 await assert.rejects(openChromeConnectPageViaNative({descriptorPath},'fixture'),/手動開啟/);
 await writeFile(descriptorPath,JSON.stringify({version:2,profileId:'a'.repeat(32),endpoint:'ws://example.com:80/connect',token:'a'.repeat(64)}));
 await assert.rejects(openChromeConnectPageViaNative({descriptorPath},'fixture'),/無效/);
});
