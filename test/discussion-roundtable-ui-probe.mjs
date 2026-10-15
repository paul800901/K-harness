// Built UI, synthetic discussion records, actual browser. No model/account calls.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {preview} from 'vite';
const output = probeEvidenceDir('discussion-roundtable-v2');
await mkdir(output, {recursive: true});
const server = await preview({preview: {host: '127.0.0.1', port: 0}});
let browser;
const results = [],
  errors = [];
function snapshot(count, legacy = false) {
  const participants = Array.from({length: count}, (_, i) => ({
    id: `p${i + 1}`,
    model: i < 2 ? 'gpt-6-astra' : 'model-' + i,
    displayName: i < 2 ? 'Astra' : '參與者 ' + (i + 1)
  }));
  const run = {
    id: 'run-one',
    question: '可讀圓桌',
    mode: 'meeting',
    status: 'working',
    round: 4,
    participants,
    facilitator: {model: 'claude-opus-5-5', displayName: 'Opus 5.5'},
    decisions: Array.from({length: 3}, (_, i) => ({
      action: 'speak',
      round: i + 1,
      nextRound: i + 2,
      speakers: participants.slice(0, i === 2 ? 3 : count).map(p => p.id),
      prompt: '核對原文與分歧',
      createdAt: '2026-10-15T01:00:00Z'
    }))
  };
  const messages = [
    {id: 'question', kind: 'discussion', runId: run.id, role: 'user', text: run.question},
    {id: 'brief', kind: 'discussion', runId: run.id, role: 'assistant', background: true, text: '完整任務書'},
    {
      id: 'summary',
      kind: 'discussion',
      runId: run.id,
      role: 'assistant',
      summary: true,
      text: '## 討論整理\n保留所有不同意見。',
      completedAt: '2026-10-15T01:00:00Z'
    }
  ];
  for (let round = 1; round <= 4; round++)
    for (let i = 0; i < count; i++) {
      if (round === 4 && i > 2) continue;
      messages.push({
        id: `r${round}-p${i + 1}`,
        kind: 'discussion',
        runId: run.id,
        role: 'assistant',
        participantId: participants[i].id,
        model: participants[i].model,
        speaker: participants[i].displayName,
        round,
        text:
          `## ${participants[i].id} 批次 ${round}\n\n` +
          '這是長篇原始報告，保留證據、分歧與未知。\n\n'.repeat(100) +
          `END-${round}-${i + 1}`,
        createdAt: new Date(Date.UTC(2026, 9, 15, 1, round, i)).toISOString(),
        streaming: round === 4 && i === 0,
        partial: round === 4 && i === 2
      });
    }
  if (legacy) {
    delete run.decisions;
    delete run.round;
    for (const m of messages) {
      delete m.participantId;
      delete m.round;
    }
  }
  return {
    threadId: 'roundtable-room',
    workspace: process.cwd(),
    title: '圓桌驗證',
    provider: 'codex',
    model: 'gpt-6-astra',
    status: 'working',
    busy: true,
    messages,
    questions: [],
    workers: [],
    tools: [],
    artifacts: [],
    capabilities: {},
    usage: {},
    accessMode: 'workspace-write',
    discussion: {...run, busy: true, runs: [run]}
  };
}
try {
  browser = await launchProbeBrowser();
  for (const [count, width, legacy] of [
    [3, 1440, false],
    [6, 1440, false],
    [6, 390, false],
    [3, 1440, true]
  ]) {
    const state = snapshot(count, legacy),
      writes = [];
    const page = await browser.newPage({viewport: {width, height: 900}});
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(state => {
      localStorage.setItem('k-appearance', JSON.stringify({interfaceScale: 100, dialogueFontSize: 18}));
      window.EventSource = class {
        constructor() {
          window.probeStream = this;
          setTimeout(() => {
            this.onopen?.();
            this.onmessage?.({data: JSON.stringify({type: 'snapshot', state})});
          }, 0);
        }
        close() {}
      };
    }, state);
    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET') writes.push({path: p, body: route.request().postDataJSON()});
      const json =
        route.request().method() !== 'GET'
          ? {sent: true, stopped: true}
          : p === '/api/state'
            ? state
            : p === '/api/projects'
              ? {projects: []}
              : p === '/api/sessions'
                ? {sessions: []}
                : p === '/api/models'
                  ? {models: []}
                  : {};
      await route.fulfill({json});
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole('button', {name: '開啟圓桌', exact: true}).waitFor();
    assert.equal(await page.locator('.discussion-roundtable-entry').count(), 1);
    assert.equal(await page.locator('.discussion-message').count(), 1, 'only the AI summary remains in chat');
    if (width < 700) {
      assert(
        await page.locator('.app').evaluate(n => n.classList.contains('inspector-hidden')),
        'phone must not auto-open'
      );
      await page.getByRole('button', {name: '開啟圓桌', exact: true}).click();
      await page.getByLabel('批次', {exact: true}).selectOption('4');
      assert.equal(await page.locator('.discussion-roundtable-page').count(), 7);
      await page.locator('.discussion-roundtable-page').first().locator('header button').click();
      await page.getByRole('button', {name: '回到格子', exact: true}).waitFor();
      await page.goBack();
      await page.locator('.discussion-roundtable-pages').waitFor();
      assert.equal(await page.getByLabel('批次', {exact: true}).inputValue(), '4');
      await page.locator('.discussion-roundtable-page').first().locator('header button').click();
      await page.getByRole('button', {name: '回到格子', exact: true}).waitFor();
      await page.getByRole('button', {name: '回到聊天室', exact: true}).click();
      await page.waitForFunction(() => !history.state?.kMobilePanel);
      await page.getByRole('button', {name: '開啟圓桌', exact: true}).click();
      await page.locator('.discussion-roundtable-pages').waitFor();
      assert.equal(
        await page.locator('.discussion-roundtable-reader').count(),
        0,
        'closing the panel must clear its reader navigation'
      );
      const size = await page.locator('.discussion-roundtable-map button').first().boundingBox();
      assert(size.width >= 44 && size.height >= 44);
      assert.equal(
        await page.locator('.discussion-roundtable-pages').evaluate(n => getComputedStyle(n).scrollSnapType),
        'x mandatory'
      );
      await page.locator('.discussion-roundtable-page').nth(1).getByRole('button', {name: '補充給此人'}).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '工作訊息');
      assert.equal(await page.getByLabel('補充給', {exact: true}).inputValue(), 'p1');
      await page.getByLabel('工作訊息', {exact: true}).fill('給第一席補充');
      await page.getByRole('button', {name: /送出訊息/}).click();
      assert(
        writes.some(
          w =>
            w.path === '/api/discussion/message' &&
            w.body.threadId === state.threadId &&
            w.body.runId === 'run-one' &&
            w.body.target === 'p1'
        )
      );
      await page.getByRole('button', {name: '開啟圓桌', exact: true}).click();
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('.app').classList.contains('inspector-hidden'));
      await page.waitForFunction(() => document.querySelector('.composer-input')?.value === '');
      await page.getByRole('button', {name: '開啟圓桌', exact: true}).click();
      await page.locator('.discussion-roundtable-pages').waitFor();
      await page.locator('.discussion-roundtable-map button').nth(1).click();
      await page.waitForFunction(() => {
        const n = document.querySelector('.discussion-roundtable-pages');
        return Math.abs(n.scrollLeft - n.clientWidth) < 2;
      });
    } else {
      await page.locator('.discussion-roundtable-grid').waitFor();
      assert.equal(await page.locator('.discussion-roundtable-grid thead th').count(), count + 1);
      assert.equal(await page.locator('.discussion-roundtable-grid tbody tr').count(), 4);
      const first = page.locator('.discussion-roundtable-grid tbody tr').first();
      assert((await first.locator('td').nth(1).innerText()).includes('p1'));
      assert((await first.locator('td').nth(2).innerText()).includes('p2'));
      if (legacy) assert((await page.locator('.discussion-roundtable').innerText()).includes('安排未記錄'));
      else if (count === 6)
        for (const status of ['回覆中', '已完成', '未完成', '本批未點名'])
          assert(await page.locator(`td[data-status="${status}"]`).count());
      await page.locator('.discussion-roundtable-grid').evaluate(n => (n.scrollLeft = 180));
      await first.locator('td').nth(1).getByRole('button').click();
      await page.getByRole('button', {name: '下一位', exact: true}).click();
      assert((await page.locator('.discussion-roundtable-reader').innerText()).includes('END-1-2'));
      await page.getByRole('button', {name: '下一批', exact: true}).click();
      assert((await page.locator('.discussion-roundtable-reader').innerText()).includes('END-2-2'));
      await page.getByRole('button', {name: '回到格子', exact: true}).click();
      assert(await page.locator('.discussion-roundtable-grid').evaluate(n => n.scrollLeft > 0));
      if (count === 6 && !legacy) {
        await page
          .locator('.discussion-roundtable-grid tbody tr')
          .last()
          .locator('td')
          .nth(1)
          .getByRole('button')
          .click();
        const reader = page.locator('.discussion-roundtable-reader .discussion-roundtable-full');
        const update = async marker => {
          state.messages.find(m => m.id === 'r4-p1').text += '\n\n' + marker + '\n\n' + '新增串流原文。\n\n'.repeat(20);
          await page.evaluate(
            state => window.probeStream.onmessage({data: JSON.stringify({type: 'snapshot', state})}),
            state
          );
          await page.getByText(marker, {exact: true}).waitFor();
        };
        assert.equal(await reader.evaluate(n => n.scrollTop), 0);
        await update('STREAM-ONE');
        assert.equal(await reader.evaluate(n => n.scrollTop), 0, 'reading the beginning must not jump to the end');
        await reader.evaluate(n => (n.scrollTop = n.scrollHeight));
        await page.waitForFunction(() => {
          const n = document.querySelector('.discussion-roundtable-reader .discussion-roundtable-full');
          return n.scrollHeight - n.clientHeight - n.scrollTop < 2;
        });
        await update('STREAM-TWO');
        assert(
          await reader.evaluate(n => n.scrollHeight - n.clientHeight - n.scrollTop < 32),
          'only readers at the bottom follow streaming'
        );
        await page.getByRole('button', {name: '回到格子', exact: true}).click();
      }
      await page.getByRole('button', {name: '停止討論', exact: true}).click();
      assert(
        writes.some(w => w.path === '/api/stop' && w.body.threadId === state.threadId && w.body.runId === 'run-one')
      );
      await page.locator('.discussion-roundtable-grid').evaluate(n => n.scrollTo(0, 0));
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({path: path.join(output, `${count}-${width}-${legacy ? 'legacy' : 'new'}.png`)});
    results.push({count, width, legacy, passed: true});
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({results, errors}, null, 2));
  console.log(
    `4/4 roundtable UI scenarios passed (3/6 seats, 390px, long reports, legacy, same-model seats, run-bound operations).`
  );
} finally {
  await browser?.close();
  await server.close();
}
