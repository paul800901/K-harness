import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createGeminiLogin,geminiQuotaWindows} from '../src/gemini-login.mjs';
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

test('Gemini auth requires the native account report, including exhausted quota, and distinguishes signed out from unknown',async()=>{
 const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});const cwd=await mkdtemp(path.join(base,'gemini-auth-')),calls=[];
 let report={code:0,stdout:'Gemini Models\tWeekly Limit Remaining\t0%\t2026-10-10T05:23:48Z\n',stderr:''};
 const login=createGeminiLogin({cwd,env:{LOCALAPPDATA:cwd},exists:async()=>{},run:async(_binary,args)=>{
  calls.push(args);return args[0]==='--version'?{code:0,stdout:'1.2.16'}:args[0]==='models'?{code:0,stdout:'gemini-3.8-flash-low'}:report;
 }});
 const verified=await login.status();assert.equal(verified.auth.loggedIn,true);assert.ok(Date.parse(verified.auth.checkedAt));assert.deepEqual(calls.at(-1),['-p','/usage']);
 report={code:1,stdout:'',stderr:'authentication required'};const out=await login.status();assert.equal(out.auth.loggedIn,false);assert.equal(out.available,true);assert.match(out.reason,/尚未登入/);
 for(const invalid of [{code:0,stdout:'gemini-3.8-flash-low'},{code:0,stdout:'new unknown report format'},{code:1,stderr:'network timeout secret diagnostic'},{code:0,stdout:'Gemini Models\tWeekly Limit Remaining\t97%\t2026-10-10T05:23:48Z',reason:'timeout'}]){
  report=invalid;const unknown=await login.status();assert.equal(unknown.auth.status,'unknown');assert.equal(unknown.auth.loggedIn,undefined);assert.doesNotMatch(unknown.reason,/secret diagnostic/);
 }
 calls.length=0;const catalog=await login.status({checkAuth:false});assert.equal(catalog.auth,undefined);assert.deepEqual(calls,[['--version'],['models']]);
});

test('refresh and opening Gemini preserve the user native onboarding and privacy settings byte for byte',async()=>{
 const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});const cwd=await mkdtemp(path.join(base,'gemini-preferences-'));
 const login=createGeminiLogin({cwd,env:{LOCALAPPDATA:cwd,SystemRoot:process.env.SystemRoot??cwd},exists:async()=>{},execImpl:async()=>{},run:async(_binary,args)=>({code:0,stdout:args[0]==='models'?'gemini-3.8-flash-low':'fixture'})});
 await login.status();const settings=path.join(cwd,'agent-home/gemini/account/.gemini/antigravity-cli/settings.json');const initial=JSON.parse(await readFile(settings,'utf8'));assert.ok(initial.permissions.deny.includes('write_file(*)'));
 const userSettings=JSON.stringify({...initial,colorScheme:'dark',enableTelemetry:false,onboardingComplete:true},null,2)+'\n';await writeFile(settings,userSettings);
 await login.status();await login.start();assert.equal(await readFile(settings,'utf8'),userSettings);
});

test('Gemini quota preserves official remaining percentages and reset times without mixing other providers',()=>{
 const windows=geminiQuotaWindows('Gemini Models\tWeekly Limit Remaining\t97%\t2026-10-09T14:10:46Z\nGemini Models\tFive Hour Limit Remaining\t0%\t2026-10-03T08:01:09Z\nClaude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-10T05:23:48Z\nGemini Models\tWeekly Limit Remaining\t101%\t2026-10-09T14:10:46Z\nGemini Models\tFive Hour Limit Remaining\t97%\tunknown');
 assert.deepEqual(windows.map(w=>[w.key,w.remainingPercent,w.minutes]),[['seven_day',97,10080],['five_hour',0,300]]);assert.equal(windows[0].resetsAt,Date.parse('2026-10-09T14:10:46Z')/1000);
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
