import {stopThreadTerminals} from './background-terminals.mjs';

export function collectNativeWorkerIds(items) {
  return [
    ...new Set(
      items.flatMap(i =>
        i.type === 'collabAgentToolCall'
          ? (i.receiverThreadIds ?? [])
          : i.type === 'subAgentActivity' && i.agentThreadId
            ? [i.agentThreadId]
            : []
      )
    )
  ];
}

export async function checkNativeWorkers(host, parentThreadId, ids, {stop = false} = {}) {
  const readWorker = async threadId => {
    const result = {
      requestId: `codex:${threadId}`,
      threadId,
      provider: 'codex',
      status: 'unresolved',
      settled: false,
      outputFiles: []
    };
    let lastReadAt;
    const read = async () => {
      let thread = (await host.request('thread/read', {threadId, includeTurns: false}))?.thread;
      if (!thread || thread.parentThreadId !== parentThreadId) return thread;
      if (thread.historyMode === 'paginated') {
        // Latest native turn summary, not deprecated full-history hydration.
        const page = await host.request('thread/turns/list', {
          threadId,
          limit: 1,
          sortDirection: 'desc',
          itemsView: 'summary'
        });
        return {...thread, turns: Array.isArray(page?.data) ? page.data : []};
      }
      return (await host.request('thread/read', {threadId, includeTurns: true}))?.thread;
    };
    try {
      let thread = await read();
      if (!thread || typeof thread !== 'object') return {...result, error: '原生子代理狀態讀回資料不完整。'};
      lastReadAt = new Date().toISOString();
      if (thread.parentThreadId !== parentThreadId) return {...result, lastReadAt, error: '原生子代理來源無法確認。'};
      const active = thread.turns?.findLast(t => t.status === 'inProgress');
      if (stop && active) {
        await host.request('turn/interrupt', {threadId, turnId: active.id});
        thread = await read();
        if (!thread || typeof thread !== 'object') throw Error('native thread readback was incomplete');
        lastReadAt = new Date().toISOString();
        if (thread.parentThreadId !== parentThreadId) return {...result, lastReadAt, error: '原生子代理來源無法確認。'};
      }
      if (stop && thread.status?.type !== 'notLoaded') await stopThreadTerminals(host, threadId);
      const metadata = {
        lastReadAt,
        ...(typeof thread.model === 'string' ? {model: thread.model} : {}),
        ...(typeof thread.agentNickname === 'string' ? {agentNickname: thread.agentNickname} : {}),
        ...(typeof thread.name === 'string' ? {name: thread.name} : {})
      };
      const last = thread.turns?.at(-1);
      if (typeof last?.id === 'string') metadata.turnId = last.id;
      if (thread.status?.type === 'active' || last?.status === 'inProgress')
        return {...result, ...metadata, lastReadAt, status: 'running'};
      if (['idle', 'notLoaded', 'systemError'].includes(thread.status?.type)) {
        if (['completed', 'interrupted', 'failed'].includes(last?.status))
          return {
            ...result,
            ...metadata,
            lastReadAt,
            status: last.status === 'interrupted' ? 'cancelled' : last.status,
            settled: true
          };
        return {...result, ...metadata, lastReadAt, error: '原生子代理最後回合狀態未確認。'};
      }
      return {...result, ...metadata, lastReadAt};
    } catch (error) {
      return {
        ...result,
        ...(lastReadAt ? {lastReadAt} : {}),
        error: '原生子代理狀態讀回失敗。',
        diagnostic: error?.protocolMessage ?? error?.message
      };
    }
  };
  // Hundreds of historical children otherwise overflow the native request queue.
  // Each child is read once; bounded concurrency is not a retry or task replay.
  const results = new Array(ids.length);
  let next = 0;
  await Promise.all(
    Array.from({length: Math.min(12, ids.length)}, async () => {
      while (next < ids.length) {
        const index = next++;
        results[index] = await readWorker(ids[index]);
      }
    })
  );
  return results;
}
