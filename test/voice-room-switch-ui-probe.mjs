// Built desktop/remote UI with synthetic capture and a deferred fake local transcriber; no model or real microphone.
// One desktop case holds the transcriber longer than the former fixed 120-second cutoff (K_TEST_VOICE_LONG_MS).
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {launchProbeBrowser, probeEvidenceDir, probeTlsCertificate} from './ui-probe.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {remoteKeyHash} from '../src/remote-access.mjs';
import {decodePcm16Mono16kWav} from '../src/local-dictation.mjs';

const repo = process.cwd(),
  out = probeEvidenceDir('voice-room-switch-ui-probe');
await mkdir(out, {recursive: true});
const root = await mkdtemp(path.join(out, 'fake-root-')),
  key = randomBytes(32).toString('hex');
const remotePort = Number(process.env.K_TEST_ROOM_REMOTE_PORT ?? 54848),
  httpsPort = Number(process.env.K_TEST_ROOM_HTTPS_PORT ?? 54849),
  origin = `https://voice-room-switch.test.ts.net:${httpsPort}`;
await mkdir(path.join(root, '.local'));
await writeFile(
  path.join(root, '.local/remote-access.json'),
  JSON.stringify({origin, login: 'voice-test@example.invalid', keyHash: remoteKeyHash(key), port: remotePort})
);
const rooms = new Map(),
  calls = [],
  transcriptionPlans = [];
let current, emit;
let answerGate = Promise.resolve();
function makeRoom(id, title) {
  return {
    threadId: id,
    title,
    workspace: root,
    provider: 'codex',
    model: 'gpt-6.1-sol',
    modelDisplayName: 'GPT-6.1 Sol',
    status: 'ready',
    busy: false,
    messages: [],
    tools: [],
    questions: [],
    notices: [],
    artifacts: [],
    workers: [],
    queuedMessages: [],
    capabilities: {},
    accessMode: 'workspace-write',
    effort: 'low',
    efforts: ['low', 'high'],
    inputModalities: ['text']
  };
}
const roomA = makeRoom('voice-room-A', '語音測試 A'),
  roomB = makeRoom('voice-room-B', '語音測試 B');
rooms.set(roomA.threadId, roomA);
rooms.set(roomB.threadId, roomB);
current = roomA;
function deferredPlan(text) {
  let resolve, reject, markStarted;
  const started = new Promise(done => {
      markStarted = done;
    }),
    result = new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    });
  return {text, started, markStarted, result, resolve: () => resolve({ok: true, text}), reject: error => reject(error)};
}
const controller = {
  concurrentConversations: true,
  get state() {
    return {
      ...current,
      workerActivity: {running: 0, uncertain: false, unconfirmed: 0},
      conversationActivity: [...rooms.values()].map(room => ({
        threadId: room.threadId,
        workspace: root,
        busy: room.busy,
        status: room.status,
        pendingQuestions: 0
      }))
    };
  },
  async sessions() {
    return {sessions: [...rooms.values()].map(({messages, tools, ...metadata}) => metadata)};
  },
  async models() {
    return {
      models: [
        {
          model: 'gpt-6.1-sol',
          displayName: 'GPT-6.1 Sol',
          provider: 'codex',
          available: true,
          inputModalities: ['text'],
          supportedReasoningEfforts: [{reasoningEffort: 'low'}],
          defaultReasoningEffort: 'low'
        }
      ]
    };
  },
  async usage() {
    return {};
  },
  async open({threadId}) {
    current = rooms.get(threadId);
    if (!current) throw Error('unknown fake room');
    calls.push({op: 'open', threadId});
    emit();
    return {threadId};
  },
  async send(args) {
    calls.push({op: 'send', ...args});
    if (args.text.includes('送出被拒')) throw Error('fake send rejected before sending');
    return {sent: true};
  },
  async uploadStream({threadId, name}, stream) {
    let size = 0;
    for await (const chunk of stream) size += chunk.length;
    calls.push({op: 'upload', threadId, name});
    return {id: `upload-${threadId}-${name}`, name, size};
  },
  async answer(args) {
    calls.push({op: 'answer', ...args});
    await answerGate; // Holds the room's own action lock while the probe needs it.
    current.questions = [];
    emit();
    return {ok: true};
  },
  async stop() {
    return {stopRequested: true};
  },
  async close() {},
  markViewed() {
    return {ok: true};
  }
};
const login = () => ({
  async status() {
    return {available: false};
  },
  async close() {}
});
const app = await startDesktop({
  root,
  port: 0,
  controllerFactory: options => {
    emit = options.onChange;
    return controller;
  },
  claudeLoginFactory: login,
  codexLoginFactory: login,
  geminiLoginFactory: login,
  localDictationFactory: () => ({
    close: async () => {},
    async transcribe(audio) {
      const wav = decodePcm16Mono16kWav(audio);
      const plan = transcriptionPlans.shift();
      if (!plan) throw Error('unexpected transcription request');
      calls.push({op: 'transcribe', bytes: wav.length});
      plan.markStarted();
      return plan.result;
    }
  })
});
assert.equal(app.remoteOrigin, origin, 'the fixture must use its own synthetic remote origin');
const proxy = https.createServer(await probeTlsCertificate(), (req, res) => {
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: remotePort,
      path: req.url,
      method: req.method,
      headers: {...req.headers, 'tailscale-user-login': 'voice-test@example.invalid'}
    },
    response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});
await new Promise(resolve => proxy.listen(httpsPort, '127.0.0.1', resolve));
let browser;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(page, mobile) {
  const pageErrors = [],
    abortedRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request =>
    abortedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`)
  );
  if (mobile) {
    await page.goto(origin);
    await page.getByLabel('K 存取金鑰').fill(key);
    await page.getByRole('button', {name: '連接 K', exact: true}).click();
    try {
      await page.locator('.remote-connection.connected').waitFor({timeout: 20000});
    } catch (error) {
      throw new Error(
        `${error.message}\nRemote UI: ${(await page.locator('body').innerText()).slice(0, 1500)}\nBrowser errors: ${pageErrors.join(' | ')}`
      );
    }
  } else {
    await page.goto(app.createLaunchUrl());
  }
  await page.getByRole('textbox', {name: '工作訊息', exact: true}).waitFor();
  return {pageErrors, abortedRequests};
}
async function openRoom(page, room) {
  const expand = page.getByRole('button', {name: '展開側欄', exact: true});
  if (await expand.count()) await expand.click();
  await page.locator('.session-open').filter({hasText: room.title}).first().click();
  await page.locator('.header-breadcrumb h1').getByText(room.title, {exact: true}).waitFor();
}
async function beginTranscription(page, draftText, resultText, send = false) {
  await openRoom(page, roomA);
  const input = page.locator('textarea.composer-input');
  await input.fill(draftText);
  const plan = deferredPlan(resultText);
  transcriptionPlans.push(plan);
  await page.getByRole('button', {name: '開始聽寫', exact: true}).click();
  await page.getByRole('button', {name: '停止聽寫', exact: true}).waitFor();
  await wait(700);
  if (send) {
    const arrow = page.getByRole('button', {name: '轉錄完成後送出', exact: true});
    await arrow.waitFor();
    await arrow.click();
  } else await page.getByRole('button', {name: '停止聽寫', exact: true}).click();
  await page.getByText('轉錄中…', {exact: true}).waitFor();
  await plan.started;
  return plan;
}
async function resolvePlan(page, plan) {
  const response = page.waitForResponse(response => response.url().includes('/api/dictation/transcribe'));
  plan.resolve();
  await response;
}
async function rejectPlan(page, plan) {
  const response = page.waitForResponse(response => response.url().includes('/api/dictation/transcribe'));
  plan.reject(new Error('fake delayed transcription failure'));
  await response;
}
let sendBaseline = 0; // Sends made by earlier viewports.
const sends = () => calls.filter(call => call.op === 'send').slice(sendBaseline);
async function assertNoSend() {
  assert.equal(sends().length, 0, 'stop/fill-only dictation never sends a message');
}
async function waitForSends(count) {
  for (let i = 0; i < 50 && sends().length < count; i += 1) await wait(100);
  await wait(300); // A duplicate would arrive in this window.
  assert.equal(sends().length, count, `expected exactly ${count} sends`);
}
const longHoldMs = Number(process.env.K_TEST_VOICE_LONG_MS ?? 125_000);
try {
  browser = await launchProbeBrowser({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--host-resolver-rules=MAP voice-room-switch.test.ts.net 127.0.0.1',
      '--no-proxy-server'
    ]
  });
  for (const viewport of [
    {name: 'desktop', width: 1440, height: 1000, mobile: false},
    {name: 'remote-390', width: 390, height: 844, mobile: true}
  ]) {
    const page = await browser.newPage({
      viewport: {width: viewport.width, height: viewport.height},
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      deviceScaleFactor: viewport.mobile ? 2 : 1,
      ignoreHTTPSErrors: true,
      userAgent: viewport.mobile
        ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36'
        : undefined
    });
    page.setDefaultTimeout(12000);
    // A gate that can hold the real (fake-device) microphone stream, to deliver it after the window hid.
    await page.addInitScript(() => {
      const media = navigator.mediaDevices,
        original = media.getUserMedia.bind(media);
      window.__micGate = null;
      window.__lateStreams = [];
      media.getUserMedia = async constraints => {
        const stream = await original(constraints);
        if (window.__micGate) {
          await window.__micGate;
          window.__lateStreams.push(stream);
        }
        return stream;
      };
    });
    if (!viewport.mobile)
      await page.addInitScript(() => {
        const listeners = new Set();
        window.kBrowser = {
          onWindowHidden(callback) {
            listeners.add(callback);
            return () => listeners.delete(callback);
          }
        };
        window.__triggerKWindowHidden = () => listeners.forEach(callback => callback());
      });
    const {pageErrors, abortedRequests} = await connect(page, viewport.mobile);
    const input = page.locator('textarea.composer-input');
    sendBaseline = calls.filter(call => call.op === 'send').length;
    const hideApp = async () => {
      if (viewport.mobile)
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', {configurable: true, value: true});
          document.dispatchEvent(new Event('visibilitychange'));
        });
      else await page.evaluate(() => window.__triggerKWindowHidden());
    };
    const showApp = async () => {
      if (viewport.mobile)
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', {configurable: true, value: false});
          document.dispatchEvent(new Event('visibilitychange'));
        });
    };
    // A stops into a delayed transcribe; moving to B must neither cancel it nor put its result in B.
    let plan = await beginTranscription(page, 'A 原草稿', 'A 背景轉錄結果');
    await openRoom(page, roomB);
    await input.fill('B 草稿');
    await resolvePlan(page, plan);
    await page.waitForTimeout(100);
    assert.equal(await input.inputValue(), 'B 草稿');
    await openRoom(page, roomA);
    await page.waitForFunction(
      () => document.querySelector('textarea.composer-input')?.value === 'A 原草稿\nA 背景轉錄結果'
    );
    await assertNoSend();
    // Return to A before completion: reattach controls, append to A's latest draft, and keep one request.
    plan = await beginTranscription(page, 'A 起始草稿', 'A 延遲結果');
    await openRoom(page, roomB);
    const transcriptionsBefore = calls.filter(call => call.op === 'transcribe').length;
    await page.evaluate(() => sessionStorage.setItem('k-draft:voice-room-A', 'A 較新儲存草稿'));
    await openRoom(page, roomA);
    await page.getByRole('button', {name: '取消聽寫', exact: true}).waitFor();
    if (viewport.mobile)
      assert.equal(
        await page.getByRole('button', {name: '轉錄完成後送出', exact: true}).count(),
        0,
        'remote/mobile has no send-after-transcription control'
      );
    assert.equal(
      await input.inputValue(),
      'A 較新儲存草稿',
      'returning to A loads the latest saved draft; the transcribing input is intentionally read-only'
    );
    await page.locator('.composer-note [role="status"]').filter({hasText: '不會自動送出'}).waitFor({state: 'visible'});
    await page.screenshot({path: path.join(out, `${viewport.name}-pending.png`)});
    await resolvePlan(page, plan);
    await page.waitForFunction(
      () => document.querySelector('textarea.composer-input')?.value === 'A 較新儲存草稿\nA 延遲結果'
    );
    assert.equal(
      calls.filter(call => call.op === 'transcribe').length,
      transcriptionsBefore,
      'returning to A does not restart transcription'
    );
    await assertNoSend();
    // A→B→A keeps the cancellation control; canceling there preserves A's draft.
    plan = await beginTranscription(page, 'A 取消草稿', '不應加入的結果');
    await openRoom(page, roomB);
    await openRoom(page, roomA);
    await page.getByRole('button', {name: '取消聽寫', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('textarea.composer-input')?.value === 'A 取消草稿');
    await page
      .locator('.composer-note [role="status"]')
      .filter({hasText: '已取消這段聽寫'})
      .waitFor({state: 'visible'});
    plan.resolve();
    await page.waitForTimeout(100);
    assert.equal(await input.inputValue(), 'A 取消草稿');
    await assertNoSend();
    // Background errors stay associated with A and are visible when it is reopened.
    plan = await beginTranscription(page, 'A 失敗保留草稿', 'unused');
    await openRoom(page, roomB);
    await rejectPlan(page, plan);
    await openRoom(page, roomA);
    await page.waitForFunction(() => document.querySelector('textarea.composer-input')?.value === 'A 失敗保留草稿');
    const failureNotice = page.locator('.composer-note [role="status"]').filter({hasText: /辨識|轉錄/u});
    await failureNotice.waitFor({state: 'attached'});
    const failureVisibility = await failureNotice.evaluate(el => ({
      html: el.outerHTML,
      style: getComputedStyle(el).display,
      parent: el.parentElement?.outerHTML.slice(0, 500)
    }));
    assert.equal(
      await failureNotice.isVisible(),
      true,
      `background failure notice is visible after returning to A: ${JSON.stringify(failureVisibility)}`
    );
    await page.screenshot({path: path.join(out, `${viewport.name}-failure.png`)});
    await assertNoSend();
    // Hiding the app/page no longer cancels a stopped transcription that has left its room.
    plan = await beginTranscription(page, 'A 隱藏時保留草稿', '隱藏後仍完成');
    await openRoom(page, roomB);
    await hideApp();
    await page.waitForTimeout(100);
    await resolvePlan(page, plan);
    await showApp();
    await openRoom(page, roomA);
    await page.waitForFunction(
      () => document.querySelector('textarea.composer-input')?.value === 'A 隱藏時保留草稿\n隱藏後仍完成'
    );
    await assertNoSend();
    // Hiding while recording ends capture (no hidden microphone) and keeps the speech as a draft only.
    await input.fill('A 錄音中隱藏');
    plan = deferredPlan('隱藏前說的話');
    transcriptionPlans.push(plan);
    await page.getByRole('button', {name: '開始聽寫', exact: true}).click();
    await page.getByRole('button', {name: '停止聽寫', exact: true}).waitFor();
    await wait(700);
    await hideApp();
    await plan.started;
    await page.getByText('轉錄中…', {exact: true}).waitFor();
    await resolvePlan(page, plan);
    await showApp();
    await page.waitForFunction(
      () => document.querySelector('textarea.composer-input')?.value === 'A 錄音中隱藏\n隱藏前說的話'
    );
    await assertNoSend();
    // Switching rooms while recording also ends capture and fills only A's draft.
    await input.fill('A 錄音切房保留');
    plan = deferredPlan('切房前說的話');
    transcriptionPlans.push(plan);
    await page.getByRole('button', {name: '開始聽寫', exact: true}).click();
    await page.getByRole('button', {name: '停止聽寫', exact: true}).waitFor();
    await wait(700);
    await openRoom(page, roomB);
    await plan.started;
    await resolvePlan(page, plan);
    assert.equal(await input.inputValue(), 'B 草稿', 'the result never lands in B');
    await openRoom(page, roomA);
    await page.waitForFunction(
      () => document.querySelector('textarea.composer-input')?.value === 'A 錄音切房保留\n切房前說的話'
    );
    await assertNoSend();
    // Hidden while the microphone is still starting: canceled in A; the late stream is stopped and never records.
    await input.fill('A 啟動中隱藏');
    const transcribesBeforeStarting = calls.filter(call => call.op === 'transcribe').length;
    await page.evaluate(() => {
      window.__micGate = new Promise(resolve => (window.__openMic = resolve));
    });
    await page.getByRole('button', {name: '開始聽寫', exact: true}).click();
    await page.getByText('正在啟動麥克風…', {exact: true}).waitFor();
    await hideApp();
    await page.evaluate(() => window.__openMic());
    await page.waitForFunction(() => window.__lateStreams.length === 1);
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => window.__lateStreams[0].getTracks().every(track => track.readyState === 'ended')),
      true,
      'the late microphone stream is stopped'
    );
    assert.equal(await page.getByRole('button', {name: '停止聽寫', exact: true}).count(), 0, 'never starts recording');
    await showApp();
    await page.getByRole('button', {name: '開始聽寫', exact: true}).waitFor();
    await page.locator('.composer-note [role="status"]').filter({hasText: '已取消這段聽寫'}).waitFor({state: 'visible'});
    assert.equal(await input.inputValue(), 'A 啟動中隱藏');
    assert.equal(calls.filter(call => call.op === 'transcribe').length, transcribesBeforeStarting);
    await page.evaluate(() => {
      window.__micGate = null;
    });
    await assertNoSend();
    if (!viewport.mobile) {
      // Send intent survives leaving A and a hidden window past the former 120 s cutoff, and sends once to A
      // with A's own draft and attachment; B keeps its draft.
      await input.fill('');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'a-note.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('A 的附件')
      });
      await page.getByText('a-note.txt').first().waitFor();
      plan = await beginTranscription(page, 'A 送出草稿', 'A 長時間後送出', true);
      await openRoom(page, roomB);
      await hideApp();
      await wait(longHoldMs);
      await assertNoSend();
      await resolvePlan(page, plan);
      await waitForSends(1);
      const sent = sends().at(-1);
      assert.equal(sent.threadId, roomA.threadId);
      assert.equal(sent.text, 'A 送出草稿\nA 長時間後送出');
      assert.deepEqual(sent.attachmentIds, [`upload-${roomA.threadId}-a-note.txt`]);
      assert.equal(await input.inputValue(), 'B 草稿');
      await openRoom(page, roomA);
      await page.waitForTimeout(300);
      assert.equal(await input.inputValue(), '', 'the sent draft is cleared from A');
      assert.equal(await page.getByText('a-note.txt').count(), 0, 'the sent attachment leaves A');
      await openRoom(page, roomB);
      await openRoom(page, roomA);
      await waitForSends(1); // Revisiting A never replays the send.
      // Send intent, back in A before completion: the arrow's promise is shown and kept, once.
      plan = await beginTranscription(page, 'A 返回後送出', 'A 返回後完成', true);
      await openRoom(page, roomB);
      await openRoom(page, roomA);
      await page
        .locator('.composer-note [role="status"]')
        .filter({hasText: '會在此聊天室送出'})
        .waitFor({state: 'visible'});
      await page.screenshot({path: path.join(out, `${viewport.name}-send-pending.png`)});
      await resolvePlan(page, plan);
      await waitForSends(2);
      assert.equal(sends().at(-1).threadId, roomA.threadId);
      assert.equal(sends().at(-1).text, 'A 返回後送出\nA 返回後完成');
      await page.waitForFunction(() => document.querySelector('textarea.composer-input')?.value === '');
      // A rejected background send is attempted once, not retried, and keeps A's full draft.
      plan = await beginTranscription(page, 'A 送出被拒草稿', '被拒時保留', true);
      await openRoom(page, roomB);
      await resolvePlan(page, plan);
      await waitForSends(3);
      assert.equal(await input.inputValue(), 'B 草稿');
      await page.getByText(/「語音測試 A」聽寫完成後送出時發生問題/u).waitFor({state: 'visible'});
      await openRoom(page, roomA);
      await page.waitForFunction(
        () => document.querySelector('textarea.composer-input')?.value === 'A 送出被拒草稿\n被拒時保留'
      );
      await page
        .locator('.composer-note [role="status"]')
        .filter({hasText: '聽寫完成後送出時發生問題'})
        .waitFor({state: 'visible'});
      await waitForSends(3);
      await input.fill('');
      // A's own room action still in flight at completion: not sent, not retried, A says so and keeps the text.
      roomA.questions = [{id: 'voice-approval', kind: 'approval', title: '需要操作核准', text: '假核准', canAccept: true}];
      emit();
      await input.fill('A 忙碌時草稿');
      plan = deferredPlan('A 忙碌時結果');
      transcriptionPlans.push(plan);
      await page.getByRole('button', {name: '開始聽寫', exact: true}).click();
      await page.getByRole('button', {name: '停止聽寫', exact: true}).waitFor();
      await wait(700);
      await page.getByRole('button', {name: '轉錄完成後送出', exact: true}).click();
      await plan.started;
      let releaseAnswer;
      answerGate = new Promise(resolve => (releaseAnswer = resolve));
      await page.getByRole('button', {name: '拒絕', exact: true}).click();
      while (!calls.some(call => call.op === 'answer')) await wait(50);
      await openRoom(page, roomB);
      await resolvePlan(page, plan);
      await waitForSends(3);
      releaseAnswer();
      await openRoom(page, roomA);
      await page.waitForFunction(
        () => document.querySelector('textarea.composer-input')?.value === 'A 忙碌時草稿\nA 忙碌時結果'
      );
      await page
        .locator('.composer-note [role="status"]')
        .filter({hasText: '另有操作進行中'})
        .waitFor({state: 'visible'});
      await waitForSends(3);
      // A's quote, confirmed permission and effort chosen in A ride the background send, not B's defaults.
      await input.fill('');
      await openRoom(page, roomB);
      await page.evaluate(
        threadId =>
          sessionStorage.setItem(
            `k-response-annotations:${encodeURIComponent(threadId)}`,
            JSON.stringify([{id: 'voice-quote', text: 'A 的引用', annotation: 'A 的註解', sourceMessageId: null}])
          ),
        roomA.threadId
      );
      await openRoom(page, roomA);
      await page.getByRole('button', {name: '操作權限', exact: true}).click();
      await page.getByRole('menuitemradio').filter({hasText: '代我核准'}).click();
      await page.getByRole('button', {name: '確認選用', exact: true}).click();
      const reasoning = page.getByRole('button', {name: '推理程度與速度', exact: true});
      await reasoning.click();
      await page.getByRole('combobox', {name: '推理程度', exact: true}).selectOption('high');
      await reasoning.click();
      await input.fill('A 帶設定草稿');
      plan = deferredPlan('A 帶設定結果');
      transcriptionPlans.push(plan);
      await page.getByRole('button', {name: '開始聽寫', exact: true}).click();
      await page.getByRole('button', {name: '停止聽寫', exact: true}).waitFor();
      await wait(700);
      await page.getByRole('button', {name: '轉錄完成後送出', exact: true}).click();
      await plan.started;
      await openRoom(page, roomB);
      await resolvePlan(page, plan);
      await waitForSends(4);
      const configured = sends().at(-1);
      assert.equal(configured.threadId, roomA.threadId);
      assert.match(configured.text, /A 帶設定草稿\nA 帶設定結果/u);
      assert.match(configured.text, /A 的引用/u);
      assert.match(configured.text, /A 的註解/u);
      assert.equal(configured.accessMode, 'auto-review');
      assert.equal(configured.permissionConfirmed, true);
      assert.equal(configured.effort, 'high');
      assert.equal(
        await page.evaluate(
          threadId => JSON.parse(sessionStorage.getItem(`k-response-annotations:${encodeURIComponent(threadId)}`) ?? '[]').length,
          roomA.threadId
        ),
        0,
        'the sent quote leaves A'
      );
      assert.equal(sends().filter(call => call.threadId === roomB.threadId).length, 0, 'B never receives A dictation');
    }
    assert.deepEqual(pageErrors, [], `${viewport.name} has no unexpected page errors`);
    const unexpectedAborts = abortedRequests.filter(
      request =>
        !request.includes('ERR_ABORTED') ||
        (!request.includes('/api/events') && !request.includes('/api/dictation/transcribe'))
    );
    assert.deepEqual(unexpectedAborts, [], `${viewport.name} has no unexplained request aborts`);
    console.log(
      `${viewport.name}: ${pageErrors.length} page errors; ${abortedRequests.filter(request => request.includes('/api/events')).length} event-stream aborts during room switches; ${abortedRequests.filter(request => request.includes('/api/dictation/transcribe')).length} expected transcription aborts`
    );
    await page.screenshot({path: path.join(out, `${viewport.name}-voice-room-switch.png`)});
    await page.close();
  }
  console.log(
    JSON.stringify(
      {
        passed: true,
        viewports: ['desktop 1440x1000', 'remote 390x844'],
        checks: [
          'A result completed in B is saved to A only',
          'A→B→A completion appends to latest A sessionStorage draft without duplicate transcription',
          'return to A can cancel and retain its draft',
          'background failure retains A draft and shows A notice',
          'hidden app callback/mobile visibility does not cancel a stopped transcription',
          'hidden or room switch while recording ends capture and fills only the source draft',
          `desktop send intent survives room switch + hidden window for ${longHoldMs} ms and sends once to A with its draft and attachment`,
          'desktop send intent is shown and kept after returning before completion',
          'rejected background send is not retried, keeps the draft, labels the global error and notices in A',
          'hidden while the microphone is starting cancels in A and stops the late stream before any recording',
          'background send blocked by an in-flight A room action is not sent or retried and A says so',
          "background send carries A's quote, confirmed permission and effort, not B's defaults",
          'stop/fill-only never sends; B never receives A dictation'
        ]
      },
      null,
      2
    )
  );
} catch (error) {
  throw error;
} finally {
  await browser?.close();
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
  await app.close();
}
