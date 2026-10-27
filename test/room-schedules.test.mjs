import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {createRoomSchedules} from '../src/room-schedules.mjs';
import {createRoomNotes} from '../src/room-notes.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';
import {createLunaGateway} from '../src/luna-gateway.mjs';
import {scratchBase} from './scratch.mjs';

const knownRooms = async () => ({
  sessions: ['room-main', 'room-target', 'room-a', 'room-1', 'r1'].map(threadId => ({threadId, title: ''}))
});
const tempRoot = name => mkdtemp(path.join(scratchBase, `room-schedules-${name}-`));

test('cron and one-off nextRunAt calculation (Asia/Taipei Saturday 11:00)', async () => {
  const root = await tempRoot('calc');
  let currentTime = new Date('2026-10-24T02:00:00.000Z'); // 2026-10-24 10:00 Asia/Taipei (Saturday)
  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async () => ({sent: true}),
    now: () => currentTime
  });

  try {
    // 1. Cron every Saturday at 11:00 Taipei time
    const res = await schedules.add({
      title: '週檢',
      text: '執行見觀 SEO 週檢',
      cron: '0 11 * * 6',
      timezone: 'Asia/Taipei',
      targetThreadId: 'room-main'
    });
    // Next run should be today at 11:00 Taipei (03:00 UTC)
    assert.equal(res.schedule.nextRunAt, '2026-10-24T03:00:00.000Z');

    // 2. If added after 11:00 Taipei time
    currentTime = new Date('2026-10-24T04:00:00.000Z'); // 12:00 Taipei
    const res2 = await schedules.add({
      title: '週檢2',
      text: '下週六週檢',
      cron: '0 11 * * 6',
      timezone: 'Asia/Taipei',
      targetThreadId: 'room-main'
    });
    // Next run should be next Saturday 11:00 Taipei (2026-10-31 03:00 UTC)
    assert.equal(res2.schedule.nextRunAt, '2026-10-31T03:00:00.000Z');

    // 3. One-off schedule with at
    const atTime = '2026-10-25T10:00:00.000Z';
    const res3 = await schedules.add({
      title: '一次性提醒',
      text: '記得確認資料',
      at: atTime,
      targetThreadId: 'room-main'
    });
    assert.equal(res3.schedule.nextRunAt, atTime);
  } finally {
    await schedules.close();
  }
});

test('triggering saves sending status and next run time to disk before calling deliver', async () => {
  const root = await tempRoot('save-first');
  let currentTime = new Date('2026-10-24T02:59:00.000Z');
  let deliverStarted = false;
  let savedSnapshotDuringDeliver = null;

  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async () => {
      deliverStarted = true;
      const content = await readFile(path.join(root, '.runtime/room-schedules.json'), 'utf8');
      savedSnapshotDuringDeliver = JSON.parse(content);
      return {sent: true};
    },
    now: () => currentTime
  });

  try {
    const {schedule} = await schedules.add({
      title: '即刻排程',
      text: '即將執行',
      at: '2026-10-24T03:00:00.000Z',
      targetThreadId: 'room-target'
    });

    currentTime = new Date('2026-10-24T03:00:01.000Z');
    await schedules.tick();

    assert.equal(deliverStarted, true);
    assert(savedSnapshotDuringDeliver, 'File was written before deliver finished');
    const diskItem = savedSnapshotDuringDeliver.schedules.find(s => s.id === schedule.id);
    assert.equal(diskItem.lastStatus, 'sending');
    assert.equal(diskItem.lastRunAt, '2026-10-24T03:00:00.000Z');
    assert.equal(diskItem.done, true);
    assert.equal(diskItem.nextRunAt, null);
  } finally {
    await schedules.close();
  }
});

test('startup converts sending status to uncertain without resending', async () => {
  const root = await tempRoot('sending-recovery');
  await mkdir(path.join(root, '.runtime'), {recursive: true});
  const filePath = path.join(root, '.runtime/room-schedules.json');

  const staleSchedule = {
    id: 'stale-1',
    threadId: 'room-target',
    title: '未確認工作',
    text: '此排程在發送中斷電',
    cron: '0 11 * * 6',
    at: null,
    timezone: 'Asia/Taipei',
    paused: false,
    createdAt: '2026-10-24T02:00:00.000Z',
    createdByThreadId: 'room-main',
    nextRunAt: '2026-10-31T03:00:00.000Z',
    lastRunAt: '2026-10-24T03:00:00.000Z',
    lastStatus: 'sending',
    lastError: null,
    done: false
  };
  await writeFile(filePath, JSON.stringify({schedules: [staleSchedule]}));

  let deliverCalls = 0;
  const currentTime = new Date('2026-10-24T03:30:00.000Z');
  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async () => {
      deliverCalls++;
      return {sent: true};
    },
    now: () => currentTime
  });

  try {
    await schedules.list();
    const diskContent = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(diskContent.schedules[0].lastStatus, 'uncertain');

    await schedules.tick();
    assert.equal(deliverCalls, 0, 'Did not resend stale sending schedule');
  } finally {
    await schedules.close();
  }
});

test('overdue by more than 2 minutes runs once with overdue packaging notice', async () => {
  const root = await tempRoot('overdue');
  let currentTime = new Date('2026-10-24T02:00:00.000Z');
  const deliveredMessages = [];

  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async data => {
      deliveredMessages.push(data);
      return {sent: true};
    },
    now: () => currentTime
  });

  try {
    await schedules.add({
      title: '逾期測試',
      text: '請檢視營運報表',
      at: '2026-10-24T03:00:00.000Z',
      timezone: 'Asia/Taipei',
      targetThreadId: 'room-a'
    });

    // Advance time by 10 minutes past scheduled time (> 2 minutes overdue)
    currentTime = new Date('2026-10-24T03:10:00.000Z');
    await schedules.tick();

    assert.equal(deliveredMessages.length, 1);
    const msg = deliveredMessages[0].text;
    assert(msg.includes('K 定時排程「逾期測試」'));
    assert(msg.includes('本人先前設定的提醒，不是本人此刻輸入'));
    assert(msg.includes('原定 2026/10/24 11:00'));
    assert(msg.includes('K 當時未開或電腦休眠，現在補送一次'));
    assert(msg.includes('請檢視營運報表'));

    // Tick again: must NOT run again
    await schedules.tick();
    assert.equal(deliveredMessages.length, 1, 'Only delivered once');
  } finally {
    await schedules.close();
  }
});

test('on-time delivery does not include overdue note in packaging text', async () => {
  const root = await tempRoot('on-time');
  let currentTime = new Date('2026-10-24T02:59:00.000Z');
  const deliveredMessages = [];

  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async data => {
      deliveredMessages.push(data);
      return {sent: true};
    },
    now: () => currentTime
  });

  try {
    await schedules.add({
      title: '準時排程',
      text: '準時提醒',
      at: '2026-10-24T03:00:00.000Z',
      timezone: 'Asia/Taipei',
      targetThreadId: 'room-a'
    });

    // Trigger within 30 seconds (< 2 minutes overdue)
    currentTime = new Date('2026-10-24T03:00:30.000Z');
    await schedules.tick();

    assert.equal(deliveredMessages.length, 1);
    const msg = deliveredMessages[0].text;
    assert(msg.includes('K 定時排程「準時排程」'));
    assert(msg.includes('原定 2026/10/24 11:00'));
    assert(!msg.includes('電腦休眠'));
    assert(!msg.includes('補送一次'));
  } finally {
    await schedules.close();
  }
});

test('paused and resumed schedules do not backfill missed periods', async () => {
  const root = await tempRoot('paused-resume');
  let currentTime = new Date('2026-10-24T02:00:00.000Z');
  const deliveredMessages = [];

  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async data => {
      deliveredMessages.push(data);
      return {sent: true};
    },
    now: () => currentTime
  });

  try {
    const {schedule} = await schedules.add({
      title: '暫停排程',
      text: '每週執行',
      cron: '0 11 * * 6',
      timezone: 'Asia/Taipei',
      targetThreadId: 'room-a'
    });

    // Pause the schedule
    await schedules.update({id: schedule.id, paused: true});

    // Advance time past 11:00 Saturday
    currentTime = new Date('2026-10-24T04:00:00.000Z');
    await schedules.tick();
    assert.equal(deliveredMessages.length, 0, 'Did not trigger while paused');

    // Resume the schedule
    const resumed = await schedules.update({id: schedule.id, paused: false});
    // nextRunAt must be computed from now (next Saturday: 2026-10-31), NOT backfilling today's run
    assert.equal(resumed.schedule.nextRunAt, '2026-10-31T03:00:00.000Z');

    await schedules.tick();
    assert.equal(deliveredMessages.length, 0, 'No backfill upon resuming');
  } finally {
    await schedules.close();
  }
});

test('delivery outcome is ignored if schedule was removed during delivery', async () => {
  const root = await tempRoot('remove-inflight');
  let currentTime = new Date('2026-10-24T02:59:00.000Z');
  let deliverBarrier;
  const deliverPromise = new Promise(resolve => {
    deliverBarrier = resolve;
  });

  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async () => {
      await deliverPromise;
      return {sent: true};
    },
    now: () => currentTime
  });

  try {
    const {schedule} = await schedules.add({
      title: '即將刪除',
      text: '文字',
      at: '2026-10-24T03:00:00.000Z',
      targetThreadId: 'room-a'
    });

    currentTime = new Date('2026-10-24T03:00:01.000Z');
    const tickPromise = schedules.tick();

    // Remove the schedule while deliver is in flight
    await schedules.remove({id: schedule.id});

    // Release deliver
    deliverBarrier();
    await tickPromise;

    const list = await schedules.list();
    assert.equal(list.schedules.length, 0, 'Schedule remains removed and was not restored');
  } finally {
    await schedules.close();
  }
});

test('validation limits: title, text, cron 10-minute minimum, at in future, max 100', async () => {
  const root = await tempRoot('validation');
  const currentTime = new Date('2026-10-24T02:00:00.000Z');
  let schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async () => ({sent: true}),
    now: () => currentTime
  });

  try {
    // 1. Title length
    await assert.rejects(
      schedules.add({title: '', text: 'ok', at: '2026-10-24T03:00:00Z', targetThreadId: 'room-1'}),
      /1–80/
    );
    await assert.rejects(
      schedules.add({title: 'a'.repeat(81), text: 'ok', at: '2026-10-24T03:00:00Z', targetThreadId: 'room-1'}),
      /1–80/
    );

    // 2. Text length
    await assert.rejects(
      schedules.add({title: '標題', text: '', at: '2026-10-24T03:00:00Z', targetThreadId: 'room-1'}),
      /1–4000/
    );
    await assert.rejects(
      schedules.add({title: '標題', text: 'a'.repeat(4001), at: '2026-10-24T03:00:00Z', targetThreadId: 'room-1'}),
      /1–4000/
    );

    // 3. Neither or both cron and at
    await assert.rejects(schedules.add({title: '標題', text: 'ok', targetThreadId: 'room-1'}), /cron 或 at/);
    await assert.rejects(
      schedules.add({
        title: '標題',
        text: 'ok',
        cron: '0 * * * *',
        at: '2026-10-24T03:00:00Z',
        targetThreadId: 'room-1'
      }),
      /cron 或 at/
    );

    // 4. Invalid timezone
    await assert.rejects(
      schedules.add({title: '標題', text: 'ok', cron: '0 * * * *', timezone: 'Mars/Phobos', targetThreadId: 'room-1'}),
      /時區/
    );

    // 5. Cron minimum 10-minute interval
    await assert.rejects(
      schedules.add({title: '頻繁', text: '5分鐘一次', cron: '*/5 * * * *', targetThreadId: 'room-1'}),
      /10 分鐘/
    );

    // 6. at in the past
    await assert.rejects(
      schedules.add({title: '過去', text: 'ok', at: '2026-10-24T01:00:00.000Z', targetThreadId: 'room-1'}),
      /未來/
    );

    // 7. Max 100 capacity & pruning oldest done
    for (let i = 0; i < 98; i++) {
      await schedules.add({
        title: `排程-${i}`,
        text: '內容',
        at: `2026-10-25T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
        targetThreadId: 'room-1'
      });
    }
    // Add two one-off that we mark as done
    const sDone1 = await schedules.add({
      title: '已完成-1',
      text: '內容',
      at: '2026-10-25T00:00:00.000Z',
      targetThreadId: 'room-1'
    });
    const sDone2 = await schedules.add({
      title: '已完成-2',
      text: '內容',
      at: '2026-10-25T01:00:00.000Z',
      targetThreadId: 'room-1'
    });

    // Mark them as done
    const raw = JSON.parse(await readFile(path.join(root, '.runtime/room-schedules.json'), 'utf8'));
    raw.schedules.find(s => s.id === sDone1.schedule.id).done = true;
    raw.schedules.find(s => s.id === sDone2.schedule.id).done = true;
    await writeFile(path.join(root, '.runtime/room-schedules.json'), JSON.stringify(raw));
    // Reopen as after a restart so the edited file is read again.
    await schedules.close();
    schedules = createRoomSchedules({
      listSessions: knownRooms,
      root,
      deliver: async () => ({sent: true}),
      now: () => currentTime
    });

    const listBefore = await schedules.list();
    assert.equal(listBefore.schedules.length, 100);

    // Adding 101st: drops oldest done
    await schedules.add({
      title: '第101筆',
      text: '內容',
      at: '2026-10-25T12:00:00.000Z',
      targetThreadId: 'room-1'
    });

    const listAfter = await schedules.list();
    assert.equal(listAfter.schedules.length, 100);
    assert(!listAfter.schedules.some(s => s.id === sDone1.schedule.id), 'Oldest done was pruned');
    assert(
      listAfter.schedules.some(s => s.id === sDone2.schedule.id),
      'Newer done was retained'
    );
  } finally {
    await schedules.close();
  }
});

test('outcomes classification: queued, sent, failed, uncertain', async () => {
  const root = await tempRoot('status-class');
  let currentTime = new Date('2026-10-24T02:00:00.000Z');
  let mode = 'sent';

  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async () => {
      if (mode === 'sent') return {sent: true};
      if (mode === 'queued') return {queued: true};
      if (mode === 'failed') throw Object.assign(Error('not sent'), {notSent: true});
      if (mode === 'uncertain') throw Error('timeout or network issue');
    },
    now: () => currentTime
  });

  try {
    // 1. Sent
    mode = 'sent';
    const s1 = await schedules.add({title: 's1', text: 't1', at: '2026-10-24T03:00:00Z', targetThreadId: 'r1'});
    currentTime = new Date('2026-10-24T03:00:01Z');
    await schedules.tick();
    let row = (await schedules.list()).schedules.find(s => s.id === s1.schedule.id);
    assert.equal(row.lastStatus, 'sent');

    // 2. Queued
    mode = 'queued';
    const s2 = await schedules.add({title: 's2', text: 't2', at: '2026-10-24T04:00:00Z', targetThreadId: 'r1'});
    currentTime = new Date('2026-10-24T04:00:01Z');
    await schedules.tick();
    row = (await schedules.list()).schedules.find(s => s.id === s2.schedule.id);
    assert.equal(row.lastStatus, 'queued');

    // 3. Failed (notSent: true)
    mode = 'failed';
    const s3 = await schedules.add({title: 's3', text: 't3', at: '2026-10-24T05:00:00Z', targetThreadId: 'r1'});
    currentTime = new Date('2026-10-24T05:00:01Z');
    await schedules.tick();
    row = (await schedules.list()).schedules.find(s => s.id === s3.schedule.id);
    assert.equal(row.lastStatus, 'failed');

    // 4. Uncertain (other errors)
    mode = 'uncertain';
    const s4 = await schedules.add({title: 's4', text: 't4', at: '2026-10-24T06:00:00Z', targetThreadId: 'r1'});
    currentTime = new Date('2026-10-24T06:00:01Z');
    await schedules.tick();
    row = (await schedules.list()).schedules.find(s => s.id === s4.schedule.id);
    assert.equal(row.lastStatus, 'uncertain');
  } finally {
    await schedules.close();
  }
});

test('conversation-controller delivery: idle direct send, busy queued, background open, locked refused, leaves note on failure', async () => {
  const root = await tempRoot('cc-deliver');
  await mkdir(path.join(root, '.runtime'), {recursive: true});

  let currentTime = new Date('2026-10-24T02:00:00.000Z');
  // Create three saved sessions: room-idle, room-unopened, and room-archived
  await saveMainSession(root, {
    threadId: 'room-idle',
    title: '閒置房',
    model: 'gpt-6-astra',
    workspace: root,
    archived: false
  });
  await saveMainSession(root, {
    threadId: 'room-unopened',
    title: '未開啟房',
    model: 'gpt-6-astra',
    workspace: root,
    archived: false
  });
  await saveMainSession(root, {
    threadId: 'room-archived',
    title: '已封存房',
    model: 'gpt-6-astra',
    workspace: root,
    archived: true
  });

  let busyState = false;
  let failSend = false;
  const sentMessages = [];
  const factory = () => ({
    state: {
      provider: 'codex',
      status: 'idle',
      workspace: root,
      threadId: null,
      title: '',
      model: 'gpt-6-astra',
      get busy() {
        return busyState;
      },
      messages: []
    },
    async models() {
      return {models: [{model: 'gpt-6-astra'}]};
    },
    async usage() {
      return {};
    },
    async selectWorkspace() {
      return {workspace: root};
    },
    async open(data) {
      this.state.threadId = data.threadId;
      return {threadId: data.threadId};
    },
    async send(data) {
      if (failSend) {
        throw Object.assign(Error('聊天室暫時鎖定拒絕'), {notSent: true});
      }
      sentMessages.push(data);
      if (busyState) {
        return {queued: true, messageId: 'msg-q'};
      }
      return {sent: true};
    },
    async close() {}
  });

  const cc = createConversationController({
    root,
    scheduleClock: {now: () => currentTime},
    sessionFactory: ({roomTools}) => {
      const f = factory();
      f.roomTools = roomTools;
      return f;
    }
  });

  try {
    // 1. Open room-idle as active
    await cc.open({threadId: 'room-idle', model: 'gpt-6-astra'});
    const initialActive = cc.state.threadId;
    assert.equal(initialActive, 'room-idle');

    // Deliver to unopened room-unopened while room-idle is active
    await cc.schedules.add({
      title: '背景送達未開啟房',
      text: '背景開啟測試',
      at: '2026-10-24T03:00:00Z',
      targetThreadId: 'room-unopened'
    });
    currentTime = new Date('2026-10-24T03:00:01Z');
    await cc.schedules.tick();
    assert.equal(sentMessages.length, 1);
    assert(sentMessages[0].text.includes('背景開啟測試'));
    // active room did NOT change
    assert.equal(cc.state.threadId, 'room-idle');

    // 2. Busy room returns queued
    busyState = true;
    await cc.schedules.add({
      title: '排隊排程',
      text: '忙碌排隊訊息',
      at: '2026-10-24T04:00:00Z',
      targetThreadId: 'room-idle'
    });
    currentTime = new Date('2026-10-24T04:00:01Z');
    await cc.schedules.tick();
    const list = await cc.schedules.list();
    const queuedItem = list.schedules.find(s => s.title === '排隊排程');
    assert.equal(queuedItem.lastStatus, 'queued');

    // 3. Archived room fails and leaves coordination note if archived session exists
    busyState = false;
    await assert.rejects(
      cc.schedules.add({
        title: '封存排程',
        text: '送往封存房',
        at: '2026-10-24T05:00:00Z',
        targetThreadId: 'room-archived'
      }),
      /未封存/
    );

    // 4. Nonexistent room fails
    await assert.rejects(
      cc.schedules.add({
        title: '不存在排程',
        text: '無此房間',
        at: '2026-10-24T05:00:00Z',
        targetThreadId: 'non-existent'
      }),
      /未封存/
    );

    // 5. Send failure leaves coordination note in target room
    failSend = true;
    await cc.schedules.add({
      title: '發送失敗排程',
      text: '將會失敗的訊息',
      at: '2026-10-24T06:00:00Z',
      targetThreadId: 'room-idle'
    });
    currentTime = new Date('2026-10-24T06:00:01Z');
    await cc.schedules.tick();
    const list2 = await cc.schedules.list();
    const failedItem = list2.schedules.find(s => s.title === '發送失敗排程');
    assert.equal(failedItem.lastStatus, 'failed');

    // Check room-idle notes
    const notesFile = path.join(root, '.runtime/room-notes/room-idle.json');
    const notesContent = JSON.parse(await readFile(notesFile, 'utf8'));
    const failedNote = notesContent.notes.find(n => n.fromTitle === 'K 定時排程');
    assert(failedNote, 'Left a coordination note from K 定時排程');
    assert(failedNote.text.includes('發送失敗排程'));
    assert(failedNote.text.includes('未送出'));
  } finally {
    await cc.close();
  }
});

test('luna-gateway exposes schedule tools and handles add, list, update, remove', async () => {
  const root = await tempRoot('gateway-schedules');
  const bridge = {
    workerPolicy: {model: 'auto', effort: 'auto'},
    start: async () => ({}),
    wait: async () => ({}),
    inspect: async () => ({}),
    cancel: async () => ({}),
    list: async () => [],
    close: async () => {}
  };
  const calls = [];
  const rooms = {
    list: async () => ({rooms: []}),
    note: async () => ({}),
    schedule: async (action, args) => {
      calls.push([action, args]);
      if (action === 'add') return {schedule: {id: 'sched-1', ...args}};
      if (action === 'list') return {schedules: [{id: 'sched-1', title: 'test'}]};
      if (action === 'update') return {schedule: {id: args.id, title: args.title}};
      return {removed: true, id: args.id};
    }
  };
  const gateway = await createLunaGateway({bridge, rooms});
  try {
    const server = Object.values(gateway.mcpConfig.mcpServers)[0];
    const postRpc = async (method, params) => {
      const res = await fetch(server.url, {
        method: 'POST',
        headers: {
          ...server.headers,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})
      });
      const text = await res.text();
      const data = text
        .split(/\r?\n/u)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
      return JSON.parse(data || text);
    };

    // 1. luna_schedule_add
    const r1 = await postRpc('tools/call', {
      name: 'luna_schedule_add',
      arguments: {title: '週檢', text: '執行週檢', cron: '0 11 * * 6'}
    });
    assert.equal(r1.result.isError, undefined);
    assert.equal(r1.result.structuredContent.schedule.id, 'sched-1');

    // 2. luna_schedule_list
    const r2 = await postRpc('tools/call', {
      name: 'luna_schedule_list',
      arguments: {}
    });
    assert.equal(r2.result.isError, undefined);
    assert.equal(r2.result.structuredContent.schedules.length, 1);

    // 3. luna_schedule_update
    const r3 = await postRpc('tools/call', {
      name: 'luna_schedule_update',
      arguments: {id: 'sched-1', title: '更新週檢'}
    });
    assert.equal(r3.result.isError, undefined);
    assert.equal(r3.result.structuredContent.schedule.title, '更新週檢');

    // 4. luna_schedule_remove
    const r4 = await postRpc('tools/call', {
      name: 'luna_schedule_remove',
      arguments: {id: 'sched-1'}
    });
    assert.equal(r4.result.isError, undefined);
    assert.equal(r4.result.structuredContent.removed, true);

    // 5. strictObject validation error on extra property
    const r5 = await postRpc('tools/call', {
      name: 'luna_schedule_add',
      arguments: {title: '週檢', text: '執行', cron: '0 11 * * 6', extraUnknown: 123}
    });
    assert.equal(r5.result.isError, true);
    assert.deepEqual(
      calls.map(([action]) => action),
      ['add', 'list', 'update', 'remove']
    );
  } finally {
    await gateway.close();
  }
});

test('rejected updates change nothing, local at times follow the timezone, and a refused send consumes the slot', async () => {
  const root = await tempRoot('review-fixes');
  let currentTime = new Date('2026-10-24T02:00:00.000Z');
  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async () => {
      throw Object.assign(Error('refused'), {notSent: true});
    },
    now: () => currentTime
  });
  try {
    const tokyo = await schedules.add({
      title: '東京',
      text: '本地時間',
      at: '2026-10-31T11:00',
      timezone: 'Asia/Tokyo',
      targetThreadId: 'room-a'
    });
    assert.equal(tokyo.schedule.nextRunAt, '2026-10-31T02:00:00.000Z');
    const {schedule} = await schedules.add({
      title: '原標題',
      text: '原內容',
      cron: '0 11 * * 6',
      timezone: 'Asia/Taipei',
      targetThreadId: 'room-a'
    });
    await assert.rejects(schedules.update({id: schedule.id, title: '新標題', cron: '*/5 * * * *'}), /10 分鐘/);
    const kept = (await schedules.list()).schedules.find(s => s.id === schedule.id);
    assert.equal(kept.title, '原標題', 'a rejected update leaves memory unchanged');
    assert.equal(kept.cron, '0 11 * * 6');
    const disk = JSON.parse(await readFile(path.join(root, '.runtime/room-schedules.json'), 'utf8'));
    assert.equal(disk.schedules.find(s => s.id === schedule.id).title, '原標題');

    currentTime = new Date('2026-10-24T03:00:05.000Z');
    await schedules.tick();
    const row = (await schedules.list()).schedules.find(s => s.id === schedule.id);
    assert.equal(row.lastStatus, 'failed', 'a refused send is recorded as not delivered');
    assert.equal(row.nextRunAt, '2026-10-31T03:00:00.000Z', 'the slot is consumed, not retried');
  } finally {
    await schedules.close();
  }
});

test('room tools default the target to the calling chat', async () => {
  const root = await tempRoot('default-target');
  await saveMainSession(root, {threadId: 'room-self', title: '本房', model: 'gpt-6-astra', workspace: root});
  let tools;
  const cc = createConversationController({
    root,
    scheduleClock: {now: () => new Date('2026-10-24T02:00:00.000Z')},
    sessionFactory: ({roomTools}) => {
      tools = roomTools;
      return {state: {}, async close() {}};
    }
  });
  try {
    const {schedule} = await tools.schedule('room-self', 'add', {title: 't', text: 'x', cron: '0 11 * * 6'});
    assert.equal(schedule.threadId, 'room-self');
    assert.equal(schedule.createdByThreadId, 'room-self');
    assert.equal((await tools.schedule('room-self', 'list')).schedules.length, 1);
    await assert.rejects(tools.schedule('room-self', 'bogus'), /未知/);
  } finally {
    await cc.close();
  }
});

test('fired cron slots keep the minimum spacing and cron/at kinds are not interchangeable', async () => {
  const root = await tempRoot('spacing');
  let currentTime = new Date('2026-10-24T00:00:00.000Z');
  const sent = [];
  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async item => sent.push(item) && {sent: true},
    now: () => currentTime
  });
  try {
    // The first five runs are 10 minutes apart, so creation accepts it; 00:50 -> 00:51 must still not fire.
    const {schedule} = await schedules.add({
      title: 'dense',
      text: 'x',
      cron: '0,10,20,30,40,50,51 * * * *',
      timezone: 'UTC',
      targetThreadId: 'room-a'
    });
    currentTime = new Date('2026-10-24T00:50:05.000Z');
    await schedules.tick(); // late catch-up of the 00:10 slot
    const row = (await schedules.list()).schedules.find(s => s.id === schedule.id);
    assert.equal(row.nextRunAt, '2026-10-24T01:10:00.000Z', 'catch-up cannot trigger a second send a minute later');
    currentTime = new Date('2026-10-24T00:51:05.000Z');
    await schedules.tick();
    const after = (await schedules.list()).schedules.find(s => s.id === schedule.id);
    assert.equal(after.nextRunAt, '2026-10-24T01:10:00.000Z', 'next slot is at least 10 minutes after 00:51');
    assert.equal(sent.length, 1, 'the 00:51 slot is skipped after the 00:50 catch-up');

    await assert.rejects(
      schedules.add({title: 't', text: 'x', at: '*/1 * * * * *', targetThreadId: 'room-a'}),
      /ISO 日期時間/
    );
    await assert.rejects(
      schedules.add({title: 't', text: 'x', cron: '2026-10-25T11:00:00Z', targetThreadId: 'room-a'}),
      /cron 須為/
    );
    await assert.rejects(schedules.update({id: schedule.id, at: '0 11 * * 6'}), /ISO 日期時間/);
  } finally {
    await schedules.close();
  }
});

test('a scheduled send the core reports as not sent leaves a note in that room', async () => {
  const root = await tempRoot('sent-false');
  await saveMainSession(root, {threadId: 'room-self', title: '本房', model: 'gpt-6-astra', workspace: root});
  let currentTime = new Date('2026-10-24T02:00:00.000Z');
  const cc = createConversationController({
    root,
    scheduleClock: {now: () => currentTime},
    sessionFactory: () => ({
      state: {provider: 'codex', status: 'idle', workspace: root, threadId: null, model: 'gpt-6-astra', messages: []},
      async selectWorkspace() {},
      async open(data) {
        this.state.threadId = data.threadId;
        return {threadId: data.threadId};
      },
      async send() {
        return {sent: false};
      },
      async close() {}
    })
  });
  try {
    await cc.open({threadId: 'room-self', model: 'gpt-6-astra'});
    await cc.schedules.add({title: '拒收', text: 'x', at: '2026-10-24T03:00:00Z', targetThreadId: 'room-self'});
    currentTime = new Date('2026-10-24T03:00:01Z');
    await cc.schedules.tick();
    const row = (await cc.schedules.list()).schedules[0];
    assert.equal(row.lastStatus, 'failed');
    const notes = JSON.parse(await readFile(path.join(root, '.runtime/room-notes/room-self.json'), 'utf8')).notes;
    assert(notes.some(n => n.fromTitle === 'K 定時排程' && n.text.includes('拒收') && n.text.includes('未送出')));
  } finally {
    await cc.close();
  }
});

test('a tick whose save fails puts its rows back and leaves other in-flight sends intact', async () => {
  const root = await tempRoot('save-fail');
  const file = path.join(root, '.runtime/room-schedules.json');
  let currentTime = new Date('2026-10-24T02:00:00.000Z'),
    release;
  const gate = new Promise(resolve => (release = resolve));
  const sent = [];
  const schedules = createRoomSchedules({
    listSessions: knownRooms,
    root,
    deliver: async item => {
      sent.push(item.title);
      if (item.title === 'A') await gate;
      return {sent: true};
    },
    now: () => currentTime
  });
  try {
    await schedules.add({title: 'A', text: 'x', at: '2026-10-24T03:00:00Z', targetThreadId: 'room-a'});
    await schedules.add({title: 'B', text: 'x', at: '2026-10-24T04:00:00Z', targetThreadId: 'room-a'});
    currentTime = new Date('2026-10-24T03:00:01Z');
    const first = schedules.tick(); // A is now in flight
    await new Promise(resolve => setTimeout(resolve, 20));
    const saved = await readFile(file, 'utf8');
    await rm(file);
    await mkdir(file); // atomic replace onto a directory fails
    currentTime = new Date('2026-10-24T04:00:01Z');
    await assert.rejects(schedules.tick());
    assert.deepEqual(sent, ['A'], 'B was not sent when its sending state could not be saved');
    await rm(file, {recursive: true});
    await writeFile(file, saved);
    release();
    await first;
    const rows = (await schedules.list()).schedules;
    assert.equal(rows.find(s => s.title === 'A').lastStatus, 'sent');
    const b = rows.find(s => s.title === 'B');
    assert.equal(b.lastStatus, null);
    assert.equal(b.nextRunAt, '2026-10-24T04:00:00.000Z', 'B was put back unchanged');
    await schedules.tick();
    assert.deepEqual(sent, ['A', 'B'], 'the next tick sends B');
  } finally {
    await schedules.close();
  }
});

test('one malformed stored cron cannot strand another due schedule', async () => {
  const root = await tempRoot('bad-cron');
  const file = path.join(root, '.runtime/room-schedules.json');
  await mkdir(path.dirname(file));
  const record = {
    threadId: 'room-a',
    text: 'x',
    timezone: 'UTC',
    nextRunAt: '2026-10-24T03:00:00Z',
    lastStatus: null,
    paused: false,
    done: false
  };
  await writeFile(
    file,
    JSON.stringify({
      schedules: [
        {...record, id: 'valid', title: 'valid', cron: null},
        {...record, id: 'bad', title: 'bad', cron: 'not a cron'}
      ]
    })
  );
  const sent = [];
  const schedules = createRoomSchedules({
    root,
    listSessions: knownRooms,
    now: () => new Date('2026-10-24T03:00:01Z'),
    deliver: async item => {
      sent.push(item.id);
      return {sent: true};
    }
  });
  try {
    await schedules.tick();
    await schedules.tick();
    assert.deepEqual(sent, ['valid']);
    const bad = (await schedules.list()).schedules.find(s => s.id === 'bad');
    assert.equal(bad.lastStatus, 'failed');
    assert.match(bad.lastError, /排程時間格式無效/);
    assert.equal(bad.cron, 'not a cron', 'retain the broken rule for inspection/correction');
  } finally {
    await schedules.close();
  }
});
