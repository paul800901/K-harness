import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNativeDictationSession,
  encodePcm16Wav,
  NATIVE_DICTATION_SAMPLE_RATE
} from '../frontend/native-dictation.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeAudio() {
  const processor = {onaudioprocess: null, connect() {}, disconnect() {}};
  const silence = {gain: {value: 1}, connect() {}, disconnect() {}};
  const stream = {
    stopped: 0,
    getTracks() {
      return [
        {
          stop: () => {
            stream.stopped += 1;
          }
        }
      ];
    }
  };
  const context = {
    sampleRate: 48_000,
    destination: {},
    async resume() {},
    createMediaStreamSource() {
      return {connect() {}, disconnect() {}};
    },
    createScriptProcessor(size, inputChannels, outputChannels) {
      assert.deepEqual([size, inputChannels, outputChannels], [4096, 1, 1]);
      return processor;
    },
    createGain() {
      return silence;
    },
    async close() {}
  };
  return {
    context,
    processor,
    silence,
    stream,
    emit(samples = new Float32Array([0, 0.25, -0.25, 0.5])) {
      processor.onaudioprocess?.({
        inputBuffer: {length: samples.length, numberOfChannels: 1, getChannelData: () => samples}
      });
    }
  };
}

test('WAV encoder produces mono 16kHz PCM16 RIFF data', () => {
  const wav = encodePcm16Wav(new Float32Array([0, 0.5, -0.5, 1]), 16_000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), NATIVE_DICTATION_SAMPLE_RATE);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 8);
  assert.equal(view.getInt16(46, true), 16383);
});

test('stop transcribes captured audio, stop/send intent may be upgraded, and no self-playback occurs', async () => {
  const audio = fakeAudio();
  let resolveTranscription;
  let requestPayload;
  const results = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: (audioBase64, signal) => {
      requestPayload = {audioBase64, signal};
      return new Promise(resolve => {
        resolveTranscription = resolve;
      });
    },
    onResult: result => results.push(result)
  });
  await session.start();
  assert.equal(session.getState(), 'recording');
  assert.equal(audio.silence.gain.value, 0);
  audio.emit();
  const completion = session.stop(false);
  session.stop(true);
  assert.equal(session.getState(), 'transcribing');
  await delay(0);
  const body = Buffer.from(requestPayload.audioBase64, 'base64');
  assert.equal(body.toString('ascii', 0, 4), 'RIFF');
  resolveTranscription({ok: true, text: '本機辨識草稿'});
  await completion;
  assert.deepEqual(results, [{text: '本機辨識草稿', send: true}]);
  assert.equal(requestPayload.signal.aborted, false);
  assert.equal(audio.stream.stopped, 1);
});

test('manual stop fills a recognized draft without setting send intent', async () => {
  const audio = fakeAudio();
  const results = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: async () => ({ok: true, text: '只填入草稿'}),
    onResult: result => results.push(result)
  });
  await session.start();
  audio.emit();
  await session.stop(false);
  assert.deepEqual(results, [{text: '只填入草稿', send: false}]);
});

test('cancel during recording releases capture without calling transcription', async () => {
  const audio = fakeAudio();
  let requests = 0;
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: async () => {
      requests += 1;
      return {ok: true, text: ''};
    }
  });
  await session.start();
  audio.emit();
  session.cancel();
  assert.equal(requests, 0);
  assert.equal(audio.stream.stopped, 1);
  assert.equal(session.getState(), 'idle');
});

test('five-minute limit transcribes without auto-send; blank result stays non-sendable', async () => {
  const audio = fakeAudio();
  let resolveTranscription;
  let limited = 0;
  let requestAudio;
  const results = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    maxRecordingMs: 10,
    requestTranscription: audioBase64 => {
      requestAudio = audioBase64;
      return new Promise(resolve => {
        resolveTranscription = resolve;
      });
    },
    onLimit: () => {
      limited += 1;
    },
    onResult: result => results.push(result)
  });
  await session.start();
  audio.emit(new Float32Array(1024).fill(0.25));
  assert.equal(limited, 1);
  assert.equal(session.getState(), 'transcribing');
  const completion = session.stop(true); // Explicit send-arrow action can upgrade a pending result.
  await delay(0);
  const wav = Buffer.from(requestAudio, 'base64');
  assert.equal(wav.readUInt32LE(40), 320); // 10ms at 48kHz is capped to 480 input frames / 160 output frames.
  resolveTranscription({ok: true, text: ''});
  await completion;
  assert.deepEqual(results, [{text: '', send: false}]);
  assert.equal(audio.stream.stopped, 1);
});

test('cancel aborts transcription and suppresses late transcript callbacks', async () => {
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
        requestSignal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
        resolve.late = resolve;
      });
    },
    onResult: result => results.push(result),
    onError: error => errors.push(error)
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

test('cancel while waiting for microphone permission stops a late stream', async () => {
  let resolveStream;
  let tracksStopped = 0;
  const context = fakeAudio().context;
  const session = createNativeDictationSession({
    acquireStream: () =>
      new Promise(resolve => {
        resolveStream = resolve;
      }),
    createAudioContext: () => context,
    requestTranscription: async () => ({ok: true, text: ''})
  });
  const start = session.start();
  session.cancel();
  resolveStream({
    getTracks: () => [
      {
        stop: () => {
          tracksStopped += 1;
        }
      }
    ]
  });
  await start;
  assert.equal(tracksStopped, 1);
  assert.equal(session.getState(), 'idle');
});

test('late microphone stream is stopped when AudioContext resume fails first', async () => {
  let resolveStream;
  let tracksStopped = 0;
  let failure = '';
  const context = fakeAudio().context;
  context.resume = () => Promise.reject(new Error('audio context resume failed'));
  const session = createNativeDictationSession({
    acquireStream: () =>
      new Promise(resolve => {
        resolveStream = resolve;
      }),
    createAudioContext: () => context,
    requestTranscription: async () => ({ok: true, text: ''}),
    onError: error => {
      failure = error;
    }
  });
  const start = session.start();
  await delay(0); // Resume rejects before the user resolves the microphone prompt.
  resolveStream({
    getTracks: () => [
      {
        stop: () => {
          tracksStopped += 1;
        }
      }
    ]
  });
  await start;
  assert.equal(tracksStopped, 1);
  assert.equal(failure, 'audio context resume failed');
  assert.equal(session.getState(), 'idle');
});

test('a slow transcription has no fixed deadline and keeps its send intent', async () => {
  const audio = fakeAudio();
  const timers = [];
  let signal;
  let resolveSlow;
  const results = [];
  const errors = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    setTimer: (callback, ms) => timers.push({callback, ms}),
    clearTimer: () => {},
    requestTranscription: (_payload, requestSignal) => {
      signal = requestSignal;
      return new Promise(resolve => {
        resolveSlow = resolve;
      });
    },
    onResult: result => results.push(result),
    onError: error => errors.push(error)
  });
  await session.start();
  audio.emit();
  const completion = session.stop(true);
  await delay(0);
  // Let every timer the session ever scheduled elapse, as if many minutes had passed.
  for (const timer of timers.splice(0)) timer.callback();
  await delay(0);
  assert.equal(session.getState(), 'transcribing');
  assert.equal(signal.aborted, false);
  assert.deepEqual(errors, []);
  resolveSlow({ok: true, text: '很久之後才完成的長聽寫'});
  await completion;
  assert.deepEqual(results, [{text: '很久之後才完成的長聽寫', send: true}]);
});

test('invalid transcription success is an error and never returns send intent', async () => {
  const audio = fakeAudio();
  const results = [];
  const errors = [];
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: async () => ({ok: true, text: 42}),
    onResult: result => results.push(result),
    onError: error => errors.push(error)
  });
  await session.start();
  audio.emit();
  await session.stop(true);
  assert.deepEqual(results, []);
  assert.deepEqual(errors, ['語音辨識回覆格式錯誤。']);
  assert.equal(session.getState(), 'idle');
});

test('a failed transcription hands back its audio; retry resends it under a new id with the same lifecycle', async () => {
  const audio = fakeAudio();
  const calls = [];
  const results = [];
  const failures = [];
  const states = [];
  let fail = true;
  const session = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    prepareTranscription: (_signal, id) => calls.push(['prepare', id]),
    requestTranscription: async (audioBase64, _signal, id) => {
      calls.push(['transcribe', id, audioBase64]);
      if (fail) throw new Error('忙碌');
      return {ok: true, text: '第二次成功'};
    },
    onState: state => states.push(state),
    onResult: result => results.push(result),
    onError: (message, failed) => failures.push([message, failed])
  });
  await session.start();
  audio.emit();
  await session.stop(true);
  assert.equal(failures.length, 1);
  const [message, failed] = failures[0];
  assert.equal(message, '忙碌');
  assert.equal(failed.send, true);
  assert.equal(failed.audioBase64, calls[1][2]);
  assert.equal(calls[0][1], calls[1][1], 'prepare and transcribe share one id');

  fail = false;
  states.length = 0;
  await session.retry(failed.audioBase64, failed.send);
  assert.deepEqual(states, ['transcribing', 'idle']);
  assert.equal(calls[2][2], failed.audioBase64);
  assert.notEqual(calls[2][1], calls[1][1], 'a retry uses a new id');
  assert.deepEqual(results, [{text: '第二次成功', send: true}]);
});

test('retry is ignored unless idle and cancel aborts it without callbacks', async () => {
  const results = [];
  const errors = [];
  const signals = [];
  const session = createNativeDictationSession({
    requestTranscription: (_audio, signal) => {
      signals.push(signal);
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    },
    onResult: result => results.push(result),
    onError: error => errors.push(error)
  });
  void session.retry('UklGRg==', false);
  assert.equal(session.getState(), 'transcribing');
  void session.retry('UklGRg==', false);
  await delay(0);
  assert.equal(signals.length, 1, 'a second retry while transcribing is ignored');
  await session.cancel();
  await delay(0);
  assert.equal(signals[0].aborted, true);
  assert.equal(session.getState(), 'idle');
  assert.deepEqual(results, []);
  assert.deepEqual(errors, []);
});

test('prepareTranscription is called on start, retained during transcribe, and aborted on settlement or cancel or zero samples', async () => {
  const audio = fakeAudio();
  let prepareSignals = [];
  let resolveTranscription;
  let rejectTranscription;

  // Case 1: normal flow with success settlement
  const session1 = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    prepareTranscription: signal => prepareSignals.push(signal),
    requestTranscription: () =>
      new Promise((resolve, reject) => {
        resolveTranscription = resolve;
        rejectTranscription = reject;
      })
  });

  await session1.start();
  assert.equal(prepareSignals.length, 1);
  const signal1 = prepareSignals[0];
  assert.equal(signal1.aborted, false);
  audio.emit();

  const stopPromise = session1.stop(false);
  assert.equal(session1.getState(), 'transcribing');
  await delay(0);
  // NOT aborted at the moment requestTranscription is invoked
  assert.equal(signal1.aborted, false);

  resolveTranscription({ok: true, text: '成功'});
  await stopPromise;
  assert.equal(session1.getState(), 'idle');
  assert.equal(signal1.aborted, true, 'aborted after success settlement');

  // Case 2: failure settlement
  prepareSignals = [];
  const session2 = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    prepareTranscription: signal => prepareSignals.push(signal),
    requestTranscription: () =>
      new Promise((_, reject) => {
        rejectTranscription = reject;
      })
  });
  await session2.start();
  assert.equal(prepareSignals.length, 1);
  const signal2 = prepareSignals[0];
  assert.equal(signal2.aborted, false);
  audio.emit();
  const stop2 = session2.stop(false);
  await delay(0);
  assert.equal(signal2.aborted, false);
  rejectTranscription(new Error('辨識失敗'));
  await stop2;
  assert.equal(session2.getState(), 'idle');
  assert.equal(signal2.aborted, true, 'aborted after failure settlement');

  // Case 3: cancel
  prepareSignals = [];
  const session3 = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    prepareTranscription: signal => prepareSignals.push(signal),
    requestTranscription: async () => ({ok: true, text: ''})
  });
  await session3.start();
  assert.equal(prepareSignals.length, 1);
  const signal3 = prepareSignals[0];
  assert.equal(signal3.aborted, false);
  session3.cancel();
  assert.equal(session3.getState(), 'idle');
  assert.equal(signal3.aborted, true, 'aborted on cancel');

  // Case 4: stop with zero samples
  prepareSignals = [];
  const session4 = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    prepareTranscription: signal => prepareSignals.push(signal),
    requestTranscription: async () => ({ok: true, text: ''})
  });
  await session4.start();
  assert.equal(prepareSignals.length, 1);
  const signal4 = prepareSignals[0];
  assert.equal(signal4.aborted, false);
  // No audio emitted -> sampleCount === 0
  await session4.stop(false);
  assert.equal(session4.getState(), 'idle');
  assert.equal(signal4.aborted, true, 'aborted on stop with zero samples');

  // Case 5: omitted prepareTranscription still works
  const session5 = createNativeDictationSession({
    acquireStream: async () => audio.stream,
    createAudioContext: () => audio.context,
    requestTranscription: async () => ({ok: true, text: '無預載正常運作'})
  });
  await session5.start();
  audio.emit();
  await session5.stop(false);
  assert.equal(session5.getState(), 'idle');
});
