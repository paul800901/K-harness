import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createGeminiAccounts} from '../src/gemini-accounts.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {scratchBase} from './scratch.mjs';
import {settleAfterRelease} from './fixtures/gemini-accounts-settle.mjs';

const base = scratchBase;
const A = 'a'.repeat(32),
  B = 'b'.repeat(32),
  C = 'c'.repeat(32),
  D = 'd'.repeat(32),
  E = 'e'.repeat(32);
const email = 'same@example.test';
const future = Date.parse('2026-10-10T00:00:00Z') / 1000;
async function fixture({
  enabled = true,
  identity = null,
  statusFor = () => authStatus(),
  root,
  clock = () => Date.parse('2026-10-03T12:00:00Z'),
  setTimer,
  clearTimer
} = {}) {
  await mkdir(base, {recursive: true});
  root ??= await mkdtemp(path.join(base, 'gemini-accounts-'));
  let current = identity ? {accountId: identity.accountId, email: identity.email ?? email} : null;
  const calls = {capture: 0, activate: [], activateOptions: [], prepareLogin: 0, assertIdle: 0, status: 0, start: 0};
  let idle = true;
  const vault = {
    current: async () => (current ? {...current} : null),
    capture: async () => {
      calls.capture++;
      if (!current) throw Error('no identity fixture');
      return {...current};
    },
    activate: async (id, options = {}) => {
      calls.activate.push(id);
      calls.activateOptions.push({id, ...options});
      current = {accountId: id, email: id === A ? 'a@example.test' : id === B ? 'b@example.test' : 'c@example.test'};
      return {...current};
    },
    prepareLogin: async () => {
      calls.prepareLogin++;
      current = null;
      return {previousAccountId: identity?.accountId ?? null};
    },
    assertIdle: async () => {
      calls.assertIdle++;
      if (!idle) throw Error('fixture busy');
      return true;
    }
  };
  const login = {
    status: async account => {
      calls.status++;
      return statusFor(account ?? current, calls.status);
    },
    start: async () => {
      calls.start++;
    }
  };
  vault.queryQuota = async id => ({accountId: id, ...(await login.status({accountId: id, email}))});
  return {
    root,
    calls,
    vault,
    login,
    get current() {
      return current ? {...current} : null;
    },
    set current(value) {
      current = value ? {...value} : null;
    },
    set idle(v) {
      idle = v;
    },
    accounts: settleAfterRelease(createGeminiAccounts({root, login, vault, enabled, clock, setTimer, clearTimer}))
  };
}
function authStatus(
  quota = {
    status: 'available',
    windows: [{remainingPercent: 80, resetsAt: future}],
    checkedAt: '2026-10-03T11:59:30.000Z'
  }
) {
  return {auth: {status: 'authenticated', checkedAt: '2026-10-03T11:59:30.000Z'}, quota};
}

const eventually = async check => {
  const end = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > end) throw Error('scheduler event missing');
    await new Promise(r => setImmediate(r));
  }
};
test('passive account observation while busy uses dated evidence without switching or querying', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  const lease = await f.accounts.acquire(),
    before = structuredClone(f.calls);
  try {
    for (let i = 0; i < 18; i++) {
      const info = await f.accounts.observe({
        parentId: 'room',
        requestId: 'query',
        onHandoff: () => assert.fail('unneeded notification')
      });
      assert.equal(info.scheduling.status, 'ready');
      assert.equal(info.quotaEvidence, 'last-official-observation');
    }
    assert.deepEqual(f.calls, before);
  } finally {
    await lease.release();
  }
});
test('aged positive observations are refreshed read-only across four busy rooms and admit new work on same identity', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z');
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{key: 'five_hour', remainingPercent: 80, resetsAt: future}]
      })
  });
  await f.accounts.capture();
  const lease = await f.accounts.acquire(),
    before = f.calls.status,
    events = [];
  now += 120000;
  try {
    for (let i = 0; i < 18; i++) {
      const info = await f.accounts.observe({
        parentId: `room-${i % 4}`,
        requestId: `query-${i % 4}`,
        onHandoff: e => events.push(e)
      });
      assert.equal(info.scheduling.status, 'ready');
      assert.equal(info.scheduling.notificationRegistered, false);
    }
    let runs = 0;
    await f.accounts.run(
      {worker: true, parentId: 'room-2', requestId: 'new', onHandoff: e => events.push(e)},
      async () => {
        runs++;
        return {status: 'completed', settled: true};
      }
    );
    assert.equal(runs, 1);
    assert(f.calls.status > before);
    assert.deepEqual(events, []);
    assert.deepEqual(f.calls.activate, []);
    await lease.release();
    assert.deepEqual(events, []);
  } finally {
    await lease.release();
  }
});

test('worker admission can await an already in-flight refresh directly without creating a model notification', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  let release, entered;
  const begun = new Promise(r => (entered = r));
  f.login.status = () => {
    entered();
    return new Promise(r => (release = () => r(authStatus())));
  };
  const refresh = f.accounts.refresh();
  await begun; // refreshPending joins are allowed to await directly
  const events = [];
  const dispatch = f.accounts.run(
    {worker: true, parentId: 'room', requestId: 'job', onHandoff: e => events.push(e)},
    async () => ({status: 'completed', settled: true})
  );
  release();
  f.login.status = async () => authStatus();
  await refresh;
  assert.equal((await dispatch).status, 'completed');
  assert.deepEqual(events, []);
});
test('official all-zero reset is waited by K timer, repeated observations neither poll nor replay, then notify each room', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    positive = false;
  const reset = now + 120000,
    timers = [],
    events = [];
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    setTimer: (fn, ms) => {
      const t = {fn, ms};
      timers.push(t);
      return t;
    },
    clearTimer: t => {
      t.cancelled = true;
    },
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{key: 'five_hour', remainingPercent: positive ? 70 : 0, resetsAt: reset / 1000}]
      })
  });
  for (const id of [A, B]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  const count = f.calls.status;
  await f.accounts.observe({parentId: 'room-1', requestId: 'query-1', onHandoff: e => events.push(e)});
  await eventually(() => timers.length === 1);
  for (let i = 0; i < 18; i++)
    await f.accounts.observe({parentId: 'room-2', requestId: 'query-2', onHandoff: e => events.push(e)});
  await new Promise(r => setImmediate(r));
  assert.equal(f.calls.status, count);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 120000);
  positive = true;
  now = reset;
  timers[0].fn();
  await eventually(() => events.filter(e => e.status === 'ready').length === 2);
  assert.equal(f.calls.status, count + 2, 'official reset recovery checks both accounts once');
  assert(events.filter(e => e.status === 'ready').every(e => e.requestIds.length === 0));
  assert.equal((await f.accounts.list()).busy, false);
});
test('last stopped account observer cancels reset timer; startup does not resurrect waits', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z');
  const timers = [],
    events = [];
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    setTimer: (fn, ms) => {
      const t = {fn, ms};
      timers.push(t);
      return t;
    },
    clearTimer: t => {
      t.cancelled = true;
    },
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{key: 'five_hour', remainingPercent: 0, resetsAt: (now + 120000) / 1000}]
      })
  });
  await f.accounts.capture();
  await f.accounts.observe({parentId: 'room', requestId: 'query', onHandoff: e => events.push(e)});
  await eventually(() => timers.length === 1);
  f.accounts.cancelWorkerHandoff({parentId: 'room'});
  assert.equal(timers[0].cancelled, true);
  const count = f.calls.status;
  now += 120000;
  timers[0].fn();
  await new Promise(r => setImmediate(r));
  assert.equal(f.calls.status, count);
  assert.equal(
    events.some(e => e.status === 'ready'),
    false
  );
  const restarted = createGeminiAccounts({
    root: f.root,
    login: f.login,
    vault: f.vault,
    enabled: true,
    clock: () => now
  });
  await restarted.list();
  assert.equal(f.calls.status, count);
});

test('explicit official refresh supersedes an old reset deadline and wakes its existing observer', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    positive = false;
  const timers = [],
    events = [];
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    setTimer: (fn, ms) => {
      const t = {fn, ms};
      timers.push(t);
      return t;
    },
    clearTimer: t => {
      t.cancelled = true;
    },
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{key: 'five_hour', remainingPercent: positive ? 70 : 0, resetsAt: (now + 120000) / 1000}]
      })
  });
  await f.accounts.capture();
  await f.accounts.observe({parentId: 'room', requestId: 'query', onHandoff: e => events.push(e)});
  await eventually(() => timers.length === 1);
  positive = true;
  await f.accounts.refresh();
  await eventually(() => events.some(e => e.status === 'ready'));
  assert.equal(timers[0].cancelled, true);
  assert.equal(events.filter(e => e.status === 'ready').length, 1);
  assert.deepEqual(f.calls.activate, []);
});
test('unknown quota is not admitted or interpreted as zero', async () => {
  const quota = {status: 'unavailable', windows: []},
    f = await fixture({identity: {accountId: A, email}, statusFor: () => authStatus(quota)});
  await f.accounts.capture();
  const before = structuredClone(f.calls);
  await assert.rejects(f.accounts.acquire({worker: true}), /額度尚未確認|尚無官方目前額度資料/u);
  const result = await f.accounts.list();
  assert.deepEqual(result.accounts[0].quota, quota);
  assert.equal(result.accounts[0].quota.status, 'unavailable');
  assert.deepEqual(f.calls.activate, before.activate);
});
test('official zero with unknown reset keeps an owned quiet retry without inventing a reset time', async () => {
  const timers = [],
    events = [],
    f = await fixture({
      identity: {accountId: A, email},
      setTimer: (fn, ms) => {
        const timer = {fn, ms};
        timers.push(timer);
        return timer;
      },
      clearTimer: timer => {
        timer.cancelled = true;
      },
      statusFor: () => authStatus({status: 'ready', windows: [{key: 'five_hour', remainingPercent: 0}]})
    });
  await f.accounts.capture();
  await f.accounts.observe({parentId: 'room', requestId: 'query', onHandoff: e => events.push(e)});
  await eventually(() => timers.length === 1);
  assert.equal(events.at(-1).status, 'waiting');
  assert.equal(timers[0].ms, 60000);
  assert.deepEqual(f.calls.activate, []);
  assert.equal(
    events.some(e => e.status === 'ready'),
    false
  );
  f.accounts.cancelWorkerHandoff({parentId: 'room'});
  assert.equal(timers[0].cancelled, true);
});

test('read-only per-account quota refresh is allowed during active work and does not change login', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  let finish;
  const pending = f.accounts.inspect(() => new Promise(r => (finish = r)));
  while (!finish) await new Promise(r => setImmediate(r));
  try {
    const before = f.calls.status,
      identity = f.current.accountId;
    const refreshed = await f.accounts.refreshAll();
    assert.equal(f.calls.status, before + 1);
    assert.equal(f.current.accountId, identity);
    assert.deepEqual(f.calls.activate, []);
    assert.equal(refreshed.accounts[0].quota.windows[0].remainingPercent, 80);
    assert.equal(
      (await f.accounts.list()).busy,
      true,
      'quota observation does not release or misreport the live work lease'
    );
  } finally {
    finish();
    await pending;
  }
});
test('concurrent account operation refusal is distinct from running work or exhausted quota', async () => {
  let finish;
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: () => new Promise(r => (finish = () => r(authStatus())))
  });
  const pending = f.accounts.capture();
  while (!finish) await new Promise(r => setImmediate(r));
  try {
    await assert.rejects(f.accounts.startLogin(), /另一個 Gemini 帳號操作.*不是額度耗盡/);
    assert.equal(f.calls.start, 0);
    assert.equal(f.calls.prepareLogin, 0);
  } finally {
    finish();
    await pending;
  }
});

test('known weekly or five-hour zero suppresses UI, AI and worker checks across the TTL', async t => {
  for (const key of ['five_hour', 'seven_day'])
    await t.test(key, async () => {
      let now = Date.parse('2026-10-03T12:00:00Z');
      const f = await fixture({
        identity: {accountId: A, email},
        clock: () => now,
        statusFor: () =>
          authStatus({
            status: 'ready',
            checkedAt: new Date(now).toISOString(),
            windows: [{key, remainingPercent: 0, resetsAt: future}]
          })
      });
      await f.accounts.capture();
      const observed = (await f.accounts.list()).accounts[0].quota.checkedAt,
        queries = f.calls.status;
      now += 120000;
      await f.accounts.usage();
      const scan = await f.accounts.refreshAll({force: false});
      await assert.rejects(f.accounts.acquire({worker: true}), /皆已無可用額度/);
      assert.equal(f.calls.status, queries);
      assert.deepEqual(f.calls.activate, []);
      assert.equal(scan.quotaCheck.allExhausted, true);
      assert.equal(scan.accounts[0].quota.checkedAt, observed);
      assert.equal(scan.accounts[0].querySuppressedUntil, future * 1000);
    });
});

test('all five zero accounts recheck independently at earliest effective reset without switching login', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    recovered = false;
  const start = now;
  const ids = [A, B, C, D, E],
    deadlines = ids.map((_, i) => start + (i + 1) * 120000);
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: current =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [
          {
            key: 'seven_day',
            remainingPercent: current.accountId === A && recovered ? 70 : 0,
            resetsAt: deadlines[ids.indexOf(current.accountId)] / 1000
          },
          {
            key: 'five_hour',
            remainingPercent: current.accountId === A && recovered ? 70 : 0,
            resetsAt: (start + 60000) / 1000
          }
        ]
      })
  });
  for (const id of ids) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  const restarted = createGeminiAccounts({
    root: f.root,
    login: f.login,
    vault: f.vault,
    enabled: true,
    clock: () => now
  });
  const count = f.calls.status;
  now = start + 61000;
  await restarted.usage();
  assert.equal(f.calls.status, count, 'earlier five-hour reset cannot clear a later blocking weekly zero');
  now = deadlines[0];
  recovered = true;
  f.calls.activate.length = 0;
  await restarted.usage();
  assert.equal(f.calls.status, count + 5, 'later-reset accounts are also queried in this complete recovery');
  assert.deepEqual(f.calls.activate, []);
  assert.equal(f.current.accountId, E);
  await restarted.usage();
  assert.equal(f.calls.status, count + 5);
});

test('sequential zero observations that never overlap do not trigger an all-account recovery', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    usable = false;
  const start = now,
    ids = [A, B, C, D, E],
    reads = [];
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: current =>
      reads.push(current.accountId) &&
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [
          {
            key: 'five_hour',
            remainingPercent: usable && current.accountId === A ? 60 : 0,
            resetsAt: (current.accountId === A ? start + 120000 : start + 3600000) / 1000
          }
        ]
      })
  });
  for (const [i, id] of ids.entries()) {
    now = start + i * 180000;
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  const before = f.calls.status;
  reads.length = 0;
  await f.accounts.usage();
  await f.accounts.idle();
  assert.equal(f.calls.status, before + 1);
  assert.deepEqual(reads, [A], 'only the account whose reset passed is read in the background');
  assert.deepEqual(f.calls.activate, []);
  usable = true;
  const lease = await f.accounts.acquire({worker: true});
  assert.equal(lease.accountId, A);
  await lease.release();
  assert.equal(f.calls.status, before + 2, 'only the expired candidate is checked');
  assert.deepEqual(f.calls.activate, [A]);
});

test('all-zero recovery can run from worker startup and waits again after a new all-zero report', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    reset = now + 120000,
    positive = false;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: current =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [
          {key: 'five_hour', remainingPercent: positive && current.accountId === A ? 40 : 0, resetsAt: reset / 1000}
        ]
      })
  });
  for (const id of [A, B, C, D, E]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  let count = f.calls.status;
  now = reset;
  reset = now + 120000;
  await f.accounts.usage();
  assert.equal(f.calls.status, count + 5);
  count = f.calls.status;
  await f.accounts.usage();
  await f.accounts.refreshAll({force: false});
  assert.equal(f.calls.status, count);
  now = reset;
  reset = now + 120000;
  positive = true;
  const lease = await f.accounts.acquire({worker: true});
  assert.equal(lease.accountId, A);
  await lease.release();
  assert.equal(
    f.calls.status,
    count + 5,
    'reuse the successful recovery check instead of immediately querying the selected candidate twice'
  );
  assert.equal((await f.accounts.list()).busy, false);
});

test('all-zero recovery is deferred while Gemini is running and a failed recovery is not immediately replayed', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    failed = false;
  const reset = now + 120000;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () =>
      failed
        ? {temporaryFailure: true, auth: {status: 'unknown'}, reason: 'fixture offline'}
        : authStatus({
            status: 'ready',
            checkedAt: new Date(now).toISOString(),
            windows: [{key: 'five_hour', remainingPercent: 0, resetsAt: reset / 1000}]
          })
  });
  for (const id of [A, B, C, D, E]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  let finish;
  const work = f.accounts.inspect(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const count = f.calls.status;
  now = reset;
  failed = true;
  await f.accounts.usage();
  assert.equal(f.calls.status, count + 5);
  assert.equal((await f.accounts.list()).busy, true);
  const state = await f.accounts.list();
  assert(state.accounts.every(row => row.quota.status === 'stale'));
  await f.accounts.usage();
  assert.equal(
    f.calls.status,
    count + 5,
    'failed lookup is not immediately retried while the same reset episode remains'
  );
  finish();
  await work;
  await f.accounts.usage();
  assert.equal(f.calls.status, count + 5, 'completion of existing work does not replay the failed batch');
  assert.equal(state.uncertain, false);
  assert.equal(f.current.accountId, E);
});

test('known-zero candidates are skipped but an unknown account is checked before use', async () => {
  let known = false,
    now = Date.parse('2026-10-03T12:00:00Z');
  const queried = [];
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: current => {
      queried.push(current.accountId);
      return authStatus({
        status: current.accountId === C && !known ? 'unavailable' : 'ready',
        checkedAt: new Date(now).toISOString(),
        windows:
          current.accountId === C && !known
            ? []
            : [{key: 'seven_day', remainingPercent: current.accountId === C ? 80 : 0, resetsAt: future}]
      });
    }
  });
  for (const id of [A, B, C]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  await f.accounts.activate({accountId: A});
  queried.length = 0;
  f.calls.activate.length = 0;
  known = true;
  const lease = await f.accounts.acquire({worker: true});
  assert.equal(lease.accountId, C);
  await lease.release();
  assert.deepEqual(queried, [C]);
  assert.deepEqual(f.calls.activate, [C]);
});

test('explicit all-account refresh overrides zero suppression before reset', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    remaining = 0;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{remainingPercent: remaining, resetsAt: future}]
      })
  });
  for (const id of [A, B, C, D, E]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  const count = f.calls.status;
  remaining = 90;
  const result = await f.accounts.refreshAll();
  assert.equal(f.calls.status, count + 5);
  assert.equal(result.quotaCheck.allExhausted, false);
  assert.equal(f.current.accountId, E);
});

test('read-only all-zero recovery does not switch accounts or replay after the next check', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    reset = now + 120000;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{key: 'five_hour', remainingPercent: 0, resetsAt: reset / 1000}]
      })
  });
  for (const id of [A, B, C, D, E]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  const activate = f.vault.activate;
  f.vault.activate = async id => {
    throw Error(`must not activate ${id}`);
  };
  now = reset;
  reset = now + 120000;
  const before = f.calls.status;
  await f.accounts.usage();
  assert.equal(f.calls.status, before + 5);
  assert.equal(f.current.accountId, E);
  await f.accounts.usage();
  await f.accounts.usage();
  assert.equal(f.calls.status, before + 5);
  assert.equal((await f.accounts.list()).uncertain, false);
  f.vault.activate = activate;
  await f.accounts.refreshAll();
  assert.equal(f.calls.status, before + 10, 'explicit human refresh remains available');
});

test('delayed all-account recovery waits for the next effective reset without switching login', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    recovering = false;
  const start = now,
    ids = [A, B, C, D, E];
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: current =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [
          {
            key: 'five_hour',
            remainingPercent: 0,
            resetsAt: (recovering ? now + 120000 : start + (ids.indexOf(current.accountId) + 1) * 120000) / 1000
          }
        ]
      })
  });
  for (const id of ids) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  await f.accounts.activate({accountId: A});
  f.calls.activate.length = 0;
  now = start + 720000;
  recovering = true;
  const before = f.calls.status;
  await f.accounts.usage();
  await f.accounts.usage();
  await f.accounts.usage();
  assert.equal(f.calls.status, before + 5, 'the complete read-only recovery checks all saved accounts once');
  assert.equal(f.current.accountId, A);
  now += 120000;
  await f.accounts.usage();
  const afterNewReset = f.calls.status;
  await f.accounts.usage();
  assert.equal(afterNewReset, before + 10, 'the new reset deadline starts a fresh complete read-only recovery');
  assert.equal(f.calls.status, afterNewReset, 'the same reset episode is not polled twice');
  assert.deepEqual(f.calls.activate, []);
  await f.accounts.refreshAll();
  assert.equal(f.calls.status, afterNewReset + 5, 'manual refresh still queries all five');
});

test('a thrown first quota query starts read-only recovery and does not immediately repeat', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z');
  const reset = now + 120000;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{key: 'five_hour', remainingPercent: 0, resetsAt: reset / 1000}]
      })
  });
  for (const id of [A, B, C, D, E]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  f.login.status = async () => {
    f.calls.status++;
    throw Error('fixture query threw');
  };
  now = reset;
  const before = f.calls.status;
  await f.accounts.usage();
  await f.accounts.usage();
  assert.equal(f.calls.status, before + 5, 'the reset recovery reads each saved account independently once');
  now += 61000;
  await f.accounts.usage();
  await f.accounts.usage();
  assert.equal(f.calls.status, before + 6, 'subsequent temporary refreshes are throttled');
});

test('capture keeps account identity rows separate even when email duplicates', async () => {
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: current =>
      authStatus({
        status: 'available',
        windows: [{remainingPercent: current?.accountId === A ? 70 : 20, resetsAt: future}],
        checkedAt: '2026-10-03T11:59:30.000Z'
      })
  });
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  const rows = (await f.accounts.list()).accounts;
  assert.deepEqual(
    rows.map(row => row.id),
    [A, B]
  );
  assert.equal(rows[0].email, email);
  assert.equal(rows[1].email, email);
  assert.deepEqual(
    rows.map(row => row.quota.windows[0].remainingPercent),
    [70, 20]
  );
  assert.equal((await f.accounts.list()).activeAccountId, B);
});

test('disabled manager refuses capture without touching the vault', async () => {
  const f = await fixture({enabled: false, identity: {accountId: A, email}});
  await assert.rejects(f.accounts.capture(), /尚未允許/u);
  assert.equal(f.calls.capture, 0);
});

test('account changes are blocked while a Gemini task is running', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  let finish;
  const work = f.accounts.inspect(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.accounts.activate({accountId: A}), /正在工作/u);
  finish();
  await work;
});

test('same authenticated account allows another concurrent task after auth check ages past 60 seconds', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z');
  const f = await fixture({identity: {accountId: A, email}, clock: () => now, statusFor: () => authStatus()});
  await f.accounts.capture();
  const first = await f.accounts.acquire();
  now += 61000;
  const second = await f.accounts.acquire();
  assert.equal(second.accountId, A);
  await second.release();
  await first.release();
});

test('acquire and inspect wait for an existing quota refresh before entering', async () => {
  let resume;
  let statusStarted;
  let started;
  let defer = false;
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: () =>
      defer
        ? new Promise(resolve => {
            resume = () => resolve(authStatus());
            statusStarted();
          })
        : authStatus()
  });
  await f.accounts.capture();
  defer = true;
  started = new Promise(resolve => {
    statusStarted = resolve;
  });
  const refresh = f.accounts.refresh();
  await started;
  let invoked = false;
  const work = f.accounts.acquire().then(async lease => {
    invoked = true;
    await lease.release();
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(invoked, false);
  resume();
  await Promise.all([refresh, work]);
  assert.equal(invoked, true);
  started = new Promise(resolve => {
    statusStarted = resolve;
  });
  const nextRefresh = f.accounts.refresh();
  await started;
  let inspected = false;
  const inspect = f.accounts.inspect(async () => {
    inspected = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(inspected, false);
  resume();
  await Promise.all([nextRefresh, inspect]);
  assert.equal(inspected, true);
});

test('failed quota refresh does not allow waiting acquire or inspect to proceed', async () => {
  let rejectStatus;
  let statusStarted;
  const started = new Promise(resolve => {
    statusStarted = resolve;
  });
  let defer = false;
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: () =>
      defer
        ? new Promise((_, reject) => {
            rejectStatus = reject;
            statusStarted();
          })
        : authStatus()
  });
  await f.accounts.capture();
  defer = true;
  const refresh = f.accounts.refresh();
  await started;
  let invoked = false;
  const work = f.accounts.acquire().then(
    lease => {
      invoked = true;
      return lease.release();
    },
    error => error
  );
  let inspected = false;
  const inspect = f.accounts
    .inspect(async () => {
      inspected = true;
    })
    .catch(error => error);
  await new Promise(resolve => setImmediate(resolve));
  rejectStatus(Error('refresh failed'));
  await refresh.catch(() => {});
  const [workError, inspectError] = await Promise.all([work, inspect]);
  assert.match(workError.message, /官方額度暫時查不到/u);
  assert.match(inspectError.message, /官方額度暫時查不到/u);
  assert.equal(invoked, false);
  assert.equal(inspected, false);
});

test('real account switching lock still rejects acquire while changing', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  let finish;
  f.vault.assertIdle = () =>
    new Promise(resolve => {
      finish = resolve;
    });
  const operation = f.accounts.activate({accountId: A});
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.accounts.acquire(), /正在切換/u);
  finish(true);
  await operation;
});

test('pending login survives restart and can finish only after authenticated identity is captured', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  await f.accounts.startLogin();
  assert.equal((await f.accounts.list()).loginPending, true);
  assert.equal(f.calls.start, 1);
  const restarted = createGeminiAccounts({
    root: f.root,
    login: f.login,
    vault: f.vault,
    enabled: true,
    clock: () => Date.parse('2026-10-03T12:00:00Z')
  });
  f.current = {accountId: B, email: 'b@example.test'};
  await restarted.finishLogin();
  const state = await restarted.list();
  assert.equal(state.loginPending, false);
  assert.equal(state.activeAccountId, B);
  assert.deepEqual(
    state.accounts.map(row => row.id),
    [A, B]
  );
});

test('pending login can be cancelled after restart and restores the previous native identity', async () => {
  const f = await fixture({identity: {accountId: A, email: 'a@example.test'}});
  await f.accounts.capture();
  await f.accounts.startLogin();
  const restarted = createGeminiAccounts({
    root: f.root,
    login: f.login,
    vault: f.vault,
    enabled: true,
    clock: () => Date.parse('2026-10-03T12:00:00Z')
  });
  await restarted.cancelLogin();
  assert.equal(f.current.accountId, A);
  assert.equal((await restarted.list()).loginPending, false);
});

test('cancelling a pending login restores the prior account over an uncaptured new live identity', async () => {
  const f = await fixture({identity: {accountId: A, email: 'a@example.test'}});
  await f.accounts.capture();
  await f.accounts.startLogin();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.cancelLogin();
  assert.equal(f.current.accountId, A);
  const state = await f.accounts.list();
  assert.equal(state.loginPending, false);
  assert.deepEqual(
    state.accounts.map(row => row.id),
    [A]
  );
  assert.deepEqual(f.calls.activateOptions.at(-1), {id: A, preserveCurrent: false});
});

test('ordinary activation of a captured account preserves the current identity', async () => {
  const f = await fixture({identity: {accountId: A, email: 'a@example.test'}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  assert.deepEqual(f.calls.activateOptions.at(-1), {id: A, preserveCurrent: true});
});

test('either official quota window can select another worker account exactly once without replay', async t => {
  for (const exhaustedKey of ['five_hour', 'seven_day'])
    await t.test(exhaustedKey, async () => {
      const f = await fixture({
        identity: {accountId: A, email: 'a@example.test'},
        statusFor: current =>
          authStatus({
            status: 'ready',
            windows: ['five_hour', 'seven_day'].map(key => ({
              key,
              remainingPercent: current.accountId === A && key === exhaustedKey ? 0 : 65,
              resetsAt: future
            })),
            checkedAt: '2026-10-03T11:59:30.000Z'
          })
      });
      await f.accounts.capture();
      f.current = {accountId: B, email: 'b@example.test'};
      await f.accounts.capture();
      await f.accounts.activate({accountId: A});
      f.calls.activate.length = 0;
      let invoked = 0;
      const result = await f.accounts.run({worker: true}, async () => {
        invoked++;
        return {settled: true, answer: 'one result'};
      });
      assert.equal(invoked, 1);
      assert.equal(result.answer, 'one result');
      assert.equal(result.accountId, B);
      assert.deepEqual(f.calls.activate, [B]);
    });
});

test('a worker explicit account binding cannot bypass handoff from an exhausted current account', async () => {
  const f = await fixture({
    identity: {accountId: A, email: 'a@example.test'},
    statusFor: current =>
      authStatus({
        status: 'ready',
        windows: [{remainingPercent: current?.accountId === A ? 0 : 70, resetsAt: future}],
        checkedAt: '2026-10-03T11:59:30.000Z'
      })
  });
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  f.calls.activate.length = 0;
  let invoked = 0;
  const result = await f.accounts.run({accountId: A, worker: true}, async () => {
    invoked++;
    return {settled: true};
  });
  assert.equal(invoked, 1);
  assert.equal(result.accountId, B);
  assert.deepEqual(f.calls.activate, [B]);
});

test('worker explicit account cannot skip Fourth to Fifth to First and never replays the task', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z');
  const spent = new Set([D]);
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: current =>
      authStatus({
        status: 'ready',
        windows: [{key: 'five_hour', remainingPercent: spent.has(current.accountId) ? 0 : 40, resetsAt: future}],
        checkedAt: new Date(now).toISOString()
      })
  });
  for (const id of [A, B, C, D, E]) {
    f.current = {accountId: id, email: `${id[0]}@example.test`};
    await f.accounts.capture();
  }
  await f.accounts.activate({accountId: D});
  f.calls.activate.length = 0;
  let invoked = 0;
  const fifth = await f.accounts.run({accountId: A, worker: true}, async () => {
    invoked++;
    return {settled: true};
  });
  assert.equal(fifth.accountId, E);
  assert.equal(invoked, 1);
  assert.deepEqual(f.calls.activate, [E]);
  spent.add(E);
  spent.delete(D);
  now += 61000;
  f.calls.activate.length = 0;
  const first = await f.accounts.run({accountId: A, worker: true}, async () => {
    invoked++;
    return {settled: true};
  });
  assert.equal(first.accountId, A);
  assert.equal(invoked, 2);
  assert.deepEqual(f.calls.activate, [A]);
});

test('an unknown next account is not assumed available when a later saved account has verified quota', async () => {
  const queried = [];
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: current => {
      queried.push(current.accountId);
      return current.accountId === B
        ? {
            auth: {status: 'authenticated', checkedAt: '2026-10-03T11:59:30.000Z'},
            quota: {status: 'unavailable', windows: []},
            reason: 'quota unavailable'
          }
        : authStatus({
            status: 'ready',
            windows: [{remainingPercent: current.accountId === A ? 0 : 40, resetsAt: future}]
          });
    }
  });
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  f.current = {accountId: C, email};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  let invoked = 0;
  f.calls.activate.length = 0;
  queried.length = 0;
  const result = await f.accounts.run({accountId: C, worker: true}, async () => {
    invoked++;
    return {settled: true};
  });
  assert.equal(invoked, 1);
  assert.equal(result.accountId, C);
  assert.deepEqual(queried, [B, C, C]);
  assert.deepEqual(f.calls.activate, [C]);
  assert.equal(f.current.accountId, C);
});

test('worker does not rotate on unknown quota; a failed check retains prior official zero until reset', async t => {
  for (const scenario of ['remaining', 'unknown', 'timeout'])
    await t.test(scenario, async () => {
      let failed = false;
      const f = await fixture({
        identity: {accountId: A, email},
        statusFor: current => {
          if (failed && current.accountId === A)
            return {temporaryFailure: true, auth: {status: 'unknown'}, reason: 'network timeout'};
          if (current.accountId === A && scenario === 'unknown')
            return authStatus({status: 'unavailable', windows: []});
          return authStatus({
            status: 'ready',
            checkedAt: '2026-10-03T11:59:30.000Z',
            windows:
              current.accountId !== A
                ? [{key: 'seven_day', remainingPercent: 100, resetsAt: future}]
                : [{key: 'five_hour', remainingPercent: scenario === 'remaining' ? 20 : 0, resetsAt: future}]
          });
        }
      });
      await f.accounts.capture();
      f.current = {accountId: B, email};
      await f.accounts.capture();
      await f.accounts.activate({accountId: A});
      f.calls.activate.length = 0;
      if (scenario === 'timeout') {
        failed = true;
        await f.accounts.refresh();
      }
      if (scenario === 'unknown') {
        await assert.rejects(f.accounts.acquire({worker: true}), /額度尚未確認|保留等待/u);
      } else if (scenario !== 'timeout') {
        for (let i = 0; i < 2; i++) {
          const lease = await f.accounts.acquire({worker: true});
          assert.equal(lease.accountId, A);
          await lease.release();
        }
      } else {
        const lease = await f.accounts.acquire({worker: true});
        assert.equal(lease.accountId, B);
        await lease.release();
      }
      assert.equal(f.current.accountId, scenario === 'timeout' ? B : A);
      assert.deepEqual(f.calls.activate, scenario === 'timeout' ? [B] : []);
      assert.equal((await f.accounts.list()).busy, false);
    });
});

test('quota handoff follows saved order, not the first account or the largest quota', async () => {
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: current =>
      authStatus({
        status: 'ready',
        windows: [
          {
            key: 'seven_day',
            remainingPercent: current.accountId === B ? 0 : current.accountId === A ? 100 : 40,
            resetsAt: future
          }
        ]
      })
  });
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  f.current = {accountId: C, email};
  await f.accounts.capture();
  await f.accounts.activate({accountId: B});
  f.calls.activate.length = 0;
  const first = await f.accounts.acquire({worker: true});
  assert.equal(first.accountId, C);
  await first.release();
  const second = await f.accounts.acquire({worker: true});
  assert.equal(second.accountId, C);
  await second.release();
  assert.deepEqual(f.calls.activate, [C]);
});

test('new official exhaustion is checked before selecting a worker account', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    remaining = 50;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: current =>
      authStatus({
        status: 'ready',
        windows: [{key: 'seven_day', remainingPercent: current.accountId === A ? remaining : 80, resetsAt: future}]
      })
  });
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  f.calls.activate.length = 0;
  remaining = 0;
  now += 61000;
  const first = await f.accounts.acquire({worker: true});
  assert.equal(first.accountId, B);
  await first.release();
  assert.deepEqual(f.calls.activate, [B]);
  assert.equal((await f.accounts.list()).busy, false);
});

test('an expired cached weekly zero is refreshed; official replenishment keeps the account', async () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  let remaining = 0;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () =>
      authStatus({
        status: 'ready',
        windows: [{key: 'seven_day', remainingPercent: remaining, resetsAt: now / 1000 - 1}]
      })
  });
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  f.calls.activate.length = 0;
  remaining = 80;
  const lease = await f.accounts.acquire({worker: true});
  assert.equal(lease.accountId, A);
  await lease.release();
  assert.deepEqual(f.calls.activate, []);
});

test('direct add from an empty registry preserves the existing native account before opening login', async () => {
  const f = await fixture({identity: {accountId: A, email: 'a@example.test'}});
  assert.equal((await f.accounts.list()).accounts.length, 0);
  const pending = await f.accounts.startLogin();
  assert.equal(pending.loginPending, true);
  assert.equal(pending.activeAccountId, null);
  assert.deepEqual(
    pending.accounts.map(row => row.id),
    [A]
  );
  assert.equal(f.calls.capture, 1);
  assert.equal(f.calls.prepareLogin, 1);
  assert.equal(f.calls.start, 1);
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.finishLogin();
  const restarted = createGeminiAccounts({root: f.root, login: f.login, vault: f.vault, enabled: true});
  const saved = await restarted.list();
  assert.equal(saved.loginPending, false);
  assert.equal(saved.activeAccountId, B);
  assert.deepEqual(
    saved.accounts.map(row => row.id),
    [A, B]
  );
});

test('first login with no native account can finish or cancel without inventing a previous account', async () => {
  const f = await fixture();
  await f.accounts.startLogin();
  assert.equal(f.calls.capture, 0);
  assert.equal((await f.accounts.list()).loginPending, true);
  await f.accounts.cancelLogin();
  assert.deepEqual(f.calls.activate, []);
  assert.equal((await f.accounts.list()).activeAccountId, null);
  await f.accounts.startLogin();
  f.current = {accountId: A, email: 'a@example.test'};
  const saved = await f.accounts.finishLogin();
  assert.equal(saved.activeAccountId, A);
  assert.equal(saved.loginPending, false);
  assert.equal(saved.accounts.length, 1);
});

test('failed official login launch leaves an explicit cancel path restoring the initial native account', async () => {
  const f = await fixture({identity: {accountId: A, email: 'a@example.test'}});
  f.login.start = async () => {
    throw Error('fixture launch failed');
  };
  await assert.rejects(f.accounts.startLogin(), /fixture launch failed/);
  const pending = await f.accounts.list();
  assert.equal(pending.loginPending, true);
  assert.equal(f.current, null);
  const restarted = createGeminiAccounts({root: f.root, login: f.login, vault: f.vault, enabled: true});
  const restored = await restarted.cancelLogin();
  assert.equal(f.current.accountId, A);
  assert.equal(restored.loginPending, false);
  assert.equal(restored.activeAccountId, A);
  assert.deepEqual(
    restored.accounts.map(row => row.id),
    [A]
  );
});

test('unfinished first add remains pending after failed finish and can restore the original account', async () => {
  const f = await fixture({identity: {accountId: A, email: 'a@example.test'}});
  await f.accounts.startLogin();
  await assert.rejects(f.accounts.finishLogin(), /no identity fixture/);
  assert.equal((await f.accounts.list()).loginPending, true);
  const restored = await f.accounts.cancelLogin();
  assert.equal(restored.activeAccountId, A);
  assert.equal(restored.loginPending, false);
  assert.deepEqual(
    restored.accounts.map(row => row.id),
    [A]
  );
});

test('failed login verification does not enroll the new identity or mark it active', async () => {
  let verified = true;
  const f = await fixture({
    identity: {accountId: A, email: 'a@example.test'},
    statusFor: () => (verified ? authStatus() : {auth: {status: 'unknown'}, reason: 'fixture offline'})
  });
  await f.accounts.startLogin();
  f.current = {accountId: B, email: 'b@example.test'};
  verified = false;
  await assert.rejects(f.accounts.finishLogin(), /尚未確認官方登入成功/u);
  let state = await f.accounts.list();
  assert.equal(state.loginPending, true);
  assert.equal(state.activeAccountId, null);
  assert.deepEqual(
    state.accounts.map(row => row.id),
    [A]
  );
  const persisted = JSON.parse(await readFile(path.join(f.root, '.runtime/gemini-accounts.json'), 'utf8'));
  assert.deepEqual(
    persisted.accounts.map(row => row.id),
    [A]
  );
  verified = true;
  state = await f.accounts.cancelLogin();
  assert.equal(state.activeAccountId, A);
  assert.equal(state.loginPending, false);
  assert.deepEqual(
    state.accounts.map(row => row.id),
    [A]
  );
});

test('adding a third account preserves both enrolled accounts through cancel and finish', async () => {
  const f = await fixture({identity: {accountId: A, email: 'a@example.test'}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  await f.accounts.startLogin();
  f.current = {accountId: C, email: 'c@example.test'};
  const cancelled = await f.accounts.cancelLogin();
  assert.equal(cancelled.activeAccountId, A);
  assert.deepEqual(
    cancelled.accounts.map(row => row.id),
    [A, B]
  );
  await f.accounts.startLogin();
  f.current = {accountId: C, email: 'c@example.test'};
  const saved = await f.accounts.finishLogin();
  assert.equal(saved.activeAccountId, C);
  assert.deepEqual(
    saved.accounts.map(row => row.id),
    [A, B, C]
  );
});

test('starting login is blocked before credential changes while K or the official program is busy', async () => {
  const f = await fixture({identity: {accountId: A, email: 'a@example.test'}});
  const lease = await f.accounts.acquire();
  await assert.rejects(f.accounts.startLogin(), /正在工作/u);
  await lease.release();
  f.idle = false;
  await assert.rejects(f.accounts.startLogin(), /fixture busy/);
  assert.equal(f.calls.capture, 0);
  assert.equal(f.calls.prepareLogin, 0);
  assert.equal(f.calls.start, 0);
  assert.equal((await f.accounts.list()).loginPending, false);
});

test('cancel without a previous identity leaves a completed official login intact but not enrolled', async () => {
  const f = await fixture();
  await f.accounts.startLogin();
  f.current = {accountId: B, email: 'b@example.test'};
  const cancelled = await f.accounts.cancelLogin();
  assert.equal(f.current.accountId, B);
  assert.equal(cancelled.loginPending, false);
  assert.equal(cancelled.activeAccountId, null);
  assert.deepEqual(cancelled.accounts, []);
  assert.equal(f.calls.capture, 0);
  assert.deepEqual(f.calls.activate, []);
});

test('selecting a cached exhausted account does not activate it before rejection', async () => {
  const f = await fixture({
    identity: {accountId: A, email: 'a@example.test'},
    statusFor: current =>
      authStatus({
        status: 'ready',
        windows: [{remainingPercent: current?.accountId === A ? 0 : 70, resetsAt: future}],
        checkedAt: '2026-10-03T11:59:30.000Z'
      })
  });
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  f.calls.activate.length = 0;
  await assert.rejects(
    f.accounts.run({accountId: A}, async () => {}),
    /額度已用完/u
  );
  assert.deepEqual(f.calls.activate, []);
});

test('selecting a cached signed-out account does not activate it before rejection', async () => {
  const f = await fixture({
    identity: {accountId: A, email: 'a@example.test'},
    statusFor: current => ({
      auth: {status: current?.accountId === A ? 'signed-out' : 'authenticated', checkedAt: '2026-10-03T11:59:30.000Z'},
      quota: {
        status: 'available',
        windows: [{remainingPercent: 70, resetsAt: future}],
        checkedAt: '2026-10-03T11:59:30.000Z'
      }
    })
  });
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  f.calls.activate.length = 0;
  await assert.rejects(
    f.accounts.run({accountId: A}, async () => {}),
    /登入/u
  );
  assert.deepEqual(f.calls.activate, []);
});

test('unknown network quota is not admitted and remains distinct from official exhaustion', async () => {
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: () => ({
      auth: {status: 'authenticated', checkedAt: '2026-10-03T11:59:30.000Z'},
      quota: {status: 'unavailable', windows: [], note: 'network unknown'}
    })
  });
  await f.accounts.capture();
  let invoked = 0;
  await assert.rejects(
    f.accounts.run({}, async () => {
      invoked++;
      return {settled: true};
    }),
    /額度尚未確認|尚無官方目前額度資料/u
  );
  assert.equal(invoked, 0);
  assert.deepEqual(f.calls.activate, []);
  assert.equal((await f.accounts.list()).accounts[0].quota.status, 'unavailable');
});

test('inactive official quota remains a readable last-query result', async () => {
  const f = await fixture({identity: {accountId: A, email: 'a@example.test'}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  const state = await f.accounts.list();
  assert.equal(state.accounts.find(row => row.id === A).quota.status, 'available');
  assert.equal(state.accounts.find(row => row.id === B).quota.status, 'available');
});

test('quota refresh reads requested account independently of the current live login', async () => {
  const f = await fixture({
    identity: {accountId: A, email: 'a@example.test'},
    statusFor: current =>
      authStatus({
        status: 'available',
        windows: [{remainingPercent: current?.accountId === A ? 55 : 1, resetsAt: future}],
        checkedAt: '2026-10-03T11:59:30.000Z'
      })
  });
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  f.calls.activate.length = 0;
  const result = await f.accounts.refreshAll();
  const state = await f.accounts.list();
  assert.equal(f.current.accountId, B);
  assert.equal(state.activeAccountId, B);
  assert.deepEqual(f.calls.activate, []);
  assert.equal(result.accounts.find(row => row.id === A).quota.windows[0].remainingPercent, 55);
  assert.equal(result.accounts.find(row => row.id === B).quota.windows[0].remainingPercent, 1);
});

test('legacy interrupted quota restoration owns the account lock until identity is restored', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  const file = path.join(f.root, '.runtime/gemini-accounts.json'),
    saved = JSON.parse(await readFile(file, 'utf8'));
  saved.quotaRefreshOriginalId = A;
  await writeFile(file, JSON.stringify(saved));
  let finish,
    started,
    defer = true;
  const began = new Promise(resolve => {
    started = resolve;
  });
  f.vault.assertIdle = async () => {
    if (defer) {
      defer = false;
      started();
      await new Promise(resolve => {
        finish = resolve;
      });
    }
  };
  const accounts = createGeminiAccounts({
    root: f.root,
    vault: f.vault,
    login: f.login,
    enabled: true,
    clock: () => Date.parse('2026-10-03T12:00:00Z')
  });
  const restore = accounts.refreshAll();
  await began;
  await assert.rejects(accounts.capture(), /另一個 Gemini 帳號操作/u);
  let acquired = false;
  const acquire = accounts.acquire({worker: true}).then(lease => {
    acquired = true;
    return lease;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acquired, false);
  assert.equal(f.current.accountId, B);
  assert.deepEqual(f.calls.activate, []);
  finish();
  const result = await restore;
  assert.equal(result.activeAccountId, A);
  const lease = await acquire;
  assert.equal(lease.accountId, A);
  assert.deepEqual(f.calls.activate, [A]);
  await lease.release();
  assert.equal(JSON.parse(await readFile(file, 'utf8')).quotaRefreshOriginalId, undefined);
});

test('an unsettled stop marks account state uncertain and blocks further work or switching', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  const lease = await f.accounts.acquire();
  await lease.release({settled: false});
  assert.equal((await f.accounts.list()).busy, true);
  await assert.rejects(f.accounts.acquire(), /停止尚未確認/u);
  await assert.rejects(f.accounts.activate({accountId: A}), /停止尚未確認/u);
});

test('a failed run marked unsettled leaves the manager uncertain and blocks new work', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  const failure = Object.assign(Error('fixture worker stopped'), {settled: false});
  await assert.rejects(
    f.accounts.run({}, async () => {
      throw failure;
    }),
    error => error === failure
  );
  assert.equal((await f.accounts.list()).busy, true);
  await assert.rejects(f.accounts.acquire(), /停止尚未確認/u);
  await assert.rejects(f.accounts.activate({accountId: A}), /停止尚未確認/u);
});

test('unbound native history is rejected before any cross-account work starts', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  let invoked = 0;
  await assert.rejects(
    f.accounts.run({accountId: B, unboundHistory: true}, async () => {
      invoked++;
    }),
    /沒有帳號綁定/u
  );
  assert.equal(invoked, 0);
  assert.deepEqual(f.calls.activate, []);
});

test('Gemini account HTTP routes require the local session and state/usage expose managed-account quota', async () => {
  const calls = [];
  const exactId = B;
  const managedUsage = {
    status: 'available',
    windows: [{remainingPercent: 42, resetsAt: future}],
    accountId: exactId,
    accountEmail: 'b@example.test',
    accounts: [{id: exactId, email: 'b@example.test'}]
  };
  const geminiAccounts = {
    cachedUsage: managedUsage,
    list: async () => {
      calls.push(['list']);
      return {enabled: true, activeAccountId: exactId, accounts: []};
    },
    activate: async data => {
      calls.push(['activate', data.accountId]);
      return {activeAccountId: data.accountId};
    },
    refresh: async data => {
      calls.push(['refresh', data]);
      return {activeAccountId: exactId};
    },
    usage: async refresh => {
      calls.push(['usage', refresh]);
      return managedUsage;
    }
  };
  const app = await startDesktop({
    root: path.resolve('.'),
    port: 0,
    geminiAccounts,
    requireLaunchToken: true,
    controllerFactory: () => ({
      state: {usage: {gemini: {accountId: C, quota: {windows: [{remainingPercent: 0}]}}}},
      usage: async () => ({gemini: {accountId: C, quota: {windows: [{remainingPercent: 0}]}}}),
      async close() {}
    }),
    claudeLoginFactory: () => ({status: async () => ({}), close: async () => {}}),
    codexLoginFactory: () => ({status: async () => ({}), close: async () => {}}),
    geminiLoginFactory: () => ({status: async () => ({}), start: async () => ({}), close: async () => {}})
  });
  try {
    const route = `${app.origin}/api/gemini/accounts/activate`,
      body = JSON.stringify({accountId: exactId});
    const noSession = await fetch(route, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-K-Request': '1'},
      body
    });
    assert.equal(noSession.status, 403);
    const boot = await fetch(app.createLaunchUrl(), {redirect: 'manual'}),
      cookie = boot.headers.get('set-cookie').split(';')[0];
    const deniedOrigin = await fetch(route, {
      method: 'POST',
      headers: {Cookie: cookie, Origin: 'https://evil.test', 'Content-Type': 'application/json', 'X-K-Request': '1'},
      body
    });
    assert.equal(deniedOrigin.status, 403);
    const missingMarker = await fetch(route, {
      method: 'POST',
      headers: {Cookie: cookie, Origin: app.origin, 'Content-Type': 'application/json'},
      body
    });
    assert.equal(missingMarker.status, 403);
    assert.deepEqual(calls, [], 'unauthorized requests must not invoke any account operation');
    const list = await fetch(`${app.origin}/api/gemini/accounts`, {headers: {Cookie: cookie}});
    assert.equal(list.status, 200);
    assert.equal((await list.json()).activeAccountId, exactId);
    const switched = await fetch(route, {
      method: 'POST',
      headers: {Cookie: cookie, Origin: app.origin, 'Content-Type': 'application/json', 'X-K-Request': '1'},
      body
    });
    assert.equal(switched.status, 200);
    const refreshed = await fetch(`${app.origin}/api/gemini/accounts/refresh`, {
      method: 'POST',
      headers: {Cookie: cookie, Origin: app.origin, 'Content-Type': 'application/json', 'X-K-Request': '1'},
      body: '{}'
    });
    assert.equal(refreshed.status, 200);
    const state = await (await fetch(`${app.origin}/api/state`, {headers: {Cookie: cookie}})).json();
    assert.equal(state.usage.gemini.accountId, exactId);
    const usage = await (await fetch(`${app.origin}/api/usage`, {headers: {Cookie: cookie}})).json();
    assert.equal(usage.gemini.accountId, exactId);
    assert.deepEqual(calls, [['list'], ['activate', exactId], ['refresh', {}], ['usage', false]]);
  } finally {
    await app.close();
  }
});

test('malformed account metadata reports a read error without overwriting the registry', async () => {
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'gemini-accounts-invalid-'));
  const file = path.join(root, '.runtime', 'gemini-accounts.json');
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, '{invalid');
  const accounts = createGeminiAccounts({root, login: {}, vault: {}, enabled: true});
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(accounts.list(), SyntaxError);
  assert.equal(await readFile(file, 'utf8'), '{invalid');
});

test('uncertain work before first account enrollment can be cleared only after native idle is confirmed', async () => {
  const f = await fixture();
  const lease = await f.accounts.acquire();
  await lease.release({settled: false});
  assert.equal((await f.accounts.list()).uncertain, true);
  f.idle = false;
  await f.accounts.refresh();
  assert.equal((await f.accounts.list()).uncertain, true);
  await assert.rejects(f.accounts.acquire(), /停止尚未確認/u);
  f.idle = true;
  await f.accounts.refresh();
  assert.equal((await f.accounts.list()).uncertain, false);
  const next = await f.accounts.acquire();
  await next.release();
});

test('simultaneous same-account starts share the identity without false switching errors or serializing execution', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  const leases = await Promise.all([f.accounts.acquire(), f.accounts.acquire(), f.accounts.acquire()]);
  assert.deepEqual(
    leases.map(l => l.accountId),
    [A, A, A]
  );
  assert.equal((await f.accounts.list()).busy, true);
  await leases[0].release();
  await leases[1].release();
  assert.equal((await f.accounts.list()).busy, true);
  await leases[2].release();
  assert.equal((await f.accounts.list()).busy, false);
  assert.deepEqual(f.calls.activate, []);
});

test('manual account activation waits for a background quota refresh instead of reporting busy', async () => {
  let resume, statusStarted;
  let defer = false;
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: () =>
      defer
        ? new Promise(resolve => {
            resume = () => {
              defer = false;
              resolve(authStatus());
            };
            statusStarted();
          })
        : authStatus()
  });
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  defer = true;
  const started = new Promise(resolve => {
    statusStarted = resolve;
  });
  const refresh = f.accounts.refresh();
  await started;
  let activated = false;
  const activation = f.accounts.activate({accountId: A}).then(value => {
    activated = true;
    return value;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(activated, false);
  resume();
  await Promise.all([refresh, activation]);
  assert.equal(activated, true);
  assert.equal((await f.accounts.list()).activeAccountId, A);
});

test('next account with no usable official windows is not assumed available', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  f.vault.queryQuota = async id => ({
    accountId: id,
    ...authStatus({
      status: 'ready',
      windows: id === A ? [{key: 'five_hour', remainingPercent: 0, resetsAt: future}] : []
    })
  });
  await f.accounts.refreshAll();
  await assert.rejects(f.accounts.acquire({worker: true}), /額度尚未確認|候選帳號額度尚未確認/u);
  assert.deepEqual(f.calls.activate, [A]);
  assert.equal(f.current.accountId, A);
});
test('fresh positive balance after a past reset remains usable for the next saved account', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  f.login.status = async account =>
    authStatus({
      status: 'ready',
      checkedAt: '2026-10-03T12:00:00.000Z',
      windows: [{key: 'seven_day', remainingPercent: account.accountId === A ? 0 : 100, resetsAt: future}]
    });
  await f.accounts.refresh();
  const lease = await f.accounts.acquire({worker: true});
  assert.equal(lease.accountId, B);
  await lease.release();
});

test('temporary quota failure preserves only prior verified login and does not require login or switch accounts', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    temporary = false;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () =>
      temporary
        ? {
            temporaryFailure: true,
            auth: {status: 'unknown', checkedAt: new Date(now).toISOString()},
            reason: 'Google 額度查詢暫時失敗或逾時；這不代表帳號已登出。'
          }
        : authStatus()
  });
  await f.accounts.capture();
  const before = (await f.accounts.list()).accounts[0];
  temporary = true;
  now += 61000;
  await f.accounts.refresh();
  const after = (await f.accounts.list()).accounts[0];
  assert.deepEqual(after.auth, before.auth);
  assert.equal(after.quota.status, 'stale');
  assert.deepEqual(after.quota.windows, before.quota.windows);
  const statusCalls = f.calls.status;
  await f.accounts.usage();
  await assert.rejects(f.accounts.acquire(), /額度尚未確認|尚無官方目前額度資料/u);
  assert.equal((await f.accounts.list()).busy, false);
  assert.deepEqual(f.calls.activate, []);
  assert.equal(
    f.calls.status,
    statusCalls,
    'a recent failed official result cannot authorize work or trigger an immediate repeat'
  );
  assert.equal(after.lastQueryAt, undefined, 'attempt timestamps are not a new public authentication result');
  now += 61000;
  await f.accounts.usage();
  assert.equal(f.calls.status, statusCalls + 1);
  f.login.status = async () => ({auth: {status: 'signed-out'}, reason: '尚未登入 Gemini，請完成官方登入。'});
  await f.accounts.refresh();
  await assert.rejects(f.accounts.acquire(), /需重新確認登入/u);
  assert.equal((await f.accounts.list()).busy, false);
  f.login.status = async () => ({temporaryFailure: true, auth: {status: 'unknown'}, reason: '暫時無法查詢'});
  await f.accounts.refresh();
  await assert.rejects(f.accounts.acquire(), /暫時無法查詢/u);
  assert.notEqual((await f.accounts.list()).accounts[0].auth.status, 'authenticated');
});

test('failed startup releases its serialization lock, and a different account still cannot replace a running one', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  const results = await Promise.allSettled([
    f.accounts.acquire({accountId: 'bad'}),
    f.accounts.acquire({accountId: B})
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[1].value.accountId, B);
  await assert.rejects(f.accounts.acquire({accountId: A}), /尚未結束.*不能換帳號/u);
  assert.deepEqual(f.calls.activate, []);
  await results[1].value.release();
  await f.accounts.activate({accountId: A});
  assert.equal((await f.accounts.list()).activeAccountId, A);
});

test('quota query busy flag clears after a timeout-shaped response without discarding other saved accounts', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  let resolveStatus;
  f.login.status = () =>
    new Promise(resolve => {
      resolveStatus = resolve;
    });
  const pending = f.accounts.refresh();
  while (!resolveStatus) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.accounts.list()).checking, true);
  assert.equal((await f.accounts.list()).busy, false, 'read-only quota query is not an account-changing operation');
  resolveStatus({temporaryFailure: true, auth: {status: 'unknown'}, reason: 'query timeout'});
  await pending;
  const result = await f.accounts.list();
  assert.equal(result.checking, false);
  assert.equal(result.busy, false);
  assert.deepEqual(
    result.accounts.map(r => r.id),
    [A, B]
  );
});

test('refreshAll queries every saved account once without switching login or sending model work', async () => {
  let left = 0;
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: '2026-10-03T12:00:00Z',
        windows: [{key: 'five_hour', remainingPercent: left, resetsAt: future}]
      })
  });
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  f.calls.activate.length = 0;
  const before = f.calls.status;
  left = 75;
  const result = await f.accounts.refreshAll();
  assert.equal(f.calls.status, before + 2);
  assert.deepEqual(f.calls.activate, []);
  assert.equal(f.current.accountId, B);
  assert.equal(result.activeAccountId, B);
  assert.equal(result.busy, false);
  assert.equal(result.quotaCheck.allExhausted, false);
  assert(result.accounts.every(a => a.quota.windows[0].remainingPercent === 75));
  assert.equal(
    JSON.parse(await readFile(path.join(f.root, '.runtime/gemini-accounts.json'), 'utf8')).quotaRefreshOriginalId,
    undefined
  );
});
test('read-only all-account query can run beside work, does not inspect native login processes, and refuses pending login', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  const lease = await f.accounts.acquire();
  const before = f.calls.assertIdle;
  await f.accounts.refreshAll();
  assert.equal(f.calls.assertIdle, before);
  await lease.release();
  f.idle = false;
  await f.accounts.refreshAll();
  f.idle = true;
  await f.accounts.startLogin();
  await assert.rejects(f.accounts.refreshAll(), /登入/u);
  assert.deepEqual(f.calls.activate, []);
});
test('all-account read-only query preserves identity on failure and never reports unknown as exhausted', async () => {
  let fail = false;
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: current =>
      fail && current.accountId === A
        ? {temporaryFailure: true, reason: 'lookup failed', auth: {status: 'unknown'}}
        : authStatus()
  });
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  fail = true;
  const result = await f.accounts.refreshAll();
  assert.equal(result.quotaCheck.allExhausted, null);
  assert.equal(f.current.accountId, B);
  assert.match(result.note, /1 個帳號未取得/u);
  f.vault.queryQuota = async id => {
    if (id === A) throw Error('native query failed');
    return {accountId: id, ...authStatus()};
  };
  const failed = await f.accounts.refreshAll();
  assert.equal(failed.quotaCheck.allExhausted, null);
  assert.equal(f.current.accountId, B);
  assert.deepEqual(f.calls.activate, []);
});
test('failed independent quota query preserves every saved identity and does not mark switching uncertain', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  f.vault.queryQuota = async id =>
    id === A
      ? {accountId: id, temporaryFailure: true, auth: {status: 'unknown'}, reason: 'temporary'}
      : {accountId: id, ...authStatus()};
  const result = await f.accounts.refreshAll();
  assert.equal(f.current.accountId, B);
  assert.equal(result.uncertain, false);
  assert.deepEqual(f.calls.activate, []);
  assert.equal(result.accounts.find(row => row.id === A).quota.status, 'stale');
  assert.equal(result.accounts.find(row => row.id === B).quota.status, 'available');
});
test('an early quota replenishment requires explicit refresh instead of an automatic zero recheck', async () => {
  let remaining = 0;
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: '2026-10-03T12:00:00Z',
        windows: [{key: 'five_hour', remainingPercent: remaining, resetsAt: future}]
      })
  });
  await f.accounts.capture();
  remaining = 88;
  await assert.rejects(f.accounts.acquire({worker: true}), /皆已無可用額度/);
  assert.equal(f.calls.status, 1);
  await f.accounts.refresh();
  assert.equal(f.calls.status, 2);
  const lease = await f.accounts.acquire({worker: true});
  assert.equal(lease.accountId, A);
  await lease.release();
  assert.deepEqual(f.calls.activate, []);
  assert.equal(f.calls.status, 2, 'the just-refreshed positive quota is reused rather than queried again');
});

test('all-account refresh clears non-batch uncertain state only after native idle is confirmed', async () => {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  const lease = await f.accounts.acquire();
  await lease.release({settled: false});
  f.idle = false;
  const observed = await f.accounts.refreshAll();
  assert.equal(observed.uncertain, true);
  assert.equal((await f.accounts.list()).uncertain, true);
  await assert.rejects(f.accounts.acquire(), /停止尚未確認/u);
  f.idle = true;
  const result = await f.accounts.refreshAll();
  assert.equal(result.uncertain, false);
  const next = await f.accounts.acquire();
  await next.release();
});
test('new work and inspection wait for an in-flight read-only account scan and retain active identity', async () => {
  for (const mode of ['work', 'inspect']) {
    let pause = false,
      finish,
      start;
    const started = new Promise(resolve => (start = resolve));
    const f = await fixture({
      identity: {accountId: A, email},
      statusFor: () =>
        pause
          ? new Promise(resolve => {
              pause = false;
              finish = () => resolve(authStatus());
              start();
            })
          : authStatus()
    });
    await f.accounts.capture();
    f.current = {accountId: B, email};
    await f.accounts.capture();
    pause = true;
    const scan = f.accounts.refreshAll();
    await started;
    let ran = false;
    const next =
      mode === 'work'
        ? f.accounts.acquire().then(async lease => {
            assert.equal(lease.accountId, B);
            ran = true;
            await lease.release();
          })
        : f.accounts.inspect(async () => {
            assert.equal(f.current.accountId, B);
            ran = true;
          });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ran, false);
    finish();
    await Promise.all([scan, next]);
    assert.equal(ran, true);
    assert.equal(f.current.accountId, B);
  }
});

test('slow multi-account queries retain their results without a display time limit', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    slow = false;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () => {
      if (slow) now += 240000;
      return authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{key: 'five_hour', remainingPercent: 100, resetsAt: future}]
      });
    }
  });
  for (const id of [A, B, C, D, E]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  slow = true;
  const result = await f.accounts.refreshAll();
  assert(result.accounts.every(a => a.quota.status === 'ready'));
  assert.equal(result.quotaCheck.allExhausted, false);
  const queried = result.accounts.map(a => a.quota.checkedAt);
  assert.equal(new Set(queried).size, 5);
  now += 86400000;
  const later = await f.accounts.list();
  assert(later.accounts.every(a => a.quota.status === 'ready'));
  assert.deepEqual(
    later.accounts.map(a => a.quota.checkedAt),
    queried,
    'waiting must not invent new query times'
  );
});

test('successful quota refresh retains a native disabled window but weekly zero still blocks work', async () => {
  const f = await fixture({
    identity: {accountId: A, email},
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: '2026-10-03T12:00:00Z',
        windows: [
          {key: 'seven_day', remainingPercent: 0, resetsAt: future},
          {key: 'five_hour', disabled: true, remainingPercent: null, resetsAt: null}
        ]
      })
  });
  await f.accounts.capture();
  const result = await f.accounts.refreshAll();
  assert.match(result.note, /已獨立查詢 1 個帳號.*未切換目前登入/u);
  assert.equal(result.quotaCheck.allExhausted, true);
  assert.equal(result.accounts[0].quota.windows[1].disabled, true);
  assert.equal(f.current.accountId, A);
  await assert.rejects(f.accounts.acquire({worker: true}), /皆已無可用額度/u);
});

test('sequential worker handoff accepts an explicitly disabled limit only alongside positive known quota', async () => {
  for (const scenario of ['disabled', 'unknown', 'all-disabled']) {
    const f = await fixture({
      identity: {accountId: A, email},
      statusFor: current =>
        authStatus({
          status: 'ready',
          checkedAt: '2026-10-03T12:00:00Z',
          windows:
            current.accountId === A
              ? [{key: 'seven_day', remainingPercent: 0, resetsAt: future}]
              : scenario === 'all-disabled'
                ? [{key: 'five_hour', disabled: true, remainingPercent: null, resetsAt: null}]
                : [
                    {key: 'seven_day', remainingPercent: 40, resetsAt: future},
                    {
                      key: 'five_hour',
                      ...(scenario === 'disabled' ? {disabled: true} : {}),
                      remainingPercent: null,
                      resetsAt: null
                    }
                  ]
        })
    });
    await f.accounts.capture();
    f.current = {accountId: B, email};
    await f.accounts.capture();
    f.current = {accountId: A, email};
    if (scenario === 'disabled') {
      const lease = await f.accounts.acquire({worker: true});
      assert.equal(lease.accountId, B);
      await lease.release();
    } else await assert.rejects(f.accounts.acquire({worker: true}), /額度尚未確認|候選帳號額度尚未確認/u);
  }
});

const handoffOptions = (parentId, requestId, events) => ({
  worker: true,
  parentId,
  requestId,
  onHandoff: event => events.push(event)
});
const limitFailure = {
  status: 'failed',
  settled: true,
  quotaCheckNeeded: true,
  error: 'native quota or rate limit',
  output: 'partial result'
};
async function handoffFixture(statusFor, {clock, setTimer, clearTimer} = {}) {
  const f = await fixture({identity: {accountId: A, email}});
  await f.accounts.capture();
  f.current = {accountId: B, email: 'b@example.test'};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  f.calls.activate.length = 0;
  if (statusFor)
    f.login.status = async account => {
      f.calls.status++;
      return statusFor(account ?? f.current);
    };
  if (clock || setTimer || clearTimer)
    f.accounts = settleAfterRelease(
      createGeminiAccounts({root: f.root, vault: f.vault, login: f.login, enabled: true, clock, setTimer, clearTimer})
    );
  return f;
}
const officialBalance = (remainingPercent, resetsAt = future) =>
  authStatus({
    status: 'ready',
    windows: [{key: 'five_hour', remainingPercent, resetsAt}],
    checkedAt: '2026-10-03T11:59:30.000Z'
  });

test('shared-account drain aggregates failed and not-started jobs per room after the last natural release', async () => {
  const f = await handoffFixture(identity => officialBalance(identity.accountId === A ? 0 : 80));
  const active = await f.accounts.acquire(),
    events = [];
  const before = f.calls.status;
  const failed = await f.accounts.run(handoffOptions('room-A', 'failed-A', events), async () => limitFailure);
  assert.equal(failed.accountId, A);
  assert.equal(f.calls.status, before);
  assert.deepEqual(f.calls.activate, []);
  let started = 0;
  await assert.rejects(
    f.accounts.run(handoffOptions('room-A', 'not-started-A', events), async () => {
      started++;
    }),
    /未送出本工作/
  );
  await assert.rejects(
    f.accounts.run(handoffOptions('room-B', 'not-started-B', events), async () => {
      started++;
    }),
    /未送出本工作/
  );
  assert.equal(started, 0);
  assert.equal(
    events.some(event => event.status === 'ready'),
    false
  );
  await active.release();
  assert.deepEqual(f.calls.activate, [B]);
  assert.equal(f.current.accountId, B);
  const ready = events.filter(event => event.status === 'ready');
  assert.equal(ready.length, 2);
  assert.deepEqual(ready.find(event => event.parentId === 'room-A').requestIds, ['failed-A', 'not-started-A']);
  assert.deepEqual(ready.find(event => event.parentId === 'room-A').notStartedIds, ['not-started-A']);
  assert.deepEqual(ready.find(event => event.parentId === 'room-B').requestIds, ['not-started-B']);
  assert.deepEqual(ready.find(event => event.parentId === 'room-B').notStartedIds, ['not-started-B']);
  assert(ready.every(event => event.accountId === B));
  assert.equal((await f.accounts.list()).busy, false);
});

test('hard acquire rejection is marked not-started without claiming an owned quota wait', async () => {
  const f = await handoffFixture(),
    events = [];
  let invoked = 0;
  await assert.rejects(
    f.accounts.run({...handoffOptions('hard-refusal', 'invalid-account', events), accountId: C}, async () => {
      invoked++;
      return {status: 'completed', settled: true};
    }),
    error => {
      assert.equal(error.dispatch, 'not-started');
      assert.equal(error.code, undefined);
      assert.equal(error.scheduling, undefined);
      return true;
    }
  );
  assert.equal(invoked, 0);
  assert.deepEqual(events, []);
  assert.deepEqual(f.calls.activate, []);
  assert.equal((await f.accounts.list()).busy, false);
});

test(
  'an acquire released from an in-flight quota check joins the running failure drain instead of switching directly',
  {timeout: 5000},
  async () => {
    let now = Date.parse('2026-10-03T12:00:00Z');
    const f = await handoffFixture(
      account =>
        authStatus({
          status: 'ready',
          checkedAt: new Date(now).toISOString(),
          windows: [{key: 'five_hour', remainingPercent: 80, resetsAt: future}]
        }),
      {clock: () => now}
    );
    let finishB,
      startedB,
      releaseAQuery,
      startedAQuery,
      aCalls = 0,
      aInvoked = 0;
    const beganB = new Promise(resolve => (startedB = resolve)),
      beganAQuery = new Promise(resolve => (startedAQuery = resolve)),
      roomX = [],
      roomY = [];
    f.vault.queryQuota = async id => {
      if (id === A) {
        aCalls++;
        if (aCalls === 1) {
          startedAQuery();
          return new Promise(resolve => (releaseAQuery = () => resolve({accountId: A, ...officialBalance(0)})));
        }
        return {accountId: A, ...officialBalance(0)};
      }
      return {accountId: id, ...officialBalance(80)};
    };
    const failedRun = f.accounts.run(handoffOptions('room-X', 'failed-X', roomX), async () => {
      startedB();
      return new Promise(resolve => (finishB = resolve));
    });
    await beganB;
    now += 61000;
    const acquiringRun = f.accounts
      .run(handoffOptions('room-Y', 'not-started-Y', roomY), async () => {
        aInvoked++;
        return {status: 'completed', settled: true};
      })
      .then(
        value => ({value}),
        error => ({error})
      );
    await beganAQuery;
    finishB(limitFailure);
    await eventually(() => roomX.some(event => event.status === 'waiting'));
    releaseAQuery();
    const acquisition = await acquiringRun;
    assert(acquisition.error, 'the waiting acquire must not proceed to the target account');
    assert.equal(acquisition.error.dispatch, 'not-started');
    assert.equal(aInvoked, 0);
    await failedRun;
    await eventually(
      () =>
        roomX.filter(event => event.status === 'ready').length === 1 &&
        roomY.filter(event => event.status === 'ready').length === 1
    );
    assert.deepEqual(f.calls.activate, [B]);
    assert.equal(f.current.accountId, B);
    assert.equal(roomX.filter(event => event.status === 'ready').length, 1);
    assert.deepEqual(roomX.find(event => event.status === 'ready').requestIds, ['failed-X']);
    assert.equal(roomY.filter(event => event.status === 'ready').length, 1);
    assert.deepEqual(roomY.find(event => event.status === 'ready').requestIds, ['not-started-Y']);
  }
);

test('a stale retained official zero can drain to a freshly verified positive candidate', {timeout: 5000}, async () => {
  const now = Date.parse('2026-10-03T12:00:00Z'),
    timers = [],
    events = [];
  const f = await handoffFixture(() => officialBalance(80), {
    clock: () => now,
    setTimer: (fn, ms) => {
      const timer = {fn, ms};
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => {
      timer.cancelled = true;
    }
  });
  let sourceQueries = 0,
    finish,
    started;
  f.vault.queryQuota = async id => {
    if (id === A) {
      sourceQueries++;
      if (sourceQueries === 1) return {accountId: id, ...officialBalance(0)};
      throw Error('source refresh temporarily failed');
    }
    return {accountId: id, ...officialBalance(80)};
  };
  const began = new Promise(resolve => (started = resolve));
  const run = f.accounts.run(handoffOptions('stale-zero', 'failed', events), async lease => {
    assert.equal(lease.accountId, A);
    assert.deepEqual(f.calls.activate, []);
    await lease.quotaHint();
    await f.accounts.refreshAll({force: true});
    const source = (await f.accounts.list()).accounts.find(row => row.id === A);
    assert.equal(source.quota.status, 'stale');
    assert.equal(source.quota.windows[0].remainingPercent, 0);
    const pending = new Promise(resolve => (finish = resolve));
    started();
    return pending;
  });
  await began;
  finish(limitFailure);
  await run;
  assert.equal(events.at(-1).status, 'ready', JSON.stringify(events));
  assert.equal(events.at(-1).accountId, B);
  assert.deepEqual(f.calls.activate, [B]);
  assert.equal(f.current.accountId, B);
  f.accounts.cancelWorkerHandoff({parentId: 'stale-zero'});
});

test('rate limits stay terminal while temporary or unknown quota keeps a quiet wait without switching', async t => {
  for (const mode of ['rate', 'unknown', 'stale-zero', 'non-subscription-zero'])
    await t.test(mode, async () => {
      const f = await handoffFixture(() =>
        mode === 'rate'
          ? officialBalance(70)
          : mode === 'stale-zero'
            ? authStatus({status: 'stale', windows: [{key: 'five_hour', remainingPercent: 0, resetsAt: future}]})
            : mode === 'non-subscription-zero'
              ? authStatus({status: 'ready', windows: [{key: 'requests', remainingPercent: 0, resetsAt: future}]})
              : {auth: {status: 'authenticated'}, quota: {status: 'unavailable', windows: []}}
      );
      const active = await f.accounts.acquire(),
        events = [];
      await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
      await active.release();
      assert.deepEqual(f.calls.activate, []);
      assert.equal(f.current.accountId, A);
      if (mode === 'rate') assert.equal(events.filter(event => event.status === 'blocked').length, 1);
      // Quiet updates refresh what queries report; the room itself is notified once.
      else assert.equal(events.filter(event => event.status === 'waiting' && !event.quiet).length, 1);
      assert.equal(
        events.some(event => event.status === 'ready'),
        false
      );
      const before = f.calls.status;
      await f.accounts.list();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.calls.status, before);
    });
});

test('official zero with unknown reset is never usable and hands off only to a verified positive account', async t => {
  await t.test('original zero can hand off to an official positive account', async () => {
    const f = await handoffFixture(identity => officialBalance(identity.accountId === A ? 0 : 75, null));
    const active = await f.accounts.acquire(),
      events = [];
    await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
    await active.release();
    assert.deepEqual(f.calls.activate, [B]);
    assert.equal(events.at(-1).status, 'ready');
  });
  await t.test('zero candidate with unknown reset never becomes ready', async () => {
    const f = await handoffFixture(() => officialBalance(0, null)),
      active = await f.accounts.acquire(),
      events = [];
    await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
    await active.release();
    assert.deepEqual(f.calls.activate, []);
    assert.equal(f.current.accountId, A);
    assert.equal(events.at(-1).status, 'waiting');
    f.accounts.cancelWorkerHandoff({parentId: 'room'});
  });
});

test('all-zero accounts with unknown or past resets retry quietly; a later positive result readies once, and cancel clears retry timer', async t => {
  for (const resetKind of ['unknown', 'past'])
    await t.test(resetKind, async () => {
      let now = Date.parse('2026-10-03T12:00:00Z'),
        positive = false;
      const timers = [],
        events = [],
        queried = [];
      const resetAt = resetKind === 'unknown' ? null : (now - 1000) / 1000;
      const f = await fixture({
        identity: {accountId: A, email},
        clock: () => now,
        setTimer: (fn, ms) => {
          const timer = {fn, ms};
          timers.push(timer);
          return timer;
        },
        clearTimer: timer => {
          timer.cancelled = true;
        },
        statusFor: account =>
          authStatus({
            status: 'ready',
            checkedAt: new Date(now).toISOString(),
            windows: [
              {key: 'five_hour', remainingPercent: positive && account.accountId === B ? 75 : 0, resetsAt: resetAt}
            ]
          })
      });
      for (const id of [A, B, C, D, E]) {
        f.current = {accountId: id, email};
        await f.accounts.capture();
      }
      await f.accounts.activate({accountId: A});
      f.calls.activate.length = 0;
      f.vault.queryQuota = async id => {
        queried.push(id);
        return {
          accountId: id,
          auth: {status: 'authenticated', checkedAt: new Date(now).toISOString()},
          quota: authStatus({
            status: 'ready',
            checkedAt: new Date(now).toISOString(),
            windows: [{key: 'five_hour', remainingPercent: positive && id === B ? 75 : 0, resetsAt: resetAt}]
          }).quota
        };
      };
      await assert.rejects(
        f.accounts.run(handoffOptions(`zero-${resetKind}`, 'not-started', events), async () =>
          assert.fail('all-zero account must not run')
        ),
        /未開始工作|未送出/
      );
      await eventually(() => timers.length === 1);
      assert.equal(events.filter(event => event.status === 'waiting').length, 1);
      assert.deepEqual(f.calls.activate, []);
      assert.equal(timers[0].ms, 60000);
      now += 60000;
      positive = true;
      timers[0].fn();
      await eventually(() => events.filter(event => event.status === 'ready').length === 1);
      assert.equal(events.filter(event => event.status === 'waiting').length, 1);
      assert.equal(events.filter(event => event.status === 'ready').length, 1);
      assert.equal(events.at(-1).accountId, B);
      assert.deepEqual(f.calls.activate, [B]);
      assert(queried.includes(A));
      assert(queried.includes(B));
    });
  await t.test('cancel removes an unknown-reset retry without dispatch or switching', async () => {
    let now = Date.parse('2026-10-03T12:00:00Z');
    const timers = [],
      events = [];
    const f = await fixture({
      identity: {accountId: A, email},
      clock: () => now,
      setTimer: (fn, ms) => {
        const timer = {fn, ms};
        timers.push(timer);
        return timer;
      },
      clearTimer: timer => {
        timer.cancelled = true;
      },
      statusFor: () =>
        authStatus({
          status: 'ready',
          checkedAt: new Date(now).toISOString(),
          windows: [{key: 'five_hour', remainingPercent: 0, resetsAt: null}]
        })
    });
    for (const id of [A, B]) {
      f.current = {accountId: id, email};
      await f.accounts.capture();
    }
    await f.accounts.activate({accountId: A});
    f.calls.activate.length = 0;
    await assert.rejects(
      f.accounts.run(handoffOptions('cancel-zero', 'not-started', events), async () =>
        assert.fail('must not dispatch')
      ),
      /未開始工作|未送出/
    );
    await eventually(() => timers.length === 1);
    const before = f.calls.status;
    f.accounts.cancelWorkerHandoff({parentId: 'cancel-zero'});
    assert.equal(timers[0].cancelled, true);
    assert.deepEqual(f.calls.activate, []);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.status, before);
    assert.equal(
      events.some(event => event.status === 'ready'),
      false
    );
  });
});

test('no waiter, DNS failure, cancelled work or unknown settlement cannot initiate an account switch', async t => {
  for (const outcome of [
    {status: 'completed', settled: true},
    {status: 'failed', settled: true, error: 'DNS no such host'},
    {...limitFailure, status: 'cancelled'},
    {...limitFailure, settled: false}
  ])
    await t.test(JSON.stringify(outcome), async () => {
      const f = await handoffFixture(() => officialBalance(0)),
        active = await f.accounts.acquire(),
        events = [];
      await f.accounts.run(handoffOptions('room', 'job', events), async () => outcome);
      await active.release();
      assert.deepEqual(f.calls.activate, []);
      assert.deepEqual(events, []);
    });
});

test('cancelled last waiter while another room works leaves the account untouched', async () => {
  const f = await handoffFixture(identity => officialBalance(identity.accountId === A ? 0 : 80)),
    active = await f.accounts.acquire(),
    events = [];
  await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
  f.accounts.cancelWorkerHandoff({parentId: 'room'});
  await active.release();
  assert.deepEqual(f.calls.activate, []);
  assert.equal(
    events.some(event => event.status !== 'waiting'),
    false
  );
});

test(
  'temporary quota-query failures preserve the wait and use 1/2/4/8/10 minute retries',
  {timeout: 5000},
  async () => {
    let now = Date.parse('2026-10-03T12:00:00Z');
    const timers = [],
      events = [];
    const f = await handoffFixture(
      id =>
        id.accountId === B
          ? {auth: {status: 'authenticated'}, quota: {status: 'unavailable', windows: []}}
          : officialBalance(80),
      {
        clock: () => now,
        setTimer: (fn, ms) => {
          const timer = {fn, ms};
          timers.push(timer);
          return timer;
        },
        clearTimer: timer => {
          timer.cancelled = true;
        }
      }
    );
    // Keep one live work lease while its quota-failed result registers an owned wait.
    const active = await f.accounts.acquire();
    let reads = 0;
    f.vault.queryQuota = async id => {
      reads++;
      throw Error(`temporary ${id}`);
    };
    await f.accounts.run(handoffOptions('retry-room', 'failed', events), async () => limitFailure);
    assert.equal(events.filter(event => event.status === 'waiting').length, 1);
    await active.release();
    await eventually(() => timers.length === 1);
    const delays = [60000, 120000, 240000, 480000, 600000];
    for (let index = 0; index < delays.length; index++) {
      assert.equal(timers[index].ms, delays[index]);
      if (index < delays.length - 1) {
        now += delays[index];
        timers[index].fn();
        await eventually(() => timers.length === index + 2);
      }
    }
    f.vault.queryQuota = async id => {
      reads++;
      return {
        accountId: id,
        auth: {status: 'authenticated', checkedAt: new Date(now).toISOString()},
        quota: officialBalance(80).quota
      };
    };
    now += delays.at(-1);
    timers.at(-1).fn();
    await eventually(() => events.filter(event => event.status === 'blocked').length === 1);
    assert.equal(reads, 6, 'one shared drain query, four failed retries, and one successful retry');
    assert.equal(
      events.filter(event => event.status === 'waiting').length,
      1,
      'temporary retries do not repeatedly wake the same room'
    );
    assert.deepEqual(f.calls.activate, []);
    f.accounts.cancelWorkerHandoff({parentId: 'retry-room'});
  }
);

test(
  'temporary candidate query retries stay quiet and confirmed positive quota releases the waiter once',
  {timeout: 5000},
  async () => {
    let now = Date.parse('2026-10-03T12:00:00Z');
    const timers = [],
      events = [],
      queried = [];
    let failures = 5;
    const f = await handoffFixture(() => officialBalance(80), {
      clock: () => now,
      setTimer: (fn, ms) => {
        const timer = {fn, ms};
        timers.push(timer);
        return timer;
      },
      clearTimer: timer => {
        timer.cancelled = true;
      }
    });
    f.vault.queryQuota = async id => {
      queried.push(id);
      if (id === A) return {accountId: id, ...officialBalance(0)};
      if (id === B && failures-- > 0) throw Error('temporary candidate query failure');
      return {
        accountId: id,
        auth: {status: 'authenticated', checkedAt: new Date(now).toISOString()},
        quota: officialBalance(80).quota
      };
    };
    const active = await f.accounts.acquire();
    await f.accounts.run(handoffOptions('failed-room', 'failed', events), async () => limitFailure);
    await assert.rejects(
      f.accounts.run(handoffOptions('waiting-room', 'not-started', events), async () =>
        assert.fail('unstarted work must not run')
      ),
      /未送出/u
    );
    await active.release();
    await eventually(() => timers.length === 1);
    const delays = [60000, 120000, 240000, 480000, 600000];
    for (let index = 0; index < delays.length; index++) {
      assert.equal(timers[index].ms, delays[index]);
      now += delays[index];
      timers[index].fn();
      if (index < delays.length - 1) await eventually(() => timers.length === index + 2);
    }
    await eventually(() => events.some(event => event.parentId === 'waiting-room' && event.status === 'ready'));
    assert.deepEqual(queried, [A, B, B, B, B, B, B]);
    assert.deepEqual(f.calls.activate, [B]);
    assert.equal(f.current.accountId, B);
    assert.equal(events.filter(event => event.parentId === 'waiting-room' && event.status === 'waiting').length, 1);
    assert.equal(events.filter(event => event.parentId === 'waiting-room' && event.status === 'ready').length, 1);
    f.accounts.cancelWorkerHandoff({parentId: 'failed-room'});
  }
);

test('natural drain activates the same account once when quota evidence requires token activation', async () => {
  const f = await handoffFixture(() => officialBalance(80)),
    events = [];
  let refreshRequiresActivation = false;
  f.vault.queryQuota = async id => ({
    accountId: id,
    auth: {status: 'authenticated', requiresActivation: refreshRequiresActivation, checkedAt: new Date().toISOString()},
    quota: officialBalance(80).quota
  });
  const active = await f.accounts.acquire();
  refreshRequiresActivation = true;
  await f.accounts.refresh();
  await assert.rejects(
    f.accounts.run({...handoffOptions('token-room', 'token-unstarted', events), accountId: B}, async () =>
      assert.fail('unstarted job must not run')
    ),
    /本工作未送出/u
  );
  await active.release();
  assert.deepEqual(f.calls.activate, [A]);
  assert.equal(f.current.accountId, A);
  assert.equal(events.filter(event => event.status === 'ready').length, 1);
  assert.equal(
    events.some(event => event.status === 'blocked'),
    false
  );
});

test('cancelling the last waiter during the final official query prevents rotation and callbacks', async () => {
  const f = await handoffFixture(),
    active = await f.accounts.acquire(),
    events = [];
  let resolveQuery, started;
  const queryStarted = new Promise(resolve => {
    started = resolve;
  });
  f.login.status = async () => {
    started();
    return new Promise(resolve => {
      resolveQuery = resolve;
    });
  };
  await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
  const release = active.release();
  await queryStarted;
  f.accounts.cancelWorkerHandoff({parentId: 'room'});
  resolveQuery(officialBalance(0));
  await release;
  assert.deepEqual(f.calls.activate, []);
  assert.equal(
    events.some(event => event.status !== 'waiting'),
    false
  );
});

test('unknown candidate stays waiting; failed account activation restores original identity', async t => {
  for (const mode of ['unknown', 'switch-failed', 'cancel-during-candidate', 'restore-failed'])
    await t.test(mode, async () => {
      const f = await handoffFixture(),
        active = await f.accounts.acquire(),
        events = [];
      f.vault.queryQuota = async id => {
        if (id === A) return {accountId: id, ...officialBalance(0)};
        if (mode === 'unknown' || mode === 'cancel-during-candidate') {
          if (mode === 'cancel-during-candidate') f.accounts.cancelWorkerHandoff({parentId: 'room'});
          return {
            accountId: id,
            temporaryFailure: true,
            auth: {status: 'unknown'},
            quota: {status: 'unavailable', windows: []}
          };
        }
        return {accountId: id, ...officialBalance(80)};
      };
      const activate = f.vault.activate;
      f.vault.activate = async (id, options) => {
        if (mode === 'restore-failed' && id === A) throw Error('fixture restore failed');
        const result = await activate(id, options);
        if ((mode === 'switch-failed' || mode === 'restore-failed') && id === B)
          throw Error('fixture partial switch failed');
        return result;
      };
      await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
      await active.release();
      if (mode === 'restore-failed') {
        assert.equal(f.current.accountId, B);
        assert.equal((await f.accounts.list()).uncertain, true);
        assert.equal(events.at(-1).accountId, null);
        assert.match(events.at(-1).reason, /還原尚未確認/);
      } else if (mode === 'switch-failed') {
        assert.equal(f.current.accountId, A);
        assert.deepEqual(
          f.calls.activate,
          [B, A],
          JSON.stringify({events, queries: f.calls.status, state: await f.accounts.list()})
        );
      } else {
        assert.equal(f.current.accountId, A);
        assert.deepEqual(f.calls.activate, []);
      }
      if (mode === 'cancel-during-candidate')
        assert.equal(
          events.some(event => event.status !== 'waiting'),
          false
        );
      else if (mode === 'unknown') assert.equal(events.at(-1).status, 'waiting');
      else assert.equal(events.at(-1).status, 'blocked');
      assert.equal(
        events.some(event => event.status === 'ready'),
        false
      );
    });
});

test('ready callback can acquire the new account after the drain lock is released, without replaying old work', async () => {
  const f = await handoffFixture(identity => officialBalance(identity.accountId === A ? 0 : 80)),
    active = await f.accounts.acquire();
  let next;
  const options = handoffOptions('room', 'failed', []);
  options.onHandoff = event => {
    if (event.status === 'ready') next = f.accounts.acquire({worker: true});
  };
  await f.accounts.run(options, async () => limitFailure);
  await active.release();
  const lease = await next;
  assert.equal(lease.accountId, B);
  await lease.release();
  assert.deepEqual(f.calls.activate, [B]);
});

test('a final native model or auth inspection also wakes waiting rooms after natural completion', async () => {
  const f = await handoffFixture(identity => officialBalance(identity.accountId === A ? 0 : 80)),
    events = [];
  let finish, started;
  const began = new Promise(resolve => {
    started = resolve;
  });
  const inspection = f.accounts.inspect(
    () =>
      new Promise(resolve => {
        finish = resolve;
        started();
      })
  );
  await began;
  await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
  assert.equal(
    events.some(event => event.status === 'ready'),
    false
  );
  finish('models');
  assert.equal(await inspection, 'models');
  assert.deepEqual(f.calls.activate, [B]);
  assert.equal(events.at(-1).status, 'ready');
});

test('known exhausted account rejected before dispatch still registers the source and drains after the existing inspection', async () => {
  const f = await handoffFixture(identity => officialBalance(identity.accountId === A ? 0 : 80));
  await f.accounts.refresh();
  let finish, started;
  const began = new Promise(resolve => {
    started = resolve;
  });
  const active = f.accounts.inspect(
    () =>
      new Promise(resolve => {
        finish = resolve;
        started();
      })
  );
  await began;
  const events = [];
  let runs = 0;
  await assert.rejects(
    f.accounts.run(handoffOptions('room', 'rejected', events), async () => {
      runs++;
    }),
    /未送出本工作/
  );
  assert.equal(runs, 0);
  assert.equal(events.at(-1).status, 'waiting');
  finish();
  await active;
  assert.deepEqual(f.calls.activate, [B]);
  assert.equal(events.at(-1).status, 'ready');
  assert.deepEqual(events.at(-1).requestIds, ['rejected']);
});

test('initial official zero with unknown reset cannot start a main or worker model turn', async t => {
  for (const worker of [false, true])
    await t.test(`worker=${worker}`, async () => {
      const f = await fixture({identity: {accountId: A, email}, statusFor: () => officialBalance(0, null)});
      await f.accounts.capture();
      let turns = 0;
      await assert.rejects(
        f.accounts.run({worker}, async () => {
          turns++;
          return {settled: true};
        }),
        /額度|皆已無/
      );
      assert.equal(turns, 0);
      assert.deepEqual(f.calls.activate, []);
    });
});

test('an expired cached zero is rechecked after drain; replenished official quota does not trigger rotation', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    zero = false;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () => officialBalance(zero ? 0 : 80, (Date.parse('2026-10-03T12:00:00Z') + 60000) / 1000)
  });
  await f.accounts.capture();
  f.current = {accountId: B, email};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  f.calls.activate.length = 0;
  zero = true;
  await f.accounts.refresh();
  let finish, started;
  const began = new Promise(resolve => {
    started = resolve;
  });
  const active = f.accounts.inspect(
    () =>
      new Promise(resolve => {
        finish = resolve;
        started();
      })
  );
  await began;
  const events = [];
  await assert.rejects(
    f.accounts.run(handoffOptions('room', 'rejected', events), async () => {
      throw Error('must not start');
    }),
    /未送出/
  );
  const checks = f.calls.status;
  now += 120000;
  zero = false;
  finish();
  await active;
  assert.equal(f.calls.status, checks + 1);
  assert.deepEqual(f.calls.activate, []);
  assert.equal(events.at(-1).status, 'ready');
  assert.equal(events.at(-1).switched, false);
  assert.match(events.at(-1).reason, /仍有可用額度/);
});

test('a drain decision cannot clear a concurrently held manual account-operation lock', async () => {
  const f = await handoffFixture(),
    active = await f.accounts.acquire(),
    events = [];
  await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
  let resolveQuery,
    started,
    defer = true;
  const began = new Promise(resolve => {
    started = resolve;
  });
  f.login.status = async () => {
    if (defer) {
      defer = false;
      started();
      return new Promise(resolve => {
        resolveQuery = resolve;
      });
    }
    return officialBalance(80);
  };
  // Both operations await load first. The final release makes capture eligible;
  // capture gets changing before the already queued acquire wakes the drain.
  const capture = f.accounts.capture();
  const queued = f.accounts.acquire().catch(error => error);
  const release = active.release();
  await began;
  const queuedResult = await queued;
  assert(queuedResult instanceof Error, 'acquire queued behind a manual capture must not enter work');
  await release;
  assert.equal((await f.accounts.list()).busy, true, 'manual capture still owns changing');
  await assert.rejects(f.accounts.acquire(), /正在切換|登入/);
  assert.equal(events.at(-1).status, 'waiting');
  assert.deepEqual(f.calls.activate, []);
  resolveQuery(officialBalance(80));
  await capture;
  await eventually(() => events.at(-1)?.status === 'blocked');
  assert.equal((await f.accounts.list()).busy, false);
});

test('disabled usage windows and unverified authentication cannot authorize a drain rotation', async t => {
  for (const mode of ['disabled', 'unknown-auth', 'signed-out'])
    await t.test(mode, async () => {
      const f = await handoffFixture(),
        active = await f.accounts.acquire(),
        events = [];
      f.login.status = async () =>
        mode === 'disabled'
          ? authStatus({
              status: 'ready',
              windows: [
                {key: 'five_hour', remainingPercent: 0, disabled: true, resetsAt: null},
                {key: 'seven_day', remainingPercent: 80, resetsAt: future}
              ]
            })
          : {
              auth: {status: mode === 'unknown-auth' ? 'unknown' : 'signed-out'},
              quota: {status: 'ready', windows: [{key: 'five_hour', remainingPercent: 0, resetsAt: future}]}
            };
      await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
      await active.release();
      assert.deepEqual(f.calls.activate, []);
      assert.equal(events.at(-1).status, mode === 'unknown-auth' ? 'waiting' : 'blocked');
      assert.equal(
        events.some(event => event.status === 'ready'),
        false
      );
    });
});

test('official positive quota releases only not-started rooms on the same account, without recovering the rate-failed room', async () => {
  const f = await handoffFixture(() => officialBalance(80)),
    active = await f.accounts.acquire(),
    events = [];
  await f.accounts.run(handoffOptions('rate-room', 'rate-failed', events), async () => limitFailure);
  await assert.rejects(
    f.accounts.run(handoffOptions('new-room', 'not-started', events), async () => {
      throw Error('must not start');
    }),
    /未送出/
  );
  await active.release();
  const ready = events.filter(event => event.status === 'ready');
  assert.equal(ready.length, 1);
  assert.equal(ready[0].parentId, 'new-room');
  assert.equal(ready[0].switched, false);
  assert.equal(ready[0].accountId, A);
  assert.deepEqual(ready[0].requestIds, ['not-started']);
  const blocked = events.find(event => event.parentId === 'rate-room' && event.status === 'blocked');
  assert.equal(blocked?.accountId, A);
  assert.deepEqual(blocked?.requestIds, ['rate-failed']);
  assert.deepEqual(events.find(event => event.parentId === 'new-room' && event.status === 'waiting')?.notStartedIds, [
    'not-started'
  ]);
  assert.deepEqual(f.calls.activate, []);
});

test('mixed same-room positive quota resolves both wait scopes but only unstarted IDs are ready', async () => {
  const f = await handoffFixture(() => officialBalance(80)),
    active = await f.accounts.acquire(),
    events = [];
  await f.accounts.run(handoffOptions('mixed', 'rate-failed', events), async () => limitFailure);
  await assert.rejects(
    f.accounts.run(handoffOptions('mixed', 'unstarted', events), async () => {
      throw Error('must not start');
    }),
    /未送出/
  );
  await active.release();
  const terminal = events.filter(event => event.status !== 'waiting');
  assert.equal(terminal.length, 2);
  assert.equal(terminal[0].status, 'blocked');
  assert.deepEqual(terminal[0].requestIds, ['rate-failed']);
  assert.equal(terminal[1].status, 'ready');
  assert.equal(terminal[1].switched, false);
  assert.deepEqual(terminal[1].requestIds, ['unstarted']);
  assert.match(terminal[1].reason, /失敗工單.*不|不.*失敗工單/);
  assert.deepEqual(f.calls.activate, []);
});

test('a rejected acquisition registered after the last release still starts one drain without a timer', async () => {
  const f = await handoffFixture(() => officialBalance(80)),
    active = await f.accounts.acquire(),
    events = [];
  await f.accounts.run(handoffOptions('old', 'rate-failed', events), async () => limitFailure);
  const acquire = f.accounts.acquire;
  let gaps = 0,
    resolveTerminal;
  const terminal = new Promise(resolve => {
    resolveTerminal = resolve;
  });
  f.accounts.acquire = async options => {
    try {
      return await acquire(options);
    } catch (error) {
      if (error.code === 'GEMINI_HANDOFF_WAIT') {
        f.accounts.cancelWorkerHandoff({parentId: 'old'});
        await active.release();
        await Promise.resolve();
        gaps++;
      }
      throw error;
    }
  };
  const options = handoffOptions('late', 'not-started', events);
  options.onHandoff = event => {
    events.push(event);
    if (event.status !== 'waiting') resolveTerminal(event);
  };
  await assert.rejects(
    f.accounts.run(options, async () => {
      throw Error('must not start');
    }),
    /未送出/
  );
  const observed = await Promise.race([terminal, new Promise(resolve => setTimeout(() => resolve(null), 200))]);
  assert.equal(gaps, 1);
  assert.notEqual(observed, null, 'a live waiter must not be stranded after no lease remains');
  assert.equal(observed.status, 'ready');
  assert.equal(observed.switched, false);
  assert.deepEqual(f.calls.activate, []);
});

test('saved-order quota queries skip zero account without switching and activate only the first confirmed available account', async () => {
  const f = await handoffFixture();
  f.current = {accountId: C, email: 'c@example.test'};
  await f.accounts.capture();
  await f.accounts.activate({accountId: A});
  f.calls.activate.length = 0;
  const active = await f.accounts.acquire(),
    events = [],
    queried = [];
  f.vault.queryQuota = async id => {
    queried.push(id);
    return {accountId: id, ...officialBalance(id === A ? 0 : id === B ? 0 : 80)};
  };
  await f.accounts.run(handoffOptions('room', 'failed', events), async () => limitFailure);
  await active.release();
  assert.deepEqual(queried, [A, B, C]);
  assert.equal(f.current.accountId, C);
  assert.equal((await f.accounts.list()).uncertain, false);
  assert.deepEqual(f.calls.activate, [C]);
  assert.equal(events.at(-1).status, 'ready');
  assert.equal(events.at(-1).accountId, C);
});

test('late unstarted registration after an earlier zero drain attaches to the newly current account and wakes once', async () => {
  const f = await handoffFixture(identity => officialBalance(identity.accountId === A ? 0 : 80)),
    active = await f.accounts.acquire(),
    events = [];
  await f.accounts.run(handoffOptions('old', 'failed', events), async () => limitFailure);
  const acquire = f.accounts.acquire;
  let resolveTerminal;
  const terminal = new Promise(resolve => {
    resolveTerminal = resolve;
  });
  f.accounts.acquire = async options => {
    try {
      return await acquire(options);
    } catch (error) {
      if (error.code === 'GEMINI_HANDOFF_WAIT') {
        await active.release();
        await Promise.resolve();
      }
      throw error;
    }
  };
  const options = handoffOptions('late', 'not-started', events);
  options.onHandoff = event => {
    events.push(event);
    if (event.status !== 'waiting') resolveTerminal(event);
  };
  await assert.rejects(
    f.accounts.run(options, async () => {
      throw Error('must not start');
    }),
    /就緒時 K 會通知，勿立即重派/
  );
  const observed = await Promise.race([terminal, new Promise(resolve => setTimeout(() => resolve(null), 200))]);
  assert.notEqual(observed, null);
  assert.equal(observed.status, 'ready');
  assert.equal(observed.accountId, B);
  assert.equal(observed.switched, false);
  assert.deepEqual(observed.requestIds, ['not-started']);
  assert.deepEqual(f.calls.activate, [B]);
  const prior = events.filter(event => event.parentId === 'old' && event.status === 'ready');
  assert.equal(prior.length, 1);
  assert.equal(prior[0].switched, true);
});

test(
  'an already rejected acquisition registered in cancelled-drain finally is not orphaned before pending clears',
  {timeout: 3000},
  async () => {
    const f = await handoffFixture();
    let accounts,
      phase = 'init',
      resolveQuery,
      started,
      lateRun,
      resolveTerminal,
      triggered = false;
    const events = [],
      trace = [];
    const began = new Promise(resolve => {
        started = resolve;
      }),
      terminal = new Promise(resolve => {
        resolveTerminal = resolve;
      });
    const login = {
      status: async () => {
        if (phase === 'await-query') {
          started();
          return new Promise(resolve => {
            resolveQuery = resolve;
          });
        }
        return officialBalance(80);
      }
    };
    f.vault.queryQuota = async id => ({accountId: id, ...(await login.status({accountId: id, email}))});
    accounts = createGeminiAccounts({
      root: f.root,
      vault: f.vault,
      login,
      enabled: true,
      clock: () => Date.parse('2026-10-03T12:00:00Z'),
      onChange: () => {
        if (phase === 'query-resolved') {
          trace.push('query-save');
          phase = 'query-saved';
        } else if (phase === 'query-saved' && !triggered) {
          triggered = true;
          phase = 'late';
          trace.push('drain-finally');
          const acquire = accounts.acquire;
          accounts.acquire = options =>
            options.parentId === 'late'
              ? Promise.reject(
                  Object.assign(Error('controlled already-rejected acquire'), {
                    code: 'GEMINI_HANDOFF_WAIT',
                    accountId: A
                  })
                )
              : acquire(options);
          lateRun = accounts
            .run(
              {
                worker: true,
                parentId: 'late',
                requestId: 'unstarted',
                onHandoff: event => {
                  events.push(event);
                  trace.push(`late-${event.status}`);
                  if (event.status !== 'waiting') resolveTerminal(event);
                }
              },
              async () => {
                throw Error('must not start');
              }
            )
            .catch(error => error);
        }
      }
    });
    const active = await accounts.acquire();
    await accounts.run(
      {worker: true, parentId: 'old', requestId: 'failed', onHandoff: event => events.push(event)},
      async () => limitFailure
    );
    phase = 'await-query';
    const release = active.release();
    await began;
    accounts.cancelWorkerHandoff({parentId: 'old'});
    phase = 'query-resolved';
    resolveQuery(officialBalance(80));
    await release;
    await accounts.idle();
    trace.push('outer-returned');
    await lateRun;
    const observed = await Promise.race([terminal, new Promise(resolve => setTimeout(() => resolve(null), 200))]);
    assert(
      trace.indexOf('late-waiting') < trace.indexOf('outer-returned'),
      'controlled catch must register before outer cleanup'
    );
    assert.notEqual(observed, null);
    assert.equal(observed.status, 'ready');
    assert.equal(observed.switched, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.filter(event => event.parentId === 'late' && event.status !== 'waiting').length, 1);
    assert.deepEqual(f.calls.activate, []);
    const lease = await accounts.acquire({worker: true});
    assert.equal(lease.accountId, A);
    await lease.release();
  }
);

test('cancelled drain with no new waiter finishes once without another query or self-spin', async () => {
  const f = await handoffFixture(),
    active = await f.accounts.acquire(),
    events = [];
  let resolveQuery,
    started,
    checks = 0;
  const began = new Promise(resolve => {
    started = resolve;
  });
  f.login.status = async () => {
    checks++;
    started();
    return new Promise(resolve => {
      resolveQuery = resolve;
    });
  };
  await f.accounts.run(handoffOptions('old', 'failed', events), async () => limitFailure);
  const release = active.release();
  await began;
  f.accounts.cancelWorkerHandoff({parentId: 'old'});
  resolveQuery(officialBalance(0));
  await release;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checks, 1);
  assert.equal(events.filter(event => event.status !== 'waiting').length, 0);
  assert.equal((await f.accounts.list()).busy, false);
  assert.deepEqual(f.calls.activate, []);
});

test('a worker result does not wait for the account queries its release starts', async () => {
  const f = await handoffFixture();
  const accounts = createGeminiAccounts({root: f.root, vault: f.vault, login: f.login, enabled: true});
  let block = false,
    resolveQuery,
    started;
  const began = new Promise(resolve => (started = resolve));
  const query = f.vault.queryQuota;
  f.vault.queryQuota = async id => {
    if (!block) return query(id);
    started();
    await new Promise(resolve => (resolveQuery = resolve));
    return {accountId: id, ...officialBalance(80)};
  };
  const events = [];
  const run = accounts.run(handoffOptions('room', 'failed', events), async () => {
    block = true;
    return limitFailure;
  });
  await began;
  const outcome = await Promise.race([run, new Promise(resolve => setTimeout(() => resolve('still waiting'), 200))]);
  assert.equal(outcome.status, 'failed', 'the worker result is reported while the official query is pending');
  resolveQuery();
  await accounts.idle();
  // Official quota remains, so the failure is treated as a rate limit: no switch, no replay.
  assert.equal(events.at(-1).status, 'blocked');
});

test('refreshing all accounts reports which account is being queried, then clears the progress', async () => {
  const f = await handoffFixture();
  const seen = [];
  let accounts;
  accounts = createGeminiAccounts({
    root: f.root,
    login: f.login,
    vault: f.vault,
    enabled: true,
    onChange: () => {
      const checking = accounts?.cachedUsage?.checking;
      if (checking && JSON.stringify(seen.at(-1)) !== JSON.stringify(checking)) seen.push(checking);
    }
  });
  await accounts.refreshAll({force: true});
  assert.deepEqual(seen, [
    {current: 1, total: 2},
    {current: 2, total: 2}
  ]);
  assert.equal(accounts.cachedUsage.checking, undefined);
  assert.equal((await accounts.list()).progress, null);
});

test('other saved accounts are re-read in the background, one at a time; a failed read is retried later', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z');
  const offline = new Set(),
    reads = [];
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: account => {
      reads.push(account.accountId);
      if (offline.has(account.accountId))
        return {temporaryFailure: true, auth: {status: 'unknown'}, reason: 'network timeout'};
      return authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [
          {key: 'five_hour', remainingPercent: account.accountId === C ? 0 : 50, resetsAt: (now + 3600000) / 1000}
        ]
      });
    }
  });
  for (const id of [B, C, A]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  const read = async () => {
    reads.length = 0;
    await f.accounts.usage();
    await f.accounts.idle();
    return [...reads];
  };
  offline.add(B);
  now += 5 * 60000;
  assert.deepEqual(await read(), [A, B], 'the active account and one due account; the known-zero account waits');
  assert.match((await f.accounts.list()).accounts.find(row => row.id === B).quota.status, /stale|unavailable/);
  now += 60000;
  assert.deepEqual(await read(), [A], 'a failed account is not re-read every minute');
  offline.delete(B);
  now += 4 * 60000;
  assert.deepEqual(await read(), [A, B], 'the failed account is retried on the background cadence');
  assert.equal((await f.accounts.list()).accounts.find(row => row.id === B).quota.status, 'ready');
  assert.deepEqual(f.calls.activate, [], 'background reads never switch the login');
});

test('a background read never overlaps a login that starts while usage() is reading the active account', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    inflight = 0,
    overlapped = false,
    release;
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: () =>
      authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{key: 'five_hour', remainingPercent: 50, resetsAt: (now + 3600000) / 1000}]
      })
  });
  for (const id of [B, A]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  now += 5 * 60000;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const read = f.vault.queryQuota,
    prepare = f.vault.prepareLogin;
  f.vault.queryQuota = async id => {
    inflight++;
    try {
      if (id === A) await gate;
      else await new Promise(resolve => setTimeout(resolve, 20));
      return await read(id);
    } finally {
      inflight--;
    }
  };
  f.vault.prepareLogin = async () => {
    if (inflight) overlapped = true;
    return prepare();
  };
  const usage = f.accounts.usage();
  await eventually(() => inflight === 1);
  const login = f.accounts.startLogin();
  release();
  await Promise.all([usage, login]);
  await f.accounts.idle();
  assert.equal(f.calls.prepareLogin, 1);
  assert.equal(overlapped, false, 'the login started during the active read; the background read must not start');
});

test('only one background read of another account runs at a time', async () => {
  let now = Date.parse('2026-10-03T12:00:00Z'),
    release;
  const reads = [];
  const f = await fixture({
    identity: {accountId: A, email},
    clock: () => now,
    statusFor: account => {
      reads.push(account.accountId);
      return authStatus({
        status: 'ready',
        checkedAt: new Date(now).toISOString(),
        windows: [{key: 'five_hour', remainingPercent: 50, resetsAt: (now + 3600000) / 1000}]
      });
    }
  });
  for (const id of [B, D, A]) {
    f.current = {accountId: id, email};
    await f.accounts.capture();
  }
  now += 5 * 60000;
  await f.accounts.usage();
  await f.accounts.idle();
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const read = f.vault.queryQuota;
  f.vault.queryQuota = async id => {
    if (id === D) await gate;
    return read(id);
  };
  reads.length = 0;
  await f.accounts.usage();
  assert.deepEqual(reads, [], 'D is being read in the background');
  // B is due again while D's read is still running; it waits for the next call instead of starting alongside.
  now += 5 * 60000;
  await f.accounts.usage();
  assert.deepEqual(reads, [A]);
  release();
  await f.accounts.idle();
  assert.deepEqual(reads, [A, D]);
  await f.accounts.usage();
  await f.accounts.idle();
  assert.deepEqual(reads, [A, D, B]);
});
