const isWorkerEvent = message => message?.kind === 'worker-completion' || message?.source === 'worker-completion' || String(message?.id ?? '').startsWith('luna-completion-');

/** Groups persisted messages for display and handoff without mutating source data. */
export function groupConversationMessages(messages = []) {
  const groups = [];
  const byId = new Map();
  const byTurnId = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const explicitId = message?.groupId;
    let group = explicitId ? byId.get(explicitId) : (message?.turnId ? byTurnId.get(message.turnId) : null);
    const workerEvent = isWorkerEvent(message);
    const isRootUser = message?.role === 'user' && !workerEvent && !['steer', 'queued-send'].includes(message?.source);
    if (!group && explicitId) {
      group = { id: explicitId, messages: [], startedAt: null, completedAt: null };
      groups.push(group); byId.set(explicitId, group);
    }
    if (!group) {
      const current = groups.at(-1);
      if (isRootUser || !current) {
        const id = `legacy-${groups.length}`;
        group = { id, messages: [], startedAt: null, completedAt: null, legacy: true };
        groups.push(group);
      } else group = current;
    }
    group.messages.push(message);
    if (message?.turnId && !byTurnId.has(message.turnId)) byTurnId.set(message.turnId, group);
    if (!group.startedAt && message?.createdAt) group.startedAt = message.createdAt;
    if (message?.completedAt) group.completedAt = message.completedAt;
    if (message?.role === 'assistant' && message?.status === 'completed' && !group.completedAt && message?.createdAt) group.completedAt = message.createdAt;
  }
  return groups.map(group => {
    const conclusion = [...group.messages].reverse().find(message => message?.role === 'assistant' && !message?.partial && !message?.streaming);
    return { ...group, conclusion, root: group.messages.find(message => message?.role === 'user' && !isWorkerEvent(message)) };
  });
}

export function elapsedConversationMs(group, now = Date.now()) {
  const start = Date.parse(group?.startedAt ?? '');
  const parsedEnd = Date.parse(group?.completedAt ?? '');
  const end = Number.isFinite(parsedEnd) ? parsedEnd : now;
  return Number.isFinite(start) && end >= start ? end - start : null;
}

/** Returns only user/conclusion text from groups strictly before messageId's group. */
export function conversationGroupsBefore(messages = [], messageId) {
  const groups = groupConversationMessages(messages);
  const index = groups.findIndex(group => group.messages.some(message => message?.id === messageId));
  if (index < 0) return [];
  return groups.slice(0, index).map(group => ({
    user: String(group.root?.text ?? ''),
    conclusion: String(group.conclusion?.text ?? ''),
  }));
}

/** Includes the selected group, useful when branching at its final conclusion. */
export function conversationGroupsThrough(messages = [], messageId) {
  const groups = groupConversationMessages(messages);
  const index = groups.findIndex(group => group.messages.some(message => message?.id === messageId));
  if (index < 0) return [];
  return groups.slice(0, index + 1).map(group => ({
    user: String(group.root?.text ?? ''),
    conclusion: String(group.conclusion?.text ?? ''),
  }));
}
