import test from 'node:test';
import childProcessModule from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIsolatedDesktop } from '../src/isolated-desktop.mjs';
import { startDesktop } from '../src/desktop-server.mjs';
import { addProject, listProjects, updateProject } from '../src/projects.mjs';

const testRoot = fileURLToPath(new URL('../.runtime/tests/', import.meta.url));
const providerExe = path.resolve('test-fixture', 'codex.exe');
const claudeSpec = { command: process.execPath, argsPrefix: [path.resolve('test/fixtures/claude-inspection.cjs')] };
const agentEnv = { USERPROFILE: 'C:\\isolated\\home', HOME: 'C:\\isolated\\home', CLAUDE_CONFIG_DIR: 'C:\\isolated\\home\\.claude',
  PATH: 'C:\\isolated\\bin' };

function childProcess({ write, final } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, callback) { try { write?.(chunk.toString()); callback(); } catch (error) { callback(error); } },
    final(callback) { try { final?.(); callback(); } catch (error) { callback(error); } },
  });
  child.terminate = async () => ({ confirmed: true });
  child.stderr.resume();
  return child;
}

function fakePool({ claudeLoggedIn = false } = {}) {
  const calls = [];
  const appServerMessages = [];
  let claudeMcpConfig = null;
  const pool = {
    async close() { this.closeCalls = (this.closeCalls ?? 0) + 1; },
    spawnImpl(command, args, options) {
      calls.push({ command, args: [...args], options });
      if (command === claudeSpec.command && args.includes('--input-format')) {
        const configIndex = args.indexOf('--mcp-config');
        claudeMcpConfig = configIndex >= 0 ? JSON.parse(args[configIndex + 1]) : null;
        const child = childProcess({ write(data) {
          for (const line of data.split('\n').filter(Boolean)) {
            const message = JSON.parse(line);
            if (message.request_id === 'k-initialize') setImmediate(() => child.stdout.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'k-initialize', response: {} } })}\n`));
          }
        }, final() { setImmediate(() => { child.stdout.end(); child.emit('exit', 0, null); child.emit('close', 0, null); }); } });
        setImmediate(() => child.emit('spawn'));
        return child;
      }
      if (args.includes('--version') || args.includes('--help') || args.includes('status')) {
        const stdout = args.includes('--version') ? '2.1.280\n' : args.includes('--help') ? 'auth status\n' : JSON.stringify({ loggedIn: claudeLoggedIn,
          ...(claudeLoggedIn ? { authMethod: 'claude.ai', subscriptionType: 'pro', apiProvider: 'firstParty' } : {}) });
        const child = childProcess({ final() { setImmediate(() => { child.stdout.end(stdout); child.emit('exit', 0, null); child.emit('close', 0, null); }); } });
        return child;
      }
      if (command === providerExe && args[0] === 'app-server') {
        const child = childProcess({ write(data) {
          for (const line of data.split('\n').filter(Boolean)) {
            const message = JSON.parse(line);
            appServerMessages.push(message);
            if (message.id === undefined) continue;
            let result = {};
            if (message.method === 'config/read') result = { config: {} };
            if (message.method === 'account/read') result = { account: { type: 'chatgpt' } };
            if (message.method === 'model/list') result = { data: [{ model: 'gpt-6-luna', displayName: 'GPT-6 Luna', hidden: false,
              supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null };
            if (message.method === 'thread/start' || message.method === 'thread/resume') result = { thread: { id: 'isolated-test-thread' } };
            if (message.method === 'thread/goal/get') result = { goal: null };
            if (message.method === 'thread/backgroundTerminals/list') result = { data: [] };
            if (message.method === 'windowsSandbox/readiness') result = { status: 'notConfigured' };
            if (message.method === 'turn/start') result = { turn: { id: 'isolated-test-turn' } };
            setImmediate(() => child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
          }
        }, final() { setImmediate(() => { child.stdout.end(); child.emit('exit', 0, null); child.emit('close', 0, null); }); } });
        setImmediate(() => child.emit('spawn'));
        return child;
      }
      if (command === process.execPath) {
        const child = childProcess();
        setImmediate(() => { child.stdout.end('TAP version 13\n'); child.emit('exit', 0, null); child.emit('close', 0, null); });
        return child;
      }
      throw new Error(`Unexpected isolated child: ${command} ${args.join(' ')}`);
    },
  };
  return { pool, calls, appServerMessages, get claudeMcpConfig() { return claudeMcpConfig; } };
}

async function fixture(t, { allowLogin = false, claudeLoggedIn = false, workspaceAccess, seedProjectMetadata } = {}) {
  await mkdir(testRoot, { recursive: true });
  const base = await mkdtemp(path.join(testRoot, 'isolated-desktop-'));
  const root = path.join(base, 'state'); const workspace = path.join(base, 'workspace');
  await mkdir(root); await mkdir(workspace);
  const outsider = path.join(base, 'outside'); await mkdir(outsider);
  if (seedProjectMetadata) {
    await mkdir(path.join(root, '.runtime'), { recursive: true });
    await writeFile(path.join(root, '.runtime', 'projects.json'), JSON.stringify([{ path: workspace, ...seedProjectMetadata }]));
  }
  const sandbox = fakePool({ claudeLoggedIn });
  const { pool, calls } = sandbox;
  const mocked=t.mock.method(childProcessModule,'spawn',pool.spawnImpl);syncBuiltinESMExports();
  t.after(()=>{mocked.mock.restore();syncBuiltinESMExports();});
  let options;
  const browserCalls = [];
  const browsers = {
    request: async () => ({}), close: async () => { browserCalls.push('close'); },
    session() { browserCalls.push('session'); return { config: async () => null, close: async () => { browserCalls.push('session-close'); } }; },
  };
  const app = await startIsolatedDesktop({ root, workspace, port: 47832, executable: providerExe, commandSpec: claudeSpec,
    env:{...agentEnv,CLAUDE_CONFIG_DIR:path.join(base,'claude-config'),K_TEST_CLAUDE_LOGGED_IN:claudeLoggedIn?'1':'0'}, browsers, allowLogin,
    startDesktopImpl: async (received) => {
      options = received;
      const controller = received.controllerFactory({ root: received.root, executable: received.executable });
      return { controller, async close() { await controller.close(); } };
    },
  });
  t.after(() => app.close());
  return { app, options, get optionsRead() { return options; }, root, workspace, outsider, pool, calls, appServerMessages:sandbox.appServerMessages, sandbox, browsers: browserCalls };
}

test('isolated desktop forces launch-token capability, fixes workspace, and denies login by default', async (t) => {
  const f = await fixture(t);
  assert.equal(f.optionsRead.executable, providerExe);
  assert.equal(f.optionsRead.port, 47832);
  assert.equal((await f.app.controller.state).workspace, f.workspace);
  await assert.rejects(f.app.controller.selectWorkspace({ path: f.outsider }), /此隔離環境僅允許指定的工作區/u);
  await assert.rejects(f.app.controller.open({model:'gpt-6-luna',workspace:f.outsider}), /此隔離環境僅允許指定的工作區/u);
  await assert.rejects(f.app.controller.open({model:'gpt-6-luna',workspace:f.root}), /此隔離環境僅允許指定的工作區/u);
  const registeredOther = path.join(path.dirname(f.workspace), 'registered-other'); await mkdir(registeredOther); await addProject(f.root, registeredOther);
  await f.app.controller.selectWorkspace({path:registeredOther});
  assert.equal(f.app.controller.state.workspace,registeredOther);
  const projects=(await listProjects(f.root)).projects;
  assert.equal(projects.find(item=>item.path===f.root).archived,true);
  assert.deepEqual(projects.filter(item=>!item.archived).map(item=>item.path).sort(),[f.workspace,registeredOther].sort());
  const claudeLogin = f.optionsRead.claudeLoginFactory();
  const codexLogin = f.optionsRead.codexLoginFactory();
  await assert.rejects(claudeLogin.start(), /尚未允許真實帳號登入/u);
  await assert.rejects(codexLogin.start(), /尚未允許真實帳號登入/u);
  assert.equal(f.calls.length, 0, 'blocked login must not start a host or runner process');
});

test('Claude auth inspection and Codex catalog use explicit isolated runner, CLI paths and workspace', async (t) => {
  const f = await fixture(t);
  const result = await f.optionsRead.claudeLoginFactory().status();
  assert.equal(result.auth.loggedIn, false);
  await f.app.controller.models();
  const codex = f.calls.find((call) => call.command === providerExe && call.args[0] === 'app-server');
  assert.ok(codex, 'Codex catalog host should be started through the injected runner');
  assert.equal(codex.options.cwd, f.workspace);
  assert.equal(codex.options.env.USERPROFILE, agentEnv.USERPROFILE);
  assert.equal(codex.options.env.DEEPSEEK_API_KEY, undefined);
});

test('Claude Luna bridge launches its Codex host through the same isolated runner', async (t) => {
  const f = await fixture(t, { claudeLoggedIn: true });
  await f.app.controller.open({ model: 'claude-opus-5-5' });
  const claudeHostCall = f.calls.find((call) => call.command === claudeSpec.command && call.args.includes('--input-format'));
  assert.ok(claudeHostCall, 'Claude session should use the isolated provider runner');
  const luna = f.sandbox.claudeMcpConfig?.mcpServers?.k_luna;
  assert.ok(luna?.url && luna.headers?.Authorization, 'Claude receives the authenticated Luna gateway config');

  const headers = { Authorization: luna.headers.Authorization, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const init = await fetch(luna.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'isolated-desktop-test', version: '1' } } }) });
  assert.ok(init.ok, `MCP initialize should succeed (${init.status})`);
  await init.text();
  await fetch(luna.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) });
  const listed = await fetch(luna.url, {method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/list'})});
  const description=await listed.text();
  assert.match(description,/AI 自動選擇目前啟用/);
  assert.doesNotMatch(description,/目前預設為 GPT-6 Luna/);
  const inspect = await fetch(luna.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'luna_inspect', arguments: { requestId: 'missing-request' } } }) });
  assert.ok(inspect.ok, `Luna inspect should succeed (${inspect.status})`);
  const inspectBody = await inspect.text();
  assert.doesNotMatch(inspectBody, /"isError"\s*:\s*true/u);
  const lunaHost = f.calls.find((call) => call.command === providerExe && call.args[0] === 'app-server');
  assert.ok(lunaHost, 'Luna bridge should create its native Codex host via the injected runner');
  assert.equal(lunaHost.options.cwd, f.workspace);
  assert.equal(lunaHost.options.env.USERPROFILE, agentEnv.USERPROFILE);
});

test('switching registered workspace routes Claude and its Luna Codex host to that workspace', async (t) => {
  const f = await fixture(t, { claudeLoggedIn: true, workspaceAccess: { async validateWorkspacePath(candidate) { return candidate; } } });
  const second = path.join(path.dirname(f.workspace), 'claude-workspace');
  await mkdir(second); await addProject(f.root, second);
  await f.app.controller.selectWorkspace({ path: second });
  await f.app.controller.open({ model: 'claude-opus-5-5' });
  const claude = f.calls.find(call => call.command === claudeSpec.command && call.args.includes('--input-format'));
  assert.ok(claude);
  assert.equal(claude.options.cwd, second);
  const luna = f.sandbox.claudeMcpConfig?.mcpServers?.k_luna;
  assert.ok(luna?.url && luna.headers?.Authorization);
  const init = await fetch(luna.url, { method: 'POST', headers: {
    Authorization: luna.headers.Authorization, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'isolated-workspace-test', version: '1' } } }) });
  assert.ok(init.ok);
  await init.text();
  await fetch(luna.url, { method: 'POST', headers: {
    Authorization: luna.headers.Authorization, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) });
  const inspected = await fetch(luna.url, { method: 'POST', headers: {
    Authorization: luna.headers.Authorization, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'luna_inspect', arguments: { requestId: 'missing-workspace-request' } } }) });
  assert.ok(inspected.ok);
  await inspected.text();
  const codex = f.calls.find(call => call.command === providerExe && call.args[0] === 'app-server');
  assert.ok(codex);
  assert.equal(codex.options.cwd, second);
});

test('native main Codex preserves provider-owned permissions', async (t) => {
  const f = await fixture(t);
  const opened = await f.app.controller.open({ model: 'gpt-6-luna' });
  await f.app.controller.send({ threadId: opened.threadId, text: 'fake isolated policy check' });
  const thread = f.appServerMessages.find(message => message.method === 'thread/start')?.params;
  const turn = f.appServerMessages.find(message => message.method === 'turn/start')?.params;
  assert.equal(thread.approvalPolicy, 'on-request');
  assert.equal(thread.approvalsReviewer, 'user');
  assert.equal(turn.approvalPolicy, 'on-request');
  assert.equal(turn.approvalsReviewer, 'user');
  assert.equal(turn.sandboxPolicy.type,'workspaceWrite');
  assert.deepEqual(turn.sandboxPolicy.writableRoots,[f.workspace]);
  assert.equal(thread.config.sandbox_mode, 'workspace-write', 'thread-start retains its native enum; each turn explicitly overrides policy');
  assert.equal(f.app.controller.state.executionPolicy,undefined);
  assert.equal(f.app.controller.state.sandboxReadiness, 'notConfigured', 'retain the native diagnostic instead of claiming the inner sandbox is ready');
  assert.equal(f.app.controller.state.notices.some(notice => notice.kind === 'windowsSandboxReadiness'), true, 'native sandbox readiness remains actionable');
});

test('isolated workspace API permits only owner-registered canonical projects and routes every live provider host to the selected folder', async (t) => {
  const validated = [];
  const f = await fixture(t, { workspaceAccess: { async validateWorkspacePath(candidate) { validated.push(candidate); return candidate; } } });
  const second = path.join(path.dirname(f.workspace), 'second-workspace');
  await mkdir(second);
  await addProject(f.root, second);

  await f.app.controller.selectWorkspace({ path: second });
  assert.equal(f.app.controller.state.workspace, second);
  await assert.rejects(f.app.controller.selectWorkspace({ path: f.outsider }), /此隔離環境僅允許指定的工作區/u);

  await f.app.controller.open({ model: 'gpt-6-luna' });
  const codex = f.calls.find((call) => call.command === providerExe && call.args[0] === 'app-server');
  assert.ok(codex);
  assert.equal(codex.options.cwd, second);
});

test('starting isolated desktop preserves the selected projects name and archived state', async (t) => {
  const f = await fixture(t, { seedProjectMetadata: { name: 'Owner label', archived: true, pinned: true } });
  const projects = (await listProjects(f.root)).projects;
  assert.deepEqual(projects.find(item => item.path === f.workspace), {
    path: f.workspace, name: 'Owner label', archived: true, pinned: true,
  });
});

test('desktop workspace validator covers owner project registration and picker results', async (t) => {
  const base = await mkdtemp(path.join(testRoot, 'desktop-project-validator-'));
  const root = path.join(base, 'state'), picked = path.join(base, 'picked');
  await mkdir(root); await mkdir(picked);
  await addProject(root, picked);
  await updateProject(root, { path: picked, name: 'Keep this owner label', archived: true, pinned: true });
  const validated = [];
  const controller = { state: { workspace: root }, async close() {}, async sessions() { return { sessions: [] }; } };
  const login = { async close() {}, async status() { return {}; }, progress() { return {}; }, async start() { return {}; }, async cancel() { return {}; } };
  let malformedPicker = true;
  const app = await startDesktop({ root, port: 0, controllerFactory: () => controller,
    pickWorkspace: async ({ path: initial }) => malformedPicker ? picked : ({ cancelled: false, path: picked }),
    validateProjectWorkspace: async candidate => { validated.push(candidate); return path.resolve(candidate); },
    claudeLoginFactory: () => login, codexLoginFactory: () => login });
  t.after(() => app.close());

  const page = await fetch(app.createLaunchUrl(),{redirect:'manual'});
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const request = (url, body) => fetch(new URL(url, app.origin), { method: 'POST', headers: {
    Cookie: cookie, Origin: app.origin, 'X-K-Request': '1', 'Content-Type': 'application/json',
  }, body: JSON.stringify(body) });
  const malformed = await request('/api/pick-workspace', {});
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /資料夾選擇器未回傳有效結果/u);
  malformedPicker = false;
  const projectResponse = await request('/api/projects', { path: picked });
  assert.equal(projectResponse.status, 200);
  assert.equal((await projectResponse.json()).path, picked);
  const restored = (await listProjects(root)).projects.find(item => item.path === picked);
  assert.deepEqual(restored, { path: picked, name: 'Keep this owner label', archived: false, pinned: true });
  const pickerResponse = await request('/api/pick-workspace', {});
  assert.equal(pickerResponse.status, 200);
  assert.equal((await pickerResponse.json()).path, picked);
  assert.deepEqual(validated, [picked, picked]);
});
