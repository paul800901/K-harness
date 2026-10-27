import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import path from 'node:path';
import {createUnifiedController} from '../src/unified-controller.mjs';
import {createDiscussionController} from '../src/discussion-controller.mjs';
import {roundtableData} from '../frontend/discussion-roundtable-data.mjs';
import {createDiscussionReader, MAX_DISCUSSION_FILE_BYTES} from '../src/discussion-read-tools.mjs';
import {scratchBase} from './scratch.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';

async function fixture({sendFailure, metadata, prepareHumanSend, stop} = {}) {
  const root = await mkdtemp(path.join(scratchBase, 'host-'));
  let change;
  const calls = [],
    state = {threadId: 'same-native', status: 'ready', busy: false, messages: [], workers: [], questions: []};
  const controller = createUnifiedController({
    root,
    prepareHumanSend,
    codexFactory: opts => {
      change = opts.onChange;
      return {
        state,
        async open() {
          return {threadId: state.threadId};
        },
        async send({text, discussionTurn}) {
          assert(!state.busy, 'a host must share the native busy reservation');
          calls.push({nativeId: state.threadId, id: discussionTurn?.id, text});
          state.busy = true;
          state.status = 'working';
          const id = discussionTurn?.id ?? 'human';
          state.messages.push({id: id + '-u', groupId: id, role: 'user', text});
          change();
          await discussionTurn?.bind({groupId: id, messageId: id + '-u'});
          if (sendFailure) throw sendFailure;
          return {sent: true};
        },
        async interruptDiscussion(id) {
          calls.push({interrupt: id});
        },
        async stop() {
          if (stop) return stop();
          throw Error('general stop must not be used');
        },
        async metadata(data) {
          return metadata?.(data);
        },
        async close() {}
      };
    }
  });
  const finish = (id, text = '{"action":"finish","reason":"足夠","summary":"整理"}', status = 'completed') => {
    state.messages.push({id: id + '-a', groupId: id, role: 'assistant', text});
    state.busy = false;
    state.status = status;
    change();
  };
  return {root, controller, state, calls, finish, change: () => change()};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('metadata changes wait before host submission and never invalidate a submitted host turn', async () => {
  for (const submitted of [false, true]) {
    const gate = Promise.withResolvers(),
      entered = Promise.withResolvers();
    const f = await fixture({
      metadata: async () => {
        entered.resolve();
        await gate.promise;
      }
    });
    await saveMainSession(f.root, {threadId: f.state.threadId, model: 'gpt-6.1-sol', workspace: f.root});
    const ask = () => f.controller.askHost('host', {id: 'metadata-host', bind: async () => {}});
    let answer = submitted ? ask() : null;
    if (submitted) await tick();
    const rename = f.controller.metadata({threadId: f.state.threadId, title: 'renamed'});
    await entered.promise;
    answer ??= ask();
    f.change();
    if (submitted) f.finish('metadata-host', 'still valid');
    else assert.equal(f.calls.length, 0);
    gate.resolve();
    await rename;
    if (!submitted) {
      await tick();
      f.finish('metadata-host', 'still valid');
    }
    assert.equal(await answer, 'still valid');
    assert.equal(f.calls.length, 1);
    await f.controller.close();
  }
});

test('queued human text claims discussion handoff only at delivery, and removing a row consumes nothing', async () => {
  const prepared = [];
  const f = await fixture({
    prepareHumanSend: async data => {
      prepared.push(data.text);
      return {text: 'discussion context: ' + data.text};
    }
  });
  await f.controller.open({model: 'gpt-6-astra'});
  f.state.busy = true;
  f.state.status = 'working';
  const removed = await f.controller.send({text: 'remove me'});
  const queued = await f.controller.send({text: 'keep me'});
  assert.deepEqual(
    f.controller.state.queuedMessages.map(x => x.text),
    ['remove me', 'keep me']
  );
  await f.controller.queue({id: removed.id, action: 'remove'});
  assert.deepEqual(prepared, []);
  f.state.busy = false;
  f.state.status = 'completed';
  await f.controller.queue({id: queued.id, action: 'send-now'});
  assert.deepEqual(prepared, ['keep me']);
  assert.equal(f.calls[0].text, 'discussion context: keep me');
  await f.controller.close();
});

test('stop during discussion preparation restores its claim and never reaches the native core', async () => {
  const gate = Promise.withResolvers(),
    entered = Promise.withResolvers();
  let restored = 0;
  const f = await fixture({
    stop: async () => ({stopped: true}),
    prepareHumanSend: async () => {
      entered.resolve();
      await gate.promise;
      return {
        text: 'internal handoff',
        rejected: async () => {
          restored++;
        }
      };
    }
  });
  await f.controller.open({model: 'gpt-6-astra'});
  const sent = f.controller.send({text: 'human'});
  await entered.promise;
  await f.controller.stop();
  gate.resolve();
  await assert.rejects(sent, error => error.notSent === true);
  assert.equal(restored, 1);
  assert.equal(f.calls.length, 0);
  await f.controller.close();
});

test('host waits for native work/notifications and shares the same native identity, without a second session', async () => {
  const f = await fixture(),
    waiting = [],
    bindings = [];
  f.state.busy = true;
  f.state.status = 'working';
  const answer = f.controller.askHost('host prompt', {
    id: 'discussion-host-one',
    bind: b => bindings.push(b),
    onWaiting: w => waiting.push(w)
  });
  assert.equal(f.calls.length, 0);
  f.state.busy = false;
  f.state.status = 'completed';
  f.state.completionPending = true;
  f.change();
  assert.equal(f.calls.length, 0);
  f.state.completionPending = false;
  f.change();
  await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].nativeId, 'same-native');
  assert.equal(f.state.busy, true);
  f.finish('discussion-host-one');
  assert.match(await answer, /整理/);
  assert(waiting.includes(true));
  assert.equal(bindings[0].groupId, 'discussion-host-one');
  await f.controller.close();
});

test('removing the last queued human message wakes a waiting host through the same queue events', async () => {
  const f = await fixture();
  await f.controller.open({model: 'gpt-6-astra'});
  f.state.busy = true;
  f.state.status = 'working';
  const queued = await f.controller.send({text: 'queued human'});
  await f.controller.queue({id: queued.id, action: 'edit-start'});
  const answer = f.controller.askHost('host after queue', {id: 'discussion-host-queue', bind: async () => {}});
  f.state.busy = false;
  f.state.status = 'completed';
  f.change();
  assert.equal(f.calls.length, 0);
  await f.controller.queue({id: queued.id, action: 'remove'});
  await tick();
  assert.equal(f.calls.length, 1);
  f.finish('discussion-host-queue');
  assert.match(await answer, /整理/);
  await f.controller.close();
});

test('stop interrupts only the owned host turn and waits for a native terminal event, keeping the session usable', async () => {
  const f = await fixture(),
    abort = new AbortController();
  let settled = false;
  const answer = f.controller
    .askHost('stop', {id: 'discussion-host-stop', signal: abort.signal, bind: async () => {}})
    .catch(error => {
      settled = true;
      return error;
    });
  await tick();
  abort.abort();
  await tick();
  assert.deepEqual(f.calls.at(-1), {interrupt: 'discussion-host-stop'});
  assert.equal(settled, false);
  assert.equal(f.state.busy, true);
  f.finish('discussion-host-stop', '', 'interrupted');
  assert((await answer) instanceof Error);
  assert.equal(f.state.threadId, 'same-native');
  await f.controller.send({text: 'ordinary follow-up'});
  assert.equal(f.calls.at(-1).nativeId, 'same-native');
  await f.controller.close();
});

test('offline main session fails without sending or opening another host; pending cancellation leaves unrelated native work alone', async () => {
  const f = await fixture();
  f.state.status = 'offline';
  await assert.rejects(f.controller.askHost('x', {id: 'discussion-host-offline'}), /主 session/);
  assert.equal(f.calls.length, 0);
  f.state.status = 'working';
  f.state.busy = true;
  const abort = new AbortController();
  const answer = f.controller.askHost('x', {id: 'discussion-host-waiting', signal: abort.signal});
  abort.abort();
  await assert.rejects(answer);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.busy, true);
  await f.controller.close();
});

test('host projection uses durable IDs, retains ordinary identical text and all participant originals after reload', async () => {
  const f = await fixture();
  const d = createDiscussionController({
    root: f.root,
    threadId: 'room',
    askHost: f.controller.askHost,
    sessionFactory: async () => ({ask: async () => 'original evidence', close: async () => {}})
  });
  await d.load();
  await d.start({
    mode: 'meeting',
    text: 'question',
    brief: 'brief',
    workspace: f.root,
    participants: [
      {id: 'p1', model: 'same'},
      {id: 'p2', model: 'same'}
    ],
    facilitator: {id: 'host', model: 'main'}
  });
  while (!f.calls.length) await tick();
  f.finish(f.calls[0].id);
  await d.settled();
  const visible = {id: 'ordinary', role: 'assistant', text: f.state.messages.at(-1).text};
  f.state.messages.push(visible);
  assert(!d.project(f.state.messages).some(m => m.groupId === f.calls[0].id));
  assert(d.project(f.state.messages).some(m => m.id === 'ordinary'));
  assert.deepEqual(
    d.messages.filter(m => m.model).map(m => [m.participantId, m.round]),
    [
      ['p1', 1],
      ['p2', 1]
    ]
  );
  assert.equal(d.state.runs[0].decisions[0].reason, '足夠');
  const reopened = createDiscussionController({root: f.root, threadId: 'room'});
  await reopened.load();
  assert.deepEqual(reopened.project(f.state.messages), JSON.parse(JSON.stringify(d.project(f.state.messages))));
  await f.controller.close();
});

test('long host materials are saved verbatim and referenced instead of truncation', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'host-long-'));
  let prompt;
  const d = createDiscussionController({
    root,
    threadId: 'long',
    askHost: async text => {
      prompt = text;
      return 'summary';
    },
    sessionFactory: async () => ({ask: async () => '報告'.repeat(17000) + 'TAIL_EVIDENCE', close: async () => {}})
  });
  await d.load();
  await d.start({
    mode: 'parallel',
    text: 'Q',
    brief: 'B',
    participants: [{id: 'p1'}, {id: 'p2'}],
    facilitator: {id: 'host'},
    workspace: root
  });
  await d.settled();
  assert.equal(d.state.status, 'completed');
  assert(prompt.length < 32000);
  const record = JSON.parse(await readFile(path.join(root, '.runtime/discussions/long.json'), 'utf8'));
  const host = record.runs[0].hostTurns[0];
  assert.equal(await readFile(host.promptPath, 'utf8'), host.prompt);
  assert(host.prompt.includes('TAIL_EVIDENCE'));
  assert(!d.messages.some(m => m.text === prompt));
});

test('an unconfirmed host send becomes uncertain and is never sent again', async () => {
  const f = await fixture({sendFailure: Error('transport closed after submission')});
  let opened = 0;
  const d = createDiscussionController({
    root: f.root,
    threadId: 'unknown',
    askHost: f.controller.askHost,
    sessionFactory: async () => {
      opened++;
      return {ask: async () => 'evidence', close: async () => {}};
    }
  });
  await d.load();
  await d.start({
    mode: 'meeting',
    text: 'Q',
    brief: 'B',
    participants: [{id: 'p1'}, {id: 'p2'}],
    facilitator: {id: 'host'},
    workspace: f.root
  });
  await d.settled();
  assert.equal(d.state.status, 'uncertain');
  assert.match(d.state.error, /transport closed/);
  assert.equal(opened, 2, 'only participant sessions may be opened');
  f.change();
  await tick();
  assert.equal(f.calls.length, 1);
  await assert.rejects(d.stop({threadId: 'unknown', runId: d.state.id}), /不能冒稱已停止/);
  await f.controller.close();
});

test('a failed save is reported, then a later save can succeed without replaying failed work', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'discussion-save-'));
  let asked = 0;
  const d = createDiscussionController({
    root,
    threadId: 'save',
    askHost: async () => 'summary',
    sessionFactory: async () => ({
      ask: async () => {
        asked++;
        return 'evidence';
      },
      close: async () => {}
    })
  });
  await d.load();
  const blocked = path.join(root, '.runtime/discussions/save.json');
  await mkdir(blocked, {recursive: true});
  const request = {
    mode: 'parallel',
    text: 'Q',
    brief: 'B',
    participants: [{id: 'p1'}, {id: 'p2'}],
    facilitator: {id: 'host'},
    workspace: root
  };
  await assert.rejects(d.start(request));
  assert.equal(d.state.status, 'uncertain');
  assert.equal(asked, 0);
  await rename(blocked, path.join(root, '.runtime/discussions/blocked-directory'));
  await d.start({...request, text: 'explicit next discussion'});
  await d.settled();
  assert.equal(d.state.status, 'completed');
  assert.equal(asked, 2);
  const saved = JSON.parse(await readFile(blocked, 'utf8'));
  assert.deepEqual(
    saved.runs.map(r => r.status),
    ['uncertain', 'completed']
  );
});

test('roundtable keeps two identical models in separate seats and represents four participant states', () => {
  const run = {
    id: 'r',
    round: 2,
    status: 'working',
    decisions: [{round: 1, action: 'speak', speakers: ['p1', 'p2', 'p3'], nextRound: 2}],
    participants: Array.from({length: 4}, (_, i) => ({id: `p${i + 1}`, model: 'same', displayName: 'Same'}))
  };
  const messages = ['streaming', 'completed', 'partial'].map((state, i) => ({
    id: String(i),
    runId: 'r',
    kind: 'discussion',
    role: 'assistant',
    model: 'same',
    participantId: `p${i + 1}`,
    round: 2,
    text: 'text-' + i,
    streaming: state === 'streaming',
    partial: state === 'partial'
  }));
  const data = roundtableData(run, messages);
  assert.equal(data.inferred, false);
  assert.deepEqual(
    data.rows[1].cells.slice(1).map(c => c.status),
    ['回覆中', '已完成', '未完成', '本批未點名']
  );
  assert.equal(new Set(data.rows[1].cells.map(c => c.id)).size, 5);
  assert.equal(data.rows[1].cells[1].text, 'text-0');
});

test('legacy rounds are explicitly inferred, host decisions not invented and original records remain untouched', () => {
  const run = {
    id: 'old',
    participants: [
      {id: 'p1', model: 'A'},
      {id: 'p2', model: 'B'}
    ]
  };
  const messages = ['A', 'B', 'A'].map((model, i) => ({
    id: String(i),
    kind: 'discussion',
    runId: 'old',
    role: 'assistant',
    model,
    speaker: model,
    text: String(i),
    createdAt: String(i)
  }));
  const before = JSON.stringify({run, messages});
  const data = roundtableData(run, messages);
  assert.equal(data.inferred, true);
  assert.equal(data.last, 2);
  assert(data.rows.every(r => r.cells[0].text === '安排未記錄'));
  assert.equal(JSON.stringify({run, messages}), before);
});

test('API absolute reads/searches/listings use external absolute names and stat rejects oversized input before loading', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'reader-wide-')),
    workspace = path.join(root, 'cwd'),
    outside = path.join(root, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  const fake = path.join(outside, '.env.fake');
  await writeFile(fake, 'FAKE_MARKER\nsecond');
  await writeFile(path.join(outside, 'large.txt'), Buffer.alloc(MAX_DISCUSSION_FILE_BYTES + 1, 'x'));
  const read = await createDiscussionReader(workspace);
  assert.equal((await read('read_file', {path: fake})).text, 'FAKE_MARKER\nsecond');
  const rows = await read('list_files', {path: outside});
  assert(rows.entries.every(e => path.isAbsolute(e.path)));
  const search = await read('search_files', {path: outside, query: 'FAKE_MARKER'});
  assert.equal(search.matches[0].path, fake.replaceAll('\\', '/'));
  assert(search.skipped.some(p => p.endsWith('large.txt')));
  await assert.rejects(read('read_file', {path: path.join(outside, 'large.txt')}), /16 MiB/);
  await assert.rejects(read('read_file', {path: path.join(outside, 'child') + '/../.env.fake'}), /路徑片段/);
});
