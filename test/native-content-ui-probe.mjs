import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {resolveNativeMessageFile} from '../src/native-message-file.mjs';
import {scratchBase} from './scratch.mjs';
const out = probeEvidenceDir('native-content-ui');
await mkdir(out, {recursive: true});
const root = await mkdtemp(path.join(scratchBase, 'native-content-ui-')),
  workspace = path.join(root, 'workspace');
await mkdir(workspace);
const file = path.join(root, '中文 交接.md'),
  picture = path.join(root, '本機 圖.jpg');
const png = await readFile(path.resolve('frontend/assets/k-logo.jpg'));
await writeFile(file, '原生已存檔：不需fileChange。');
await writeFile(picture, png);
const bracketFile = path.join(root, 'report(1).md');
const slashFile = process.platform === 'win32' ? '/' + file.replaceAll('\\', '/') : file;
await writeFile(bracketFile, '原生已存檔：不需fileChange。');
const text = `[含括號檔名](${bracketFile})\n\n[括號標題](${bracketFile} (title))\n\n[帶標題](${bracketFile} "title")\n\n[參考連結][r]\n\n[r]: <${file}> "title"\n\n[![巢狀圖](<${picture}>)](${bracketFile})\n\n[本機絕對路徑](<${file}>)\n\n[檔案URI](${pathToFileURL(file).href})\n\n[相對路徑](<../中文 交接.md>)\n\n[行號](<${file}#L3>)\n\n[網頁](https://example.test/a?q=1#x) [郵件](mailto:me@example.test) [電話](tel:+886123)\n\n[其他原生入口](vscode://file/D:/a.js) [不可執行文字](javascript:alert%281%29)\n\n![本機圖](<${picture}>)\n\n![網頁圖](https://example.test/native.png)\n\n<b>原生HTML不得消失</b>\n\n\`\`\`text\n完整原始碼\n\`\`\``;
const results = [];
let browser;
try {
  browser = await launchProbeBrowser();
  for (const provider of ['codex', 'claude', 'gemini']) {
    const state = {
      provider,
      threadId: 'fake-' + provider,
      workspace,
      title: '原生呈現驗證',
      model: provider === 'codex' ? 'gpt-6.1-sol' : provider === 'claude' ? 'claude-opus-5-5' : 'gemini-3.8-flash',
      status: 'ready',
      busy: false,
      messages: [
        {
          id: 'reply',
          role: 'assistant',
          text: text + `\n\n[斜線磁碟路徑](<${slashFile}>)\n\n[編碼磁碟路徑](${encodeURI(slashFile)})`,
          completedAt: new Date().toISOString()
        }
      ],
      workers: Array.from({length: 461}, (_, i) => ({
        requestId: 'history-' + i,
        status: i === 460 ? 'failed' : 'completed',
        settled: true
      })),
      tools: [],
      questions: [],
      notices: [],
      artifacts: [],
      capabilities: {}
    };
    const requests = [];
    const app = await startDesktop({
      root: workspace,
      port: 0,
      controllerFactory: () => ({
        state,
        models: async () => ({models: []}),
        usage: async () => ({}),
        sessions: async () => ({sessions: []}),
        messageFilePath: (href, context) => {
          assert.equal(context.threadId, state.threadId);
          requests.push(href);
          return resolveNativeMessageFile(state, href);
        },
        close: async () => {}
      })
    });
    try {
      for (const width of [1440, 390]) {
        const page = await browser.newPage({viewport: {width, height: 960}}),
          errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('https://example.test/native.png', r => r.fulfill({body: png, contentType: 'image/jpeg'}));
        await page.goto(app.createLaunchUrl());
        await page.screenshot({path: path.join(out, 'initial-' + provider + '-' + width + '.png')});
        const m = page.locator('.assistant-message');
        await m.getByRole('link', {name: '本機絕對路徑', exact: true}).waitFor();
        assert.equal(await m.getByRole('link', {name: '本機絕對路徑', exact: true}).getAttribute('draggable'), 'false');
        const documentUrl = page.url();
        await m.getByRole('link', {name: '本機絕對路徑', exact: true}).click({button: 'middle'});
        assert.equal(page.url(), documentUrl);
        assert.equal(
          await m.getByRole('link', {name: '郵件', exact: true}).getAttribute('href'),
          'mailto:me@example.test'
        );
        assert.equal(await m.getByRole('link', {name: '電話', exact: true}).getAttribute('href'), 'tel:+886123');
        assert.match(await m.textContent(), /vscode:\/\/file\/D:\/a.js/);
        assert.match(await m.textContent(), /javascript:alert%281%29/);
        assert.match(await m.textContent(), /原生HTML不得消失/);
        assert.match(await m.textContent(), /完整原始碼/);
        for (const name of [
          '本機絕對路徑',
          '檔案URI',
          '相對路徑',
          '行號',
          '含括號檔名',
          '帶標題',
          '參考連結',
          '巢狀圖',
          '括號標題',
          '斜線磁碟路徑',
          '編碼磁碟路徑'
        ]) {
          await m.getByRole('link', {name, exact: true}).click();
          await page.locator('.file-preview').getByText('原生已存檔：不需fileChange。', {exact: true}).waitFor();
          const download = page.getByRole('link', {name: '下載完整檔案'});
          const response = await page.request.get(new URL(await download.getAttribute('href'), app.origin).href);
          assert.equal(response.status(), 200);
          assert.equal(await response.text(), '原生已存檔：不需fileChange。');
          await page.getByRole('button', {name: '關閉', exact: true}).click();
        }
        await page.waitForFunction(() =>
          [...document.querySelectorAll('.native-message-image')].every(i => i.complete && i.naturalWidth > 0)
        );
        assert.equal(await m.locator('.native-message-image').count(), 3);
        await page.getByText('無未結束的子代理', {exact: true}).waitFor();
        const denied = await page.request.get(
          `${app.origin}/api/message-file?path=${encodeURIComponent(path.join(root, 'not-provided.md'))}&threadId=${state.threadId}`
        );
        assert.equal(denied.status(), 400);
        assert.deepEqual(errors, []);
        await page.screenshot({path: path.join(out, `${provider}-${width}.png`)});
        results.push({
          provider,
          width,
          fileLinks: 11,
          downloadExact: true,
          localAndWebImages: true,
          htmlNotDiscarded: true,
          otherDestinationPreserved: true,
          historicalWorkersNotCounted: true,
          errors
        });
        await page.close();
      }
    } finally {
      await app.close();
    }
  }
  await writeFile(path.join(out, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ok: true, cases: results.length, out}));
} finally {
  await browser?.close();
}
