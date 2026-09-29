import test from "node:test";
import assert from "node:assert/strict";
import { createDictationSession } from "../frontend/dictation-session.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeAdapter({ syncRunning = true, cancelEmitsEnd = false } = {}) {
  const control = { session: null, listenCount: 0 };
  const adapter = {
    listen() {
      control.listenCount += 1;
      const speech = new Set();
      const starts = new Set();
      const ends = new Set();
      const session = {
        status: { type: syncRunning ? "running" : "starting" },
        stopCount: 0,
        cancelCount: 0,
        unsubscribeCount: 0,
        stop() {
          session.stopCount += 1;
          return new Promise((resolve) => { session.resolveStop = resolve; });
        },
        cancel() {
          session.cancelCount += 1;
          session.status = { type: "ended", reason: "cancelled" };
          if (cancelEmitsEnd) for (const fn of ends) fn({ transcript: "取消時晚到全文" });
        },
        onSpeech(fn) { speech.add(fn); return () => { speech.delete(fn); session.unsubscribeCount += 1; }; },
        onSpeechStart(fn) { starts.add(fn); return () => { starts.delete(fn); session.unsubscribeCount += 1; }; },
        onSpeechEnd(fn) { ends.add(fn); return () => { ends.delete(fn); session.unsubscribeCount += 1; }; },
        emitSpeech(transcript, isFinal) { for (const fn of speech) fn({ transcript, isFinal }); },
        emitStart() { for (const fn of starts) fn(); },
        end(reason = "stopped", transcript = "") {
          session.status = { type: "ended", reason };
          if (transcript) for (const fn of ends) fn({ transcript });
          session.resolveStop?.();
        },
        emitEnd(transcript) { for (const fn of ends) fn({ transcript }); },
      };
      control.session = session;
      return session;
    },
  };
  return { adapter, control };
}

test("stop(send=true) returns only final text and transcribing send click upgrades intent", async () => {
  const { adapter, control } = fakeAdapter();
  const results = [];
  const states = [];
  const flow = createDictationSession({ adapter, onResult: (r) => results.push(r), onState: (s) => states.push(s) });
  const done = flow.start();
  control.session.emitSpeech("discard interim", false);
  control.session.emitSpeech("你好", true);
  flow.stop(false);
  flow.stop(true);
  control.session.end("stopped", "你好");
  await done;
  assert.deepEqual(results, [{ text: "你好", send: true }]);
  assert.equal(control.session.stopCount, 1);
  assert.ok(states.includes("transcribing"));
  assert.equal(control.session.unsubscribeCount, 3);
});

test("natural end preserves final transcript but never sends", async () => {
  const { adapter, control } = fakeAdapter();
  const results = [];
  const flow = createDictationSession({ adapter, onResult: (r) => results.push(r) });
  const done = flow.start();
  control.session.emitSpeech("自然結束", true);
  control.session.end("stopped", "自然結束");
  await done;
  assert.deepEqual(results, [{ text: "自然結束", send: false }]);
});

test("cancel suppresses late callbacks and clears adapter subscriptions", async () => {
  const { adapter, control } = fakeAdapter();
  const results = [];
  const errors = [];
  const flow = createDictationSession({ adapter, onResult: (r) => results.push(r), onError: (...args) => errors.push(args) });
  const done = flow.start();
  control.session.emitSpeech("確認過的字", true);
  flow.cancel();
  control.session.emitSpeech("晚到", true);
  control.session.end("stopped", "確認過的字晚到");
  await done;
  assert.deepEqual(results, []);
  assert.deepEqual(errors, []);
  assert.equal(control.session.cancelCount, 1);
  assert.equal(control.session.unsubscribeCount, 3);
});

test("adapter error reports confirmed text without submitting", async () => {
  const { adapter, control } = fakeAdapter();
  const results = [];
  const errors = [];
  const flow = createDictationSession({ adapter, onResult: (r) => results.push(r), onError: (...args) => errors.push(args) });
  const done = flow.start();
  control.session.emitSpeech("已確認", true);
  control.session.status = { type: "ended", reason: "error" };
  // The adapter can still emit its accumulated final transcript after error.
  control.session.emitEnd("完整已確認文字");
  await done;
  assert.deepEqual(results, []);
  assert.deepEqual(errors, [["語音辨識發生錯誤", "完整已確認文字"]]);
  assert.equal(control.session.cancelCount, 1);
});

test("adapter cancellation completes the UI job as an error with confirmed text", async () => {
  const { adapter, control } = fakeAdapter();
  const errors = [];
  const results = [];
  const flow = createDictationSession({ adapter, onError: (...args) => errors.push(args), onResult: (r) => results.push(r) });
  const done = flow.start();
  control.session.emitSpeech("已確認片段", true);
  control.session.status = { type: "ended", reason: "cancelled" };
  control.session.emitEnd("已確認全文");
  await done;
  assert.deepEqual(errors, [["語音辨識已取消", "已確認全文"]]);
  assert.deepEqual(results, []);
});

test("error settle is exactly once when cancel synchronously emits onSpeechEnd", async () => {
  const { adapter, control } = fakeAdapter({ cancelEmitsEnd: true });
  const errors = [];
  const results = [];
  const flow = createDictationSession({ adapter, onError: (...args) => errors.push(args), onResult: (r) => results.push(r) });
  const done = flow.start();
  control.session.emitSpeech("已確認", true);
  control.session.status = { type: "ended", reason: "error" };
  control.session.emitEnd("辨識器提供的全文");
  await done;
  assert.deepEqual(errors, [["語音辨識發生錯誤", "辨識器提供的全文"]]);
  assert.deepEqual(results, []);
  assert.equal(control.session.cancelCount, 1);
});

test("timeout cancels, reports confirmed text, and does not submit", async () => {
  const { adapter, control } = fakeAdapter({ syncRunning: false });
  const results = [];
  const errors = [];
  const flow = createDictationSession({ adapter, timeoutMs: 20, onResult: (r) => results.push(r), onError: (...args) => errors.push(args) });
  const done = flow.start();
  control.session.emitSpeech("逾時前文字", true);
  await done;
  assert.deepEqual(results, []);
  assert.deepEqual(errors, [["語音辨識啟動逾時，已取消本次聽寫", "逾時前文字"]]);
  assert.equal(control.session.cancelCount, 1);
});

test("15-second-style timeout is startup/stop deadline, not a recording limit", async () => {
  const { adapter, control } = fakeAdapter();
  const results = [];
  const errors = [];
  const flow = createDictationSession({ adapter, timeoutMs: 20, onResult: (r) => results.push(r), onError: (...args) => errors.push(args) });
  const done = flow.start();
  await delay(35); // longer than the configured startup deadline, but already running
  control.session.emitSpeech("長句", true);
  flow.stop(true);
  control.session.end("stopped", "長句");
  await done;
  assert.deepEqual(errors, []);
  assert.deepEqual(results, [{ text: "長句", send: true }]);
});

test("stop rejection cancels recognizer before reporting error", async () => {
  const { adapter, control } = fakeAdapter();
  const errors = [];
  const flow = createDictationSession({ adapter, onError: (...args) => errors.push(args) });
  const done = flow.start();
  control.session.stop = () => Promise.reject(new Error("stop failed"));
  flow.stop(true);
  await done;
  assert.equal(control.session.cancelCount, 1);
  assert.deepEqual(errors, [["stop failed", ""]]);
});

test("double start and stop do not create or submit duplicate sessions", async () => {
  const { adapter, control } = fakeAdapter();
  const results = [];
  const flow = createDictationSession({ adapter, onResult: (r) => results.push(r) });
  const done = flow.start();
  flow.start();
  control.session.emitSpeech("一次", true);
  flow.stop(true);
  flow.stop(false);
  control.session.end("stopped", "一次");
  await done;
  await delay(5);
  assert.equal(control.listenCount, 1);
  assert.equal(control.session.stopCount, 1);
  assert.deepEqual(results, [{ text: "一次", send: true }]);
});
