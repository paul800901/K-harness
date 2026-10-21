import {createWorkActivity, geminiWorkActivity} from './work-activity.mjs';
import {workerNoticeKey, workerNoticeCurrent, workerNoticeText, workerNeedsAttention} from './worker-watch.mjs';
import {
  mergeGeminiHandoff,
  consumeGeminiHandoff,
  consumeGeminiWaitResult,
  geminiWaitingJobs,
  geminiHandoffText
} from './gemini-handoff.mjs';
import {lunaResult} from './luna-bridge.mjs';
import {approvalRequest} from './desktop-permissions.mjs';
import {quotaZeroUntil, quotaZeroRecheckDue} from './quota-zero.mjs';
import path from 'node:path';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {googleOpsMcp} from './google-ops-mcp.mjs';
import {geminiProjectMcp} from './gemini-project-mcp.mjs';
import {atomicWrite} from './atomic-write.mjs';
import {createGeminiLogin} from './gemini-login.mjs';
import {
  geminiExecutable,
  geminiEnvironment,
  geminiAccessArgs,
  geminiSettings,
  geminiMcpConfig,
  geminiStream,
  geminiWriteTarget,
  geminiProcess,
  geminiOutcome,
  killGeminiTree,
  GEMINI_BROWSER_GUIDANCE,
  geminiToolGuidance,
  GEMINI_MEDIA_GUIDANCE
} from './gemini-worker.mjs';
import {saveMainSession, listMainSessions} from './main-sessions.mjs';
import {validateWorkspace, listWorkspaceDirectories} from './workspaces.mjs';
import {saveAttachment, saveAttachmentStream, readPresentedFile} from './desktop-files.mjs';
import {sessionAttachment, sessionAttachmentSource, sessionArtifact, workspaceGuidance} from './session-workspace.mjs';
import {normalizeWorkerPolicy, workerPolicyConfig, MODEL_ROLE_GUIDANCE} from './worker-policy.mjs';
import {browserSessionKey} from './browser-mcp-config.mjs';

const sessionId = id => typeof id === 'string' && /^gemini-[0-9a-f-]{36}$/iu.test(id);
const nativeId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/iu.test(id);
const access = value => {
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(value))
    throw Error('Gemini 提供唯讀、工作區編輯或完整存取權；未提供互動核准／自動審查。');
  return value;
};
const now = () => new Date().toISOString();
const quota = {status: 'unavailable', windows: [], note: '尚未取得 Antigravity 官方額度。'};
// Native view_file verified on these catalog models; never infer a future model's support.
const mediaModels = new Set(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.1-pro']);
// agy 1.4.3 expands a rule's @[label](path) include (live probe), so one shared file reaches every room's HOME.
const memoryGuidance = (file, accessMode) =>
  `長期記憶：本人糾正做法或要求記住時，先寫出要記的規則並取得本人同意再寫入。只適用本工作區的寫進工作區的 AGENTS.md；跨工作區都適用的寫進 ${file}（各 Gemini 聊天室都會讀到）。不要寫進本聊天室的 ~/.gemini/config，那只屬於這個聊天室。本人也可輸入 /learn。${accessMode === 'read-only' ? '目前唯讀，只寫出建議的規則，由本人決定是否改權限後寫入。' : ''}`;

// Every choice comes from `agy models`, including its supported effort variants.
export function geminiModelsFrom(names) {
  const groups = new Map();
  for (const id of names) {
    if (!/^gemini-[\w.-]+$/u.test(id)) continue;
    const match = id.match(/^(.*)-(low|medium|high|xhigh|max)$/u),
      model = match?.[1] ?? id,
      effort = match?.[2] ?? null;
    let row = groups.get(model);
    if (!row) {
      row = {
        model,
        displayName: model
          .replace(/^gemini-/u, 'Gemini ')
          .replaceAll('-', ' ')
          .replace(/\b(flash|pro)\b/gu, s => s[0].toUpperCase() + s.slice(1)),
        provider: 'gemini',
        available: true,
        inputModalities: mediaModels.has(model) ? ['text', 'image', 'pdf', 'audio', 'video'] : ['text'],
        supportedReasoningEfforts: [],
        defaultReasoningEffort: effort,
        nativeModels: {}
      };
      groups.set(model, row);
    }
    row.nativeModels[effort ?? 'default'] = id;
    if (effort && !row.supportedReasoningEfforts.some(item => item.reasoningEffort === effort))
      row.supportedReasoningEfforts.push({reasoningEffort: effort});
  }
  return [...groups.values()];
}

/** K stores presentation only. agy owns execution, native history and compression. */
export function createGeminiController({
  root,
  geminiExecutable: executable,
  env = process.env,
  run = geminiProcess,
  killTree = killGeminiTree,
  loginFactory = createGeminiLogin,
  accounts,
  onChange = () => {},
  timeoutMs = 0,
  browserConfig = async () => null,
  closeBrowser = async () => {},
  bridgeFactory = null,
  gatewayFactory,
  workerCatalog
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw Error('Gemini timeoutMs 無效。');
  const login = loginFactory({cwd: root, executable, env}),
    binary = geminiExecutable(env, executable);
  let usagePending = null,
    usageAttemptAt = 0;
  const state = {
    provider: 'gemini',
    status: 'idle',
    threadId: null,
    model: null,
    modelDisplayName: null,
    inputModalities: ['text'],
    workspace: root,
    accessMode: 'workspace-write',
    workerPolicy: normalizeWorkerPolicy(),
    title: '',
    effort: null,
    efforts: [],
    lastUsedModel: null,
    modelChanges: [],
    messages: [],
    tools: [],
    artifacts: [],
    workers: [],
    questions: [],
    notices: [],
    reasoning: [],
    turnDiffs: [],
    goal: null,
    busy: false,
    error: null,
    browserAccess: {enabled: false, networkAccess: false},
    capabilities: {
      steer: false,
      goal: true,
      compact: false,
      fileSearch: false,
      review: false,
      turnDiffs: false,
      reasoningSummary: false,
      nativeFork: false
    },
    progress: {
      plan: [],
      explanation: null,
      compaction: 'native',
      compactions: null,
      compactionsComplete: false,
      tokenUsage: null
    },
    usage: {gemini: quota}
  };
  const activity = createWorkActivity(state);
  let record = null,
    selected = null,
    opening = false,
    turn = null,
    persist = Promise.resolve(),
    unresolvedPid = null;
  let browserMode = null,
    browserServer = null;
  async function resetBrowser() {
    if (browserServer)
      try {
        await closeBrowser();
      } catch (error) {
        state.status = 'uncertain';
        state.error = `瀏覽器停止尚未確認：${error.message}`;
        throw error;
      }
    browserMode = null;
    browserServer = null;
    state.browserAccess = {enabled: false, networkAccess: false};
  }
  const changed = () => {
    try {
      onChange(state);
    } catch {}
  };
  const file = id => {
    if (!sessionId(id)) throw Error('Gemini 對話 ID 無效。');
    return path.join(root, '.runtime/gemini-sessions', `${id}.json`);
  };
  const home = () => path.join(root, 'agent-home', 'gemini', 'main', state.threadId);
  const save = activityAt => {
    if (!record) return Promise.resolve();
    const snapshot = structuredClone({
      ...record,
      model: state.model,
      effort: state.effort,
      title: state.title,
      workspace: state.workspace,
      previousWorkspaces: state.previousWorkspaces,
      previousArtifacts: state.previousArtifacts,
      accessMode: state.accessMode,
      workerPolicy: state.workerPolicy,
      workerNotifications,
      goal: state.goal,
      messages: state.messages,
      tools: state.tools,
      artifacts: state.artifacts,
      lastUsedModel: state.lastUsedModel,
      modelChanges: state.modelChanges,
      lastOpenedAt: now()
    });
    record = snapshot;
    const next = persist
      .catch(() => {})
      .then(async () => {
        await atomicWrite(file(snapshot.threadId), JSON.stringify(snapshot, null, 2));
        await saveMainSession(root, snapshot, {activityAt});
      });
    persist = next;
    return next;
  };
  const read = async id => JSON.parse(await readFile(file(id), 'utf8'));
  const idle = () => {
    if (state.busy || opening || unresolvedPid) throw Error('請先結束或查明目前 Gemini 工作。');
  };
  const sharedRules = path.join(root, 'agent-home', 'gemini', 'shared', 'learned-rules.md');
  const insideWorkspace = absolute => {
    const relative = path.relative(state.workspace, absolute);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };

  // K workers (k_luna) for this room, as in the Claude main entry: the bridge owns
  // worker execution; this room records them, delivers each notice at most once and
  // relays worker approvals. Settings never change while a worker is unsettled.
  let bridge = null,
    bridgeInstance = null,
    bridgeInitPromise = null,
    bridgeEpoch = 0,
    gateway = null,
    gatewayKey = null,
    gatewayServer = null,
    gatewayThread = null,
    stops = 0,
    workerInstructions = MODEL_ROLE_GUIDANCE,
    workerNotifications = {},
    notifying = false,
    turnEnds = 0,
    geminiHandoff = null,
    geminiIntentEpoch = 0;
  const workerArmed = new Set(),
    workerQueue = new Map(),
    handoffJobs = new Set(),
    pending = new Map();
  const WORKERS_RUNNING = 'K 子代理尚未結束；待工人完成後再切換對話，或變更權限、工作區、子代理設定。';
  const gatewayKeyOf = (threadId, workspace, accessMode, workerPolicy) =>
    JSON.stringify([threadId ?? null, workspace, accessMode, workerPolicy]);
  const unsettledWorkers = async () =>
    !!bridgeInstance && (await bridgeInstance.list()).some(r => !r.settled && r.executionUnowned !== true);
  const clearQuestions = matches => {
    for (const [id, item] of pending) {
      if (matches && !matches(item)) continue;
      item.resolve(item.cancelValue);
      pending.delete(id);
      state.questions = state.questions.filter(q => q.id !== id);
    }
  };
  function workerApproval(request, item) {
    if (request.method === 'k/claude/requestApproval' && (request.params?.parentId !== state.threadId || opening))
      return undefined;
    const approval = approvalRequest(request, item);
    if (!approval) return undefined;
    const id = randomUUID();
    return new Promise(resolve => {
      pending.set(id, {
        resolve,
        cancelValue: approval.cancel?.() ?? {decision: 'cancel'},
        approval,
        workerRequestId: request.method === 'k/claude/requestApproval' ? request.params?.requestId : undefined
      });
      const {reply, cancel, ...display} = approval;
      state.questions.push({
        id,
        kind: 'approval',
        threadId: state.threadId,
        isSubagent: true,
        ...display,
        provider: 'codex-luna'
      });
      changed();
    });
  }
  const scheduleWorkers = () =>
    queueMicrotask(() => {
      void deliverWorkers();
    });
  const recordWorker = item => {
    if (!item || item.parentId !== state.threadId) return;
    const index = state.workers.findIndex(w => w.requestId === item.requestId);
    if (index < 0) state.workers.push(item);
    else state.workers[index] = item;
    const before = state.artifacts.length;
    for (const name of item.outputFiles ?? []) {
      if (typeof name !== 'string') continue;
      const absolute = path.resolve(state.workspace, name);
      const relative = path.relative(state.workspace, absolute).replaceAll('\\', '/');
      if (insideWorkspace(absolute) && !state.artifacts.includes(relative)) state.artifacts.push(relative);
    }
    if (state.artifacts.length !== before) void save().catch(() => {});
    const queued = workerQueue.get(item.requestId);
    if (queued && !workerNoticeCurrent(queued, item)) workerQueue.delete(item.requestId);
    if (
      workerArmed.has(item.requestId) &&
      !workerNotifications[workerNoticeKey(item)] &&
      (item.settled || workerNeedsAttention(item)) &&
      !opening
    ) {
      workerQueue.set(item.requestId, structuredClone(item));
      scheduleWorkers();
    }
    changed();
  };
  const recordGeminiHandoff = event => {
    if (
      !event ||
      event.parentId !== state.threadId ||
      opening ||
      ['interrupted', 'offline', 'uncertain'].includes(state.status)
    )
      return;
    const requestIds = (event.requestIds ?? []).filter(id => handoffJobs.has(id)),
      queryIds = event.queryIds ?? [];
    if (!requestIds.length && !queryIds.length) return;
    for (const n of state.notices) if (n.kind === 'gemini-handoff') n.resolved = true;
    geminiHandoff = mergeGeminiHandoff(geminiHandoff, {...event, requestIds, queryIds, epoch: geminiIntentEpoch});
    if (['ready', 'blocked'].includes(event.status)) for (const id of requestIds) handoffJobs.delete(id);
    state.notices.push({
      id: randomUUID(),
      kind: 'gemini-handoff',
      level: event.status === 'blocked' ? 'warning' : 'info',
      message:
        event.status === 'waiting'
          ? 'Gemini 正等待現有工作自然結束，再查核帳號額度；未重播原工單。'
          : event.status === 'ready'
            ? 'Gemini 帳號已就緒，待核對本房工人與成果；原工單未重播。'
            : `Gemini 帳號交接未完成：${event.reason ?? '官方額度或停止狀態未確認。'}`,
      createdAt: now()
    });
    if (event.status !== 'waiting') scheduleWorkers();
    changed();
  };
  const cancelGeminiHandoff = () => {
    geminiIntentEpoch++;
    geminiHandoff = null;
    handoffJobs.clear();
    bridgeInstance?.cancelGeminiHandoff?.();
    for (const n of state.notices) if (n.kind === 'gemini-handoff') n.resolved = true;
  };
  // A notice is a new native turn on this conversation. It is marked before sending;
  // a send that may have reached agy is never repeated.
  async function deliverWorkers() {
    let handoff =
      ['ready', 'blocked'].includes(geminiHandoff?.status) && geminiHandoff.epoch === geminiIntentEpoch
        ? geminiHandoff
        : null;
    if (
      notifying ||
      !record ||
      state.busy ||
      opening ||
      unresolvedPid ||
      !['completed', 'ready'].includes(state.status) ||
      (!workerQueue.size && !handoff)
    )
      return;
    // This room's native history stays on its bound account; a ready event for another
    // account cannot continue here, so it is shown once instead of failing a send.
    if (
      handoff?.status === 'ready' &&
      record.accountId &&
      handoff.accountId &&
      handoff.accountId !== record.accountId
    ) {
      geminiHandoff = consumeGeminiHandoff(geminiHandoff, handoff);
      for (const n of state.notices) if (n.kind === 'gemini-handoff') n.resolved = true;
      state.notices.push({
        id: randomUUID(),
        kind: 'gemini-handoff',
        level: 'warning',
        message:
          'Gemini 共用帳號已換成其他帳號；本聊天室的原生歷史綁定原帳號，不能在新帳號接續。剩餘工作請開新的 Gemini 聊天室交接；原工單未重播。',
        createdAt: now()
      });
      handoff = null;
      changed();
    }
    for (const [id, queued] of workerQueue)
      if (
        !workerNoticeCurrent(
          queued,
          state.workers.find(w => w.requestId === id)
        )
      )
        workerQueue.delete(id);
    const waiting = geminiWaitingJobs(geminiHandoff),
      batch = [...workerQueue.values()].filter(row => !waiting.has(row.requestId));
    if (!batch.length && !handoff) return;
    // The account handoff waits for this room's own K workers to end, as in the Claude entry.
    if (handoff && state.workers.some(w => w.settled !== true && w.provider !== 'gemini-native')) return;
    // A stop, close or room switch during preparation ends this delivery unsent.
    const stop = stops,
      thread = state.threadId,
      ends = turnEnds,
      current = () => stop === stops && thread === state.threadId;
    notifying = true;
    let attempted = false,
      notSent = false;
    try {
      for (const row of batch) workerQueue.delete(row.requestId);
      for (const row of batch) if (row.settled) workerArmed.delete(row.requestId);
      const results = await Promise.all(batch.map(lunaResult));
      if (!current()) return;
      for (const row of batch) workerNotifications[workerNoticeKey(row)] = 'delivery-attempted';
      await save();
      if (!current()) {
        for (const row of batch) delete workerNotifications[workerNoticeKey(row)];
        return;
      }
      const text =
        (handoff ? geminiHandoffText(handoff) : '') +
        (batch.length ? workerNoticeText(batch) + JSON.stringify(results) : '');
      const summary = batch.length
        ? `K 子代理${batch.some(row => !row.settled) ? '狀態待確認' : '工作完成'}：${batch.map(row => row.requestId).join('、')}`
        : 'Gemini 帳號排程通知';
      attempted = true;
      await api.send({text}, null, {kind: 'worker-completion', summary});
    } catch (error) {
      notSent = !attempted || error.notSent === true;
      if (notSent) {
        for (const row of batch) {
          delete workerNotifications[workerNoticeKey(row)];
          if (
            workerNoticeCurrent(
              row,
              state.workers.find(w => w.requestId === row.requestId)
            )
          )
            workerQueue.set(row.requestId, row);
        }
        await save().catch(() => {});
        // A user turn that won the race delivers this notice when it ends.
        if (!state.busy) state.error = `K 子代理通知尚未送出；可用 luna_inspect 查詢原 requestId：${error.message}`;
      } else state.error = `K 子代理通知未確認；未重送工作或通知：${error.message}`;
    } finally {
      if (handoff && attempted && !notSent) {
        geminiHandoff = consumeGeminiHandoff(geminiHandoff, handoff);
        if (geminiHandoff?.status !== 'ready')
          for (const n of state.notices) if (n.kind === 'gemini-handoff' && n.level === 'info') n.resolved = true;
      }
      notifying = false;
      changed();
      // A user turn that ended while this delivery held the flag could not schedule it.
      if (notSent && turnEnds !== ends) scheduleWorkers();
    }
  }
  // Rebuilding the gateway for new settings keeps pending notices; stopping (closeWorkers) drops them.
  async function closeGateway() {
    bridgeEpoch++;
    if (bridgeInitPromise) await bridgeInitPromise.catch(() => {});
    const oldGateway = gateway,
      oldBridge = bridge;
    gatewayKey = gatewayServer = null;
    if (oldGateway) await oldGateway.close();
    if (oldBridge) await oldBridge.close();
    gateway = bridge = bridgeInstance = null;
  }
  async function closeWorkers() {
    cancelGeminiHandoff();
    stops++;
    bridgeEpoch++;
    // Cleared before cancelling: a cancelled job must not return as a completion notice.
    workerArmed.clear();
    workerQueue.clear();
    if (bridgeInitPromise) await bridgeInitPromise.catch(() => {});
    if (bridgeInstance) {
      const active = bridgeInstance;
      for (const item of await active.list()) {
        if (item?.settled || item?.executionUnowned === true) continue;
        await active.cancel({requestId: item.requestId});
        const waited = await active.wait({requestId: item.requestId, timeoutMs: 10000});
        const verified = await active.inspect({requestId: item.requestId});
        if (verified?.executionUnowned === true) continue;
        if (!waited?.settled || !verified?.settled) throw Error(`子代理 ${item.requestId} 的停止狀態未確認。`);
      }
    }
    clearQuestions();
    await closeGateway();
  }
  // Returns the k_luna MCP endpoint for this room's current thread, workspace, access and worker policy.
  async function configureGateway() {
    if (!bridgeFactory) return null;
    const key = gatewayKeyOf(state.threadId, state.workspace, state.accessMode, state.workerPolicy);
    if (gateway && gatewayKey === key) return gatewayServer;
    if (await unsettledWorkers()) throw Error(WORKERS_RUNNING);
    // Another conversation's pending notices never reach this one.
    if (gatewayThread !== state.threadId) {
      cancelGeminiHandoff();
      workerArmed.clear();
      workerQueue.clear();
    }
    await closeGateway();
    if (workerCatalog)
      workerInstructions = workerPolicyConfig(state.workerPolicy, {
        models: (await workerCatalog()).models,
        geminiGateway: true,
        claudeGateway: true,
        provider: 'gemini'
      }).developer_instructions;
    const parent = state.threadId,
      epoch = bridgeEpoch,
      options = {
        root,
        workspace: state.workspace,
        parentId: parent,
        accessMode: state.accessMode,
        workerPolicy: structuredClone(state.workerPolicy)
      };
    const ensureBridge = () => {
      if (bridgeInstance) return Promise.resolve(bridgeInstance);
      if (!bridgeInitPromise)
        bridgeInitPromise = Promise.resolve()
          .then(() =>
            bridgeFactory({
              ...options,
              onRequest: workerApproval,
              onChange: recordWorker,
              onGeminiHandoff: event => {
                if (state.threadId === parent && epoch === bridgeEpoch) recordGeminiHandoff(event);
              }
            })
          )
          .then(value => (bridgeInstance = value))
          .finally(() => {
            bridgeInitPromise = null;
          });
      return bridgeInitPromise;
    };
    const disarm = requestId => {
      workerArmed.delete(requestId);
      workerQueue.delete(requestId);
    };
    const lazyBridge = {
      workerPolicy: options.workerPolicy,
      async start(args) {
        workerArmed.add(args.requestId);
        handoffJobs.add(args.requestId);
        return (await ensureBridge()).start(args);
      },
      inspect: args => ensureBridge().then(value => value.inspect(args)),
      reconcile: args => ensureBridge().then(value => value.reconcile(args)),
      wait: args => ensureBridge().then(value => value.wait(args)),
      async cancel(args) {
        disarm(args.requestId);
        const result = await (await ensureBridge()).cancel(args);
        clearQuestions(item => item.workerRequestId === args.requestId);
        changed();
        return result;
      },
      // The gateway acknowledges only after the model-facing result is prepared successfully.
      resultReady(args, result) {
        geminiHandoff = consumeGeminiWaitResult(geminiHandoff, args.requestId, result);
        if (result?.settled) disarm(args.requestId);
        else if (workerNeedsAttention(result ?? {})) {
          workerNotifications[workerNoticeKey(result)] = 'delivery-attempted';
          const queued = workerQueue.get(args.requestId);
          if (queued && workerNoticeKey(queued) === workerNoticeKey(result)) workerQueue.delete(args.requestId);
          void save().catch(() => {});
        }
      },
      list: args => ensureBridge().then(value => value.list(args)),
      accounts: () => ensureBridge().then(value => value.accounts()),
      async close() {
        const value = bridgeInstance ?? (bridgeInitPromise ? await bridgeInitPromise.catch(() => null) : null);
        if (value) {
          await value.close();
          if (bridgeInstance === value) bridgeInstance = null;
        }
      }
    };
    const factory = gatewayFactory ?? (await import('./luna-gateway.mjs')).createLunaGateway;
    gateway = await factory({bridge: lazyBridge});
    bridge = lazyBridge;
    gatewayKey = key;
    gatewayThread = parent;
    const server = gateway.mcpConfig?.mcpServers?.k_luna;
    gatewayServer = server ? {url: server.url, headers: server.headers} : null;
    return gatewayServer;
  }
  function choose(catalog, model, effort) {
    const choice = catalog.find(item => item.model === model);
    if (!choice) throw Error('目前 agy 未提供指定 Gemini 模型；未換模。');
    const level = effort ?? choice.defaultReasoningEffort;
    if (!choice.nativeModels[level ?? 'default']) throw Error('指定 Gemini 推理程度目前不可用；未換模。');
    return {choice, level};
  }
  async function prepare() {
    if (!binary) throw Error('找不到 agy，請安裝 Antigravity CLI 並登入。');
    // First, so a refused settings change (a K worker still running) touches nothing else.
    const lunaServer = await configureGateway();
    if (browserMode !== state.accessMode) {
      await resetBrowser();
      browserServer =
        state.accessMode === 'read-only'
          ? null
          : await browserConfig({
              appRoot: root,
              conversationId: state.threadId,
              accessMode: state.accessMode,
              provider: 'gemini'
            });
      browserMode = state.accessMode;
    }
    const temps = Object.entries(env)
      .filter(([key]) => /^(TEMP|TMP)$/iu.test(key))
      .map(([, value]) => value);
    const googleOps = await googleOpsMcp(state.workspace, {root});
    const projectMcp = await geminiProjectMcp(root, state.workspace, state.accessMode);
    const settings = geminiSettings(state.workspace, state.accessMode, temps, browserServer, googleOps, projectMcp, {
      writable: [sharedRules],
      gateway: !!lunaServer
    });
    // The sandbox's AppContainer data lives under this HOME's LOCALAPPDATA (geminiEnvironment).
    await mkdir(path.join(home(), 'AppData', 'Local'), {recursive: true});
    await mkdir(path.dirname(sharedRules), {recursive: true});
    await writeFile(sharedRules, '# K 共用學習規則（各 Gemini 聊天室共用）\n', {flag: 'wx'}).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
    await atomicWrite(
      path.join(home(), '.gemini/config/mcp_config.json'),
      JSON.stringify(geminiMcpConfig(browserServer, googleOps, projectMcp, lunaServer), null, 2)
    );
    await atomicWrite(path.join(home(), '.gemini/antigravity-cli/settings.json'), JSON.stringify(settings, null, 2));
    await atomicWrite(
      path.join(home(), '.gemini/config/rules/k-model-roles.md'),
      `---\ntrigger: always_on\n---\n${workerInstructions}\n${geminiToolGuidance(state.accessMode, googleOps)}\n${memoryGuidance(sharedRules, state.accessMode)}\n${state.inputModalities.includes('audio') ? GEMINI_MEDIA_GUIDANCE + '\n' : ''}${workspaceGuidance(state)}${browserServer ? `${GEMINI_BROWSER_GUIDANCE}\n` : ''}@[K 共用學習規則](${sharedRules})\n`
    );
    state.browserAccess = {
      enabled: !!browserServer,
      networkAccess: !!browserServer,
      sessionKey: browserSessionKey(browserServer)
    };
  }
  const api = {
    state,
    async models() {
      const inspect = () => login.status({checkAuth: false}),
        result = await (accounts ? accounts.inspect(inspect) : inspect());
      if (!result.available) throw Error(result.reason);
      return {models: geminiModelsFrom(result.models), provider: 'gemini', version: result.version};
    },
    async usage(refresh = false) {
      if (accounts) {
        const managed = await accounts.usage(refresh);
        if (managed) {
          state.usage.gemini = managed;
          return {gemini: managed};
        }
      }
      if (usagePending) return usagePending;
      if (!refresh && quotaZeroUntil(state.usage.gemini)) return {gemini: state.usage.gemini};
      if (!refresh && !quotaZeroRecheckDue(state.usage.gemini) && Date.now() - usageAttemptAt < 60000)
        return {gemini: state.usage.gemini};
      usageAttemptAt = Date.now();
      usagePending = (async () => {
        let result;
        try {
          result = await (accounts ? accounts.inspect(() => login.status()) : login.status());
        } catch {
          result = {reason: '官方額度查詢失敗，請稍後刷新。'};
        }
        state.usage.gemini = result.quota ?? {
          ...state.usage.gemini,
          status: state.usage.gemini.windows?.length ? 'stale' : 'unavailable',
          note: result.reason ?? '無法取得官方額度。'
        };
        onChange();
        return {gemini: state.usage.gemini};
      })();
      try {
        return await usagePending;
      } finally {
        usagePending = null;
      }
    },
    async workers() {
      if (bridgeInstance) for (const item of await bridgeInstance.list()) recordWorker(item);
      if (geminiHandoff?.status === 'ready') scheduleWorkers();
      return structuredClone(state.workers);
    },
    async directories(parent = state.workspace) {
      return listWorkspaceDirectories(parent);
    },
    async selectWorkspace({path: requested}) {
      idle();
      const workspace = await validateWorkspace(requested);
      await persist;
      if (await unsettledWorkers()) throw Error('K 子代理尚未結束；待工人完成後再切換工作區。');
      await closeWorkers();
      await resetBrowser();
      state.workspace = workspace;
      state.threadId = null;
      state.title = '';
      state.messages = [];
      state.tools = [];
      state.artifacts = [];
      state.workers = [];
      state.status = 'idle';
      state.error = null;
      record = null;
      changed();
      return {workspace};
    },
    async open(
      {threadId, model, effort, accessMode = 'workspace-write', permissionConfirmed = false, workerPolicy} = {},
      {signal, relocation, onHistory} = {}
    ) {
      idle();
      activity.clear();
      opening = true;
      let previousBrowserClosed = false;
      const originalWorkspace = relocation
        ? {
            workspace: state.workspace,
            previousWorkspaces: state.previousWorkspaces,
            previousArtifacts: state.previousArtifacts,
            artifacts: state.artifacts
          }
        : null;
      try {
        await persist;
        signal?.throwIfAborted();
        const saved = threadId ? await read(threadId) : null;
        if (saved && (saved.threadId !== threadId || saved.model !== model))
          throw Error('對話設定已更新，請重新整理清單。');
        if (saved?.nativeStarted && !nativeId(saved.nativeSessionId))
          throw Error('上次 Gemini 送出後尚未取得原生對話 ID；不能自動建立新對話或重送。');
        const {choice, level} = choose((await api.models()).models, model, effort ?? saved?.effort),
          mode = access(saved?.accessMode ?? accessMode);
        if (!saved && mode === 'danger-full-access' && !permissionConfirmed)
          throw Error('請明確確認 Gemini 完整存取權。');
        const common = threadId ? (await listMainSessions(root, {threadId})).sessions[0] : null;
        const workspace = await validateWorkspace(
          relocation?.workspace ?? common?.workspace ?? saved?.workspace ?? state.workspace
        );
        signal?.throwIfAborted();
        const policy = normalizeWorkerPolicy(workerPolicy ?? saved?.workerPolicy ?? common?.workerPolicy);
        // Refuse before touching the room: a running K worker keeps its gateway and settings.
        if (
          gateway &&
          gatewayKey !== gatewayKeyOf(saved?.threadId, workspace, mode, policy) &&
          (await unsettledWorkers())
        )
          throw Error(WORKERS_RUNNING);
        await resetBrowser();
        previousBrowserClosed = true;
        selected = choice;
        record = saved ?? {
          threadId: `gemini-${randomUUID()}`,
          nativeSessionId: null,
          nativeStarted: false,
          archived: false,
          pinned: false,
          createdAt: now()
        };
        Object.assign(state, {
          threadId: record.threadId,
          workspace,
          model,
          modelDisplayName: choice.displayName,
          inputModalities: [...choice.inputModalities],
          effort: level,
          efforts: choice.supportedReasoningEfforts.map(e => e.reasoningEffort),
          accessMode: mode,
          title: record.title ?? '',
          messages: record.messages ?? [],
          tools: record.tools ?? [],
          artifacts: record.artifacts ?? [],
          lastUsedModel: record.lastUsedModel ?? null,
          modelChanges: record.modelChanges ?? [],
          status: 'ready',
          error: null,
          busy: false,
          workers: [],
          workerPolicy: policy
        });
        workerNotifications = structuredClone(saved?.workerNotifications ?? {});
        state.previousWorkspaces = relocation?.previousWorkspaces ?? common?.previousWorkspaces ?? [];
        state.previousArtifacts = relocation?.previousArtifacts ?? common?.previousArtifacts ?? [];
        state.artifacts = relocation
          ? [...state.previousArtifacts]
          : [...new Set([...state.previousArtifacts, ...state.artifacts])];
        state.goal = record.goal
          ? {...record.goal, ...(['active', 'starting'].includes(record.goal.status) ? {status: 'unknown'} : {})}
          : null;
        await onHistory?.(state);
        signal?.throwIfAborted();
        await prepare();
        if (bridgeInstance) for (const item of await bridgeInstance.list()) recordWorker(item);
        signal?.throwIfAborted();
        await save();
        changed();
        return {threadId: state.threadId};
      } catch (error) {
        if (originalWorkspace) Object.assign(state, originalWorkspace);
        if (previousBrowserClosed) {
          state.status = relocation ? 'error' : 'failed';
          state.error = error.message;
          await resetBrowser();
        }
        throw error;
      } finally {
        opening = false;
      }
    },
    async selectModel({threadId, model, effort}) {
      idle();
      if (!record || threadId !== state.threadId) throw Error('Gemini 對話已切換。');
      const {choice, level} = choose((await api.models()).models, model, effort);
      selected = choice;
      state.model = model;
      state.modelDisplayName = choice.displayName;
      state.inputModalities = [...choice.inputModalities];
      state.effort = level;
      state.efforts = choice.supportedReasoningEfforts.map(e => e.reasoningEffort);
      await save();
      changed();
      return {threadId, model, effort: level};
    },
    async metadata({threadId, title, archived, pinned}) {
      if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 120))
        throw Error('標題須為 1–120 字元。');
      if (
        (archived !== undefined && typeof archived !== 'boolean') ||
        (pinned !== undefined && typeof pinned !== 'boolean')
      )
        throw Error('封存或釘選狀態無效。');
      await persist;
      const saved = await read(threadId),
        updated = {
          ...saved,
          ...(title === undefined ? {} : {title: title.trim()}),
          ...(archived === undefined ? {} : {archived}),
          ...(pinned === undefined ? {} : {pinned})
        };
      if (threadId === state.threadId) {
        record = {...record, title: updated.title, archived: updated.archived, pinned: updated.pinned};
        state.title = updated.title;
        await save();
        changed();
      } else {
        await atomicWrite(file(threadId), JSON.stringify(updated, null, 2));
        await saveMainSession(root, updated);
      }
      return {threadId, title: updated.title, archived: updated.archived, pinned: updated.pinned};
    },
    async upload(data) {
      if (!record || data.threadId !== state.threadId) throw Error('對話已切換，請重新加入附件。');
      const threadId = state.threadId,
        workspace = state.workspace;
      return saveAttachment(workspace, threadId, data, {inputModalities: state.inputModalities});
    },
    async uploadStream(data, stream) {
      if (!record || data.threadId !== state.threadId) throw Error('對話已切換，請重新加入附件。');
      const threadId = state.threadId,
        workspace = state.workspace;
      return saveAttachmentStream(workspace, threadId, {...data, stream}, {inputModalities: state.inputModalities});
    },
    async attachmentFile(id) {
      const item = await sessionAttachment(state.workspace, state.previousWorkspaces, state.threadId, id);
      return {...(await readPresentedFile(item.workspace, item.path)), name: item.name};
    },
    async attachmentSource(id, context = {}) {
      if (context.threadId && context.threadId !== state.threadId)
        throw new Error('聊天室已切換，請回到原對話下載附件。');
      return sessionAttachmentSource(state.workspace, state.previousWorkspaces, state.threadId, id);
    },
    async artifact(name) {
      if (!state.artifacts.includes(name)) throw Error('只開啟本對話已記錄的成果。');
      return sessionArtifact(state.workspace, state.previousWorkspaces, name);
    },
    // `internal` marks a K event turn (worker notice); it is not a user message.
    async send(
      {text = '', attachmentIds = [], accessMode, effort, permissionConfirmed = false, discussionTurn} = {},
      goalObjective = null,
      internal = null
    ) {
      let attempted = false;
      // agy takes the prompt on its command line (32,767 chars), where quoting can double
      // quotes and backslashes; keep a K notice well inside that limit.
      if (internal && text.length > 14000)
        text = text.slice(0, 14000) + '\n…（通知過長已截斷；完整結果請用 luna_inspect 查詢原 requestId）';
      try {
        idle();
        if (!record || !['ready', 'completed', 'failed', 'interrupted'].includes(state.status))
          throw Error('請先開啟 Gemini 對話。');
        if (record.nativeStarted && !nativeId(record.nativeSessionId))
          throw Error('前次送出後沒有原生對話 ID；請先查明，不會重送或另開原生對話。');
        if (
          typeof text !== 'string' ||
          text.length > 32000 ||
          (!text.trim() && (!Array.isArray(attachmentIds) || !attachmentIds.length))
        )
          throw Error('請輸入 1–32000 字元的訊息。');
        if (!Array.isArray(attachmentIds) || attachmentIds.some(id => typeof id !== 'string'))
          throw Error('附件格式無效。');
        const mode = access(accessMode ?? state.accessMode),
          level = effort || state.effort;
        if (!selected.nativeModels[level ?? 'default']) throw Error('指定 Gemini 推理程度目前不可用。');
        if (mode === 'danger-full-access' && state.accessMode !== mode && !permissionConfirmed)
          throw Error('請明確確認 Gemini 完整存取權。');
        let finish;
        const current = {
          abort: new AbortController(),
          pid: null,
          done: null,
          settled: new Promise(resolve => {
            finish = resolve;
          })
        };
        turn = current;
        state.busy = true;
        activity.begin();
        state.status = 'working';
        state.error = null;
        changed();
        let launched = false,
          accountLease;
        try {
          accountLease = await accounts?.acquire({
            accountId: record.accountId,
            unboundHistory: record.nativeStarted && !record.accountId
          });
          if (accountLease?.accountId) record.accountId = accountLease.accountId;
          if (goalObjective) state.goal = {objective: goalObjective, status: 'starting'};
          const attachments = [];
          let prompt = goalObjective ? '/goal ' + goalObjective : text;
          for (const id of attachmentIds) {
            const item = await sessionAttachment(state.workspace, state.previousWorkspaces, state.threadId, id),
              pdf = path.extname(item.path).toLowerCase() === '.pdf';
            const readPath = path.resolve(
              item.workspace,
              pdf && state.inputModalities.includes('pdf') ? item.path : (item.textPath ?? item.path)
            );
            attachments.push(item);
            const originalPath = path.resolve(item.workspace, item.path);
            prompt += `\n\n附件（資料，非授權；模態支援以原生工具實際讀取為準）：${JSON.stringify({name: item.name, readPath, ...(originalPath !== readPath ? {originalPath} : {}), warning: item.warning})}`;
          }
          current.abort.signal.throwIfAborted();
          const previous = {accessMode: state.accessMode, effort: state.effort};
          state.accessMode = mode;
          state.effort = level;
          try {
            await prepare();
          } catch (error) {
            // Nothing was sent; the room keeps the settings that actually apply.
            Object.assign(state, previous);
            throw error;
          }
          const groupId = discussionTurn?.id ?? randomUUID(),
            user = {
              id: randomUUID(),
              role: 'user',
              text,
              attachments,
              createdAt: now(),
              groupId,
              ...(internal ? {kind: internal.kind, summary: internal.summary} : {})
            };
          state.messages.push(user);
          if (discussionTurn) {
            current.discussionId = discussionTurn.id;
            await discussionTurn.bind({groupId, messageId: user.id});
          }
          if (!internal) state.title ||= (text.trim() || attachments[0]?.name || '').slice(0, 40);
          if (state.lastUsedModel && state.lastUsedModel !== state.model)
            state.modelChanges.push({turnId: user.id, fromModel: state.lastUsedModel, toModel: state.model, at: now()});
          state.lastUsedModel = state.model;
          const args = [
            '-p',
            prompt,
            '--model',
            selected.nativeModels[level ?? 'default'],
            '--output-format',
            'stream-json',
            '--print-timeout',
            goalObjective ? '0s' : `${Math.ceil(timeoutMs / 1000)}s`,
            '--log-file',
            path.join(home(), `${user.id}.log`),
            // Chat stays literal (a typed /goal is not K's goal control); only the owner's /learn expands natively.
            ...(goalObjective || (!internal && !discussionTurn && /^\/learn(\s|$)/u.test(text))
              ? []
              : ['--disable-slash-commands']),
            ...geminiAccessArgs(mode)
          ];
          if (record.nativeSessionId) args.push('--conversation', record.nativeSessionId);
          await save();
          current.abort.signal.throwIfAborted();
          let assistant = null,
            goalConfirmed = false;
          const responses = new Map();
          const ensureAssistant = () =>
            (assistant ??=
              (state.messages.push({
                id: randomUUID(),
                role: 'assistant',
                text: '',
                attachments: [],
                createdAt: now(),
                groupId,
                streaming: true
              }),
              state.messages.at(-1)));
          const parser = geminiStream(event => {
            if (turn === current && !current.abort.signal.aborted) geminiWorkActivity(activity, event);
            if (
              goalObjective &&
              event.event === 'init' &&
              event.init?.expanded_commands?.some(c => c.name === 'goal' && c.type === 'system')
            ) {
              goalConfirmed = true;
              state.goal.status = 'active';
            }
            const id = event.conversation_id ?? event.init?.conversation_id ?? event.result?.conversation_id;
            if (nativeId(id) && !record.nativeSessionId) {
              record.nativeSessionId = id;
              void save().catch(error => {
                state.error = `原生對話 ID 保存失敗：${error.message}`;
              });
            }
            const step = event.step_update;
            // agy 1.4.3 reports invoke_subagent with subagent_info; the subagent lives inside this turn.
            if (step?.step_type === 'subagent')
              for (const info of step.subagent_info?.subagents ?? []) {
                const requestId = `gemini-native:${info.conversation_id}`;
                if (!nativeId(info.conversation_id) || state.workers.some(w => w.requestId === requestId)) continue;
                state.workers.push({
                  provider: 'gemini-native',
                  requestId,
                  nativeConversationId: info.conversation_id,
                  name: info.role || info.type_name || 'agy 原生子代理',
                  task: typeof info.initial_prompt === 'string' ? info.initial_prompt.slice(0, 2000) : '',
                  status: 'running',
                  settled: false,
                  startedAt: now(),
                  turnId: user.id
                });
              }
            if (step?.step_type === 'agent_response' && typeof step.text_delta === 'string') {
              const key = step.step_index;
              responses.set(key, (responses.get(key) ?? '') + step.text_delta);
              ensureAssistant().text = [...responses.values()].join('\n');
            }
            if (step?.tool_info) {
              const key = `${user.id}-${step.step_index}`,
                info = step.tool_info,
                entry = {
                  id: key,
                  kind: info.name ?? 'tool',
                  name: info.name ?? 'tool',
                  status: info.error ? 'failed' : step.state === 'DONE' ? 'completed' : 'running',
                  details: info.parameters ?? {},
                  error: info.error ?? null
                };
              const index = state.tools.findIndex(t => t.id === key);
              if (index < 0) state.tools.push(entry);
              else state.tools[index] = {...state.tools[index], ...entry};
              const target = geminiWriteTarget(step);
              if (typeof target === 'string') {
                const absolute = path.resolve(state.workspace, target),
                  name = path.relative(state.workspace, absolute).replaceAll('\\', '/');
                if (insideWorkspace(absolute) && !state.artifacts.includes(name)) state.artifacts.push(name);
              }
            }
            const usage = event.result?.usage ?? step?.usage;
            if (Number.isFinite(usage?.total_tokens))
              state.progress.tokenUsage = {
                last: {
                  totalTokens: usage.total_tokens,
                  inputTokens: usage.input_tokens,
                  outputTokens: usage.output_tokens
                }
              };
            changed();
          });
          record.nativeStarted = true;
          await save();
          current.abort.signal.throwIfAborted();
          launched = true;
          attempted = true;
          current.done = (async () => {
            try {
              const result = await run(binary, args, {
                  cwd: state.workspace,
                  env: geminiEnvironment(env, home()),
                  signal: current.abort.signal,
                  timeoutMs: goalObjective ? 0 : timeoutMs,
                  captureOutput: false,
                  killTree,
                  onStart: pid => {
                    current.pid = pid;
                    void save(user.createdAt).catch(error => {
                      state.error = `對話活動時間保存失敗：${error.message}`;
                      changed();
                    });
                  },
                  onChunk: chunk => parser.write(chunk)
                }),
                outcome = geminiOutcome(parser.end(), result);
              if (outcome.output)
                ensureAssistant().text = goalConfirmed
                  ? outcome.output.replace(/<!-- GOAL_COMPLETE -->/g, '').trim()
                  : outcome.output;
              if (goalObjective)
                state.goal = {
                  ...state.goal,
                  status:
                    outcome.settled === false
                      ? 'unknown'
                      : outcome.status === 'cancelled'
                        ? 'interrupted'
                        : outcome.status !== 'completed'
                          ? 'failed'
                          : goalConfirmed && outcome.output.includes('<!-- GOAL_COMPLETE -->')
                            ? 'complete'
                            : 'ended'
                };
              if (outcome.settled === false) {
                unresolvedPid = current.pid;
                state.status = 'uncertain';
              } else state.status = outcome.status === 'cancelled' ? 'interrupted' : outcome.status;
              state.error = outcome.status === 'cancelled' ? null : (outcome.error ?? null);
              if (!record.nativeSessionId && result.code === 0) {
                state.status = 'uncertain';
                state.error = 'agy 沒有回傳原生對話 ID；不能自動重送。';
              }
            } catch (error) {
              if (!current.pid && !record.nativeSessionId) record.nativeStarted = false;
              state.status = 'failed';
              state.error = error.message;
              if (goalObjective) state.goal.status = 'unknown';
            } finally {
              if (assistant) {
                delete assistant.streaming;
                if (state.status !== 'completed') assistant.partial = true;
              }
              for (const tool of state.tools) if (tool.status === 'running') tool.status = 'interrupted';
              // Native subagents end with the agy process; the stream does not report each result.
              for (const worker of state.workers)
                if (worker.provider === 'gemini-native' && worker.turnId === user.id && !worker.settled)
                  Object.assign(
                    worker,
                    unresolvedPid ? {status: 'unresolved'} : {status: 'ended', settled: true, endedAt: now()}
                  );
              try {
                await save(assistant ? now() : undefined);
              } catch (error) {
                state.status = 'uncertain';
                state.error = `對話保存失敗；未重送：${error.message}`;
              }
              try {
                await accountLease?.release({settled: !unresolvedPid, refresh: true});
              } catch {
                state.status = 'uncertain';
                state.error = 'Gemini 帳號狀態保存失敗；原工作未重送。';
              }
              state.busy = false;
              turn = null;
              finish();
              changed();
              turnEnds++;
              scheduleWorkers();
            }
          })();
          return {sent: true};
        } catch (error) {
          if (!launched) {
            if (goalObjective && state.goal?.objective === goalObjective) state.goal.status = 'failed';
            await accountLease?.release();
            if (!record.nativeSessionId) {
              record.nativeStarted = false;
              await save().catch(() => {});
            }
            state.busy = false;
            state.status = current.abort.signal.aborted ? 'interrupted' : 'failed';
            state.error = error.message;
            turn = null;
            finish();
            changed();
          }
          throw error;
        }
      } catch (error) {
        if (!attempted) error.notSent = true;
        throw error;
      }
    },
    async interruptDiscussion(id) {
      const current = turn;
      if (!current) return;
      if (current.discussionId !== id) throw Error('主持回合歸屬已改變；未中止其他工作。');
      current.abort.abort();
      await current.settled;
      if (unresolvedPid) throw Error('主持回合程序停止未確認。');
    },
    async stop() {
      const current = turn;
      current?.abort.abort();
      if (current) await current.settled;
      if (unresolvedPid) {
        await killTree(unresolvedPid);
        unresolvedPid = null;
        // Native subagents lived inside that confirmed-ended agy process.
        for (const worker of state.workers)
          if (worker.provider === 'gemini-native' && !worker.settled)
            Object.assign(worker, {status: 'ended', settled: true, endedAt: now()});
        state.status = 'interrupted';
        state.error = null;
      }
      await resetBrowser();
      if (current && state.status !== 'uncertain') state.status = 'interrupted';
      // As in the Claude entry, stopping the room also stops its K workers.
      try {
        await closeWorkers();
      } catch (error) {
        state.status = 'uncertain';
        state.error = error.message;
        changed();
        throw error;
      }
      changed();
      return {stopped: true};
    },
    async close() {
      await api.stop();
      await persist;
      state.status = 'offline';
      changed();
    },
    async steer() {
      throw Error('Gemini 執行中請使用待送佇列；此接法不支援立即送入。');
    },
    async compact() {
      throw Error('Gemini 由原生核心管理上下文；目前沒有手動壓縮介面。');
    },
    async goal({objective, clear = false, refresh = false, editOnly = false} = {}) {
      if (editOnly) throw Error('目前 Gemini 原生介面不支援只修改目標文字；未重新啟動工作。');
      idle();
      if (!record) throw Error('請先開啟 Gemini 對話。');
      if (refresh) return {goal: structuredClone(state.goal)};
      if (clear) {
        state.goal = null;
        await save();
        changed();
        return {goal: null};
      }
      if (typeof objective !== 'string' || !objective.trim() || objective.length > 32000)
        throw Error('請輸入完整目標（最多 32000 字元）。');
      return api.send({text: objective.trim()}, objective.trim());
    },
    // Only K worker approvals reach here; agy itself denies what it cannot ask in headless mode.
    async answer({id, accept} = {}) {
      const item = pending.get(id);
      if (!item) throw Error('核准請求已失效或已回答；Gemini 本身的操作不提供互動核准。');
      if (typeof accept !== 'boolean') throw Error('核准狀態無效。');
      pending.delete(id);
      state.questions = state.questions.filter(q => q.id !== id);
      item.resolve(item.approval.reply(accept));
      changed();
      return {answered: true};
    },
    async fork() {
      throw Error('Gemini 尚未接入原生分支；可明確交接到其他供應商的新對話。');
    }
  };
  return api;
}
