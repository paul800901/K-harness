import test from "node:test";
import assert from "node:assert/strict";
import { createNativeDictationSession, encodePcm16Wav, NATIVE_DICTATION_SAMPLE_RATE } from "../frontend/native-dictation.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeAudio() {
  const processor = { onaudioprocess: null, connect() {}, disconnect() {} };
  const silence = { gain: { value: 1 }, connect() {}, disconnect() {} };
  const stream = { stopped: 0, getTracks() { return [{ stop: () => { stream.stopped += 1; } }]; } };
  const context = {
    sampleRate: 48_000,
    destination: {},
    async resume() {},
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; },
    createScriptProcessor(size, inputChannels, outputChannels) {
      assert.deepEqual([size, inputChannels, outputChannels], [4096, 1, 1]);
      return processor;
    },
    createGain() { return silence; },
    async close() {},
  };
  return {
    context, processor, silence, stream,
    emit(samples = new Float32Array([0, 0.25, -0.25, 0.5])) {
      processor.onaudioprocess?.({ inputBuffer: { length: samples.length, numberOfChannels: 1, getChannelData: () => samples } });
    },
  };
}

test("WAV encoder produces mono 16kHz PCM16 RIFF data", () => {
  const wav = encodePcm16Wav(new Float32Array([0, 0.5, -0.5, 1]), 16_000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), NATIVE_DICTATION_SAMPLE_RATE);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 8);
  assert.equal(view.getInt16(46, true), 16383);
});

test("stop transcribes captured audio, stop/send intent may be upgraded, and no self-playback occurs", async () => {
  const audio = fakeAudio();
  let resolveTranscription;
  let requestPayload;
  const results = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: (audioBase64, signal) => {
      requestPayload = { audioBase64, signal };
      return new Promise((resolve) => { resolveTranscription = resolve; });
    },
    onResult: (result) => results.push(result),
  });
  await session.start();
  assert.equal(session.getState(), "recording");
  assert.equal(audio.silence.gain.value, 0);
  audio.emit();
  const completion = session.stop(false);
  session.stop(true);
  assert.equal(session.getState(), "transcribing");
  await delay(0);
  const body = Buffer.from(requestPayload.audioBase64, "base64");
  assert.equal(body.toString("ascii", 0, 4), "RIFF");
  resolveTranscription({ ok: true, text: "本機辨識草稿" });
  await completion;
  assert.deepEqual(results, [{ text: "本機辨識草稿", send: true }]);
  assert.equal(requestPayload.signal.aborted, false);
  assert.equal(audio.stream.stopped, 1);
});

test("manual stop fills a recognized draft without setting send intent", async () => {
  const audio = fakeAudio();
  const results = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: async () => ({ ok: true, text: "只填入草稿" }),
    onResult: (result) => results.push(result),
  });
  await session.start();
  audio.emit();
  await session.stop(false);
  assert.deepEqual(results, [{ text: "只填入草稿", send: false }]);
});

test("cancel during recording releases capture without calling transcription", async () => {
  const audio = fakeAudio();
  let requests = 0;
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: async () => { requests += 1; return { ok: true, text: "" }; },
  });
  await session.start();
  audio.emit();
  session.cancel();
  assert.equal(requests, 0);
  assert.equal(audio.stream.stopped, 1);
  assert.equal(session.getState(), "idle");
});

test("five-minute limit transcribes without auto-send; blank result stays non-sendable", async () => {
  const audio = fakeAudio();
  let resolveTranscription;
  let limited = 0;
  let requestAudio;
  const results = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    maxRecordingMs: 10,
    requestTranscription: (audioBase64) => { requestAudio = audioBase64; return new Promise((resolve) => { resolveTranscription = resolve; }); },
    onLimit: () => { limited += 1; },
    onResult: (result) => results.push(result),
  });
  await session.start();
  audio.emit(new Float32Array(1024).fill(0.25));
  assert.equal(limited, 1);
  assert.equal(session.getState(), "transcribing");
  const completion = session.stop(true); // Explicit send-arrow action can upgrade a pending result.
  await delay(0);
  const wav = Buffer.from(requestAudio, "base64");
  assert.equal(wav.readUInt32LE(40), 320); // 10ms at 48kHz is capped to 480 input frames / 160 output frames.
  resolveTranscription({ ok: true, text: "" });
  await completion;
  assert.deepEqual(results, [{ text: "", send: false }]);
  assert.equal(audio.stream.stopped, 1);
});

test("cancel aborts transcription and suppresses late transcript callbacks", async () => {
  const audio = fakeAudio();
  let signal;
  const results = [];
  const errors = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: (_payload, requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve, reject) => {
        requestSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        resolve.late = resolve;
      });
    },
    onResult: (result) => results.push(result),
    onError: (error) => errors.push(error),
  });
  await session.start();
  audio.emit();
  session.stop(false);
  await delay(0);
  session.cancel();
  assert.equal(signal.aborted, true);
  assert.deepEqual(results, []);
  assert.deepEqual(errors, []);
  assert.equal(audio.stream.stopped, 1);
});

test("cancel while waiting for microphone permission stops a late stream", async () => {
  let resolveStream;
  let tracksStopped = 0;
  const context = fakeAudio().context;
  const session = createNativeDictationSession({
    acquireStream: () => new Promise((resolve) => { resolveStream = resolve; }),
    createAudioContext: () => context,
    requestTranscription: async () => ({ ok: true, text: "" }),
  });
  const start = session.start();
  session.cancel();
  resolveStream({ getTracks: () => [{ stop: () => { tracksStopped += 1; } }] });
  await start;
  assert.equal(tracksStopped, 1);
  assert.equal(session.getState(), "idle");
});

test("late microphone stream is stopped when AudioContext resume fails first", async () => {
  let resolveStream;
  let tracksStopped = 0;
  let failure = "";
  const context = fakeAudio().context;
  context.resume = () => Promise.reject(new Error("audio context resume failed"));
  const session = createNativeDictationSession({
    acquireStream: () => new Promise((resolve) => { resolveStream = resolve; }),
    createAudioContext: () => context,
    requestTranscription: async () => ({ ok: true, text: "" }),
    onError: (error) => { failure = error; },
  });
  const start = session.start();
  await delay(0); // Resume rejects before the user resolves the microphone prompt.
  resolveStream({ getTracks: () => [{ stop: () => { tracksStopped += 1; } }] });
  await start;
  assert.equal(tracksStopped, 1);
  assert.equal(failure, "audio context resume failed");
  assert.equal(session.getState(), "idle");
});

test("transcription timeout settles even if the request ignores abort and late text is ignored", async () => {
  const audio = fakeAudio();
  let signal;
  let resolveLate;
  const results = [];
  const errors = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    transcriptionTimeoutMs: 10,
    requestTranscription: (_payload, requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => { resolveLate = resolve; });
    },
    onResult: (result) => results.push(result),
    onError: (error) => errors.push(error),
  });
  await session.start();
  audio.emit();
  const completion = session.stop(true);
  await completion;
  assert.equal(signal.aborted, true);
  assert.equal(session.getState(), "idle");
  assert.deepEqual(errors, ["語音轉錄逾時，原草稿保留。"]);
  resolveLate({ ok: true, text: "不可採用的晚到結果" });
  await delay(0);
  assert.deepEqual(results, []);
});

test("invalid transcription success is an error and never returns send intent", async () => {
  const audio = fakeAudio();
  const results = [];
  const errors = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: async () => ({ ok: true, text: 42 }),
    onResult: (result) => results.push(result),
    onError: (error) => errors.push(error),
  });
  await session.start();
  audio.emit();
  await session.stop(true);
  assert.deepEqual(results, []);
  assert.deepEqual(errors, ["語音辨識回覆格式錯誤。"]);
  assert.equal(session.getState(), "idle");
});
