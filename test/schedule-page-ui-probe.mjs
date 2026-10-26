import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {preview} from 'vite';

const output = probeEvidenceDir('schedule-page-20261026');
await mkdir(output, {recursive: true});

const root = path.resolve(import.meta.dirname, '..');
const server = await preview({configFile: path.join(root, 'vite.config.mjs'), preview: {host: '127.0.0.1', port: 0}});
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');

let browser;
const errors = [];

try {
  browser = await launchProbeBrowser();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  page.setDefaultTimeout(7000);
  page.on('pageerror', e => errors.push(e.message));

  const schedulesData = [
    {
      id: 'sched-1',
      threadId: 'room-main',
      targetTitle: '主要聊天室',
      title: '見觀 SEO 週檢',
      text: '請執行見觀 SEO 週檢腳本並回報結果。',
      cron: '0 11 * * 6',
      timezone: 'Asia/Taipei',
      paused: false,
      done: false,
      nextRunAt: '2026-10-31T03:00:00.000Z',
      lastRunAt: '2026-10-24T03:00:00.000Z',
      lastStatus: 'sent',
      lastError: null,
      createdAt: '2026-10-20T00:00:00.000Z',
      upcoming: ['2026-10-31T03:00:00.000Z', '2026-11-07T03:00:00.000Z', '2026-11-14T03:00:00.000Z']
    },
    {
      id: 'sched-2',
      threadId: 'room-main',
      targetTitle: '主要聊天室',
      title: '月度盤點',
      text: '執行每月資源與帳號盤點。',
      cron: '0 10 1 * *',
      timezone: 'Asia/Taipei',
      paused: true,
      done: false,
      nextRunAt: '2026-11-01T02:00:00.000Z',
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      createdAt: '2026-10-20T00:00:00.000Z',
      upcoming: []
    },
    {
      id: 'sched-3',
      threadId: 'room-main',
      targetTitle: '主要聊天室',
      title: '一次性提醒',
      text: '提醒準備週會報告。',
      at: '2026-10-25T01:00:00.000Z',
      timezone: 'Asia/Taipei',
      paused: false,
      done: true,
      nextRunAt: null,
      lastRunAt: '2026-10-25T01:00:00.000Z',
      lastStatus: 'sent',
      lastError: null,
      createdAt: '2026-10-24T00:00:00.000Z',
      upcoming: []
    }
  ];

  const state = {
    threadId: 'room-main',
    title: '主要聊天室',
    workspace: process.cwd(),
    provider: 'codex',
    model: 'gpt-6.1-sol',
    status: 'ready',
    busy: false,
    messages: [],
    tools: [],
    questions: [],
    notices: [],
    artifacts: [],
    capabilities: {},
    conversationActivity: [],
    workerActivity: {running: 0},
    scheduleRevision: 1
  };

  await page.addInitScript(
    ({state}) => {
      localStorage.setItem('k-appearance', JSON.stringify({interfaceScale: 100, dialogueFontSize: 16}));
      localStorage.setItem('k-color-theme', 'warm');
      window.EventSource = class {
        constructor() {
          window.testStream = this;
          setTimeout(() => this.onmessage?.({data: JSON.stringify({type: 'snapshot', state})}), 0);
        }
        close() {}
      };
    },
    {state}
  );

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.pathname === '/api/schedules') {
        return route.fulfill({json: {schedules: schedulesData}});
      }
      if (url.pathname === '/api/state') {
        return route.fulfill({json: state});
      }
      if (url.pathname === '/api/sessions') {
        return route.fulfill({
          json: {
            sessions: [
              {
                threadId: 'room-main',
                title: '主要聊天室',
                workspace: process.cwd(),
                model: 'gpt-6.1-sol',
                archived: false
              }
            ]
          }
        });
      }
      if (url.pathname === '/api/projects') {
        return route.fulfill({json: {projects: [{path: process.cwd(), name: '主要工作區'}]}});
      }
      if (url.pathname === '/api/models') {
        return route.fulfill({json: {models: [{model: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol'}]}});
      }
    }
    return route.fulfill({json: {}});
  });

  await page.goto(origin);

  // 1. Check sidebar has the schedule button
  const scheduleBtn = page.locator('button.sidebar-schedule-button');
  await scheduleBtn.waitFor({state: 'visible'});
  assert.equal(await scheduleBtn.innerText(), '排程');

  // 2. Click schedule button to show schedule page in main area (not a dialog)
  await scheduleBtn.click();

  // Verify no modal/dialog is opened
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Schedule view should not open as a dialog');

  // Verify schedule page rendered in main area
  const schedulePage = page.locator('main .schedule-page');
  await schedulePage.waitFor({state: 'visible'});
  await schedulePage.locator('h1', {hasText: '排程'}).waitFor();

  // Verify sidebar schedule button is selected
  assert.ok(
    await scheduleBtn.evaluate(el => el.classList.contains('selected')),
    'Sidebar schedule button must have selected class'
  );

  // 3. Verify sections: 使用中, 已暫停, 已結束
  await schedulePage.getByText('使用中', {exact: true}).waitFor();
  await schedulePage.getByText('已暫停', {exact: true}).waitFor();
  await schedulePage.getByText('已結束', {exact: true}).waitFor();

  // 4. Verify titles and statuses
  await schedulePage.getByText('見觀 SEO 週檢').waitFor();
  await schedulePage.getByText('送進：主要聊天室').first().waitFor();
  await schedulePage.getByText('月度盤點').waitFor();
  await schedulePage.getByText('一次性提醒').waitFor();
  await schedulePage.getByText('上次：已送出', {exact: false}).first().waitFor();
  await schedulePage.getByText('上次：尚未執行', {exact: false}).waitFor();

  // 5. Expand first schedule item
  const firstItemHeader = schedulePage.locator('.schedule-item-header').first();
  await firstItemHeader.click();

  // Verify details expanded
  await schedulePage.getByText('請執行見觀 SEO 週檢腳本並回報結果。').waitFor();
  await schedulePage.getByText('接下來', {exact: true}).waitFor();
  const openRoomBtn = schedulePage.getByRole('button', {name: '開啟聊天室'});
  await openRoomBtn.waitFor({state: 'visible'});
  await schedulePage.getByRole('button', {name: '暫停'}).waitFor();
  await schedulePage.getByRole('button', {name: '刪除'}).waitFor();

  // 6. Test delete confirmation flow
  const deleteBtn = schedulePage.locator('button', {hasText: '刪除'});
  await deleteBtn.click();

  await schedulePage.getByText('確定要刪除排程「見觀 SEO 週檢」？').waitFor();
  const cancelBtn = schedulePage.locator('button', {hasText: '取消'});
  await cancelBtn.waitFor({state: 'visible'});
  // Cancel button should be focused
  const isCancelFocused = await cancelBtn.evaluate(el => el === document.activeElement);
  assert.equal(isCancelFocused, true, 'Cancel button must receive default focus in delete confirmation');

  // Cancel deletion
  await cancelBtn.click();
  await schedulePage.getByText('確定要刪除排程「見觀 SEO 週檢」？').waitFor({state: 'detached'});

  // 7. Click "開啟聊天室" -> returns to chat view
  await openRoomBtn.click();

  // Verify schedule page is gone and chat view is active
  await schedulePage.waitFor({state: 'detached'});
  await page.locator('main .thread').waitFor({state: 'visible'});
  assert.ok(
    !(await scheduleBtn.evaluate(el => el.classList.contains('selected'))),
    'Sidebar schedule button should lose selected class after returning to chat'
  );

  // 8. Mobile scenario (e.g. 390px width)
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(100);

  // In mobile view, expand sidebar first if collapsed
  const expandSidebarBtn = page.locator('header button[title="展開側欄"]');
  if (await expandSidebarBtn.isVisible()) {
    await expandSidebarBtn.click();
  }

  // Sidebar is now visible
  await scheduleBtn.waitFor({state: 'visible'});

  // Click schedule button on mobile
  await scheduleBtn.click();

  // Verify schedule page appears and sidebar is closed on mobile
  await page.locator('main .schedule-page').waitFor({state: 'visible'});
  const sidebarEl = page.locator('.sidebar');
  const sidebarVisible = await sidebarEl.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  });
  // On mobile, the sidebar collapses when schedule page is opened
  const backdrop = page.locator('.mobile-backdrop');
  assert.equal(await backdrop.count(), 0, 'Mobile backdrop should be dismissed when entering schedule page');

  // Verify expand sidebar button is accessible from schedule page on mobile
  const scheduleSidebarToggle = page.locator('.schedule-page-header button[title="展開側欄"]');
  await scheduleSidebarToggle.waitFor({state: 'visible'});
  await scheduleSidebarToggle.click();

  // Sidebar reopens
  await page.locator('.sidebar').waitFor({state: 'visible'});

  // Click a session in sidebar to return to chat
  const sessionItem = page.locator('.sidebar .session-open').first();
  await sessionItem.click();

  // Verify returns to chat on mobile
  await page.locator('main .schedule-page').waitFor({state: 'detached'});
  await page.locator('main .thread').waitFor({state: 'visible'});

  console.log('Schedule page UI probe passed successfully.');
} finally {
  if (browser) await browser.close();
  await server.close();
}

assert.equal(errors.length, 0, `Page errors: ${errors.join(', ')}`);
