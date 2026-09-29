import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { runBridge } from '../src/sandboxie-stdio-bridge.mjs';
import { createSandboxieSpawn } from '../src/sandboxie-process.mjs';

function waitFor(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.once(event, (...args) => resolve(args));
    emitter.once('error', reject);
  });
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

function factoryOptions(overrides = {}) {
  return {
    boxName: 'KTestBox', startExe: process.execPath, nodeExecutable: process.execPath,
    bridgePath: fileURLToPath(new URL('../src/sandboxie-stdio-bridge.mjs', import.meta.url)),
    stopBox: async () => ({ confirmed: true }), ...overrides,
  };
}

function readLine(socket) {
  let buffer = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const index = buffer.indexOf(10);
      if (index < 0) return;
      socket.off('data', onData);
      try { resolve(JSON.parse(buffer.subarray(0, index).toString('utf8'))); }
      catch (error) { reject(error); }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

function sendLine(socket, frame) { socket.write(`${JSON.stringify(frame)}\n`); }

test('Sandboxie adapter handshakes over a local pipe and preserves binary stdio', async () => {
  let launchDetails;
  let launched;
  let childProcess;
  let receivedLaunch;
  const stopCalls = [];
  const spawn = createSandboxieSpawn(factoryOptions({
    launcherEnv: { SystemRoot: 'C:\\Windows', USERPROFILE: 'must-not-leak', API_KEY: 'secret' },
    stopBox: async (request) => { stopCalls.push(request); return { confirmed: true }; },
    launch: (details) => {
      launchDetails = details;
      launched = runBridge({
        pipePath: details.args[5], nonce: details.args[6],
        spawnImpl: (command, args, options) => {
          receivedLaunch = { command, args, options };
          childProcess = fakeChild();
          childProcess.stdin.on('data', (bytes) => {
            childProcess.stdout.write(Buffer.from([0x00, 0xff, ...bytes]));
            childProcess.stderr.write(Buffer.from([0xfe]));
          });
          childProcess.stdin.once('end', () => {
            childProcess.stdout.end();
            childProcess.stderr.end();
            childProcess.emit('close', 0, null);
          });
          process.nextTick(() => childProcess.emit('spawn'));
          return childProcess;
        },
      });
      return new EventEmitter();
    },
  }));

  const wrapper = spawn('worker.exe', ['--literal', 'arg'], { cwd: 'C:\\work', env: { ONLY: 'provided' } });
  const stdout = [];
  const stderr = [];
  wrapper.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  wrapper.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const spawned = waitFor(wrapper, 'spawn');
  const settled = waitFor(wrapper, 'settledclose');
  wrapper.stdin.write(Buffer.from([0x80, 0x81]));
  wrapper.stdin.end();
  await spawned;
  assert.equal(wrapper.pid, undefined);
  assert.equal(wrapper.exitCode, null);
  assert.deepEqual(launchDetails.args.slice(0, 3), ['/box:KTestBox', '/wait', '/hide_window']);
  assert.deepEqual(Object.keys(launchDetails.env).sort(), ['SystemRoot']);
  assert.deepEqual(receivedLaunch, {
    command: 'worker.exe', args: ['--literal', 'arg'],
    options: { cwd: 'C:\\work', env: { ONLY: 'provided' }, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  });
  const [settledInfo] = await settled;
  await launched;
  assert.deepEqual(Buffer.concat(stdout), Buffer.from([0, 255, 0x80, 0x81]));
  assert.deepEqual(Buffer.concat(stderr), Buffer.from([0xfe]));
  assert.deepEqual(settledInfo, { code: 0, signal: null, reason: 'child-exit' });
  assert.equal(wrapper.exitCode, 0);
  assert.equal(wrapper.signalCode, null);
  assert.equal(stopCalls.length, 1);
  assert.equal(stopCalls[0].boxName, 'KTestBox');
});

test('adapter requires explicit environment and fails closed while a box lease is held', async () => {
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KLeaseBox',
    stopBox: async () => ({ confirmed: true }),
    launch: () => new EventEmitter(), startupTimeoutMs: 20,
  }));
  assert.throws(() => spawn('worker.exe', [], {}), /options\.env/);
  const wrapper = spawn('worker.exe', [], { env: {} });
  assert.throws(() => spawn('worker.exe', [], { env: {} }), { code: 'ERR_SANDBOXIE_BOX_BUSY' });
  assert.throws(() => spawn('worker.exe', [], { env: {}, shell: 'cmd.exe' }), /shell/);
  const settled = new Promise((resolve) => wrapper.once('settledclose', resolve));
  const startupError = new Promise((resolve) => wrapper.once('error', resolve));
  const error = await startupError;
  const info = await settled;
  assert.equal(error.code, 'ERR_SANDBOXIE_STARTUP_TIMEOUT');
  assert.equal(info.reason, 'protocol-error');
});

test('hello without real spawn remains under startup timeout and stops the box', async () => {
  let pipe;
  const stopped = [];
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KHelloTimeout', startupTimeoutMs: 30,
    stopBox: async (request) => { stopped.push(request); return { confirmed: true }; },
    launch: (details) => {
      pipe = net.createConnection(details.args[5]);
      pipe.once('connect', () => sendLine(pipe, { type: 'hello', nonce: details.args[6] }));
      pipe.on('error', () => {});
      return new EventEmitter();
    },
  }));
  const wrapper = spawn('worker', [], { env: {} });
  const errors = [];
  wrapper.on('error', (error) => errors.push(error.code));
  const settled = new Promise((resolve) => wrapper.once('settledclose', resolve));
  const info = await settled;
  assert.ok(errors.includes('ERR_SANDBOXIE_STARTUP_TIMEOUT'));
  assert.equal(info.reason, 'protocol-error');
  assert.equal(stopped.length, 1);
  assert.equal(wrapper.exitCode, null);
  assert.equal(wrapper.signalCode, null);
});

test('pipe disconnect before authentication terminates the whole box', async () => {
  const stopped = [];
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KDisconnect',
    stopBox: async (request) => { stopped.push(request); return { confirmed: true }; },
    launch: (details) => {
      const pipe = net.createConnection(details.args[5]);
      pipe.once('connect', () => pipe.destroy());
      pipe.on('error', () => {});
      return new EventEmitter();
    },
  }));
  const wrapper = spawn('worker', [], { env: {} });
  const error = new Promise((resolve) => wrapper.once('error', resolve));
  const settled = new Promise((resolve) => wrapper.once('settledclose', resolve));
  assert.equal((await error).code, 'ERR_SANDBOXIE_PIPE_DISCONNECTED');
  assert.equal((await settled).reason, 'protocol-error');
  assert.equal(stopped.length, 1);
});

test('launcher exit before authenticated bridge connection fails immediately', async () => {
  const stopped = [];
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KEarlyLauncherExit', startupTimeoutMs: 5000,
    stopBox: async (request) => { stopped.push(request); return { confirmed: true }; },
    launch: () => {
      const launcher = new EventEmitter();
      process.nextTick(() => launcher.emit('close', 17, null));
      return launcher;
    },
  }));
  const wrapper = spawn('worker', [], { env: {} });
  const error = new Promise((resolve) => wrapper.once('error', resolve));
  const settled = new Promise((resolve) => wrapper.once('settledclose', resolve));
  assert.equal((await error).code, 'ERR_SANDBOXIE_LAUNCHER_EARLY_EXIT');
  assert.equal((await settled).reason, 'protocol-error');
  assert.equal(stopped.length, 1);
});

test('immediate cancellation stops before launcher starts and emits settled lifecycle', async () => {
  let launchCount = 0;
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KImmediateCancel', launch: () => { launchCount++; return new EventEmitter(); },
  }));
  const wrapper = spawn('worker', [], { env: {} });
  const settled = new Promise((resolve) => wrapper.once('settledclose', resolve));
  const termination = await wrapper.terminate();
  assert.deepEqual(termination, { confirmed: true });
  assert.deepEqual(await settled, { code: null, signal: 'SIGTERM', reason: 'cancelled' });
  assert.equal(wrapper.exitCode, null);
  assert.equal(wrapper.signalCode, 'SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launchCount, 0);
});

test('unconfirmed stop rejects terminate, emits no close, and retains the box lease', async () => {
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KStopFail', startupTimeoutMs: 20,
    stopBox: async () => ({ confirmed: false }),
    launch: () => new EventEmitter(),
  }));
  const wrapper = spawn('worker', [], { env: {} });
  const errors = [];
  let didClose = false;
  wrapper.on('error', (error) => errors.push(error.code));
  wrapper.once('close', () => { didClose = true; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(errors.includes('ERR_SANDBOXIE_STOP_UNCONFIRMED'));
  assert.equal(didClose, false);
  await assert.rejects(wrapper.terminate(), { code: 'ERR_SANDBOXIE_STOP_UNCONFIRMED' });
  assert.throws(() => spawn('worker', [], { env: {} }), { code: 'ERR_SANDBOXIE_BOX_BUSY' });
});

test('duplicate spawn frame is a protocol fault and box termination is confirmed before close', async () => {
  let fakePipe;
  let stopped;
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KRepeatedFrame',
    stopBox: async (request) => { stopped = request; return { confirmed: true }; },
    launch: (details) => {
      fakePipe = new Promise((resolve) => {
        const pipe = net.createConnection(details.args[5]);
        pipe.on('error', () => {});
        pipe.once('connect', async () => {
          sendLine(pipe, { type: 'hello', nonce: details.args[6] });
          await readLine(pipe); // launch config
          sendLine(pipe, { type: 'spawn' });
          sendLine(pipe, { type: 'spawn' });
          pipe.once('close', resolve);
        });
      });
      return new EventEmitter();
    },
  }));
  const wrapper = spawn('worker', [], { env: {} });
  let spawnCount = 0;
  wrapper.on('spawn', () => { spawnCount++; });
  const error = new Promise((resolve) => wrapper.once('error', resolve));
  const settled = new Promise((resolve) => wrapper.once('settledclose', resolve));
  assert.equal((await error).code, 'ERR_SANDBOXIE_PROTOCOL');
  assert.equal((await settled).reason, 'protocol-error');
  await fakePipe;
  assert.equal(spawnCount, 1);
  assert.equal(stopped.reason, 'protocol-error');
});

test('duplicate exit frame is rejected and close/exit wait for stop confirmation', async () => {
  let fakePipe;
  let confirmStop;
  let onStop;
  const stopStarted = new Promise((resolve) => { onStop = resolve; });
  const stopGate = new Promise((resolve) => { confirmStop = resolve; });
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KRepeatedExit',
    stopBox: async () => { onStop(); return stopGate; },
    launch: (details) => {
      fakePipe = new Promise((resolve) => {
        const pipe = net.createConnection(details.args[5]);
        pipe.on('error', () => {});
        pipe.once('connect', async () => {
          sendLine(pipe, { type: 'hello', nonce: details.args[6] });
          await readLine(pipe);
          sendLine(pipe, { type: 'spawn' });
          sendLine(pipe, { type: 'exit', code: 0, signal: null });
          sendLine(pipe, { type: 'exit', code: 0, signal: null });
          pipe.once('close', resolve);
        });
      });
      return new EventEmitter();
    },
  }));
  const wrapper = spawn('worker', [], { env: {} });
  const lifecycle = [];
  wrapper.on('exit', (...args) => lifecycle.push(['exit', ...args]));
  wrapper.on('close', (...args) => lifecycle.push(['close', ...args]));
  const protocolError = new Promise((resolve) => wrapper.once('error', resolve));
  const settled = new Promise((resolve) => wrapper.once('settledclose', resolve));
  await stopStarted;
  assert.equal((await protocolError).code, 'ERR_SANDBOXIE_PROTOCOL');
  assert.deepEqual(lifecycle, []);
  confirmStop({ confirmed: true });
  assert.equal((await settled).reason, 'child-exit');
  await fakePipe;
  assert.deepEqual(lifecycle, [['exit', 0, null], ['close', 0, null]]);
  assert.equal(wrapper.exitCode, 0);
});

test('natural exit stop failure is handled, retains lease, and can be retried', async () => {
  let fakePipe;
  let resolvePipe;
  const pipeReady = new Promise((resolve) => { resolvePipe = resolve; });
  let stopCalls = 0;
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KNaturalStopRetry',
    stopBox: async () => {
      stopCalls++;
      if (stopCalls === 1) throw new Error('simulated terminate verification failure');
      return { confirmed: true };
    },
    launch: (details) => {
      fakePipe = new Promise((resolve) => {
        const pipe = net.createConnection(details.args[5]);
        pipe.on('error', () => {});
        pipe.once('connect', async () => {
          sendLine(pipe, { type: 'hello', nonce: details.args[6] });
          await readLine(pipe);
          sendLine(pipe, { type: 'spawn' });
          sendLine(pipe, { type: 'exit', code: 23, signal: null });
          pipe.once('close', resolve);
        });
      });
      resolvePipe(fakePipe);
      return new EventEmitter();
    },
  }));
  try {
    const wrapper = spawn('worker', [], { env: {} });
    const errors = [];
    let didClose = false;
    wrapper.on('error', (error) => errors.push(error.message));
    wrapper.on('close', () => { didClose = true; });
    const naturalPipeClosed = await pipeReady;
    await naturalPipeClosed;
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(errors.includes('simulated terminate verification failure'));
    assert.equal(didClose, false);
    assert.equal(wrapper.exitCode, null);
    assert.throws(() => spawn('worker', [], { env: {} }), { code: 'ERR_SANDBOXIE_BOX_BUSY' });

    const settled = new Promise((resolve) => wrapper.once('settledclose', resolve));
    assert.deepEqual(await wrapper.terminate(), { confirmed: true });
    assert.deepEqual(await settled, { code: 23, signal: null, reason: 'child-exit' });
    assert.equal(wrapper.exitCode, 23);
    assert.equal(stopCalls, 2);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('configuration rejects unsafe box names, relative executables, and shell requests', () => {
  assert.throws(() => createSandboxieSpawn(factoryOptions({ boxName: 'DefaultBox' })), TypeError);
  assert.throws(() => createSandboxieSpawn(factoryOptions({ boxName: 'K-Bad' })), TypeError);
  assert.throws(() => createSandboxieSpawn(factoryOptions({ boxName: 'K'.repeat(33) })), TypeError);
  assert.throws(() => createSandboxieSpawn(factoryOptions({ bridgePath: 'relative.mjs' })), TypeError);
  const spawn = createSandboxieSpawn(factoryOptions({ boxName: 'KShellCheck' }));
  assert.throws(() => spawn('worker', [], { env: {}, shell: true }), /shell/);
});

test('box lease is case-insensitive like Sandboxie box names', async () => {
  const spawn = createSandboxieSpawn(factoryOptions({
    boxName: 'KCaseLease', startupTimeoutMs: 20,
    launch: () => new EventEmitter(),
  }));
  const wrapper = spawn('worker', [], { env: {} });
  wrapper.on('error', () => {});
  assert.throws(() => createSandboxieSpawn(factoryOptions({ boxName: 'kcaselease' }))('worker', [], { env: {} }), { code: 'ERR_SANDBOXIE_BOX_BUSY' });
  await new Promise((resolve) => wrapper.once('settledclose', resolve));
});

test('workspace preparation failure prevents launch and safely releases the box', async () => {
  let launches=0;
  const spawn=createSandboxieSpawn(factoryOptions({boxName:'KPrepReject',prepareLaunch:async()=>{throw Error('workspace denied');},launch:()=>{launches++;}}));
  const child=spawn('worker',[],{cwd:'C:\\fake',env:{}});const errors=[];
  child.on('error',e=>errors.push(e.message));
  await new Promise(resolve=>child.once('settledclose',resolve));
  assert.equal(launches,0);assert.ok(errors.includes('workspace denied'));
});

test('cancellation during workspace preparation retains lease until preparation settles and never launches', async () => {
  let enter,release;const entered=new Promise(r=>enter=r),hold=new Promise(r=>release=r);let launches=0,stops=0;
  const spawn=createSandboxieSpawn(factoryOptions({boxName:'KPrepCancel',prepareLaunch:async details=>{assert.equal(details.cwd,'C:\\fake');enter();await hold;},launch:()=>{launches++;},stopBox:async()=>{stops++;return {confirmed:true};}}));
  const child=spawn('worker',[],{cwd:'C:\\fake',env:{}});child.on('error',()=>{});
  await entered;const stopping=child.terminate();
  await new Promise(r=>setImmediate(r));assert.equal(stops,0);
  assert.throws(()=>spawn('worker',[],{env:{}}),{code:'ERR_SANDBOXIE_BOX_BUSY'});
  release();await stopping;assert.equal(launches,0);assert.equal(stops,1);
});

test('expected pipe disconnect during confirmed owner termination is not a process failure',async()=>{
 let pipe;const errors=[];
 const spawn=createSandboxieSpawn(factoryOptions({boxName:'KStopPipeRace',
  launch(details){pipe=net.connect(details.args[5]);pipe.once('connect',()=>sendLine(pipe,{type:'hello',nonce:details.args[6]}));void readLine(pipe).then(()=>sendLine(pipe,{type:'spawn'}));return new EventEmitter();},
  async stopBox(){pipe.destroy();await new Promise(r=>setTimeout(r,25));return {confirmed:true};}
 }));
 const child=spawn('fake.exe',[],{env:{}});child.on('error',e=>errors.push(e));await waitFor(child,'spawn');
 assert.deepEqual(await child.terminate(),{confirmed:true});assert.deepEqual(errors.map(e=>e.code),[]);
});

test('pipe disconnect during termination does not hide an unconfirmed stop',async()=>{
 let pipe;const errors=[];
 const spawn=createSandboxieSpawn(factoryOptions({boxName:'KStopPipeFailure',
  launch(details){pipe=net.connect(details.args[5]);pipe.once('connect',()=>sendLine(pipe,{type:'hello',nonce:details.args[6]}));void readLine(pipe).then(()=>sendLine(pipe,{type:'spawn'}));return new EventEmitter();},
  async stopBox(){pipe.destroy();await new Promise(r=>setTimeout(r,25));return {confirmed:false};}
 }));
 const child=spawn('fake.exe',[],{env:{}});child.on('error',e=>errors.push(e));await waitFor(child,'spawn');
 await assert.rejects(child.terminate(),{code:'ERR_SANDBOXIE_STOP_UNCONFIRMED'});
 assert.ok(errors.some(e=>e.code==='ERR_SANDBOXIE_STOP_UNCONFIRMED'));
});
