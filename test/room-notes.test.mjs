import test from 'node:test';
import assert from 'node:assert/strict';
import fs, {mkdtemp, readFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {createRoomNotes, MAX_PENDING_ROOM_NOTES} from '../src/room-notes.mjs';
import {createUnifiedController} from '../src/unified-controller.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {createLunaGateway} from '../src/luna-gateway.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';
import {formatRoomNotes, parseRoomNotes, ROOM_NOTES_HEADER} from '../shared/room-notes.mjs';
import {formatResponseAnnotations, parseResponseAnnotations} from '../frontend/response-annotations.mjs';
import {scratchBase} from './scratch.mjs';

const from = {fromThreadId: 'room-a', fromTitle: '來源房', fromProvider: 'codex'};
const tempRoot = name => mkdtemp(path.join(scratchBase, `room-notes-${name}-`));
const saved = async (root, id) =>
  JSON.parse(await readFile(path.join(root, '.runtime/room-notes', `${id}.json`), 'utf8'));

test('retention never prunes a claimed note that a not-sent turn may restore', async () => {
  const root = await tempRoot('retention-claim');
  const file = path.join(root, '.runtime/room-notes/room-b.json');
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(
    file,
    JSON.stringify({
      notes: [
        {id: 'pending', ...from, text: 'still required', status: 'pending'},
        ...Array.from({length: 100}, (_, i) => ({id: `old-${i}`, ...from, text: 'old', status: 'consumed'}))
      ]
    })
  );
  const notes = createRoomNotes({root});
  const claim = await notes.claim('room-b');
  assert.equal(claim.count, 1);
  await claim.restore();
  assert.deepEqual(
    notes.pending('room-b').map(n => n.id),
    ['pending']
  );
  const reopened = createRoomNotes({root});
  await reopened.load('room-b');
  assert.deepEqual(
    reopened.pending('room-b').map(n => n.id),
    ['pending']
  );
});

test('inbox delivers a note once, restores it only before handoff, discards, limits and survives restart', async () => {
  const root = await tempRoot('store');
  let changes = 0;
  const notes = createRoomNotes({root, onChange: () => changes++});
  await assert.rejects(notes.add('room-b', {...from, text: '  '}), /1–4000/);
  await assert.rejects(notes.add('room-b', {...from, text: 'x'.repeat(4001)}), /1–4000/);
  const first = await notes.add('room-b', {...from, text: '請改用新的 API 路徑'});
  assert.equal(notes.pending('room-b').length, 1);
  assert(changes > 0);

  const claim = await notes.claim('room-b', '本人原文');
  assert.equal(claim.count, 1);
  assert.equal(
    claim.text,
    formatRoomNotes('本人原文', [{...from, id: first.id, createdAt: first.createdAt, text: first.text}])
  );
  assert.deepEqual(notes.pending('room-b'), []);
  assert.equal((await saved(root, 'room-b')).notes[0].status, 'consumed');
  assert.equal(await notes.claim('room-b', 'again'), null, 'a consumed note never rides twice');
  await claim.restore();
  assert.equal(notes.pending('room-b').length, 1, 'a send that never reached the core returns its note');
  const second = await notes.claim('room-b', '');
  await second.commit('message-1');
  const row = (await saved(root, 'room-b')).notes[0];
  assert.equal(row.status, 'consumed');
  assert.equal(row.consumedMessageId, 'message-1');
  assert.match(row.consumedAt, /^\d{4}-/);

  const kept = await notes.add('room-b', {...from, text: '保留'});
  const dropped = await notes.add('room-b', {...from, text: '丟棄'});
  assert.deepEqual(await notes.discard('room-b', dropped.id), {discarded: true});
  await assert.rejects(notes.discard('room-b', dropped.id), /找不到/);
  await assert.rejects(notes.discard('room-b', row.id), /找不到/);
  for (let i = 1; i < MAX_PENDING_ROOM_NOTES; i++) await notes.add('room-b', {...from, text: `n${i}`});
  await assert.rejects(notes.add('room-b', {...from, text: 'over'}), /20 則/);

  const restarted = createRoomNotes({root});
  assert.deepEqual(restarted.pending('room-b'), [], 'nothing is projected before the room loads');
  await restarted.load('room-b');
  const pending = restarted.pending('room-b');
  assert.equal(pending.length, MAX_PENDING_ROOM_NOTES);
  assert.equal(pending[0].id, kept.id);
  assert(!pending.some(n => n.id === first.id || n.id === dropped.id));
  assert.equal(await restarted.count('room-b'), MAX_PENDING_ROOM_NOTES);
  await assert.rejects(restarted.add('../x', {...from, text: 'bad id'}), /Invalid/);
});

test('one send carries only the oldest notes that fit the native length limit', async () => {
  const notes = createRoomNotes({root: await tempRoot('budget')});
  for (let i = 0; i < 9; i++) await notes.add('room-b', {...from, text: String(i).repeat(4000)});
  const claim = await notes.claim('room-b', 'hi');
  assert(claim.count >= 6 && claim.count < 9);
  assert(claim.text.length <= 32000);
  assert.equal(notes.pending('room-b').length, 9 - claim.count);
  assert.equal(notes.pending('room-b')[0].text[0], String(claim.count));
});

test('the sent block parses back for the transcript, after any response annotations', () => {
  const quoted = formatResponseAnnotations('看這段', [{id: 'q', sourceMessageId: 'm1', text: '原文', annotation: ''}]);
  const note = {id: 'n1', ...from, createdAt: '2026-10-22T00:00:00.000Z', text: '協調內容'};
  const sent = formatRoomNotes(quoted, [note]);
  assert(sent.includes(`\n\n${ROOM_NOTES_HEADER}\n{"format":"k-room-notes-v1","notes":[`));
  const parsed = parseResponseAnnotations(sent);
  assert.equal(parsed.text, '看這段');
  assert.equal(parsed.references.length, 1);
  assert.deepEqual(parsed.notes, [
    {
      id: 'n1',
      from: {threadId: 'room-a', title: '來源房', provider: 'codex'},
      createdAt: note.createdAt,
      text: '協調內容'
    }
  ]);
  assert.deepEqual(parseResponseAnnotations(formatRoomNotes('', [note])), {
    text: '',
    references: [],
    notes: parsed.notes
  });
  assert.equal(parseRoomNotes(`前文${ROOM_NOTES_HEADER}\n{"format":"k-room-notes-v1","notes":[]}`), null);
  assert.equal(parseResponseAnnotations('普通訊息'), null);
});

function fakeNative(provider, model) {
  const fake = {
    sends: [],
    failNext: null,
    state: {status: 'idle', threadId: null, model, messages: [], questions: [], workers: [], busy: false},
    async models() {
      return {models: [{model}]};
    },
    async usage() {},
    async open(data) {
      this.state = {...this.state, status: 'ready', threadId: data.threadId ?? `${provider}-room`, model, messages: []};
      return {threadId: this.state.threadId};
    },
    async selectWorkspace() {},
    async workers() {
      return [];
    },
    async send(data) {
      if (this.failNext) {
        const error = this.failNext;
        this.failNext = null;
        throw error;
      }
      this.sends.push(data);
      this.state.messages.push({id: `user-${this.sends.length}`, role: 'user', text: data.text});
      return {sent: true};
    },
    async close() {}
  };
  return fake;
}

for (const [provider, model] of [
  ['codex', 'gpt-6.1-sol'],
  ['claude', 'claude-opus-5-5'],
  ['gemini', 'gemini-3.8-flash']
])
  test(`${provider} human sends carry pending notes once; internal sends never do`, async () => {
    const root = await tempRoot(provider);
    const notes = createRoomNotes({root});
    const natives = {codex: fakeNative('codex', 'gpt-6.1-sol')};
    const c = createUnifiedController({
      root,
      roomNotes: notes,
      codexFactory: () => natives.codex,
      claudeFactory: () => (natives.claude ??= fakeNative('claude', model)),
      geminiFactory: () => (natives.gemini ??= fakeNative('gemini', model)),
      inspect: async () => ({available: true})
    });
    try {
      await c.open({model});
      const native = natives[provider],
        id = c.state.threadId;
      assert.equal(c.state.provider, provider);
      await notes.add(id, {...from, text: '第一則'});
      assert.equal(c.state.roomNotes.length, 1, 'the state stream carries the pending list');

      native.failNext = Object.assign(Error('validation'), {notSent: true});
      await assert.rejects(c.send({text: '先失敗'}), /validation/);
      assert.equal(notes.pending(id).length, 1, 'not handed to the core: note returns to pending');

      await c.send({text: '本人原文'});
      assert.match(native.sends.at(-1).text, /^本人原文\n\nK 聊天室協調訊息/);
      assert.equal(parseRoomNotes(native.sends.at(-1).text).notes[0].text, '第一則');
      assert.deepEqual(c.state.roomNotes, []);
      assert.equal((await saved(root, id)).notes[0].consumedMessageId, 'user-1');
      await c.send({text: '下一則'});
      assert.equal(native.sends.at(-1).text, '下一則', 'consumed notes never ride again');

      await notes.add(id, {...from, text: '送出不明'});
      native.failNext = Error('outcome unknown');
      await assert.rejects(c.send({text: 'x'}), /unknown/);
      assert.deepEqual(notes.pending(id), [], 'an attempted send with unknown outcome is not resent');

      await notes.add(id, {...from, text: '只有協調訊息'});
      await c.send({text: ''});
      assert(native.sends.at(-1).text.startsWith(ROOM_NOTES_HEADER), 'notes alone may be sent');

      await notes.add(id, {...from, text: '交接不帶入'});
      await c.send({text: '換房交接', source: 'continuation'});
      assert.equal(native.sends.at(-1).text, '換房交接');
      assert.equal(notes.pending(id).length, 1);

      native.state.busy = true;
      await assert.rejects(c.send({text: ''}), error => error.notSent === true && /工作進行中/.test(error.message));
      await c.send({text: '排隊中的訊息'});
      assert.equal(notes.pending(id).length, 1, 'queued text does not consume notes yet');
      native.state.busy = false;
      native.state.status = 'completed';
      assert.equal(c.state.queuedMessages.length, 1);
      await assert.rejects(
        c.send({text: ''}),
        error => error.notSent === true && /工作進行中或仍有待送訊息/.test(error.message),
        'idle but with a waiting queue: notes alone are refused, matching the composer'
      );
      c.queue({action: 'resume'}).catch(() => {});
      const deadline = Date.now() + 3000;
      while (!native.sends.some(s => s.text.startsWith('排隊中的訊息')) && Date.now() < deadline)
        await new Promise(r => setTimeout(r, 20));
      assert.match(native.sends.at(-1).text, /^排隊中的訊息\n\nK 聊天室協調訊息.*交接不帶入/s);
      assert.deepEqual(notes.pending(id), []);

      const dropped = await notes.add(id, {...from, text: '本人丟棄'});
      assert.deepEqual(await c.roomNote({id: dropped.id, action: 'discard'}), {discarded: true});
      assert.equal((await saved(root, id)).notes.at(-1).status, 'discarded');
      await c.send({text: '丟棄後'});
      assert.equal(native.sends.at(-1).text, '丟棄後');
    } finally {
      await c.close();
    }
  });

test('a claim that may still be restored keeps its slots, so restore never lifts pending past the cap', async () => {
  const root = await tempRoot('cap');
  const notes = createRoomNotes({root});
  for (let i = 0; i < MAX_PENDING_ROOM_NOTES; i++) await notes.add('room-b', {...from, text: `a${i}`});
  const claim = await notes.claim('room-b', '');
  assert.equal(claim.count, MAX_PENDING_ROOM_NOTES);
  assert.deepEqual(notes.pending('room-b'), []);
  await assert.rejects(notes.add('room-b', {...from, text: 'during claim'}), /20 則/);
  await claim.restore();
  assert.equal(notes.pending('room-b').length, MAX_PENDING_ROOM_NOTES, 'restore keeps every note, none dropped');
  await assert.rejects(notes.add('room-b', {...from, text: 'after restore'}), /20 則/);
  await claim.restore();
  assert.equal(notes.pending('room-b').length, MAX_PENDING_ROOM_NOTES, 'a second restore changes nothing');

  const sent = await notes.claim('room-b', '');
  await sent.commit('message-1');
  await sent.restore();
  assert.deepEqual(notes.pending('room-b'), [], 'a committed claim cannot be restored');
  await notes.add('room-b', {...from, text: 'after commit'});
  const held = await notes.claim('room-b', '');
  assert.equal(held.count, 1);
  for (let i = 1; i < MAX_PENDING_ROOM_NOTES; i++) await notes.add('room-b', {...from, text: `b${i}`});
  await assert.rejects(notes.add('room-b', {...from, text: 'over'}), /20 則/);

  const restarted = createRoomNotes({root});
  await restarted.load('room-b');
  assert.equal(restarted.pending('room-b').length, MAX_PENDING_ROOM_NOTES - 1, 'consumed rows stay consumed');
  await restarted.add('room-b', {...from, text: 'restart frees the uncommitted slot'});
  await assert.rejects(restarted.add('room-b', {...from, text: 'over'}), /20 則/);
});

test('a failed restore write leaves the claim consumed and open, so a retry really returns the notes', async t => {
  const root = await tempRoot('restore-retry');
  const notes = createRoomNotes({root});
  await notes.add('room-b', {...from, text: '還原重試'});
  for (let i = 1; i < MAX_PENDING_ROOM_NOTES; i++) await notes.add('room-b', {...from, text: `r${i}`});
  const claim = await notes.claim('room-b', '');
  const target = path.join(root, '.runtime/room-notes/room-b.json'),
    rename = fs.rename;
  let failures = 1;
  const mock = t.mock.method(fs, 'rename', async (from, to) => {
    if (to === target && failures-- > 0) throw Object.assign(Error('restore write failed'), {code: 'EIO'});
    return rename(from, to);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(claim.restore(), /restore write failed/);
    assert.deepEqual(notes.pending('room-b'), [], 'memory stays consumed, matching disk');
    assert.equal(await notes.count('room-b'), 0);
    assert((await saved(root, 'room-b')).notes.every(n => n.status === 'consumed'));
    await assert.rejects(notes.add('room-b', {...from, text: 'slots still held'}), /20 則/);

    await claim.restore();
    assert.equal(notes.pending('room-b').length, MAX_PENDING_ROOM_NOTES, 'the retry writes pending');
    assert((await saved(root, 'room-b')).notes.every(n => n.status === 'pending'));
    const reloaded = createRoomNotes({root});
    await reloaded.load('room-b');
    assert.equal(reloaded.pending('room-b').length, MAX_PENDING_ROOM_NOTES);
    await notes.discard('room-b', notes.pending('room-b')[0].id);
    await notes.add('room-b', {...from, text: 'restored claim released its slots'});
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
  }
});

test('an unknown send outcome keeps notes consumed, never resends them and releases their slots', async () => {
  const root = await tempRoot('unknown-outcome');
  const notes = createRoomNotes({root});
  const native = fakeNative('codex', 'gpt-6.1-sol');
  const c = createUnifiedController({
    root,
    roomNotes: notes,
    codexFactory: () => native,
    claudeFactory: () => fakeNative('claude', 'claude-opus-5-5'),
    geminiFactory: () => fakeNative('gemini', 'gemini-3.8-flash'),
    inspect: async () => ({available: true})
  });
  try {
    await c.open({model: 'gpt-6.1-sol'});
    const id = c.state.threadId;
    for (let i = 0; i < MAX_PENDING_ROOM_NOTES; i++) await notes.add(id, {...from, text: `u${i}`});
    native.failNext = Error('outcome unknown');
    await assert.rejects(c.send({text: '不明'}), /unknown/);
    assert.equal(await notes.count(id), 0);
    assert((await saved(root, id)).notes.every(n => n.status === 'consumed'));
    await notes.add(id, {...from, text: '名額已釋放'});
    for (let i = 1; i < MAX_PENDING_ROOM_NOTES; i++) await notes.add(id, {...from, text: `v${i}`});
    await assert.rejects(notes.add(id, {...from, text: 'over'}), /20 則/);

    await c.send({text: '下一次'});
    const carried = parseRoomNotes(native.sends.at(-1).text).notes.map(n => n.text);
    assert.equal(carried.length, MAX_PENDING_ROOM_NOTES);
    assert(!carried.some(text => /^u\d+$/.test(text)), 'notes from the unknown send are never resent');
    assert((await saved(root, id)).notes.filter(n => /^u\d+$/.test(n.text)).every(n => n.status === 'consumed'));
  } finally {
    await c.close();
  }
});

const gated = notes => {
  let release, entered;
  const gate = new Promise(resolve => (release = resolve)),
    waiting = new Promise(resolve => (entered = resolve));
  return {
    release,
    waiting,
    notes: {
      ...notes,
      async claim(...args) {
        entered();
        await gate;
        return notes.claim(...args);
      }
    }
  };
};

test('stopping while the Codex claim waits sends nothing and returns the notes to pending', async () => {
  const root = await tempRoot('stop-claim');
  const notes = createRoomNotes({root}),
    hold = gated(notes),
    requests = [];
  let hooks;
  const host = {
    closed: new Promise(() => {}),
    notify() {},
    async close() {},
    async request(method) {
      requests.push(method);
      if (method === 'model/list')
        return {data: [{model: 'gpt-6.1-sol', supportedReasoningEfforts: [{reasoningEffort: 'medium'}]}]};
      if (method === 'account/read') return {account: {type: 'chatgpt'}};
      if (method === 'config/read') return {config: {}};
      if (method === 'thread/start') return {thread: {id: 'parent', turns: []}};
      if (method === 'thread/backgroundTerminals/list') return {data: []};
      if (method === 'turn/start') {
        hooks.onEvent({
          method: 'turn/started',
          params: {threadId: 'parent', turn: {id: 'turn-1', status: 'inProgress'}}
        });
        return {turn: {id: 'turn-1'}};
      }
      return {};
    }
  };
  const c = createUnifiedController({
    root,
    roomNotes: hold.notes,
    codexFactory: options =>
      createDesktopController({
        ...options,
        hostFactory: h => {
          if (!h.onEvent) return {...host, close: async () => {}};
          hooks = h;
          return host;
        },
        gatewayFactory: async () => ({
          mcpConfig: {mcpServers: {k_gemini: {url: 'http://fake/mcp', headers: {Authorization: 'fake'}}}},
          close: async () => {}
        })
      }),
    claudeFactory: () => fakeNative('claude', 'claude-opus-5-5'),
    geminiFactory: () => fakeNative('gemini', 'gemini-3.8-flash'),
    inspect: async () => ({available: true})
  });
  try {
    await c.open({model: 'gpt-6.1-sol', effort: 'medium', accessMode: 'read-only'});
    const id = c.state.threadId;
    await notes.add(id, {...from, text: '停止前留下'});
    const sending = c.send({text: '本人送出'});
    sending.catch(() => {});
    await hold.waiting;
    await c.stop();
    hold.release();
    await assert.rejects(sending, error => error.notSent === true && /已停止或切換/.test(error.message));
    assert(!requests.includes('turn/start'), 'no native turn starts after the stop');
    assert.equal(notes.pending(id).length, 1, 'the note returns to pending');
    assert.equal((await saved(root, id)).notes[0].status, 'pending');
  } finally {
    hold.release();
    await c.close().catch(() => {});
  }
});

test('a queued send whose claim waits through a stop, or a send through a room change, sends nothing', async () => {
  const root = await tempRoot('queue-claim');
  const notes = createRoomNotes({root}),
    native = fakeNative('codex', 'gpt-6.1-sol');
  native.stop = async () => {
    native.state.busy = false;
    native.state.status = 'interrupted';
    return {stopRequested: true};
  };
  let hold = gated(notes);
  const c = createUnifiedController({
    root,
    roomNotes: {...notes, claim: (...args) => hold.notes.claim(...args)},
    codexFactory: () => native
  });
  try {
    await c.open({model: 'gpt-6.1-sol'});
    const id = c.state.threadId;
    await notes.add(id, {...from, text: '排隊時留下'});
    native.state.busy = true;
    await c.send({text: '排隊訊息'});
    native.state.busy = false;
    native.state.status = 'completed';
    const resumed = c.queue({action: 'resume'}).catch(() => {});
    await hold.waiting;
    await c.stop();
    hold.release();
    await resumed;
    const deadline = Date.now() + 3000;
    while (c.state.queuedMessages[0]?.status !== 'queued' && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(native.sends, [], 'the stop owns the claim wait');
    assert.equal(c.state.queuedMessages[0].status, 'queued');
    assert.equal(c.state.queuePaused, true);
    assert.equal(notes.pending(id).length, 1);

    await c.queue({action: 'remove', id: c.state.queuedMessages[0].id}).catch(() => {});
    hold = gated(notes);
    const direct = c.send({text: '切換前送出'});
    await hold.waiting;
    native.state.threadId = 'other-room';
    hold.release();
    await assert.rejects(direct, error => error.notSent === true);
    assert.deepEqual(native.sends, [], 'a room change during the claim sends nothing');
    assert.equal(notes.pending(id).length, 1);
  } finally {
    hold.release();
    await c.close();
  }
});

test('room tools list other live rooms only and write to existing unarchived targets, never to self', async () => {
  const root = await tempRoot('tools');
  for (const row of [
    {threadId: 'room-a', model: 'gpt-6.1-sol', title: '來源房'},
    {threadId: 'room-b', model: 'claude-opus-5-5', title: '目標房'},
    {threadId: 'room-c', model: 'gemini-3.8-flash', title: '已封存', archived: true}
  ])
    await saveMainSession(root, {workspace: root, ...row});
  let tools;
  const c = createConversationController({
    root,
    sessionFactory: options => {
      tools = options.roomTools;
      return {state: {}, close: async () => {}};
    }
  });
  try {
    await assert.rejects(tools.note('room-a', {targetThreadId: 'room-a', text: 'x'}), /自己/);
    await assert.rejects(tools.note('room-a', {targetThreadId: 'room-c', text: 'x'}), /未封存/);
    await assert.rejects(tools.note('room-a', {targetThreadId: 'missing', text: 'x'}), /未封存/);
    await assert.rejects(tools.note('ghost', {targetThreadId: 'room-b', text: 'x'}), /來源/);
    const result = await tools.note('room-a', {targetThreadId: 'room-b', text: '請先別動 schema'});
    assert.deepEqual(Object.keys(result).sort(), ['delivered', 'noteId', 'queued']);
    assert.equal(result.queued, true);
    assert.equal(result.delivered, false);
    const note = (await saved(root, 'room-b')).notes[0];
    assert.deepEqual(
      [note.fromThreadId, note.fromTitle, note.fromProvider, note.status],
      ['room-a', '來源房', 'codex', 'pending']
    );
    const {rooms} = await tools.list('room-a');
    assert.deepEqual(rooms, [
      {
        threadId: 'room-b',
        title: '目標房',
        provider: 'claude',
        model: 'claude-opus-5-5',
        workspace: root,
        status: 'idle',
        pendingNotes: 1
      }
    ]);
  } finally {
    await c.close();
  }
});

test('gateway exposes room tools only when given and the Codex main room refuses subagent callers', async () => {
  const bridge = {
    workerPolicy: {model: 'auto', effort: 'auto'},
    start: async () => ({}),
    wait: async () => ({}),
    inspect: async () => ({}),
    cancel: async () => ({}),
    list: async () => [],
    close: async () => {}
  };
  const names = async options => {
    const gateway = await createLunaGateway({bridge, ...options});
    try {
      const server = Object.values(gateway.mcpConfig.mcpServers)[0];
      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          ...server.headers,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})
      });
      const text = await response.text();
      const data = JSON.parse(
        text
          .split(/\r?\n/u)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('\n') || text
      );
      return data.result.tools;
    } finally {
      await gateway.close();
    }
  };
  const rooms = {list: async () => ({rooms: []}), note: async () => ({queued: true})};
  assert(
    !(await names({})).some(tool => tool.name.includes('room') || tool.name.includes('schedule')),
    'worker-style gateways have no room tools'
  );
  const luna = await names({rooms});
  assert.deepEqual(
    luna.filter(tool => tool.name.includes('room') || tool.name.includes('schedule')).map(tool => tool.name),
    [
      'luna_room_list',
      'luna_room_note',
      'luna_schedule_add',
      'luna_schedule_list',
      'luna_schedule_update',
      'luna_schedule_remove'
    ]
  );
  const description = luna.find(tool => tool.name === 'luna_room_note').description;
  for (const phrase of [
    'NOT authorization',
    'does NOT wake',
    'once',
    'no read receipt',
    'do not poll',
    'automatic back-and-forth'
  ])
    assert(description.includes(phrase), phrase);
  assert(
    (await names({rooms, geminiOnly: true})).some(tool => tool.name === 'gemini_room_note'),
    'Codex main rooms use the gemini prefix'
  );
  assert(
    (await names({rooms, geminiOnly: true})).some(tool => tool.name === 'gemini_schedule_add'),
    'Codex main rooms use the gemini prefix for schedules'
  );

  const root = await tempRoot('codex-guard');
  let gateway, hooks;
  const listed = [],
    scheduled = [];
  const host = {
    closed: new Promise(() => {}),
    notify() {},
    async close() {},
    async request(method) {
      if (method === 'model/list')
        return {data: [{model: 'gpt-6.1-sol', supportedReasoningEfforts: [{reasoningEffort: 'medium'}]}]};
      if (method === 'account/read') return {account: {type: 'chatgpt'}};
      if (method === 'config/read') return {config: {}};
      if (method === 'thread/start') return {thread: {id: 'parent', turns: []}};
      if (method === 'turn/start') {
        hooks.onEvent({
          method: 'turn/started',
          params: {threadId: 'parent', turn: {id: 'turn-1', status: 'inProgress'}}
        });
        return {turn: {id: 'turn-1'}};
      }
      return {};
    }
  };
  const c = createDesktopController({
    root,
    hostFactory: h => {
      if (!h.onEvent) return {...host, close: async () => {}};
      hooks = h;
      return host;
    },
    gatewayFactory: async g => {
      gateway = g;
      return {
        mcpConfig: {mcpServers: {k_gemini: {url: 'http://fake/mcp', headers: {Authorization: 'fake'}}}},
        close: async () => {}
      };
    },
    roomTools: {
      list: async id => listed.push(id) && {rooms: []},
      note: async () => ({}),
      schedule: async (id, action) => scheduled.push([id, action]) && {}
    }
  });
  try {
    await c.open({model: 'gpt-6.1-sol', effort: 'medium', accessMode: 'read-only'});
    await c.send({text: 'go'});
    const meta = threadId => ({'x-codex-turn-metadata': JSON.stringify({thread_id: threadId, turn_id: 'turn-1'})});
    assert.throws(() => gateway.rooms.list(meta('subagent')), /目前主對話/);
    assert.throws(() => gateway.rooms.note({targetThreadId: 'x', text: 'y'}, meta('subagent')), /目前主對話/);
    for (const action of ['add', 'list', 'update', 'remove'])
      assert.throws(() => gateway.rooms.schedule(action, {}, meta('subagent')), /目前主對話/);
    await gateway.rooms.list(meta('parent'));
    assert.deepEqual(listed, [c.state.threadId]);
    await gateway.rooms.schedule('list', {}, meta('parent'));
    assert.deepEqual(scheduled, [[c.state.threadId, 'list']]);
  } finally {
    await c.close().catch(() => {});
  }
});
