const DEFAULT_TIMEOUT_MS = 15_000;
const STATUS_POLL_MS = 50;

/**
 * Owns one dictation session without depending on React or importing the
 * adapter implementation. The adapter is injected by the UI.
 */
export function createDictationSession({
  adapter,
  onState = () => {},
  onResult = () => {},
  onError = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!adapter || typeof adapter.listen !== "function") {
    throw new TypeError("A dictation adapter with listen() is required");
  }

  let state = "idle";
  let session = null;
  let transcript = "";
  let stopRequested = false;
  let sendIntent = false;
  let settled = true;
  let timeoutTimer = null;
  let pollTimer = null;
  let subscriptions = [];
  let settlePromise;
  let completion = Promise.resolve();

  const setState = (next) => {
    if (state === next) return;
    state = next;
    onState(next);
  };

  const dispose = () => {
    if (timeoutTimer !== null) clearTimeout(timeoutTimer);
    if (pollTimer !== null) clearTimeout(pollTimer);
    timeoutTimer = null;
    pollTimer = null;
    for (const unsubscribe of subscriptions.splice(0)) {
      try { unsubscribe(); } catch { /* best-effort adapter cleanup */ }
    }
  };

  const settle = (kind, message) => {
    if (settled) return;
    settled = true;
    const finishedSession = session;
    dispose();
    const finalText = transcript;
    session = null;
    // Close a failed recognizer only after making callbacks inert and removing
    // listeners; abort may synchronously emit a final/end event.
    if (kind === "error") {
      try { finishedSession?.cancel(); } catch { /* report the original failure */ }
    }
    setState("idle");
    if (kind === "result") onResult({ text: finalText, send: sendIntent });
    else if (kind === "error") onError(message, finalText);
    settlePromise?.();
  };

  const failFromStatus = () => {
    const status = session?.status;
    if (status?.type !== "ended") return false;
    if (status.reason === "error") {
      settle("error", "語音辨識發生錯誤");
      return true;
    }
    if (status.reason === "cancelled") {
      settle("error", "語音辨識已取消");
      return true;
    }
    if (status.reason === "stopped") {
      settle("result");
      return true;
    }
    return false;
  };

  const monitor = () => {
    if (settled || !session) return;
    const status = session.status;
    if (status?.type === "ended") {
      failFromStatus();
      return;
    }
    if (status?.type === "running" && !stopRequested) {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      timeoutTimer = null;
      setState("recording");
    }
    pollTimer = setTimeout(monitor, STATUS_POLL_MS);
  };

  const start = () => {
    // Ignore rapid repeated clicks while the same session is active.
    if (!settled) return completion;
    transcript = "";
    stopRequested = false;
    sendIntent = false;
    settled = false;
    completion = new Promise((resolve) => { settlePromise = resolve; });
    setState("starting");

    try {
      // listen() starts recognition synchronously in WebSpeechDictationAdapter,
      // so subscribe immediately and reconcile its current status afterwards.
      session = adapter.listen();
      if (!session || typeof session.onSpeech !== "function") {
        throw new TypeError("The dictation adapter returned an invalid session");
      }
      subscriptions.push(session.onSpeech((result) => {
        if (settled || result?.isFinal !== true) return;
        transcript += result.transcript ?? "";
      }));
      subscriptions.push(session.onSpeechStart(() => {
        if (!settled && !stopRequested) {
          if (timeoutTimer !== null) clearTimeout(timeoutTimer);
          timeoutTimer = null;
          setState("recording");
        }
      }));
      subscriptions.push(session.onSpeechEnd((result) => {
        if (settled) return;
        // onSpeechEnd carries the complete final transcript, whereas onSpeech
        // carries individual final segments. Replace instead of appending.
        if (typeof result?.transcript === "string") transcript = result.transcript;
        // WebSpeech may emit its last final result after an error event. A
        // failed recognizer must never become a successful submission.
        if (failFromStatus()) return;
        settle("result");
      }));

      if (session.status?.type === "running") setState("recording");
      else if (session.status?.type === "ended") {
        if (!failFromStatus()) settle("result");
      }

      if (!settled) {
        if (session.status?.type !== "running") timeoutTimer = setTimeout(() => {
          if (settled) return;
          if (session?.status?.type === "running") {
            timeoutTimer = null;
            return;
          }
          if (session?.status?.type === "ended") {
            failFromStatus();
            return;
          }
          settle("error", "語音辨識啟動逾時，已取消本次聽寫");
        }, Math.max(0, timeoutMs));
        // A bounded status poll handles silent natural end and adapter errors,
        // neither of which necessarily emits an onSpeechEnd callback.
        pollTimer = setTimeout(monitor, STATUS_POLL_MS);
      }
    } catch (error) {
      settle("error", error instanceof Error ? error.message : String(error));
    }
    return completion;
  };

  const stop = (send = false) => {
    if (settled || !session) return completion;
    sendIntent = sendIntent || Boolean(send);
    if (stopRequested) return completion;
    stopRequested = true;
    setState("transcribing");

    // Keep the deadline while waiting for the adapter to finish recognition.
    if (timeoutTimer !== null) clearTimeout(timeoutTimer);
    const deadline = setTimeout(() => {
      if (settled) return;
      if (session?.status?.type === "ended") {
        failFromStatus();
        return;
      }
      settle("error", "等待語音轉錄完成逾時，已取消本次聽寫");
    }, Math.max(0, timeoutMs));
    timeoutTimer = deadline;

    try {
      Promise.resolve(session.stop()).then(() => {
        if (settled) return;
        if (session?.status?.type === "ended") failFromStatus();
      }, (error) => {
        if (!settled) {
          settle("error", error instanceof Error ? error.message : String(error));
        }
      });
    } catch (error) {
      settle("error", error instanceof Error ? error.message : String(error));
    }
    return completion;
  };

  const cancel = () => {
    if (settled) return completion;
    const activeSession = session;
    // Mark settled before cancel(): adapters may synchronously report status.
    settled = true;
    dispose();
    session = null;
    try { activeSession?.cancel(); } catch { /* explicit cancel remains final */ }
    setState("idle");
    settlePromise?.();
    return completion;
  };

  return { start, stop, cancel };
}
