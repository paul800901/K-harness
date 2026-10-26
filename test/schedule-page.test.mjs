import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {computeUpcoming} from '../src/room-schedules.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {remoteRouteAllowed} from '../src/remote-access.mjs';
import {scratchBase} from './scratch.mjs';

const tempRoot = name => mkdtemp(path.join(scratchBase, `sched-page-${name}-`));

test('upcoming calculation: cron, one-off, paused, and done', () => {
  // 1. Cron schedule: nextRunAt + up to 2 future runs = 3 runs
  const cronSchedule = {
    cron: '0 11 * * 6',
    timezone: 'Asia/Taipei',
    nextRunAt: '2026-10-31T03:00:00.000Z',
    paused: false,
    done: false
  };
  const upcomingCron = computeUpcoming(cronSchedule);
  assert.equal(upcomingCron.length, 3);
  assert.equal(upcomingCron[0], '2026-10-31T03:00:00.000Z');
  assert.equal(upcomingCron[1], '2026-11-07T03:00:00.000Z');
  assert.equal(upcomingCron[2], '2026-11-14T03:00:00.000Z');

  // 2. One-off schedule: only nextRunAt
  const oneOffSchedule = {
    cron: null,
    at: '2026-11-01T10:00:00.000Z',
    timezone: 'Asia/Taipei',
    nextRunAt: '2026-11-01T10:00:00.000Z',
    paused: false,
    done: false
  };
  assert.deepEqual(computeUpcoming(oneOffSchedule), ['2026-11-01T10:00:00.000Z']);

  // 3. Paused schedule returns []
  assert.deepEqual(computeUpcoming({...cronSchedule, paused: true}), []);

  // 4. Done schedule returns []
  assert.deepEqual(computeUpcoming({...cronSchedule, done: true}), []);

  // 5. Missing or null nextRunAt returns []
  assert.deepEqual(computeUpcoming({...cronSchedule, nextRunAt: null}), []);
});

test('scheduleRevision increments on add, update, and remove in conversation-controller', async () => {
  const root = await tempRoot('revision');
  await mkdir(path.join(root, '.runtime'), {recursive: true});
  await saveMainSession(root, {
    threadId: 'room-rev',
    title: '修訂測試房',
    model: 'gpt-6-astra',
    workspace: root,
    archived: false
  });

  const factory = () => ({
    state: {
      provider: 'codex',
      status: 'idle',
      workspace: root,
      threadId: null,
      title: '',
      model: 'gpt-6-astra',
      busy: false,
      messages: []
    },
    models: async () => ({models: []}),
    usage: async () => ({}),
    selectWorkspace: async () => ({workspace: root}),
    open: async d => ({threadId: d.threadId}),
    send: async () => ({sent: true}),
    close: async () => {}
  });

  const cc = createConversationController({
    root,
    scheduleClock: {now: () => new Date('2026-10-24T02:00:00.000Z')},
    sessionFactory: ({roomTools}) => {
      const f = factory();
      f.roomTools = roomTools;
      return f;
    }
  });

  try {
    assert.equal(cc.state.scheduleRevision, 0);

    const added = await cc.schedules.add({
      title: '排程修訂1',
      text: '指示內容',
      at: '2026-10-31T03:00:00.000Z',
      targetThreadId: 'room-rev'
    });
    assert.equal(cc.state.scheduleRevision, 1);

    await cc.schedules.update({
      id: added.schedule.id,
      paused: true
    });
    assert.equal(cc.state.scheduleRevision, 2);

    await cc.schedules.remove({
      id: added.schedule.id
    });
    assert.equal(cc.state.scheduleRevision, 3);
  } finally {
    await cc.close();
  }
});

test('remote access allows schedules read and write routes', () => {
  assert.equal(remoteRouteAllowed('GET', '/api/schedules'), true);
  assert.equal(remoteRouteAllowed('POST', '/api/schedules'), false);
  assert.equal(remoteRouteAllowed('POST', '/api/schedules/update'), true);
  assert.equal(remoteRouteAllowed('GET', '/api/schedules/update'), false);
  assert.equal(remoteRouteAllowed('POST', '/api/schedules/remove'), true);
  assert.equal(remoteRouteAllowed('GET', '/api/schedules/remove'), false);
});

test('desktop HTTP routes for schedules: GET list with upcoming, POST update, POST remove, validation, and CSRF check', async () => {
  const root = await tempRoot('http-routes');
  await mkdir(path.join(root, '.runtime'), {recursive: true});
  await saveMainSession(root, {
    threadId: 'room-http',
    title: 'HTTP測試房',
    model: 'gpt-6-astra',
    workspace: root,
    archived: false
  });

  const factory = () => ({
    state: {
      provider: 'codex',
      status: 'idle',
      workspace: root,
      threadId: null,
      title: '',
      model: 'gpt-6-astra',
      busy: false,
      messages: []
    },
    models: async () => ({models: []}),
    usage: async () => ({}),
    selectWorkspace: async () => ({workspace: root}),
    open: async d => ({threadId: d.threadId}),
    send: async () => ({sent: true}),
    close: async () => {}
  });

  const cc = createConversationController({
    root,
    scheduleClock: {now: () => new Date('2026-10-24T02:00:00.000Z')},
    sessionFactory: ({roomTools}) => {
      const f = factory();
      f.roomTools = roomTools;
      return f;
    }
  });

  const app = await startDesktop({
    root,
    executable: 'test',
    port: 0,
    controllerFactory: () => cc
  });

  try {
    const launchRes = await fetch(app.createLaunchUrl(), {redirect: 'manual'});
    const cookie = launchRes.headers.get('set-cookie').split(';')[0];
    const headers = {
      cookie,
      'Content-Type': 'application/json',
      'X-K-Request': '1'
    };

    // 1. Initial GET /api/schedules -> empty list
    const getRes1 = await fetch(`${app.origin}/api/schedules`, {headers: {cookie}});
    assert.equal(getRes1.status, 200);
    const body1 = await getRes1.json();
    assert.deepEqual(body1.schedules, []);

    // Add a schedule via cc.schedules
    const added = await cc.schedules.add({
      title: '測試排程',
      text: '內容',
      cron: '0 11 * * 6',
      timezone: 'Asia/Taipei',
      targetThreadId: 'room-http'
    });

    // 2. GET /api/schedules -> list with upcoming
    const getRes2 = await fetch(`${app.origin}/api/schedules`, {headers: {cookie}});
    assert.equal(getRes2.status, 200);
    const body2 = await getRes2.json();
    assert.equal(body2.schedules.length, 1);
    const item = body2.schedules[0];
    assert.equal(item.id, added.schedule.id);
    assert.equal(item.targetTitle, 'HTTP測試房');
    assert.equal(item.upcoming.length, 3);

    // 3. POST /api/schedules/update -> valid pause
    const updateRes1 = await fetch(`${app.origin}/api/schedules/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({id: item.id, paused: true})
    });
    assert.equal(updateRes1.status, 200);
    const updateBody1 = await updateRes1.json();
    assert.equal(updateBody1.schedule.paused, true);

    // Verify GET reflects paused status and upcoming is empty
    const getRes3 = await fetch(`${app.origin}/api/schedules`, {headers: {cookie}});
    const body3 = await getRes3.json();
    assert.equal(body3.schedules[0].paused, true);
    assert.deepEqual(body3.schedules[0].upcoming, []);

    // The page route only pauses or resumes; other fields are not forwarded.
    const resumeRes = await fetch(`${app.origin}/api/schedules/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({id: item.id, paused: false, title: '被改掉', cron: '*/1 * * * *'})
    });
    assert.equal(resumeRes.status, 200);
    const resumed = (await resumeRes.json()).schedule;
    assert.equal(resumed.paused, false);
    assert.equal(resumed.title, '測試排程');
    assert.equal(resumed.cron, '0 11 * * 6');

    // 4. POST /api/schedules/update -> reject non-boolean paused
    const updateRes2 = await fetch(`${app.origin}/api/schedules/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({id: item.id, paused: 'true'})
    });
    assert.equal(updateRes2.status, 400);

    const updateRes3 = await fetch(`${app.origin}/api/schedules/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({id: item.id, paused: 1})
    });
    assert.equal(updateRes3.status, 400);

    // 5. POST /api/schedules/update -> reject unknown id
    const updateRes5 = await fetch(`${app.origin}/api/schedules/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({id: 'nonexistent-id', paused: false})
    });
    assert.equal(updateRes5.status, 400);

    // 6. POST /api/schedules/remove -> reject unknown id
    const removeResErr = await fetch(`${app.origin}/api/schedules/remove`, {
      method: 'POST',
      headers,
      body: JSON.stringify({id: 'nonexistent-id'})
    });
    assert.equal(removeResErr.status, 400);

    // 7. POST /api/schedules/remove -> success
    const removeRes = await fetch(`${app.origin}/api/schedules/remove`, {
      method: 'POST',
      headers,
      body: JSON.stringify({id: item.id})
    });
    assert.equal(removeRes.status, 200);
    assert.equal((await removeRes.json()).removed, true);

    // Verify GET list is empty again
    const getRes4 = await fetch(`${app.origin}/api/schedules`, {headers: {cookie}});
    assert.deepEqual((await getRes4.json()).schedules, []);

    // 8. Reject missing X-K-Request header on POST
    const noHeaderRes = await fetch(`${app.origin}/api/schedules/update`, {
      method: 'POST',
      headers: {cookie, 'Content-Type': 'application/json'},
      body: JSON.stringify({id: item.id, paused: true})
    });
    assert.equal(noHeaderRes.status, 403);
  } finally {
    await app.close();
    await cc.close();
  }
});
