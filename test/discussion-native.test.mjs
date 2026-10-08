import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {openDiscussionSession} from '../src/discussion-native.mjs';
const root=path.resolve('.runtime/tests');await mkdir(root,{recursive:true});

test('Codex discussion disables inherited MCP and execution tools while retaining native turn identity',async()=>{
 const calls=[];let event,resolveClosed;const closed=new Promise(r=>{resolveClosed=r;});
 const s=await openDiscussionSession({root,workspace:root,selection:{model:'gpt-6.1-sol',effort:'high'},codexHost:opts=>{event=opts.onEvent;return {closed,notify(){},async request(method,params){calls.push({method,params});if(method==='config/read')return {config:{mcp_servers:{credentialTool:{}}}};if(method==='thread/start')return {thread:{id:'native-discussion'}};if(method==='turn/start'){queueMicrotask(()=>{event({method:'item/completed',params:{item:{type:'agentMessage',id:'a',text:'original'}}});event({method:'turn/completed',params:{turn:{status:'completed'}}});});return {turn:{id:'turn'}};}return {};},async close(){resolveClosed();}};}});
 assert.equal(await s.ask('question'),'original');assert.equal(await s.ask('continuation'),'original');await s.close();
 const start=calls.find(c=>c.method==='thread/start').params;assert.equal(start.sandbox,'read-only');assert.equal(start.config.mcp_servers.credentialTool.enabled,false);assert.equal(start.config.features.shell_tool,false);assert.equal(start.config.features.multi_agent,false);
 assert(calls.filter(c=>c.method==='turn/start').every(c=>c.params.threadId==='native-discussion'&&c.params.sandboxPolicy.type==='readOnly'));
});

test('an already aborted Codex host still closes and confirms exit without a stale interrupt request',async()=>{
 const abort=new AbortController();let resolveClosed,finish,interrupts=0,closes=0;const closed=new Promise(r=>{resolveClosed=r;});
 const ready=new Promise(r=>{finish=r;});
 const s=await openDiscussionSession({root,workspace:root,selection:{model:'gpt-6.1-sol'},signal:abort.signal,codexHost:opts=>({closed,notify(){},async request(method){if(method==='config/read')return {config:{}};if(method==='thread/start')return {thread:{id:'native'}};if(method==='turn/start'){opts.onEvent({method:'turn/started',params:{turn:{id:'live'}}});finish();return {turn:{id:'live'}};}if(method==='turn/interrupt'){interrupts++;throw Error('stopped');}return {};},async close(){closes++;resolveClosed();}})});
 const work=s.ask('slow').then(()=>false,()=>true);await ready;abort.abort();await s.close();assert.equal(await work,true);assert.equal(interrupts,0);assert.equal(closes,1);
});

test('Gemini uses stdin for long prompts, native conversation resume and one account lease through closure',async()=>{
 const workspace=await mkdtemp(path.join(root,'discussion-native-'));let acquisitions=0,releases=0;const calls=[];
 const s=await openDiscussionSession({root:workspace,workspace,selection:{model:'gemini-3.8-flash',effort:'low',nativeModels:{low:'gemini-3.8-flash-low'}},env:{SystemRoot:'C:/Windows',K_GEMINI_EXECUTABLE:'C:/fake/agy.exe',ANTHROPIC_API_KEY:'do-not-inherit'},accounts:{async acquire(){acquisitions++;return {accountId:'account-A',async release(){releases++;}};}},async runGemini(exe,args,options){calls.push({args,...options});options.onChunk(Buffer.from(JSON.stringify({event:'init',conversation_id:'gemini-native'})+'\n'+JSON.stringify({event:'result',conversation_id:'gemini-native',status:'SUCCESS',response:'answer'})+'\n'));return {code:0};}});
 await s.ask('長文字'.repeat(16000));await s.ask('next');assert.equal(acquisitions,1);assert.equal(releases,0);await s.close();assert.equal(releases,1);
 assert(calls[0].input.length>32000);assert.equal(JSON.parse(calls[0].input).message.content.length,48000);assert.equal(calls[0].args.includes('--print'),false);assert(calls[1].args.includes('gemini-native'));assert.equal(calls[0].timeoutMs,0);assert.equal(calls[0].env.ANTHROPIC_API_KEY,undefined);
 const settings=JSON.parse(await readFile(path.join(s.identity.home,'.gemini/antigravity-cli/settings.json'),'utf8'));for(const permission of ['read_file(*)','write_file(*)','command(*)','mcp(*)'])assert(settings.permissions.deny.includes(permission));
 assert.deepEqual(JSON.parse(await readFile(path.join(s.identity.home,'.gemini/config/mcp_config.json'),'utf8')),{mcpServers:{}});
});

test('unconfirmed Gemini process-tree cleanup stays unknown and cannot be reported closed',async()=>{
 const workspace=await mkdtemp(path.join(root,'discussion-unsettled-'));let released;
 const s=await openDiscussionSession({root:workspace,workspace,selection:{model:'gemini-3.8-flash',effort:'low'},accounts:{async acquire(){return {accountId:'A',async release(data){released=data;}};}},async runGemini(){return {code:null,cleanupError:'tree exit unknown'};}});
 await assert.rejects(s.ask('fake'),/tree exit unknown/);await assert.rejects(s.close(),/停止未確認/);assert.equal(released.settled,false);
});

test('Claude discussion allows only its two public web tools, not inherited local or MCP tools',async()=>{
 let options,resolveClosed;const closed=new Promise(r=>{resolveClosed=r;});const s=await openDiscussionSession({root,workspace:root,selection:{model:'claude-opus-5-5'},claudeHost:async opts=>{options=opts;return {closed,async start(){opts.onMessage({type:'result',subtype:'success',result:'native answer'});},async close(){resolveClosed();}};}});
 assert.equal(options.discussionOnly,true);assert.deepEqual(options.onPermission({toolName:'WebFetch',input:{url:'https://example.com'}}),{behavior:'allow',updatedInput:{url:'https://example.com'}});assert.equal(options.onPermission({toolName:'Read',input:{file_path:'fake'}}).behavior,'deny');assert.equal(options.onPermission({toolName:'mcp__write',input:{}}).behavior,'deny');await s.ask('fake');await s.close();
});
