export const NATIVE_DICTATION_SAMPLE_RATE = 16_000;
export const NATIVE_DICTATION_MAX_MS = 5 * 60 * 1000;
export const NATIVE_DICTATION_TIMEOUT_MS = 120_000;

function resampleLinear(samples, sourceRate, targetRate) {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) throw new Error("無法讀取麥克風取樣率。");
  if (sourceRate === targetRate) return samples;
  const outputLength = Math.floor(samples.length * targetRate / sourceRate);
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = samples[Math.min(left, samples.length - 1)] ?? 0;
    const b = samples[Math.min(left + 1, samples.length - 1)] ?? a;
    output[i] = a + (b - a) * fraction;
  }
  return output;
}

export function encodePcm16Wav(samples, sourceRate) {
  const mono16k = resampleLinear(samples, sourceRate, NATIVE_DICTATION_SAMPLE_RATE);
  const dataBytes = mono16k.length * 2;
  const wav = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wav);
  const write = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, NATIVE_DICTATION_SAMPLE_RATE, true);
  view.setUint32(28, NATIVE_DICTATION_SAMPLE_RATE * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, dataBytes, true);
  for (let i = 0; i < mono16k.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, mono16k[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Uint8Array(wav);
}

export function encodePcm16WavBase64(samples, sourceRate) {
  const bytes = encodePcm16Wav(samples, sourceRate);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  if (typeof globalThis.btoa !== "function") throw new Error("目前執行環境無法編碼 WAV 音訊。");
  return globalThis.btoa(binary);
}

function monoFrame(inputBuffer) {
  const length = inputBuffer.length;
  const channels = Math.max(1, inputBuffer.numberOfChannels || 1);
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const values = inputBuffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mono[i] += values[i] / channels;
  }
  let energy = 0;
  for (const value of mono) energy += value * value;
  return { mono, level: Math.sqrt(energy / Math.max(1, length)) };
}

/** Captures one in-memory microphone stream and submits only its WAV on stop. */
export function createNativeDictationSession({
  acquireStream = () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }),
  createAudioContext = () => new AudioContext({ sampleRate: NATIVE_DICTATION_SAMPLE_RATE }),
  requestTranscription,
  onState = () => {},
  onLevel = () => {},
  onLimit = () => {},
  onResult = () => {},
  onError = () => {},
  maxRecordingMs = NATIVE_DICTATION_MAX_MS,
  transcriptionTimeoutMs = NATIVE_DICTATION_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof requestTranscription !== "function") throw new TypeError("A transcription request is required");
  let state = "idle";
  let generation = 0;
  let stream = null;
  let context = null;
  let source = null;
  let processor = null;
  let silence = null;
  let recordingTimer = null;
  let transcriptionTimer = null;
  let abortController = null;
  let samples = [];
  let sampleCount = 0;
  let sendIntent = false;
  let startPromise = Promise.resolve();
  let completion = Promise.resolve();
  let pendingResolve = null;
  let maxSampleCount = Infinity;
  let limitReported = false;

  const setState = (next) => { state = next; onState(next); };
  const stopTracks = (activeStream) => activeStream?.getTracks?.().forEach((track) => track.stop());
  const closeContext = (activeContext) => { try { Promise.resolve(activeContext?.close?.()).catch(() => {}); } catch {} };
  const clearTimers = () => {
    if (recordingTimer !== null) clearTimer(recordingTimer);
    if (transcriptionTimer !== null) clearTimer(transcriptionTimer);
    recordingTimer = null; transcriptionTimer = null;
  };
  const disconnectCapture = ({ clearSamples = false } = {}) => {
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch {} }
    try { source?.disconnect(); } catch {}
    try { silence?.disconnect(); } catch {}
    stopTracks(stream);
    closeContext(context);
    stream = null; context = null; source = null; processor = null; silence = null;
    if (clearSamples) { samples = []; sampleCount = 0; }
  };
  const combineSamples = () => {
    const combined = new Float32Array(sampleCount);
    let offset = 0;
    for (const chunk of samples) { combined.set(chunk, offset); offset += chunk.length; }
    samples = []; sampleCount = 0;
    return combined;
  };
  const reportLimit = (token) => {
    if (state !== "recording" || token !== generation || limitReported) return;
    limitReported = true;
    onLimit();
    void stop(false);
  };

  const start = () => {
    if (state !== "idle") return startPromise;
    const token = ++generation;
    sendIntent = false;
    samples = []; sampleCount = 0;
    limitReported = false;
    setState("starting");
    try {
      context = createAudioContext();
      const activeContext = context;
      const resumePromise = Promise.resolve(activeContext.resume?.()).then(() => null, (error) => error);
      const streamPromise = Promise.resolve(acquireStream());
      startPromise = (async () => {
        const acquiredStream = await streamPromise;
        if (token !== generation) { stopTracks(acquiredStream); closeContext(activeContext); return; }
        stream = acquiredStream;
        const resumeError = await resumePromise;
        if (resumeError) throw resumeError;
        if (token !== generation) { disconnectCapture({ clearSamples: true }); return; }
        maxSampleCount = Math.max(1, Math.floor(maxRecordingMs * activeContext.sampleRate / 1000));
        source = activeContext.createMediaStreamSource(acquiredStream);
        processor = activeContext.createScriptProcessor(4096, 1, 1);
        silence = activeContext.createGain();
        silence.gain.value = 0;
        processor.onaudioprocess = (event) => {
          if (token !== generation || state !== "recording") return;
          const { mono, level } = monoFrame(event.inputBuffer);
          const remaining = maxSampleCount - sampleCount;
          if (remaining <= 0) { reportLimit(token); return; }
          const captured = mono.length > remaining ? mono.subarray(0, remaining).slice() : mono;
          samples.push(captured); sampleCount += captured.length;
          if (captured.length) onLevel(level);
          if (sampleCount >= maxSampleCount) reportLimit(token);
        };
        source.connect(processor);
        processor.connect(silence);
        silence.connect(activeContext.destination);
        setState("recording");
        recordingTimer = setTimer(() => {
          reportLimit(token);
        }, maxRecordingMs);
      })().catch((error) => {
        if (token !== generation) return;
        disconnectCapture({ clearSamples: true });
        setState("idle");
        onError(error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      disconnectCapture({ clearSamples: true });
      setState("idle");
      onError(error instanceof Error ? error.message : String(error));
      startPromise = Promise.resolve();
    }
    return startPromise;
  };

  const stop = (send = false) => {
    if (state === "transcribing") { sendIntent ||= Boolean(send); return completion; }
    if (state !== "recording") return completion;
    sendIntent = Boolean(send);
    clearTimers();
    setState("transcribing");
    const activeContext = context;
    const sampleRate = activeContext?.sampleRate;
    disconnectCapture();
    if (sampleCount === 0) {
      setState("idle");
      onResult({ text: "", send: false });
      return completion;
    }
    let audioBase64;
    try { audioBase64 = encodePcm16WavBase64(combineSamples(), sampleRate); }
    catch (error) {
      disconnectCapture({ clearSamples: true });
      setState("idle");
      onError(error instanceof Error ? error.message : String(error));
      return completion;
    }
    abortController = new AbortController();
    const controller = abortController;
    const token = generation;
    let settled = false;
    let resolveCompletion;
    completion = new Promise((resolve) => { resolveCompletion = resolve; pendingResolve = resolve; });
    const settleFailure = (error) => {
      if (settled || token !== generation) return;
      settled = true; clearTimers(); abortController = null; pendingResolve = null;
      setState("idle");
      onError(error instanceof Error ? error.message : String(error));
      resolveCompletion();
    };
    transcriptionTimer = setTimer(() => {
      if (settled || token !== generation) return;
      settled = true; generation += 1; controller.abort();
      clearTimers(); abortController = null; pendingResolve = null;
      setState("idle"); onError("語音轉錄逾時，原草稿保留。"); resolveCompletion();
    }, transcriptionTimeoutMs);
    Promise.resolve().then(() => requestTranscription(audioBase64, controller.signal)).then((result) => {
      if (settled || token !== generation) return;
      if (result?.ok !== true || typeof result.text !== "string") {
        settleFailure(new Error(result?.error || "語音辨識回覆格式錯誤。"));
        return;
      }
      settled = true; clearTimers(); abortController = null; pendingResolve = null;
      setState("idle");
      onResult({ text: result.text, send: result.text.trim() ? sendIntent : false });
      resolveCompletion();
    }, settleFailure);
    return completion;
  };

  const cancel = () => {
    if (state === "idle") return completion;
    generation += 1;
    clearTimers();
    abortController?.abort(); abortController = null;
    disconnectCapture({ clearSamples: true });
    setState("idle");
    const resolve = pendingResolve; pendingResolve = null; resolve?.();
    return completion;
  };

  return { start, stop, cancel, getState: () => state };
}
