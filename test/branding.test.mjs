import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startDesktop} from '../src/desktop-server.mjs';

test('K branding serves the original image with its image MIME type and uses it as the favicon',async()=>{
 const app=await startDesktop({root:'test',executable:'test',port:0,controllerFactory:()=>({state:{status:'idle'},close:async()=>{}})});
 try{
  const bootstrap=await fetch(app.createLaunchUrl(),{redirect:'manual'});
  const cookie=bootstrap.headers.get('set-cookie').split(';')[0];
  const html=await(await fetch(app.origin,{headers:{cookie}})).text();
  const icon=html.match(/<link rel="icon" type="image\/jpeg" href="([^"]+)"/);
  assert.ok(icon,'built page has its own K icon');
  const response=await fetch(app.origin+icon[1]);assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/^image\/jpeg/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(new URL('../frontend/assets/k-logo.jpg',import.meta.url)));
 }finally{await app.close();}
});
