import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSandboxiePool } from '../src/sandboxie-pool.mjs';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(boxNames = ['Catalog', 'Login', 'Main', 'Luna'], { idleError } = {}) {
  const children = [];
  const idleCalls = [];
  const factoryCalls = [];
  const env = { SystemRoot: 'C:\\Windows' };
  const poolPromise = createSandboxiePool({ startExe: 'C:\\Sandboxie\\Start.exe', nodeExecutable: 'C:\\Node\\node.exe',
    bridgePath: 'C:\\K-harness\\bridge.mjs', boxNames, env,
    controlFactory({ boxName, ...options }) {
      return {
        async assertIdle() { idleCalls.push(boxName); if (idleError === boxName) throw new Error(`${boxName} busy before pool start`); },
        async stopBox(info) { factoryCalls.push({ type: 'stop', boxName, info }); return { confirmed: true }; },
      };
    },
    runnerFactory(options) {
      factoryCalls.push({ type: 'runner', ...options });
      return (command, args, spawnOptions) => {
        const child = new EventEmitter();
        child.stdin = {}; child.stdout = {}; child.stderr = {};
        child.terminate = async (reason) => {
          child.terminateCalls = (child.terminateCalls ?? 0) + 1;
          if (child.terminateImpl) return child.terminateImpl(reason);
          child.emit('close', 0, null);
          return { confirmed: true };
        };
        child.launch = { command, args, spawnOptions };
        children.push({ boxName: options.boxName, child });
        return child;
      };
    },
  });
  return { poolPromise, children, idleCalls, factoryCalls, env };
}

test('pool checks every dedicated box before returning and creates isolated runner per box', async () => {
  const h = harness(['Catalog', 'Login']);
  const pool = await h.poolPromise;
  assert.deepEqual(h.idleCalls.sort(), ['Catalog', 'Login']);
  assert.deepEqual(h.factoryCalls.filter((entry) => entry.type === 'runner').map((entry) => entry.boxName), ['Catalog', 'Login']);
  for (const call of h.factoryCalls.filter((entry) => entry.type === 'runner')) {
    assert.equal(call.startExe, 'C:\\Sandboxie\\Start.exe');
    assert.equal(call.nodeExecutable, 'C:\\Node\\node.exe');
    assert.equal(call.bridgePath, 'C:\\K-harness\\bridge.mjs');
    assert.equal(call.launcherEnv, h.env);
    assert.equal(typeof call.stopBox, 'function');
  }
  await pool.close();
});

test('case-insensitive duplicate box names are rejected', async () => {
  await assert.rejects(createSandboxiePool({ boxNames: ['Main', 'main'], env: {}, startExe: 'x', nodeExecutable: 'n', bridgePath: 'b' }), /Duplicate Sandboxie box/);
});

test('pool rejects startup when any configured box is busy', async () => {
  const h = harness(['Catalog', 'Main'], { idleError: 'Main' });
  await assert.rejects(h.poolPromise, /Main busy before pool start/);
  assert.deepEqual(h.idleCalls.sort(), ['Catalog', 'Main']);
});

test('spawn allocates different boxes, refuses exhaustion, preserves child identity, and only close frees a slot', async () => {
  const h = harness(['Main', 'Luna']); const pool = await h.poolPromise;
  const first = pool.spawnImpl('node.exe', ['catalog'], { env: {} });
  const second = pool.spawnImpl('node.exe', ['login'], { env: {} });
  assert.notEqual(first, second);
  assert.deepEqual(pool.boxes, [{ boxName: 'Main', busy: true }, { boxName: 'Luna', busy: true }]);
  assert.throws(() => pool.spawnImpl('node.exe', [], { env: {} }), { code: 'ERR_SANDBOXIE_POOL_BUSY' });
  first.emit('error', new Error('test runner error'));
  assert.equal(pool.boxes[0].busy, true, 'error alone must retain the lease');
  first.emit('close', 1, null);
  assert.equal(pool.boxes[0].busy, false);
  const third = pool.spawnImpl('node.exe', ['main'], { env: {} });
  assert.equal(h.children.at(-1).boxName, 'Main');
  third.emit('close', 0, null); second.emit('close', 0, null);
  await pool.close();
});

test('pool close waits for confirmed termination and close events on all active boxes', async () => {
  const h = harness(['Main', 'Luna']); const pool = await h.poolPromise;
  const first = pool.spawnImpl('node.exe', [], { env: {} });
  const second = pool.spawnImpl('node.exe', [], { env: {} });
  const firstStop = deferred(); const secondStop = deferred();
  first.terminateImpl = () => firstStop.promise;
  second.terminateImpl = () => secondStop.promise;
  let done = false;
  const closing = pool.close().then(() => { done = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  first.emit('close', null, 'SIGTERM'); firstStop.resolve({ confirmed: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false, 'pool must still wait for the other box');
  second.emit('close', null, 'SIGTERM'); secondStop.resolve({ confirmed: true });
  await closing;
  assert.deepEqual(pool.boxes.map((box) => box.busy), [false, false]);
  assert.throws(() => pool.spawnImpl('node.exe', [], { env: {} }), { code: 'ERR_SANDBOXIE_POOL_BUSY' });
});

test('failed or unconfirmed termination rejects close and leaves the box reserved', async () => {
  const h = harness(['Main']); const pool = await h.poolPromise;
  const child = pool.spawnImpl('node.exe', [], { env: {} });
  child.terminateImpl = async () => { throw new Error('stop not confirmed'); };
  await assert.rejects(pool.close(), /pool close failed/u);
  assert.deepEqual(pool.boxes, [{ boxName: 'Main', busy: true }]);
  assert.throws(() => pool.spawnImpl('node.exe', [], { env: {} }), { code: 'ERR_SANDBOXIE_POOL_BUSY' });
});
