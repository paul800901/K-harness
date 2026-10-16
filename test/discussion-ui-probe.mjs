// Built React + HTTP/SSE + actual discussion controller. Native model responses
// are synthetic here; subscription evidence is recorded separately.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';

const out = probeEvidenceDir('discussion-evidence');
await mkdir(out, {recursive: true});
const root = await mkdtemp(path.join(out, 'ui-'));
const models = [
  ['gpt-6.1-sol', 'GPT-6.1 Sol', 'codex'],
  ['claude-opus-5-5', 'Claude Opus 5.5', 'claude'],
  ['gemini-3.8-flash', 'Gemini 3.8 Flash', 'gemini']
].map(([model, displayName, provider]) => ({
  model,
  displayName,
  provider,
  available: true,
  inputModalities: ['text'],
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [{reasoningEffort: 'medium'}, {reasoningEffort: 'high'}]
}));
let seq = 0,
  slow = false,
  noMark = false,
  nextBrief = '原始需求與重要修正已帶入。';
const calls = [],
  pending = new Set();
const nativeFactory = ({onChange}) => {
  const state = {
    status: 'idle',
    workspace: root,
    model: 'gpt-6.1-sol',
    provider: 'codex',
    modelDisplayName: 'GPT-6.1 Sol',
    effort: 'medium',
    efforts: ['medium', 'high'],
    inputModalities: ['text'],
    accessMode: 'workspace-write',
    messages: [],
    questions: [],
    workers: [],
    tools: [],
    artifacts: [],
    busy: false,
    queuedMessages: [],
    progress: {},
    usage: {},
    capabilities: {goal: false, fileSearch: false},
    browserAccess: {enabled: false}
  };
  return {
    state,
    models: async () => ({models}),
    usage: async () => ({}),
    async workers() {
      return [];
    },
    async selectWorkspace({path}) {
      state.workspace = path;
    },
    async open(data) {
      state.threadId = data.threadId ?? `ui-room-${++seq}`;
      state.model = data.model;
      state.status = 'ready';
      await saveMainSession(root, state);
      onChange();
      return {threadId: state.threadId};
    },
    async send(data) {
      calls.push({op: 'native-send', ...data});
      state.messages.push({
        id: `native-${calls.length}`,
        role: 'user',
        text: data.text,
        createdAt: new Date().toISOString()
      });
      onChange();
      // With discussion settings armed, the fake main model answers with a brief and the start mark.
      if (data.text.includes('K 討論設定')) {
        Object.assign(state, {busy: true, status: 'working'});
        setTimeout(() => {
          state.messages.push({
            id: `reply-${calls.length}`,
            role: 'assistant',
            text: noMark ? '好的，先不開始討論。' : `${nextBrief}\n\n\`\`\`k-discussion\nstart\n\`\`\``,
            createdAt: new Date().toISOString()
          });
          Object.assign(state, {busy: false, status: 'completed'});
          onChange();
        }, 20);
      } else {
        state.messages.push({id: `ordinary-${calls.length}`, role: 'assistant', text: '主模型已確認，沒有開新討論。'});
        onChange();
      }
      return {sent: true};
    },
    async askHost(prompt, {id, bind}) {
      await bind({groupId: id, messageId: id + '-user'});
      state.messages.push({id: id + '-user', role: 'user', groupId: id, text: prompt});
      const host = await discussionFactory({selection: {id: 'host', model: state.model}});
      const output = await host.ask(prompt);
      state.messages.push({id: id + '-reply', role: 'assistant', groupId: id, text: output});
      return output;
    },
    async stop() {
      return {stopped: true};
    },
    async close() {},
    async metadata(data) {
      await saveMainSession(root, {...state, ...data});
      return data;
    }
  };
};
const discussionFactory = async ({selection}) => ({
  async ask(prompt) {
    calls.push({op: 'discussion', id: selection.id, prompt});
    if (selection.id === 'host')
      return prompt.includes('平行比較直接整理')
        ? '## 共識\n目標清楚。\n## 分歧\nSol 偏重速度，Opus 偏重資訊。\n## 未知\n仍需查證。'
        : JSON.stringify({
            action: 'finish',
            summary: '## 共識\n目標清楚。\n## 分歧\nSol 偏重速度，Opus 偏重資訊。\n## 未知\n仍需查證。'
          });
    if (slow) await new Promise((resolve, reject) => pending.add(reject));
    return selection.id === 'p1' ? 'Sol 的原始觀點：重視速度。' : 'Opus 的原始觀點：重視資訊。';
  },
  async close() {
    for (const reject of pending) reject(Error('fake native stopped'));
    pending.clear();
  }
});
const login = () => ({
  status: async () => ({
    available: true,
    auth: {loggedIn: true, authMethod: 'chatgpt', planType: 'Plus'},
    login: {status: 'idle'}
  }),
  state: {status: 'idle'},
  close: async () => {}
});
let browser, app;
try {
  app = await startDesktop({
    root,
    port: 0,
    controllerFactory: opts =>
      createConversationController({
        ...opts,
        sessionFactory: nativeFactory,
        discussionSessionFactory: discussionFactory
      }),
    claudeLoginFactory: login,
    codexLoginFactory: login,
    geminiLoginFactory: login,
    localDictationFactory: () => ({state: {available: false}, close: async () => {}})
  });
  const a = await app.controller.open({model: 'gpt-6.1-sol'});
  browser = await launchProbeBrowser();
  const page = await browser.newPage({viewport: {width: 1440, height: 980}}),
    errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(app.createLaunchUrl());
  const mode = page.getByLabel('對話模式', {exact: true});
  await mode.waitFor();
  await mode.selectOption('parallel');
  await page.getByLabel('參與模型 2', {exact: true}).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="參與模型 2"]').value === 'native:claude-opus-5-5'
  );
  // Settings remain armed while planning; an ordinary reply without a start mark does not consume them.
  noMark = true;
  for (const text of ['先確認討論目的', '再確認討論材料']) {
    const replies = await page.getByText('好的，先不開始討論。', {exact: true}).count();
    await page.getByLabel('工作訊息', {exact: true}).fill(text);
    await page.getByRole('button', {name: '送出訊息', exact: true}).click();
    await page.getByText('好的，先不開始討論。', {exact: true}).nth(replies).waitFor();
    assert.equal(await mode.inputValue(), 'parallel');
    assert.match(calls.filter(c => c.op === 'native-send').at(-1).text, /K 討論設定/u);
  }
  noMark = false;
  await page.getByLabel('工作訊息', {exact: true}).fill('請比較速度與資訊的取捨');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  // The settings ride with the message to the main model; its brief starts the discussion.
  assert.match(calls.filter(c => c.op === 'native-send').at(-1).text, /K 討論設定.*平行比較/su);
  assert.equal(await page.getByText('K 討論設定', {exact: false}).count(), 0, 'the person sees only their own words');
  await page.getByText('主模型標記：開始討論', {exact: true}).first().waitFor();
  assert.equal(await page.getByText('k-discussion', {exact: false}).count(), 0, 'the start mark reads as a note');
  await page.getByText('Sol 的原始觀點：重視速度。', {exact: true}).waitFor();
  await page.getByText('Opus 的原始觀點：重視資訊。', {exact: true}).waitFor();
  await page.getByRole('heading', {name: '分歧', exact: true}).first().waitFor();
  assert.equal(await mode.inputValue(), 'normal', 'a finished discussion defaults the next turn to ordinary chat');
  const saved = await page.evaluate(id => JSON.parse(sessionStorage.getItem(`k-discussion:${id}`)), a.threadId);
  assert.equal(saved.mode, 'normal');
  assert.equal(saved.participants.length, 2, 'reset must keep participant choices');
  const discussionCount = calls.filter(c => c.op === 'discussion').length;
  await page.getByLabel('工作訊息', {exact: true}).fill('只跟主模型確認剛才的結論');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  await page.getByText('主模型已確認，沒有開新討論。', {exact: true}).waitFor();
  const ordinary = calls.find(c => c.op === 'native-send' && c.text.includes('只跟主模型確認剛才的結論'));
  assert(ordinary, 'the checked native request must be this ordinary message, not an earlier turn');
  assert.doesNotMatch(ordinary.text, /K 討論設定/u);
  assert.equal(calls.filter(c => c.op === 'discussion').length, discussionCount);
  assert.equal((await app.controller.sessions()).sessions.length, 1);
  await page.screenshot({path: path.join(out, 'discussion-desktop.png')});
  await mode.selectOption('review');
  await page.reload();
  await mode.waitFor();
  assert.equal(await mode.inputValue(), 'review', 'reselecting after the same completed run survives reload');
  nextBrief = '要審查的指定方案：首頁建議全文。';
  await page.getByLabel('工作訊息', {exact: true}).fill('請審查指定方案');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  await page.waitForFunction(
    () => document.querySelector('.discussion-toolbar small')?.textContent === '上一場：交叉審查 · 已整理'
  );
  assert.equal(await mode.inputValue(), 'normal');
  assert(calls.filter(c => c.id === 'p2').some(c => c.prompt.includes('要審查的指定方案')));
  // Simulate returning after another run completed while this tab was away.
  await page.evaluate(
    ({id, saved}) => {
      sessionStorage.setItem(`k-discussion:${id}`, JSON.stringify({...saved, mode: 'meeting', target: 'p2'}));
      sessionStorage.setItem('k-discussion:other-room', JSON.stringify({mode: 'review', participants: []}));
    },
    {id: a.threadId, saved}
  );
  await page.reload();
  await mode.waitFor();
  assert.equal(await mode.inputValue(), 'normal', 'a different completed run consumes stale saved settings');
  assert.equal(
    await page.evaluate(id => JSON.parse(sessionStorage.getItem(`k-discussion:${id}`)).target, a.threadId),
    undefined
  );
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('k-discussion:other-room')).mode), 'review');
  await mode.selectOption('meeting');
  await page.getByLabel('工作訊息', {exact: true}).fill('完成一場多人討論');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  await page.waitForFunction(
    () => document.querySelector('.discussion-toolbar small')?.textContent === '上一場：多人討論 · 已整理'
  );
  assert.equal(await mode.inputValue(), 'normal');
  await mode.selectOption('meeting');
  slow = true;
  await page.getByLabel('工作訊息', {exact: true}).fill('開始一場需要插話的討論');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  await page.getByLabel('補充給', {exact: true}).waitFor();
  assert.equal(await mode.inputValue(), 'meeting', 'the live mode stays visible while next-turn settings are normal');
  assert.equal(await mode.isDisabled(), true);
  await page.getByLabel('補充給', {exact: true}).selectOption('p2');
  await page.getByLabel('工作訊息', {exact: true}).fill('請 Opus 注意新增限制');
  await page.getByRole('button', {name: '送出訊息（加入待送）', exact: true}).click();
  await page.locator('.discussion-roundtable-interjection').filter({hasText: '請 Opus 注意新增限制'}).waitFor();
  await page.getByRole('button', {name: '停止工作', exact: true}).click();
  await page.waitForFunction(
    () => document.querySelector('.discussion-toolbar small')?.textContent === '上一場：多人討論 · 已停止'
  );
  assert.equal(await mode.inputValue(), 'normal');
  slow = false;
  // A reply without the start mark only answers; no discussion starts.
  const askedBefore = calls.filter(c => ['p1', 'p2'].includes(c.id)).length;
  noMark = true;
  await mode.selectOption('meeting');
  await page.getByLabel('工作訊息', {exact: true}).fill('先聊聊，不用討論');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  await page.getByText('好的，先不開始討論。', {exact: true}).last().waitFor();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(calls.filter(c => ['p1', 'p2'].includes(c.id)).length, askedBefore);
  noMark = false;
  await mode.selectOption('normal');
  await page.getByLabel('工作訊息', {exact: true}).fill('回到單模型，先不要實作');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  await page.waitForFunction(() =>
    document.querySelector('.user-bubble')?.closest('.thread')?.textContent.includes('已帶入前段討論')
  );
  assert(
    calls
      .filter(c => c.op === 'native-send')
      .at(-1)
      .text.includes('回到單模型，先不要實作')
  );
  const closeSidebar = page.getByRole('button', {name: '收合側欄', exact: true});
  if (await closeSidebar.isVisible()) await closeSidebar.click();
  await page.setViewportSize({width: 390, height: 844});
  const back = page.getByRole('button', {name: '回到聊天室', exact: true});
  if (await back.isVisible()) {
    await back.click();
    await page.waitForFunction(() => !history.state?.kMobilePanel);
  }
  await mode.selectOption('meeting');
  await page.screenshot({path: path.join(out, 'discussion-mobile.png')});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  const sendBounds = await page.getByRole('button', {name: '送出訊息', exact: true}).boundingBox();
  assert(sendBounds.y + sendBounds.height <= 844, 'expanded mobile settings must leave the send control reachable');
  await writeFile(
    path.join(out, 'ui-result.json'),
    JSON.stringify(
      {
        status: 'passed',
        room: a.threadId,
        errors,
        checks: [
          'existing room',
          'all modes',
          'all original model messages visible',
          'settings ride with the message; brief from the main model starts the discussion',
          'no start mark, no discussion',
          'all three completed modes and stopped discussion default to ordinary chat',
          'next ordinary message carries no discussion settings and starts no participants',
          'explicit rearm survives reload; stale run settings reset without touching other rooms',
          'targeted interjection',
          'whole discussion stop',
          'ordinary handoff',
          '390px no overflow'
        ]
      },
      null,
      2
    )
  );
  console.log('Discussion desktop/mobile UI passed');
} finally {
  await browser?.close();
  await app?.close();
}
