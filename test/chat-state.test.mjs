import test from 'node:test';
import assert from 'node:assert/strict';
import {sameChatState} from '../frontend/chat-state.mjs';
test('background-room and quota changes retain chat; all current-room inputs still invalidate', () => {
  const a = {
    threadId: 'A',
    messages: [{id: '1'}],
    tools: [],
    busy: true,
    questions: [],
    workerDetails: [
      {conversationId: 'A', status: 'running'},
      {conversationId: 'B', status: 'running'}
    ]
  };
  assert.equal(
    sameChatState(a, {
      ...a,
      usage: {codex: 1},
      conversationActivity: [{}],
      workerActivity: {running: 2},
      completionAttention: {unread: 1},
      workerDetails: [a.workerDetails[0], {conversationId: 'B', status: 'completed'}]
    }),
    true
  );
  for (const change of [
    {messages: [...a.messages]},
    {tools: [{}]},
    {busy: false},
    {threadId: 'B'},
    {questions: [{}]},
    {newFutureField: 1},
    {workerDetails: [{conversationId: 'A', status: 'failed'}]},
    {workerDetails: undefined}
  ])
    assert.equal(sameChatState(a, {...a, ...change}), false);
  assert.equal(sameChatState({...a, error: 'old'}, a), false);
});
