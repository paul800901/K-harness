import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConversationController} from '../src/conversation-controller.mjs';
import {createDiscussionController} from '../src/discussion-controller.mjs';
import {saveMainSession, listMainSessions} from '../src/main-sessions.mjs';
import {remoteRouteAllowed} from '../src/remote-access.mjs';
import {saveAttachment} from '../src/desktop-files.mjs';
import {scratchBase} from './scratch.mjs';

const base = scratchBase;
const models = [
  {model: 'gpt-6.1-sol', displayName: 'Sol', provider: 'codex'},
  {model: 'claude-opus-5-5', displayName: 'Opus', provider: 'claude'},
  {model: 'gemini-3.8-flash', displayName: 'Flash', provider: 'gemini'}
].map(m => ({
  ...m,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [{reasoningEffort: 'medium'}, {reasoningEffort: 'high'}]
}));
async function fixture({hold = false, discussionApi, autoConfirm = true} = {}) {
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'discussion-rooms-'));
  let seq = 0;
  const answerPending = new Set();
  const owners = [],
    calls = [];
  const factory = ({onChange}) => {
    const state = {
      status: 'idle',
      workspace: root,
      messages: [],
      workers: [],
      questions: [],
      queuedMessages: [],
      busy: false,
      usage: {},
      model: 'gpt-6.1-sol',
      effort: 'medium',
      accessMode: 'workspace-write'
    };
    const c = {
      state,
      closed: 0,
      sent: [],
      async models() {
        return {models};
      },
      async selectWorkspace({path}) {
        state.workspace = path;
      },
      async open(data) {
        state.threadId = data.threadId ?? `room-${++seq}`;
        state.model = data.model;
        state.status = 'ready';
        await saveMainSession(root, state);
        onChange();
        return {threadId: state.threadId};
      },
      async workers() {
        return [];
      },
      async send(data) {
        c.sent.push(data);
        state.messages.push({id: `native-${c.sent.length}`, role: 'user', text: data.text});
        return {sent: true};
      },
      async stop() {
        state.busy = false;
        return {stopped: true};
      },
      async close() {
        c.closed++;
      },
      async metadata(data) {
        await saveMainSession(root, {...state, ...data});
        return data;
      },
      async selectModel(data) {
        state.model = data.model;
        return data;
      }
    };
    owners.push(c);
    return c;
  };
  const c = createConversationController({
    root,
    sessionFactory: factory,
    // These tests exercise the discussion after the brief; confirm it as soon as it is shown.
    discussionFactory: options => {
      const d = createDiscussionController({
        ...options,
        onChange() {
          options.onChange();
          if (autoConfirm && d?.state?.status === 'awaiting-confirmation')
            queueMicrotask(() => d.confirm().catch(() => {}));
        }
      });
      return d;
    },
    discussionApi,
    discussionSessionFactory: async ({selection, onIdentity}) => {
      await onIdentity({nativeSessionId: `discussion-${selection.id}`});
      return {
        async ask(prompt) {
          calls.push({id: selection.id, prompt});
          if (selection.id === 'host')
            return prompt.startsWith('你是本次多模型')
              ? '{"brief":"需求與修正"}'
              : '{"action":"finish","summary":"共識、分歧與未知都有保留。"}';
          if (hold)
            await new Promise((resolve, reject) => {
              answerPending.add(reject);
            });
          return `${selection.model} 原始答案`;
        },
        async close() {
          for (const reject of answerPending) reject(Error('stopped'));
          answerPending.clear();
        }
      };
    }
  });
  const a = await c.open({model: 'gpt-6.1-sol'}),
    owner = owners.find(o => o.state.threadId === a.threadId);
  const start = data =>
    c.discussionStart({
      ...a,
      mode: 'meeting',
      text: '議題',
      participants: [{model: 'gpt-6.1-sol'}, {model: 'claude-opus-5-5', effort: 'high'}],
      ...data
    });
  return {root, c, a, owner, owners, calls, start};
}
const settled = async f => {
  while (f.c.state.discussion?.busy) await new Promise(r => setTimeout(r, 5));
};

for (const model of ['gpt-6.1-sol', 'claude-opus-5-5'])
  test(`discussion context uses verified inherited ${model} attachment cards while explicit foreign IDs remain rejected`, async () => {
    const f = await fixture();
    try {
      f.owner.state.model = model;
      const a = await saveAttachment(f.root, 'source-parent', {
        name: '繼承.txt',
        base64: Buffer.from('INHERITED_DISCUSSION_FAKE_BODY').toString('base64')
      });
      f.owner.state.messages.push({
        id: 'inherited-user',
        role: 'user',
        text: '原房假附件',
        attachments: [{...a, workspace: f.root}]
      });
      await f.start();
      await settled(f);
      assert(f.calls.some(row => row.prompt.includes('INHERITED_DISCUSSION_FAKE_BODY')));
      const foreign = await saveAttachment(f.root, 'unrelated', {name: 'foreign.txt', base64: 'eA=='});
      await assert.rejects(f.start({attachmentIds: [foreign.id]}), /其他對話/);
      await assert.rejects(f.start({attachmentIds: [a.id]}), /其他對話/);
      assert.equal(f.owner.sent.length, 0);
    } finally {
      await f.c.close();
    }
  });

test('discussion entry and interjection are available to the paired phone; the existing stop route is reused', () => {
  for (const op of ['start', 'message', 'confirm'])
    assert.equal(remoteRouteAllowed('POST', `/api/discussion/${op}`), true);
  assert.equal(remoteRouteAllowed('POST', '/api/stop'), true);
  assert.equal(remoteRouteAllowed('POST', '/api/discussion/stop'), false);
  assert.equal(remoteRouteAllowed('POST', '/api/discussion/login'), false);
});

test('API participants validate separately without entering native main/sub catalogs or changing the native facilitator', async () => {
  const f = await fixture({
    discussionApi: {
      async resolve(p) {
        assert.equal(p.connectionId, 'fake-connection');
        return {...p, displayName: 'Independent API', effort: null};
      }
    }
  });
  try {
    await f.start({
      participants: [
        {route: 'api', connectionId: 'fake-connection', model: 'native-id-collision'},
        {model: 'claude-opus-5-5'}
      ]
    });
    await settled(f);
    assert.equal(f.c.state.discussion.participants[0].route, 'api');
    assert.equal(f.c.state.discussion.facilitator.model, 'gpt-6.1-sol');
    assert.equal(f.c.state.model, 'gpt-6.1-sol');
    assert(!(await f.c.models()).models.some(m => m.route === 'api'));
    await assert.rejects(
      f.start({participants: [{route: 'unknown', model: 'gpt-6.1-sol'}, {model: 'claude-opus-5-5'}]}),
      /路線無效/
    );
  } finally {
    await f.c.close();
  }
});

test('existing room directly starts a meeting, with no primary turn or extra sidebar/native registry rooms', async () => {
  const f = await fixture();
  try {
    f.owner.state.messages.push({id: 'original', role: 'assistant', text: '原房意見'});
    await f.start();
    await settled(f);
    assert.equal(f.c.state.threadId, f.a.threadId);
    assert.equal(f.owner.sent.length, 0);
    assert.equal((await listMainSessions(f.root)).sessions.length, 1);
    assert.equal(f.c.state.messages[0].text, '原房意見');
    assert.equal(f.c.state.messages.filter(m => m.model).length, 2);
    assert.equal(f.owner.state.messages.length, 1);
    assert.equal(f.c.state.discussion.status, 'completed');
  } finally {
    await f.c.close();
  }
});

test('new empty room can begin with comparison, then cross-review without a forced pipeline', async () => {
  const f = await fixture();
  try {
    await f.start({mode: 'parallel', includeContext: false});
    await settled(f);
    assert.equal(f.owner.sent.length, 0);
    assert.equal(f.c.state.discussion.mode, 'parallel');
    await f.start({mode: 'review', reviewTarget: '清楚的審查目標'});
    await settled(f);
    assert.equal(f.c.state.discussion.mode, 'review');
    assert.equal(f.c.state.messages.filter(m => m.summary).length, 2);
  } finally {
    await f.c.close();
  }
});

test('ordinary continuation sends a visible handoff once and does not replace native room identity', async () => {
  const f = await fixture();
  try {
    await f.start();
    await settled(f);
    await f.c.send({...f.a, text: '回到一般工作，只解釋尚未決定的取捨'});
    await f.c.send({...f.a, text: '下一題'});
    assert.match(f.owner.sent[0].text, /K 多模型討論交接/);
    assert.equal(f.owner.sent[1].text, '下一題');
    assert.equal(f.owner.state.threadId, f.a.threadId);
  } finally {
    await f.c.close();
  }
});

test('model effort choices come from the actual catalog, with no hard-coded tiers or silent replacement', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.start({participants: [{model: 'missing'}, {model: 'claude-opus-5-5'}]}), /原生清單/);
    await assert.rejects(
      f.start({participants: [{model: 'gpt-6.1-sol', effort: 'invented'}, {model: 'claude-opus-5-5'}]}),
      /推理程度/
    );
    assert.equal(f.calls.length, 0);
    await f.start();
    await settled(f);
    assert.equal(f.c.state.discussion.participants[1].effort, 'high');
  } finally {
    await f.c.close();
  }
});

test('an active native goal, queue, or approval prevents a new meeting without stopping or replaying it', async () => {
  const f = await fixture();
  try {
    for (const extra of [
      {busy: true},
      {questions: [{id: 'approval'}]},
      {queuedMessages: [{text: 'waiting'}]},
      {capabilities: {goalContinuesWhileIdle: true}, goal: {status: 'active'}}
    ]) {
      const prior = structuredClone(f.owner.state);
      Object.assign(f.owner.state, extra);
      await assert.rejects(f.start(), /原工作/);
      Object.assign(f.owner.state, prior);
      for (const key of Object.keys(extra)) if (!Object.hasOwn(prior, key)) delete f.owner.state[key];
    }
    assert.equal(f.calls.length, 0);
  } finally {
    await f.c.close();
  }
});

test('discussion preparation does not block plain viewing but keeps mutations locked', async () => {
  const f = await fixture(),
    entered = Promise.withResolvers(),
    read = Promise.withResolvers();
  let starting;
  try {
    const other = await f.c.open({model: 'gpt-6.1-sol'});
    f.owner.workers = async () => {
      entered.resolve();
      return read.promise;
    };
    starting = f.start();
    await entered.promise;
    await f.c.open({...f.a, model: 'gpt-6.1-sol'});
    assert.equal(f.c.state.threadId, f.a.threadId);
    await assert.rejects(f.c.open({...f.a, model: 'gpt-6.1-sol', effort: 'high'}), /正在更新/);
    await assert.rejects(f.c.send({...f.a, text: 'not sent'}), /重新連線或建立分支/);
    await f.c.open({...other, model: 'gpt-6.1-sol'});
    assert.equal(f.c.state.threadId, other.threadId);
    read.resolve([]);
    await starting;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(f.owner.sent.length, 0);
    assert.equal(f.c.state.threadId, other.threadId);
  } finally {
    read.resolve([]);
    await starting;
    await f.c.close();
  }
});

test('a confirmed not-sent result restores the handoff, while unknown failures do not replay it', async () => {
  const f = await fixture();
  try {
    await f.start();
    await settled(f);
    const send = f.owner.send;
    f.owner.send = async () => ({sent: false});
    await f.c.send({...f.a, text: '已確認未送出'});
    f.owner.send = send;
    await f.c.send({...f.a, text: '新的一則指示'});
    assert.match(f.owner.sent.at(-1).text, /K 多模型討論交接/);
  } finally {
    await f.c.close();
  }
});

test('a meeting in A survives navigation and idle reclamation; stopping A does not stop or submit to B', async () => {
  const f = await fixture({hold: true});
  try {
    await f.start();
    while (f.calls.filter(c => c.id !== 'host').length < 2) await new Promise(r => setTimeout(r, 5));
    for (let i = 0; i < 5; i++) await f.c.open({model: 'gpt-6.1-sol'});
    const b = f.c.state.threadId;
    assert.notEqual(b, f.a.threadId);
    assert.equal(f.owner.closed, 0);
    assert(f.c.state.conversationActivity.some(row => row.threadId === f.a.threadId && row.busy));
    assert.throws(() => f.c.compact(f.a), /討論/);
    await assert.rejects(f.c.metadata({...f.a, archived: true}), /討論/);
    await f.c.discussionMessage({...f.a, text: '給 A 的補充', target: 'p2'});
    await f.c.stop(f.a);
    assert.equal(f.c.state.threadId, b);
    assert.equal(f.c.state.busy, false);
    assert.equal(f.owners.find(o => o.state.threadId === b).sent.length, 0);
    await f.c.open({...f.a, model: 'gpt-6.1-sol'});
    assert.equal(f.c.state.discussion.status, 'interrupted');
    assert(f.c.state.messages.some(m => m.text === '給 A 的補充'));
  } finally {
    await f.c.close();
  }
});

test('starting discussion in a hidden room cancels its pending idle probe without navigation', async () => {
  const f = await fixture({hold: true}),
    entered = Promise.withResolvers(),
    read = Promise.withResolvers();
  let reads = 0;
  try {
    for (let i = 0; i < 3; i++) await f.c.open({model: 'gpt-6.1-sol'});
    f.owner.workers = async () => {
      if (++reads === 1) {
        entered.resolve();
        return read.promise;
      }
      return [];
    };
    const other = await f.c.open({model: 'gpt-6.1-sol'});
    await entered.promise;
    await f.start();
    assert.equal(f.c.state.threadId, other.threadId);
    read.resolve([]);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(f.owner.closed, 0);
    assert(f.c.state.conversationActivity.some(row => row.threadId === f.a.threadId && row.busy));
    await f.c.discussionMessage({...f.a, text: '原聊天室補充', target: 'p2'});
    await f.c.stop(f.a);
    assert.equal(f.c.state.threadId, other.threadId);
    assert.equal(f.owner.closed, 0);
    assert.equal(f.owner.sent.length, 0);
    assert.equal(f.owners.find(o => o.state.threadId === other.threadId).sent.length, 0);
  } finally {
    read.resolve([]);
    await f.c.close();
  }
});

test('a room waiting on its brief is flagged for the person, refuses other input, and confirm or cancel releases it', async () => {
  for (const finish of ['confirm', 'cancel']) {
    const f = await fixture({autoConfirm: false});
    try {
      await f.start();
      while (f.c.state.discussion?.status !== 'awaiting-confirmation') await new Promise(r => setTimeout(r, 5));
      const activity = f.c.state.conversationActivity.find(row => row.threadId === f.a.threadId);
      assert.equal(activity.pendingQuestions, 1, 'the sidebar shows the room is waiting for the person');
      await assert.rejects(f.c.discussionMessage({...f.a, text: '補充'}), /任務書等待確認中/);
      await assert.rejects(f.c.steer({...f.a, text: '一般插話'}));
      assert.equal(f.calls.filter(call => call.id !== 'host').length, 0);
      if (finish === 'confirm') await f.c.discussionConfirm(f.a);
      else await f.c.stop(f.a);
      await settled(f);
      assert.equal(f.c.state.discussion.status, finish === 'confirm' ? 'completed' : 'interrupted');
      assert.equal(f.calls.filter(call => call.id !== 'host').length, finish === 'confirm' ? 2 : 0);
      assert.equal(f.c.state.busy, false);
    } finally {
      await f.c.close();
    }
  }
});
