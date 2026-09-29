import net from 'node:net';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_CHUNK_BYTES, MAX_FRAME_BYTES } from './sandboxie-process.mjs';

function protocolError(message, code = 'ERR_SANDBOXIE_PROTOCOL') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function frameBuffer(frame) {
  const bytes = Buffer.from(JSON.stringify(frame));
  if (bytes.length > MAX_FRAME_BYTES) throw protocolError('Frame exceeds configured maximum', 'ERR_SANDBOXIE_FRAME_TOO_LARGE');
  return Buffer.concat([bytes, Buffer.from('\n')]);
}

function writeFrame(socket, frame) {
  const bytes = frameBuffer(frame);
  return new Promise((resolve, reject) => {
    if (socket.destroyed) return reject(protocolError('Pipe is closed', 'ERR_SANDBOXIE_PIPE_DISCONNECTED'));
    socket.write(bytes, (error) => error ? reject(error) : resolve());
  });
}

async function* readFrames(socket) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of socket) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const index = buffer.indexOf(10);
      if (index < 0) {
        if (buffer.length > MAX_FRAME_BYTES) throw protocolError('Frame exceeds configured maximum', 'ERR_SANDBOXIE_FRAME_TOO_LARGE');
        break;
      }
      if (index > MAX_FRAME_BYTES) throw protocolError('Frame exceeds configured maximum', 'ERR_SANDBOXIE_FRAME_TOO_LARGE');
      const line = buffer.subarray(0, index);
      buffer = buffer.subarray(index + 1);
      try { yield JSON.parse(line.toString('utf8')); }
      catch (error) {
        if (error instanceof SyntaxError) throw protocolError('Malformed JSON frame');
        throw error;
      }
    }
  }
  if (buffer.length) throw protocolError('Incomplete final frame');
}

async function forward(stream, socket, channel) {
  for await (const sourceChunk of stream) {
    const chunk = Buffer.from(sourceChunk);
    for (let offset = 0; offset < chunk.length; offset += DATA_CHUNK_BYTES) {
      await writeFrame(socket, { type: 'data', channel, data: chunk.subarray(offset, offset + DATA_CHUNK_BYTES).toString('base64') });
    }
  }
}

function waitForDrain(writable) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      writable.off('drain', onDrain);
      writable.off('error', onError);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    writable.once('drain', onDrain);
    writable.once('error', onError);
  });
}

/**
 * Pipe endpoint started only by the configured Sandboxie launcher. It accepts one
 * authenticated launch frame, then only stdin data/end frames; it never evaluates
 * commands received after launch.
 */
export async function runBridge({ pipePath, nonce, spawnImpl = nodeSpawn } = {}) {
  if (typeof pipePath !== 'string' || !pipePath || typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce)) {
    throw new TypeError('pipePath and a 64-character hex nonce are required');
  }
  const socket = net.createConnection(pipePath);
  let child = null;
  let authenticated = false;
  let launched = false;
  let stdinEnded = false;
  let spawnObserved = false;
  let childClosed = false;
  let failureSent = false;
  let outputJobs;

  const send = (frame) => writeFrame(socket, frame);
  const fail = async (error) => {
    if (failureSent) return;
    failureSent = true;
    try { await send({ type: 'error', code: error.code || 'ERR_SANDBOXIE_BRIDGE', message: error.message, spawned: spawnObserved }); } catch {}
    child?.kill();
    socket.destroy();
  };

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  await send({ type: 'hello', nonce });

  const launch = (frame) => {
    if (launched || frame.type !== 'launch' || frame.nonce !== nonce || typeof frame.command !== 'string' ||
        !Array.isArray(frame.args) || frame.args.some((arg) => typeof arg !== 'string') ||
        !(frame.env && typeof frame.env === 'object' && !Array.isArray(frame.env)) ||
        Object.values(frame.env).some((value) => typeof value !== 'string') ||
        (frame.cwd !== null && typeof frame.cwd !== 'string')) {
      throw protocolError('Invalid or repeated launch frame', 'ERR_SANDBOXIE_AUTH');
    }
    authenticated = true;
    launched = true;
    child = spawnImpl(frame.command, frame.args, {
      cwd: frame.cwd ?? undefined,
      env: { ...frame.env },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.once('error', (error) => { void fail(error); });
    child.once('error', (error) => { void fail(error); });
    child.once('spawn', () => { spawnObserved = true; void send({ type: 'spawn' }).catch((error) => fail(error)); });
    outputJobs = [forward(child.stdout, socket, 'stdout'), forward(child.stderr, socket, 'stderr')];
    for (const job of outputJobs) job.catch((error) => { void fail(error); });
    child.once('close', (code, signal) => {
      childClosed = true;
      void (async () => {
        try {
          await Promise.all(outputJobs);
          await send({ type: 'exit', code: Number.isInteger(code) ? code : null, signal: signal ?? null });
        } catch (error) { await fail(error); }
        finally { socket.end(); }
      })();
    });
  };

  try {
    for await (const frame of readFrames(socket)) {
      if (!authenticated) {
        launch(frame);
        continue;
      }
      if (frame.type === 'data' && frame.channel === 'stdin' && typeof frame.data === 'string' && !stdinEnded) {
        const bytes = Buffer.from(frame.data, 'base64');
        if (bytes.toString('base64') !== frame.data || bytes.length > DATA_CHUNK_BYTES) throw protocolError('Invalid stdin data frame');
        if (!child.stdin.write(bytes)) await waitForDrain(child.stdin);
        continue;
      }
      if (frame.type === 'stdin-end' && !stdinEnded) {
        stdinEnded = true;
        child.stdin.end();
        continue;
      }
      throw protocolError('Unexpected frame received by bridge');
    }
  } catch (error) {
    await fail(error);
  } finally {
    if (child && !childClosed) child.kill();
    socket.destroy();
  }
  return { authenticated, child };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runBridge({ pipePath: process.argv[2], nonce: process.argv[3] }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
