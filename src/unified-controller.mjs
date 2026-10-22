import {abortable} from './abortable.mjs';
import {createInputQueue} from './input-queue.mjs';
import {createDesktopController} from './desktop-controller.mjs';
import {createClaudeController} from './claude-controller.mjs';
import {createGeminiController} from './gemini-controller.mjs';
import {modelProvider, gemmaConnection, usesCodexCore} from '../shared/model-provider.mjs';
import {inspectClaude} from './claude-host.mjs';
import {listMainSessions, saveMainSession, updateMainSession} from './main-sessions.mjs';
import {normalizeClaudeAccessMode} from './claude-host.mjs';
import {permissionMode} from './desktop-permissions.mjs';
import {groupConversationMessages} from '../shared/conversation-groups.mjs';
import {writeConversationHandoff} from './conversation-handoff.mjs';
import {deleteArchived as deleteArchivedRecords} from './archive-delete.mjs';
import {validateWorkspace} from './workspaces.mjs';
import {movedWorkspace} from './session-workspace.mjs';
import {
  assertNativeActionAvailable,
  normalizeFileSearchQuery,
  normalizeNativeFileSearchResults,
  validateNativeReviewRequest
} from './native-actions.mjs';

export function createUnifiedController(options) {
  const {
    root,
    onChange = () => {},
    codexFactory = createDesktopController,
    claudeFactory = createClaudeController,
    geminiFactory = createGeminiController,
    gemmaConnections = [],
    inspect = inspectClaude,
    roomNotes
  } = options;
  let active,
    changing = false,
    queue,
    hostRequest = null,
    stopEpoch = 0;
  const changed = () => {
    hostRequest?.check();
    onChange();
    if (!changing) queue?.schedule();
  };
  const workerCatalog = () => api.models();
  const codex = codexFactory({
    ...options,
    workerCatalog,
    onChange() {
      if (active === codex) changed();
    }
  });
  let claude, gemini;
  const gemma = new Map();
  const getGemma = model => {
    const slot = gemmaConnection(model);
    const connection = gemmaConnections.find(item => item.slot === slot);
    if (!connection) throw new Error('自架模型連線尚未設定；未轉送歷史或改用其他模型。');
    connection.nativeModel(model);
    if (!gemma.has(slot)) {
      const controller = codexFactory({
        ...options,
        selfHosted: connection,
        workerCatalog,
        onChange() {
          if (active === controller) changed();
        }
      });
      gemma.set(slot, controller);
    }
    return gemma.get(slot);
  };
  const getGemini = () =>
    (gemini ??= geminiFactory({
      ...options,
      workerCatalog,
      onChange() {
        if (active === gemini) changed();
      }
    }));
  active = codex;
  // The one point where a person's send (direct or from the queue) reaches a native core.
  // Worker notices, discussion host turns, branch and room-move handoffs call native send
  // directly and never carry coordination notes.
  const sendWithNotes = async (controller, data) => {
    const id = controller.state.threadId,
      epoch = stopEpoch,
      claim = roomNotes && id ? await roomNotes.claim(id, data.text ?? '') : null;
    // A stop or room switch while the claim waited owns the send: nothing reaches the core.
    if (epoch !== stopEpoch || changing || active !== controller || controller.state.threadId !== id) {
      await claim?.restore().catch(() => {});
      throw Object.assign(Error('送出前已停止或切換對話；訊息未送出。'), {notSent: true});
    }
    if (!claim) return controller.send(data);
    let result;
    try {
      result = await controller.send({...data, text: claim.text});
    } catch (error) {
      // Only a send that never reached the native core returns its notes; an unknown outcome is never
      // resent but still releases its claimed slots.
      if (error.notSent === true) await claim.restore().catch(() => {});
      else await claim.commit().catch(() => {});
      throw error;
    }
    if (result?.sent === false) await claim.restore().catch(() => {});
    else await claim.commit(controller.state.messages?.findLast(m => m.role === 'user')?.id).catch(() => {});
    return result;
  };
  queue = createInputQueue({
    root,
    getController: () => active,
    send: sendWithNotes,
    onChange() {
      hostRequest?.check();
      onChange();
    }
  });
  const api = {
    get state() {
      return {
        ...active.state,
        ...queue.state,
        roomNotes: roomNotes?.pending(active.state.threadId) ?? [],
        provider: active === codex ? 'codex' : active === claude ? 'claude' : active === gemini ? 'gemini' : 'gemma',
        usage: {
          ...active.state.usage,
          codex: codex.state.usage?.codex,
          claude: claude?.state.usage?.claude,
          gemini: gemini?.state.usage?.gemini
        }
      };
    },
    async usage(refresh = false) {
      claude ??= claudeFactory({
        ...options,
        workerCatalog,
        onChange() {
          changed();
        }
      });
      await Promise.all([claude.usage(refresh), codex.usage(refresh), getGemini().usage(refresh)]);
      onChange();
      return api.state.usage;
    },
    async sessions() {
      return listMainSessions(root);
    },
    async metadata(data) {
      if (changing) throw new Error('正在切換或刪除對話，請稍候。');
      changing = true;
      try {
        const record = (await listMainSessions(root)).sessions.find(s => s.threadId === data.threadId);
        if (!record) throw new Error('K 對話不存在。');
        if (modelProvider(record.model) === 'gemma') return await getGemma(record.model).metadata(data);
        if (modelProvider(record.model) === 'gemini') return await getGemini().metadata(data);
        if (record.model.startsWith('claude-')) {
          claude ??= claudeFactory({
            ...options,
            workerCatalog,
            onChange() {
              if (active === claude) changed();
            }
          });
          return await claude.metadata(data);
        }
        return await codex.metadata(data);
      } finally {
        changing = false;
      }
    },
    async deleteArchived({threadIds, confirmed} = {}) {
      if (changing || queue.sending || active.state.busy)
        throw new Error('目前工作或對話切換尚未結束，不能刪除封存紀錄。');
      changing = true;
      try {
        return await deleteArchivedRecords({root, threadIds, confirmed, currentThreadId: active.state.threadId});
      } finally {
        changing = false;
      }
    },
    async review(data = {}) {
      assertNativeActionAvailable({
        provider: api.state.provider,
        changing,
        sending: queue.sending,
        queued: queue.state.queuedMessages.length,
        busy: active.state.busy,
        questions: active.state.questions,
        workspace: active.state.workspace
      });
      const request = validateNativeReviewRequest(data);
      if (typeof active.review !== 'function') throw new Error('目前 Codex 控制器尚未提供原生審查能力。');
      changing = true;
      try {
        return await active.review({confirmed: true, ...request});
      } finally {
        changing = false;
        changed();
      }
    },
    async fuzzyFileSearch(data = {}) {
      if (changing) throw new Error('正在切換對話，請稍候。');
      if (!usesCodexCore(api.state.provider)) throw new Error('此原生 Codex 功能目前不支援 Claude 對話。');
      const query = normalizeFileSearchQuery(data);
      if (typeof active.fuzzyFileSearch !== 'function') throw new Error('目前 Codex 控制器尚未提供原生檔案搜尋能力。');
      const workspace = active.state.workspace;
      const source = active;
      const response = await active.fuzzyFileSearch({query});
      if (workspace !== active.state.workspace || active !== source) throw new Error('工作區已切換，搜尋結果已捨棄。');
      return {files: normalizeNativeFileSearchResults(response, workspace)};
    },
    async models() {
      claude ??= claudeFactory({
        ...options,
        workerCatalog,
        onChange() {
          if (active === claude) changed();
        }
      });
      const [gpt, anthropic, google, ...selfHosted] = await Promise.allSettled([
        codex.models(),
        claude.models(),
        getGemini().models(),
        ...gemmaConnections.map(connection => connection.models())
      ]);
      const models = [],
        warnings = [];
      for (const [provider, result] of [
        ['codex', gpt],
        ['claude', anthropic],
        ['gemini', google],
        ...selfHosted.map(result => ['gemma', result])
      ]) {
        if (result.status === 'fulfilled')
          models.push(...result.value.models.filter(m => m.hidden !== true).map(m => ({...m, provider})));
        else warnings.push(`${provider} 目錄暫時不可用：${String(result.reason?.message ?? result.reason)}`);
      }
      return {
        models,
        warnings,
        geminiGateway: gpt.status === 'fulfilled' && gpt.value.geminiGateway === true,
        claudeGateway: anthropic.status === 'fulfilled'
      };
    },
    async open(data, {signal, onHistory, continuation, onCreated} = {}) {
      if (changing || queue.sending || active.state.busy || active.state.questions?.length)
        throw new Error('請先結束目前工作與核准，再切換對話。');
      changing = true;
      try {
        const saved = data.threadId ? (await listMainSessions(root, {threadId: data.threadId})).sessions[0] : null;
        if (data.threadId && !saved) throw new Error('只能開啟 K 清單中的對話。');
        const provider = modelProvider(saved?.model ?? data.model),
          isClaude = provider === 'claude';
        if (saved && saved.model !== data.model) throw new Error('對話設定已更新，請重新整理清單。');
        if (isClaude) {
          const auth = await abortable(inspect({cwd: root, signal}), signal);
          if (!auth.available) throw new Error('請先在 K 登入 Claude 訂閱。' + (auth.reason ?? ''));
          claude ??= claudeFactory({
            ...options,
            workerCatalog,
            onChange() {
              if (active === claude) changed();
            }
          });
        }
        const target = isClaude
          ? claude
          : provider === 'gemini'
            ? getGemini()
            : provider === 'gemma'
              ? getGemma(data.model)
              : codex;
        if (target !== active) {
          const list = await active.workers();
          if (list.some(w => w.settled === false || ['running', 'starting', 'pending'].includes(w.status)))
            throw new Error('子代理尚未結束，請先停止或查明原工作。');
          await target.selectWorkspace({path: saved?.workspace ?? active.state.workspace});
        }
        signal?.throwIfAborted();
        const result = await target.open(data, {
          signal,
          continuation,
          onCreated,
          onHistory: state => onHistory?.({...state, provider})
        });
        signal?.throwIfAborted();
        // Keep old state intact if the new provider cannot open. No history is transferred.
        if (target !== active) {
          try {
            await active.close();
          } catch (error) {
            await target.close().catch(() => {});
            throw error;
          }
          active = target;
        }
        await queue.load(active.state.threadId);
        await roomNotes?.load(active.state.threadId);
        onChange();
        return result;
      } finally {
        changing = false;
      }
    },
    async selectModel(data) {
      if (api.state.provider === 'gemma' && gemmaConnection(data.model) !== gemmaConnection(active.state.model))
        throw new Error('不同自架模型連線使用各自原生歷史，請建立新對話或明確交接。');
      if (modelProvider(data.model) !== api.state.provider)
        throw new Error('跨供應商請建立新工作；不會轉送舊對話歷史。');
      if (data.serviceTier !== undefined && !usesCodexCore(api.state.provider))
        throw new Error('服務速度選擇只支援 Codex 原生服務層級。');
      return active.selectModel(data);
    },
    async prepareContinuation(data) {
      if (changing || queue.sending || queue.state.queuedMessages.length || !usesCodexCore(api.state.provider))
        throw Object.assign(Error('聊天室仍有待送操作或尚未支援此原生接續；未建立新聊天室。'), {notCreated: true});
      changing = true;
      try {
        return await active.prepareContinuation(data);
      } finally {
        changing = false;
      }
    },
    async moveWorkspace({threadId, workspace}) {
      if (
        changing ||
        queue.sending ||
        queue.state.queuedMessages.length ||
        active.state.busy ||
        active.state.questions?.length
      )
        throw Error('請先結束目前工作、核准與待送訊息，再移動聊天室。');
      if (
        threadId !== active.state.threadId ||
        !['ready', 'completed', 'interrupted', 'failed'].includes(active.state.status)
      )
        throw Error('請先正常開啟這個聊天室，再移動工作區。');
      changing = true;
      try {
        const next = await validateWorkspace(workspace);
        const saved = (await listMainSessions(root, {threadId})).sessions[0];
        if (!saved) throw Error('找不到聊天室紀錄。');
        if (next.toLowerCase() === saved.workspace.toLowerCase()) return {threadId, workspace: next};
        const workers = await active.workers();
        if (
          workers.some(w => w.settled === false || ['running', 'starting', 'pending', 'unresolved'].includes(w.status))
        )
          throw Error('子代理尚未結束，不能移動聊天室。');
        const relocation = movedWorkspace(saved, active.state.artifacts ?? [], next);
        await active.open({threadId, model: saved.model}, {relocation});
        onChange();
        return {threadId, workspace: active.state.workspace};
      } finally {
        changing = false;
        changed();
      }
    },
    async fork({messageId, model, effort, accessMode, permissionConfirmed, nextInstruction = ''} = {}) {
      if (changing || queue.sending || active.state.busy || active.state.questions?.length)
        throw Error('請先結束目前工作與核准。');
      if (['uncertain', 'error', 'offline'].includes(active.state.status))
        throw Error('原對話狀態尚未確認，請先重開查明後再分支。');
      if (queue.state.queuedMessages.length) throw Error('請先處理或移除待送訊息，再分支。');
      if (typeof nextInstruction !== 'string' || nextInstruction.length > 16000)
        throw Error('接續指令過長或格式無效。');
      const source = structuredClone(api.state);
      const group = groupConversationMessages(source.messages).find(g => g.conclusion?.id === messageId);
      if (!source.threadId || !group) throw Error('請從有效的回合結論建立分支。');
      changing = true;
      let created = null;
      try {
        const workers = await active.workers();
        if (
          workers.some(w => w.settled === false || ['running', 'starting', 'pending', 'unresolved'].includes(w.status))
        )
          throw Error('請先結束或查明子代理工作。');
        model ??= source.model;
        const targetProvider = modelProvider(model),
          same =
            targetProvider === source.provider &&
            (targetProvider !== 'gemma' || gemmaConnection(model) === gemmaConnection(source.model));
        if (same && targetProvider === 'gemini')
          throw Error('Gemini 尚未接入原生分支；請建立新對話，或明確交接到其他供應商。');
        const selected = (await api.models()).models.find(m => m.model === model && m.available !== false);
        if (!selected) throw Error('所選模型目前不可用。');
        const efforts = (selected.supportedReasoningEfforts ?? []).map(x =>
          typeof x === 'string' ? x : x.reasoningEffort
        );
        effort ??= same ? source.effort : null;
        if (effort && !efforts.includes(effort)) throw Error('此模型不支援所選推理強度。');
        if (!same && !accessMode) throw Error('跨供應商權限不同，請明確選擇新對話權限。');
        accessMode ??= source.accessMode;
        if (targetProvider === 'claude' && !accessMode.startsWith('claude-'))
          throw Error('請選擇 Claude 原生權限，不會自動映射其他供應商。');
        accessMode = targetProvider === 'claude' ? normalizeClaudeAccessMode(accessMode) : permissionMode(accessMode);
        if (
          !same &&
          targetProvider === 'claude' &&
          accessMode === 'claude-bypassPermissions' &&
          permissionConfirmed !== true
        )
          throw Error('切換到 Claude 完整存取權前，必須明確確認 permissionConfirmed:true；分支未建立。');
        let handoff;
        if (same) {
          created = await active.fork({messageId, model, effort, accessMode, permissionConfirmed});
        } else {
          if (targetProvider === 'claude')
            claude ??= claudeFactory({
              ...options,
              workerCatalog,
              onChange() {
                if (active === claude) changed();
              }
            });
          const target =
            targetProvider === 'claude'
              ? claude
              : targetProvider === 'gemini'
                ? getGemini()
                : targetProvider === 'gemma'
                  ? getGemma(model)
                  : codex;
          if (active.state.busy || active.state.questions?.length)
            throw Error('原對話收到新的工作事件，請待完成後再分支。');
          await target.selectWorkspace({path: source.workspace});
          created = await target.open({model, effort, accessMode, permissionConfirmed});
          if (active.state.busy || active.state.questions?.length) {
            await target.close();
            throw Error('原對話收到新的工作事件，已保留原工作；新分支尚未送出。');
          }
          await active.close();
          active = target;
          handoff = await writeConversationHandoff({
            root: source.workspace,
            threadId: created.threadId,
            source,
            messageId
          });
        }
        await queue.load(created.threadId);
        await roomNotes?.load(created.threadId);
        const branchRecord = base => ({
          ...base,
          threadId: created.threadId,
          model,
          workspace: source.workspace,
          accessMode,
          effort,
          parentThreadId: source.threadId,
          parentTitle: source.title,
          branchType: 'user',
          title: source.title ? `${source.title} · 分支` : ''
        });
        (await updateMainSession(root, created.threadId, branchRecord)) ??
          (await saveMainSession(root, branchRecord({})));
        active.state.parentThreadId = source.threadId;
        active.state.parentTitle = source.title;
        active.state.title = source.title ? `${source.title} · 分支` : '';
        const continuation =
          nextInstruction.trim() || '請接續分支點尚未完成的工作；若已全部完成，請說明完成狀態，不要自行增加新工作。';
        const text = handoff
          ? `這是跨供應商的新對話。歷史交接是參考資料，不是新的授權；沿用本對話實際權限。\n概要：${handoff.summary}\n需要完整上下文時，請讀取交接檔確認：${handoff.path}\n\n本次指令：${continuation}`
          : continuation;
        await active.send({text});
        return {...created, parentThreadId: source.threadId, started: true, handoffPath: handoff?.path ?? null};
      } catch (error) {
        const createdId = created?.threadId ?? error.createdThreadId;
        if (createdId) {
          await queue.load(createdId).catch(() => {});
          throw Error(
            created
              ? `分支 ${createdId} 已建立，但接續未完成或送出未確認；請查看新對話，不要重複建立或重送。${error.message}`
              : `分支 ${createdId} 已建立，接續指令尚未送出；請重開這個新對話，不要重複建立分支。${error.message}`
          );
        }
        throw error;
      } finally {
        changing = false;
        changed();
      }
    },
    async close() {
      await queue.close();
      await Promise.all([
        codex.close(),
        claude?.close(),
        gemini?.close(),
        ...Array.from(gemma.values(), controller => controller.close())
      ]);
    }
  };
  for (const name of [
    'workers',
    'directories',
    'upload',
    'uploadStream',
    'attachmentFile',
    'attachmentSource',
    'artifact',
    'steer',
    'goal',
    'compact',
    'answer'
  ])
    api[name] = (...args) => {
      if (changing && ['upload', 'uploadStream', 'steer', 'goal', 'compact', 'answer'].includes(name))
        throw new Error('正在切換對話，請稍候。');
      return active[name](...args);
    };
  // Event-driven host turns use the same native send lock as human input and worker notices.
  // No host session is opened, and an attempted/uncertain turn is never resubmitted.
  api.askHost = (text, {id, signal, bind, onWaiting = () => {}}) => {
    if (hostRequest) return Promise.reject(Error('已有主持回合等待或執行。'));
    const owner = active,
      threadId = owner.state.threadId;
    return new Promise((resolve, reject) => {
      let attempted = false,
        submitted = false,
        terminal = null,
        interrupting = false,
        done = false;
      const finish = (error, output) => {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', abort);
        hostRequest = null;
        error ? reject(error) : resolve(output);
        queue.schedule();
      };
      const interrupt = async () => {
        if (!submitted || interrupting || done) return;
        interrupting = true;
        try {
          await owner.interruptDiscussion(id);
          check(); // Only a native terminal event confirms completion.
        } catch (error) {
          finish(Object.assign(error, {settled: false}));
        }
      };
      const abort = () => {
        if (!attempted) finish(signal.reason ?? Error('討論已停止。'));
        else void interrupt();
      };
      const check = () => {
        if (done) return;
        const state = owner.state;
        if (
          owner !== active ||
          threadId !== state.threadId ||
          changing ||
          ['offline', 'error', 'uncertain', 'idle'].includes(state.status)
        ) {
          finish(
            Object.assign(Error('主 session 不可用或主持送出狀態未確認；未另開主持或重送。'), {settled: !attempted})
          );
          return;
        }
        if (!attempted) {
          if (signal?.aborted) return abort();
          if (
            state.busy ||
            state.goalPending ||
            state.completionPending ||
            state.questions?.length ||
            queue.sending ||
            queue.state.queuedMessages.length
          ) {
            onWaiting(true);
            return;
          }
          attempted = true;
          onWaiting(false);
          // Native send reserves busy synchronously before its first await.
          void owner
            .send({text, discussionTurn: {id, bind}})
            .then(result => {
              if (result?.sent !== true || result?.queued)
                throw Object.assign(Error('主持回合未送出；未重送。'), {notSent: true});
              submitted = true;
              check();
              if (signal?.aborted) void interrupt();
            })
            .catch(error => finish(Object.assign(error, {settled: error.notSent === true})));
          return;
        }
        if (!terminal && !state.busy && ['completed', 'failed', 'interrupted'].includes(state.status)) {
          const messages = state.messages.filter(m => m.groupId === id);
          if (messages.some(m => m.role === 'user'))
            terminal = {
              status: state.status,
              error: state.error,
              text: messages.findLast(m => m.role === 'assistant')?.text ?? ''
            };
        }
        if (terminal && submitted) {
          if (signal?.aborted) finish(signal.reason ?? Error('討論已停止。'));
          else if (terminal.status !== 'completed') finish(Error(terminal.error ?? '主持回合未完成。'));
          else finish(null, terminal.text);
        }
      };
      hostRequest = {check};
      signal?.addEventListener('abort', abort, {once: true});
      check();
    });
  };
  api.send = async data => {
    if (changing) throw Object.assign(Error('正在切換對話。'), {notSent: true});
    if (active.state.busy || queue.state.queuedMessages.length) {
      if (!data.text?.trim() && !data.attachmentIds?.length && roomNotes?.pending(active.state.threadId).length)
        throw Object.assign(
          Error('工作進行中或仍有待送訊息；協調訊息會隨下一則送出帶入，請輸入文字排隊或等工作結束。'),
          {notSent: true}
        );
      return queue.enqueue(data);
    }
    return data.source === 'continuation' ? active.send(data) : sendWithNotes(active, data);
  };
  api.roomNote = async ({id, action}) => {
    if (action !== 'discard') throw Error('未知的協調訊息操作。');
    if (!roomNotes || !active.state.threadId) throw Error('請先開啟對話。');
    return roomNotes.discard(active.state.threadId, id);
  };
  api.queue = async data => {
    if (changing) throw Error('正在切換對話。');
    return queue.action(data);
  };
  api.stop = async () => {
    stopEpoch++;
    await queue.pause();
    return active.stop();
  };
  api.selectWorkspace = async data => {
    if (changing || queue.sending) throw Error('正在切換或送出，請稍候。');
    changing = true;
    try {
      const result = await active.selectWorkspace(data);
      await queue.load(null);
      return result;
    } finally {
      changing = false;
    }
  };
  return api;
}
