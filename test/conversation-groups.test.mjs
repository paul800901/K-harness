import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationGroupsBefore, conversationGroupsThrough, elapsedConversationMs, groupConversationMessages } from '../shared/conversation-groups.mjs';

test('keeps worker notices and follow-up assistant replies in the same explicit group', () => {
  const groups = groupConversationMessages([
    { id: 'u1', role: 'user', groupId: 'g1', createdAt: '2026-09-24T10:00:00Z' },
    { id: 'w1', role: 'user', kind: 'worker-completion', groupId: 'g1' },
    { id: 'a1', role: 'assistant', groupId: 'g1', completedAt: '2026-09-24T10:04:12Z' },
    { id: 'u2', role: 'user', groupId: 'g2' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].messages.length, 3);
  assert.equal(groups[0].conclusion.id, 'a1');
  assert.equal(elapsedConversationMs(groups[0]), 252000);
});

test('legacy turns split at ordinary user messages and never invent timing', () => {
  const groups = groupConversationMessages([
    { id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' }, { id: 'a2', role: 'assistant' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(elapsedConversationMs(groups[0]), null);
});

test('legacy in-turn user messages stay with their turn when turnId is available', () => {
  const groups = groupConversationMessages([
    { id: 'u1', role: 'user', turnId: 't1' },
    { id: 'a1', role: 'assistant', turnId: 't1' },
    { id: 'u2', role: 'user', source: 'steer', turnId: 't1' },
    { id: 'a2', role: 'assistant', turnId: 't1' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].messages.length, 4);
});

test('worker completion by itself does not start a new group', () => {
  const groups = groupConversationMessages([
    { id: 'u1', role: 'user', groupId: 'g1' },
    { id: 'luna-completion-1', role: 'user', groupId: 'g1' },
    { id: 'a1', role: 'assistant', groupId: 'g1' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].root.id, 'u1');
});

test('handoff history includes only earlier user and conclusion text', () => {
  const messages = [
    { id: 'u1', role: 'user', groupId: 'g1', text: 'request one' },
    { id: 't1', role: 'assistant', groupId: 'g1', text: 'tool secret output should not appear' },
    { id: 'a1', role: 'assistant', groupId: 'g1', text: 'result one' },
    { id: 'u2', role: 'user', groupId: 'g2', text: 'request two' },
  ];
  assert.deepEqual(conversationGroupsBefore(messages, 'u2'), [{ user: 'request one', conclusion: 'result one' }]);
  assert.deepEqual(conversationGroupsThrough(messages, 'a1'), [{ user: 'request one', conclusion: 'result one' }]);
});
