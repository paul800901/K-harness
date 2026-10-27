// Built UI and HTTP/SSE; model answers are synthetic, not subscription turns.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';
const out = probeEvidenceDir('quota-speaker-evidence');
await mkdir(out, {recursive: true});
const root = await mkdtemp(path.join(out, 'ui-'));
const models = [
  ['gpt-6.1-sol', 'GPT-6.1 Sol', 'codex'],
  ['claude-opus-5-5', 'Claude Opus 5.5', 'claude'],
  ['gemini-3.8-flash', 'Gemini 3.8 Flash', 'gemini'],
  ['gpt-6-luna', 'GPT-6 Luna', 'codex']
].map(([model, displayName, provider]) => ({
  model,
  displayName,
  provider,
  available: true,
  inputModalities: ['text'],
  defaultReasoningEffort: 'high',
  supportedReasoningEfforts: [{reasoningEffort: 'high'}]
}));
let seq = 0,
  long = false;
const calls = [];
const noMark = false,
  nextBrief = '這是帶日期的背景摘要，不是系統通知。';
const nativeFactory = ({onChange, prepareHumanSend}) => {
  const state = {
    status: 'idle',
    workspace: root,
    model: 'gpt-6.1-sol',
    provider: 'codex',
    modelDisplayName: 'GPT-6.1 Sol',
    effort: 'high',
    efforts: ['high'],
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
      state.threadId = data.threadId ?? `speaker-room-${++seq}`;
      state.model = data.model;
      state.status = 'ready';
      await saveMainSession(root, state);
      onChange();
      return {threadId: state.threadId};
    },
    async send(data) {
      const prepared = await prepareHumanSend(data);
      data = {...data, text: prepared?.text ?? data.text};
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
    calls.push({op: 'discussion', model: selection.model});
    if (selection.id === 'host') return '## 共識\n保留正文可讀性。\n## 分歧\n不同意見仍保留。\n## 未知\n待查證。';
    const name = selection.displayName ?? selection.model;
    return `這是 ${name} 的意見。\n\n${long ? Array.from({length: 40}, (_, i) => `第 ${i + 1} 段：這是長文測試，內容與樣式不冒充真實模型結論。正文保持原有深色字，發言者由全名與細線識別。`).join('\n\n') : '保留自己的理由與不同意見，不硬湊共識。'}`;
  },
  async close() {}
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
  await app.controller.open({model: 'gpt-6.1-sol'});
  browser = await launchProbeBrowser();
  const page = await browser.newPage({viewport: {width: 1440, height: 980}}),
    errors = [],
    checks = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(app.createLaunchUrl());
  const mode = page.getByLabel('對話模式', {exact: true});
  await mode.waitFor();
  await mode.selectOption('parallel');
  // Native subscription models are listed as native:<model>, alongside api:<connection> choices.
  await page.getByLabel('參與模型 2', {exact: true}).selectOption('native:claude-opus-5-5');
  await page.getByRole('button', {name: '加入參與者', exact: true}).click();
  await page.getByLabel('參與模型 3', {exact: true}).selectOption('native:gemini-3.8-flash');
  await page.getByRole('button', {name: '加入參與者', exact: true}).click();
  await page.getByLabel('參與模型 4', {exact: true}).selectOption('native:gpt-6-luna');
  await page.getByLabel('工作訊息', {exact: true}).fill('比較各模型的意見');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  await page.getByRole('heading', {name: '分歧', exact: true}).waitFor();
  for (const [size, width, height] of [
    ['desktop', 1440, 980],
    ['mobile', 390, 844]
  ]) {
    if (size === 'mobile') {
      const closeSidebar = page.getByRole('button', {name: '收合側欄', exact: true});
      if (await closeSidebar.isVisible()) await closeSidebar.click();
    }
    await page.setViewportSize({width, height});
    if (size === 'mobile') await page.getByLabel('批次', {exact: true}).selectOption('1');
    for (const theme of ['warm', 'light', 'dark']) {
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      assert.equal(await page.locator('.discussion-roundtable-entry').count(), 1);
      assert.equal(await page.locator('.discussion-message').count(), 1);
      for (const m of models)
        assert((await page.locator('.discussion-roundtable').innerText()).includes(m.displayName));
      const colors = await page
        .locator(size === 'mobile' ? '.discussion-roundtable-markdown' : '.discussion-roundtable-cell p')
        .evaluateAll(nodes => nodes.map(n => getComputedStyle(n).color));
      assert.equal(new Set(colors).size, 1, 'speaker colors remain in small markers, not report text');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({path: path.join(out, size + '-' + theme + '.png')});
      checks.push({size, theme, colors});
    }
  }
  await page.getByRole('button', {name: '回到聊天室', exact: true}).click();
  await page.waitForFunction(() => !history.state?.kMobilePanel);
  long = true;
  assert.equal(await mode.inputValue(), 'normal', 'a new comparison needs an explicit mode selection');
  await mode.selectOption('parallel');
  await page.getByLabel('工作訊息', {exact: true}).fill('請提供長文以驗證持續辨識');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.discussion-roundtable-entry').length === 2 &&
      document.querySelectorAll('.discussion-message').length === 2
  );
  await page.getByRole('button', {name: '開啟圓桌', exact: true}).last().click();
  await page.getByLabel('批次', {exact: true}).selectOption('1');
  await page.getByRole('button', {name: '翻到 Claude Opus 5.5', exact: true}).click();
  await page
    .locator('.discussion-roundtable-page')
    .filter({hasText: '這是 Claude Opus 5.5 的意見。'})
    .locator('header button')
    .click();
  assert(
    await page
      .locator('.discussion-roundtable-reader .discussion-roundtable-full')
      .evaluate(n => n.scrollHeight > n.clientHeight)
  );
  assert((await page.locator('.discussion-roundtable-reader').innerText()).includes('第 40 段'));
  await page.screenshot({path: path.join(out, 'mobile-long-text.png')});
  await page.getByRole('button', {name: '回到格子', exact: true}).click();
  await page.locator('.discussion-roundtable-pages').waitFor();
  await page.getByRole('button', {name: '回到聊天室', exact: true}).click();
  await page.waitForFunction(() => !history.state?.kMobilePanel);
  await mode.selectOption('normal');
  await page.getByLabel('工作訊息', {exact: true}).fill('回到一般對話');
  await page.getByRole('button', {name: '送出訊息', exact: true}).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.user-bubble')].some(n => n.textContent.includes('回到一般對話'))
  );
  assert.equal((await app.controller.sessions()).sessions.length, 1);
  assert(calls.some(c => c.op === 'native-send'));
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, 'ui-result.json'),
    JSON.stringify(
      {
        status: 'passed',
        syntheticModelAnswers: true,
        checks,
        longText: true,
        sameProviderNames: true,
        ordinaryConversation: true,
        errors
      },
      null,
      2
    )
  );
  console.log('Speaker desktop/mobile three-theme built UI passed');
} finally {
  await browser?.close();
  await app?.close();
}
