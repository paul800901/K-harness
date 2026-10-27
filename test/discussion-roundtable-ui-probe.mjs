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
  errors = [],
  layouts = [];
async function checkLayout(page, compact, context) {
  const layout = await page.locator('.discussion-roundtable-grid').evaluate(n => {
    const zoom = Number(getComputedStyle(document.documentElement).getPropertyValue('--k-ui-scale')) || 1;
    const left = n.getBoundingClientRect().left,
      right = left + n.clientWidth * zoom;
    const cells = [
      ...n.querySelectorAll('.discussion-roundtable-cell, .discussion-roundtable-card-target, td[colspan]')
    ].filter(e => e.getClientRects().length);
    const headers = [...n.querySelectorAll('th')].slice(0, 3);
    return {
      width: n.clientWidth,
      scrollWidth: n.scrollWidth,
      compact: getComputedStyle(n.querySelector('thead')).display === 'none',
      cellsFit: cells.every(
        e => e.getBoundingClientRect().left >= left - 1 && e.getBoundingClientRect().right <= right + 1
      ),
      headersFit: headers.every(e => e.getBoundingClientRect().right <= right + 1),
      names: [...n.querySelectorAll('.discussion-roundtable-cell-name')].every(
        e => e.getClientRects().length && e.textContent.trim()
      )
    };
  });
  layouts.push({...context, ...layout});
  assert.equal(layout.compact, compact, JSON.stringify({...context, ...layout}));
  if (compact) {
    assert(
      layout.scrollWidth <= layout.width && layout.cellsFit,
      'all compact cards and controls must fit the visible panel'
    );
    assert(layout.names, 'compact cards must identify their speaker without hidden table headers');
  } else assert(layout.headersFit, 'wide comparison must fit host and up to two participant columns');
}
// The shared focus ring sits 4px outside a control; the roundtable clips overflow, so edge controls need room.
async function checkFocusRoom(page, context) {
  const clipped = await page.locator('.discussion-roundtable').evaluate(root => {
    const zoom = Number(getComputedStyle(document.documentElement).getPropertyValue('--k-ui-scale')) || 1;
    const ring = 4 * zoom,
      box = root.getBoundingClientRect();
    return [
      ...root.querySelectorAll(
        '.discussion-roundtable-title select, .discussion-roundtable-title button, .discussion-roundtable-summary summary, .discussion-roundtable-actions button, .discussion-roundtable-mobile nav select'
      )
    ]
      .filter(e => e.getClientRects().length)
      .filter(e => {
        const r = e.getBoundingClientRect();
        return r.top - ring < box.top - 0.5 || r.left - ring < box.left - 0.5 || r.right + ring > box.right + 0.5;
      })
      .map(e => e.getAttribute('aria-label') || e.textContent.trim());
  });
  assert.deepEqual(clipped, [], `focus rings must not be clipped at the roundtable edge: ${JSON.stringify(context)}`);
}
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
    [1, 1920, false],
    [3, 1920, false],
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
      await checkFocusRoom(page, {count, legacy, width});
      await page.locator('.discussion-roundtable-map button').nth(1).click();
      await page.waitForFunction(() => {
        const n = document.querySelector('.discussion-roundtable-pages');
        return Math.abs(n.scrollLeft - n.clientWidth) < 2;
      });
    } else {
      await page.locator('.discussion-roundtable-grid').waitFor();
      assert(
        await page.locator('.discussion-roundtable-grid').evaluate(n => n.scrollWidth <= n.clientWidth),
        'default narrow roundtable must not clip participant cards horizontally'
      );
      assert.equal(await page.locator('.discussion-roundtable-grid thead th').count(), count + 1);
      assert.equal(await page.locator('.discussion-roundtable-grid tbody tr').count(), 4);
      const first = page.locator('.discussion-roundtable-grid tbody tr').first();
      assert((await first.locator('td').nth(1).innerText()).includes('p1'));
      if (count > 1) assert((await first.locator('td').nth(2).innerText()).includes('p2'));
      if (legacy) assert((await page.locator('.discussion-roundtable').innerText()).includes('安排未記錄'));
      else if (count === 6)
        for (const status of ['回覆中', '已完成', '未完成', '本批未點名'])
          assert(await page.locator(`td[data-status="${status}"]`).count());
      await checkLayout(page, true, {count, legacy, scale: 100, panel: 420});
      await checkFocusRoom(page, {count, legacy, panel: 420});
      await page.screenshot({path: path.join(output, `${count}-${width}-${legacy ? 'legacy' : 'new'}-compact.png`)});
      // Compact cards retain full-text navigation, vertical position and the run-bound target action.
      const lastCard = page
        .locator('.discussion-roundtable-grid tbody tr')
        .last()
        .locator('.discussion-roundtable-cell')
        .nth(1);
      await lastCard.scrollIntoViewIfNeeded();
      const top = await page.locator('.discussion-roundtable-grid').evaluate(n => n.scrollTop);
      await lastCard.focus();
      await page.keyboard.press('Tab');
      assert(
        await page
          .locator('.discussion-roundtable-card-target')
          .first()
          .evaluate(n => n === document.activeElement)
      );
      await page.keyboard.press('Enter');
      assert.equal(await page.getByLabel('補充給', {exact: true}).inputValue(), 'p1');
      await lastCard.click();
      await page.getByRole('button', {name: '回到格子', exact: true}).click();
      assert(Math.abs((await page.locator('.discussion-roundtable-grid').evaluate(n => n.scrollTop)) - top) < 2);
      if (count === 3 && !legacy) {
        for (const scale of [90, 100, 110, 125]) {
          for (const panel of [360, 420, 900]) {
            await page.evaluate(
              ({scale, panel}) => {
                document.documentElement.style.setProperty('--k-ui-scale', String(scale / 100));
                document.querySelector('.app').style.setProperty('--inspector-width', panel + 'px');
              },
              {scale, panel}
            );
            await checkLayout(page, panel < 900, {count, scale, panel});
          }
        }
        await page.evaluate(() => document.documentElement.style.setProperty('--k-ui-scale', '1'));
        for (const content of [649, 650]) {
          await page.evaluate(content => {
            const inset =
              document.querySelector('.inspector').offsetWidth -
              document.querySelector('.discussion-roundtable-grid').clientWidth;
            document.querySelector('.app').style.setProperty('--inspector-width', content + inset + 'px');
          }, content);
          await checkLayout(page, content < 650, {count, scale: 100, content});
        }
      }
      // Use the existing resize control to get a genuine wide comparison, not a window-size heuristic.
      await page.evaluate(() => document.querySelector('.app').style.setProperty('--inspector-width', '420px'));
      const resize = page.getByRole('separator', {name: '調整聊天與工作面板寬度'});
      await resize.focus();
      for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowLeft');
      await checkLayout(page, false, {count, legacy, panel: 'resized'});
      if (count > 1) await page.locator('.discussion-roundtable-grid').evaluate(n => (n.scrollLeft = 180));
      await first
        .locator('td')
        .nth(count > 1 ? 2 : 1)
        .locator('.discussion-roundtable-cell')
        .click();
      if (count > 1) await page.getByRole('button', {name: '下一位', exact: true}).click();
      assert((await page.locator('.discussion-roundtable-reader').innerText()).includes(`END-1-${Math.min(count, 3)}`));
      await page.getByRole('button', {name: '下一批', exact: true}).click();
      assert((await page.locator('.discussion-roundtable-reader').innerText()).includes(`END-2-${Math.min(count, 3)}`));
      await page.getByRole('button', {name: '回到格子', exact: true}).click();
      if (count > 1) assert(await page.locator('.discussion-roundtable-grid').evaluate(n => n.scrollLeft > 0));
      if (count === 6 && !legacy) {
        await page
          .locator('.discussion-roundtable-grid tbody tr')
          .last()
          .locator('td')
          .nth(1)
          .locator('.discussion-roundtable-cell')
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
        await reader.evaluate(
          n =>
            new Promise(resolve => {
              n.addEventListener('scroll', () => requestAnimationFrame(resolve), {once: true});
              n.scrollTop = n.scrollHeight;
            })
        );
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
    if (count === 1) {
      const emit = async () =>
        page.evaluate(state => window.probeStream.onmessage({data: JSON.stringify({type: 'snapshot', state})}), state);
      Object.assign(state, {busy: false, status: 'completed'});
      Object.assign(state.discussion, {busy: false, status: 'completed'});
      state.discussion.runs[0].status = 'completed';
      state.messages.push({
        id: 'note',
        kind: 'discussion',
        runId: 'run-one',
        role: 'user',
        source: 'steer',
        text: '補充原文與限制。'.repeat(30)
      });
      await emit();
      await page.evaluate(() => document.querySelector('.app').style.setProperty('--inspector-width', '420px'));
      await page.locator('td[colspan]').waitFor();
      await checkLayout(page, true, {count, status: 'completed', interjection: true});
      assert.equal(await page.locator('.discussion-roundtable-card-target:visible').count(), 0);
      const mode = page.getByLabel('對話模式', {exact: true});
      assert.equal(await mode.inputValue(), 'normal');
      await mode.selectOption('review');
      state.messages.push({id: 'same-run-refresh', role: 'assistant', text: '同場快照已更新'});
      await emit();
      await page.getByText('同場快照已更新', {exact: true}).waitFor();
      assert.equal(await mode.inputValue(), 'review', 'same-run snapshots must not erase an explicit new choice');
      const issue = 'Gemini 3.8 Flash：agy no output produced（沒有最終回答）。';
      state.discussion.error = issue;
      state.discussion.runs[0].error = issue;
      state.discussion.runs[0].status = 'failed';
      await emit();
      await page.locator('.discussion-roundtable-entry .discussion-run-notice').waitFor();
      assert.equal(await page.locator('.discussion-controls').getByText(issue).count(), 0);
      assert.equal(await page.locator('.discussion-roundtable-entry .discussion-run-notice').innerText(), issue);
      state.discussion.runs.push({
        id: 'clean-run',
        question: '下一場討論',
        mode: 'meeting',
        status: 'completed',
        participants: []
      });
      Object.assign(state.discussion, {id: 'clean-run', error: null});
      state.messages.push({
        id: 'clean-question',
        runId: 'clean-run',
        kind: 'discussion',
        role: 'user',
        text: '下一場討論'
      });
      await emit();
      await page.waitForFunction(() => document.querySelectorAll('.discussion-roundtable-entry').length === 2);
      assert.equal(await page.locator('.discussion-roundtable-entry').nth(1).getByText(issue).count(), 0);
      assert.equal(await page.locator('.discussion-roundtable-entry').first().getByText(issue).count(), 1);
      // Restore the fixture for the existing room-switch checks.
      state.discussion.runs.pop();
      state.messages.pop();
      Object.assign(state.discussion, {id: 'run-one', error: issue});
      const original = structuredClone(state);
      // Switching rooms remounts the composer. An absent discussion snapshot must not consume saved intent.
      await page.evaluate(() =>
        sessionStorage.setItem(
          'k-discussion:room-b',
          JSON.stringify({mode: 'parallel', runId: 'b-old', participants: []})
        )
      );
      Object.assign(state, {threadId: 'room-b', discussion: undefined, messages: []});
      await emit();
      await page.waitForFunction(() => document.querySelector('[aria-label="對話模式"]')?.value === 'parallel');
      await mode.selectOption('meeting');
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('k-discussion:room-b')).runId), 'b-old');
      Object.assign(state, original);
      // This room's run changed while it was not visible; returning consumes the stale setting.
      state.discussion.id = 'run-two';
      state.discussion.status = 'uncertain';
      await emit();
      await page.waitForFunction(() => document.querySelector('[aria-label="對話模式"]')?.value === 'normal');
      assert.equal(await page.locator('.discussion-toolbar small').innerText(), '上一場：多人討論 · 結果待確認');
      assert.equal(
        await page.evaluate(() => JSON.parse(sessionStorage.getItem('k-discussion:room-b')).mode),
        'meeting'
      );
    }
    results.push({count, width, legacy, passed: true});
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({results, layouts, errors}, null, 2));
  console.log(
    `${results.length}/${results.length} roundtable UI scenarios passed (1/3/6 seats, narrow/wide panels, 90/100/110/125% scale, 390px, long reports, legacy, same-model seats, run-bound operations).`
  );
} finally {
  await browser?.close();
  await server.close();
}
