import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClaudeController} from '../src/claude-controller.mjs';
import {listMainSessions} from '../src/main-sessions.mjs';

const TEST_ROOT=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
const CLAUDE_MODEL='claude-opus-5-5';

async function fixture({bridgeFactory,gatewayFactory}={}){
 await mkdir(TEST_ROOT,{recursive:true});
 const root=await mkdtemp(path.join(TEST_ROOT,'claude-boundaries-'));
 const hosts=[],bridges=[];
 const controller=createClaudeController({root,
  hostFactory:async options=>{
   let resolveClosed;
   const host={options,starts:[],closeCount:0,interruptCount:0,closed:new Promise(resolve=>{resolveClosed=resolve;}),
    async start(content){this.starts.push(structuredClone(content));},
    async interrupt(){this.interruptCount++;},
    async close(){this.closeCount++;resolveClosed();},
   };
   hosts.push(host);return host;
  },
  gatewayFactory:gatewayFactory??(async()=>({mcpConfig:{mcpServers:{}},close:async()=>{}})),
  bridgeFactory:bridgeFactory??(async options=>{const bridge={options,async list(){return [];},async close(){}};bridges.push(bridge);return bridge;}),
 });
 return {root,controller,hosts,bridges};
}

test('opening Claude initializes the gateway without starting the lazy Luna bridge',async()=>{
 let gatewayCalls=0,bridgeCalls=0;
 const f=await fixture({gatewayFactory:async()=>{gatewayCalls++;return {mcpConfig:{mcpServers:{}},close:async()=>{}};},bridgeFactory:async()=>{bridgeCalls++;return {async list(){return [];},async close(){}};}});
 try{
  await f.controller.open({model:CLAUDE_MODEL});
  assert.equal(gatewayCalls,1);
  assert.equal(bridgeCalls,0);
  assert.equal(f.hosts.length,1);
 }finally{await f.controller.close();}
});

test('failed reopen teardown retains the old host and retry closes it without sending',async()=>{
 let fail=true,closes=0;
 const f=await fixture({gatewayFactory:async()=>({mcpConfig:{mcpServers:{}},async close(){closes++;if(fail)throw Error('cleanup blocked');}})});
 await f.controller.open({model:CLAUDE_MODEL});
 const id=f.controller.state.threadId,old=f.hosts[0];
 await assert.rejects(f.controller.open({threadId:id}),/cleanup blocked/);
 assert.equal(closes,1);assert.equal(old.closeCount,0);assert.equal(f.hosts.length,1);
 assert.equal(f.controller.state.status,'uncertain');assert.equal(f.controller.state.threadId,id);
 fail=false;
 await f.controller.open({threadId:id});
 assert.equal(old.closeCount,1);assert.equal(f.hosts.length,2);
 assert.equal(f.controller.state.status,'ready');assert.equal(f.controller.state.threadId,id);
 assert.ok(f.hosts.every(host=>host.starts.length===0));
 await f.controller.close();
});

test('native plan mode is passed to Claude; K does not impose a second tool allowlist',async()=>{
 const f=await fixture();
 try{
  await f.controller.open({model:CLAUDE_MODEL,accessMode:'read-only'});
  assert.equal(f.hosts[0].options.accessMode,'claude-plan');
  const permission=f.hosts[0].options.onPermission;
  const command=permission({toolName:'Bash',input:{command:'echo unsafe'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.controller.state.questions[0].details.toolName,'Bash');
  await f.controller.answer({id:f.controller.state.questions[0].id,accept:false});
  assert.equal((await command).behavior,'deny');
 }finally{await f.controller.close();}
});

test('all official native Claude permission modes are accepted without rewriting',async()=>{
 const f=await fixture();
 try{
  for(const mode of ['claude-manual','claude-acceptEdits','claude-auto','claude-bypassPermissions','claude-dontAsk','claude-plan']){
   await f.controller.open({model:CLAUDE_MODEL,accessMode:mode});
   assert.equal(f.hosts.at(-1).options.accessMode,mode);
   await f.controller.close();
  }
 }finally{await f.controller.close();}
});

test('Claude native manual approval is not silently restricted to workspace paths',async()=>{
 const f=await fixture();
 try{
  await f.controller.open({model:CLAUDE_MODEL,accessMode:'workspace-write'});
  const pending=f.hosts[0].options.onPermission({toolName:'Write',input:{file_path:path.join(f.root,'..','outside.txt'),content:'x'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.controller.state.questions[0].details.input.file_path,path.join(f.root,'..','outside.txt'));
  await f.controller.answer({id:f.controller.state.questions[0].id,accept:false});
  assert.equal((await pending).behavior,'deny');
 }finally{await f.controller.close();}
});

test('Claude conversations are included in the common main-session listing',async()=>{
 const f=await fixture();
 try{
  const opened=await f.controller.open({model:CLAUDE_MODEL});
  const [common,visible]=await Promise.all([listMainSessions(f.root),f.controller.sessions()]);
  assert.equal(common.sessions.some(session=>session.threadId===opened.threadId&&session.provider==='claude'),true);
  assert.equal(visible.sessions.some(session=>session.threadId===opened.threadId&&session.provider==='claude'),true);
 }finally{await f.controller.close();}
});

test('confirmed stop reconnects the same conversation on new send without replaying old input',async()=>{
 const f=await fixture();
 try{
  const opened=await f.controller.open({model:CLAUDE_MODEL});
  const oldHost=f.hosts[0];
  await f.controller.send({text:'正在處理的舊工作'});
  await f.controller.stop();
  assert.equal(oldHost.closeCount,1);
  assert.equal(oldHost.interruptCount,1);
  assert.equal(oldHost.starts.length,1);
  await f.controller.send({text:'重新開啟後才送出的新 prompt'});
  const newHost=f.hosts[1];
  assert.notEqual(newHost,oldHost);
  assert.equal(f.controller.state.threadId,opened.threadId);
  assert.equal(oldHost.starts.length,1);
  assert.equal(newHost.options.resume,true);
  assert.equal(newHost.starts.length,1);
  assert.equal(newHost.starts[0][0].text,'重新開啟後才送出的新 prompt');
 }finally{await f.controller.close();}
});

test('uncertain stop does not reconnect or send a new prompt automatically',async()=>{
 let fail=false;
 const f=await fixture({gatewayFactory:async()=>({mcpConfig:{mcpServers:{}},async close(){if(fail)throw Error('cleanup uncertain');}})});
 try{
  await f.controller.open({model:CLAUDE_MODEL});fail=true;
  await assert.rejects(f.controller.stop(),/cleanup uncertain/);
  await assert.rejects(f.controller.send({text:'must not send'}),/請先開啟/);
  assert.equal(f.hosts.length,1);assert.equal(f.hosts[0].starts.length,0);
 }finally{fail=false;await f.controller.close();}
});
