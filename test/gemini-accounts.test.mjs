import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createGeminiAccounts} from '../src/gemini-accounts.mjs';
import {startDesktop} from '../src/desktop-server.mjs';

const base=path.resolve('.runtime/tests');
const A='a'.repeat(32),B='b'.repeat(32),C='c'.repeat(32);
const email='same@example.test';
const future=Date.parse('2026-10-10T00:00:00Z')/1000;
async function fixture({enabled=true,identity=null,statusFor=()=>authStatus(),root,clock=()=>Date.parse('2026-10-03T12:00:00Z')}={}){
 await mkdir(base,{recursive:true});root??=await mkdtemp(path.join(base,'gemini-accounts-'));
 let current=identity?{accountId:identity.accountId,email:identity.email??email}:null;
 const calls={capture:0,activate:[],activateOptions:[],prepareLogin:0,assertIdle:0,status:0,start:0};
 let idle=true;
 const vault={
  current:async()=>current?{...current}:null,
  capture:async()=>{calls.capture++;if(!current)throw Error('no identity fixture');return {...current};},
  activate:async (id,options={})=>{calls.activate.push(id);calls.activateOptions.push({id,...options});current={accountId:id,email:id===A?'a@example.test':id===B?'b@example.test':'c@example.test'};return {...current};},
  prepareLogin:async()=>{calls.prepareLogin++;current=null;return {previousAccountId:identity?.accountId??null};},
  assertIdle:async()=>{calls.assertIdle++;if(!idle)throw Error('fixture busy');return true;},
 };
 const login={status:async()=>{calls.status++;return statusFor(current,calls.status);},start:async()=>{calls.start++;}};
 return {root,calls,vault,login,get current(){return current?{...current}:null;},set current(value){current=value?{...value}:null;},set idle(v){idle=v;},accounts:createGeminiAccounts({root,login,vault,enabled,clock})};
}
function authStatus(quota={status:'available',windows:[{remainingPercent:80,resetsAt:future}],checkedAt:'2026-10-03T11:59:30.000Z'}){
 return {auth:{status:'authenticated',checkedAt:'2026-10-03T11:59:30.000Z'},quota};
}

test('capture keeps account identity rows separate even when email duplicates',async()=>{
 const f=await fixture({identity:{accountId:A,email},statusFor:current=>authStatus({status:'available',windows:[{remainingPercent:current?.accountId===A?70:20,resetsAt:future}],checkedAt:'2026-10-03T11:59:30.000Z'})});
 await f.accounts.capture();
 f.current={accountId:B,email};
 await f.accounts.capture();
 const rows=(await f.accounts.list()).accounts;
 assert.deepEqual(rows.map(row=>row.id),[A,B]);
 assert.equal(rows[0].email,email);assert.equal(rows[1].email,email);
 assert.deepEqual(rows.map(row=>row.quota.windows[0].remainingPercent),[70,20]);
 assert.equal((await f.accounts.list()).activeAccountId,B);
});

test('disabled manager refuses capture without touching the vault',async()=>{
 const f=await fixture({enabled:false,identity:{accountId:A,email}});
 await assert.rejects(f.accounts.capture(),/尚未允許/u);
 assert.equal(f.calls.capture,0);
});

test('account changes are blocked while a Gemini task is running',async()=>{
 const f=await fixture({identity:{accountId:A,email}});await f.accounts.capture();
 let finish;const work=f.accounts.inspect(()=>new Promise(resolve=>{finish=resolve;}));
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(f.accounts.activate({accountId:A}),/正在工作/u);
 finish();await work;
});

test('same authenticated account allows another concurrent task after auth check ages past 60 seconds',async()=>{
 let now=Date.parse('2026-10-03T12:00:00Z');
 const f=await fixture({identity:{accountId:A,email},clock:()=>now,statusFor:()=>authStatus()});await f.accounts.capture();
 const first=await f.accounts.acquire();now+=61000;
 const second=await f.accounts.acquire();
 assert.equal(second.accountId,A);await second.release();await first.release();
});

test('acquire and inspect wait for an existing quota refresh before entering',async()=>{
 let resume;let statusStarted;let started;
 let defer=false;const f=await fixture({identity:{accountId:A,email},statusFor:()=>defer?new Promise(resolve=>{resume=()=>resolve(authStatus());statusStarted();}):authStatus()});
 await f.accounts.capture();
 defer=true;
 started=new Promise(resolve=>{statusStarted=resolve;});
 const refresh=f.accounts.refresh();await started;
 let invoked=false;const work=f.accounts.acquire().then(async lease=>{invoked=true;await lease.release();});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(invoked,false);
 resume();await Promise.all([refresh,work]);assert.equal(invoked,true);
 started=new Promise(resolve=>{statusStarted=resolve;});
 const nextRefresh=f.accounts.refresh();await started;
 let inspected=false;const inspect=f.accounts.inspect(async()=>{inspected=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(inspected,false);
 resume();await Promise.all([nextRefresh,inspect]);assert.equal(inspected,true);
});

test('failed quota refresh does not allow waiting acquire or inspect to proceed',async()=>{
 let rejectStatus;let statusStarted;const started=new Promise(resolve=>{statusStarted=resolve;});
 let defer=false;const f=await fixture({identity:{accountId:A,email},statusFor:()=>defer?new Promise((_,reject)=>{rejectStatus=reject;statusStarted();}):authStatus()});
 await f.accounts.capture();
 defer=true;
 const refresh=f.accounts.refresh();await started;
 let invoked=false;const work=f.accounts.acquire().then(lease=>{invoked=true;return lease.release();},error=>error);
 let inspected=false;const inspect=f.accounts.inspect(async()=>{inspected=true;}).catch(error=>error);
 await new Promise(resolve=>setImmediate(resolve));rejectStatus(Error('refresh failed'));
 await refresh.catch(()=>{});const [workError,inspectError]=await Promise.all([work,inspect]);
 assert.match(workError.message,/refresh failed/u);assert.match(inspectError.message,/refresh failed/u);
 assert.equal(invoked,false);assert.equal(inspected,false);
});

test('real account switching lock still rejects acquire while changing',async()=>{
 const f=await fixture({identity:{accountId:A,email}});await f.accounts.capture();f.current={accountId:B,email:'b@example.test'};await f.accounts.capture();
 let finish;f.vault.assertIdle=()=>new Promise(resolve=>{finish=resolve;});
 const operation=f.accounts.activate({accountId:A});
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(f.accounts.acquire(),/正在切換/u);finish(true);await operation;
});

test('pending login survives restart and can finish only after authenticated identity is captured',async()=>{
 const f=await fixture({identity:{accountId:A,email}});await f.accounts.capture();await f.accounts.startLogin();
 assert.equal((await f.accounts.list()).loginPending,true);assert.equal(f.calls.start,1);
 const restarted=createGeminiAccounts({root:f.root,login:f.login,vault:f.vault,enabled:true,clock:()=>Date.parse('2026-10-03T12:00:00Z')});
 f.current={accountId:B,email:'b@example.test'};
 await restarted.finishLogin();
 const state=await restarted.list();assert.equal(state.loginPending,false);assert.equal(state.activeAccountId,B);
 assert.deepEqual(state.accounts.map(row=>row.id),[A,B]);
});

test('pending login can be cancelled after restart and restores the previous native identity',async()=>{
 const f=await fixture({identity:{accountId:A,email:'a@example.test'}});await f.accounts.capture();await f.accounts.startLogin();
 const restarted=createGeminiAccounts({root:f.root,login:f.login,vault:f.vault,enabled:true,clock:()=>Date.parse('2026-10-03T12:00:00Z')});
 await restarted.cancelLogin();
 assert.equal(f.current.accountId,A);assert.equal((await restarted.list()).loginPending,false);
});

test('cancelling a pending login restores the prior account over an uncaptured new live identity',async()=>{
 const f=await fixture({identity:{accountId:A,email:'a@example.test'}});await f.accounts.capture();await f.accounts.startLogin();
 f.current={accountId:B,email:'b@example.test'};
 await f.accounts.cancelLogin();
 assert.equal(f.current.accountId,A);
 const state=await f.accounts.list();assert.equal(state.loginPending,false);assert.deepEqual(state.accounts.map(row=>row.id),[A]);
 assert.deepEqual(f.calls.activateOptions.at(-1),{id:A,preserveCurrent:false});
});

test('ordinary activation of a captured account preserves the current identity',async()=>{
 const f=await fixture({identity:{accountId:A,email:'a@example.test'}});await f.accounts.capture();
 f.current={accountId:B,email:'b@example.test'};await f.accounts.capture();
 await f.accounts.activate({accountId:A});
 assert.deepEqual(f.calls.activateOptions.at(-1),{id:A,preserveCurrent:true});
});

test('exhausted current account auto-selects another worker account exactly once without replay',async()=>{
 const f=await fixture({identity:{accountId:A,email:'a@example.test'},statusFor:current=>authStatus({status:'available',windows:[{remainingPercent:current?.accountId===A?0:65,resetsAt:future}],checkedAt:'2026-10-03T11:59:30.000Z'})});
 await f.accounts.capture();f.current={accountId:B,email:'b@example.test'};await f.accounts.capture();
 await f.accounts.activate({accountId:A});f.calls.activate.length=0;
 let invoked=0;const result=await f.accounts.run({worker:true},async()=>{invoked++;return {settled:true,answer:'one result'};});
 assert.equal(invoked,1);assert.equal(result.answer,'one result');assert.equal(result.accountId,B);assert.deepEqual(f.calls.activate,[B]);
});

test('an explicit exhausted account never falls back to another account',async()=>{
 const f=await fixture({identity:{accountId:A,email:'a@example.test'},statusFor:current=>authStatus({status:'available',windows:[{remainingPercent:current?.accountId===A?0:70,resetsAt:future}],checkedAt:'2026-10-03T11:59:30.000Z'})});
 await f.accounts.capture();f.current={accountId:B,email:'b@example.test'};await f.accounts.capture();
 await f.accounts.activate({accountId:A});f.calls.activate.length=0;
 let invoked=0;await assert.rejects(f.accounts.run({accountId:A,worker:true},async()=>{invoked++;}),/額度已用完/u);
 assert.equal(invoked,0);assert.deepEqual(f.calls.activate,[]);
});

test('selecting a cached exhausted account does not activate it before rejection',async()=>{
 const f=await fixture({identity:{accountId:A,email:'a@example.test'},statusFor:current=>authStatus({status:'available',windows:[{remainingPercent:current?.accountId===A?0:70,resetsAt:future}],checkedAt:'2026-10-03T11:59:30.000Z'})});
 await f.accounts.capture();f.current={accountId:B,email:'b@example.test'};await f.accounts.capture();f.calls.activate.length=0;
 await assert.rejects(f.accounts.run({accountId:A,worker:true},async()=>{}),/額度已用完/u);
 assert.deepEqual(f.calls.activate,[]);
});

test('selecting a cached signed-out account does not activate it before rejection',async()=>{
 const f=await fixture({identity:{accountId:A,email:'a@example.test'},statusFor:current=>({auth:{status:current?.accountId===A?'signed-out':'authenticated',checkedAt:'2026-10-03T11:59:30.000Z'},quota:{status:'available',windows:[{remainingPercent:70,resetsAt:future}],checkedAt:'2026-10-03T11:59:30.000Z'}})});
 await f.accounts.capture();f.current={accountId:B,email:'b@example.test'};await f.accounts.capture();f.calls.activate.length=0;
 await assert.rejects(f.accounts.run({accountId:A,worker:true},async()=>{}),/登入/u);
 assert.deepEqual(f.calls.activate,[]);
});

test('unknown network quota is not interpreted as zero or as exhaustion',async()=>{
 const f=await fixture({identity:{accountId:A,email},statusFor:()=>({auth:{status:'authenticated',checkedAt:'2026-10-03T11:59:30.000Z'},quota:{status:'unavailable',windows:[],note:'network unknown'}})});
 await f.accounts.capture();let invoked=0;
 const result=await f.accounts.run({},async()=>{invoked++;return {settled:true};});
 assert.equal(invoked,1);assert.equal(result.accountId,A);
});

test('inactive account quota is marked stale and not presented as current',async()=>{
 const f=await fixture({identity:{accountId:A,email:'a@example.test'}});await f.accounts.capture();
 f.current={accountId:B,email:'b@example.test'};await f.accounts.capture();
 const state=await f.accounts.list();
 assert.equal(state.accounts.find(row=>row.id===A).quota.status,'stale');
 assert.equal(state.accounts.find(row=>row.id===B).quota.status,'available');
});

test('quota refresh with identity changing during status check is discarded',async()=>{
 let f,changeIdentity=false;f=await fixture({identity:{accountId:A,email:'a@example.test'},statusFor:()=>{if(changeIdentity){f.current={accountId:B,email:'b@example.test'};return authStatus({status:'available',windows:[{remainingPercent:1,resetsAt:future}],checkedAt:'2026-10-03T11:59:30.000Z'});}return authStatus({status:'available',windows:[{remainingPercent:55,resetsAt:future}],checkedAt:'2026-10-03T11:59:30.000Z'});}});
 await f.accounts.capture();changeIdentity=true;
 await assert.rejects(f.accounts.refresh(),/已改變.*丟棄/u);
 const state=await f.accounts.list();assert.equal(state.activeAccountId,null);
 assert.notEqual(state.accounts.find(row=>row.id===A).quota.windows?.[0]?.remainingPercent,1);
});

test('an unsettled stop marks account state uncertain and blocks further work or switching',async()=>{
 const f=await fixture({identity:{accountId:A,email}});await f.accounts.capture();
 const lease=await f.accounts.acquire();await lease.release({settled:false});
 assert.equal((await f.accounts.list()).busy,true);
 await assert.rejects(f.accounts.acquire(),/停止尚未確認/u);
 await assert.rejects(f.accounts.activate({accountId:A}),/停止尚未確認/u);
});

test('a failed run marked unsettled leaves the manager uncertain and blocks new work',async()=>{
 const f=await fixture({identity:{accountId:A,email}});await f.accounts.capture();
 const failure=Object.assign(Error('fixture worker stopped'),{settled:false});
 await assert.rejects(f.accounts.run({},async()=>{throw failure;}),error=>error===failure);
 assert.equal((await f.accounts.list()).busy,true);
 await assert.rejects(f.accounts.acquire(),/停止尚未確認/u);
 await assert.rejects(f.accounts.activate({accountId:A}),/停止尚未確認/u);
});

test('unbound native history is rejected before any cross-account work starts',async()=>{
 const f=await fixture({identity:{accountId:A,email}});await f.accounts.capture();
 f.current={accountId:B,email:'b@example.test'};await f.accounts.capture();
 let invoked=0;
 await assert.rejects(f.accounts.run({accountId:B,unboundHistory:true},async()=>{invoked++;}),/沒有帳號綁定/u);
 assert.equal(invoked,0);assert.deepEqual(f.calls.activate,[]);
});

test('Gemini account HTTP routes require the local session and state/usage expose managed-account quota',async()=>{
 const calls=[];const exactId=B;
 const managedUsage={status:'available',windows:[{remainingPercent:42,resetsAt:future}],accountId:exactId,accountEmail:'b@example.test',accounts:[{id:exactId,email:'b@example.test'}]};
 const geminiAccounts={
  cachedUsage:managedUsage,
  list:async()=>{calls.push(['list']);return {enabled:true,activeAccountId:exactId,accounts:[]};},
  activate:async data=>{calls.push(['activate',data.accountId]);return {activeAccountId:data.accountId};},
  refresh:async data=>{calls.push(['refresh',data]);return {activeAccountId:exactId};},
  usage:async refresh=>{calls.push(['usage',refresh]);return managedUsage;},
 };
 const app=await startDesktop({root:path.resolve('.'),port:0,geminiAccounts,requireLaunchToken:true,
  controllerFactory:()=>({state:{usage:{gemini:{accountId:C,quota:{windows:[{remainingPercent:0}]}}}},usage:async()=>({gemini:{accountId:C,quota:{windows:[{remainingPercent:0}]}}}),async close(){}}),
  claudeLoginFactory:()=>({status:async()=>({}),close:async()=>{}}),codexLoginFactory:()=>({status:async()=>({}),close:async()=>{}}),geminiLoginFactory:()=>({status:async()=>({}),start:async()=>({}),close:async()=>{}}),
 });
 try{
  const route=`${app.origin}/api/gemini/accounts/activate`,body=JSON.stringify({accountId:exactId});
  const noSession=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body});assert.equal(noSession.status,403);
  const boot=await fetch(app.createLaunchUrl(),{redirect:'manual'}),cookie=boot.headers.get('set-cookie').split(';')[0];
  const deniedOrigin=await fetch(route,{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test','Content-Type':'application/json','X-K-Request':'1'},body});assert.equal(deniedOrigin.status,403);
  const missingMarker=await fetch(route,{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json'},body});assert.equal(missingMarker.status,403);
  assert.deepEqual(calls,[],'unauthorized requests must not invoke any account operation');
  const list=await fetch(`${app.origin}/api/gemini/accounts`,{headers:{Cookie:cookie}});assert.equal(list.status,200);assert.equal((await list.json()).activeAccountId,exactId);
  const switched=await fetch(route,{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json','X-K-Request':'1'},body});assert.equal(switched.status,200);
  const refreshed=await fetch(`${app.origin}/api/gemini/accounts/refresh`,{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json','X-K-Request':'1'},body:'{}'});assert.equal(refreshed.status,200);
  const state=await (await fetch(`${app.origin}/api/state`,{headers:{Cookie:cookie}})).json();assert.equal(state.usage.gemini.accountId,exactId);
  const usage=await (await fetch(`${app.origin}/api/usage`,{headers:{Cookie:cookie}})).json();assert.equal(usage.gemini.accountId,exactId);
  assert.deepEqual(calls,[['list'],['activate',exactId],['refresh',{}],['usage',false]]);
 }finally{await app.close();}
});



test('malformed account metadata reports a read error without overwriting the registry',async()=>{
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'gemini-accounts-invalid-'));
 const file=path.join(root,'.runtime','gemini-accounts.json');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'{invalid');
 const accounts=createGeminiAccounts({root,login:{},vault:{},enabled:true});
 await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(accounts.list(),SyntaxError);
 assert.equal(await readFile(file,'utf8'),'{invalid');
});

test('uncertain work before first account enrollment can be cleared only after native idle is confirmed',async()=>{
 const f=await fixture();const lease=await f.accounts.acquire();await lease.release({settled:false});
 assert.equal((await f.accounts.list()).uncertain,true);
 f.idle=false;await assert.rejects(f.accounts.refresh(),/fixture busy/);
 assert.equal((await f.accounts.list()).uncertain,true);
 f.idle=true;await f.accounts.refresh();assert.equal((await f.accounts.list()).uncertain,false);
 const next=await f.accounts.acquire();await next.release();
});
