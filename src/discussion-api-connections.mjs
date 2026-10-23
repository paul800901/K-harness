import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomicWrite} from './atomic-write.mjs';

const validId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
export function discussionApiBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('請填寫有效的 API Base URL。');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('外部 API 必須使用 HTTPS；網址不能包含金鑰或登入資訊。');
  return url.href.replace(/\/+$/u, '');
}
export function createDiscussionKeyVault({root, env = process.env, invoke} = {}) {
  const namespace = createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex');
  const helper = fileURLToPath(new URL('../scripts/discussion-api-credentials.ps1', import.meta.url));
  const call =
    invoke ??
    (payload =>
      new Promise((resolve, reject) => {
        const child = spawn(
          path.join(env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper],
          {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']}
        );
        let stdout = '',
          settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          error ? reject(error) : resolve(value);
        };
        const timer = setTimeout(() => {
          child.kill();
          finish(Error('Windows API 金鑰操作未確認；請重試設定。'));
        }, 15000);
        child.on('error', () => finish(Error('Windows API 金鑰保存不可用。')));
        child.stdin.on('error', () => {});
        child.stdout.on('data', b => {
          stdout += b.toString();
        });
        child.stderr.resume();
        child.once('close', code => {
          if (code !== 0) return finish(Error('Windows API 金鑰操作失敗。'));
          try {
            finish(null, JSON.parse(stdout));
          } catch {
            finish(Error('Windows API 金鑰讀回未確認。'));
          }
        });
        child.stdin.end(JSON.stringify(payload));
      }));
  const request = (operation, id, secret) => {
    if (!validId(id)) throw Error('API 連線識別碼無效。');
    return call({
      operation,
      target: `K-Harness.DiscussionApi.${namespace}.${id}`,
      ...(secret === undefined ? {} : {secret})
    });
  };
  return {
    async get(id) {
      return (await request('read', id)).secret ?? null;
    },
    async set(id, key) {
      await request('write', id, key);
    },
    async remove(id) {
      await request('remove', id);
    }
  };
}
function modelRows(rows) {
  if (!Array.isArray(rows)) throw Error('API 模型清單格式無效。');
  const models = rows.map(m => {
    const id = m.id ?? m.model;
    if (typeof id !== 'string' || !id.trim() || /[\x00-\x1f]/u.test(id)) throw Error('請填寫官方 API 模型 ID。');
    const efforts = m.effort?.supported_levels ?? m.efforts ?? [];
    return {
      id: id.trim(),
      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : id.trim(),
      ...(Array.isArray(efforts) && efforts.length ? {efforts: efforts.filter(e => typeof e === 'string' && e)} : {}),
      ...(typeof (m.effort?.default_level ?? m.defaultEffort) === 'string'
        ? {defaultEffort: m.effort?.default_level ?? m.defaultEffort}
        : {}),
      ...(Number.isSafeInteger(m.context_window ?? m.contextWindow)
        ? {contextWindow: m.context_window ?? m.contextWindow}
        : {})
    };
  });
  return [...new Map(models.map(m => [m.id, m])).values()];
}
export function createDiscussionApiConnections({
  root,
  vault = createDiscussionKeyVault({root}),
  fetchImpl = fetch,
  isBusy = () => false
} = {}) {
  const file = path.join(root, '.local/discussion-api-connections.json');
  let mutation = false,
    workers = 0;
  const read = async () => {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(data.connections)) throw Error('API 連線設定格式無效。');
      return data.connections;
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  };
  const safe = row => ({
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    keyConfigured: row.keyConfigured === true,
    models: row.models ?? [],
    ...(row.catalogCheckedAt ? {catalogCheckedAt: row.catalogCheckedAt} : {})
  });
  const exclusive = async fn => {
    if (mutation || workers || isBusy()) throw Error('討論正在使用 API 連線或 API 子代理執行中；請等結束後再修改。');
    mutation = true;
    try {
      return await fn();
    } finally {
      mutation = false;
    }
  };
  const get = async id => {
    if (!validId(id)) throw Error('API 連線識別碼無效。');
    const row = (await read()).find(r => r.id === id);
    if (!row) throw Error('找不到已保存的 API 連線。');
    return row;
  };
  return {
    async list() {
      return {connections: (await read()).map(safe)};
    },
    async models() {
      return {
        models: (await read())
          .filter(c => c.keyConfigured)
          .flatMap(c =>
            c.models.map(m => ({
              route: 'api',
              connectionId: c.id,
              model: m.id,
              displayName: m.name,
              providerLabel: c.name,
              available: true,
              supportedReasoningEfforts: m.efforts ?? [],
              defaultReasoningEffort: m.defaultEffort ?? null
            }))
          )
      };
    },
    // An API consult worker holds the connections while it runs, so its URL and key come from one saved version.
    lease() {
      if (mutation) throw Error('API 連線正在更新；未開始 API 子代理。');
      workers++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          workers--;
        }
      };
    },
    async resolve(choice) {
      if (mutation) throw Error('API 連線正在更新；未開始討論。');
      const row = await get(choice.connectionId),
        model = row.models.find(m => m.id === choice.model);
      if (choice.route !== 'api' || !row.keyConfigured || !model) throw Error('API 模型不在本次討論可用清單；未換模。');
      if (choice.effort && !(model.efforts ?? []).includes(choice.effort)) throw Error('API 模型不支援所選推理程度。');
      return {
        route: 'api',
        connectionId: row.id,
        model: model.id,
        displayName: `${model.name} · ${row.name} API`,
        effort: choice.effort || model.defaultEffort || null
      };
    },
    async credentials(id) {
      const row = await get(id),
        key = await vault.get(id);
      if (!key) throw Error('請在設定填寫這個討論 API 的金鑰。');
      return {baseUrl: discussionApiBaseUrl(row.baseUrl), key};
    },
    save(data) {
      return exclusive(async () => {
        const rows = await read(),
          existing = data.id ? await get(data.id) : null,
          id = existing?.id ?? randomUUID().replaceAll('-', '');
        if (typeof data.name !== 'string' || !data.name.trim()) throw Error('請填寫 API 供應商名稱。');
        const baseUrl = discussionApiBaseUrl(data.baseUrl),
          models = modelRows(data.models ?? existing?.models ?? []),
          apiKey = data.apiKey;
        if (apiKey !== undefined && typeof apiKey !== 'string') throw Error('API Key 格式無效。');
        if (!existing && !apiKey?.trim()) throw Error('請自行填寫 API Key。');
        if (existing && baseUrl !== existing.baseUrl && !apiKey?.trim())
          throw Error('更換服務網址時請重新填寫該服務的 API Key。');
        if (apiKey?.trim()) await vault.set(id, apiKey.trim());
        const preserved = models.map(m => ({
          ...(baseUrl === existing?.baseUrl ? existing.models.find(old => old.id === m.id) : {}),
          ...m
        }));
        const row = {
          id,
          name: data.name.trim(),
          baseUrl,
          keyConfigured: !!apiKey?.trim() || existing?.keyConfigured === true,
          models: preserved
        };
        if (existing?.catalogCheckedAt && baseUrl === existing.baseUrl)
          row.catalogCheckedAt = existing.catalogCheckedAt;
        await atomicWrite(file, JSON.stringify({connections: [...rows.filter(r => r.id !== id), row]}, null, 2));
        return {connection: safe(row)};
      });
    },
    discover({id}) {
      return exclusive(async () => {
        const row = await get(id),
          key = await vault.get(id);
        if (!key) throw Error('請先填寫 API Key。');
        let response;
        try {
          response = await fetchImpl(`${discussionApiBaseUrl(row.baseUrl)}/models`, {
            headers: {Authorization: `Bearer ${key}`},
            redirect: 'error',
            signal: AbortSignal.timeout(30000)
          });
        } catch {
          throw Error('API 模型目錄查詢失敗；沒有自動重試。');
        }
        if (!response.ok) throw Error(`API 模型目錄查詢失敗（HTTP ${response.status}）；可手動填官方模型 ID。`);
        let data;
        try {
          data = await response.json();
        } catch {
          throw Error('API 模型目錄回傳格式無效。');
        }
        row.models = modelRows(data.data);
        row.catalogCheckedAt = new Date().toISOString();
        const rows = await read();
        await atomicWrite(file, JSON.stringify({connections: rows.map(r => (r.id === id ? row : r))}, null, 2));
        return {connection: safe(row)};
      });
    },
    remove({id}) {
      return exclusive(async () => {
        await get(id);
        await vault.remove(id);
        const rows = await read();
        await atomicWrite(file, JSON.stringify({connections: rows.filter(r => r.id !== id)}, null, 2));
        return {removed: true};
      });
    }
  };
}
