import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERSATION_CONTEXT_GUIDANCE,
  readConversationContext,
  renderCompactionContext
} from '../src/conversation-context.mjs';

function userItem(id, text, turnId, startedAtMs) {
  return {
    turnId,
    startedAtMs,
    item: {
      id,
      type: 'userMessage',
      content: [
        {type: 'text', text, text_elements: []},
        {type: 'image', url: 'file:///not-copied', detail: null}
      ]
    }
  };
}

test('reads actual ThreadItemsListResponse shape, uses native chronology and only text input', async () => {
  const calls = [];
  const response = {
    data: [
      userItem('later', 'second', 'turn-b', 20),
      {turnId: 'turn-a', startedAtMs: 10, item: {id: 'assistant', type: 'agentMessage', text: 'ignore'}},
      userItem('earlier', 'first', 'turn-a', 10)
    ],
    nextCursor: 'opaque-native-cursor'
  };
  const snapshot = await readConversationContext({
    request: async (method, params) => {
      calls.push({method, params});
      return method === 'thread/goal/get' ? {goal: 'unchanged native goal'} : response;
    },
    threadId: 'current-thread',
    cursor: {type: 'item', itemId: 'anchor'},
    workers: [{requestId: 'worker-1', status: 'waiting', ignored: 'private'}],
    compactions: {ids: ['compact-1'], complete: true, inFlight: false, ignored: {deep: 'private'}},
    now: '2026-10-10T01:02:03Z'
  });

  assert.deepEqual(calls, [
    {method: 'thread/goal/get', params: {threadId: 'current-thread'}},
    {
      method: 'thread/items/list',
      params: {threadId: 'current-thread', limit: 40, sortDirection: 'desc', cursor: {type: 'item', itemId: 'anchor'}}
    }
  ]);
  assert.deepEqual(snapshot.userMessages, [
    {id: 'earlier', turnId: 'turn-a', text: 'first'},
    {id: 'later', turnId: 'turn-b', text: 'second'}
  ]);
  assert.equal(snapshot.goal, 'unchanged native goal');
  assert.equal(snapshot.nextCursor, 'opaque-native-cursor');
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.time, '2026-10-10T01:02:03Z');
  assert.deepEqual(snapshot.workers, {lastKnown: [{id: 'worker-1', status: 'waiting'}], truncated: false});
  assert.deepEqual(snapshot.compactions, {count: 1, complete: true, inFlight: false});
});

test('native calls are read-only, failures remain independently UNKNOWN, with no retry', async () => {
  const methods = [];
  const snapshot = await readConversationContext({
    request(method) {
      methods.push(method);
      if (method === 'thread/goal/get') throw new Error('offline');
      throw new Error('items unavailable');
    },
    threadId: 't',
    now: 'fixed'
  });
  assert.deepEqual(methods, ['thread/goal/get', 'thread/items/list']);
  assert.equal(snapshot.goal, 'UNKNOWN');
  assert.equal(snapshot.nextCursor, 'UNKNOWN');
  assert.equal(snapshot.partial, 'UNKNOWN');
  assert.equal(snapshot.errors.goal, 'offline');
  assert.equal(snapshot.errors.items, 'items unavailable');
  assert.deepEqual(snapshot.userMessages, []);
});

test('enforces per-message and aggregate bounds while retaining newest corrections first', async () => {
  let requested;
  const data = Array.from({length: 40}, (_, index) =>
    userItem(`m${39 - index}`, '🙂'.repeat(5000), `turn-${index}`, 40 - index)
  );
  const snapshot = await readConversationContext({
    request: async (_method, params) => {
      if (params.limit) requested = params.limit;
      return params.limit ? {data, nextCursor: null} : {};
    },
    threadId: 'large',
    now: 'fixed'
  });
  assert.equal(requested, 40);
  assert.equal(snapshot.userMessages.length, 5);
  assert.ok(snapshot.userMessages.every(message => Array.from(message.text).length <= 2000));
  assert.equal(
    snapshot.userMessages.reduce((n, message) => n + Array.from(message.text).length, 0),
    10000
  );
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.userMessages[0].id, 'm35');
  assert.equal(snapshot.userMessages.at(-1).id, 'm39');
  assert.equal(snapshot.userMessages.at(-1).truncated, true);
});

test('preserves native item order for null times and joins text chunks with newlines', async () => {
  const newest = userItem('newest', 'last correction', 'new-turn', null);
  newest.item.content = [
    {type: 'text', text: 'correction A'},
    {type: 'text', text: 'correction B'}
  ];
  const snapshot = await readConversationContext({
    request: async (_method, params) =>
      params.limit
        ? {data: [newest, userItem('older', 'older request', 'old-turn', 5)], nextCursor: null}
        : {goal: null},
    threadId: 't',
    now: 'fixed'
  });
  assert.deepEqual(
    snapshot.userMessages.map(message => message.id),
    ['older', 'newest']
  );
  assert.equal(snapshot.userMessages.at(-1).text, 'correction A\ncorrection B');
  assert.equal(snapshot.goal, null);
});

test('missing goal is UNKNOWN, workers expose lastKnown IDs only, and pages are capped at 40', async () => {
  const workers = Array.from({length: 22}, (_, index) => ({requestId: `w${index}`, status: 'running', prompt: 'omit'}));
  const data = Array.from({length: 41}, (_, index) => userItem(`m${index}`, `${index}`, `turn-${index}`, null));
  const snapshot = await readConversationContext({
    request: async (_method, params) => (params.limit ? {data, nextCursor: null} : {unrelated: 'not a goal'}),
    threadId: 't',
    workers,
    compactions: {ids: ['a', 'b'], complete: false, inFlight: true},
    now: 'fixed'
  });
  assert.equal(snapshot.goal, 'UNKNOWN');
  assert.equal(snapshot.errors.goal, 'Invalid ThreadGoalGetResponse');
  assert.equal(snapshot.userMessages.length, 40);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.workers.lastKnown.length, 20);
  assert.equal(snapshot.workers.lastKnown[0].id, 'w2');
  assert.equal(snapshot.workers.truncated, true);
  assert.deepEqual(snapshot.compactions, {count: 2, complete: false, inFlight: true});
});

test('rejects invalid cursors before RPC and renderer stays small with JSON data framing', async () => {
  let calls = 0;
  await assert.rejects(
    readConversationContext({
      request: async () => {
        calls++;
      },
      threadId: 't',
      cursor: {type: 'item', itemId: ''}
    }),
    /cursor/
  );
  assert.equal(calls, 0);
  const rendered = renderCompactionContext({
    time: 'fixed',
    threadId: 't',
    goal: {instruction: 'untrusted'},
    userMessages: [
      {id: 'old', text: 'o'.repeat(2000)},
      {id: 'middle', text: 'm'.repeat(2000)},
      {id: 'latest', text: 'n'.repeat(2000)}
    ],
    nextCursor: null,
    partial: false,
    truncated: false,
    errors: {goal: null, items: null},
    workers: {lastKnown: [], truncated: false},
    compactions: {count: 1, complete: true, inFlight: false}
  });
  assert.ok(rendered.length < 12000);
  assert.match(rendered, /歷史、goal.*資料引用/);
  assert.match(rendered, /不得重播/);
  assert.ok(rendered.includes('"id":"latest"'));
  assert.ok(!rendered.includes('"id":"old"'));
  assert.match(rendered, /\{"time":"fixed"/);
  assert.ok(CONVERSATION_CONTEXT_GUIDANCE.includes('active 本身不等於取消'));
});

test('renderer preserves verified null goal/cursor/errors and status for a long objective', () => {
  const text = renderCompactionContext({
    goal: null,
    nextCursor: null,
    partial: false,
    errors: {goal: null, items: null}
  });
  assert.match(text, /"goal":null/);
  assert.match(text, /"nextCursor":null/);
  assert.match(text, /"errors":\{"goal":null,"items":null\}/);
  const long = renderCompactionContext({
    goal: {objective: 'x'.repeat(4000), status: 'paused', tokensUsed: 8, tokenBudget: 100, updatedAt: 12}
  });
  assert.match(long, /"status":"paused"/);
  assert.match(long, /"tokensUsed":8/);
});

test('compact-only bounded summary scan crosses autonomous turns without changing normal item pagination', async () => {
  const calls = [];
  const request = async (method, p) => {
    calls.push({method, p});
    if (method === 'thread/goal/get') return {goal: null};
    if (method === 'thread/items/list')
      return {
        data: Array.from({length: 40}, (_, i) => ({item: {type: 'mcpToolCall', id: 'tool' + i}})),
        nextCursor: 'older'
      };
    if (!p.cursor)
      return {
        data: Array.from({length: 40}, (_, i) => ({id: 'auto' + i, items: [{type: 'agentMessage', id: 'agent' + i}]})),
        nextCursor: 'older'
      };
    return {
      data: [
        {id: 't', items: [userItem('latest', '取消舊暫停；更正術語', 't').item]},
        {id: 'old', items: [userItem('previous', '先前要求', 'old').item]}
      ],
      nextCursor: null
    };
  };
  const snapshot = await readConversationContext({request, threadId: 't', scan: true});
  assert.equal(calls.filter(c => c.method === 'thread/turns/list').length, 2);
  assert.equal(snapshot.userMessages.at(-1).text, '取消舊暫停；更正術語');
  const normal = await readConversationContext({request, threadId: 't'});
  assert.equal(normal.nextCursor, 'older');
  assert.equal(normal.userMessages.length, 0);
});
test('compact scan has a five-page bound and preserves a failed next page as partial', async () => {
  let n = 0;
  const request = async method =>
    method === 'thread/goal/get'
      ? {goal: null}
      : (n++, {data: [{id: 'auto', items: [{type: 'agentMessage', id: 'm'}]}], nextCursor: 'more'});
  const s = await readConversationContext({request, threadId: 't', scan: true});
  assert.equal(n, 5);
  assert.equal(s.partial, true);
  n = 0;
  const fail = await readConversationContext({
    threadId: 't',
    scan: true,
    request: async method => {
      if (method === 'thread/goal/get') return {goal: null};
      if (n++) throw Error('timed out');
      return {data: [{id: 't', items: [userItem('u', 'latest', 't').item]}], nextCursor: 'more'};
    }
  });
  assert.equal(fail.partial, true);
  assert.equal(fail.errors.items, 'timed out');
  assert.equal(fail.userMessages[0].id, 'u');
});
