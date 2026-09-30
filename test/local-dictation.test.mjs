import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {request as httpRequest} from 'node:http';
import {PassThrough} from 'node:stream';
import {createLocalDictation, decodePcm16Mono16kWav, validatePcm16Mono16kWav, MAX_WAV_BYTES} from '../src/local-dictation.mjs';
import {startDesktop} from '../src/desktop-server.mjs';

function wavChunk(id, data) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length & 1 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function makeWav({frames = 160, format = 1, channels = 1, sampleRate = 16000, bits = 16, ancillary = true} = {}) {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(format, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * channels * bits / 8, 8);
  fmt.writeUInt16LE(channels * bits / 8, 12);
  fmt.writeUInt16LE(bits, 14);
  const chunks = [
    ...(ancillary ? [wavChunk('JUNK', Buffer.from([1, 2, 3]))] : []),
    wavChunk('fmt ', fmt),
    ...(ancillary ? [wavChunk('LIST', Buffer.from('INFO', 'ascii'))] : []),
    wavChunk('data', Buffer.alloc(frames * channels * bits / 8)),
  ];
  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), ...chunks]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

class FakeChild extends EventEmitter {
  constructor({response = {ok: true, text: 'FAKE transcript'}, hold = false, ignoreKill = false} = {}) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.kills = 0;
    this.ignoreKill = ignoreKill;
    this.input = [];
    this.stdin.on('data', chunk => this.input.push(Buffer.from(chunk)));
    this.stdin.once('finish', () => {
      if (hold) return;
      setImmediate(() => this.finish(0, JSON.stringify(response) + '\n'));
    });
  }
  finish(code, output = '', error = '') {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.stdout.end(output);
    this.stderr.end(error);
    this.emit('close', code, null);
  }
  kill() {
    this.kills += 1;
    if (!this.ignoreKill) setImmediate(() => this.finish(1, '', 'killed'));
    return true;
  }
}

test('PCM16 validator accepts ancillary RIFF chunks and rejects invalid formats and bounds', () => {
  const audio = makeWav();
  assert.equal(decodePcm16Mono16kWav(audio.toString('base64')).length, audio.length);
  assert.throws(() => decodePcm16Mono16kWav('bm90IGEgd2F2'), {code: 'INVALID_AUDIO'});
  assert.throws(() => decodePcm16Mono16kWav(makeWav({format: 3}).toString('base64')), {code: 'INVALID_AUDIO'});
  assert.throws(() => decodePcm16Mono16kWav(makeWav({sampleRate: 44100}).toString('base64')), {code: 'INVALID_AUDIO'});
  const truncated = Buffer.from(audio);
  truncated.writeUInt32LE(truncated.readUInt32LE(4) + 100, 4);
  assert.throws(() => decodePcm16Mono16kWav(truncated.toString('base64')), {code: 'INVALID_AUDIO'});
  assert.ok(MAX_WAV_BYTES >= 9_600_000, 'total RIFF allowance must permit five minutes of PCM plus ancillary chunks');
  const nearFiveMinutes = makeWav({frames: 16000 * 299});
  assert.equal(validatePcm16Mono16kWav(nearFiveMinutes).durationSeconds, 299);
  assert.equal(decodePcm16Mono16kWav(nearFiveMinutes.toString('base64')).length, nearFiveMinutes.length);
  const overFiveMinutes = makeWav({frames: 16000 * 300 + 1});
  assert.throws(() => validatePcm16Mono16kWav(overFiveMinutes), {code: 'INVALID_AUDIO'});
});

test('invalid payload is rejected before starting the fake runner', async () => {
  let spawnCalls = 0;
  const backend = createLocalDictation({spawnImpl: () => {spawnCalls += 1; throw new Error('unexpected spawn');}});
  try {
    await assert.rejects(backend.transcribe(Buffer.from('not a wav').toString('base64')), {code: 'INVALID_AUDIO', statusCode: 400});
    await assert.rejects(backend.transcribe('***'), {code: 'INVALID_AUDIO', statusCode: 400});
    assert.equal(spawnCalls, 0);
  } finally { await backend.close(); }
});

test('local dictation starts one offline child, forwards WAV only on stdin, and permits empty transcript', async () => {
  const audio = makeWav();
  let invocation;
  const child = new FakeChild({response: {ok: true, text: ''}});
  const backend = createLocalDictation({spawnImpl: (...args) => { invocation = args; return child; }});
  try {
    assert.deepEqual(await backend.transcribe(audio.toString('base64')), {ok: true, text: ''});
    assert.equal(invocation[0], 'D:\\錄音轉文字\\runtime\\asr_faster_whisper_venv\\Scripts\\python.exe');
    assert.deepEqual(invocation[1].slice(0, 2), ['-I', '-B']);
    assert.ok(invocation[1][2].endsWith('scripts\\local-dictation.py'));
    assert.equal(invocation[2].stdio.join(','), 'pipe,pipe,pipe');
    assert.equal(invocation[2].env.HF_HUB_OFFLINE, '1');
    assert.equal(invocation[2].env.TRANSFORMERS_OFFLINE, '1');
    assert.deepEqual(Buffer.concat(child.input), audio);
  } finally { await backend.close(); }
});

test('local dictation rejects concurrent job and abort kills only its child', async () => {
  const audio = makeWav().toString('base64');
  const child = new FakeChild({hold: true});
  const backend = createLocalDictation({spawnImpl: () => child, timeoutMs: 5000});
  const abort = new AbortController();
  const first = backend.transcribe(audio, {signal: abort.signal});
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(backend.transcribe(audio), {code: 'LOCAL_DICTATION_BUSY', statusCode: 409});
  abort.abort();
  await assert.rejects(first, {code: 'LOCAL_DICTATION_ABORTED', statusCode: 499});
  assert.equal(child.kills, 1);
  await backend.close();
});

test('local dictation close terminates the in-flight child without a box operation', async () => {
  const child = new FakeChild({hold: true});
  const backend = createLocalDictation({spawnImpl: () => child, timeoutMs: 5000});
  const pending = backend.transcribe(makeWav().toString('base64'));
  await new Promise(resolve => setImmediate(resolve));
  await backend.close();
  await assert.rejects(pending, {code: 'LOCAL_DICTATION_SHUTDOWN', statusCode: 503});
  assert.equal(child.kills, 1);
});

test('local dictation retains active lock after unconfirmed stop and permits close retry after late exit', async () => {
  const child = new FakeChild({hold: true, ignoreKill: true});
  const backend = createLocalDictation({spawnImpl: () => child, timeoutMs: 5000, stopTimeoutMs: 20});
  const abort = new AbortController();
  const pending = backend.transcribe(makeWav().toString('base64'), {signal: abort.signal});
  pending.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending, {code: 'LOCAL_DICTATION_STOP_UNCONFIRMED', statusCode: 503});
  assert.equal(child.kills, 1);
  await assert.rejects(backend.transcribe(makeWav().toString('base64')), {code: 'LOCAL_DICTATION_BUSY', statusCode: 409});
  assert.equal(child.exitCode, null, 'unconfirmed process remains alive and tracked');
  child.finish(1, '', 'late exit');
  await backend.close();
});

test('local dictation timeout kills its child and preserves timeout failure', async () => {
  const child = new FakeChild({hold: true});
  const backend = createLocalDictation({spawnImpl: () => child, timeoutMs: 25});
  await assert.rejects(backend.transcribe(makeWav().toString('base64')), {code: 'LOCAL_DICTATION_TIMEOUT', statusCode: 504});
  assert.equal(child.kills, 1);
  await backend.close();
});

test('transcribe route retains cookie, same-origin, request-header and route-local body limits', async () => {
  let calls = 0;
  const app = await startDesktop({root: 'test', executable: 'test', port: 0,
    controllerFactory: () => ({state: {status: 'idle'}, close: async () => {}}),
    localDictationFactory: () => ({transcribe: async audio => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('synthetic GPU error'), {code: 'LOCAL_DICTATION_PROCESS', statusCode: 500, diagnostic: 'fake failure'});
      return {ok: true, text: audio === 'FAKE_WAV' ? '假語音' : ''};
    }, close: async () => {}})});
  try {
    const url = `${app.origin}/api/dictation/transcribe`;
    const body = JSON.stringify({audioBase64: 'FAKE_WAV'});
    const headers = {'Content-Type': 'application/json', 'X-K-Request': '1'};
    assert.equal((await fetch(url, {method: 'POST', headers, body})).status, 403);
    assert.equal((await fetch(`${app.origin}/api/state`, {headers: {host: 'wrong.example'}})).status, 403);
    assert.equal((await fetch(`${app.origin}/assets/missing.js`)).status, 400);
    const page = await fetch(app.createLaunchUrl(),{redirect:'manual'});
    const cookie = page.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(url, {method: 'POST', headers: {...headers, cookie, origin: 'https://foreign.example'}, body})).status, 403);
    assert.equal((await fetch(url, {method: 'POST', headers: {cookie, 'Content-Type': 'application/json'}, body})).status, 403);
    assert.equal(calls, 0);
    const large = await fetch(url, {method: 'POST', headers: {...headers, cookie}, body: ' '.repeat(16 * 1024 * 1024 + 1)});
    assert.equal(large.status, 413);
    assert.deepEqual(await large.json(), {ok: false, error: '請求過大。', code: 'REQUEST_TOO_LARGE'});
    assert.equal(calls, 0);
    const regularLarge = await fetch(`${app.origin}/api/workers`, {method: 'POST', headers: {...headers, cookie}, body: ' '.repeat(65_537)});
    assert.equal(regularLarge.status, 400, 'non-transcribe request limit retains the existing 400 status');
    const invalidJson = await fetch(url, {method: 'POST', headers: {...headers, cookie}, body: '{'});
    assert.equal(invalidJson.status, 400);
    assert.equal((await invalidJson.json()).ok, false);
    const failedJob = await fetch(url, {method: 'POST', headers: {...headers, cookie}, body});
    assert.equal(failedJob.status, 500);
    assert.deepEqual(await failedJob.json(), {ok: false, error: '轉錄要求無法處理。', code: 'LOCAL_DICTATION_PROCESS', diagnostic: 'fake failure'});
    const valid = await fetch(url, {method: 'POST', headers: {...headers, cookie}, body});
    assert.deepEqual(await valid.json(), {ok: true, text: '假語音'});
    assert.equal(calls, 2);
  } finally { await app.close(); }
});

test('transcribe route propagates client abort and server shutdown to the job signal', async () => {
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  let abortResolve;
  const aborted = new Promise(resolve => { abortResolve = resolve; });
  let closeCalls = 0;
  let abortCalls = 0;
  const app = await startDesktop({root: 'test', executable: 'test', port: 0,
    controllerFactory: () => ({state: {status: 'idle'}, close: async () => {}}),
    localDictationFactory: () => ({
      transcribe: (_audio, {signal}) => new Promise((resolve, reject) => {
        enteredResolve();
        signal.addEventListener('abort', () => {abortCalls += 1; abortResolve(); reject(Object.assign(new Error('cancelled'), {code: 'LOCAL_DICTATION_ABORTED', statusCode: 499}));}, {once: true});
      }),
      close: async () => {closeCalls += 1;},
    })});
  try {
    const page = await fetch(app.createLaunchUrl(),{redirect:'manual'});
    const cookie = page.headers.get('set-cookie').split(';')[0];
    const target = new URL(`${app.origin}/api/dictation/transcribe`);
    const request = httpRequest(target, {method: 'POST', headers: {cookie, 'Content-Type': 'application/json', 'X-K-Request': '1'}});
    request.on('error', () => {});
    request.end(JSON.stringify({audioBase64: 'FAKE_WAV'}));
    await entered;
    request.destroy(new Error('synthetic client close'));
    await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error('client abort did not reach dictation signal')), 1000))]);
    assert.equal(abortCalls, 1);
    assert.equal(closeCalls, 0);
  } finally { await app.close(); }
  assert.equal(closeCalls, 1);
});

function noOpLogins(closes) {
  const factory = name => () => ({close: async () => {closes[name] = (closes[name] ?? 0) + 1;}, status: async () => ({}), progress: () => ({})});
  return {claudeLoginFactory: factory('claude'), codexLoginFactory: factory('codex')};
}

test('desktop close reports partial failure, closes other resources, and retries after late child exit', async () => {
  const closes = {};
  let controllerCloses = 0;
  const child = new FakeChild({hold: true, ignoreKill: true});
  const backend = createLocalDictation({spawnImpl: () => child, timeoutMs: 5000, stopTimeoutMs: 20});
  const app = await startDesktop({root: 'test', executable: 'test', port: 0,
    ...noOpLogins(closes),
    controllerFactory: () => ({state: {status: 'idle'}, close: async () => {controllerCloses += 1;}}),
    localDictationFactory: () => backend});
  const session = await fetch(app.createLaunchUrl(),{redirect:'manual'});
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const pending = backend.transcribe(makeWav().toString('base64'));
  pending.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(app.close(), error => error.code === 'K_SHUTDOWN_PARTIAL' && error.statusCode === 503 && /本機語音辨識/.test(error.message));
  assert.deepEqual(closes, {claude: 1, codex: 1});
  assert.equal(controllerCloses, 1);
  assert.equal((await fetch(`${app.origin}/health`)).status, 200, 'server remains available for retry');
  assert.equal((await fetch(`${app.origin}/api/state`, {headers: {cookie}})).status, 200, 'state remains available for diagnosis');
  assert.equal((await fetch(`${app.origin}/api/send`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-K-Request': '1'}, body: '{}'})).status, 503,
    'new work is rejected while shutdown is incomplete');
  child.finish(1, '', 'late exit');
  await assert.rejects(pending, {code: 'LOCAL_DICTATION_STOP_UNCONFIRMED'});
  await app.close();
  assert.deepEqual(closes, {claude: 1, codex: 1}, 'already closed resources are not closed twice');
  assert.equal(controllerCloses, 1);
});

test('shutdown route returns partial failure and a later request can complete shutdown', async () => {
  const closes = {};
  let dictationCloses = 0;
  let controllerCloses = 0;
  const app = await startDesktop({root: 'test', executable: 'test', port: 0,
    ...noOpLogins(closes),
    controllerFactory: () => ({state: {status: 'idle'}, close: async () => {controllerCloses += 1;}}),
    localDictationFactory: () => ({transcribe: async () => ({ok: true, text: ''}), close: async () => {
      dictationCloses += 1;
      if (dictationCloses === 1) throw Object.assign(new Error('synthetic unconfirmed stop'), {code: 'LOCAL_DICTATION_STOP_UNCONFIRMED'});
    }})});
  const page = await fetch(app.createLaunchUrl(),{redirect:'manual'});
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const url = `${app.origin}/api/shutdown`;
  const options = {method: 'POST', headers: {cookie, origin: app.origin, 'Content-Type': 'application/json', 'X-K-Request': '1'}, body: '{}'};
  const first = await fetch(url, options);
  assert.equal(first.status, 503);
  assert.deepEqual(await first.json(), {error: 'K 尚未完全關閉：本機語音辨識。程序停止後請重試。'});
  assert.deepEqual(closes, {claude: 1, codex: 1});
  assert.equal(controllerCloses, 1);
  assert.equal((await fetch(`${app.origin}/health`)).status, 200);
  const second = await fetch(url, options);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), {closed: true});
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(dictationCloses, 2);
  assert.deepEqual(closes, {claude: 1, codex: 1});
  assert.equal(controllerCloses, 1);
  await app.close();
});
