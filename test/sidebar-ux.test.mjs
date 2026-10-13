import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile, utimes} from 'node:fs/promises';
import path from 'node:path';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession, saveMainSessionActivity, listMainSessions} from '../src/main-sessions.mjs';
import {sortSessions} from '../frontend/project-groups.mjs';
import {conversationPreview} from '../shared/conversation-preview.mjs';
import {scratchBase} from './scratch.mjs';
const model = 'gpt-6-astra';
const deferred = () => {
  let resolve;
  const promise = new Promise(r => (resolve = r));
  return {promise, resolve};
};
const until = async fn => {
  const end = Date.now() + 2500;
  while (!fn()) {
    if (Date.now() > end) throw Error('test state not reached');
    await new Promise(r => setTimeout(r, 2));
  }
};
async function fixture() {
  await mkdir('.runtime/tests', {recursive: true});
  const root = await mkdtemp(path.join(scratchBase, 'sidebar-ux-'));
  const gates = new Map(),
    owners = [],
    calls = [];
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F'])
    await saveMainSession(root, {threadId: id, model, title: `Chat ${id}`, workspace: root});
  const c = createConversationController({
    root,
    sessionFactory: ({onChange}) => {
      const state = {
        threadId: null,
        model,
        workspace: root,
        messages: [],
        tools: [],
        questions: [],
        workers: [],
        artifacts: [],
        status: 'idle',
        busy: false
      };
      const owner = {
        state,
        closed: 0,
        async selectWorkspace({path}) {
          state.workspace = path;
        },
        async open({threadId}, {signal, onHistory} = {}) {
          calls.push(['open', threadId]);
          Object.assign(state, {
            threadId,
            title: `Chat ${threadId}`,
            model,
            status: 'connecting',
            messages: [{id: `m-${threadId}`, role: 'assistant', text: `History ${threadId}`}],
            questions: [{id: 'not-live'}],
            artifacts: ['not-live.txt'],
            capabilities: {goal: true}
          });
          await onHistory?.(state);
          onChange();
          await gates.get(threadId)?.promise;
          signal?.throwIfAborted();
          if (gates.get(threadId)?.fail) throw Error('fake connection failure');
          state.status = gates.get(threadId)?.working ? 'working' : 'ready';
          state.busy = state.status === 'working';
          state.questions = [];
          await saveMainSession(root, {threadId, model, title: state.title, workspace: root});
          onChange();
          return {threadId};
        },
        async send(data) {
          calls.push(['send', data.threadId]);
        },
        async close() {
          owner.closed++;
          state.status = 'offline';
          onChange();
        },
        async workers() {
          return state.workers;
        },
        async models() {
          return {models: []};
        },
        async usage() {
          return {};
        }
      };
      owners.push(owner);
      return owner;
    }
  });
  return {root, c, gates, owners, calls, select: id => c.open({threadId: id, model})};
}

test('cold history becomes readable before connection while native work and controls stay scoped', async () => {
  const f = await fixture();
  try {
    await f.select('A');
    const a = f.owners.find(o => o.state.threadId === 'A');
    a.state.busy = true;
    a.state.status = 'working';
    f.gates.set('B', deferred());
    const opening = f.select('B');
    await until(() => f.c.state.historyReady);
    assert.equal(f.c.state.threadId, 'B');
    assert.equal(f.c.state.status, 'connecting');
    assert.deepEqual(
      f.c.state.messages.map(m => m.text),
      ['History B']
    );
    assert.deepEqual(f.c.state.questions, []);
    assert.deepEqual(f.c.state.artifacts, []);
    assert.deepEqual(f.c.state.capabilities, {});
    assert.equal(f.c.state.goalError, '原生目標尚未讀回。');
    assert.equal(f.c.state.turnError, null);
    assert.equal(a.state.busy, true);
    assert.equal(a.closed, 0);
    await assert.rejects(f.c.send({threadId: 'B', text: 'wrong'}), /已開啟/);
    assert.equal(
      f.calls.some(([m]) => m === 'send'),
      false
    );
    f.gates.get('B').resolve();
    await opening;
    assert.equal(f.c.state.status, 'ready');
    assert.equal(f.c.state.connectionOpening, false);
  } finally {
    await f.c.close();
  }
});

test('rapid selection is last-click-wins without aborting an accepted native opening', async () => {
  const f = await fixture();
  try {
    await f.select('A');
    const gate = deferred();
    gate.working = true;
    f.gates.set('B', gate);
    const b = f.select('B');
    await until(() => f.c.state.historyReady);
    const c = f.select('C'),
      d = f.select('D');
    assert.equal(f.c.state.threadId, 'D');
    assert.deepEqual(f.c.state.messages, []);
    gate.resolve();
    const result = await Promise.all([b, c, d]);
    assert.equal(result[0].superseded, true);
    assert.equal(result[1].superseded, true);
    assert.equal(result[2].superseded, undefined);
    assert.equal(f.c.state.threadId, 'D');
    assert.deepEqual(
      f.calls
        .filter(([m]) => m === 'open')
        .map(([, id]) => id)
        .sort(),
      ['A', 'B', 'C', 'D']
    );
    const hidden = f.owners.find(o => o.state.threadId === 'B');
    assert.equal(hidden.state.busy, true);
    assert.equal(hidden.closed, 0);
    assert.ok(f.c.state.conversationActivity.some(s => s.threadId === 'B' && s.busy));
  } finally {
    await f.c.close();
  }
});

test('failure of an older opening cannot replace the newest target', async () => {
  const f = await fixture();
  try {
    await f.select('A');
    const gate = deferred();
    gate.fail = true;
    f.gates.set('B', gate);
    const b = f.select('B'),
      failed = assert.rejects(b, /fake connection failure/);
    await until(() => f.c.state.historyReady);
    const d = f.select('D');
    gate.resolve();
    await failed;
    await d;
    assert.equal(f.c.state.threadId, 'D');
    assert.equal(f.c.state.status, 'ready');
  } finally {
    await f.c.close();
  }
});

test('cancel navigation returns to the prior owner and never sends a message', async () => {
  const f = await fixture();
  try {
    await f.select('A');
    const gate = deferred();
    f.gates.set('B', gate);
    const b = f.select('B'),
      cancelled = assert.rejects(b, /取消/);
    await until(() => f.c.state.historyReady);
    const cancel = f.c.stop({cancelOpening: true});
    gate.resolve();
    await Promise.all([cancel, cancelled]);
    assert.equal(f.c.state.threadId, 'A');
    assert.equal(f.c.state.connectionOpening, false);
    assert.equal(
      f.calls.some(([m]) => m === 'send'),
      false
    );
    assert.equal(f.owners.find(o => o.state.threadId === 'B').closed, 1);
  } finally {
    await f.c.close();
  }
});

test('current open failure restores the real owner, not a runnable history preview', async () => {
  const f = await fixture();
  try {
    await f.select('A');
    const gate = deferred();
    gate.fail = true;
    f.gates.set('B', gate);
    const opening = f.select('B'),
      failed = assert.rejects(opening, /fake connection failure/);
    await until(() => f.c.state.historyReady);
    gate.resolve();
    await failed;
    assert.equal(f.c.state.threadId, 'A');
    assert.equal(f.c.state.status, 'ready');
    assert.equal(f.c.state.connectionOpening, false);
  } finally {
    await f.c.close();
  }
});

test('preview drops old provider controls, queues, approvals, browser and progress', () => {
  const state = conversationPreview(
    {threadId: 'B', model, title: 'B'},
    {
      messages: [{id: 'b', role: 'assistant', text: 'read me'}],
      questions: [{id: 'a'}],
      busy: true,
      artifacts: ['a'],
      goal: {status: 'active'},
      browserAccess: {enabled: true},
      capabilities: {goal: true},
      queuedMessages: [{text: 'a'}]
    }
  );
  assert.equal(state.status, 'connecting');
  assert.equal(state.busy, false);
  assert.equal(state.historyReady, true);
  assert.deepEqual(state.questions, []);
  assert.deepEqual(state.queuedMessages, []);
  assert.equal(state.browserAccess.enabled, false);
  assert.deepEqual(state.capabilities, {});
  assert.equal(state.goal, null);
});

test('opening, metadata saves and settings do not reorder; real activity advances monotonically', async () => {
  const f = await fixture();
  try {
    const before = sortSessions((await listMainSessions(f.root)).sessions).map(s => s.threadId),
      initial = (await listMainSessions(f.root, {threadId: 'A'})).sessions[0].sortAt;
    await f.select('A');
    await saveMainSession(f.root, {threadId: 'A', model, title: 'renamed', workspace: f.root, effort: 'high'});
    assert.deepEqual(
      sortSessions((await listMainSessions(f.root)).sessions).map(s => s.threadId),
      before
    );
    assert.equal((await listMainSessions(f.root, {threadId: 'A'})).sessions[0].sortAt, initial);
    const later = new Date(Date.now() + 10000).toISOString();
    await saveMainSession(f.root, {threadId: 'A', model, workspace: f.root}, {activityAt: later});
    assert.equal(sortSessions((await listMainSessions(f.root)).sessions)[0].threadId, 'A');
    await saveMainSession(f.root, {threadId: 'A', model, workspace: f.root}, {activityAt: initial});
    assert.equal((await listMainSessions(f.root, {threadId: 'A'})).sessions[0].sortAt, later);
  } finally {
    await f.c.close();
  }
});

test('legacy first-open freezes the old ordering anchor instead of inventing a new activity', async () => {
  await mkdir('.runtime/tests', {recursive: true});
  const root = await mkdtemp(path.join(scratchBase, 'sidebar-legacy-')),
    dir = path.join(root, '.runtime/main-sessions');
  await mkdir(dir, {recursive: true});
  const file = path.join(dir, 'old.json'),
    date = new Date('2026-01-01T00:00:00Z');
  await writeFile(file, JSON.stringify({threadId: 'old', model, title: 'Old', workspace: root}));
  await utimes(file, date, date);
  const initial = (await listMainSessions(root)).sessions[0].sortAt;
  await saveMainSession(root, {threadId: 'old', model, title: 'Old', workspace: root});
  assert.equal((await listMainSessions(root)).sessions[0].sortAt, initial);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'old-current.json'), 'utf8')).sortAt, initial);
});

test('activity ordering leaves manual and pinned rules intact', () => {
  const sessions = [
    {threadId: 'A', sortAt: '2026-01-01T00:00:00Z', lastOpenedAt: '2026-12-01T00:00:00Z'},
    {threadId: 'B', sortAt: '2026-01-02T00:00:00Z'},
    {threadId: 'C', sortAt: '2026-01-01T00:00:00Z', pinned: true}
  ];
  assert.deepEqual(
    sortSessions(sessions).map(s => s.threadId),
    ['C', 'B', 'A']
  );
  assert.deepEqual(
    sortSessions(sessions, {sort: 'manual', order: ['A', 'B', 'C']}).map(s => s.threadId),
    ['C', 'A', 'B']
  );
});

test('activity-only save cannot overwrite an earlier queued metadata update', async () => {
  const f = await fixture();
  const row = (await listMainSessions(f.root, {threadId: 'A'})).sessions[0];
  await Promise.all([
    saveMainSession(f.root, {...row, title: 'new title', pinned: true}),
    saveMainSessionActivity(f.root, 'A', '2099-01-01T00:00:00.000Z')
  ]);
  const latest = (await listMainSessions(f.root, {threadId: 'A'})).sessions[0];
  assert.equal(latest.title, 'new title');
  assert.equal(latest.pinned, true);
  assert.equal(latest.sortAt, '2099-01-01T00:00:00.000Z');
  await f.c.close();
});

test('independent loads start every accepted room and fast or opened targets never await a slow room', async () => {
  const f = await fixture();
  const gate = deferred();
  try {
    await f.select('C');
    f.gates.set('A', gate);
    const a = f.select('A');
    await until(() => f.calls.some(([m, id]) => m === 'open' && id === 'A'));
    const b = f.select('B');
    await until(() => f.calls.some(([m, id]) => m === 'open' && id === 'B'));
    await b;
    assert.equal(f.c.state.threadId, 'B');
    assert.equal(f.c.state.connectionOpening, false);
    await f.select('C');
    assert.equal(f.c.state.threadId, 'C');
    assert.equal(f.c.state.connectionOpening, false);
    gate.resolve();
    assert.equal((await a).superseded, true);
    assert.ok(f.c.state.conversationActivity.some(s => s.threadId === 'A'));
  } finally {
    gate.resolve();
    await f.c.close();
  }
});

test('repeated selection shares one in-flight native owner and latest click receives its history', async () => {
  const f = await fixture();
  const gate = deferred();
  try {
    f.gates.set('A', gate);
    const a = f.select('A');
    await until(() => f.c.state.historyReady);
    const again = f.select('A');
    await until(() => f.c.state.historyReady);
    assert.deepEqual(
      f.c.state.messages.map(m => m.text),
      ['History A']
    );
    gate.resolve();
    await Promise.all([a, again]);
    assert.equal(f.calls.filter(([m, id]) => m === 'open' && id === 'A').length, 1);
    assert.equal(f.owners.filter(o => o.state.threadId === 'A').length, 1);
  } finally {
    gate.resolve();
    await f.c.close();
  }
});

test('cancel latest load only; another accepted load completes and is retained', async () => {
  const f = await fixture(),
    aGate = deferred(),
    bGate = deferred();
  try {
    await f.select('C');
    f.gates.set('A', aGate);
    f.gates.set('B', bGate);
    const a = f.select('A');
    await until(() => f.calls.some(([m, id]) => m === 'open' && id === 'A'));
    const b = f.select('B'),
      cancelled = assert.rejects(b, /取消/);
    await until(() => f.calls.some(([m, id]) => m === 'open' && id === 'B'));
    const stop = f.c.stop({cancelOpening: true});
    bGate.resolve();
    await Promise.all([stop, cancelled]);
    aGate.resolve();
    await a;
    assert.equal(f.c.state.threadId, 'C');
    assert.ok(f.c.state.conversationActivity.some(s => s.threadId === 'A'));
    assert.equal(f.owners.find(o => o.state.threadId === 'A').closed, 0);
  } finally {
    aGate.resolve();
    bGate.resolve();
    await f.c.close();
  }
});

test('shutdown cancels and settles every accepted opening without orphan owners', async () => {
  const f = await fixture(),
    aGate = deferred(),
    bGate = deferred();
  f.gates.set('A', aGate);
  f.gates.set('B', bGate);
  const a = f.select('A'),
    ar = assert.rejects(a, /取消/);
  await until(() => f.calls.some(([m, id]) => m === 'open' && id === 'A'));
  const b = f.select('B'),
    br = assert.rejects(b, /取消/);
  await until(() => f.calls.some(([m, id]) => m === 'open' && id === 'B'));
  const closing = f.c.close();
  aGate.resolve();
  bGate.resolve();
  await Promise.all([closing, ar, br]);
  assert.ok(f.owners.every(o => o.closed >= 1));
});

test('focus-changing workspace selection supersedes the view without cancelling an accepted load', async () => {
  const f = await fixture(),
    gate = deferred();
  try {
    await f.select('C');
    f.gates.set('A', gate);
    const a = f.select('A');
    await until(() => f.c.state.historyReady);
    await f.c.selectWorkspace({path: f.root});
    assert.equal(f.c.state.threadId, null);
    assert.equal(f.c.state.connectionOpening, false);
    gate.resolve();
    await a;
    assert.equal(f.c.state.threadId, null);
    assert.ok(f.c.state.conversationActivity.some(s => s.threadId === 'A'));
  } finally {
    gate.resolve();
    await f.c.close();
  }
});

test('same-room metadata, movement and deletion refuse an in-flight open without cancelling its view or locking other rooms', async () => {
  const f = await fixture(),
    gate = deferred();
  try {
    f.gates.set('A', gate);
    const a = f.select('A');
    await until(() => f.c.state.historyReady);
    await assert.rejects(f.c.metadata({threadId: 'A', title: 'changed'}), /正在連線/);
    await assert.rejects(f.c.moveWorkspace({threadId: 'A', workspace: f.root}), /正在連線/);
    await assert.rejects(f.c.deleteArchived({threadIds: ['A'], confirmed: true}), /正在連線/);
    assert.equal(f.c.state.threadId, 'A');
    await f.select('B');
    assert.equal(f.c.state.threadId, 'B');
    gate.resolve();
    await a;
    assert.equal(f.calls.filter(([m, id]) => m === 'open' && id === 'A').length, 1);
  } finally {
    gate.resolve();
    await f.c.close();
  }
});

test('idle eviction cannot close an in-flight owned room even if its projection becomes idle', async () => {
  const f = await fixture(),
    gate = deferred();
  try {
    await f.select('A');
    const owner = f.owners.find(o => o.state.threadId === 'A');
    owner.state.status = 'offline';
    f.gates.set('A', gate);
    const a = f.select('A');
    await until(() => f.calls.filter(([m, id]) => m === 'open' && id === 'A').length === 2);
    owner.state.status = 'ready';
    for (const id of ['B', 'C', 'D', 'E', 'F']) await f.select(id);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(owner.closed, 0);
    gate.resolve();
    await a;
    assert.equal(f.c.state.threadId, 'F');
  } finally {
    gate.resolve();
    await f.c.close();
  }
});
