import { lstat, realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { normalizeCoding } from './coding.mjs';
import { normalizeHistory } from './history.mjs';
import { DEFAULT_STATE_DIR, inspectJob, namedJobDirectory, runWorker } from './worker.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// One trusted host, one explicit workspace and model. No network listener,
// credential discovery, background daemon, automatic restart or job replay.
export async function createDispatcher({ workspace, modelRuntime, model, stateDir = DEFAULT_STATE_DIR, testRunner = null }) {
  const root = await realpath(workspace);
  if (!(await lstat(root)).isDirectory()) throw new Error('workspace must be a directory.');
  if (!model || !modelRuntime?.getModel(model.provider, model.id)) throw new Error('An explicit registered model is required.');
  const entries = new Map();
  let closing = false;

  function requestFor({ requestId, task, readFiles = [], outputFiles = [], thinkingLevel, coding = null, historyIds = [] } = {}) {
    const directory = namedJobDirectory(stateDir, requestId);
    if (typeof task !== 'string' || !task.trim()) throw new Error('A non-empty task is required.');
    if (![readFiles, outputFiles].every((list) => Array.isArray(list) && list.every((name) => typeof name === 'string'))) {
      throw new Error('File allowlists must be arrays of strings.');
    }
    return {
      directory, jobId: requestId, task, workspace: root,
      readFiles: [...new Set(readFiles)], outputFiles: [...new Set(outputFiles)],
      coding: normalizeCoding(coding, readFiles, outputFiles),
      historyIds: normalizeHistory(historyIds),
      provider: model.provider, model: model.id, requestedThinkingLevel: thinkingLevel ?? null,
    };
  }

  function assertSame(saved, request) {
    for (const key of ['jobId', 'task', 'workspace', 'readFiles', 'outputFiles', 'provider', 'model', 'requestedThinkingLevel']) {
      if (!isDeepStrictEqual(saved[key], request[key])) throw new Error('This request ID already belongs to a different request.');
    }
    // Older read/create-only records have no coding field. Omitted/null is the
    // same capability, but adding or changing edit/test grants is a new request.
    if (!isDeepStrictEqual(saved.coding ?? null, request.coding ?? null)) throw new Error('This request ID already belongs to a different request.');
    if (!isDeepStrictEqual(saved.historyIds ?? [], request.historyIds ?? [])) throw new Error('This request ID already belongs to a different request.');
  }

  function conflictsWithCoding(a, b) {
    if (!a.coding && !b.coding) return false;
    const keys = (names) => new Set(names.map((name) => {
      const resolved = path.resolve(root, name);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }));
    const writes = (request) => [...request.outputFiles, ...(request.coding?.editFiles ?? [])];
    const touches = (request) => keys([...request.readFiles, ...writes(request)]);
    const aTouches = touches(a);
    const bTouches = touches(b);
    return [...keys(writes(a))].some((name) => bTouches.has(name)) || [...keys(writes(b))].some((name) => aTouches.has(name));
  }

  async function savedResult(directory) {
    try { return await inspectJob(directory); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await lstat(directory); } catch (missing) {
        if (missing.code === 'ENOENT') return null;
        throw missing;
      }
      return { directory, status: 'unresolved', acceptance: 'not-reviewed', note: 'A reserved job directory has no readable record. Inspect it; do not resubmit with a new ID.' };
    }
  }

  function decorate(result, entry) {
    return {
      ...result,
      ...(entry && !entry.finished && result.status === 'unresolved' && result.jobId
        ? { status: 'running', note: undefined } : {}),
      cancelRequested: entry?.controller.signal.aborted ?? false,
    };
  }

  async function inspect(requestId) {
    const directory = namedJobDirectory(stateDir, requestId);
    const entry = entries.get(requestId);
    if (entry) {
      await entry.ready.promise;
      if (entry.failure) return decorate(entry.failure, entry);
    }
    const result = await savedResult(directory);
    if (!result) throw new Error('Unknown request ID.');
    return decorate(result, entry);
  }

  async function start(options) {
    if (closing) throw new Error('The dispatcher is closing; no new work accepted.');
    const request = requestFor(options);
    const known = entries.get(request.jobId);
    if (known) {
      assertSame(known.request, request);
      return inspect(request.jobId);
    }
    for (const entry of entries.values()) {
      if (!entry.finished && conflictsWithCoding(request, entry.request)) {
        throw new Error('An active coding task has overlapping file access. Wait for it to finish before starting this request.');
      }
    }
    // Reserve in memory before the first await so simultaneous duplicate calls
    // share one start. The worker's exclusive directory creation covers restarts.
    const entry = { request, controller: new AbortController(), ready: deferred(), done: deferred(), finished: false };
    entries.set(request.jobId, entry);
    void (async () => {
      try {
        const saved = await savedResult(request.directory);
        if (saved) {
          if (saved.jobId) assertSame(saved, request);
          return;
        }
        await runWorker({
          task: request.task, workspace: root, readFiles: request.readFiles, outputFiles: request.outputFiles,
          modelRuntime, model, stateDir, jobId: request.jobId, coding: request.coding, historyIds: request.historyIds, testRunner,
          ...(request.requestedThinkingLevel === null ? {} : { thinkingLevel: request.requestedThinkingLevel }),
          signal: entry.controller.signal,
          onEvent(event) { if (event.type === 'job_started') entry.ready.resolve(); },
        });
      } catch (error) {
        // A run may have written files before a persistence failure. Do not
        // report a rollback, retry, or leak arbitrary provider exception text.
        const saved = await savedResult(request.directory).catch(() => ({
          directory: request.directory, status: 'unresolved', acceptance: 'not-reviewed',
        }));
        if (error.message === 'This request ID already belongs to a different request.' && saved?.jobId) {
          // A rejected request must not poison later reads of the original ID.
          entry.request = saved;
          entry.conflict = true;
        } else {
          entry.failure = saved
            ? { ...saved, status: 'unresolved', note: 'Dispatch could not confirm its result. Inspect existing evidence before any retry.' }
            : { directory: request.directory, status: entry.controller.signal.aborted ? 'cancelled' : 'failed', acceptance: 'not-reviewed', error: 'Dispatch failed before a readable job record was available; no automatic retry.' };
        }
      } finally {
        entry.finished = true;
        entry.ready.resolve();
        entry.done.resolve();
      }
    })();
    await entry.ready.promise;
    if (entry.conflict) throw new Error('This request ID already belongs to a different request.');
    return inspect(request.jobId);
  }

  async function wait(requestId, { timeoutMs = 60_000, signal } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) throw new Error('timeoutMs must be an integer between 0 and 60000.');
    namedJobDirectory(stateDir, requestId);
    signal?.throwIfAborted();
    const entry = entries.get(requestId);
    if (!entry || entry.finished) return { ...await inspect(requestId), timedOut: false };
    let timer;
    let onAbort;
    let timedOut = false;
    try {
      await Promise.race([
        entry.done.promise,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs);
          onAbort = () => reject(signal.reason);
          signal?.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
    // Ending a wait does not cancel or replay its worker.
    return { ...await inspect(requestId), timedOut };
  }

  async function cancel(requestId) {
    namedJobDirectory(stateDir, requestId);
    const entry = entries.get(requestId);
    if (entry && !entry.finished) entry.controller.abort();
    return inspect(requestId);
  }

  async function close() {
    closing = true;
    const active = [...entries.values()];
    for (const entry of active) if (!entry.finished) entry.controller.abort();
    await Promise.all(active.map((entry) => entry.done.promise));
  }

  return { start, inspect, wait, cancel, close };
}
