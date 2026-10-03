import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {createGeminiLogin} from '../src/gemini-login.mjs';
import {startDesktop} from '../src/desktop-server.mjs';

test('Antigravity catalog never claims authenticated status and login opens only its native program',async()=>{
 const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});const cwd=await mkdtemp(path.join(base,'gemini-login-')),calls=[];
 const env={LOCALAPPDATA:path.join(cwd,'Paulus-local'),SystemRoot:process.env.SystemRoot??cwd,GEMINI_API_KEY:'do-not-inherit',HOME:'do-not-use'};
 const login=createGeminiLogin({cwd,env,exists:async()=>{},run:async(_b,args)=>({code:0,stdout:args[0]==='models'?'gemini-3.8-flash-low\n':'agy fixture'}),execImpl:async(...args)=>{calls.push(args);}});
 const status=await login.status();assert.equal(status.available,true);assert.equal(status.auth.loggedIn,undefined);assert.deepEqual(status.models,['gemini-3.8-flash-low']);
 await login.start();const [binary,args,options]=calls[0];assert.ok(binary.endsWith('powershell.exe'));assert.ok(args.at(-1).includes('Start-Process'));assert.ok(args.at(-1).includes('-WindowStyle Normal'));assert.equal(options.env.GEMINI_API_KEY,undefined);assert.equal(options.env.K_AGY_LOGIN_EXECUTABLE,path.join(env.LOCALAPPDATA,'agy/bin/agy.exe'));assert.equal(options.env.HOME,path.join(cwd,'agent-home/gemini/account'));
});

test('missing agy yields an actionable isolated failure without starting a login process',async()=>{
 let invoked=false;const cwd=path.resolve('.runtime/tests/gemini-missing-login');
 const login=createGeminiLogin({cwd,env:{LOCALAPPDATA:cwd},exists:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});},execImpl:async()=>{invoked=true;}});
 assert.match((await login.status()).reason,/找不到 agy.*安裝.*登入/);await assert.rejects(login.start(),/找不到 agy/);assert.equal(invoked,false);
});

test('Gemini login remains behind the same human session and origin checks as existing cores',async()=>{
 let starts=0;const app=await startDesktop({root:path.resolve('.'),port:0,controllerFactory:()=>({state:{},close:async()=>{}}),geminiLoginFactory:()=>({status:async()=>({available:true}),start:async()=>{starts++;return {login:{status:'opened'}};}})});
 try{
  const route=app.origin+'/api/gemini/login',headers={'Content-Type':'application/json','X-K-Request':'1'};
  assert.equal((await fetch(route,{method:'POST',headers,body:'{}'})).status,403);assert.equal((await fetch(app.origin+'/api/gemini/auth')).status,403);
  const boot=await fetch(app.createLaunchUrl(),{redirect:'manual'}),cookie=boot.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(route,{method:'POST',headers:{...headers,Cookie:cookie,Origin:'https://evil.test'},body:'{}'})).status,403);
  assert.equal((await fetch(route,{method:'POST',headers:{Cookie:cookie},body:'{}'})).status,403);assert.equal(starts,0);
  assert.equal((await fetch(route,{method:'POST',headers:{...headers,Cookie:cookie,Origin:app.origin},body:'{}'})).status,200);assert.equal(starts,1);
 }finally{await app.close();}
});
