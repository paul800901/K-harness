import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {startDesktop} from '../src/desktop-server.mjs';

test('manual login progress and code remain human-session-only and never reach a model',async()=>{
 const received=[];
 const app=await startDesktop({root:path.resolve('.'),port:0,requireLaunchToken:true,
  controllerFactory:()=>({state:{},async close(){}}),
  claudeLoginFactory:()=>({progress:()=>({login:{status:'running'}}),submitCode:async({code})=>{received.push(code);return {login:{status:'running',codeSubmitted:true}};},async close(){}}),
 });
 try{
  const route='/api/claude/login/code',body=JSON.stringify({code:'FAKE_CODE_ONLY#FAKE_STATE'});
  const headers={'Content-Type':'application/json','X-K-Request':'1'};
  assert.equal((await fetch(app.origin+route,{method:'POST',headers,body})).status,403);
  assert.equal((await fetch(app.origin+'/api/claude/login')).status,403);
  const boot=await fetch(app.createLaunchUrl(),{redirect:'manual'}),cookie=boot.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(app.origin+route,{method:'POST',headers:{...headers,Cookie:cookie,Origin:'https://evil.test'},body})).status,403);
  assert.equal((await fetch(app.origin+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body})).status,403);
  assert.deepEqual(received,[]);
  const progress=await fetch(app.origin+'/api/claude/login',{headers:{Cookie:cookie}});assert.deepEqual(await progress.json(),{login:{status:'running'}});
  const submitted=await fetch(app.origin+route,{method:'POST',headers:{...headers,Cookie:cookie,Origin:app.origin},body});
  assert.equal(submitted.status,200);assert.ok(!(await submitted.text()).includes('FAKE_CODE_ONLY'));
  assert.deepEqual(received,['FAKE_CODE_ONLY#FAKE_STATE']);
 }finally{await app.close();}
});
