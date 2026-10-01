import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidateRoot = process.env.K_CANDIDATE_ROOT || (path.basename(path.dirname(moduleDirectory)).toLowerCase() === 'trusted-runtime'
  ? path.resolve(moduleDirectory, '../..') : path.resolve(moduleDirectory, '..'));
const localDictationRoot = path.join(candidateRoot, 'local語音');
export const LOCAL_DICTATION_PYTHON = path.join(localDictationRoot, 'runtime', 'asr_faster_whisper_venv', 'Scripts', 'python.exe');
export const LOCAL_DICTATION_MODEL = path.join(localDictationRoot, 'runtime', 'models', 'hf_cache', 'models--Systran--faster-whisper-large-v3',
  'snapshots', 'edaa852ec7e145841d8ffdb056a99866b5f0a478');
export const MAX_WAV_BYTES = 12 * 1024 * 1024;
export const MAX_WAV_DURATION_SECONDS = 5 * 60;
export const MAX_JSON_BYTES = 16 * 1024 * 1024;
const helperPath = fileURLToPath(new URL('../scripts/local-dictation.py', import.meta.url));

export class LocalDictationError extends Error {
  constructor(message, {code = 'LOCAL_DICTATION_FAILED', statusCode = 500, cause, diagnostic} = {}) {
    super(message, {cause});
    this.name = 'LocalDictationError';
    this.code = code;
    this.statusCode = statusCode;
    this.diagnostic = diagnostic;
  }
}

export function decodePcm16Mono16kWav(audioBase64) {
  if (typeof audioBase64 !== 'string' || !audioBase64 || audioBase64.length > Math.ceil(MAX_WAV_BYTES / 3) * 4 ||
      audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)) {
    throw new LocalDictationError('音訊資料格式無效。', {code: 'INVALID_AUDIO', statusCode: 400});
  }
  const wav = Buffer.from(audioBase64, 'base64');
  if (wav.length > MAX_WAV_BYTES || wav.toString('base64') !== audioBase64) {
    throw new LocalDictationError('音訊資料過大或格式無效。', {code: 'INVALID_AUDIO', statusCode: 400});
  }
  validatePcm16Mono16kWav(wav);
  return wav;
}

export function validatePcm16Mono16kWav(wav) {
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.length > MAX_WAV_BYTES ||
      wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new LocalDictationError('音訊須為 PCM16、單聲道、16 kHz 的 WAV。', {code: 'INVALID_AUDIO', statusCode: 400});
  }
  const riffEnd = wav.readUInt32LE(4) + 8;
  if (riffEnd !== wav.length || riffEnd < 12) {
    throw new LocalDictationError('WAV 區塊長度無效。', {code: 'INVALID_AUDIO', statusCode: 400});
  }
  let fmt = null;
  let dataBytes = null;
  let offset = 12;
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) throw new LocalDictationError('WAV 區塊標頭不完整。', {code: 'INVALID_AUDIO', statusCode: 400});
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > riffEnd || end < start) throw new LocalDictationError('WAV 區塊超出檔案界線。', {code: 'INVALID_AUDIO', statusCode: 400});
    if (id === 'fmt ') {
      if (fmt || size < 16) throw new LocalDictationError('WAV 格式區塊無效。', {code: 'INVALID_AUDIO', statusCode: 400});
      fmt = {format: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2), sampleRate: wav.readUInt32LE(start + 4),
        byteRate: wav.readUInt32LE(start + 8), blockAlign: wav.readUInt16LE(start + 12), bits: wav.readUInt16LE(start + 14)};
    } else if (id === 'data') {
      if (dataBytes !== null) throw new LocalDictationError('WAV 含不支援的多個音訊區塊。', {code: 'INVALID_AUDIO', statusCode: 400});
      dataBytes = size;
    }
    offset = end + (size & 1);
    if (offset > riffEnd) throw new LocalDictationError('WAV 區塊填補長度無效。', {code: 'INVALID_AUDIO', statusCode: 400});
  }
  if (offset !== riffEnd || !fmt || dataBytes === null || fmt.format !== 1 || fmt.channels !== 1 || fmt.sampleRate !== 16000 ||
      fmt.bits !== 16 || fmt.blockAlign !== 2 || fmt.byteRate !== 32000 || dataBytes === 0 || dataBytes % 2 !== 0 ||
      dataBytes > MAX_WAV_DURATION_SECONDS * 16000 * 2) {
    throw new LocalDictationError('WAV 須為 PCM16、單聲道、16 kHz，且不超過五分鐘。', {code: 'INVALID_AUDIO', statusCode: 400});
  }
  return {durationSeconds: dataBytes / 32000, dataBytes};
}

function childEnvironment(source = process.env, modelPath = LOCAL_DICTATION_MODEL, pythonPath = LOCAL_DICTATION_PYTHON) {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH']) {
    const key = Object.keys(source).find(value => value.toUpperCase() === name.toUpperCase());
    if (key && typeof source[key] === 'string') env[name] = source[key];
  }
  const sitePackages = path.join(path.dirname(path.dirname(pythonPath)), 'Lib', 'site-packages');
  const cudaBins = ['cublas', 'cuda_runtime', 'cuda_nvrtc', 'cudnn'].map(name => path.join(sitePackages, 'nvidia', name, 'bin'));
  const systemRoot = env.SystemRoot ?? env.WINDIR ?? 'C:\\Windows';
  env.PATH = [...cudaBins, path.dirname(pythonPath), path.join(systemRoot, 'System32')].join(path.delimiter);
  env.K_DICTATION_MODEL = modelPath;
  env.HF_HUB_OFFLINE = '1';
  env.HF_HUB_DISABLE_TELEMETRY = '1';
  env.TRANSFORMERS_OFFLINE = '1';
  return env;
}

export function createLocalDictation({pythonPath = process.env.K_DICTATION_PYTHON || LOCAL_DICTATION_PYTHON,
  modelPath = process.env.K_DICTATION_MODEL || LOCAL_DICTATION_MODEL, scriptPath = helperPath,
  spawnImpl = spawn, timeoutMs = 120_000, stopTimeoutMs = 5000} = {}) {
  if (!path.isAbsolute(pythonPath) || !path.isAbsolute(scriptPath) || !Number.isInteger(timeoutMs) || timeoutMs < 1 ||
      !Number.isInteger(stopTimeoutMs) || stopTimeoutMs < 1) {
    throw new TypeError('Absolute Python/helper paths and a positive timeout are required.');
  }
  let active = null;
  let closed = false;

  function finish(job, error, value) {
    if (job.responseSettled) return;
    job.responseSettled = true;
    clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.onAbort);
    if (!job.child || job.childClosed) if (active === job) active = null;
    if (error) job.reject(error);
    else job.resolve(value);
  }

  function stopChild(job, reason, error) {
    job.stopError ??= error;
    job.stopReason ??= reason;
    if (!job.child) { finish(job, job.stopError); return; }
    if (job.childClosed) { finish(job, job.stopError); return; }
    if (!job.killRequested) {
      job.stopTimer = setTimeout(() => {
        if (!job.childClosed) finish(job, new LocalDictationError('本機辨識程序尚未結束，已暫停新的辨識工作。', {
          code: 'LOCAL_DICTATION_STOP_UNCONFIRMED', statusCode: 503, diagnostic: job.killDiagnostic ?? job.stopError?.message,
        }));
      }, stopTimeoutMs);
      job.killRequested = true;
      try { job.child.kill(); }
      catch (cause) { job.killDiagnostic = cause.message; }
    }
  }

  async function transcribe(audioBase64, {signal} = {}) {
    if (closed) throw new LocalDictationError('本機語音辨識正在關閉。', {code: 'LOCAL_DICTATION_CLOSED', statusCode: 503});
    if (active) throw new LocalDictationError('已有一筆語音辨識工作進行中。', {code: 'LOCAL_DICTATION_BUSY', statusCode: 409});
    const wav = decodePcm16Mono16kWav(audioBase64);
    if (signal?.aborted) throw new LocalDictationError('語音辨識要求已取消。', {code: 'LOCAL_DICTATION_ABORTED', statusCode: 499});
    const job = {child: null, childClosed: false, responseSettled: false, stopReason: null, stopError: null,
      output: '', errors: '', timer: null, stopTimer: null, resolve: null, reject: null, signal};
    active = job;
    const done = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    job.onAbort = () => stopChild(job, 'aborted', new LocalDictationError('語音辨識要求已取消。', {code: 'LOCAL_DICTATION_ABORTED', statusCode: 499}));
    signal?.addEventListener('abort', job.onAbort, {once: true});
    job.timer = setTimeout(() => stopChild(job, 'timeout', new LocalDictationError('本機語音辨識逾時。', {code: 'LOCAL_DICTATION_TIMEOUT', statusCode: 504})), timeoutMs);
    try {
      const child = spawnImpl(pythonPath, ['-I', '-B', scriptPath], {cwd: path.dirname(scriptPath), env: childEnvironment(process.env, modelPath, pythonPath), windowsHide: true,
        shell: false, stdio: ['pipe', 'pipe', 'pipe']});
      job.child = child;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { job.output += chunk; });
      child.stderr.on('data', chunk => { job.errors += chunk; });
      child.once('error', error => stopChild(job, 'spawn-error', new LocalDictationError('無法啟動本機語音辨識。', {code: 'LOCAL_DICTATION_SPAWN', statusCode: 503, cause: error, diagnostic: error.message})));
      child.once('close', (code, childSignal) => {
        job.childClosed = true;
        clearTimeout(job.stopTimer);
        if (active === job) active = null;
        if (job.stopReason) {
          finish(job, job.stopError ?? new LocalDictationError('本機語音辨識已停止。', {code: 'LOCAL_DICTATION_STOPPED', statusCode: 503}));
          return;
        }
        if (code !== 0) {
          finish(job, new LocalDictationError('本機語音辨識失敗。', {code: 'LOCAL_DICTATION_PROCESS', statusCode: 500,
            diagnostic: job.errors.trim() || `exit=${code ?? childSignal ?? 'unknown'}`}));
          return;
        }
        try {
          const result = JSON.parse(job.output.trim());
          if (!result || result.ok !== true || typeof result.text !== 'string') throw new Error('辨識回覆格式無效。');
          finish(job, null, {ok: true, text: result.text});
        } catch (error) {
          finish(job, new LocalDictationError('本機語音辨識回覆格式無效。', {code: 'LOCAL_DICTATION_PROTOCOL', statusCode: 500, cause: error, diagnostic: error.message}));
        }
      });
      child.stdin.once('error', error => {
        if (!job.childClosed) stopChild(job, 'stdin-error', new LocalDictationError('傳送音訊至本機辨識器失敗。', {code: 'LOCAL_DICTATION_STDIN', statusCode: 500, cause: error, diagnostic: error.message}));
      });
      child.stdin.end(wav);
    } catch (error) {
      const failure = error instanceof LocalDictationError ? error : new LocalDictationError('無法啟動本機語音辨識。', {code: 'LOCAL_DICTATION_SPAWN', statusCode: 503, cause: error, diagnostic: error.message});
      if (job.child) stopChild(job, 'spawn-error', failure);
      else finish(job, failure);
    }
    return done;
  }

  async function close() {
    closed = true;
    if (active) {
      const job = active;
      stopChild(job, 'shutdown', new LocalDictationError('本機語音辨識已關閉。', {code: 'LOCAL_DICTATION_SHUTDOWN', statusCode: 503}));
      await new Promise(resolve => {
        if (job.childClosed) return resolve();
        job.child?.once('close', resolve);
        job.closeWaitTimer = setTimeout(resolve, stopTimeoutMs);
      });
      clearTimeout(job.closeWaitTimer);
      if (!job.childClosed) throw new LocalDictationError('本機辨識程序尚未結束，仍保留工作鎖。', {
        code: 'LOCAL_DICTATION_STOP_UNCONFIRMED', statusCode: 503, diagnostic: job.killDiagnostic,
      });
    }
  }

  return {transcribe, close};
}
