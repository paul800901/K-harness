import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isExpectedFakeUpload } from './browser-probe-permission.mjs';
import { openCodexHost } from '../src/codex-host.mjs';
import { openClaudeHost } from '../src/claude-host.mjs';
import { threadPermissions, turnPermissions } from '../src/desktop-permissions.mjs';
import { resolveClaudeCommand } from '../src/claude-host.mjs';

const mode = process.argv[2];
const modes = ['codex-manual','claude-manual','claude-auto'];
if (!modes.includes(mode)) {
  console.error('Usage: node scripts/browser-approval-probe.mjs <codex-manual|claude-manual|claude-auto> [--run] [--codex-executable <absolute path>]');
  process.exit(2);
}
const run = process.argv.includes('--run');
const root = path.resolve('.runtime/browser-approval-probe', `round2-${mode}-${randomUUID()}`);
const workspace = path.join(root, 'workspace');
const fakeFile = path.join(workspace, '.env.local');
const entry = path.resolve('src/browser-mcp-stdio.mjs');
const exeIndex = process.argv.indexOf('--codex-executable');
const codexExe = exeIndex < 0 ? null : process.argv[exeIndex + 1];
const timeoutMs = 65000;
async function bounded(done) { let timer; try { return await Promise.race([done,new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'timeout'}),timeoutMs);})]); } finally { clearTimeout(timer); } }
const results = [];

async function dirs(id) {
  const output = path.join(root, 'output', id), profile = path.join(root, 'profile', id);
  await mkdir(output, { recursive: true });
  await mkdir(profile, { recursive: true });
  return { output, profile };
}
function serverSpec(output, profile) {
  return { command: process.execPath, args: [entry, output, profile], cwd: output };
}
function claudeServerSpec(output, profile) {
  return { command: process.execPath, args: [entry, output, profile] };
}
function prompt() {
  return [
    'Isolated permission probe. You may first use native ToolSearch or tool discovery ONLY to load the k_browser browser_file_upload schema. Then make exactly one browser tool call. Do not use agents, shell, file-reading tools, URLs, or websites.',
    `Call only k_browser browser_file_upload with paths exactly [${JSON.stringify(fakeFile)}].`,
    'The file is a synthetic fixture containing FAKE_NOT_A_KEY outside the dedicated browser directory. The K wrapper will reject it before launching a browser or reading content. Do not read it, navigate, submit, retry or use other tools except the necessary schema discovery.',
    'If the tool is denied or an approval is required, stop immediately and report that outcome. Reply with one short sentence.',
  ].join('\n');
}
function summarizeCodexEvent(event, threadId, turnId) {
  const p = event.params ?? {};
  if (p.threadId && p.threadId !== threadId) return null;
  if (turnId && p.turn?.id && p.turn.id !== turnId) return null;
  const row = { method: event.method };
  if (event.method === 'item/started' || event.method === 'item/completed') {
    const item = p.item ?? {};
    row.itemType = item.type;
    if (item.type === 'mcpToolCall') {
      row.server = item.server;
      row.tool = item.tool;
      row.arguments = item.arguments;
      row.error = item.error;
      row.result = item.result;
      row.status = item.status;
    }
  } else if (event.method === 'turn/completed') row.turn = { id: p.turn?.id, status: p.turn?.status };
  else if (event.method === 'mcpServer/elicitation/request') row.request = p;
  else if (/mcpServer\/.*(status|updated)/.test(event.method)) row.status = p;
  return row;
}

async function codex(mode) {
  if(!codexExe || !path.isAbsolute(codexExe))throw new Error('--codex-executable requires the verified absolute official Codex executable path.');
  const id = `codex-${mode}-${randomUUID()}`, { output, profile } = await dirs(id);
  const events = [], elicitation = [];
  let threadId, turnId, finish;
  const done = new Promise(resolve => { finish = resolve; });
  const host = openCodexHost({ executable: codexExe, cwd: workspace, onEvent(event) {
    const row = summarizeCodexEvent(event, threadId, turnId);
    if (row) events.push(row);
    if (event.method === 'turn/completed' && event.params?.turn?.id === turnId) finish(event.params.turn);
  }, onRequest: async message => {
    elicitation.push({method:message.method,params:message.params});
    if (message.method === 'mcpServer/elicitation/request') {
      return { action: 'decline', content: null };
    }
    return undefined;
  } });
  const record = { provider: 'codex', mode, model: 'gpt-6-luna', effort: 'low', threadId: null, mcpReady: null, mcpStatus: null, elicitation: null, events: null, outcome: null, error: null };
  try {
    await host.request('initialize', { clientInfo: { name: 'k_browser_native_approval_probe', version: '1' }, capabilities: { experimentalApi: true } });
    host.notify({ method: 'initialized', params: {} });
    const account = await host.request('account/read', { refreshToken: false });
    if (account.account?.type !== 'chatgpt') throw new Error('Existing ChatGPT subscription not verified; no turn started.');
    const perms = threadPermissions(mode, workspace);
    const started = await host.request('thread/start', {
      cwd: workspace, model: 'gpt-6-luna', effort: 'low', ...perms,
      config: { ...perms.config, mcp_servers: { k_browser: serverSpec(output, profile) } },
    });
    threadId = started.thread.id; record.threadId = threadId;
    record.mcpReady = await host.waitForMcp(threadId, 'k_browser');
    const status = await host.request('mcpServerStatus/list', { threadId, limit: 100 });
    const browser = status.data?.find(row => row.name === 'k_browser');
    record.mcpStatus = browser ? { name: browser.name, runtimeStatus: browser.runtimeStatus, tools: Object.keys(browser.tools ?? {}) } : null;
    const turns = turnPermissions(mode, workspace);
    const begun = await host.request('turn/start', {
      threadId, input: [{ type: 'text', text: prompt() }], model: 'gpt-6-luna', effort: 'low',
      approvalPolicy: turns.approvalPolicy, approvalsReviewer: turns.approvalsReviewer, sandboxPolicy: turns.sandboxPolicy,
    });
    turnId = begun.turn.id;
    record.outcome = await bounded(done);
  } catch (error) { record.error = error.message; }
  finally {
    record.elicitation = elicitation;
    record.events = events;
    await host.close();
    results.push(record);
  }
}

async function claude(mode) {
  const id = `claude-${mode}-${randomUUID()}`, { output, profile } = await dirs(id);
  const messages = [], permissions = [];
  const sessionId = randomUUID();
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const spec = await resolveClaudeCommand();
  const host = await openClaudeHost({
    commandSpec: spec, cwd: workspace, sessionId, accessMode: `claude-${mode}`, effort: 'low',
    mcpConfig: { mcpServers: { k_browser: claudeServerSpec(output, profile) } },
    onMessage(message) {
      if (message.type === 'system' && message.subtype === 'init') messages.push({ type: 'init', tools: (message.tools ?? []).filter(name => name.startsWith('mcp__k_browser__')), permissionMode: message.permissionMode, mcpServers: (message.mcp_servers ?? []).filter(server => server.name === 'k_browser') });
      if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') messages.push({ type: 'permission-request', toolName: message.request.tool_name, input: message.request.input });
      if (message.type === 'assistant') {
        const content = message.message?.content ?? [];
        messages.push({ type: 'assistant', blocks: content.map(block => ({ type: block.type, name: block.name, input: block.input, text: block.text })) });
      }
      // Tool results identify which layer rejected (native permission vs. K file guard).
      if (message.type === 'user' && Array.isArray(message.message?.content)) {
        const results = message.message.content.filter(block => block?.type === 'tool_result').map(block => ({ toolUseId: block.tool_use_id, isError: block.is_error === true, text: (Array.isArray(block.content) ? block.content.map(part => part?.text ?? '').join('\n') : String(block.content ?? '')).slice(0, 2000) }));
        if (results.length) messages.push({ type: 'tool-result', results });
      }
      if (message.type === 'result') {
        messages.push({ type: 'result', subtype: message.subtype, is_error: message.is_error, result: message.result });
        finish({ subtype: message.subtype, is_error: message.is_error, result: message.result });
      }
    },
    onPermission({ toolName, input }) {
      permissions.push({ toolName, input });
      if(toolName==='ToolSearch' && typeof input?.query==='string' && input.query.includes('browser_file_upload'))return {behavior:'allow',updatedInput:input};
      // Deny exactly the fake file upload if Claude requests K approval; deny all unexpected tools.
      if (isExpectedFakeUpload(toolName,input,fakeFile)) return { behavior: 'deny', message: 'Declined: isolated fake-file permission probe only.' };
      return { behavior: 'deny', message: 'Unexpected tool request denied by probe.' };
    },
  });
  const record = { provider: 'claude', mode, sessionId, mcpTools: host.nativeCapabilities?.tools ?? [], mcpServers: host.nativeCapabilities?.mcpServers ?? [], permissions, messages, outcome: null, error: null };
  try {
    await host.start(prompt());
    record.outcome = await bounded(done);
  } catch (error) { record.error = error.message; }
  finally { await host.close(); results.push(record); }
}

// Dry run never starts a model or creates a fixture.
if(!run){console.log(JSON.stringify({dryRun:true,mode,workspace,prompt:prompt()},null,2));process.exit(0);}
await mkdir(workspace,{recursive:true});
await writeFile(fakeFile,'FAKE_NOT_A_KEY',{flag:'wx'});
if(mode==='codex-manual')await codex('workspace-write');
else await claude(mode==='claude-manual'?'manual':'auto');
const evidence = {endedAt:new Date().toISOString(),mode,workspace,fakeFile,results};
const evidencePath=path.join(root,'evidence.json');
await writeFile(evidencePath,JSON.stringify(evidence,null,2),{flag:'wx'});
console.log(JSON.stringify({evidencePath,results:results.map(row=>({provider:row.provider,mode:row.mode,error:row.error,outcome:row.outcome,permissionRequests:(row.elicitation??row.permissions??[]).length}))},null,2));
