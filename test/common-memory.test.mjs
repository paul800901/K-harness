import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile, stat} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import path from 'node:path';
import {
  CODEX_CONTEXT_BYTES,
  COMMON_MEMORY_KEY,
  claudeCommonBlock,
  codexCommonContext,
  commonMemoryPath,
  readCommonMemory,
  writeGeminiCommonRule
} from '../src/common-memory.mjs';
import {openDiscussionSession} from '../src/discussion-native.mjs';
import {createClaudeWorker} from '../src/claude-worker.mjs';
import {createGeminiWorker} from '../src/gemini-worker.mjs';
import {scratchBase} from './scratch.mjs';

// Synthetic private roots only: no real common memory text is read or committed.
async function privateRoot(content) {
  await mkdir(scratchBase, {recursive: true});
  const root = await mkdtemp(path.join(scratchBase, 'common memory 私人-'));
  if (content !== undefined) await writeMemory(root, content);
  return root;
}
async function writeMemory(root, content) {
  await mkdir(path.dirname(commonMemoryPath(root)), {recursive: true});
  await writeFile(commonMemoryPath(root), content);
}
const exists = file =>
  stat(file).then(
    () => true,
    () => false
  );

test('reader returns the complete current file or an explicit unavailable state, never creating it', async () => {
  const root = await privateRoot('\uFEFF# 合成偏好\n- 假偏好甲\n');
  const file = commonMemoryPath(root);
  assert.equal(file, path.join(root, 'agent-home', 'shared', 'common-memory.md'));
  const first = readCommonMemory(root);
  assert.equal(first.ok, true);
  assert.equal(first.text, '# 合成偏好\n- 假偏好甲\n');
  assert.match(first.version, /^[0-9a-f]{12}$/);
  await writeMemory(root, '# 合成偏好\n- 假偏好乙\n');
  const second = readCommonMemory(root);
  assert.notEqual(second.version, first.version);
  assert.doesNotMatch(second.text, /假偏好甲/);

  await rm(file);
  assert.deepEqual(readCommonMemory(root), {ok: false, path: file, reason: '檔案不存在'});
  assert.equal(await exists(file), false, 'a normal read must not recreate the file');

  await writeFile(file, Buffer.from([0x23, 0xff, 0xfe]));
  assert.match(readCommonMemory(root).reason, /^讀取失敗/);
  await rm(file);
  await mkdir(file);
  assert.match(readCommonMemory(root).reason, /^讀取失敗：EISDIR/);
  assert.equal(readCommonMemory('relative/root').ok, false, 'an invalid root is unavailable, not a crash');
  assert.equal(readCommonMemory(undefined).path, null);
});

test('unavailable common memory is explicit and never falls back to older preferences', async () => {
  const root = await privateRoot();
  const value = codexCommonContext(readCommonMemory(root))[COMMON_MEMORY_KEY].value;
  assert.match(value, /K 共同記憶目前無法讀取（檔案不存在；/);
  assert.match(value, /本人共同偏好此刻未知/);
  assert.match(value, /不要把本對話先前的共同記憶版本或舊版內建分工當成現行偏好/);
  assert.doesNotMatch(value, /Flash|Opus|Sol|Astra/);
});

test('Codex context is one application entry, inline within the native budget and complete otherwise', async () => {
  const root = await privateRoot('# 合成\n- 短偏好\n');
  const context = codexCommonContext(readCommonMemory(root));
  assert.deepEqual(Object.keys(context), [COMMON_MEMORY_KEY]);
  assert.equal(context[COMMON_MEMORY_KEY].kind, 'application');
  assert.match(context[COMMON_MEMORY_KEY].value, /取代本對話先前的共同記憶版本與舊版內建分工/);
  assert.match(context[COMMON_MEMORY_KEY].value, /- 短偏好/);
  assert.deepEqual(codexCommonContext(readCommonMemory(root)), context, 'unchanged input yields an identical entry');
  const compacted = codexCommonContext(readCommonMemory(root), 2)[COMMON_MEMORY_KEY].value;
  assert.match(compacted, /第 2 次壓縮後重新附上/);

  // Chinese text is three UTF-8 bytes per character: the native budget is bytes, not characters.
  const long = `# 合成長文\n${'很長的假偏好。'.repeat(220)}\n尾端假標記\n`;
  assert.ok(long.length < CODEX_CONTEXT_BYTES && Buffer.byteLength(long) > CODEX_CONTEXT_BYTES);
  await writeMemory(root, long);
  const pointer = codexCommonContext(readCommonMemory(root), 1)[COMMON_MEMORY_KEY].value;
  assert.ok(Buffer.byteLength(pointer) <= CODEX_CONTEXT_BYTES);
  assert.doesNotMatch(pointer, /很長的假偏好/, 'never a silently sliced body');
  assert.match(pointer, /超過 GPT 原生附加上下文的單項上限/);
  assert.match(pointer, /先以唯讀方式讀取正本全文/);
  assert.ok(pointer.includes(commonMemoryPath(root)));
  assert.match(pointer, /第 1 次壓縮後重新附上/);
  // Claude and Gemini have no such per-entry cut: they keep the complete body.
  assert.match(claudeCommonBlock(root).block.text, /尾端假標記/);
});

test('Claude block is sent again only after content, compaction or host changes', async () => {
  const root = await privateRoot('- 假偏好甲');
  const first = claudeCommonBlock(root, null, 0);
  assert.match(first.block.text, /^<k_common_memory>\n[\s\S]*- 假偏好甲\n<\/k_common_memory>$/);
  assert.equal(claudeCommonBlock(root, first.key, 0).block, null);
  assert.ok(claudeCommonBlock(root, first.key, 1).block, 'a compaction delivers it again');
  await writeMemory(root, '- 假偏好乙');
  const changed = claudeCommonBlock(root, first.key, 0);
  assert.match(changed.block.text, /假偏好乙/);
  assert.doesNotMatch(changed.block.text, /假偏好甲/);
  await rm(commonMemoryPath(root));
  const missing = claudeCommonBlock(root, changed.key, 0);
  assert.match(missing.block.text, /無法讀取（檔案不存在/);
  assert.equal(claudeCommonBlock(root, missing.key, 0).block, null, 'a missing notice is not repeated');
});

test('Gemini rule is a short always-on native reference, or an explicit notice without a reference', async () => {
  const root = await privateRoot('- 假偏好甲');
  const home = path.join(root, 'gemini-home');
  await writeGeminiCommonRule(home, root);
  const rule = path.join(home, '.gemini', 'config', 'rules', 'k-common-memory.md');
  const text = await readFile(rule, 'utf8');
  assert.ok(text.startsWith('---\ntrigger: always_on\n---\n'));
  assert.ok(text.includes(`@[K 共同記憶](${commonMemoryPath(root)})`));
  assert.doesNotMatch(text, /假偏好甲/, 'the body stays in the single private file');
  assert.ok(Buffer.byteLength(text) < 1024);
  await rm(commonMemoryPath(root));
  await writeGeminiCommonRule(home, root);
  const missing = await readFile(rule, 'utf8');
  assert.doesNotMatch(missing, /@\[/);
  assert.match(missing, /K 共同記憶目前無法讀取（檔案不存在/);
  assert.equal(await exists(commonMemoryPath(root)), false);
});

test('Codex discussion turns carry the current entry; Claude discussion repeats it only after a change', async () => {
  const root = await privateRoot('- 討論假偏好甲');
  const calls = [];
  let event;
  const codex = await openDiscussionSession({
    root,
    workspace: root,
    selection: {model: 'gpt-6.1-sol', effort: 'high'},
    codexHost: opts => {
      event = opts.onEvent;
      return {
        closed: new Promise(() => {}),
        notify() {},
        async request(method, params) {
          calls.push({method, params});
          if (method === 'windowsSandbox/readiness') return {status: 'ready'};
          if (method === 'config/read') return {config: {}};
          if (method === 'thread/start') return {thread: {id: 'native-discussion'}};
          if (method === 'turn/start') {
            queueMicrotask(() => event({method: 'turn/completed', params: {turn: {status: 'completed'}}}));
            return {turn: {id: 'turn'}};
          }
          return {};
        },
        async close() {}
      };
    }
  });
  await codex.ask('第一輪');
  await writeMemory(root, '- 討論假偏好乙');
  event({method: 'item/completed', params: {item: {type: 'contextCompaction', id: 'c1'}}});
  await codex.ask('第二輪');
  await codex.close();
  const turns = calls.filter(c => c.method === 'turn/start').map(c => c.params);
  assert.doesNotMatch(calls.find(c => c.method === 'thread/start').params.developerInstructions, /討論假偏好/);
  assert.match(turns[0].additionalContext[COMMON_MEMORY_KEY].value, /討論假偏好甲/);
  assert.match(turns[1].additionalContext[COMMON_MEMORY_KEY].value, /討論假偏好乙[\s\S]*第 1 次壓縮後/);
  assert.deepEqual(turns[1].input, [{type: 'text', text: '第二輪'}]);

  const starts = [];
  let onMessage;
  const claude = await openDiscussionSession({
    root,
    workspace: root,
    selection: {model: 'claude-opus-5-5'},
    claudeHost: async opts => {
      onMessage = opts.onMessage;
      return {
        closed: new Promise(() => {}),
        async start(content) {
          starts.push(content);
          queueMicrotask(() => onMessage({type: 'result', subtype: 'success', result: 'ok'}));
        },
        async close() {}
      };
    }
  });
  await claude.ask('一');
  await claude.ask('二');
  await writeMemory(root, '- 討論假偏好丙');
  await claude.ask('三');
  onMessage({type: 'system', subtype: 'compact_boundary'});
  await claude.ask('四');
  assert.match(starts[0][0].text, /討論假偏好乙/);
  assert.deepEqual(starts[0][1], {type: 'text', text: '一'});
  assert.equal(starts[1], '二', 'unchanged memory is not stacked into history');
  assert.match(starts[2][0].text, /討論假偏好丙/);
  assert.match(starts[3][0].text, /討論假偏好丙/);
});

test('Gemini discussion refreshes its native reference rule before each ask', async () => {
  const root = await privateRoot('- 假偏好');
  const homes = [];
  const session = await openDiscussionSession({
    root,
    workspace: root,
    selection: {model: 'gemini-3.8-flash'},
    env: {...process.env, LOCALAPPDATA: path.join(root, 'local')},
    runGemini: async (exe, args, options) => {
      homes.push(await readFile(path.join(options.env.USERPROFILE, '.gemini/config/rules/k-common-memory.md'), 'utf8'));
      options.onChunk(JSON.stringify({event: 'init', conversation_id: 'g-1'}) + '\n');
      options.onChunk(JSON.stringify({event: 'result', result: {status: 'SUCCESS', response: 'ok'}}) + '\n');
      return {code: 0, stderr: ''};
    }
  });
  await session.ask('一');
  await rm(commonMemoryPath(root));
  await session.ask('二');
  await session.close();
  assert.match(homes[0], /@\[K 共同記憶\]/);
  assert.match(homes[1], /無法讀取（檔案不存在/);
  assert.doesNotMatch(homes[1], /@\[/);
});

test('leaf and nested Claude workers send the memory block before the unchanged delegated task', async () => {
  const root = await privateRoot('- 工人假偏好');
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace, {recursive: true});
  for (const mcpConfig of [undefined, {mcpServers: {k_luna: {}}}]) {
    let sent;
    const worker = createClaudeWorker({
      root,
      workspace,
      hostFactory: async () => {
        let done;
        const closed = new Promise(resolve => (done = resolve));
        return {
          models: [{model: 'claude-opus-5-5', supportedReasoningEfforts: [{reasoningEffort: 'low'}]}],
          closed,
          pid: 1,
          async start(content) {
            sent = content;
            done();
          },
          async interrupt() {},
          async close() {}
        };
      }
    });
    await worker.run({task: '合成任務', model: 'claude-opus-5-5', effort: 'low', mcpConfig});
    assert.match(sent[0].text, /^<k_common_memory>[\s\S]*工人假偏好/);
    assert.match(sent[1].text, /<DELEGATED_TASK>\n合成任務\n<\/DELEGATED_TASK>$/);
    assert.match(sent[1].text, mcpConfig ? /小工人不能再派工/ : /不再派工/, 'worker depth rules are unchanged');
  }
});

test('Flash worker writes the reference rule into the runHome that agy actually uses', async () => {
  const root = await privateRoot('- Flash 假偏好');
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace, {recursive: true});
  const calls = [];
  const worker = createGeminiWorker({
    root,
    workspace,
    accessMode: 'read-only',
    env: {LOCALAPPDATA: path.join(root, 'local'), Path: 'fake', SystemRoot: 'C:/Windows'},
    gitStatus: async () => null,
    spawnImpl: (exe, args, options) => {
      const child = new EventEmitter();
      Object.assign(child, {pid: 50000 + calls.length, stdout: new PassThrough(), stderr: new PassThrough()});
      calls.push({args, options});
      queueMicrotask(() => {
        child.stdout.write(
          args[0] === 'models'
            ? 'gemini-3.8-flash-low\tFlash'
            : JSON.stringify({event: 'result', result: {status: 'SUCCESS', response: 'done'}}) + '\n'
        );
        child.emit('close', 0);
      });
      return child;
    }
  });
  await worker.run({task: '合成任務', effort: 'low'});
  const run = calls.find(call => call.args[0] === '-p');
  const rule = await readFile(
    path.join(run.options.env.USERPROFILE, '.gemini/config/rules/k-common-memory.md'),
    'utf8'
  );
  assert.ok(rule.includes(`@[K 共同記憶](${commonMemoryPath(root)})`));
  assert.doesNotMatch(run.args[1], /Flash 假偏好/, 'no second copy in the prompt');
});
