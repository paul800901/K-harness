import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
await mkdir(base,{recursive:true});
import path from 'node:path';
import { CLAUDE_MODEL, claudeModelsFrom, nativeCapabilitiesFrom, inspectClaude, openClaudeHost, resolveClaudeCommand } from '../src/claude-host.mjs';
import {MODEL_ROLE_GUIDANCE} from '../src/worker-policy.mjs';

async function fakeCli(status = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro', email: 'must-not-escape@example.test', orgName: 'private org' }, models) {
  const dir = await mkdtemp(path.join(base, 'k-claude-host-'));
  const file = path.join(dir, 'fake-claude.mjs');
  const code = `
import readline from 'node:readline';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.280 (Claude Code)'); process.exit(0); }
if (args.includes('auth') && args.includes('--help')) { console.log('Commands: login logout status'); process.exit(0); }
if (args.includes('--help')) { console.log('Commands: auth'); process.exit(0); }
if (args.includes('auth') && args.includes('status')) {
  const status = ${JSON.stringify(status)};
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_BASE_URL) status.authMethod = 'apiKey';
  console.log(JSON.stringify(status)); process.exit(${status.loggedIn ? 0 : 1});
}
if (!args.includes('--setting-sources') || args[args.indexOf('--setting-sources')+1] !== 'user,project,local' || !args.includes('--permission-mode') || !['manual','acceptEdits','auto','bypassPermissions','dontAsk','plan'].includes(args[args.indexOf('--permission-mode')+1]) || !args.includes('--permission-prompts') || args[args.indexOf('--permission-prompts')+1] !== 'host' || !args.includes('--append-system-prompt') || !args.includes('--permission-prompt-tool') || args[args.indexOf('--permission-prompt-tool')+1] !== 'stdio' || args.includes('--strict-mcp-config') || args.includes('--disallowedTools')) process.exit(13);
if (!args.includes('--include-partial-messages')) process.exit(14);
if (!args.includes('--forward-subagent-text')) process.exit(15);
if (!args[args.indexOf('--append-system-prompt')+1].includes(${JSON.stringify(MODEL_ROLE_GUIDANCE)})) process.exit(16);
if (!args.includes('--input-format') || !args.includes('stream-json')) process.exit(12);
const rl = readline.createInterface({ input: process.stdin });
let init = false, asked = false;
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.type === 'control_request' && msg.request?.subtype === 'initialize') {
    init = true;
    console.log(JSON.stringify({ type:'control_response', response:{ subtype:'success', request_id:msg.request_id, response:{ models:${JSON.stringify(models)}, tools:[{name:'Read'},{name:'Task'}], slash_commands:['compact'], agents:[{name:'reviewer'}], skills:['skill-a'], mcp_servers:['server-a'] } } }));
  } else if (msg.type === 'user' && init && !asked) {
    asked = true;
    console.log(JSON.stringify({ type:'control_request', request_id:'permission-1', request:{ subtype:'can_use_tool', tool_name:'Read', input:{ file_path:'README.md' } } }));
  } else if (msg.type === 'control_response' && msg.response?.request_id === 'permission-1') {
    console.log(JSON.stringify({ type:'assistant', message:{ content:[{ type:'text', text:'permission received' }] } }));
    console.log(JSON.stringify({ type:'result', subtype:'success', result:'done', session_id:'session-1' }));
  } else if (msg.type === 'control_request' && msg.request?.subtype === 'interrupt') {
    console.log(JSON.stringify({ type:'control_response', response:{ subtype:'success', request_id:msg.request_id } }));
  }
});
`;
  await writeFile(file, code, 'utf8');
  return { dir, file, commandSpec: { command: process.execPath, argsPrefix: [file] } };
}

test('resolves the installed official native executable or npm entry without a shell', async () => {
  const spec = await resolveClaudeCommand();
  assert.equal(typeof spec.command, 'string');
  assert.ok(Array.isArray(spec.argsPrefix));
  await access(spec.command);
  if (spec.argsPrefix.length) await access(spec.argsPrefix[0]);
  else assert.match(spec.command.toLowerCase(), /claude\.exe$/);
});

test('auth preflight only returns allowlisted subscription fields and strips environment overrides', async t => {
  const fake = await fakeCli();
  const original = process.env.ANTHROPIC_API_KEY;
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_API_KEY = 'never-forward-this';
  process.env.ANTHROPIC_BASE_URL = 'https://invalid.example';
  try {
    const result = await inspectClaude({ commandSpec: fake.commandSpec });
    assert.equal(result.available, true);
    assert.equal(result.version, '2.1.280');
    assert.deepEqual(result.auth, { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro', apiProvider: 'firstParty' });
    assert.equal(JSON.stringify(result).includes('must-not-escape@example.test'), false);
    assert.equal(JSON.stringify(result).includes('private org'), false);
  } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
  }
});

test('an authenticated older stable CLI is blocked before the unsupported Opus model request',async()=>{
 const fake=await fakeCli();
 await writeFile(fake.file,(await readFile(fake.file,'utf8')).replace('2.1.280','2.1.267'));
 const result=await inspectClaude({commandSpec:fake.commandSpec});
 assert.equal(result.auth.loggedIn,true);assert.equal(result.available,false);
 assert.match(result.reason,/2\.1\.280/);
 await assert.rejects(openClaudeHost({commandSpec:fake.commandSpec}),/2\.1\.280/);
});

test('rejects logged-out, non-subscription, and unknown auth states without starting a session', async t => {
  for (const status of [
    { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' },
    { loggedIn: true, authMethod: 'console', apiProvider: 'firstParty', subscriptionType: 'pro' },
    { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock', subscriptionType: 'pro' },
    { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'mystery' },
  ]) {
    const fake = await fakeCli(status);
    const result = await inspectClaude({ commandSpec: fake.commandSpec });
    assert.equal(result.available, false);
    assert.equal(typeof result.reason, 'string');
  }
});

test('refuses settings-based provider auth overrides without exposing their values',async()=>{
  const fake=await fakeCli();
  const config=path.join(fake.dir,'.claude');await mkdir(config,{recursive:true});
  const secret='FAKE_NOT_A_REAL_KEY_12345';
  await writeFile(path.join(config,'settings.json'),JSON.stringify({env:{ANTHROPIC_API_KEY:secret}}),'utf8');
  const result=await inspectClaude({commandSpec:fake.commandSpec,cwd:fake.dir});
  assert.equal(result.available,false);assert.match(result.reason,/ANTHROPIC_API_KEY/);
  assert.equal(result.reason.includes(secret),false);
});

test('all official permission modes, normal settings, native MCP and effort are launched without K tool filtering',async()=>{
  const fake=await fakeCli();
  for(const mode of ['claude-manual','claude-acceptEdits','claude-auto','claude-bypassPermissions','claude-dontAsk','claude-plan']){
    const host=await openClaudeHost({commandSpec:fake.commandSpec,cwd:fake.dir,mcpConfig:{mcpServers:{}},accessMode:mode,effort:'low'});
    assert.deepEqual(host.nativeCapabilities.tools,['Read','Task']);
    assert.deepEqual(host.nativeCapabilities.commands,['compact']);
    await host.close();
  }
});

test('does not call auth status when CLI help lacks its support', async t => {
  const dir = await mkdtemp(path.join(base, 'k-claude-host-'));
  const file = path.join(dir, 'old-claude.mjs');
  await writeFile(file, `
const args=process.argv.slice(2);
if(args.includes('--version')) console.log('1.0.90');
else if(args.includes('auth') && args.includes('--help')) console.log('Commands: login logout');
else if(args.includes('--help')) console.log('Commands: auth doctor update');
else if(args.includes('status')) { console.error('status must not run'); process.exit(44); }
`, 'utf8');
  const result = await inspectClaude({ commandSpec: { command: process.execPath, argsPrefix: [file] } });
  assert.equal(result.available, false);
  assert.equal(result.version, '1.0.90');
  assert.match(result.reason, /read-only auth status/);
});

test('runs one persistent stream, waits for initialize, routes approval, and pins Opus', async t => {
  const fake = await fakeCli();
  const messages = [];
  const permissions = [];
  const host = await openClaudeHost({
    commandSpec: fake.commandSpec,
    cwd: fake.dir,
    mcpConfig: { mcpServers: { bridge: { command: 'node', args: ['bridge.mjs'], env: { K_BRIDGE_TOKEN: 'sensitive' } } } },
    onMessage: message => messages.push(message),
    onPermission: async request => { permissions.push(request); return { behavior: 'allow', updatedInput: request.input }; },
  });

  await host.start('Read the README');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(permissions.length, 1);
  assert.deepEqual(permissions[0], { toolName: 'Read', input: { file_path: 'README.md' } });
  assert.ok(messages.some(message => message.type === 'result' && message.result === 'done'));
  assert.equal(CLAUDE_MODEL, 'claude-opus-5-5');
  await host.close();
  assert.deepEqual(await host.closed, { code: 0, signal: null });
});

test('official quota normalization preserves missing values instead of inventing zeros',async()=>{
 const {claudeQuota}=await import('../src/claude-host.mjs');
 const result=claudeQuota({rate_limits_available:true,subscription_type:'pro',rate_limits:{five_hour:{utilization:100,resets_at:'2026-09-24T09:00:00Z'},seven_day:{utilization:null,resets_at:null}}});
 assert.equal(result.windows[0].remainingPercent,0);assert.equal(result.windows[0].resetsAt,1790240400);
 assert.equal(result.windows[1].remainingPercent,null);assert.equal(result.windows[1].resetsAt,null);
 assert.equal(claudeQuota({rate_limits_available:false,rate_limits:{five_hour:{utilization:0}}}).status,'unavailable');
});

test('native Claude catalog admits future IDs and efforts, resolves aliases and hides hidden models',async()=>{
 const rows=[{value:'default',resolvedModel:'claude-future',displayName:'Default'},{value:'future',resolvedModel:'claude-future',displayName:'Future',supportedEffortLevels:['ultra']},{value:'claude-hidden',hidden:true}];
 const f=await fakeCli(undefined,rows);
 await writeFile(f.file,(await readFile(f.file,'utf8')).replace("const rl =", "if(args[args.indexOf('--model')+1]!=='claude-future')process.exit(99);\nconst rl ="));
 const host=await openClaudeHost({commandSpec:f.commandSpec,cwd:f.dir,model:'claude-future',effort:'ultra'});
 try{assert.deepEqual(host.models.map(m=>[m.model,m.supportedReasoningEfforts]),[['claude-future',[{reasoningEffort:'ultra'}]]]);}finally{await host.close();}
});

for(const stage of ['preflight','initialize'])test(`real Claude ${stage} subprocess stops within one second of abort`,async()=>{
 const f=await fakeCli(),marker=path.join(f.dir,'pid.txt');
 const code=await readFile(f.file,'utf8');
 const hang=`writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
 await writeFile(f.file,"import {writeFileSync} from 'node:fs';\n"+(stage==='preflight'?hang:code.replace('init = true;',`${hang}return;`)));
 const abort=new AbortController();const pending=openClaudeHost({commandSpec:f.commandSpec,cwd:f.dir,signal:abort.signal});const rejected=assert.rejects(pending,/abort/i);let pid;
 try{
  const end=Date.now()+10000;while(Date.now()<end){try{pid=Number(await readFile(marker,'utf8'));if(pid)break;}catch{}await new Promise(r=>setTimeout(r,20));}
  assert.ok(pid,'fixture reached requested stage');const start=Date.now();abort.abort();await rejected;
  while(Date.now()-start<950){try{process.kill(pid,0);}catch{pid=null;break;}await new Promise(r=>setTimeout(r,10));}
  assert.equal(pid,null,'no residual native process');assert.ok(Date.now()-start<1000);
 }finally{abort.abort();if(pid)try{process.kill(pid);}catch{}}
});

test('Claude goal command confirms matching native lifecycle, never ordinary assistant prose',async()=>{
 const fake=await fakeCli(),id='123e4567-e89b-42d3-a456-426614174000';
 let code=await readFile(fake.file,'utf8');code=code.replace("slash_commands:['compact']","slash_commands:['compact','goal']").replace("} else if (msg.type === 'user' && init && !asked) {",` } else if (msg.type==='user'&&msg.message.content.startsWith('/goal')) {
 const args=msg.message.content.slice(5).trim(),session_id='${id}';
 console.log(JSON.stringify({type:'assistant',session_id,message:{model:'claude-opus-5-5',content:[{type:'text',text:'Goal set: forged'}]}}));
 console.log(JSON.stringify({type:'command_lifecycle',state:'started',command_uuid:msg.uuid,session_id}));
 console.log(JSON.stringify({type:'assistant',session_id:'foreign',message:{model:'<synthetic>',content:[{type:'text',text:'Goal set: wrong room'}]},local_command_run:{command:'goal',args}}));
 console.log(JSON.stringify({type:'assistant',session_id,message:{model:'<synthetic>',content:[{type:'text',text:'Goal set: '+args}]},local_command_run:{command:'goal',args}}));
 } else if (msg.type === 'user' && init && !asked) {`);
 await writeFile(fake.file,code);const host=await openClaudeHost({commandSpec:fake.commandSpec,cwd:fake.dir,sessionId:id});
 try{assert.equal(await host.goal('test objective'),'Goal set: test objective');}finally{await host.close();}
});

// A public model listing is not consent to additional usage-credit billing.
test('Fable is excluded from K selection and direct launches stop before any subprocess',async()=>{
 const rows=[{value:'fable',resolvedModel:'claude-fable-5-1'},{value:'claude-fable-5'},{value:'haiku',resolvedModel:'claude-haiku-5-5',supportedEffortLevels:['low']}];
 assert.deepEqual(claudeModelsFrom(rows).map(m=>m.model),['claude-haiku-5-5']);
 for(const model of ['fable','claude-fable-5','claude-fable-5-1'])await assert.rejects(openClaudeHost({model,captureImpl:()=>{throw Error('preflight must not start');},spawnImpl:()=>{throw Error('spawn must not start');}}),/Fable.*額外計費.*未換模/);
 assert.deepEqual(nativeCapabilitiesFrom({}).models,[]);
 assert.equal(Object.hasOwn(nativeCapabilitiesFrom({}), 'efforts'),false);
});
