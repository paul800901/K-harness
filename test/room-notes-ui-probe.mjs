// Built UI + real K room-notes inbox and unified send path, fake native controller only.
// No provider, K Chrome or production requests.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {preview} from 'vite';
import {createRoomNotes} from '../src/room-notes.mjs';
import {createUnifiedController} from '../src/unified-controller.mjs';
import {ROOM_NOTES_HEADER} from '../shared/room-notes.mjs';

const output = probeEvidenceDir('room-notes-20261022');
await mkdir(output, {recursive: true});
const server = await preview({preview: {host: '127.0.0.1', port: 5238, strictPort: true}}),
  results = [],
  errors = [];
let browser;
try {
  browser = await launchProbeBrowser();
  for (const [width, height, scale, theme] of [
    [1920, 1080, 100, 'warm'],
    [1100, 760, 125, 'light'],
    [390, 844, 100, 'dark']
  ]) {
    const page = await browser.newPage({viewport: {width, height}});
    page.setDefaultTimeout(7000);
    page.on('pageerror', e => errors.push(e.message));
    const workspace = await mkdtemp(path.join(output, 'fake-')),
      sends = [];
    const native = {
      state: {
        status: 'idle',
        threadId: null,
        title: '目標房',
        workspace,
        model: 'gpt-6.1-sol',
        busy: false,
        messages: [],
        tools: [],
        questions: [],
        artifacts: [],
        workers: [],
        notices: [],
        accessMode: 'workspace-write',
        capabilities: {steer: true}
      },
      async models() {
        return {models: []};
      },
      async open() {
        Object.assign(native.state, {status: 'ready', threadId: 'fake-target'});
        return {threadId: 'fake-target'};
      },
      async selectWorkspace() {},
      async workers() {
        return [];
      },
      async send(data) {
        sends.push(data);
        native.state.messages = [
          ...native.state.messages,
          {id: `user-${sends.length}`, role: 'user', text: data.text, createdAt: new Date().toISOString()}
        ];
        native.state.status = 'completed';
        return {sent: true};
      },
      async close() {}
    };
    let live = false;
    const notes = createRoomNotes({root: workspace, onChange: () => void emit().catch(e => errors.push(e.message))});
    const unified = createUnifiedController({root: workspace, roomNotes: notes, codexFactory: () => native});
    const snapshot = () => ({...unified.state, conversationActivity: [{threadId: 'fake-target', busy: false}]});
    const emit = async () => {
      if (live)
        await page.evaluate(
          state => window.testStream?.onmessage?.({data: JSON.stringify({type: 'snapshot', state})}),
          snapshot()
        );
    };
    await unified.open({model: 'gpt-6.1-sol'});
    const source = {fromThreadId: 'fake-source', fromTitle: '來源房：後端重構', fromProvider: 'claude'};
    await notes.add('fake-target', {...source, text: '請先不要改 schema，等我這邊遷移完成。'});
    const long = await notes.add('fake-target', {...source, text: '長訊息開頭。' + '細節'.repeat(300)});
    await page.addInitScript(
      ({state, scale, theme}) => {
        localStorage.setItem('k-appearance', JSON.stringify({interfaceScale: scale, dialogueFontSize: 18}));
        localStorage.setItem('k-color-theme', theme);
        window.EventSource = class {
          constructor() {
            window.testStream = this;
            setTimeout(() => this.onmessage?.({data: JSON.stringify({type: 'snapshot', state})}), 0);
          }
          close() {}
        };
      },
      {state: snapshot(), scale, theme}
    );
    const posts = [];
    await page.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') {
        const data = route.request().postDataJSON();
        posts.push({endpoint, data});
        try {
          let result;
          if (endpoint === '/api/room-notes') result = await unified.roomNote(data);
          else if (endpoint === '/api/send') result = await unified.send(data);
          else if (['/api/open', '/api/attention/read'].includes(endpoint)) result = {};
          else throw Error(`Unexpected write ${endpoint}`);
          await emit();
          await route.fulfill({json: result});
        } catch (error) {
          await route.fulfill({status: 400, json: {error: error.message}});
        }
        return;
      }
      const json =
        endpoint === '/api/state'
          ? snapshot()
          : endpoint === '/api/projects'
            ? {projects: [{path: workspace, name: '測試工作區'}]}
            : endpoint === '/api/sessions'
              ? {sessions: [{threadId: 'fake-target', title: '目標房', workspace, model: 'gpt-6.1-sol'}]}
              : endpoint === '/api/models'
                ? {models: [{model: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', provider: 'codex'}]}
                : {};
      await route.fulfill({json});
    });
    try {
      await page.goto('http://127.0.0.1:5238');
      live = true;
      const card = page.locator('section.room-notes');
      await card.getByText('協調訊息 2 則', {exact: true}).waitFor();
      await card.getByText('下一則送出時一併帶入', {exact: false}).waitFor();
      assert.equal(await card.locator('.room-note').count(), 2);
      assert.equal(await card.locator('.room-note-head span').first().textContent(), '來自「來源房：後端重構」');
      const longNote = card.locator('.room-note').nth(1);
      assert.equal(await longNote.locator('details').count(), 1, 'long notes are folded');
      assert.equal(await longNote.locator('details').evaluate(e => e.open), false);
      const geometry = await card.evaluate(e => {
        const r = e.getBoundingClientRect(),
          composer = document.querySelector('.composer-card').getBoundingClientRect();
        return {above: r.bottom <= composer.top + 1, overflow: e.scrollWidth > e.clientWidth + 1};
      });
      assert(geometry.above && !geometry.overflow, JSON.stringify(geometry));
      await page.screenshot({path: path.join(output, `${width}-${theme}-card.png`)});

      await longNote.getByRole('button', {name: '丟棄', exact: true}).click();
      await card.getByText('協調訊息 1 則', {exact: true}).waitFor();
      assert.deepEqual(
        posts.filter(p => p.endpoint === '/api/room-notes').map(p => p.data),
        [{id: long.id, action: 'discard', threadId: 'fake-target'}]
      );

      const composer = page.getByRole('textbox', {name: '工作訊息', exact: true});
      assert.equal(await composer.inputValue(), '');
      const sendButton = page.getByRole('button', {name: '送出訊息', exact: true});
      assert(await sendButton.isEnabled(), 'pending notes alone can be sent');
      await composer.fill('收到，我先處理前端。');
      await sendButton.click();
      await card.waitFor({state: 'detached'});
      assert.equal(sends.length, 1);
      assert(sends[0].text.startsWith(`收到，我先處理前端。\n\n${ROOM_NOTES_HEADER}\n`));
      const bubble = page.locator('.user-bubble').last();
      await bubble.getByText('收到，我先處理前端。', {exact: true}).waitFor();
      const folded = bubble.locator('details.user-room-notes');
      assert.equal(await folded.locator('summary').textContent(), '協調訊息 1 則');
      assert.equal(await folded.evaluate(e => e.open), false);
      assert(!(await bubble.innerText()).includes('k-room-notes-v1'), 'the raw block stays folded');
      await folded.locator('summary').click();
      await folded.getByText('請先不要改 schema', {exact: false}).waitFor();
      await page.screenshot({path: path.join(output, `${width}-${theme}-sent.png`)});
      assert.deepEqual(notes.pending('fake-target'), []);
      results.push({width, height, scale, theme, geometry, passed: true});
    } finally {
      live = false;
      await unified.close();
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed: results.length, errors}));
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify({results, errors}, null, 2));
  await browser?.close();
  await server.httpServer.close();
}
