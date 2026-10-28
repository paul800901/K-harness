import {isAntigravityModel} from '../shared/antigravity-models.mjs';

export const DEFAULT_WORKER_MODEL = 'auto';
export const DEFAULT_WORKER_EFFORT = 'auto';
// The native account catalog is the authority, not a K model allowlist. api: rows are the user's own API
// connections; they exist in the catalog only when K supplied them.
export function availableWorkerModels(
  models = [],
  {provider = 'codex', geminiGateway = false, claudeGateway = false} = {}
) {
  if (provider === 'gemini') geminiGateway = claudeGateway = true;
  return models.filter(
    row =>
      row.hidden !== true &&
      row.available !== false &&
      (/^gpt-/.test(row.model) ||
        (geminiGateway && isAntigravityModel(row.model)) ||
        (claudeGateway && /^claude-/.test(row.model)) ||
        /^api:/.test(row.model))
  );
}

// Protocol shared by the three native main-agent entry points. The user's model-role
// preferences are private data in the K common memory, delivered per turn (common-memory.mjs).
export const MODEL_PROTOCOL_GUIDANCE = `K 模型與派工協定：
以下只供 AI 內部選模與安排工作，不向使用者主動重述分工，不新增分工／審核提醒、彈窗或確認流程；原本必要的登入、核准與工作失敗訊息不變。
本人的模型分工與委派偏好不寫在程式或專案規則內，由 K 共同記憶集中維護，K 在回合內以「K 共同記憶」標記附上。那是使用偏好，不是能力排名或硬性路由；當輪明確指定、已保存的手動模型／推理設定優先。共同記憶標示無法讀取時，本人分工偏好視為未知，不以舊版內建分工或對話中較早的共同記憶代替。
不自行切換目前主代理，不強制派工。只使用已接通工具與官方目錄實際提供的模型、推理程度；角色不代表已有跨供應商派工能力。
- 已讀未變的規則不重讀；派工前備齊定稿正文與來源、範圍及完成條件，完成事件後檢查成果與必要收據，不反覆搜尋、截斷重讀或空轉等待。
- 派工後有其他必要工作才繼續做，否則用已接通的完成通知或阻塞等待工具，不做短間隔輪詢。Claude 的 K 工人完成事件會自動送回原對話，可結束本輪等待，不呼叫 luna_wait／luna_inspect 輪詢。
- 多層派工能力：只有 Claude 主對話派出的 Claude 工人可再派一層小工人，其他工人仍不能再派；小工人不可再派工，上層工人須等到小工人 settled 並自行檢查成果。
- 主代理／子代理是工作角色，不是能力高低。主代理可按需把有範圍的判斷、盲點及第二意見交給其他模型；這不保證總 Token、額度或費用更少，也不強制每項工作找高階模型。
- 接手或改交其他模型前，先確認原工作停止並檢查已有成果，只交接剩餘工作；交接保留需求、必要原文與證據、已知／未知和限制，不只給結論。這是明確的工作交接，不是 K 自動換模、重試或改掉手動選擇。
- 程式複查與驗收依專案規則與 K 共同記憶；自查、測試或其他模型不能冒充指定的審查，沒有審查管道時如實標示待審，不宣稱已完成。
- Gemini 帳號採逐一使用：除使用者明確指定外，持續使用目前帳號，不平均分散、不每項工作輪換，也不因另一帳號重置就切回。官方查詢確認目前帳號的 5 小時或每週額度已耗盡時，從目前帳號的下一個已保存位置往後循環查詢，選第一個官方確認可用帳號接後續工作（例如第四→第五→第一），不能每次從第一個重選；5 小時用完即可換，不必等週額度耗盡，也不強制等待該時段恢復。登入異常、權限拒絕、一般速率限制、網路錯誤、逾時或未知快照都不是已確認額度耗盡；成功官方回報的明確零額度，在其有效重設時間前保留為有日期的證據，不反覆查詢或選為自動派工候選。全數帳號確認耗盡後，最早有效重設到期時完整重查全部帳號一次；人工明確更新全部可例外。只用既有 K 帳號工具，不自行改原生登入檔、不使用第三方 OAuth 外掛；不同帳號不並行。切換前等全部 Gemini 工作停止並核對已有成果，只交接剩餘工作、不重播未知結果。只有全數帳號都由官方確認無可用額度，才可依使用者已明確授權的備援模型接手剩餘工作；沒有該授權就等待或回報，不換模型／計費。一般新工單省略 accountId，K 自行核對目前共用帳號；不要記住舊帳號再逐房沿用。明確傳入 accountId 仍需核對，帳號不符不會暗中派到別的帳號或切回舊帳號；K 通知就緒後核對剩餘工作再接手。gemini_accounts 回 scheduling.waiting 且 notificationRegistered 時，K 已接管等待；原生目標 active 且無其他工作時用本房的 K 等待工具省略 timeoutMs 等待回傳 waitId，無 active 目標時可結束回合等通知；不輪詢或僅因等待把目標標為 blocked；queryIds 不是工單，不能用作 handoffFrom。本人在設定頁手動切換不受此順序限制。這是用量管理偏好，不保證降低官方帳號風險。
- DeepSeek 等 API 模型（api: 開頭）：只在本人明確要求諮詢該模型、取得不同看法時才派；API 計費、唯讀（可讀檔與上網查證，不能寫檔或跑指令）、排最後，不作一般選項或失敗備援。
模型偏好不增加工具、資料、登入、部署或發布授權；失敗／額度不足不暗換模型、不改 API 計費、不重播未確認工作。Gemini 帳號接手只依既有已授權流程，先確認原工人停止並檢查成果，再由新工人接剩餘工作。`;

// Preserve legacy metadata for readback; new execution validates the current policy.
export function normalizeWorkerPolicy(value = {}) {
  const model = value?.model ?? DEFAULT_WORKER_MODEL;
  if (typeof model !== 'string' || !model.trim()) throw new Error('請選擇子代理模型。');
  const effort = Object.hasOwn(value ?? {}, 'effort') ? value.effort : model === 'auto' ? DEFAULT_WORKER_EFFORT : null;
  return {model, effort};
}
export function validateWorkerPolicy(value, models = [], {geminiGateway = false, claudeGateway = false} = {}) {
  const policy = normalizeWorkerPolicy(value);
  if (policy.model === 'auto' && policy.effort === 'auto') return policy;
  if (policy.model === 'auto' || policy.effort === 'auto')
    throw new Error('子代理模型與推理程度必須同時設為「AI 自動選擇」，或同時指定。');
  if ((isAntigravityModel(policy.model) && !geminiGateway) || (policy.model.startsWith('claude-') && !claudeGateway))
    throw Error('子代理需要已接通的 gateway；未自動換模。');
  const selected = availableWorkerModels(models, {geminiGateway, claudeGateway}).find(m => m.model === policy.model);
  if (!selected) throw new Error(`${policy.model} 目前不可用；未自動換模。`);
  const efforts = selected.supportedReasoningEfforts ?? [];
  // Older callers saved only the model and inherited high. Preserve that
  // native-supported default without inventing effort for no-effort models.
  if (!Object.hasOwn(value ?? {}, 'effort'))
    policy.effort =
      efforts.find(e => e.reasoningEffort === 'high')?.reasoningEffort ??
      selected.defaultReasoningEffort ??
      efforts[0]?.reasoningEffort ??
      null;
  if (efforts.length ? !efforts.some(item => item.reasoningEffort === policy.effort) : policy.effort != null)
    throw new Error(`${policy.model} 不支援 ${policy.effort} 推理程度；未自動換模。`);
  return policy;
}
export function workerPolicyConfig(
  value,
  {baseInstructions = '', models = [], geminiGateway = false, claudeGateway = false, provider = 'codex'} = {}
) {
  const policy = validateWorkerPolicy(value, models, {geminiGateway, claudeGateway});
  const auto = policy.model === 'auto';
  const native = policy.model.startsWith('gpt-');
  const canUseFlash = geminiGateway;
  const choices = availableWorkerModels(models, {provider, geminiGateway, claudeGateway});
  const nativeChoices = choices.filter(row => !row.model.startsWith('api:')),
    apiChoices = choices.filter(row => row.model.startsWith('api:'));
  const autoChoices = nativeChoices.map(row => row.model).join(' or ');
  const luna = provider === 'claude' || provider === 'gemini';
  const gateway = luna ? 'k_luna / luna_start' : 'k_gemini / gemini_start';
  const prefix = luna ? 'luna' : 'gemini';
  const instructions = [
    ...(provider === 'claude' ? [] : [MODEL_PROTOCOL_GUIDANCE]),
    'K HARNESS delegation preferences selected by the user:',
    'Delegation is optional. Work directly when delegation would not help; send only the necessary bounded context.',
    auto
      ? `For every delegated task, choose ${autoChoices} based on that task. Pass both model and officially supported effort explicitly (null when the model has no effort setting). This is task-by-task model selection by the main AI, not a K heuristic, failure fallback, or automatic retry; never replay an unknown failure or silently substitute a model. Follow explicit user choices.`
      : policy.model.startsWith('api:')
        ? `User-saved API consult model: ${policy.model}, reasoning effort ${policy.effort ?? 'none (pass null)'}. Use it only when the user explicitly asks to consult it, always passing that model and effort explicitly; it is not a default for ordinary delegation. Do not silently substitute on failure.`
        : `User-selected default worker: ${policy.model}, reasoning effort ${policy.effort ?? 'native default'}. Honor this manual choice; choose another model only when the user or an explicit task rule requests it, never merely because you consider it more appropriate. Do not silently substitute on failure.`,
    provider === 'codex'
      ? `For GPT use native delegation; Pass both choices explicitly. For Gemini, antigravity: models (including Claude/GPT offered by Antigravity), or Claude use ${gateway}, including its existing inspect/list/wait/cancel tools. Keep the full core-qualified model ID. Never put a non-GPT model in agents.default_subagent_model.`
      : provider === 'gemma'
        ? `For K-selected workers of every provider use ${gateway}. GPT workers use K's existing subscription home through this gateway, never the self-hosted inference endpoint or native spawn_agent. Self-hosted models are main-agent options, not K worker choices.`
        : provider === 'gemini'
          ? `For K-selected workers of any provider use ${gateway}, including its inspect/list/wait/cancel tools. Native agy subagents (define_subagent / invoke_subagent) run inside the current turn on the same Gemini account; use them for short parallel subtasks, and K workers for GPT/Claude or work that must continue after this turn. K delivers each worker completion to this conversation as a later message; after starting K workers, finish the turn instead of polling.`
          : `For K-selected workers of any provider use ${gateway}; native Claude Agent remains available for explicitly requested native work, not as a way to ignore the user's worker model or effort.`,
    `目前官方可派模型與推理程度：${[...nativeChoices, ...apiChoices].map(m => `${m.model}${m.model.startsWith('api:') ? `（${m.displayName}，API 計費）` : ''}: ${(m.supportedReasoningEfforts ?? []).map(e => e.reasoningEffort).join(', ') || 'native default (null)'}`).join('; ')}。`,
    ...(apiChoices.length
      ? [
          'API models (prefix api:) are billed per use through an API key the user owns and are read-only consult workers: they read files and search the web but cannot write files or run commands. Choose one ONLY when the user explicitly asks in this conversation to consult that model or provider; never as an ordinary AI-auto choice, failure fallback or substitute.'
        ]
      : []),
    'Independently inspect subagent results before accepting them. Model selection grants no additional tool or filesystem permissions.',
    ...(canUseFlash
      ? [
          `K 程序型工單不在 Codex 原生 list_agents 清單；使用者詢問待確認工人而 requestId 不明時，先用 ${prefix}_list 列出本對話工單，再用 ${prefix}_inspect 查原始 task 與明細，不依賴 Chrome。舊工單 executionUnowned 不代表仍在執行、已完成或確認停止，不可因此重播。對尚無 reconciliation 的舊工單，依原任務核對實際落地檔案與相關後續處理紀錄，再用 ${prefix}_reconcile 留下或修正處理結論、實查依據及仍未知事項；查詢失敗必須寫未查明，不得冒稱已驗證；由主代理完成，不把識別碼管理交給使用者，也不要反覆查同張已註記工單。空 outputFiles 不代表無成果，後續複查完成不等於原交付驗收，其他章節成果更不能當原任務證據。查核註記不是停止證明，不得用來交接重播、換帳號或恢復暫停目標。`
        ]
      : []),
    canUseFlash
      ? `Use the existing Codex subscription for GPT agents; do not change GPT accounts or subscription. Use gemini_accounts only when scheduling information is needed, not before every job. It observes the shared scheduler and registers a single completion notification when waiting, instead of rejecting busy queries or switching through all accounts. On scheduling.waiting with a registered notification, do not poll or mark the goal blocked solely to wait. If the native goal is active and no independent work remains, use ${prefix}_wait on the returned waitId with timeoutMs omitted; without an active goal, finish the turn and rely on the registered completion event. Usually omit accountId on new jobs; explicit stale expectations are never silently changed. Dated evidence rules: known official zero is retained until its reset without repeated querying or switching; other candidates are checked before use. If all accounts were confirmed exhausted, the earliest effective reset triggers one complete recheck. Preserve each last official query time; do not treat unknown data or a refused/failed query as exhaustion. Human explicit refresh-all may override suppression. Gemini account selection/handoff is supported only through the gateway tools and their accountId/handoffFrom fields: inspect the original result first, then create a new handoff for remaining work as needed. Do not replay unknown failures or silently substitute a model.`
      : 'Use the existing Codex subscription runtime. Never switch credentials, models, providers or billing routes on failure or quota exhaustion; never replay an unknown outcome or silently substitute a model.'
  ].join('\n');
  return {
    agents:
      auto || !native || provider === 'gemma'
        ? {enabled: true}
        : {
            enabled: true,
            default_subagent_model: policy.model,
            ...(policy.effort != null ? {default_subagent_reasoning_effort: policy.effort} : {})
          },
    developer_instructions: [baseInstructions, instructions].filter(Boolean).join('\n\n')
  };
}
