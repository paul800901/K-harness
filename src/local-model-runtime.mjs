import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';

const execFile = promisify(execFileCallback);
const BASE_URL = 'http://127.0.0.1:1234';
const CATALOG_TIMEOUT_MS = 2_000;
const MAX_BUFFER = 10 * 1024 * 1024;

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
  let uncertain = false;

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
    try {
      await run(['daemon', 'up'], {signal});
    } catch {
      throwIfAborted(signal);
      throw new Error('無法啟動 LM Studio 本機 daemon');
    }
    try {
      await run(['server', 'start', '--port', '1234', '--bind', '127.0.0.1'], {signal});
    } catch {
      throwIfAborted(signal);
      throw new Error('無法啟動本機 LM Studio 服務');
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
          throw new Error(`發現非本管理器載入的 LLM instance（${id ?? '未知識別碼'}），為避免卸載外部模型已停止操作`);
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
      uncertain = true;
      throw new Error(`卸載結果不明；已停止後續載入，請先由外部釐清：${error.message}`, {cause: error});
    }
    let models;
    try {
      models = await getCatalog({signal});
    } catch (error) {
      uncertain = true;
      throw new Error(`卸載後讀回失敗；已停止後續載入，請先由外部釐清：${error.message}`, {cause: error});
    }
    if (findInstance(models, instanceId)) {
      uncertain = true;
      throw new Error('卸載命令後 instance 仍存在；已停止後續載入，請先由外部釐清');
    }
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
          if (existing && keyOf(existing.model) !== key) throw new Error('本機 instance 已被外部替換；未卸載任何模型');
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
      if (uncertain) throw new Error('本機模型狀態不明；請先由外部釐清，暫停載入、卸載與推論');
      if (busy) throw new Error('本機模型目前忙碌中，未建立佇列；請待目前工作結束後再試');
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
        if (!entry) throw new Error(`本機模型目錄中找不到確切模型 key：${model}`);
        if (!isGgufLlm(entry)) throw new Error(`模型 ${model} 不是 GGUF LLM`);
        if (!Number.isSafeInteger(entry.max_context_length) || contextWindow > entry.max_context_length) {
          throw new Error(
            `模型 ${model} 的最大 context 為 ${entry.max_context_length ?? '未知'}，不允許 ${contextWindow}`
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
          try {
            await run(
              [
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
                '--no-engine-config-file',
                '--no-speculative-draft-mtp',
                '--yes'
              ],
              // Let this one native load finish and read it back even if the
              // caller stops. The bridge checks cancellation before inference.
              // Killing the CLI would not prove that engine loading stopped.
              {}
            );
          } catch {
            uncertain = true;
            throw new Error('載入命令結果不明；已停止後續載入，請先由外部釐清');
          }
          // A completed CLI call makes this instance manager-owned, but lease is withheld until exact readback.
          owned.set(instanceId, model);
          try {
            models = await getCatalog();
          } catch (error) {
            uncertain = true;
            throw new Error(`載入後讀回失敗；已停止後續載入，請先由外部釐清：${error.message}`, {cause: error});
          }
          loaded = findInstance(models, instanceId);
        }
        const goodReadback =
          loaded &&
          keyOf(loaded.model) === model &&
          loaded.instance.config?.context_length === contextWindow &&
          loaded.instance.config?.parallel === 1;
        if (!goodReadback) {
          uncertain = true;
          throw new Error(`LM Studio 讀回的 instance ${instanceId} 與要求不符，已停止後續載入與推論`);
        }

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
              else if (!settled) uncertain = true;
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
