import {discussionStatus} from '../shared/discussion.mjs';
import {modelProvider} from '../shared/model-provider.mjs';
import {claudeSessionLimitText} from './native-notices.mjs';

const quotaText = (error, participant) =>
  participant?.route !== 'api' && modelProvider(participant?.model) === 'claude' ? claudeSessionLimitText(error) : null;

// Describe only recorded errors and the current batch; never change the run or retry a participant.
export function discussionPresentation(run, messages = []) {
  const participants = run?.participants ?? [];
  const current = messages.filter(
    m => m.kind === 'discussion' && m.runId === run?.id && Number.isInteger(m.round) && m.round === run?.round
  );
  const limited = current.flatMap(m => {
    const participant = participants.find(p => p.id === m.participantId);
    const text = quotaText(m.error, participant);
    return text ? [`${participant.displayName ?? participant.model}：${text}`] : [];
  });
  let statusText = discussionStatus[run?.status] ?? '歷史紀錄';
  let notice = (run?.error ?? '')
    .split('\n')
    .map(line => {
      const participant = participants.find(p => line.startsWith(`${p.displayName ?? p.model}：`));
      if (!participant || participant.route === 'api') return line;
      const prefix = `${participant.displayName ?? participant.model}：`;
      return prefix + (quotaText(line.slice(prefix.length), participant) ?? line.slice(prefix.length));
    })
    .join('\n');
  if (limited.length) {
    notice ||= limited.join('\n');
    if (run.status === 'working') {
      statusText = '部分參與者額度已用完';
      const waiting = current
        .filter(m => m.streaming && !m.partial)
        .map(m => participants.find(p => p.id === m.participantId))
        .filter(Boolean)
        .map(p => p.displayName ?? p.model);
      if (waiting.length) notice += `\n正在等待 ${waiting.join('、')} 完成本批回覆。`;
    } else if (run.status === 'failed') statusText = '部分參與者額度已用完，討論受阻';
  }
  return {statusText, notice};
}

// Display-only projection. Legacy records are inferred, never rewritten.
export function roundtableData(run, messages = []) {
  const original = messages.filter(m => m.kind === 'discussion' && m.runId === run?.id);
  const participants = run?.participants ?? [];
  const replies = original.filter(m => m.role === 'assistant' && !m.background && !m.summary);
  const inferred = replies.some(m => !m.participantId || !Number.isInteger(m.round));
  const batches = new Map();
  let round = 1,
    used = new Set();
  for (const message of [...replies].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))) {
    let id = message.participantId,
      n = message.round;
    if (!id || !Number.isInteger(n)) {
      const candidates = participants.filter(
        p => p.model === message.model || (p.displayName ?? p.model) === message.speaker
      );
      if (!candidates.some(p => !used.has(p.id))) {
        round++;
        used = new Set();
      }
      id = candidates.find(p => !used.has(p.id))?.id ?? `unknown-${message.id}`;
      n = round;
      used.add(id);
    }
    if (!batches.has(n)) batches.set(n, new Map());
    batches.get(n).set(id, message);
  }
  const last = Math.max(run?.round ?? 0, 0, ...batches.keys());
  const live = ['preparing', 'working', 'waiting-host', 'finishing', 'stopping'].includes(run?.status);
  const rows = Array.from({length: last}, (_, i) => {
    const n = i + 1;
    const decisions = (run.decisions ?? []).filter(d => d.round === n);
    const planned =
      n === 1
        ? participants.map(p => p.id)
        : (run.decisions ?? []).filter(d => !d.superseded && d.nextRound === n).flatMap(d => d.speakers);
    const cells = participants.map(p => {
      const message = batches.get(n)?.get(p.id);
      const quota = quotaText(message?.error, p);
      const status = message
        ? message.streaming
          ? '回覆中'
          : message.partial
            ? quota
              ? '額度已用完'
              : '未完成'
            : '已完成'
        : planned.includes(p.id)
          ? live && n === last
            ? '回覆中'
            : '未完成'
          : '本批未點名';
      const text = quota
        ? [message.text === message.error ? '' : message.text, quota].filter(Boolean).join('\n\n')
        : (message?.text ?? '');
      return {id: p.id, name: p.displayName ?? p.model, round: n, text, status, message};
    });
    const text = decisions
      .map(d =>
        [
          d.superseded ? '插話到達，這次安排未執行。' : '',
          d.action === 'finish'
            ? `結束理由：${d.reason ?? '未提供'}`
            : `點名：${d.speakers.map(id => participants.find(p => p.id === id)?.displayName ?? id).join('、')}`,
          d.prompt,
          d.createdAt
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n');
    const host = {
      id: 'host',
      name: `主持人 · ${run.facilitator?.displayName ?? run.facilitator?.model ?? '原聊天室主代理'}`,
      round: n,
      text: text || (run.decisions === undefined ? '安排未記錄' : '尚無主持決定'),
      status:
        run.decisions === undefined
          ? '安排未記錄'
          : text
            ? '已完成'
            : live && n === last
              ? run.status === 'waiting-host'
                ? '等待主代理'
                : '等待安排'
              : '未完成'
    };
    return {
      round: n,
      cells: [host, ...cells],
      interjections: original.filter(
        m =>
          m.source === 'steer' &&
          ((run.interjections ?? []).find(e => e.messageId === m.id)?.afterRound ??
            [...batches]
              .filter(([, entries]) => [...entries.values()].some(r => (r.createdAt ?? '') <= (m.createdAt ?? '')))
              .at(-1)?.[0] ??
            last) === n
      )
    };
  });
  const summary = original.findLast(m => m.summary);
  const materials = original.filter(
    m =>
      m.background ||
      (m.role === 'user' &&
        (m.source !== 'steer' || (run.interjections ?? []).find(e => e.messageId === m.id)?.afterRound === 0))
  );
  const zero = {
    round: 0,
    cells: [
      {
        id: 'materials',
        name: '議題與任務書',
        round: 0,
        text: materials.map(m => m.text).join('\n\n'),
        status: '已完成'
      },
      {
        id: 'summary',
        name: '討論整理（AI 產生）',
        round: 0,
        text: summary?.text ?? '尚未產生整理。',
        status: summary ? '已完成' : '未完成'
      }
    ],
    interjections: original.filter(
      m => m.source === 'steer' && (run.interjections ?? []).find(e => e.messageId === m.id)?.afterRound === 0
    )
  };
  return {rows, zero, summary, inferred, last, ...discussionPresentation(run, messages)};
}

export function discussionRuns(discussion, messages = []) {
  if (discussion?.runs) return discussion.runs;
  const ids = [...new Set(messages.filter(m => m.kind === 'discussion').map(m => m.runId))];
  return ids.map(id => {
    if (id === discussion?.id) return discussion;
    const rows = messages.filter(m => m.runId === id);
    return {
      id,
      question: rows.find(m => m.role === 'user')?.text ?? '歷史討論',
      status: 'historical',
      participants: [
        ...new Map(
          rows
            .filter(m => m.model)
            .map(m => [
              m.participantId ?? m.speaker,
              {id: m.participantId ?? m.speaker, model: m.model, displayName: m.speaker}
            ])
        ).values()
      ]
    };
  });
}
