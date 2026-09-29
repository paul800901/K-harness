import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';

const leases = new Map();
const MAX_FRAME_BYTES = 1024 * 1024;
const DATA_CHUNK_BYTES = 48 * 1024;

function fail(message, code = 'ERR_SANDBOXIE_PROCESS') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function minimalLauncherEnv(source = process.env) {
  const result = {};
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (typeof source[name] === 'string') result[name] = source[name];
  }
  return result;
}

function validEnv(env) {
  return env && typeof env === 'object' && !Array.isArray(env) &&
    Object.entries(env).every(([key, value]) => key.length > 0 && !key.includes('=') && typeof value === 'string');
}

function isAbsolutePath(value) {
  return typeof value === 'string' && (path.isAbsolute(value) || path.win32.isAbsolute(value));
}

function encodeFrame(frame, limit = MAX_FRAME_BYTES) {
  const data = Buffer.from(JSON.stringify(frame));
  if (data.length > limit) throw fail('Sandboxie bridge frame exceeds limit', 'ERR_SANDBOXIE_FRAME_TOO_LARGE');
  return Buffer.concat([data, Buffer.from('\n')]);
}

function makePipeServer(pipePrefix) {
  if (process.platform === 'win32') {
    const suffix = randomBytes(18).toString('hex');
    return { server: net.createServer(), path: `\\\\.\\pipe\\${pipePrefix}${suffix}` };
  }
  // Linux abstract sockets avoid residue; other POSIX platforms use a unique temp path.
  const suffix = randomBytes(18).toString('hex');
  const localPath = process.platform === 'linux'
    ? `\0${pipePrefix}${suffix}`
    : path.join(tmpdir(), `${pipePrefix}${suffix}.sock`);
  return { server: net.createServer(), path: localPath };
}

export function createSandboxieSpawn({
  boxName,
  startExe,
  nodeExecutable,
  bridgePath,
  stopBox,
  launch = (details) => nodeSpawn(details.file, details.args, { cwd: details.cwd, env: details.env, windowsHide: true, stdio: 'ignore', shell: false }),
  pipePrefix = 'KHarnessAgent_',
  startupTimeoutMs = 15_000,
  maxFrameBytes = MAX_FRAME_BYTES,
  launcherEnv = process.env,
  prepareLaunch,
} = {}) {
  if (typeof boxName !== 'string' || boxName.length > 32 || !/^[A-Za-z0-9_]+$/.test(boxName) || boxName.toLowerCase() === 'defaultbox' ||
      !isAbsolutePath(startExe) || !isAbsolutePath(nodeExecutable) || !isAbsolutePath(bridgePath) || typeof stopBox !== 'function') {
    throw new TypeError('boxName, startExe, nodeExecutable, bridgePath, and stopBox are required');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(pipePrefix)) throw new TypeError('pipePrefix contains unsafe characters');
  if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 1024 || maxFrameBytes > MAX_FRAME_BYTES) throw new TypeError('maxFrameBytes must be between 1024 and 1 MiB');
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) throw new TypeError('startupTimeoutMs must be positive');
  const leaseKey = boxName.toLowerCase();

  return function spawnImpl(command, args = [], options = {}) {
    if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new TypeError('command and string args are required');
    }
    if (!validEnv(options.env)) throw new TypeError('options.env must be explicitly supplied as a string-valued object');
    if (options.cwd != null && typeof options.cwd !== 'string') throw new TypeError('options.cwd must be a string');
    if (options.shell !== undefined && options.shell !== false) throw new TypeError('options.shell must be false or omitted');
    if (leases.has(leaseKey)) throw fail(`Sandboxie box ${boxName} is already leased`, 'ERR_SANDBOXIE_BOX_BUSY');

    const lease = { boxName, released: false };
    leases.set(leaseKey, lease);
    const { server, path: pipePath } = makePipeServer(pipePrefix);
    const nonce = randomBytes(32).toString('hex');
    const child = new EventEmitter();
    child.pid = undefined;
    child.exitCode = null;
    child.signalCode = null;
    child.stdin = new Writable({
      write(chunk, encoding, callback) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        state.ready.then(() => sendData('stdin', bytes)).then(() => callback(), callback);
      },
      final(callback) { state.ready.then(() => sendFrame({ type: 'stdin-end' })).then(() => callback(), callback); },
    });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.terminate = terminate;
    child.kill = () => { void terminate('cancelled').catch(() => {}); return true; };

    const state = {
      socket: null, launcher: null, authenticated: false, childSpawned: false, exitFrame: null, settled: false,
      terminating: null, buffer: Buffer.alloc(0), faulting: false, readPaused: false,
    };
    state.ready = new Promise((resolve, reject) => { state.resolveReady = resolve; state.rejectReady = reject; });
    state.ready.catch(() => {});
    let startupTimer;

    const releaseLease = () => {
      if (!lease.released) {
        lease.released = true;
        if (leases.get(leaseKey) === lease) leases.delete(leaseKey);
      }
    };
    function sendFrame(frame) {
      if (!state.socket || state.socket.destroyed) return Promise.reject(fail('Sandboxie pipe is disconnected', 'ERR_SANDBOXIE_PIPE_DISCONNECTED'));
      let packet;
      try { packet = encodeFrame(frame, maxFrameBytes); } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        state.socket.write(packet, (error) => error ? reject(error) : resolve());
      });
    }
    async function sendData(channel, bytes) {
      for (let offset = 0; offset < bytes.length; offset += DATA_CHUNK_BYTES) {
        await sendFrame({ type: 'data', channel, data: bytes.subarray(offset, offset + DATA_CHUNK_BYTES).toString('base64') });
      }
    }
    function closeTransport() {
      state.socket?.destroy();
      if (server.listening) {
        try { server.close(); } catch {}
      }
    }
    async function stopAndSettle({ code = null, signal = null, reason = 'finished', error } = {}) {
      if (state.terminating) return state.terminating;
      const settling = (async () => {
        clearTimeout(startupTimer);
        state.rejectReady?.(error || fail(`Sandboxie startup ended: ${reason}`, 'ERR_SANDBOXIE_STARTUP_ABORTED'));
        if (error) emitError(error);
        try {
          // A policy update owns the lease too. Do not recycle the box while
          // preparation is still changing its next launch's workspace.
          await state.preparing?.catch(() => {});
          const confirmation = await stopBox({ boxName, reason, code, signal });
          if (confirmation !== true && confirmation?.confirmed !== true) {
            const stopError = fail(`Sandboxie termination of ${boxName} was not confirmed`, 'ERR_SANDBOXIE_STOP_UNCONFIRMED');
            emitError(stopError);
            closeTransport();
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
            throw stopError;
          }
          state.settled = true;
          releaseLease();
          child.exitCode = code;
          child.signalCode = signal;
          child.stdin.destroy();
          child.stdout.end();
          child.stderr.end();
          if ((state.childSpawned || reason === 'cancelled') && !state.exitEmitted) {
            state.exitEmitted = true;
            child.emit('exit', code, signal);
          }
          child.emit('close', code, signal);
          child.emit('settledclose', { code, signal, reason });
          closeTransport();
          return { confirmed: true };
        } catch (stopError) {
          emitError(stopError);
          closeTransport();
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          throw stopError;
        }
      })();
      state.terminating = settling;
      try { return await settling; }
      catch (error) { state.terminating = null; throw error; }
    }
    function terminate(reason = 'cancelled') {
      if (state.settled) return Promise.resolve({ confirmed: true });
      if (state.exitFrame) {
        return stopAndSettle({ code: state.exitFrame.code, signal: state.exitFrame.signal ?? null, reason: 'child-exit' });
      }
      return stopAndSettle({ code: null, signal: reason === 'cancelled' ? 'SIGTERM' : null, reason });
    }
    function emitError(error) {
      if (state.errorEmitted && state.errorEmitted === error) return;
      state.errorEmitted = error;
      try { child.emit('error', error instanceof Error ? error : fail(String(error))); } catch {}
    }
    async function protocolFault(error) {
      if (state.faulting || state.settled) return;
      state.faulting = true;
      emitError(error);
      try { await stopAndSettle({ reason: 'protocol-error', error }); } catch {}
      closeTransport();
    }
    function parseFrames() {
      for (;;) {
        if (state.readPaused) return;
        const index = state.buffer.indexOf(10);
        if (index < 0) {
          if (state.buffer.length > maxFrameBytes) void protocolFault(fail('Sandboxie bridge frame exceeds limit', 'ERR_SANDBOXIE_FRAME_TOO_LARGE'));
          return;
        }
        if (index > maxFrameBytes) { void protocolFault(fail('Sandboxie bridge frame exceeds limit', 'ERR_SANDBOXIE_FRAME_TOO_LARGE')); return; }
        const line = state.buffer.subarray(0, index);
        state.buffer = state.buffer.subarray(index + 1);
        let frame;
        try { frame = JSON.parse(line.toString('utf8')); }
        catch { void protocolFault(fail('Invalid Sandboxie bridge frame', 'ERR_SANDBOXIE_PROTOCOL')); return; }
        if (!state.authenticated) {
          if (frame.type !== 'hello' || frame.nonce !== nonce) { void protocolFault(fail('Sandboxie bridge authentication failed', 'ERR_SANDBOXIE_AUTH')); return; }
          state.authenticated = true;
          state.resolveReady();
          child.emit('connected');
          void sendFrame({ type: 'launch', nonce, command, args, cwd: options.cwd ?? null, env: options.env }).catch((error) => protocolFault(error));
          continue;
        }
        if (frame.type === 'spawn') {
          if (state.childSpawned || state.exitFrame) { void protocolFault(fail('Repeated or late spawn frame', 'ERR_SANDBOXIE_PROTOCOL')); return; }
          state.childSpawned = true;
          clearTimeout(startupTimer);
          child.emit('spawn');
          continue;
        }
        if (state.exitFrame) { void protocolFault(fail('Frame received after child exit', 'ERR_SANDBOXIE_PROTOCOL')); return; }
        if (frame.type === 'data' && (frame.channel === 'stdout' || frame.channel === 'stderr') && typeof frame.data === 'string') {
          const buffer = Buffer.from(frame.data, 'base64');
          if (buffer.toString('base64') !== frame.data || buffer.length > DATA_CHUNK_BYTES) { void protocolFault(fail('Invalid Sandboxie binary frame', 'ERR_SANDBOXIE_PROTOCOL')); return; }
          const stream = frame.channel === 'stdout' ? child.stdout : child.stderr;
          if (!stream.write(buffer)) {
            state.socket.pause();
            state.readPaused = true;
            stream.once('drain', () => {
              state.readPaused = false;
              parseFrames();
              if (!state.readPaused) state.socket?.resume();
            });
          }
          if (state.readPaused) return;
          continue;
        }
        if (frame.type === 'exit' && state.childSpawned && !state.exitFrame && (frame.code === null || Number.isInteger(frame.code)) &&
            (frame.signal == null || typeof frame.signal === 'string')) {
          state.exitFrame = frame;
          void stopAndSettle({ code: frame.code, signal: frame.signal ?? null, reason: 'child-exit' }).catch(() => {});
          continue;
        }
        if (frame.type === 'error' && typeof frame.message === 'string') {
          const error = fail(frame.message, frame.code || 'ERR_SANDBOXIE_CHILD');
          void protocolFault(error);
          continue;
        }
        void protocolFault(fail('Unexpected Sandboxie bridge frame', 'ERR_SANDBOXIE_PROTOCOL'));
        return;
      }
    }

    server.on('connection', (socket) => {
      if (state.socket) { socket.destroy(); return; }
      state.socket = socket;
      socket.on('data', (chunk) => { state.buffer = Buffer.concat([state.buffer, chunk]); parseFrames(); });
      // Stopping the box closes its bridge before stopBox confirms termination.
      // That transport loss is expected; stopAndSettle still reports stop failures.
      socket.once('error', (error) => { if (!state.settled && !state.terminating) void protocolFault(fail(`Sandboxie pipe error: ${error.message}`, 'ERR_SANDBOXIE_PIPE')); });
      socket.once('close', () => { if (!state.settled && !state.terminating && !state.exitFrame) void protocolFault(fail('Sandboxie pipe disconnected unexpectedly', 'ERR_SANDBOXIE_PIPE_DISCONNECTED')); });
    });
    server.once('error', (error) => { void protocolFault(error); });
    server.listen(pipePath, async () => {
      if (state.settled || state.terminating) return;
      try {
        if (prepareLaunch) {
          state.preparing = Promise.resolve().then(() => prepareLaunch({ boxName, cwd: options.cwd }));
          await state.preparing;
        }
      } catch (error) { void protocolFault(error); return; }
      if (state.settled || state.terminating) return;
      startupTimer = setTimeout(() => { void protocolFault(fail('Sandboxie bridge startup timed out', 'ERR_SANDBOXIE_STARTUP_TIMEOUT')); }, startupTimeoutMs);
      const startArgs = [`/box:${boxName}`, '/wait', '/hide_window', nodeExecutable, bridgePath, pipePath, nonce];
      try {
        state.launcher = launch({ file: startExe, args: startArgs, env: minimalLauncherEnv(launcherEnv), cwd: undefined, windowsHide: true });
        if (state.launcher && typeof state.launcher.once === 'function') {
          state.launcher.once('error', (error) => { if (!state.authenticated) void protocolFault(fail(`Sandboxie launcher failed: ${error.message}`, 'ERR_SANDBOXIE_LAUNCHER')); });
          state.launcher.once('close', (code, signal) => {
            if (!state.authenticated && !state.settled) void protocolFault(fail(`Sandboxie launcher exited before bridge handshake (${code ?? signal ?? 'unknown'})`, 'ERR_SANDBOXIE_LAUNCHER_EARLY_EXIT'));
          });
        }
      } catch (error) { void protocolFault(fail(`Sandboxie launcher failed: ${error.message}`, 'ERR_SANDBOXIE_LAUNCHER')); }
    });

    const disposeServer = () => { if (server.listening) server.close(); };
    child.once('settledclose', disposeServer);
    return child;
  };
}

export { MAX_FRAME_BYTES, DATA_CHUNK_BYTES };
