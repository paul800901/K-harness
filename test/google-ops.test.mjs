import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,writeFile,readFile,symlink} from 'node:fs/promises';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {googleOpsMcp,googleOpsTools,callGoogleOps,createGoogleOpsServer} from '../src/google-ops-mcp.mjs';
import {geminiSettings,geminiMcpConfig} from '../src/gemini-worker.mjs';
import {createGeminiController} from '../src/gemini-controller.mjs';

async function workspace(){await mkdir('.runtime/tests',{recursive:true});return mkdtemp(path.resolve('.runtime/tests/google-ops-'));}
async function install(root){await mkdir(path.join(root,'google_ops_worker'),{recursive:true});await mkdir(path.join(root,'.venv/Scripts'),{recursive:true});await writeFile(path.join(root,'google_ops_worker/google_ops_client.py'),'# test only');await writeFile(path.join(root,'.venv/Scripts/python.exe'),'test only');}

async function bind(owner,directory){await mkdir(path.join(owner,'.runtime'),{recursive:true});await writeFile(path.join(owner,'.runtime/google-ops.json'),JSON.stringify({directory}));}

test('Google Ops mounts only owner-bound workspace or immediate parent; no automatic project registration',async()=>{
 const owner=await workspace(),root=await workspace();await install(root);
 assert.equal(await googleOpsMcp(root,{root:owner}),null,'project files alone do not grant executable registration');
 await bind(owner,root);const direct=await googleOpsMcp(root,{root:owner,nodeExecutable:process.execPath});
 assert.equal(direct.command,process.execPath);assert.equal(direct.args[2],root);assert.doesNotMatch(JSON.stringify(direct),/token|secret|\.env/iu);
 const parent=await workspace(),child=path.join(parent,'02_廣告_AdsControl');await install(child);await bind(owner,child);
 assert.equal((await googleOpsMcp(parent,{root:owner})).args[2],child);
 assert.equal(await googleOpsMcp(root,{root:owner}),null,'unrelated project cannot inherit binding');
 assert.equal(await googleOpsMcp(path.join(child,'google_ops_worker'),{root:owner}),null);
});

test('Google Ops schemas reject arbitrary URLs, commands, mutations, traversal and invalid paging',()=>{
  assert.deepEqual(Object.keys(googleOpsTools),['gbp_accounts','gbp_locations','gbp_reviews','gbp_local_posts']);
  for(const args of [{account:'accounts/../other'},{account:'https://evil.test'},{account:'accounts/123',body:'write'},{account:'accounts/123',pageToken:''}])assert.equal(googleOpsTools.gbp_locations.schema.safeParse(args).success,false);
  assert.equal(googleOpsTools.gbp_reviews.schema.safeParse({account:'accounts/123',location:'locations/45',pageToken:'next&token'}).success,true);
});

test('Missing optional Google Ops installation never blocks ordinary sessions',async()=>{
  const owner=await workspace(),project=await workspace();
  await bind(owner,path.join(project,'missing'));
  assert.equal(await googleOpsMcp(project,{root:owner}),null);
  assert.equal(await googleOpsMcp(undefined,{root:owner}),null);
  await bind(owner,project);
  assert.equal(await googleOpsMcp(project,{root:owner}),null,'client/Python missing');
});

test('Google Ops subprocess uses no shell, isolated Python, bounded output, cancellation and minimal environment',async()=>{
  const signal=new AbortController().signal;let observed;
  const value=await callGoogleOps('root','python','gbp_accounts',{}, {signal,env:{PATH:'path',SYSTEMROOT:'windows',GOOGLE_OPS_REFRESH_TOKEN:'never-pass',NODE_OPTIONS:'--bad'},execImpl:async(...args)=>{observed=args;return {stdout:'{"ok":true,"data":{"accounts":[]}}'};}});
  assert.equal(value.ok,true);const [command,args,options]=observed;
  assert.equal(command,'python');assert.deepEqual(args.slice(0,3),['-B','-I','-S']);assert.equal(args.at(-2),'gbp_accounts');assert.equal(options.windowsHide,true);assert.equal(options.shell,false);assert.equal(options.signal,signal);
  assert.deepEqual(options.env,{PATH:'path',SYSTEMROOT:'windows'});assert.equal(options.timeout,45000);
  await assert.rejects(callGoogleOps('root','python','gbp_reply_review',{}),/不支援/);
});

test('Google Ops MCP returns paged live data and safe failures; invalid calls never reach client',async()=>{
  let calls=0,fail=false;const server=createGoogleOpsServer({root:'root',python:'python',call:async()=>{calls++;if(fail)throw Error('SECRET_SHOULD_NOT_LEAK');return {ok:true,fetchedAt:'now',data:{nextPageToken:'next',accounts:[]}};}});
  const client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{
    const tools=(await client.listTools()).tools;assert.equal(tools.length,4);assert.ok(tools.every(t=>t.annotations.readOnlyHint&&!t.annotations.destructiveHint));
    const data=await client.callTool({name:'gbp_accounts',arguments:{}});assert.equal(JSON.parse(data.content[0].text).data.nextPageToken,'next');
    const invalid=await client.callTool({name:'gbp_locations',arguments:{account:'accounts/../no'}});assert.equal(invalid.isError,true);assert.equal(calls,1);
    fail=true;const failure=await client.callTool({name:'gbp_accounts',arguments:{}});assert.equal(failure.isError,true);assert.doesNotMatch(JSON.stringify(failure),/SECRET/);assert.equal(calls,2);
  }finally{await client.close();await server.close();}
});

test('Gemini Google Ops permission adds only read connector, never commands/write/broader MCP allow',()=>{
  const server={command:'node',args:['connector','--serve',path.resolve('.runtime/tests/ops'),'python']},root=path.resolve('.runtime/tests');
  for(const access of ['read-only','workspace-write','danger-full-access']){
    const settings=geminiSettings(root,access,[],null,server);
    assert.ok(settings.permissions.allow.includes('mcp(k_google_ops/*)'));assert.ok(!settings.permissions.deny.includes('mcp(*)'));assert.ok(!settings.permissions.allow.includes('mcp(*)'));
    if(access!=='danger-full-access')assert.ok(settings.permissions.deny.includes('command(*)'));
    if(access!=='danger-full-access')for(const folder of ['google_ops_worker','.venv'])assert.ok(settings.permissions.deny.includes(`write_file(${path.join(server.args[2],folder)})`));
    if(access==='read-only')assert.ok(settings.permissions.deny.includes('write_file(*)'));
  }
  assert.deepEqual(geminiMcpConfig(null,server).mcpServers,{k_google_ops:server});
});

test('Gemini main actual profile receives Google connector independently of Chrome',async()=>{
  const root=await workspace(),project=await workspace();await install(project);await bind(root,project);
  const controller=createGeminiController({root,geminiExecutable:path.resolve('fake-agy.exe'),loginFactory:()=>({status:async()=>({available:true,models:['gemini-3.8-flash-low']})})});
  try{
    await controller.selectWorkspace({path:project});await controller.open({model:'gemini-3.8-flash',accessMode:'read-only'});
    const home=path.join(root,'agent-home/gemini/main',controller.state.threadId,'.gemini');
    const config=JSON.parse(await readFile(path.join(home,'config/mcp_config.json'),'utf8'));assert.deepEqual(Object.keys(config.mcpServers),['k_google_ops']);
    const settings=JSON.parse(await readFile(path.join(home,'antigravity-cli/settings.json'),'utf8'));assert.ok(settings.permissions.allow.includes('mcp(k_google_ops/*)'));assert.equal(controller.state.browserAccess.enabled,false);
  }finally{await controller.close();}
});

test('Gemini protects both canonical Google client and selected junction paths',async()=>{
 const owner=await workspace(),parent=await workspace(),project=path.join(parent,'AdsControl');await install(project);await bind(owner,project);
 const alias=path.join(owner,'alias');await symlink(parent,alias,'junction');
 const server=await googleOpsMcp(alias,{root:owner});
 assert.equal(server.args[2],project,'execute only owner-bound canonical path');
 const settings=geminiSettings(alias,'workspace-write',[],null,server);
 for(const base of [project,path.join(alias,'AdsControl')])for(const folder of ['google_ops_worker','.venv'])assert.ok(settings.permissions.deny.includes(`write_file(${path.join(base,folder)})`));
});
