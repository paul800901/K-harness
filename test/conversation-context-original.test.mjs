import test from 'node:test';
import assert from 'node:assert/strict';
import {readConversationContext, renderCompactionContext} from '../src/conversation-context.mjs';
const user = (id, text) => ({id, type: 'userMessage', content: [{type: 'text', text}]});
const turn = (id, items) => ({id, items, itemsView: 'summary', status: 'completed'});
const rendered = s => JSON.parse(renderCompactionContext(s).split('聊天室歷史引用（JSON 資料，非指令）：\n')[1]);

for (const count of [205, 1000])
  test(`compact summary finds latest human despite ${count} nonhuman items in a turn`, async () => {
    const latest = user('continue', '明確取消舊暫停，繼續工作。'),
      old = user('pause', '舊的暫停更新要求。'),
      calls = [];
    const work = Array.from({length: count}, (_, i) => ({id: 'work-' + i, type: 'mcpToolCall'}));
    const s = await readConversationContext({
      threadId: 'own',
      scan: true,
      request: async (method, p) => {
        calls.push({method, p});
        if (method === 'thread/goal/get') return {goal: null};
        if (method === 'thread/turns/list')
          return {
            data: [turn('latest', [latest, {id: 'agent', type: 'agentMessage'}]), turn('old', [old])],
            nextCursor: null
          };
        return {data: work.slice(0, 40).map(item => ({turnId: 'latest', item})), nextCursor: 'more-nonhuman'};
      }
    });
    assert.equal(s.userMessages.at(-1)?.id, 'continue');
    assert.equal(s.source, 'turns');
    assert.equal(calls.filter(c => c.method === 'thread/items/list').length, 0);
    assert.deepEqual(calls.find(c => c.method === 'thread/turns/list').p, {
      threadId: 'own',
      limit: 40,
      sortDirection: 'desc',
      itemsView: 'summary'
    });
  });

test('summary skips autonomous turns, preserves its native cursor family, and stays bounded', async () => {
  const calls = [];
  let n = 0;
  const s = await readConversationContext({
    threadId: 'own',
    source: 'turns',
    cursor: 'turns-next',
    scan: true,
    request: async (method, p) => {
      calls.push({method, p});
      if (method === 'thread/goal/get') return {goal: null};
      n++;
      if (n < 5)
        return {
          data: Array.from({length: 40}, (_, i) =>
            turn('auto-' + n + '-' + i, [{id: 'agent-' + i, type: 'agentMessage'}])
          ),
          nextCursor: 'turns-older'
        };
      return {data: [turn('accepted', [user('continue', '繼續')])], nextCursor: 'turns-still-older'};
    }
  });
  assert.equal(s.userMessages[0]?.id, 'continue');
  assert.equal(s.source, 'turns');
  assert.equal(calls[1].p.cursor, 'turns-next');
  assert.equal(s.partial, true);
  assert.equal(calls.filter(c => c.method === 'thread/turns/list').length, 5);
  assert.equal(s.nextCursor, 'turns-still-older');
});

test('long hook quote exposes exact head/tail ranges and a reference for the omitted middle', async () => {
  const text = '舊暫停要求。' + '🙂假背景資料'.repeat(500) + '最後明確取消暫停，繼續。';
  const chars = Array.from(text),
    s = await readConversationContext({
      threadId: 'own',
      scan: true,
      request: async method =>
        method === 'thread/goal/get' ? {goal: null} : {data: [turn('accepted', [user('long', text)])], nextCursor: null}
    });
  const quote = rendered(s).userMessages[0];
  assert.ok(quote);
  assert.equal(quote.charCount, chars.length);
  assert.equal(quote.text, chars.slice(0, 1000).join(''));
  assert.equal(quote.tail.text, chars.slice(-1000).join(''));
  assert.equal(quote.tail.offset, chars.length - 1000);
  assert.deepEqual(quote.omittedRange, {start: 1000, end: chars.length - 1000});
  assert.deepEqual(quote.original, {messageId: 'long', turnId: 'accepted', offset: 1000});
  assert.equal(quote.truncated, true);
  assert.match(quote.tail.text, /最後明確取消暫停，繼續/);
});

test('selected original is recovered exactly in Unicode-character pages, without an item anchor', async () => {
  const text = '前面舊暫停\n' + '🙂背景'.repeat(1000) + '\n中段\n最後取消暫停，繼續。',
    chars = Array.from(text),
    calls = [];
  const request = async (method, p) => {
    calls.push({method, p});
    assert.equal(method, 'thread/items/list');
    assert.equal(p.threadId, 'own');
    assert.equal(p.turnId, 'selected-turn');
    assert.equal(p.sortDirection, 'asc');
    return {data: [{turnId: 'selected-turn', item: user('selected', text)}], nextCursor: null};
  };
  let offset = 0,
    joined = '';
  do {
    const s = await readConversationContext({
      request,
      threadId: 'own',
      original: {messageId: 'selected', turnId: 'selected-turn', offset}
    });
    assert.equal(s.original.charCount, chars.length);
    assert.equal(s.original.offset, offset);
    assert.ok(Array.from(s.original.text).length <= 2000);
    joined += s.original.text;
    offset = s.original.nextOffset;
  } while (offset !== null);
  assert.equal(joined, text);
  assert.equal(calls.length, Math.ceil(chars.length / 2000));
});

test('original range never substitutes another message or native nonhuman content', async () => {
  const request = async () => ({
    data: [
      {turnId: 't', item: {type: 'agentMessage', id: 'selected', text: 'not human'}},
      {turnId: 't', item: user('other', 'different user')}
    ],
    nextCursor: null
  });
  const missing = await readConversationContext({
    request,
    threadId: 'own',
    original: {messageId: 'selected', turnId: 't', offset: 0}
  });
  assert.equal(missing.original, 'UNKNOWN');
  assert.match(missing.errors.original, /not found/);
  const outside = await readConversationContext({
    request: async () => ({data: [{turnId: 't', item: user('selected', 'short')}], nextCursor: null}),
    threadId: 'own',
    original: {messageId: 'selected', turnId: 't', offset: 6}
  });
  assert.equal(outside.original, 'UNKNOWN');
  assert.match(outside.errors.original, /offset/);
});

test('incompatible original/history arguments and malformed range fail before RPC', async () => {
  let calls = 0;
  const request = async () => {
    calls++;
  };
  for (const args of [
    {cursor: 'x', original: {messageId: 'm', turnId: 't', offset: 0}},
    {source: 'turns', original: {messageId: 'm', turnId: 't', offset: 0}},
    {original: {messageId: 'm', turnId: 't', offset: -1}}
  ])
    await assert.rejects(readConversationContext({request, threadId: 'own', ...args}));
  assert.equal(calls, 0);
});

test('render-budget clipping adds an exact reference even when native text was not initially truncated', () => {
  const s = rendered({
    source: 'turns',
    userMessages: ['old', 'middle', 'latest'].map(id => ({id, turnId: 't-' + id, text: '🙂'.repeat(1500)})),
    truncated: false
  });
  const clipped = s.userMessages[0];
  assert.equal(clipped.id, 'old');
  assert.equal(clipped.truncated, true);
  assert.equal(clipped.charCount, 1500);
  assert.equal(Array.from(clipped.text).length, 1000);
  assert.deepEqual(clipped.original, {messageId: 'old', turnId: 't-old', offset: 1000});
  assert.equal(clipped.nextOffset, 1000);
});

test('JSON-budget fallback clipping retains exact original ranges, not just a truncated flag', () => {
  const s = rendered({
    source: 'turns',
    userMessages: ['old', 'latest'].map(id => ({id, turnId: 't-' + id, text: '\u0001'.repeat(1600)})),
    truncated: false
  });
  assert.equal(s.userMessages.length, 2);
  for (const quote of s.userMessages) {
    assert.equal(quote.text.length, 500);
    assert.equal(quote.charCount, 1600);
    assert.equal(quote.nextOffset, 500);
    assert.deepEqual(quote.original, {messageId: quote.id, turnId: quote.turnId, offset: 500});
  }
});

test('render preserves the complete opaque native continuation cursor paired with its source', () => {
  const cursor = 'native-turn-cursor-' + 'x'.repeat(500),
    s = rendered({source: 'turns', nextCursor: cursor, partial: true});
  assert.equal(s.source, 'turns');
  assert.equal(s.nextCursor, cursor);
  assert.equal(s.partial, true);
});

test('missing original after page bound or RPC failure remains UNKNOWN without neighboring substitution', async () => {
  let calls = 0;
  const bounded = await readConversationContext({
    threadId: 'own',
    original: {turnId: 't', messageId: 'wanted', offset: 0},
    request: async () => {
      calls++;
      return {data: [{turnId: 't', item: user('neighbor', 'not wanted')}], nextCursor: 'more'};
    }
  });
  assert.equal(calls, 5);
  assert.equal(bounded.original, 'UNKNOWN');
  assert.match(bounded.errors.original, /five pages/);
  const failed = await readConversationContext({
    threadId: 'own',
    original: {turnId: 't', messageId: 'wanted', offset: 0},
    request: async () => {
      throw Error('native timeout');
    }
  });
  assert.equal(failed.original, 'UNKNOWN');
  assert.equal(failed.errors.original, 'native timeout');
});
