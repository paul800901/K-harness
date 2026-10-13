import React, {useEffect, useState} from 'react';
import './discussion-api-settings.css';

const DEEPSEEK_URL = 'https://api.deepseek.com';
const EMPTY_FORM = {id: '', provider: 'deepseek', name: '', baseUrl: DEEPSEEK_URL, apiKey: '', models: ''};

export function DiscussionApiSettings({request, disabled = false}) {
  const [connections, setConnections] = useState([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState('');
  const [form, setForm] = useState(EMPTY_FORM),
    [editing, setEditing] = useState(false),
    [notice, setNotice] = useState('');
  const locked = disabled || !!busy;
  const readConnections = async () => {
    setLoading(true);
    setNotice('');
    try {
      const result = await request('discussion/connections');
      setConnections(Array.isArray(result?.connections) ? result.connections : []);
    } catch (error) {
      setNotice(error.message || '目前無法讀取討論用 API 連線。');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!disabled) void readConnections();
  }, [disabled]);
  useEffect(() => {
    if (disabled) {
      setForm(EMPTY_FORM);
      setEditing(false);
    }
  }, [disabled]);
  const closeForm = () => {
    setForm(EMPTY_FORM);
    setEditing(false);
  };
  const openNew = () => {
    setNotice('');
    setForm(EMPTY_FORM);
    setEditing(true);
  };
  const openEdit = connection => {
    setNotice('');
    setForm({
      id: connection.id,
      provider: connection.baseUrl === DEEPSEEK_URL ? 'deepseek' : 'custom',
      name: connection.name ?? '',
      baseUrl: connection.baseUrl ?? '',
      apiKey: '',
      models: (connection.models ?? [])
        .map(model => (model.name && model.name !== model.id ? `${model.id} | ${model.name}` : model.id))
        .join('\n')
    });
    setEditing(true);
  };
  const setField = (field, value) => setForm(current => ({...current, [field]: value}));
  const parseModels = () =>
    form.models
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const separator = line.indexOf('|');
        const id = (separator < 0 ? line : line.slice(0, separator)).trim();
        const name = separator < 0 ? id : line.slice(separator + 1).trim();
        return {id, name: name || id};
      });
  const run = async (action, connection) => {
    if (locked) return;
    setBusy(action);
    setNotice('');
    try {
      if (action === 'save') {
        const models = parseModels();
        if (!form.name.trim() || !form.baseUrl.trim()) throw Error('請填寫連線名稱與 Base URL。');
        if (!form.id && !form.apiKey.trim()) throw Error('新增連線需要 API Key。');
        await request('discussion/connections/save', {
          ...(form.id ? {id: form.id} : {}),
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          ...(form.apiKey.trim() ? {apiKey: form.apiKey.trim()} : {}),
          models
        });
        setForm(EMPTY_FORM);
        setEditing(false);
        await readConnections();
        setNotice('討論用 API 連線已保存。');
      } else if (action === 'models') {
        const result = await request('discussion/connections/models', {id: connection.id});
        const updated = result?.connection;
        if (updated) {
          setConnections(current => current.map(item => (item.id === updated.id ? updated : item)));
          if (editing && form.id === updated.id)
            setForm(current => ({
              ...current,
              models: (updated.models ?? [])
                .map(model => (model.name && model.name !== model.id ? `${model.id} | ${model.name}` : model.id))
                .join('\n')
            }));
        } else await readConnections();
        setNotice(`已更新「${connection.name}」可選模型。`);
      } else if (action === 'remove') {
        await request('discussion/connections/remove', {id: connection.id});
        if (form.id === connection.id) closeForm();
        await readConnections();
        setNotice(`已移除「${connection.name}」連線。`);
      }
      window.dispatchEvent(new Event('k-discussion-api-refresh'));
    } catch (error) {
      setNotice(error.message || '無法更新討論用 API 連線。');
    } finally {
      setBusy('');
    }
  };
  if (disabled)
    return (
      <section className="discussion-api-settings">
        <p>討論用 API 連線請在電腦端設定。</p>
      </section>
    );
  return (
    <section className="discussion-api-settings" aria-label="討論用 API 連線">
      <h3>討論用 API 連線</h3>
      <p className="discussion-api-intro">
        API 連線只供平行比較、交叉審查與多人討論參與者，使用 API 計費；不會加入主模型或子代理目錄。API
        討論可唯讀搜尋及讀取本次工作區，不寫入檔案、不派工。
      </p>
      <p className="discussion-api-intro">
        目前支援 DeepSeek 或自訂 OpenAI 相容 API；此處不設定 Anthropic 或 Gemini API。
      </p>
      <p className="discussion-api-intro">網頁搜尋查詢與讀取網址會送至 Exa；免搜尋 Key，但有流量限制。</p>
      <div className="discussion-api-actions">
        <button type="button" disabled={locked} onClick={openNew}>
          新增 API 連線
        </button>
        <button type="button" disabled={locked || loading} onClick={() => void readConnections()}>
          重新讀取
        </button>
      </div>
      {loading && <small role="status">正在讀取連線…</small>}
      {!loading && !connections.length && <small>尚未設定討論用 API 連線。</small>}
      {!!connections.length && (
        <div className="discussion-api-list">
          {connections.map(connection => (
            <article className="discussion-api-card" key={connection.id}>
              <div className="discussion-api-card-head">
                <strong>{connection.name}</strong>
                <span>{connection.keyConfigured ? 'API Key 已設定' : 'API Key 未設定'}</span>
              </div>
              <small>{connection.baseUrl}</small>
              <small>模型：{connection.models?.map(model => model.name ?? model.id).join('、') || '尚未設定'}</small>
              {connection.catalogCheckedAt && (
                <small>模型清單更新：{new Date(connection.catalogCheckedAt).toLocaleString('zh-TW')}</small>
              )}
              <div className="discussion-api-actions">
                <button type="button" disabled={locked} onClick={() => openEdit(connection)}>
                  編輯
                </button>
                <button type="button" disabled={locked} onClick={() => void run('models', connection)}>
                  查詢模型
                </button>
                <button type="button" disabled={locked} onClick={() => void run('remove', connection)}>
                  移除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <form
          className="discussion-api-form"
          onSubmit={event => {
            event.preventDefault();
            void run('save');
          }}
        >
          <div className="discussion-api-form-head">
            <strong>{form.id ? '編輯 API 連線' : '新增 API 連線'}</strong>
            <button type="button" disabled={locked} onClick={closeForm}>
              關閉
            </button>
          </div>
          <label>
            供應商
            <select
              value={form.provider}
              disabled={locked}
              onChange={event => {
                const provider = event.target.value;
                setForm(current => ({
                  ...current,
                  provider,
                  baseUrl:
                    provider === 'deepseek' ? DEEPSEEK_URL : current.baseUrl === DEEPSEEK_URL ? '' : current.baseUrl,
                  name: provider === 'deepseek' && !current.name.trim() ? 'DeepSeek' : current.name
                }));
              }}
            >
              <option value="deepseek">DeepSeek</option>
              <option value="custom">自訂 OpenAI 相容</option>
            </select>
          </label>
          <label>
            連線名稱
            <input
              value={form.name}
              maxLength={80}
              onChange={event => setField('name', event.target.value)}
              required
              disabled={locked}
            />
          </label>
          <label>
            Base URL
            <input
              value={form.baseUrl}
              onChange={event => setField('baseUrl', event.target.value)}
              placeholder="https://…"
              required
              disabled={locked}
            />
          </label>
          <label>
            API Key{' '}
            <span>
              {form.id
                ? connections.find(connection => connection.id === form.id)?.keyConfigured
                  ? '已設定；留白保留既有 Key'
                  : '未設定'
                : '新增時必填；只在電腦端輸入'}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={event => setField('apiKey', event.target.value)}
              required={!form.id}
              disabled={locked}
              placeholder={form.id ? '留白保留既有 Key' : 'API Key'}
            />
          </label>
          <label>
            模型 ID（每行一個；可用「ID | 顯示名稱」，可先留白再查詢）
            <textarea
              value={form.models}
              rows={4}
              onChange={event => setField('models', event.target.value)}
              disabled={locked}
            />
          </label>
          <div className="discussion-api-actions">
            <button type="submit" disabled={locked}>
              {busy === 'save' ? '正在保存…' : '保存連線'}
            </button>
            <button type="button" disabled={locked} onClick={closeForm}>
              取消
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p className="discussion-api-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
