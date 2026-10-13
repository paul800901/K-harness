import {PermissionPicker, claudePermissionModes, geminiPermissionModes, permissionModes} from './permission-picker.jsx';
import {ShieldCheck} from 'lucide-react';
import {effortName} from './model-picker.jsx';
import {modelProvider as providerOf} from '../shared/model-provider.mjs';
import React, {useEffect, useState} from 'react';
import {Modal, api} from './app-common.jsx';

export function Rename({title, value, label, onClose, onSave}) {
  const [name, setName] = useState(value ?? '');
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={e => {
          e.preventDefault();
          onSave(name.trim());
        }}
      >
        <input
          autoFocus
          className="text-field"
          aria-label={label}
          maxLength={120}
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={!name.trim()}>
            儲存
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ArchiveManager({
  archiveRows,
  archivedProjectRows,
  archiveMessage,
  disabled,
  state,
  workspaceDisplayName,
  dateUsed,
  openListed,
  restoreArchived,
  restoreArchivedProject,
  onClose,
  onBack,
  onDelete
}) {
  const [query, setQuery] = useState(''),
    [selection, setSelection] = useState(null);
  const shown = archiveRows.filter(row =>
    `${row.title} ${workspaceDisplayName(row.workspace)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const eligible = archiveRows.filter(row => row.threadId !== state.threadId);
  return (
    <Modal title="已封存" onClose={onClose}>
      {selection ? (
        <section className="archive-delete-confirm" aria-label="確認刪除封存紀錄">
          <h3>刪除 {selection.length} 筆 K 對話紀錄？</h3>
          <p>
            K 本機紀錄將移入 Windows 資源回收筒；不會刪除 Codex／Claude／Gemini
            原生歷史、附件或工作區檔案。這不是清除所有供應商中的對話。
          </p>
          <ul>
            {selection.map(row => (
              <li key={row.threadId}>
                {row.title || '未命名對話'}
                <small>{workspaceDisplayName(row.workspace)}</small>
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button disabled={disabled} onClick={() => setSelection(null)}>
              取消
            </button>
            <button
              className="archive-delete-button"
              disabled={disabled}
              onClick={async () => {
                const result = await onDelete(selection);
                if (result) setSelection(null);
              }}
            >
              確認刪除 K 紀錄
            </button>
          </div>
        </section>
      ) : (
        <>
          {archiveMessage && (
            <p className="archive-status" role="status" aria-live="polite">
              {archiveMessage}
            </p>
          )}
          {!!archivedProjectRows.length && (
            <section className="archive-section">
              <h3 className="archive-section-title">工作區</h3>
              <p className="modal-description">還原工作區不會還原其中已封存的對話；這裡不刪除工作區資料夾。</p>
              <div className="dialog-session-list archive-results">
                {archivedProjectRows.map(project => (
                  <div className="archive-result" key={project.path}>
                    <div className="archive-open archive-project-label">
                      <strong>{project.name}</strong>
                      <span>{project.path}</span>
                    </div>
                    <button
                      className="restore-session"
                      disabled={disabled}
                      onClick={() => restoreArchivedProject(project)}
                    >
                      還原工作區
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="archive-section">
            <h3 className="archive-section-title">對話（{archiveRows.length}）</h3>
            <p className="modal-description">刪除僅移除 K 的本機紀錄。正在開啟的對話需先切換至其他對話，才能刪除。</p>
            <div className="archive-toolbar">
              <input
                aria-label="搜尋已封存對話"
                placeholder="搜尋名稱或工作區"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
              <button
                className="archive-delete-button"
                disabled={disabled || !eligible.length}
                onClick={() => setSelection(eligible)}
              >
                清空可刪除對話（{eligible.length}）
              </button>
            </div>
            <div className="dialog-session-list archive-results">
              {shown.map(row => (
                <div className="archive-result" key={row.threadId}>
                  <button className="archive-open" disabled={disabled} onClick={() => openListed(row)}>
                    <strong title={row.title || '未命名對話'}>{row.title || '未命名對話'}</strong>
                    <span>{workspaceDisplayName(row.workspace)}</span>
                    <time>最近使用：{dateUsed(row)}</time>
                  </button>
                  <button className="restore-session" disabled={disabled} onClick={() => restoreArchived(row)}>
                    移回清單
                  </button>
                  <button
                    className="restore-session archive-delete-button"
                    disabled={disabled || row.threadId === state.threadId}
                    title={row.threadId === state.threadId ? '請先切換至其他對話' : '刪除 K 本機對話紀錄'}
                    onClick={() => setSelection([row])}
                  >
                    刪除 K 紀錄
                  </button>
                </div>
              ))}
              {!shown.length && (
                <p className="dialog-list-empty">
                  {archiveRows.length ? '沒有符合搜尋的對話。' : '目前沒有已封存的對話。'}
                </p>
              )}
            </div>
          </section>
          <div className="modal-actions">
            <button onClick={onBack}>返回設定</button>
            <button onClick={onClose}>關閉</button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function BranchDialog({modal, state, onClose, onFork}) {
  const inheritedAccess =
    modal.sourceProvider === 'claude'
      ? state.accessMode === 'workspace-write'
        ? 'claude-manual'
        : state.accessMode === 'read-only'
          ? 'claude-plan'
          : (state.accessMode ?? 'claude-manual')
      : (state.accessMode ?? 'workspace-write');
  const [targetProvider, setTargetProvider] = useState(modal.targetProvider ?? modal.sourceProvider),
    [catalog, setCatalog] = useState([]),
    [model, setModel] = useState(''),
    [effort, setEffort] = useState(''),
    [accessMode, setAccessMode] = useState(
      modal.sourceProvider === (modal.targetProvider ?? modal.sourceProvider) ? inheritedAccess : ''
    ),
    [permissionConfirmed, setPermissionConfirmed] = useState(false),
    [nextInstruction, setNextInstruction] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api('models')
      .then(result => {
        if (live) setCatalog(result.models ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!catalog.length) return;
    const options = catalog.filter(
        item => (item.provider ?? providerOf(item.model)) === targetProvider && item.available !== false
      ),
      current = targetProvider === modal.sourceProvider ? options.find(item => item.model === state.model) : null,
      preferred = current ?? options.find(item => item.isDefault) ?? options[0];
    setModel(preferred?.model ?? '');
    setEffort(current && state.effort ? state.effort : '');
  }, [catalog, targetProvider]);
  const options = catalog.filter(
      item => (item.provider ?? providerOf(item.model)) === targetProvider && item.available !== false
    ),
    selected = options.find(item => item.model === model),
    efforts = selected?.supportedReasoningEfforts ?? [];
  const modes = Object.entries(
    targetProvider === 'claude'
      ? claudePermissionModes
      : targetProvider === 'gemini'
        ? geminiPermissionModes
        : permissionModes
  );
  const submit = () => {
    if (!model || !accessMode) return;
    onFork({
      messageId: modal.messageId,
      model,
      effort: effort || undefined,
      accessMode,
      permissionConfirmed,
      nextInstruction: nextInstruction.trim() || undefined
    });
  };
  return (
    <Modal title="分支到新對話" onClose={onClose}>
      <p className="modal-description">
        原對話保持不變。Codex 可從指定結論原生分支；Claude 同供應商只支援最新結論，Gemini
        尚未接入同供應商原生分支。跨供應商使用 K 的結論交接，不移轉原生歷史。
      </p>
      <label className="setting-row">
        <span>目標供應商</span>
        <select
          value={targetProvider}
          onChange={event => {
            const next = event.target.value;
            setTargetProvider(next);
            setAccessMode(next === modal.sourceProvider ? inheritedAccess : '');
            setPermissionConfirmed(false);
            setEffort('');
          }}
        >
          <option value="codex">GPT / Codex 訂閱</option>
          <option value="claude" disabled={!modal.isLatestConclusion && modal.sourceProvider === 'claude'}>
            Claude 訂閱
          </option>
          <option value="gemini" disabled={modal.sourceProvider === 'gemini'}>
            Gemini / Antigravity 訂閱
          </option>
        </select>
      </label>
      <label className="setting-row">
        <span>模型</span>
        <select
          value={model}
          onChange={event => {
            setModel(event.target.value);
            setEffort('');
          }}
          disabled={loading || !options.length}
        >
          <option value="">選擇模型</option>
          {options.map(item => (
            <option key={item.model} value={item.model}>
              {item.displayName ?? item.model}
            </option>
          ))}
        </select>
      </label>
      {efforts.length > 0 && (
        <label className="setting-row">
          <span>推理程度</span>
          <select value={effort} onChange={event => setEffort(event.target.value)}>
            <option value="">模型預設</option>
            {efforts.map(item => {
              const value = typeof item === 'string' ? item : item.reasoningEffort;
              return (
                <option key={value} value={value}>
                  {effortName[value] ?? value}
                </option>
              );
            })}
          </select>
        </label>
      )}
      <div className="setting-row">
        <span>操作權限</span>
        <PermissionPicker
          value={accessMode}
          provider={targetProvider}
          label="分支操作權限"
          onChange={(mode, confirmed) => {
            setAccessMode(mode);
            setPermissionConfirmed(confirmed === true);
          }}
        />
        {!accessMode && <small>請明確選擇權限</small>}
      </div>
      {targetProvider !== modal.sourceProvider ? (
        <p className="modal-description">跨供應商沒有真正等價的權限模式，不會自動映射；請明確選擇新對話權限。</p>
      ) : (
        <p className="modal-description">同供應商沿用目前權限模式。</p>
      )}
      <label className="setting-row branch-instruction">
        <span>接續指示（選填）</span>
        <textarea
          maxLength={16000}
          value={nextInstruction}
          onChange={event => setNextInstruction(event.target.value)}
          placeholder="留白時，新對話會自動接續尚未完成的工作，不必再送出訊息。"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={loading || !selected || !accessMode} onClick={submit}>
          建立並接續
        </button>
      </div>
    </Modal>
  );
}
export function Approval({question: q, action, request}) {
  const [answers, setAnswers] = useState({});
  const [other, setOther] = useState({});
  const optionLabel = o => (typeof o === 'string' ? o : o.label);
  const isOther = value =>
    ['other', '其他'].includes(
      String(value ?? '')
        .trim()
        .toLocaleLowerCase()
    );
  const answerValue = x => {
    const selected = answers[x.id],
      format = value => (isOther(value) ? `Other: ${other[x.id] ?? ''}` : value);
    if (Array.isArray(selected)) return selected.map(format);
    return selected === undefined ? '' : format(selected);
  };
  const submit = async e => {
    e.preventDefault();
    const result = await action(() =>
      request('answer', {id: q.id, answers: Object.fromEntries(q.questions.map(x => [x.id, answerValue(x)]))})
    );
    if (result?.answered) {
      setAnswers({});
      setOther({});
    }
  };
  return (
    <div className="approval-card">
      <div className="approval-title">
        <ShieldCheck size={19} />
        {q.kind === 'approval' ? (q.title ?? '需要操作核准') : '需要你的回答'}
        {q.isSubagent && <span className="approval-scope">子代理</span>}
      </div>
      {q.kind === 'approval' ? (
        <>
          <p className="approval-text">{q.text}</p>
          <details>
            <summary>查看操作內容</summary>
            <pre>{JSON.stringify(q.details, null, 2)}</pre>
          </details>
          <div className="approval-buttons">
            <button onClick={() => action(() => request('answer', {id: q.id, accept: false}))}>拒絕</button>
            <button
              className="primary"
              disabled={q.canAccept === false}
              onClick={() => action(() => request('answer', {id: q.id, accept: true}))}
            >
              {q.canAccept === false ? '目前無法核准' : (q.acceptLabel ?? '只核准這一次')}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          {q.questions.map(x => {
            const sourceOptions = x.options ?? [],
              otherOption = sourceOptions.some(o => isOther(optionLabel(o))),
              options =
                q.provider === 'claude' && sourceOptions.length && !otherOption
                  ? [...sourceOptions, {label: 'Other', description: '自行輸入其他答案'}]
                  : sourceOptions,
              otherSelected = Array.isArray(answers[x.id]) ? answers[x.id].some(isOther) : isOther(answers[x.id]);
            return (
              <fieldset className="claude-question" key={x.id}>
                <legend>{x.question}</legend>
                {x.multiSelect ? (
                  <div className="claude-question-options">
                    {options.map((o, i) => {
                      const label = optionLabel(o),
                        selected = Array.isArray(answers[x.id]) && answers[x.id].includes(label);
                      return (
                        <label key={`${label}-${i}`}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={e =>
                              setAnswers(a => ({
                                ...a,
                                [x.id]: e.target.checked
                                  ? [...(Array.isArray(a[x.id]) ? a[x.id] : []), label]
                                  : (Array.isArray(a[x.id]) ? a[x.id] : []).filter(v => v !== label)
                              }))
                            }
                          />
                          <span>
                            {label}
                            {o.description && <small>{o.description}</small>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : options.length ? (
                  <select
                    value={typeof answers[x.id] === 'string' ? answers[x.id] : ''}
                    onChange={e => setAnswers(a => ({...a, [x.id]: e.target.value}))}
                  >
                    <option value="">請選擇</option>
                    {options.map((o, i) => (
                      <option key={`${optionLabel(o)}-${i}`} value={optionLabel(o)}>
                        {optionLabel(o)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={x.isSecret ? 'password' : 'text'}
                    autoComplete={x.isSecret ? 'new-password' : 'off'}
                    value={answers[x.id] ?? ''}
                    onChange={e => setAnswers(a => ({...a, [x.id]: e.target.value}))}
                  />
                )}
                {otherSelected && (
                  <input
                    type={x.isSecret ? 'password' : 'text'}
                    autoComplete={x.isSecret ? 'new-password' : 'off'}
                    className="claude-other-answer"
                    aria-label={x.question + '：其他回答'}
                    placeholder="請輸入其他回答"
                    value={other[x.id] ?? ''}
                    onChange={e => setOther(a => ({...a, [x.id]: e.target.value}))}
                  />
                )}
              </fieldset>
            );
          })}
          <button className="primary">送出回答</button>
        </form>
      )}
    </div>
  );
}
function ClaudeNativeCapabilities({capabilities}) {
  const groups = [
    ['已回報原生工具', capabilities?.tools],
    ['原生指令', capabilities?.commands],
    ['原生代理', capabilities?.agents],
    ['原生技能', capabilities?.skills],
    ['MCP 伺服器', capabilities?.mcpServers],
    ['可用模型', capabilities?.models],
    ['原生權限模式', capabilities?.permissionModes]
  ];
  const rows = groups.filter(([, items]) => Array.isArray(items) && items.length);
  return (
    <section className="context-card claude-capabilities">
      <strong>Claude Code 原生能力</strong>
      <p>已連線項目依 Claude Code 初始化資料列出；未列出的功能不視為已接入。</p>
      {rows.map(([label, items]) => (
        <div className="claude-capability-row" key={label}>
          <span>{label}</span>
          <small>
            {items
              .map(item => (typeof item === 'string' ? item : (item.name ?? item.id ?? JSON.stringify(item))))
              .join(' · ')}
          </small>
        </div>
      ))}
      <div className="claude-capability-row">
        <span>僅原生終端互動</span>
        <small>
          {Array.isArray(capabilities?.terminalOnlyFeatures)
            ? capabilities.terminalOnlyFeatures.length
              ? capabilities.terminalOnlyFeatures.join(' · ')
              : '目前沒有回報項目。'
            : '全螢幕終端互動不嵌入此 K 視圖；其他終端專屬功能尚未逐項確認。'}
        </small>
      </div>
      <div className="claude-capability-row">
        <span>官方功能不可用</span>
        <small>
          {Array.isArray(capabilities?.unavailableFeatures)
            ? capabilities.unavailableFeatures.length
              ? capabilities.unavailableFeatures.join(' · ')
              : '本次初始化未回報不可用項目；未逐項確認的功能仍屬未知。'
            : '後端尚未回報確定不可用的官方功能；不據此推定功能完整。'}
        </small>
      </div>
      {!rows.length && <small>此連線尚未回報原生工具、指令、MCP 或權限模式清單。</small>}
    </section>
  );
}
function ProgressPanel({state, action, request}) {
  const [objective, setObjective] = useState(state.goal?.objective ?? '');
  useEffect(() => setObjective(state.goal?.objective ?? ''), [state.goal?.objective]);
  const usage = state.progress?.tokenUsage,
    capabilities = state.capabilities ?? {},
    claudeUsage = state.usage?.claude;
  return (
    <div className="progress-panel">
      {(state.provider ?? providerOf(state.model)) === 'claude' && (
        <ClaudeNativeCapabilities capabilities={state.nativeCapabilities} />
      )}
      {claudeUsage && (
        <section className="context-card">
          <strong>Claude 訂閱狀態</strong>
          <p>
            {claudeUsage.status === 'subscription' ? '使用訂閱提供者' : '目前不可用'}
            {claudeUsage.note ? ` · ${claudeUsage.note}` : ''}
          </p>
        </section>
      )}
      {capabilities.goal !== false && (
        <form
          className="goal-card"
          onSubmit={e => {
            e.preventDefault();
            action(() => request('goal', {objective}));
          }}
        >
          <strong>目前目標</strong>
          <textarea
            aria-label="目前目標"
            maxLength={4000}
            placeholder="設定長程工作要持續完成的結果"
            value={objective}
            onChange={e => setObjective(e.target.value)}
          />
          <div className="progress-actions">
            <button disabled={!objective.trim()}>儲存目標</button>
            {state.goal && (
              <button type="button" onClick={() => action(() => request('goal', {clear: true}))}>
                清除
              </button>
            )}
          </div>
          {state.goal && (
            <small>
              狀態：{state.goal.status} · 已用 {state.goal.tokensUsed ?? 0} tokens
            </small>
          )}
        </form>
      )}
      {!!state.progress?.plan?.length && (
        <section className="plan-card">
          <strong>主代理計畫</strong>
          {state.progress.explanation && <p>{state.progress.explanation}</p>}
          <ol>
            {state.progress.plan.map((step, i) => (
              <li key={`${i}-${step.step}`} data-status={step.status}>
                {step.step}
                <small>{step.status}</small>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="context-card">
        <strong>工作脈絡</strong>
        {state.sandboxReadiness && <p>Windows 沙箱就緒：{state.sandboxReadiness}（就緒不等於已驗證所有操作的隔離）</p>}
        <>
          <p>
            壓縮狀態：{state.progress?.compaction ?? 'idle'}
            {state.progress?.compactions ? ` · 已完成 ${state.progress.compactions} 次` : ''}
          </p>
          {usage && (
            <>
              <p>
                最近一次原生回報：{usage.last?.totalTokens ?? '尚無資料'}
                {usage.last?.totalTokens !== undefined && usage.modelContextWindow
                  ? ` / ${usage.modelContextWindow}`
                  : ''}
                {usage.last?.totalTokens !== undefined ? ' tokens' : ''}
              </p>
              {usage.last?.measurement === 'latest-native-request-input' && (
                <small>單次請求輸入量，含原生回報的快取；非回合累計或訂閱額度。</small>
              )}
              <p>累計用量：{usage.total?.totalTokens ?? '尚無資料'} tokens</p>
            </>
          )}
          {capabilities.compact !== false && (
            <button disabled={state.busy || !state.threadId} onClick={() => action(() => request('compact', {}))}>
              現在壓縮
            </button>
          )}
        </>
      </section>
    </div>
  );
}
