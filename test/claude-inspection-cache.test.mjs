import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectClaude,invalidateClaudeInspection} from '../src/claude-host.mjs';

const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
await mkdir(base,{recursive:true});

async function fixture(){
 const dir=await mkdtemp(path.join(base,'claude-inspection-cache-'));
 const counter=path.join(dir,'calls.txt'),statusFile=path.join(dir,'auth-status.json');
 const script=path.join(dir,'fake-claude.mjs');
 await writeFile(counter,'','utf8');
 await writeFile(statusFile,JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'}),'utf8');
 await writeFile(script,`import {appendFileSync,readFileSync} from 'node:fs';
const args=process.argv.slice(2);appendFileSync(${JSON.stringify(counter)},'call\\n');
if(args.includes('--version')){console.log('2.1.280 (Claude Code)');process.exit(0)}
if(args.includes('--help')&&args.includes('auth')){console.log('login logout status');process.exit(0)}
if(args.includes('status')){const status=JSON.parse(readFileSync(${JSON.stringify(statusFile)},'utf8'));console.log(JSON.stringify(status));process.exit(status.loggedIn?0:1)}
process.exit(13);
`,'utf8');
 await mkdir(path.join(dir,'config'),{recursive:true});
 return {dir,counter,statusFile,commandSpec:{command:process.execPath,argsPrefix:[script]},env:{...process.env,USERPROFILE:path.join(dir,'home'),CLAUDE_CONFIG_DIR:path.join(dir,'config')}};
}

const calls=async file=>(await readFile(file,'utf8')).split('call').length-1;

test('caches only successful auth/version inspection for five minutes and rechecks provider settings each call',async()=>{
 invalidateClaudeInspection();
 const fake=await fixture(),realNow=Date.now;let now=1_000_000;Date.now=()=>now;
 try{
  const first=await inspectClaude({commandSpec:fake.commandSpec,cwd:fake.dir,env:fake.env});
  assert.equal(first.available,true);assert.equal(await calls(fake.counter),3);
  now+=299_999;
  const second=await inspectClaude({commandSpec:fake.commandSpec,cwd:fake.dir,env:fake.env});
  assert.equal(second.available,true);assert.equal(await calls(fake.counter),3);
  const settingsPath=path.join(fake.env.CLAUDE_CONFIG_DIR,'settings.json');
  await writeFile(settingsPath,JSON.stringify({env:{ANTHROPIC_API_KEY:'FAKE_NOT_A_REAL_KEY'}}),'utf8');
  const blocked=await inspectClaude({commandSpec:fake.commandSpec,cwd:fake.dir,env:fake.env});
  assert.equal(blocked.available,false);assert.match(blocked.reason,/ANTHROPIC_API_KEY/);assert.equal(await calls(fake.counter),3);
  await writeFile(settingsPath,JSON.stringify({permissions:{deny:['Read(*.env.local)']}}),'utf8');
  now+=2;
  const expired=await inspectClaude({commandSpec:fake.commandSpec,cwd:fake.dir,env:fake.env});
  assert.equal(expired.available,true);assert.equal(await calls(fake.counter),6);
 }finally{Date.now=realNow;invalidateClaudeInspection();}
});

test('does not cache unsuccessful auth inspection and exposes explicit invalidation',async()=>{
 invalidateClaudeInspection();
 const fake=await fixture();
 try{
  await writeFile(fake.statusFile,JSON.stringify({loggedIn:false,authMethod:'none',apiProvider:'firstParty'}),'utf8');
  assert.equal((await inspectClaude({commandSpec:fake.commandSpec,cwd:fake.dir,env:fake.env})).available,false);
  assert.equal((await inspectClaude({commandSpec:fake.commandSpec,cwd:fake.dir,env:fake.env})).available,false);
  assert.equal(await calls(fake.counter),6);
  await writeFile(fake.statusFile,JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'}),'utf8');
  assert.equal((await inspectClaude({commandSpec:fake.commandSpec,cwd:fake.dir,env:fake.env})).available,true);
  assert.equal(await calls(fake.counter),9);
  invalidateClaudeInspection();
  assert.equal((await inspectClaude({commandSpec:fake.commandSpec,cwd:fake.dir,env:fake.env})).available,true);
  assert.equal(await calls(fake.counter),12);
 }finally{invalidateClaudeInspection();}
});
