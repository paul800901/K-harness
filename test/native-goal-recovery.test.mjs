import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {listMainSessions} from '../src/main-sessions.mjs';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {codexQuota} from '../src/usage.mjs';
import {scratchBase} from './scratch.mjs';
const error = {
  message: 'fixture native remote compact terminal error',
  codexErrorInfo: 'other',
  additionalDetails: null
};
const rateError = {
  message: 'exceeded retry limit, last status: 429 Too Many Requests',
  codexErrorInfo: {responseTooManyFailedAttempts: {httpStatusCode: 429}},
  additionalDetails: null,
  misalignment: null
};
async function fixture({
  budget = null,
  status = 'active',
  reject,
  alias = false,
  persistGate = false,
  rateCooldownMs,
  onContinueConversation,
  responseFirst = false
} = {}) {
  const base = scratchBase;
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'goal-recovery-'));
  const calls = [],
    children = new Map();
  let hooks,
    gateway,
    bridgeHooks,
    flashRows = [],
    close,
    seq = 0,
    starts = 0,
    gate,
    goalGate,
    deliveryGate,
    rejectGate,
    readFailure = false,
    background = false,
    synchronousAuditFailure = false;
  let goal = {
    threadId: 'parent',
    objective: 'Complete remaining fake work',
    status,
    tokenBudget: budget,
    tokensUsed: 12,
    timeUsedSeconds: 1,
    createdAt: 101,
    updatedAt: 102
  };
  let parent = {id: 'parent', status: {type: 'idle'}, historyMode: 'paginated', turns: []};
  const emit = (method, params = {}, id = parent.id) => hooks.onEvent({method, params: {threadId: id, ...params}});
  const host = {
    closed: new Promise(r => (close = r)),
    notify() {},
    waitForMcp: async () => {},
    close: async () => close(),
    async request(method, p) {
      calls.push({method, p: structuredClone(p)});
      if (method === 'account/read') return {account: {type: 'chatgpt'}};
      if (method === 'model/list')
        return {
          data: [
            {
              model: 'gpt-6-astra',
              supportedReasoningEfforts: [{reasoningEffort: 'high'}],
              defaultReasoningEffort: 'high'
            }
          ]
        };
      if (method === 'thread/start' || method === 'thread/resume') {
        starts++;
        if (alias && starts > 1) {
          parent.id = 'parent-native';
          goal.threadId = parent.id;
        }
        return {thread: {id: parent.id}};
      }
      if (method === 'thread/goal/get') {
        if (goalGate) await goalGate;
        return {goal: structuredClone(goal)};
      }
      if (method === 'thread/goal/set') {
        if (!goal)
          goal = {
            threadId: parent.id,
            objective: p.objective,
            status: 'active',
            tokenBudget: null,
            tokensUsed: 0,
            timeUsedSeconds: 0,
            createdAt: 303,
            updatedAt: 303
          };
        for (const k of ['status', 'objective', 'tokenBudget']) if (Object.hasOwn(p, k)) goal[k] = p[k];
        emit('thread/goal/updated', {goal: structuredClone(goal)});
        return {goal: structuredClone(goal)};
      }
      if (method === 'thread/goal/clear') {
        goal = null;
        emit('thread/goal/cleared');
        return {cleared: true};
      }
      if (method === 'thread/read') {
        if (gate) await gate;
        if (readFailure) throw Error('fixture unknown');
        return {thread: structuredClone(children.get(p.threadId) ?? parent)};
      }
      if (method === 'thread/turns/list')
        return {data: structuredClone((children.get(p.threadId) ?? parent).turns.slice(-1)), nextCursor: null};
      if (method === 'thread/loaded/list')
        return {
          data: [
            parent.id,
            ...Array.from(children.values())
              .filter(x => x.status.type !== 'notLoaded')
              .map(x => x.id)
          ],
          nextCursor: null
        };
      if (method === 'thread/backgroundTerminals/clean') {
        background = false;
        return {};
      }
      if (
        method === 'thread/backgroundTerminals/list' &&
        (children.get(p.threadId)?.status.type === 'notLoaded' ||
          (p.threadId === parent.id && parent.status?.type === 'notLoaded'))
      )
        throw Error('thread not found');
      if (method === 'thread/backgroundTerminals/list')
        return {data: background ? [{id: 'still-running'}] : [], nextCursor: null};
      if (method === 'turn/start') {
        if (p.toolOutput && reject) {
          if (rejectGate) await rejectGate;
          throw reject;
        }
        const id = 'turn-' + ++seq;
        parent.status = {type: 'active'};
        parent.turns.push({id, status: 'inProgress', items: []});
        if (!responseFirst || p.toolOutput) emit('turn/started', {turn: {id}});
        if (p.toolOutput && synchronousAuditFailure) {
          end();
          emit('thread/goal/updated', {goal: structuredClone(goal)});
        }
        if (p.toolOutput && deliveryGate) await deliveryGate;
        return {turn: {id}};
      }
      if (method === 'turn/interrupt') {
        parent.status = {type: 'idle'};
        emit('turn/completed', {turn: {id: p.turnId, status: 'interrupted'}});
      }
      if (method === 'turn/steer') return {turnId: p.expectedTurnId};
      return {};
    }
  };
  let creator = createDesktopController,
    disk;
  if (rateCooldownMs !== undefined) {
    const sourceURL = new URL('../src/desktop-controller.mjs', import.meta.url);
    let source = (await readFile(sourceURL, 'utf8')).replaceAll('\r\n', '\n');
    assert.equal(source.split('const rateRecoveryDelay = 30000;').length - 1, 1);
    source = source
      .replace('const rateRecoveryDelay = 30000;', `const rateRecoveryDelay = ${rateCooldownMs};`)
      .replace(/from '(\.\/[^']+)'/g, (_m, relative) => `from '${new URL(relative, sourceURL).href}'`);
    const injected = path.join(root, 'short-rate-cooldown-controller.mjs');
    await writeFile(injected, source);
    creator = (await import(pathToFileURL(injected).href)).createDesktopController;
  }
  if (persistGate) {
    // Exact await fault injection into the real current source, not an unmodified-native claim.
    const sourceURL = new URL('../src/desktop-controller.mjs', import.meta.url),
      needle = '      await persistFlashNotifications();\n      if (!current()) return;';
    let source = (await readFile(sourceURL, 'utf8')).replaceAll('\r\n', '\n');
    assert.equal(source.split(needle).length - 1, 1);
    const gatePath = path.join(root, 'persist-gate.mjs');
    await writeFile(
      gatePath,
      `let armed=false;export const entered=Promise.withResolvers(),release=Promise.withResolvers();export const arm=()=>armed=true;export async function hold(){if(armed){armed=false;entered.resolve();await release.promise;}}`
    );
    disk = await import(pathToFileURL(gatePath).href);
    source = source
      .replace(/from '(\.\/[^']+)'/g, (_m, relative) => `from '${new URL(relative, sourceURL).href}'`)
      .replace(needle, needle.replace('\n      if', '\n      await hold();\n      if'));
    const gated = path.join(root, 'gated-controller.mjs');
    await writeFile(gated, `import {hold} from '${pathToFileURL(gatePath).href}';\n` + source);
    creator = (await import(pathToFileURL(gated).href)).createDesktopController;
  }
  const c = creator({
    root,
    onContinueConversation,
    executable: 'fake-never-spawn',
    hostFactory: o => {
      hooks = o;
      host.closed = new Promise(r => (close = r));
      return host;
    },
    bridgeFactory: async o => {
      bridgeHooks = o;
      return {
        start: async () => ({status: 'running'}),
        cancel: async () => ({status: 'cancelled', settled: true}),
        list: async () => flashRows,
        close: async () => {},
        cancelGeminiHandoff() {
          calls.push({method: 'cancelGeminiHandoff'});
        }
      };
    },
    gatewayFactory: async o => {
      gateway = o;
      return {
        mcpConfig: {mcpServers: {k_gemini: {url: 'http://127.0.0.1:1/never', headers: {Authorization: 'Bearer fake'}}}},
        close: async () => {}
      };
    }
  });
  await c.open({model: 'gpt-6-astra', effort: 'high'});
  if (alias) {
    await c.close();
    await c.open({threadId: 'parent', model: 'gpt-6-astra', effort: 'high'});
    await c.goal({status: 'active'});
  }
  await c.send({text: 'new fake work'});
  if (responseFirst) {
    await new Promise(r => setTimeout(r, 10));
    emit('turn/started', {turn: {id: parent.turns.at(-1).id}});
  }
  const end = (status = 'failed', err = error, block = true, nativeStatus = 'idle') => {
    const t = parent.turns.at(-1);
    t.status = status;
    parent.status = {type: nativeStatus};
    if (nativeStatus === 'systemError') {
      emit('thread/status/changed', {status: structuredClone(parent.status)});
      emit('error', {turnId: t.id, error: err, willRetry: false});
    }
    if (block && status === 'failed' && goal?.status === 'active') {
      goal.status = 'blocked';
      emit('thread/goal/updated', {turnId: t.id, goal: structuredClone(goal)});
    }
    emit('turn/completed', {turn: {id: t.id, status, ...(status === 'failed' ? {error: err} : {})}});
  };
  const child = () => {
    children.set('child', {
      id: 'child',
      parentThreadId: 'parent',
      historyMode: 'paginated',
      status: {type: 'active'},
      turns: [{id: 'child-turn', status: 'inProgress'}]
    });
    emit('item/started', {
      item: {type: 'subAgentActivity', id: 'spawn-child', kind: 'started', agentThreadId: 'child'}
    });
    emit('turn/started', {turn: {id: 'child-turn'}}, 'child');
  };
  const unloadedChildren = async n => {
    for (let i = 0; i < n; i++) {
      const id = 'old-child-' + i;
      children.set(id, {
        id,
        parentThreadId: 'parent',
        historyMode: 'paginated',
        status: {type: 'notLoaded'},
        turns: [{id: id + '-turn', status: 'completed'}]
      });
      emit('item/started', {item: {type: 'subAgentActivity', id: 'spawn-' + id, kind: 'started', agentThreadId: id}});
    }
    await c.workers();
  };
  const blockGoal = () => {
    goal.status = 'blocked';
    emit('thread/goal/updated', {goal: structuredClone(goal)});
  };
  const nativeStart = (activate = true) => {
    if (activate) {
      goal.status = 'active';
      emit('thread/goal/updated', {goal: structuredClone(goal)});
    }
    const id = 'turn-' + ++seq;
    parent.status = {type: 'active'};
    parent.turns.push({id, status: 'inProgress', items: []});
    emit('turn/started', {turn: {id}});
  };
  const finishChild = (status = 'completed', nativeStatus = 'idle') => {
    const row = children.get('child');
    row.status = {type: nativeStatus};
    row.turns[0].status = status;
    emit('turn/completed', {turn: {id: 'child-turn', status, ...(status === 'failed' ? {error} : {})}}, 'child');
  };
  return {
    c,
    calls,
    root,
    disk,
    emit,
    end,
    child,
    finishChild,
    nativeStart,
    unloadedChildren,
    blockGoal,
    get goal() {
      return goal;
    },
    get gateway() {
      return gateway;
    },
    get bridgeHooks() {
      return bridgeHooks;
    },
    get currentTurn() {
      return parent.turns.at(-1).id;
    },
    deliveries: () => calls.filter(x => x.method === 'turn/start' && x.p.toolOutput),
    setSynchronousAuditFailure: x => (synchronousAuditFailure = x),
    setFlashRows: x => (flashRows = x),
    setGate: x => (gate = x),
    setGoalGate: x => (goalGate = x),
    setDeliveryGate: x => (deliveryGate = x),
    setUnknown: x => (readFailure = x),
    setBackground: x => (background = x),
    setParentStatus: x => (parent.status = x === undefined ? undefined : {type: x}),
    setLatestTurn: x => Object.assign(parent.turns.at(-1), x),
    setReject: x => (reject = x),
    setRejectGate: x => (rejectGate = x),
    loseHost: () => close(),
    cleanup: async () => {
      background = false;
      readFailure = false;
      gate = null;
      for (const row of children.values()) {
        row.status = {type: 'idle'};
        row.turns[0].status = 'completed';
      }
      if (c.state.status === 'uncertain') await c.stop();
      await c.close();
    }
  };
}
const wait = async predicate => {
  const end = Date.now() + 3500;
  while (!predicate()) {
    if (Date.now() > end) throw Error('observable not reached');
    await new Promise(r => setTimeout(r, 20));
  }
};
const tick = () => new Promise(r => setTimeout(r, 60));

test('account-only material changes wake the same active conversation repeatedly without new human sends or polling', async () => {
  const f = await fixture();
  try {
    await f.gateway.bridge.list();
    const notify = (status, id) =>
      f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: [], queryIds: [id], status, switched: false});
    notify('waiting', 'first-query');
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 0);
    notify('ready', 'first-query');
    await wait(() => f.deliveries().length === 1);
    // The awakened main model can ask once about a genuinely different wait.
    notify('waiting', 'second-query');
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 1);
    notify('ready', 'second-query');
    await wait(() => f.deliveries().length === 2);
    assert.match(f.deliveries()[1].p.toolOutput.output, /second-query/);
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 2);
    assert.equal(
      f.calls.filter(c => c.method === 'turn/start' && !c.p.toolOutput).length,
      1,
      'only the fixture original human input'
    );
  } finally {
    await f.cleanup();
  }
});

async function waitingWorker(f, id = 'late-worker') {
  await f.gateway.bridge.start({requestId: id});
  const row = {parentId: 'parent', provider: 'gemini', requestId: id, status: 'running', settled: false, output: ''};
  f.setFlashRows([row]);
  f.bridgeHooks.onChange(row);
  return row;
}

for (const kind of ['worker', 'account'])
  test(`same resumed goal can await a new ${kind} and receive another audit without human polling`, async () => {
    const f = await fixture();
    try {
      await f.gateway.bridge.list();
      const notify = (status, id) =>
        f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: [], queryIds: [id], status, switched: false});
      for (let i = 1; i <= 2; i++) {
        const id = `new-wait-${i}`,
          row = kind === 'worker' ? await waitingWorker(f, id) : null;
        if (kind === 'account') notify('waiting', id);
        f.blockGoal();
        f.end('completed');
        await tick();
        assert.equal(f.deliveries().length, i - 1);
        if (row) {
          Object.assign(row, {status: 'completed', settled: true, output: 'saved ' + id});
          f.bridgeHooks.onChange(row);
        } else notify('ready', id);
        await wait(() => f.deliveries().length === i);
        await tick();
        assert.equal(f.deliveries()[i - 1].p.toolOutput.name, 'k_native_goal_recovery');
        assert.match(f.deliveries()[i - 1].p.toolOutput.output, new RegExp(id));
        await f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}});
        assert.equal(f.goal.status, 'active');
        assert.equal(f.goal.createdAt, 101);
      }
      f.end('completed');
      await tick();
      assert.equal(f.deliveries().length, 2);
      assert.equal(f.calls.filter(c => c.method === 'turn/start' && !c.p.toolOutput).length, 1);
    } finally {
      await f.cleanup();
    }
  });
test('live active goal blocked while awaiting a worker receives one trusted audit after its late completion', async () => {
  const f = await fixture();
  try {
    const row = await waitingWorker(f),
      blockedTurn = f.currentTurn;
    f.blockGoal();
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 0);
    Object.assign(row, {status: 'completed', settled: true, output: 'saved output'});
    f.bridgeHooks.onChange(row);
    await wait(() => f.deliveries().length === 1);
    await tick();
    const p = f.deliveries()[0].p;
    assert.equal(p.toolOutput.name, 'k_native_goal_recovery');
    assert.match(p.toolOutput.output, /等待工人/);
    assert.match(p.toolOutput.output, /其他阻礙/);
    assert.match(p.toolOutput.output, /late-worker/);
    assert.equal(
      f.calls.some(x => x.method === 'thread/goal/set'),
      false
    );
    assert.equal(f.goal.status, 'blocked');
    assert.equal(
      f.c.state.notices.some(n => n.kind === 'nativeError'),
      false,
      'normal blocked turn is not a native failure'
    );
    assert.equal(f.c.state.tools.find(t => t.name === '核對已存成果').details.workerWait.turnId, blockedTurn);
    await f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}});
    assert.equal(f.goal.status, 'active');
    assert.equal(f.goal.createdAt, 101);
    assert.equal(f.goal.tokensUsed, 12);
    f.end('completed');
    f.bridgeHooks.onChange(row);
    await tick();
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});
test('worker wait recovery holds partial completions and unknown workers until all are settled', async () => {
  const f = await fixture();
  try {
    const a = await waitingWorker(f, 'a');
    await f.gateway.bridge.start({requestId: 'b'});
    const b = {...a, requestId: 'b'};
    f.setFlashRows([a, b]);
    f.bridgeHooks.onChange(b);
    f.blockGoal();
    f.end('completed');
    Object.assign(a, {status: 'completed', settled: true});
    f.bridgeHooks.onChange(a);
    await tick();
    assert.equal(f.deliveries().length, 0);
    Object.assign(b, {status: 'unresolved', inspection: {noticeId: 'quiet', lastActivityAt: 0}});
    f.bridgeHooks.onChange(b);
    await tick();
    assert.equal(f.deliveries().length, 0);
    Object.assign(b, {status: 'completed', settled: true});
    f.bridgeHooks.onChange(b);
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.deliveries()[0].p.toolOutput.name, 'k_native_goal_recovery');
  } finally {
    await f.cleanup();
  }
});
for (const action of ['paused', 'new-human', 'changed-goal', 'budget', 'already-blocked', 'cancelled-worker'])
  test('worker completion cannot authorize recovery after ' + action, async () => {
    const f = await fixture({
      budget: action === 'budget' ? 100 : null,
      status: action === 'already-blocked' ? 'blocked' : 'active'
    });
    try {
      const row = await waitingWorker(f);
      f.blockGoal();
      f.end('completed');
      await tick();
      if (action === 'paused') await f.c.goal({status: 'paused'});
      if (action === 'new-human') {
        await f.c.send({text: 'wait for my decision'});
        f.end('completed');
      }
      if (action === 'changed-goal') await f.c.goal({objective: 'different task', editOnly: true});
      if (action === 'cancelled-worker') await f.gateway.bridge.cancel({requestId: row.requestId});
      Object.assign(row, {status: 'completed', settled: true});
      f.bridgeHooks.onChange(row);
      await tick();
      assert.equal(
        f.deliveries().some(x => x.p.toolOutput.name === 'k_native_goal_recovery'),
        false
      );
      assert.equal(
        f.calls.some(x => x.method === 'thread/goal/set' && x.p.status === 'active'),
        false
      );
    } finally {
      await f.cleanup();
    }
  });

for (const changed of ['paused-during-read', 'different-turn', 'missing-worker', 'unowned-worker'])
  test('late worker recovery rechecks ' + changed + ' before model delivery', async () => {
    const f = await fixture();
    let release;
    try {
      const row = await waitingWorker(f);
      f.blockGoal();
      f.end('completed');
      await tick();
      if (changed === 'paused-during-read') f.setGoalGate(new Promise(r => (release = r)));
      if (changed === 'different-turn') f.setLatestTurn({id: 'other-turn'});
      Object.assign(row, {status: 'completed', settled: true});
      f.bridgeHooks.onChange({...row});
      if (changed === 'missing-worker') f.setFlashRows([]);
      if (changed === 'unowned-worker') f.setFlashRows([{...row, executionUnowned: true}]);
      if (release) {
        await tick();
        f.emit('thread/goal/updated', {goal: {...f.goal, status: 'paused'}});
        release();
        f.setGoalGate(null);
      }
      await tick();
      assert.equal(f.deliveries().length, 0);
    } finally {
      release?.();
      await f.cleanup();
    }
  });
test('uncertain late worker audit submission is not resent or directly resumed', async () => {
  const f = await fixture({reject: Error('transport lost')});
  try {
    const row = await waitingWorker(f);
    f.blockGoal();
    f.end('completed');
    await tick();
    Object.assign(row, {status: 'completed', settled: true});
    f.bridgeHooks.onChange(row);
    await wait(() => f.deliveries().length === 1);
    await tick();
    f.bridgeHooks.onChange(row);
    await tick();
    assert.equal(f.deliveries().length, 1);
    assert.equal(f.c.state.status, 'uncertain');
    assert.equal(f.goal.status, 'blocked');
  } finally {
    await f.cleanup();
  }
});
test('failed late worker audit does not generate another audit', async () => {
  const f = await fixture();
  try {
    const row = await waitingWorker(f);
    f.blockGoal();
    f.end('completed');
    await tick();
    Object.assign(row, {status: 'completed', settled: true});
    f.bridgeHooks.onChange(row);
    await wait(() => f.deliveries().length === 1);
    await tick();
    f.end();
    f.bridgeHooks.onChange(row);
    await tick();
    assert.equal(f.deliveries().length, 1);
    assert.equal(f.goal.status, 'blocked');
  } finally {
    await f.cleanup();
  }
});

test('only the live rate-only audit can link its exact latest failed human turn; model arguments cannot spoof it', async () => {
  let data;
  const f = await fixture({
    status: 'blocked',
    rateCooldownMs: 10,
    onContinueConversation: async args => {
      data = args;
      args.stillCurrent();
      return {accepted: args.authorizedHumanTurnId !== undefined};
    }
  });
  try {
    const failed = f.currentTurn;
    await f.gateway.continueConversation(
      {mode: 'fresh', nextInstruction: 'human move', authorizedHumanTurnId: 'spoof'},
      {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: failed}}
    );
    assert.equal(data.authorizedHumanTurnId, undefined);
    f.end('failed', rateError);
    await wait(() => f.deliveries().length === 1);
    const audit = f.currentTurn;
    await assert.rejects(
      f.gateway.continueConversation(
        {mode: 'fresh', nextInstruction: 'spoof worker'},
        {'x-codex-turn-metadata': {thread_id: 'worker', turn_id: audit}}
      ),
      /主對話/
    );
    await f.gateway.continueConversation(
      {mode: 'fresh', nextInstruction: 'explicit same human move', authorizedHumanTurnId: 'spoof'},
      {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: audit}}
    );
    assert.equal(data.authorizedHumanTurnId, failed);
    assert.equal(data.turnId, audit);
    assert.doesNotThrow(data.stillCurrent);
    await wait(() => !f.c.state.completionPending);
    f.end('completed');
    await tick();
    assert.throws(data.stillCurrent, /主對話|核對/);
    assert.doesNotThrow(data.afterTurnCurrent);
    await f.c.prepareContinuation({mode: 'fresh', turnId: audit, sourceCurrent: data.afterTurnCurrent});
    await f.c.goal({status: 'paused'});
    assert.throws(data.afterTurnCurrent, /停止|變更/);
  } finally {
    await f.cleanup();
  }
});

test('accepted direct fresh handoff consumes that human-turn audit eligibility; an unaccepted promise does not', async () => {
  for (const responseFirst of [false, true])
    for (const accepted of [true, false]) {
      const f = await fixture({
        status: 'blocked',
        rateCooldownMs: 10,
        responseFirst,
        onContinueConversation: async () => ({accepted})
      });
      try {
        await f.gateway.continueConversation(
          {mode: 'fresh', nextInstruction: 'explicit user fresh move'},
          {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}}
        );
        f.end('failed', rateError);
        await new Promise(r => setTimeout(r, 180));
        assert.equal(f.deliveries().length, accepted ? 0 : 1);
      } finally {
        await f.cleanup();
      }
    }
});

test('trusted failed-human audit linkage is revoked by stop, new human steer or goal identity changes', async () => {
  for (const action of ['stop', 'steer', 'identity']) {
    let data;
    const f = await fixture({
      status: 'blocked',
      rateCooldownMs: 10,
      onContinueConversation: async args => {
        data = args;
        return {accepted: true};
      }
    });
    try {
      f.end('failed', rateError);
      await wait(() => f.deliveries().length === 1);
      await f.gateway.continueConversation(
        {mode: 'fresh', nextInstruction: 'move'},
        {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}}
      );
      assert.ok(data.authorizedHumanTurnId);
      if (action === 'stop') await f.c.stop();
      else if (action === 'steer') await f.c.steer({text: 'new actual intent'});
      else {
        f.goal.createdAt++;
        f.emit('thread/goal/updated', {goal: structuredClone(f.goal)});
      }
      assert.throws(data.stillCurrent);
      assert.throws(data.afterTurnCurrent);
    } finally {
      await f.cleanup();
    }
  }
});

test('active-goal human rate failure also links its audit, but a native background turn cannot borrow the old human', async () => {
  for (const background of [false, true]) {
    let data;
    const f = await fixture({
      rateCooldownMs: 10,
      onContinueConversation: async args => {
        data = args;
        return {accepted: true};
      }
    });
    try {
      if (background) {
        f.end('completed');
        f.nativeStart();
      }
      const failed = f.currentTurn;
      f.end('failed', rateError);
      await wait(() => f.deliveries().length === 1);
      await f.gateway.continueConversation(
        {mode: 'fresh', nextInstruction: 'move', authorizedHumanTurnId: failed},
        {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}}
      );
      assert.equal(data.authorizedHumanTurnId, background ? undefined : failed);
      assert.equal(
        f.calls.some(c => c.method === 'thread/goal/set'),
        false
      );
    } finally {
      await f.cleanup();
    }
  }
});

test('rate classification ignores incidental numeric/text metadata and retains forward-compatible service errors', async () => {
  const f = await fixture();
  try {
    f.end('failed', {
      ...error,
      additionalDetails: {diagnostic: 'retry 429 seen historically'},
      misalignment: {rateLimitExceeded: 'quoted history'}
    });
    await wait(() => f.deliveries().length === 1);
    assert.doesNotMatch(f.deliveries()[0].p.toolOutput.output, /本機單次冷卻/);
  } finally {
    await f.cleanup();
  }
});
test('live active goal failed audits once on same thread with raw error and partial output retained', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'partial.txt'), 'saved fixture result');
    f.emit('item/agentMessage/delta', {itemId: 'partial', turnId: f.currentTurn, delta: 'partial message'});
    const failed = f.currentTurn;
    f.end();
    await wait(() => f.deliveries().length === 1);
    const p = f.deliveries()[0].p;
    assert.equal(p.threadId, 'parent');
    assert.equal(p.model, 'gpt-6-astra');
    assert.equal(p.effort, 'high');
    assert.deepEqual(p.input, []);
    assert.equal(p.toolOutput.name, 'k_native_goal_recovery');
    assert.match(p.toolOutput.output, /conversation_context/);
    assert.match(p.toolOutput.output, /goal_resume/);
    assert.match(p.toolOutput.output, /先/);
    assert.equal(
      f.calls.some(x => x.method === 'thread/goal/set'),
      false
    );
    assert.equal(f.c.state.messages.find(x => x.id === 'partial').partial, true);
    assert.equal(await readFile(path.join(f.root, 'partial.txt'), 'utf8'), 'saved fixture result');
    assert.deepEqual(f.c.state.tools.find(x => x.name === '核對已存成果').details.failed.error, error);
    assert.equal(f.c.state.tools.find(x => x.name === '核對已存成果').details.failed.turnId, failed);
    f.emit('turn/completed', {turn: {id: failed, status: 'failed', error}});
    await tick();
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});
test('running child and unknown background delay, then natural settlement merges one audit without stopping work', async () => {
  const f = await fixture();
  try {
    f.child();
    f.setBackground(true);
    f.end();
    await tick();
    assert.equal(f.deliveries().length, 0);
    f.finishChild();
    await tick();
    assert.equal(f.deliveries().length, 0);
    f.setBackground(false);
    await wait(() => f.deliveries().length === 1);
    assert.match(f.deliveries()[0].p.toolOutput.output, /child-turn/);
    assert.equal(
      f.calls.some(x => ['turn/interrupt', 'thread/backgroundTerminals/clean'].includes(x.method)),
      false
    );
  } finally {
    await f.cleanup();
  }
});
for (const options of [{budget: 1000}, {status: 'blocked'}, {status: 'blocked', responseFirst: true}])
  test('explicit goal budget or already blocked chat does not auto-audit ' + JSON.stringify(options), async () => {
    const f = await fixture(options);
    try {
      f.end();
      await tick();
      assert.equal(f.deliveries().length, 0);
    } finally {
      await f.cleanup();
    }
  });
test('known native hard limits never start audit; generic stream is not guessed from message', async () => {
  for (const code of [
    'contextWindowExceeded',
    'sessionBudgetExceeded',
    'usageLimitExceeded',
    'unauthorized',
    'sandboxError'
  ]) {
    const f = await fixture();
    try {
      f.end('failed', {...error, codexErrorInfo: code});
      await tick();
      assert.equal(f.deliveries().length, 0);
    } finally {
      await f.cleanup();
    }
  }
});

test('ordinary 429 uses one bounded local cooldown then one exact audit, never original turn replay', async () => {
  const f = await fixture({rateCooldownMs: 120});
  try {
    const failed = f.currentTurn;
    f.end('failed', rateError, true, 'systemError');
    await tick();
    assert.equal(f.deliveries().length, 0);
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.c.state.tools.find(t => t.name === '核對已存成果').details.failed.turnId, failed);
    assert.match(f.deliveries()[0].p.toolOutput.output, /本機.*冷卻/);
    assert.match(f.deliveries()[0].p.toolOutput.output, /不是官方/);
    assert.equal(
      f.calls.some(c => c.method === 'thread/goal/set'),
      false
    );
    f.end('failed', rateError);
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});

test('response-first local human send owns only its exact blocked-goal turn even after submission clears', async () => {
  const f = await fixture({status: 'blocked', rateCooldownMs: 10, responseFirst: true});
  try {
    const failed = f.currentTurn;
    assert.equal(f.c.state.messages.find(m => m.role === 'user').turnId, failed);
    f.end('failed', rateError);
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.c.state.tools.find(t => t.name === '核對已存成果').details.failed.turnId, failed);
    assert.equal(
      f.calls.some(c => c.method === 'thread/goal/set'),
      false
    );
    f.end('failed', rateError);
    await new Promise(r => setTimeout(r, 120));
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});
test('response-first blocked human ownership is not retained by a later native background turn', async () => {
  const f = await fixture({status: 'blocked', rateCooldownMs: 10, responseFirst: true});
  try {
    f.end('completed');
    f.nativeStart(false);
    f.end('failed', rateError);
    await new Promise(r => setTimeout(r, 160));
    assert.equal(f.deliveries().length, 0);
  } finally {
    await f.cleanup();
  }
});
test('a new local human send on the same blocked unbudgeted goal can audit rate failure without auto-resume', async () => {
  const f = await fixture({status: 'blocked', rateCooldownMs: 120});
  try {
    f.end('failed', rateError);
    await wait(() => f.deliveries().length === 1);
    assert.equal(
      f.calls.some(c => c.method === 'thread/goal/set'),
      false
    );
    assert.equal(f.goal.status, 'blocked');
    f.end('failed', {...error, message: 'generic audit failed'});
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});

test('429 cannot override explicit quota, auth, permissions, context or budget proof in code or details', async () => {
  for (const detail of [
    {codexErrorInfo: 'usageLimitExceeded'},
    {codexErrorInfo: {quotaExceeded: {}}},
    {additionalDetails: 'You have exceeded your weekly usage limit'},
    {additionalDetails: {error: {code: 'insufficient_quota'}}},
    {message: '429: quota exhausted'},
    {message: '429: token budget exceeded'},
    {message: '429: permission denied'},
    {message: '429: context window exceeded'},
    {codexErrorInfo: {httpConnectionFailed: {httpStatusCode: 403}}}
  ]) {
    const f = await fixture({rateCooldownMs: 10});
    try {
      f.end('failed', {...rateError, ...detail});
      await new Promise(r => setTimeout(r, 1100));
      assert.equal(f.deliveries().length, 0, JSON.stringify(detail));
    } finally {
      await f.cleanup();
    }
  }
});

test('rate cooldown cancels on pause, stop, new input, intent change or host loss', async () => {
  for (const action of ['pause', 'stop', 'send', 'edit', 'host']) {
    const f = await fixture({rateCooldownMs: 120});
    try {
      f.end('failed', rateError);
      await tick();
      if (action === 'pause') await f.c.goal({status: 'paused'});
      else if (action === 'stop') await f.c.stop();
      else if (action === 'send') await f.c.send({text: 'new actual intent'});
      else if (action === 'edit') await f.c.goal({objective: 'new objective', editOnly: true});
      else f.loseHost();
      await new Promise(r => setTimeout(r, 1100));
      assert.equal(f.deliveries().length, 0);
    } finally {
      await f.cleanup();
    }
  }
});

test('rate cooldown still refuses official zero, paused/budgeted goals, unknown workers or background commands', async () => {
  for (const guard of ['quota', 'paused', 'budget', 'unknown', 'background', 'continuation']) {
    const f = await fixture({
      status: guard === 'paused' ? 'paused' : 'active',
      budget: guard === 'budget' ? 100 : null,
      rateCooldownMs: 10
    });
    try {
      if (guard === 'quota')
        f.c.state.usage.codex = {
          status: 'ready',
          windows: [{remainingPercent: 0, resetsAt: Math.floor(Date.now() / 1000) + 3600}]
        };
      if (guard === 'unknown') f.setUnknown(true);
      if (guard === 'background') f.setBackground(true);
      if (guard === 'continuation') {
        f.end('completed');
        f.goal.status = 'blocked';
        f.emit('thread/goal/updated', {goal: structuredClone(f.goal)});
        await f.c.send({text: 'controller handoff', source: 'continuation'});
      }
      f.end('failed', rateError);
      await new Promise(r => setTimeout(r, 1100));
      assert.equal(f.deliveries().length, 0, guard);
    } finally {
      await f.cleanup();
    }
  }
});
test('stop while preflight is delayed cancels queued recovery', async () => {
  const f = await fixture();
  let release;
  try {
    f.setGate(new Promise(r => (release = r)));
    f.end();
    await tick();
    const stopped = f.c.stop();
    release();
    await stopped;
    await tick();
    assert.equal(f.deliveries().length, 0);
  } finally {
    release?.();
    await f.cleanup();
  }
});
test('audit identity remains invalid after human pause or edit and its goal_resume is rejected', async () => {
  for (const args of [{status: 'paused'}, {objective: 'changed by human', editOnly: true}]) {
    const f = await fixture();
    try {
      f.end();
      await wait(() => f.deliveries().length === 1);
      const audit = f.currentTurn;
      await f.c.goal(args);
      const before = f.calls.length;
      await assert.rejects(
        f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: audit}}),
        /核對|停止|更新|變更/
      );
      assert.equal(
        f.calls.slice(before).some(x => x.method === 'thread/goal/set'),
        false
      );
    } finally {
      await f.cleanup();
    }
  }
});
test('audit failure or audit completion never rearms; new human work can rearm', async () => {
  const f = await fixture();
  try {
    f.end();
    await wait(() => f.deliveries().length === 1);
    await f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}});
    assert.equal(f.calls.findLast(x => x.method === 'thread/goal/set').p.origin, 'automatic');
    f.end('completed');
    await f.c.send({text: 'new human work'});
    f.end();
    await wait(() => f.deliveries().length === 2);
    f.end();
    await tick();
    assert.equal(f.deliveries().length, 2);
  } finally {
    await f.cleanup();
  }
});
for (const rejection of [
  Error('transport timeout'),
  Object.assign(Error('known rejected'), {protocolMessage: 'rejected'})
])
  test('recovery outbound rejection or ambiguity never retries ' + rejection.message, async () => {
    const f = await fixture({reject: rejection});
    try {
      f.end();
      await wait(() => f.deliveries().length === 1);
      await tick();
      assert.equal(f.deliveries().length, 1);
      assert.equal(f.c.state.turnError.error.message, error.message);
    } finally {
      await f.cleanup();
    }
  });

test('temporarily unreadable state waits in code and later recovers without a monitor model', async () => {
  const f = await fixture();
  try {
    f.setUnknown(true);
    f.end();
    await tick();
    assert.equal(f.deliveries().length, 0);
    f.setUnknown(false);
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.calls.filter(x => x.method === 'turn/start').length, 2);
  } finally {
    await f.cleanup();
  }
});
test('native active turn after an audit needs normal completed progress before another recovery', async () => {
  const f = await fixture();
  try {
    f.end();
    await wait(() => f.deliveries().length === 1);
    f.end();
    f.nativeStart();
    f.end();
    await tick();
    assert.equal(f.deliveries().length, 1);
    f.nativeStart();
    f.end('completed');
    f.nativeStart();
    f.end();
    await wait(() => f.deliveries().length === 2);
  } finally {
    await f.cleanup();
  }
});
test('public active goal set during a live turn is ownership, not history resurrection', async () => {
  const f = await fixture({status: 'blocked'});
  try {
    await f.c.goal({status: 'active'});
    f.end();
    await wait(() => f.deliveries().length === 1);
  } finally {
    await f.cleanup();
  }
});
test('changed public identity or native active takeover cancels queued recovery', async () => {
  for (const changed of ['identity', 'takeover']) {
    const f = await fixture();
    let release;
    try {
      f.setGate(new Promise(r => (release = r)));
      f.end();
      await tick();
      if (changed === 'identity') {
        f.goal.createdAt++;
        f.emit('thread/goal/updated', {goal: structuredClone(f.goal)});
      } else f.nativeStart();
      release();
      await tick();
      assert.equal(f.deliveries().length, 0);
    } finally {
      release?.();
      await f.cleanup();
    }
  }
});
test('late audit acknowledgement cannot undo an explicit stop', async () => {
  const f = await fixture();
  let release;
  try {
    f.setDeliveryGate(new Promise(r => (release = r)));
    f.end();
    await wait(() => f.deliveries().length === 1);
    const stopping = f.c.stop();
    release();
    await stopping;
    await tick();
    assert.equal(f.c.state.status, 'interrupted');
    assert.equal(f.c.state.busy, false);
    assert.equal(f.deliveries().length, 1);
  } finally {
    release?.();
    await f.cleanup();
  }
});
test('audit resume rechecks its exact live turn after the awaited goal read', async () => {
  const f = await fixture();
  let release;
  try {
    f.end();
    await wait(() => f.deliveries().length === 1);
    const audit = f.currentTurn;
    f.setGoalGate(new Promise(r => (release = r)));
    const resume = f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: audit}});
    await tick();
    f.end('completed');
    release();
    await assert.rejects(resume, /核對|變更|停止/);
    assert.equal(
      f.calls.some(x => x.method === 'thread/goal/set'),
      false
    );
  } finally {
    release?.();
    await f.cleanup();
  }
});

test('forward-compatible native unknown error classification allows one verified audit', async () => {
  const f = await fixture();
  try {
    f.end('failed', {...error, codexErrorInfo: {futureServiceFailure: {}}});
    await wait(() => f.deliveries().length === 1);
  } finally {
    await f.cleanup();
  }
});
test('failed terminal before native blocked read preserves pending recovery', async () => {
  const f = await fixture();
  try {
    f.end('failed', error, false);
    await tick();
    assert.equal(f.deliveries().length, 0);
    f.blockGoal();
    await wait(() => f.deliveries().length === 1);
  } finally {
    await f.cleanup();
  }
});
test('human send during read-only audit preflight revokes it instead of being rejected', async () => {
  const f = await fixture();
  let release;
  try {
    f.setGate(new Promise(r => (release = r)));
    f.end();
    await tick();
    await f.c.send({text: 'human replacement work'});
    release();
    await tick();
    assert.equal(f.deliveries().length, 0);
    assert.equal(f.calls.filter(x => x.method === 'turn/start').length, 2);
  } finally {
    release?.();
    await f.cleanup();
  }
});
test('hundreds of settled unloaded children do not block or get rescanned by recovery waiting', async () => {
  const f = await fixture();
  try {
    await f.unloadedChildren(300);
    f.child();
    f.end();
    await tick();
    const readBefore = f.calls.filter(x => x.method === 'thread/read' && x.p.threadId.startsWith('old-child-')).length;
    await new Promise(r => setTimeout(r, 1150));
    assert.equal(
      f.calls.filter(x => x.method === 'thread/read' && x.p.threadId.startsWith('old-child-')).length,
      readBefore
    );
    f.finishChild();
    await wait(() => f.deliveries().length === 1);
    assert.equal(
      f.calls.some(x => x.method === 'thread/backgroundTerminals/list' && x.p.threadId.startsWith('old-child-')),
      false
    );
  } finally {
    await f.cleanup();
  }
});

test('stable local room alias compares loaded/list raw native IDs without blocking recovery', async () => {
  const f = await fixture({alias: true});
  try {
    assert.equal(f.c.state.threadId, 'parent');
    assert.equal(f.goal.threadId, 'parent-native');
    f.end();
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.deliveries()[0].p.threadId, 'parent-native');
    assert.equal(f.c.state.threadId, 'parent');
  } finally {
    await f.cleanup();
  }
});

for (const action of ['edit', 'worker-read', 'pause', 'stop'])
  test('unattempted gated persist rollback preserves workers except explicit ' + action, async () => {
    const f = await fixture({persistGate: true});
    try {
      f.child();
      f.finishChild();
      await tick();
      f.disk.arm();
      f.end();
      await Promise.race([
        f.disk.entered.promise,
        new Promise((_, reject) => setTimeout(() => reject(Error('persist gate not entered')), 3500))
      ]);
      assert.equal(
        (await listMainSessions(f.root)).sessions[0].workerNotifications['codex.child.child-turn'],
        'delivery-attempted'
      );
      if (action === 'edit') await f.c.goal({objective: 'human edited work', editOnly: true});
      if (action === 'worker-read') await f.c.workers();
      if (action === 'pause') await f.c.goal({status: 'paused'});
      if (action === 'stop') await f.c.stop();
      f.disk.release.resolve();
      await new Promise(r => setTimeout(r, 150));
      assert.equal(
        (await listMainSessions(f.root)).sessions[0].workerNotifications['codex.child.child-turn'],
        undefined
      );
      assert.equal(f.deliveries().length, 0);
      if (action === 'edit') {
        await f.c.send({text: 'new human work'});
        f.end('completed');
        await wait(() => f.deliveries().length === 1);
        assert.match(f.deliveries()[0].p.toolOutput.output, /child-turn/);
      }
      if (action === 'worker-read') {
        await wait(() => f.deliveries().length === 1);
        assert.match(f.deliveries()[0].p.toolOutput.output, /child-turn/);
      }
      if (['pause', 'stop'].includes(action)) {
        await tick();
        assert.equal(f.deliveries().length, 0);
      }
    } finally {
      f.disk.release.resolve();
      await f.cleanup();
    }
  });
test('known unstarted rejection cannot claim a later human-resumed ordinary turn as audit', async () => {
  const f = await fixture({reject: Object.assign(Error('rejected'), {protocolMessage: 'rejected'})});
  try {
    f.end();
    await wait(() => f.deliveries().length === 1);
    await tick();
    f.setReject(null);
    await f.c.goal({status: 'active'});
    f.nativeStart();
    await f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}});
    f.end();
    await wait(() => f.deliveries().length === 2);
  } finally {
    await f.cleanup();
  }
});
test('unknown audit delivery cannot be bypassed by human resume or compact; late revoked audit stays guarded', async () => {
  const f = await fixture({reject: Error('transport unknown')});
  try {
    f.end();
    await wait(() => f.deliveries().length === 1);
    await tick();
    await assert.rejects(f.c.goal({status: 'active'}), /未確認|查明/);
    await assert.rejects(f.c.compact(), /未確認|查明/);
    await f.c.goal({status: 'paused'});
    f.nativeStart();
    await assert.rejects(
      f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}}),
      /停止|核對|更新/
    );
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});
test('human compact during pending readonly preflight revokes recovery without blocking compact', async () => {
  const f = await fixture();
  let release;
  try {
    f.setGate(new Promise(r => (release = r)));
    f.end();
    await tick();
    await f.c.compact();
    assert.equal(f.calls.filter(x => x.method === 'thread/compact/start').length, 1);
    release();
    await tick();
    assert.equal(f.deliveries().length, 0);
  } finally {
    release?.();
    await f.cleanup();
  }
});

test('unknown delivery resolved by stop leaves no claim; explicit human resume allows new work recovery', async () => {
  const f = await fixture({reject: Error('transport unknown')});
  try {
    f.end();
    await wait(() => f.deliveries().length === 1);
    await tick();
    await f.c.stop();
    f.setReject(null);
    await f.c.goal({status: 'active'});
    f.nativeStart();
    await f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}});
    f.end();
    await wait(() => f.deliveries().length === 2);
  } finally {
    await f.cleanup();
  }
});

test('pause before transport failure retains unknown delivery and revoked late audit protection', async () => {
  const f = await fixture({reject: Error('transport unknown')});
  let release;
  try {
    f.setRejectGate(new Promise(r => (release = r)));
    f.end();
    await wait(() => f.deliveries().length === 1);
    f.goal.status = 'paused';
    f.emit('thread/goal/updated', {goal: structuredClone(f.goal)});
    release();
    await tick();
    await assert.rejects(f.c.goal({status: 'active'}), /未確認|查明/);
    f.nativeStart();
    await assert.rejects(
      f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}}),
      /停止|核對|更新/
    );
    assert.equal(f.deliveries().length, 1);
  } finally {
    release?.();
    await f.cleanup();
  }
});

for (const status of ['systemError', 'notLoaded'])
  test('unknown delivery ' + status + ' can stop with native backgrounds handled accurately', async () => {
    const f = await fixture({reject: Error('transport unknown')});
    try {
      f.end();
      await wait(() => f.deliveries().length === 1);
      await tick();
      f.setParentStatus(status);
      if (status === 'systemError') f.setBackground(true);
      const start = f.calls.length;
      await f.c.stop();
      assert.equal(f.c.state.status, 'interrupted');
      const calls = f.calls.slice(start);
      if (status === 'systemError') {
        assert.equal(calls.filter(x => x.method === 'thread/backgroundTerminals/clean').length, 1);
        assert.equal(calls.filter(x => x.method === 'thread/backgroundTerminals/list').length, 2);
      } else
        assert.equal(
          calls.some(x => x.method === 'thread/backgroundTerminals/list'),
          false
        );
      await f.c.close();
      assert.equal(f.c.state.status, 'offline');
    } finally {
      f.setParentStatus('idle');
      await f.cleanup();
    }
  });
for (const status of [undefined, 'active', 'futureStatus'])
  test('unknown delivery cannot assume stopped from ' + status, async () => {
    const f = await fixture({reject: Error('transport unknown')});
    try {
      f.end();
      await wait(() => f.deliveries().length === 1);
      await tick();
      f.setParentStatus(status);
      await assert.rejects(f.c.stop(), /無法確認|未確認/);
      assert.equal(f.c.state.status, 'uncertain');
      await assert.rejects(f.c.goal({status: 'active'}), /未確認|查明/);
    } finally {
      f.setParentStatus('idle');
      await f.cleanup();
    }
  });
test('unknown delivery cannot clear then create an implicitly active goal; paused edits remain allowed', async () => {
  const f = await fixture({reject: Error('transport unknown')});
  try {
    f.end();
    await wait(() => f.deliveries().length === 1);
    await tick();
    await f.c.goal({status: 'paused'});
    await f.c.goal({objective: 'paused edited intent', editOnly: true});
    assert.equal(f.goal.status, 'paused');
    await f.c.goal({status: 'blocked'});
    await f.c.goal({objective: 'blocked edited intent', editOnly: true});
    assert.equal(f.goal.status, 'blocked');
    f.goal.status = 'active';
    await assert.rejects(f.c.goal({objective: 'fresh active must not inject', editOnly: true}), /未確認|查明/);
    f.goal.status = 'blocked';
    await f.c.goal({clear: true});
    const count = f.calls.filter(x => x.method === 'thread/goal/set').length;
    await assert.rejects(f.c.goal({objective: 'must not implicitly start'}), /未確認|查明/);
    assert.equal(f.calls.filter(x => x.method === 'thread/goal/set').length, count);
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});

// Fixed 0.161.0 Error -> note_system_error; completion clears running, not has_system_error.
test('real native terminal Error leaves systemError and still audits exact failed goal once', async () => {
  const f = await fixture();
  try {
    const failed = f.currentTurn;
    f.end('failed', error, true, 'systemError');
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.deliveries()[0].p.toolOutput.name, 'k_native_goal_recovery');
    assert.equal(f.c.state.notices.filter(n => n.kind === 'nativeError' && n.turnId === failed).length, 1);
    assert.deepEqual(f.c.state.tools.find(t => t.name === '核對已存成果').details.failed.error, error);
    assert.equal(
      f.calls.some(x =>
        ['turn/interrupt', 'thread/backgroundTerminals/clean', 'thread/compact/start', 'thread/goal/set'].includes(
          x.method
        )
      ),
      false
    );
  } finally {
    await f.cleanup();
  }
});
test('systemError does not imply child or background settled; waits then audits once', async () => {
  const f = await fixture();
  try {
    f.child();
    f.setBackground(true);
    f.end('failed', error, true, 'systemError');
    await tick();
    assert.equal(f.deliveries().length, 0);
    f.finishChild();
    await tick();
    assert.equal(f.deliveries().length, 0);
    f.setBackground(false);
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.calls.filter(x => x.method === 'turn/start').length, 2);
    assert.equal(
      f.calls.some(x => ['turn/interrupt', 'thread/backgroundTerminals/clean'].includes(x.method)),
      false
    );
  } finally {
    await f.cleanup();
  }
});

test('failed systemError child is settled and joins one recovery, not treated as unknown forever', async () => {
  const f = await fixture();
  try {
    f.child();
    f.finishChild('failed', 'systemError');
    await f.c.workers();
    f.end('failed', error, true, 'systemError');
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.c.state.workers.find(w => w.threadId === 'child').settled, true);
    assert.match(f.deliveries()[0].p.toolOutput.output, /child-turn/);
    assert.match(f.deliveries()[0].p.toolOutput.output, /failed/);
    assert.equal(f.calls.filter(x => x.method === 'turn/start').length, 2);
    assert.equal(
      f.calls.some(x => ['turn/interrupt', 'thread/backgroundTerminals/clean'].includes(x.method)),
      false
    );
  } finally {
    await f.cleanup();
  }
});

for (const status of ['completed', 'failed', 'interrupted'])
  test('audit ' + status + ' resolves in-progress notice without rearming', async () => {
    const f = await fixture();
    try {
      f.end();
      await wait(() => f.deliveries().length === 1);
      const notice = f.c.state.notices.find(n => n.kind === 'goal-recovery' && n.level === 'info');
      assert.equal(notice.resolved, undefined);
      f.end(status);
      await tick();
      assert.equal(notice.resolved, true);
      assert.equal(f.c.state.tools.find(t => t.name === '核對已存成果').status, status);
      assert.equal(
        f.c.state.notices.some(n => n.kind === 'goal-recovery' && n.level === 'info' && !n.resolved),
        false
      );
      if (status === 'failed') {
        assert.match(
          f.c.state.notices.findLast(n => n.kind === 'goal-recovery' && !n.resolved).message,
          /已失敗.*未自動重送/
        );
        f.end(status);
        assert.equal(
          f.c.state.notices.filter(n => n.kind === 'goal-recovery' && n.level === 'warning' && !n.resolved).length,
          1
        );
      }
      assert.equal(f.deliveries().length, 1);
    } finally {
      await f.cleanup();
    }
  });

for (const known of [true, false])
  test(
    'unstarted audit ' +
      (known ? 'rejection' : 'ambiguity') +
      ' replaces running notice without claiming terminal success',
    async () => {
      const reject = known
        ? Object.assign(Error('fixture rejected'), {protocolMessage: 'rejected'})
        : Error('fixture delivery unknown');
      const f = await fixture({reject});
      try {
        f.end();
        await wait(() => f.deliveries().length === 1);
        await tick();
        assert.equal(
          f.c.state.notices.some(n => n.kind === 'goal-recovery' && n.level === 'info' && !n.resolved),
          false
        );
        assert.equal(f.c.state.tools.find(t => t.name === '核對已存成果').status, known ? 'failed' : 'unresolved');
        assert.equal(f.c.state.status, known ? 'failed' : 'uncertain');
        assert.equal(f.deliveries().length, 1);
      } finally {
        await f.cleanup();
      }
    }
  );

test('systemError alone cannot audit when latest turn is still inProgress or a different id', async () => {
  for (const latest of [{status: 'inProgress'}, {id: 'different-native-turn'}]) {
    const f = await fixture();
    let release;
    try {
      const before = f.calls.length;
      f.setGate(new Promise(r => (release = r)));
      f.end('failed', error, true, 'systemError');
      await wait(() => f.calls.slice(before).some(x => x.method === 'thread/read'));
      f.setLatestTurn(latest);
      release();
      await wait(() => f.calls.slice(before).some(x => x.method === 'thread/turns/list'));
      await tick();
      assert.equal(f.deliveries().length, 0);
      assert.equal(f.calls.filter(x => x.method === 'turn/start').length, 1);
      assert.equal(
        f.calls
          .slice(before)
          .some(x => ['thread/goal/set', 'turn/interrupt', 'thread/compact/start'].includes(x.method)),
        false
      );
    } finally {
      release?.();
      await f.cleanup();
    }
  }
});

test('official Gemini ready episode gives a failed audit one new check, not a general failure retry', async () => {
  const f = await fixture();
  try {
    f.end();
    await wait(() => f.deliveries().length === 1);
    await f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}});
    await f.gateway.bridge.start({requestId: 'quota-a'});
    await f.gateway.bridge.start({requestId: 'quota-b'});
    const event = {parentId: 'parent', requestIds: ['quota-a', 'quota-b'], accountId: 'new-fake-account'};
    f.bridgeHooks.onGeminiHandoff({...event, status: 'waiting'});
    f.end();
    await tick();
    assert.equal(f.deliveries().length, 1);
    f.setBackground(true);
    f.bridgeHooks.onGeminiHandoff({...event, status: 'ready'});
    await tick();
    assert.equal(f.deliveries().length, 1);
    f.setBackground(false);
    await wait(() => f.deliveries().length === 2);
    assert.equal(f.deliveries()[1].p.toolOutput.name, 'k_native_goal_recovery');
    assert.match(f.deliveries()[1].p.toolOutput.output, /quota-a.*quota-b/);
    assert.match(f.deliveries()[1].p.toolOutput.output, /handoffFrom/);
    f.bridgeHooks.onGeminiHandoff({...event, status: 'ready'});
    f.end();
    await tick();
    assert.equal(f.deliveries().length, 2);
    assert.equal(
      f.calls.some(x => ['turn/interrupt', 'thread/backgroundTerminals/clean'].includes(x.method)),
      false
    );
  } finally {
    await f.cleanup();
  }
});

test('synchronous failed ready audit cannot rearm the same episode, but later independent ready can', async () => {
  const f = await fixture();
  try {
    f.end();
    await wait(() => f.deliveries().length === 1);
    await f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}});
    await f.gateway.bridge.start({requestId: 'quota-first'});
    f.end();
    await tick();
    f.setSynchronousAuditFailure(true);
    f.bridgeHooks.onGeminiHandoff({
      parentId: 'parent',
      requestIds: ['quota-first'],
      status: 'ready',
      accountId: 'fake-b'
    });
    await wait(() => f.deliveries().length >= 2);
    await new Promise(r => setTimeout(r, 1250));
    assert.equal(f.deliveries().length, 2);
    assert.equal(f.c.state.status, 'failed');
    f.setSynchronousAuditFailure(false);
    await f.gateway.bridge.start({requestId: 'quota-second'});
    f.bridgeHooks.onGeminiHandoff({
      parentId: 'parent',
      requestIds: ['quota-second'],
      status: 'ready',
      accountId: 'fake-c'
    });
    await wait(() => f.deliveries().length === 3);
    assert.match(f.deliveries()[2].p.toolOutput.output, /quota-second/);
  } finally {
    await f.cleanup();
  }
});

for (const action of ['pause', 'stop', 'human-send', 'budget', 'unknown'])
  test('Gemini ready never bypasses ' + action, async () => {
    const f = await fixture({budget: action === 'budget' ? 10 : null});
    let release;
    try {
      await f.gateway.bridge.start({requestId: 'quota'});
      const callback = f.bridgeHooks.onGeminiHandoff,
        event = {parentId: 'parent', requestIds: ['quota'], accountId: 'fake-account'};
      f.end('completed');
      callback({...event, status: 'waiting'});
      await tick();
      if (action === 'pause') await f.c.goal({status: 'paused'});
      if (action === 'stop') await f.c.stop();
      if (action === 'human-send') {
        await f.c.send({text: 'new human intent'});
        f.end('completed');
      }
      if (action === 'unknown') f.setUnknown(true);
      if (action === 'budget') {
        f.nativeStart();
        f.end();
      }
      callback({
        ...event,
        status: action === 'blocked' ? 'blocked' : 'ready',
        reason: 'fixture official check unknown'
      });
      await tick();
      assert.equal(f.deliveries().length, 0);
    } finally {
      release?.();
      await f.cleanup();
    }
  });

test('query-only terminal blocker informs the same main once without claiming readiness or resuming its goal', async () => {
  const f = await fixture();
  try {
    await f.gateway.bridge.list();
    const event = {parentId: 'parent', requestIds: [], queryIds: ['blocked-query']};
    f.bridgeHooks.onGeminiHandoff({...event, status: 'waiting'});
    f.blockGoal();
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 0);
    f.bridgeHooks.onGeminiHandoff({
      ...event,
      status: 'blocked',
      reason: 'official authentication requires human login'
    });
    await wait(() => f.deliveries().length === 1);
    await tick();
    const output = f.deliveries()[0].p.toolOutput;
    assert.notEqual(output.name, 'k_native_goal_recovery');
    assert.match(output.output, /official authentication requires human login/);
    assert.match(output.output, /保留受阻狀態/);
    assert.doesNotMatch(output.output, /排程條件已就緒/);
    assert.equal(
      f.calls.some(c => c.method === 'thread/goal/set'),
      false
    );
    assert.equal(f.goal.status, 'blocked');
    f.end('completed');
    await f.c.workers();
    await tick();
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});

test('a worker finishing during an already completed status-notice send is not stranded', async () => {
  const f = await fixture();
  let release;
  try {
    const row = await waitingWorker(f);
    Object.assign(row, {status: 'failed', settled: false});
    f.bridgeHooks.onChange(row);
    f.setDeliveryGate(new Promise(r => (release = r)));
    f.end('completed');
    await wait(() => f.deliveries().length === 1);
    f.end('completed');
    Object.assign(row, {status: 'completed', settled: true, output: 'late saved result'});
    f.bridgeHooks.onChange(row);
    f.setDeliveryGate(null);
    release();
    await wait(() => f.deliveries().length === 2);
    assert.match(f.deliveries()[1].p.toolOutput.output, /late saved result/);
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 2);
  } finally {
    release?.();
    await f.cleanup();
  }
});

test('distinct blocked receipt during another blocked preflight is not stranded', async () => {
  const f = await fixture();
  let release;
  try {
    await f.gateway.bridge.list();
    f.end('completed');
    await tick();
    const before = f.calls.length;
    f.setGate(new Promise(r => (release = r)));
    const notify = id =>
      f.bridgeHooks.onGeminiHandoff({
        parentId: 'parent',
        requestIds: [],
        queryIds: [id],
        status: 'blocked',
        reason: 'needs human login'
      });
    notify('blocked-first');
    await wait(() => f.calls.slice(before).some(c => c.method === 'thread/read'));
    notify('blocked-second');
    f.setGate(null);
    release();
    await wait(() => f.deliveries().length === 1);
    assert.match(f.deliveries()[0].p.toolOutput.output, /blocked-first/);
    assert.match(f.deliveries()[0].p.toolOutput.output, /blocked-second/);
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 1);
  } finally {
    release?.();
    await f.cleanup();
  }
});

for (const phase of ['preflight', 'accepted-send'])
  test(`query-only blocked receipt during ${phase} is delivered without another external event`, async () => {
    const f = await fixture();
    let release;
    try {
      await f.gateway.bridge.list();
      f.end('completed');
      await tick();
      const notify = (status, id) =>
        f.bridgeHooks.onGeminiHandoff({
          parentId: 'parent',
          requestIds: [],
          queryIds: [id],
          status,
          reason: 'distinct scheduling result',
          switched: false
        });
      const gate = new Promise(r => (release = r)),
        before = f.calls.length;
      if (phase === 'preflight') f.setGate(gate);
      else f.setDeliveryGate(gate);
      notify('ready', 'first-ready');
      await wait(() =>
        phase === 'preflight'
          ? f.calls.slice(before).some(c => c.method === 'thread/read')
          : f.deliveries().length === 1
      );
      // The second query has a real terminal change, not a repeat of unchanged state.
      notify('waiting', 'second-blocked');
      notify('blocked', 'second-blocked');
      if (phase === 'accepted-send') f.end('completed');
      f.setGate(null);
      f.setDeliveryGate(null);
      release();
      await wait(() => f.deliveries().length === 1);
      if (phase === 'preflight') {
        await tick();
        f.end('completed');
      }
      await wait(() => f.deliveries().length === 2);
      const output = f.deliveries()[1].p.toolOutput;
      assert.match(output.output, /second-blocked/);
      assert.doesNotMatch(output.output, /first-ready/);
      assert.match(output.output, /保留受阻狀態/);
      assert.notEqual(output.name, 'k_native_goal_recovery');
      f.end('completed');
      await tick();
      assert.equal(f.deliveries().length, 2);
      assert.equal(
        f.calls.some(c => c.method === 'thread/goal/set'),
        false
      );
    } finally {
      release?.();
      await f.cleanup();
    }
  });

test('Gemini ready cancellation is rechecked after awaited native preflight', async () => {
  const f = await fixture();
  let release;
  try {
    await f.gateway.bridge.start({requestId: 'quota'});
    f.end('completed');
    f.setGate(new Promise(r => (release = r)));
    f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: ['quota'], status: 'ready', accountId: 'fake'});
    await tick();
    await f.c.goal({status: 'paused'});
    release();
    await tick();
    assert.equal(f.deliveries().length, 0);
  } finally {
    release?.();
    await f.cleanup();
  }
});

for (const action of ['native-takeover', 'human-send', 'goal-edit'])
  test('completed Gemini ready preflight ' + action + ' preserves unsent original results', async () => {
    const f = await fixture({persistGate: true});
    try {
      await f.gateway.bridge.start({requestId: 'quota'});
      f.end('completed');
      await tick();
      const row = {
        parentId: 'parent',
        provider: 'gemini',
        requestId: 'quota',
        status: 'failed',
        settled: true,
        output: 'saved original result'
      };
      f.setFlashRows([row]);
      f.disk.arm();
      f.bridgeHooks.onChange(row);
      f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: ['quota'], status: 'ready', accountId: 'fake'});
      await f.disk.entered.promise;
      if (action === 'native-takeover') f.nativeStart();
      if (action === 'human-send') await f.c.send({text: 'new human work'});
      if (action === 'goal-edit') await f.c.goal({objective: 'new intended objective', editOnly: true});
      f.disk.release.resolve();
      await tick();
      assert.equal(f.deliveries().length, 0);
      assert.equal((await listMainSessions(f.root)).sessions[0].workerNotifications.quota, undefined);
      if (action !== 'goal-edit') f.end('completed');
      else {
        await f.c.send({text: 'new human work'});
        f.end('completed');
      }
      await wait(() => f.deliveries().length === 1);
      assert.match(f.deliveries()[0].p.toolOutput.output, /saved original result/);
    } finally {
      f.disk.release.resolve();
      await f.cleanup();
    }
  });

test('Codex Gemini ready is consumed and its ready info resolved after completed-room notification', async () => {
  const f = await fixture();
  try {
    await f.gateway.bridge.start({requestId: 'quota'});
    f.end('completed');
    f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: ['quota'], status: 'ready', accountId: 'fake'});
    // The ready notice is resolved asynchronously just after delivery; wait for both, not delivery alone.
    const unresolvedReady = () =>
      f.c.state.notices.some(
        n => n.kind === 'gemini-handoff' && n.phase !== 'reviewing' && n.level === 'info' && !n.resolved
      );
    await wait(() => f.deliveries().length === 1 && !unresolvedReady());
    assert.equal(unresolvedReady(), false);
    assert.match(f.c.state.notices.find(n => n.phase === 'reviewing' && !n.resolved)?.message ?? '', /主代理已接續/);
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 1);
    assert.equal(
      f.c.state.notices.some(n => n.kind === 'gemini-handoff' && !n.resolved),
      false
    );
  } finally {
    await f.cleanup();
  }
});

test('Gemini quota recovery wakes a completed Codex room without a goal when native credits remain', async () => {
  const f = await fixture();
  try {
    await f.c.goal({clear: true});
    await f.gateway.bridge.start({requestId: 'quota'});
    const row = {
      parentId: 'parent',
      provider: 'gemini',
      requestId: 'quota',
      status: 'failed',
      settled: true,
      output: 'partial saved files must be checked',
      quotaCheckNeeded: true
    };
    f.setFlashRows([row]);
    f.c.state.usage.codex = codexQuota({
      rateLimits: {
        secondary: {usedPercent: 100, resetsAt: Date.now() / 1000 + 86400},
        credits: {hasCredits: true, unlimited: false, balance: '123.5'}
      }
    });
    f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: ['quota'], status: 'waiting'});
    f.end('completed');
    f.bridgeHooks.onChange(row);
    f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: ['quota'], status: 'ready', switched: true});
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.c.state.goal, null);
    assert.notEqual(f.deliveries()[0].p.toolOutput.name, 'k_native_goal_recovery');
    assert.match(f.deliveries()[0].p.toolOutput.output, /conversation_context/);
    assert.match(f.deliveries()[0].p.toolOutput.output, /partial saved files must be checked/);
    assert.match(f.deliveries()[0].p.toolOutput.output, /新的 requestId/);
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});

test('a new Gemini busy wait replaces an old ready banner while preserving its undelivered receipt', async () => {
  const f = await fixture();
  try {
    await f.gateway.bridge.start({requestId: 'quota'});
    f.c.state.usage.codex = codexQuota({
      rateLimits: {
        secondary: {
          usedPercent: 100,
          resetsAt: Date.now() / 1000 + 86400
        }
      }
    });
    f.end('completed');
    f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: ['quota'], status: 'ready', switched: true});
    await tick();
    assert.match(
      f.c.state.notices.findLast(n => n.kind === 'gemini-handoff' && !n.resolved).message,
      /Codex 主代理額度不足/
    );
    f.bridgeHooks.onGeminiHandoff({
      parentId: 'parent',
      requestIds: [],
      queryIds: ['account-query'],
      status: 'waiting',
      accountAvailable: true,
      busy: true
    });
    const visible = f.c.state.notices.filter(n => n.kind === 'gemini-handoff' && !n.resolved);
    assert.equal(visible.length, 1);
    assert.match(visible[0].message, /有可用額度.*忙碌/);
    assert.equal(f.deliveries().length, 0);
    f.emit('account/rateLimits/updated', {
      rateLimits: {
        secondary: {
          usedPercent: 100,
          resetsAt: Date.now() / 1000 + 86400
        },
        credits: {hasCredits: true}
      }
    });
    await wait(() => f.deliveries().length === 1);
    assert.match(f.deliveries()[0].p.toolOutput.output, /"quota"/);
    const receipt = JSON.parse(f.deliveries()[0].p.toolOutput.output.split('\n')[1]);
    assert.deepEqual(receipt.queryIds, []);
    assert.equal(receipt.events.find(e => e.queryIds.includes('account-query')).status, 'waiting');
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 1);
    assert.match(
      f.c.state.notices.findLast(n => n.kind === 'gemini-handoff' && !n.resolved).message,
      /有可用額度.*忙碌/
    );
  } finally {
    await f.cleanup();
  }
});

for (const action of ['stop', 'pause', 'human-send'])
  test('native credit recovery cannot revive revoked Gemini notification after ' + action, async () => {
    const f = await fixture();
    try {
      await f.gateway.bridge.start({requestId: 'quota'});
      f.c.state.usage.codex = codexQuota({
        rateLimits: {
          secondary: {
            usedPercent: 100,
            resetsAt: Date.now() / 1000 + 86400
          }
        }
      });
      f.end('completed');
      const callback = f.bridgeHooks.onGeminiHandoff;
      callback({parentId: 'parent', requestIds: ['quota'], status: 'ready', switched: true});
      await tick();
      if (action === 'stop') await f.c.stop();
      if (action === 'pause') await f.c.goal({status: 'paused'});
      if (action === 'human-send') {
        await f.c.send({text: 'new intent'});
        f.end('completed');
      }
      f.emit('account/rateLimits/updated', {rateLimits: {secondary: {usedPercent: 100}, credits: {hasCredits: true}}});
      callback({parentId: 'parent', requestIds: ['quota'], status: 'ready', switched: true});
      await tick();
      assert.equal(f.deliveries().length, 0);
    } finally {
      await f.cleanup();
    }
  });

test('Codex new human steer suppresses old account-ready callback', async () => {
  const f = await fixture();
  try {
    await f.gateway.bridge.start({requestId: 'quota'});
    const callback = f.bridgeHooks.onGeminiHandoff;
    callback({parentId: 'parent', requestIds: ['quota'], status: 'waiting'});
    assert.equal((await f.c.steer({text: 'new human correction'})).steered, true);
    f.end('completed');
    callback({parentId: 'parent', requestIds: ['quota'], status: 'ready', accountId: 'fake'});
    await tick();
    assert.equal(f.deliveries().length, 0);
  } finally {
    await f.cleanup();
  }
});

for (const switched of [false, true])
  test('Codex Gemini ready account facts match switched=' + switched, async () => {
    const f = await fixture();
    try {
      await f.gateway.bridge.start({requestId: 'not-started'});
      f.end('completed');
      f.bridgeHooks.onGeminiHandoff({
        parentId: 'parent',
        requestIds: ['not-started'],
        status: 'ready',
        accountId: 'fake-a',
        switched,
        reason: 'fixture official account check'
      });
      await wait(() => f.deliveries().length === 1);
      const text = f.deliveries()[0].p.toolOutput.output;
      assert.match(text, /handoffFrom/);
      assert.match(text, /新的 requestId/);
      assert.match(text, /fixture official account check/);
      if (switched) {
        assert.match(text, /官方額度確認歸零/);
        assert.match(text, /查核切換就緒/);
      } else {
        assert.doesNotMatch(text, /官方額度確認歸零|帳號已查核切換就緒/);
        assert.match(text, /本次通知未切換帳號/);
        assert.match(text, /不表示之前沒有其他聊天室換過帳號/);
        assert.match(text, /已執行後失敗/);
      }
    } finally {
      await f.cleanup();
    }
  });

test('completed Codex ready protocol rejection retains handoff explanation for existing safe requeue', async () => {
  const f = await fixture({reject: Object.assign(Error('confirmed not accepted'), {protocolMessage: 'rejected'})});
  try {
    await f.gateway.bridge.start({requestId: 'not-started'});
    f.end('completed');
    await tick();
    const row = {
      parentId: 'parent',
      provider: 'gemini',
      requestId: 'not-started',
      status: 'failed',
      settled: true,
      output: 'saved unsent original result'
    };
    f.setFlashRows([row]);
    f.bridgeHooks.onChange(row);
    f.bridgeHooks.onGeminiHandoff({
      parentId: 'parent',
      requestIds: ['not-started'],
      status: 'ready',
      accountId: 'fake-a',
      switched: false
    });
    await wait(() => f.deliveries().length === 1 && f.c.state.status === 'completed');
    f.setReject(null);
    f.nativeStart();
    f.end('completed');
    await wait(() => f.deliveries().length === 2);
    const text = f.deliveries()[1].p.toolOutput.output;
    assert.match(text, /handoffFrom/);
    assert.match(text, /not-started/);
    assert.match(text, /saved unsent original result/);
    assert.doesNotMatch(text, /官方額度確認歸零|帳號已查核切換就緒/);
  } finally {
    await f.cleanup();
  }
});

test('completed Codex ready transport ambiguity consumes the attempt and does not resend', async () => {
  const f = await fixture({reject: Error('transport unknown')});
  try {
    await f.gateway.bridge.start({requestId: 'not-started'});
    f.end('completed');
    f.bridgeHooks.onGeminiHandoff({
      parentId: 'parent',
      requestIds: ['not-started'],
      status: 'ready',
      accountId: 'fake-a',
      switched: false
    });
    await wait(() => f.deliveries().length === 1 && f.c.state.status === 'uncertain');
    f.setReject(null);
    await f.c.workers();
    await tick();
    assert.equal(f.deliveries().length, 1);
    assert.equal(
      f.c.state.notices.some(n => n.kind === 'gemini-handoff' && !n.resolved),
      false
    );
  } finally {
    await f.cleanup();
  }
});

test('Codex same-account mixed batch excludes executed failed work from ready scope', async () => {
  const f = await fixture();
  try {
    for (const requestId of ['rate-failed', 'not-started']) await f.gateway.bridge.start({requestId});
    f.end('completed');
    await tick();
    const rows = ['rate-failed', 'not-started'].map(requestId => ({
      parentId: 'parent',
      provider: 'gemini',
      requestId,
      status: 'failed',
      settled: true,
      output: 'saved ' + requestId
    }));
    f.setFlashRows(rows);
    for (const row of rows) f.bridgeHooks.onChange(row);
    f.bridgeHooks.onGeminiHandoff({
      parentId: 'parent',
      requestIds: ['not-started'],
      status: 'ready',
      accountId: 'fake-a',
      switched: false
    });
    await wait(() => f.deliveries().length === 1);
    const text = f.deliveries()[0].p.toolOutput.output;
    assert.match(text, /saved rate-failed/);
    assert.match(text, /saved not-started/);
    assert.deepEqual(JSON.parse(text.split('\n').find(line => line.startsWith('{"parentId"'))).requestIds, [
      'not-started'
    ]);
    assert.match(text, /本次就緒只涵蓋 event.requestIds 中先前未送出的工作/);
    assert.match(text, /其他已執行後失敗工單不因本次通知自動重啟/);
    assert.match(text, /接手僅限通知 requestIds 的剩餘工作/);
    assert.doesNotMatch(text, /官方額度確認歸零|帳號已查核切換就緒/);
  } finally {
    await f.cleanup();
  }
});

test('confirmed rejected ready waits for a new native turn completion, never timer or readback resend', async () => {
  const f = await fixture({
    reject: Object.assign(Error('still confirmed not accepted'), {protocolMessage: 'rejected'})
  });
  try {
    await f.gateway.bridge.start({requestId: 'not-started'});
    f.end('completed');
    await tick();
    const row = {
      parentId: 'parent',
      provider: 'gemini',
      requestId: 'not-started',
      status: 'failed',
      settled: true,
      output: 'saved original result'
    };
    f.setFlashRows([row]);
    f.bridgeHooks.onChange(row);
    f.bridgeHooks.onGeminiHandoff({
      parentId: 'parent',
      requestIds: ['not-started'],
      status: 'ready',
      accountId: 'fake-a',
      switched: false
    });
    await wait(() => f.deliveries().length === 1 && f.c.state.status === 'completed');
    await new Promise(r => setTimeout(r, 1250));
    assert.equal(f.deliveries().length, 1);
    await f.c.workers();
    f.emit('thread/goal/updated', {goal: structuredClone(f.goal)});
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 1, 'readback and duplicate old terminal do not authorize retry');
    f.nativeStart();
    f.end('completed');
    await wait(() => f.deliveries().length === 2 && f.c.state.status === 'completed');
    assert.match(f.deliveries()[1].p.toolOutput.output, /handoffFrom/);
    await new Promise(r => setTimeout(r, 1250));
    assert.equal(f.deliveries().length, 2, 'each new native completion authorizes only one attempt');
    f.setReject(null);
    f.nativeStart();
    f.end('completed');
    await wait(() => f.deliveries().length === 3);
    assert.match(f.deliveries()[2].p.toolOutput.output, /saved original result/);
    assert.match(f.deliveries()[2].p.toolOutput.output, /handoffFrom/);
  } finally {
    await f.cleanup();
  }
});

test('first ready with unknown workers still reconciles read-only and sends once when verified', async () => {
  const f = await fixture();
  try {
    await f.gateway.bridge.start({requestId: 'not-started'});
    f.end('completed');
    f.setUnknown(true);
    f.bridgeHooks.onGeminiHandoff({
      parentId: 'parent',
      requestIds: ['not-started'],
      status: 'ready',
      accountId: 'fake-a',
      switched: false
    });
    await new Promise(r => setTimeout(r, 1250));
    assert.equal(f.deliveries().length, 0);
    f.setUnknown(false);
    await wait(() => f.deliveries().length === 1);
    assert.match(f.deliveries()[0].p.toolOutput.output, /handoffFrom/);
    f.end('completed');
    await tick();
    assert.equal(f.deliveries().length, 1);
  } finally {
    await f.cleanup();
  }
});

test('reading ready while a blocked goal awaits an account preserves its trusted recovery receipt', async () => {
  const f = await fixture();
  try {
    await f.gateway.bridge.list();
    const event = {parentId: 'parent', requestIds: [], queryIds: ['query-wait'], accountId: 'B', switched: false};
    f.bridgeHooks.onGeminiHandoff({...event, status: 'waiting'});
    f.blockGoal();
    f.bridgeHooks.onGeminiHandoff({...event, status: 'ready'});
    f.gateway.bridge.resultReady(
      {requestId: 'query-wait'},
      {settled: true, scheduling: {status: 'ready', accountId: 'B'}}
    );
    f.end('completed');
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.deliveries()[0].p.toolOutput.name, 'k_native_goal_recovery');
    assert.equal(f.goal.status, 'blocked');
  } finally {
    await f.cleanup();
  }
});

for (const phase of ['attempted', 'invalidated'])
  for (const status of ['ready', 'blocked'])
    test(`a ${phase} account recovery does not retain a later ${status} wait receipt`, async () => {
      const f = await fixture();
      try {
        await f.gateway.bridge.list();
        const notify = (status, id) =>
          f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: [], queryIds: [id], accountId: 'B', status});
        notify('waiting', 'old-query');
        f.blockGoal();
        f.end('completed');
        notify('ready', 'old-query');
        await wait(() => f.deliveries().length === 1);
        await f.gateway.resumeGoal({}, {'x-codex-turn-metadata': {thread_id: 'parent', turn_id: f.currentTurn}});
        if (phase === 'invalidated') {
          f.end('completed');
          f.nativeStart();
        }
        notify('waiting', 'new-query');
        notify(status, 'new-query');
        f.gateway.bridge.resultReady({requestId: 'new-query'}, {settled: true, scheduling: {status, accountId: 'B'}});
        f.end('completed');
        await tick();
        assert.equal(f.deliveries().length, 1, 'already delivered new wait must not create a second notification turn');
      } finally {
        await f.cleanup();
      }
    });

test('pending trusted account recovery retains only its own IDs, not an unrelated delivered ready result', async () => {
  const f = await fixture();
  try {
    await f.gateway.bridge.list();
    const notify = (status, id) =>
      f.bridgeHooks.onGeminiHandoff({parentId: 'parent', requestIds: [], queryIds: [id], accountId: 'B', status});
    notify('waiting', 'held-query');
    f.blockGoal();
    notify('waiting', 'other-query');
    notify('ready', 'other-query');
    f.gateway.bridge.resultReady(
      {requestId: 'other-query'},
      {settled: true, scheduling: {status: 'ready', accountId: 'B'}}
    );
    notify('ready', 'held-query');
    f.end('completed');
    await wait(() => f.deliveries().length === 1);
    assert.equal(f.deliveries()[0].p.toolOutput.name, 'k_native_goal_recovery');
    assert.doesNotMatch(f.deliveries()[0].p.toolOutput.output, /other-query/);
  } finally {
    await f.cleanup();
  }
});
