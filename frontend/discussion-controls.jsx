import React, {useState, useEffect} from 'react';
import {discussionModes, discussionStatus} from '../shared/discussion.mjs';
import {effortName} from './model-picker.jsx';
import {modelProvider} from '../shared/model-provider.mjs';
import './discussion.css';

export function useDiscussionConfig(threadId) {
  const key = `k-discussion:${threadId}`;
  const read = () => {
    try {
      return JSON.parse(sessionStorage.getItem(key)) ?? {mode: 'normal', participants: [], includeContext: true};
    } catch {
      return {mode: 'normal', participants: [], includeContext: true};
    }
  };
  const [config, setConfig] = useState(read);
  useEffect(() => setConfig(read()), [threadId]);
  const update = next => {
    setConfig(next);
    sessionStorage.setItem(key, JSON.stringify(next));
  };
  return [config, update];
}

export function DiscussionControls({state, models = [], config, onChange, loadModels, onCatalog, disabled}) {
  const [expanded, setExpanded] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [apiModels, setApiModels] = useState([]),
    [apiCatalogError, setApiCatalogError] = useState('');
  const d = state.discussion,
    running = d?.busy;
  useEffect(() => {
    if (running) setExpanded(false);
  }, [running]);
  const available = models.filter(m => m.available !== false && m.hidden !== true);
  const defaults = [
    {model: state.model, effort: state.effort ?? ''},
    {
      model:
        available.find(m => modelProvider(m.model) !== modelProvider(state.model))?.model ??
        available.find(m => m.model !== state.model)?.model ??
        '',
      effort: ''
    }
  ];
  const participants = config.participants?.length ? config.participants : defaults;
  const change = fields => onChange({...config, ...fields});
  const changeParticipant = (index, fields) =>
    change({participants: participants.map((p, i) => (i === index ? {...p, ...fields} : p))});
  const apiChoice = p => `api:${encodeURIComponent(JSON.stringify({connectionId: p.connectionId, model: p.model}))}`;
  const nativeChoice = model => `native:${encodeURIComponent(model)}`;
  const choiceFor = p => (p.route === 'api' ? apiChoice(p) : p.model ? nativeChoice(p.model) : '');
  const readApiModels = async () => {
    try {
      const response = await fetch('/api/discussion/models', {cache: 'no-store'});
      if (!response.ok) throw Error('目前無法讀取 API 討論模型。');
      const data = await response.json();
      setApiModels(
        Array.isArray(data.models) ? data.models.filter(m => m.route === 'api' && m.available === true) : []
      );
      setApiCatalogError('');
    } catch (error) {
      setApiCatalogError(error.message || '目前無法讀取 API 討論模型。');
    }
  };
  useEffect(() => {
    if (!expanded) return;
    void readApiModels();
    const refresh = () => void readApiModels();
    window.addEventListener('k-discussion-api-refresh', refresh);
    return () => window.removeEventListener('k-discussion-api-refresh', refresh);
  }, [expanded]);
  useEffect(() => {
    if (config.mode === 'normal' || models.length || !loadModels) return;
    let present = true;
    loadModels()
      .then(result => {
        if (present) onCatalog(result.models);
      })
      .catch(error => {
        if (present) setCatalogError(error.message);
      });
    return () => {
      present = false;
    };
  }, [config.mode, models.length]);
  useEffect(() => {
    if (config.mode !== 'normal' && !config.participants?.length && available.length && defaults[1].model)
      change({participants: defaults});
  }, [models, state.model, config.mode]);
  return (
    <section className="discussion-controls" aria-label="多模型討論">
      <div className="discussion-toolbar">
        <label>
          <span className="sr-only">對話模式</span>
          <select
            aria-label="對話模式"
            value={running ? d.mode : config.mode}
            disabled={disabled || running}
            onChange={e => {
              change({mode: e.target.value, participants: available.length ? participants : []});
              setExpanded(e.target.value !== 'normal');
            }}
          >
            <option value="normal">一般對話</option>
            {Object.entries(discussionModes).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!running && config.mode !== 'normal' && (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            參與者與背景
          </button>
        )}
        {running && (
          <label>
            <span>補充給</span>
            <select
              aria-label="補充給"
              value={config.target ?? ''}
              onChange={e => change({target: e.target.value})}
              disabled={d.status === 'stopping' || d.status === 'finishing'}
            >
              <option value="">AI 安排</option>
              <option value="all">全體</option>
              {d.participants.map(p => (
                <option key={p.id} value={p.id}>
                  {p.displayName ?? p.model}
                  {p.effort ? `／${effortName[p.effort] ?? p.effort}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {d && (
          <small role="status">
            {discussionModes[d.mode]} · {discussionStatus[d.status] ?? d.status}
          </small>
        )}
      </div>
      {!running && config.mode !== 'normal' && expanded && (
        <div className="discussion-settings">
          <p>
            設定好後照常跟主模型對話；要開始時告訴它「開始討論」，它會整理任務書（含它讀到的檔案與網頁）並用這組設定發起。AI
            自動安排與整理，保留不同意見；只討論，不自動執行工作。
          </p>
          {participants.map((p, index) => {
            const selected =
                p.route === 'api'
                  ? apiModels.find(m => m.connectionId === p.connectionId && m.model === p.model)
                  : available.find(m => m.model === p.model),
              efforts = selected?.supportedReasoningEfforts ?? [];
            const nativeGroups = [
              ['codex', 'OpenAI／Codex（訂閱）'],
              ['claude', 'Claude（訂閱）'],
              ['gemini', 'Gemini（訂閱）']
            ];
            const apiGroups = [
              ...new Map(
                apiModels.map(m => [m.connectionId, m.connectionName ?? m.providerLabel ?? 'API 連線'])
              ).entries()
            ];
            const currentChoice = choiceFor(p);
            return (
              <div className="discussion-participant" key={index}>
                <select
                  aria-label={`參與模型 ${index + 1}`}
                  value={currentChoice}
                  onChange={e => {
                    const value = e.target.value;
                    if (value.startsWith('api:')) {
                      try {
                        const choice = JSON.parse(decodeURIComponent(value.slice(4)));
                        change({
                          participants: participants.map((old, i) =>
                            i === index
                              ? {route: 'api', connectionId: choice.connectionId, model: choice.model, effort: ''}
                              : old
                          )
                        });
                      } catch {}
                    } else if (value.startsWith('native:')) {
                      change({
                        participants: participants.map((old, i) =>
                          i === index ? {model: decodeURIComponent(value.slice(7)), effort: ''} : old
                        )
                      });
                    } else changeParticipant(index, {model: '', effort: ''});
                  }}
                >
                  <option value="">選擇模型</option>
                  {nativeGroups.map(([provider, label]) => {
                    const group = available.filter(m => modelProvider(m.model) === provider);
                    return group.length ? (
                      <optgroup key={provider} label={label}>
                        {group.map(m => (
                          <option key={m.model} value={nativeChoice(m.model)}>
                            {m.displayName ?? m.model}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                  {apiGroups.map(([connectionId, label]) => (
                    <optgroup key={connectionId} label={`API · ${label}`}>
                      {apiModels
                        .filter(m => m.connectionId === connectionId)
                        .map(m => (
                          <option key={`${connectionId}:${m.model}`} value={apiChoice(m)}>
                            {m.displayName ?? m.model}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                  {p.route === 'api' && !selected && <option value={currentChoice}>{p.model}（API 目錄未列出）</option>}
                </select>
                {!!efforts.length && (
                  <select
                    aria-label={`參與模型 ${index + 1} 推理程度`}
                    value={p.effort ?? ''}
                    onChange={e => changeParticipant(index, {effort: e.target.value})}
                  >
                    <option value="">模型預設</option>
                    {efforts.map(level => {
                      const value = typeof level === 'string' ? level : level.reasoningEffort;
                      return (
                        <option key={value} value={value}>
                          {effortName[value] ?? value}
                        </option>
                      );
                    })}
                  </select>
                )}
                {participants.length > 2 && (
                  <button
                    type="button"
                    aria-label={`移除參與模型 ${index + 1}`}
                    onClick={() => change({participants: participants.filter((_, i) => i !== index)})}
                  >
                    移除
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" onClick={() => change({participants: [...participants, {model: '', effort: ''}]})}>
            加入參與者
          </button>
          <label className="discussion-context">
            <input
              type="checkbox"
              checked={config.includeContext !== false}
              onChange={e => change({includeContext: e.target.checked})}
            />
            把前面對話的文字附件交給參與者
          </label>
          {config.mode === 'parallel' && <small>首答互不可見，各自依任務書獨立回答。</small>}
          <small>
            討論參與者可廣泛唯讀相關檔案，不會寫入檔案或派工；Codex 須確認唯讀沙盒就緒。API 呼叫依供應商計費。
          </small>
        </div>
      )}
      {d?.error && (
        <p className="discussion-error" role="alert">
          {d.error}
        </p>
      )}
      {catalogError && (
        <p className="discussion-error" role="alert">
          {catalogError}
        </p>
      )}
      {apiCatalogError && expanded && (
        <p className="discussion-error" role="status">
          {apiCatalogError}
        </p>
      )}
    </section>
  );
}
