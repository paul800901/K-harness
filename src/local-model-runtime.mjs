import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';

const execFile = promisify(execFileCallback);
const BASE_URL = 'http://127.0.0.1:1234';
const CATALOG_TIMEOUT_MS = 2_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const DIAGNOSTIC_LIMIT = 8000;
const PAUSED =
  '未送出推論。K 已暫停本機模型的載入、卸載與推論，不會自動重試或重送；請先查明本機模型實際狀態，再重新啟動 K。';

// The bridge maps these codes to one non-retryable reply. Messages are for the
// owner; the untranslated native CLI result stays in `diagnostic`.
function failure(code, message, {diagnostic} = {}) {
  const error = new Error(message);
  error.code = code;
  if (diagnostic) error.diagnostic = diagnostic;
  return error;
}

function clip(value) {
  const text = typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';
  return text.length > DIAGNOSTIC_LIMIT ? '…' + text.slice(-DIAGNOSTIC_LIMIT) : text;
}

function cliDiagnostic(args, error) {
  return {
    command: ['lms', ...args].join(' '),
    exitCode: typeof error?.code === 'number' ? error.code : null,
    signal: error?.signal ?? null,
    error: typeof error?.code === 'number' ? null : String(error?.message ?? error),
    stdout: clip(error?.stdout),
    stderr: clip(error?.stderr)
  };
}

function abortError() {
  return new DOMException('The operation was aborted', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? abortError();
}

function loadedInstances(model) {
  return Array.isArray(model?.loaded_instances) ? model.loaded_instances : [];
}

function keyOf(model) {
  return model?.key;
}

function isGgufLlm(model) {
  return model?.type === 'llm' && model?.format === 'gguf';
}

function parseModels(payload) {
  const models = payload?.models;
  if (!Array.isArray(models)) throw new Error('LM Studio 回傳的模型目錄格式無效');
  return models;
}

function parseLmsList(payload) {
  if (!Array.isArray(payload)) throw new Error('lms ls --json 回傳的模型目錄格式無效');
  return payload.map(model => ({...model, key: model.modelKey, max_context_length: model.maxContextLength}));
}

function makeDefaultRun(executable) {
  return (args, {signal} = {}) => {
    throwIfAborted(signal);
    return execFile(executable, args, {windowsHide: true, maxBuffer: MAX_BUFFER, signal});
  };
}

export function createLocalModelRuntime({executable, fetchImpl = fetch, runImpl} = {}) {
  if (!executable || typeof executable !== 'string') throw new TypeError('executable 必須是 lms CLI 路徑');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl 必須是函式');
  const run = runImpl ?? makeDefaultRun(executable);
  if (typeof run !== 'function') throw new TypeError('runImpl 必須是函式');

  const owned = new Map();
  let busy = false;
  // The first unconfirmed load/unload/inference result. It is kept until K
  // restarts; nothing here clears it, retries or replays the work.
  let uncertain = null;
  const unknown = (reason, diagnostic, code = 'k_selfhost_state_unknown') => {
    uncertain ??= {reason, ...(diagnostic ? {diagnostic} : {})};
    return failure(code, `${reason}；${PAUSED}`, {diagnostic});
  };
  const errorText = error => String(error?.message ?? error);

  async function getCatalog({signal} = {}) {
    throwIfAborted(signal);
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(new DOMException('LM Studio metadata request timed out', 'TimeoutError')),
      CATALOG_TIMEOUT_MS
    );
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
    try {
      const response = await fetchImpl(`${BASE_URL}/api/v1/models`, {signal: combinedSignal, redirect: 'error'});
      if (!response.ok) {
        const error = new Error(`LM Studio 模型目錄讀取失敗（HTTP ${response.status}）`);
        error.status = response.status;
        throw error;
      }
      return parseModels(await response.json());
    } finally {
      clearTimeout(timer);
    }
  }

  async function fallbackCatalog(signal) {
    throwIfAborted(signal);
    let result;
    try {
      result = await run(['ls', '--json'], {signal});
    } catch {
      throwIfAborted(signal);
      throw new Error('無法讀取本機模型目錄（lms ls --json 執行失敗）');
    }
    let payload;
    try {
      payload = JSON.parse(typeof result === 'string' ? result : (result?.stdout ?? ''));
    } catch {
      throw new Error('lms ls --json 回傳的模型目錄格式無效');
    }
    return {models: parseLmsList(payload)};
  }

  async function serviceModels(signal) {
    try {
      return await getCatalog({signal});
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      // Only connection-level failures indicate that the local service is offline.
      if (error?.name === 'TypeError' || error?.code === 'ECONNREFUSED' || error?.code === 'ECONNRESET') return null;
      throw error;
    }
  }

  async function ensureService(signal) {
    const initial = await serviceModels(signal);
    if (initial) return initial;
    throwIfAborted(signal);
    for (const [args, message] of [
      [['daemon', 'up'], '無法啟動 LM Studio 本機背景服務'],
      [['server', 'start', '--port', '1234', '--bind', '127.0.0.1'], '無法啟動本機 LM Studio 服務']
    ]) {
      try {
        await run(args, {signal});
      } catch (error) {
        throwIfAborted(signal);
        throw failure('k_selfhost_prepare_failed', `${message}；未載入模型、未送出推論。`, {
          diagnostic: cliDiagnostic(args, error)
        });
      }
    }
    try {
      return await getCatalog({signal});
    } catch {
      throwIfAborted(signal);
      throw new Error('LM Studio 服務啟動後無法讀回模型目錄');
    }
  }

  function assertNoForeignLlm(models) {
    for (const model of models) {
      if (model?.type !== 'llm') continue;
      for (const instance of loadedInstances(model)) {
        const id = instance?.id;
        if (!id || owned.get(id) !== keyOf(model))
          throw new Error(
            `發現非 K 載入的語言模型執行個體（${id ?? '未知識別碼'}）；為避免卸載外部模型，已停止操作，未送出推論。`
          );
      }
    }
  }

  function findInstance(models, instanceId) {
    for (const model of models) {
      const instance = loadedInstances(model).find(item => item?.id === instanceId);
      if (instance) return {model, instance};
    }
    return null;
  }

  async function unloadOwned(instanceId, signal) {
    try {
      await fetchImpl(`${BASE_URL}/api/v1/models/unload`, {
        method: 'POST',
        redirect: 'error',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({instance_id: instanceId}),
        signal
      }).then(response => {
        if (!response.ok) throw new Error(`LM Studio 卸載失敗（HTTP ${response.status}）`);
      });
    } catch (error) {
      throw unknown('卸載結果不明', {error: errorText(error)});
    }
    let models;
    try {
      models = await getCatalog({signal});
    } catch (error) {
      throw unknown('卸載後讀回失敗', {error: errorText(error)});
    }
    if (findInstance(models, instanceId)) throw unknown(`卸載命令後模型執行個體 ${instanceId} 仍存在`);
    owned.delete(instanceId);
    return models;
  }

  function reconcileOwned(models) {
    for (const [id] of owned) {
      if (!findInstance(models, id)) owned.delete(id);
    }
  }

  return {
    async close() {
      // Normal idle shutdown must not leave an unowned instance behind for the
      // next K launch. Unknown/in-flight work is never stopped as cleanup.
      if (busy || uncertain || !owned.size) return;
      busy = true;
      try {
        let models = await getCatalog();
        for (const [id, key] of owned) {
          const existing = findInstance(models, id);
          if (existing && keyOf(existing.model) !== key) throw new Error('本機模型執行個體已被外部替換；未卸載任何模型');
        }
        reconcileOwned(models);
        for (const [id] of owned) models = await unloadOwned(id);
      } finally {
        busy = false;
      }
    },
    async catalog({signal} = {}) {
      try {
        const models = await getCatalog({signal});
        return {models};
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (error?.status || error?.name === 'SyntaxError' || error?.message?.includes('格式無效')) throw error;
        return fallbackCatalog(signal);
      }
    },

    async acquire({model, instanceId, contextWindow, signal} = {}) {
      if (uncertain)
        throw failure('k_selfhost_state_unknown', `本機模型狀態不明（先前：${uncertain.reason}）；${PAUSED}`, {
          diagnostic: uncertain.diagnostic
        });
      if (busy)
        throw failure(
          'k_selfhost_busy',
          '本機模型目前忙碌中，未建立佇列、未送出推論；請待目前工作結束後再送出。'
        );
      busy = true;
      let leaseActive = false;
      try {
        throwIfAborted(signal);
        if (typeof model !== 'string' || !model || typeof instanceId !== 'string' || !instanceId)
          throw new TypeError('model 與 instanceId 必須是非空字串');
        if (!Number.isSafeInteger(contextWindow) || contextWindow < 1)
          throw new TypeError('contextWindow 必須是正整數');

        let models = await ensureService(signal);
        assertNoForeignLlm(models);
        reconcileOwned(models);
        const entry = models.find(item => keyOf(item) === model);
        if (!entry) throw new Error(`本機模型目錄中找不到確切的模型識別碼：${model}；未送出推論。`);
        if (!isGgufLlm(entry)) throw new Error(`模型 ${model} 不是 GGUF 語言模型；未送出推論。`);
        if (!Number.isSafeInteger(entry.max_context_length) || contextWindow > entry.max_context_length) {
          throw new Error(
            `模型 ${model} 的最大上下文長度為 ${entry.max_context_length ?? '未知'}，不能設為 ${contextWindow}；未送出推論。`
          );
        }

        let loaded = findInstance(models, instanceId);
        const reusable =
          loaded &&
          owned.get(instanceId) === model &&
          keyOf(loaded.model) === model &&
          loaded.instance.config?.context_length === contextWindow &&
          loaded.instance.config?.parallel === 1;
        if (owned.has(instanceId) && !reusable) {
          models = await unloadOwned(instanceId, signal);
          assertNoForeignLlm(models);
          loaded = null;
        }
        // A different owned idle instance can be released; foreign instances were rejected above.
        if (!reusable) {
          for (const [ownedId] of [...owned]) {
            if (ownedId === instanceId) continue;
            models = await unloadOwned(ownedId, signal);
            assertNoForeignLlm(models);
          }
          // Only options that apply to GGUF/llama.cpp loads. Engine config files
          // are vLLM-only: LM Studio rejected a GGUF load given
          // --no-engine-config-file. Draft/MTP flags stay at native defaults.
          const args = [
            'load',
            model,
            '--port',
            '1234',
            '--identifier',
            instanceId,
            '--context-length',
            String(contextWindow),
            '--parallel',
            '1',
            '--yes'
          ];
          try {
            // Let this one native load finish and read it back even if the
            // caller stops. The bridge checks cancellation before inference.
            // Killing the CLI would not prove that engine loading stopped.
            await run(args, {});
          } catch (error) {
            // An exit code proves only that the CLI reported failure, not that
            // the engine will never finish; keep the state unknown either way.
            const diagnostic = cliDiagnostic(args, error);
            throw diagnostic.exitCode === null
              ? unknown('載入命令結果不明', diagnostic)
              : unknown(`LM Studio 回報無法載入模型 ${model}（原始原因見詳細內容）`, diagnostic, 'k_selfhost_load_failed');
          }
          // A completed CLI call makes this instance manager-owned, but lease is withheld until exact readback.
          owned.set(instanceId, model);
          try {
            models = await getCatalog();
          } catch (error) {
            throw unknown('載入後讀回失敗', {error: errorText(error)});
          }
          loaded = findInstance(models, instanceId);
        }
        const goodReadback =
          loaded &&
          keyOf(loaded.model) === model &&
          loaded.instance.config?.context_length === contextWindow &&
          loaded.instance.config?.parallel === 1;
        if (!goodReadback)
          throw unknown(`LM Studio 讀回的模型執行個體 ${instanceId} 與要求不符`, {
            readback: loaded ? {model: keyOf(loaded.model), instance: loaded.instance} : null
          });

        leaseActive = true;
        let finished = false;
        return {
          model: instanceId,
          async finish({settled = true, cancelled = false} = {}) {
            if (finished) return;
            finished = true;
            try {
              // A cancelled bridge owns this sole request. Explicitly release its
              // exact instance and confirm removal; aborting HTTP alone does not
              // prove that the engine stopped. Never do this for an upstream fault.
              if (!settled && cancelled) await unloadOwned(instanceId);
              else if (!settled) uncertain ??= {reason: '上一次推論結果未確認'};
            } finally {
              leaseActive = false;
              busy = false;
            }
          }
        };
      } finally {
        if (!leaseActive) busy = false;
      }
    }
  };
}
