import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {startDesktop} from '../src/desktop-server.mjs';

test('isolated desktop does not grant human session via public GET or forged headers', async () => {
 const desktop=await startDesktop({root:path.resolve('.'),port:0,requireLaunchToken:true,
  controllerFactory:()=>({state:{threadId:'fake'},async close(){}})});
 try{
  for(const resource of ['/','/api/state','/bootstrap?token=made-up']){
   const r=await fetch(desktop.origin+resource,{headers:{Origin:desktop.origin,'X-K-Request':'1'},redirect:'manual'});
   assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);
  }
  const abandoned=desktop.createLaunchUrl(),url=desktop.createLaunchUrl();
  assert.equal((await fetch(abandoned,{redirect:'manual'})).status,403);
  const boot=await fetch(url,{redirect:'manual'});assert.equal(boot.status,303);assert.equal(boot.headers.get('location'),'/');
  const cookie=boot.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^k_session=[a-f0-9]{64}$/);
  assert.equal((await fetch(url,{redirect:'manual'})).status,403);
  const state=await fetch(desktop.origin+'/api/state',{headers:{Cookie:cookie}});assert.equal(state.status,200);assert.deepEqual(await state.json(),{threadId:'fake'});
  const anonymous=await fetch(desktop.origin+'/');assert.equal(anonymous.status,403);assert.equal(anonymous.headers.get('set-cookie'),null);
  const cross=await fetch(desktop.origin+'/api/state',{headers:{Cookie:cookie,Origin:'https://example.invalid'}});assert.equal(cross.status,403);
 }finally{await desktop.close();}
});
