export const DEFAULT_WORKER_MODEL = 'auto';
export const DEFAULT_WORKER_EFFORT = 'auto';
// The native account catalog is the authority, not a K model allowlist.
export function availableWorkerModels(models = [], {provider='codex',geminiGateway=false,claudeGateway=false} = {}) {
 if(provider==='gemini')return [];
 return models.filter(row=>row.hidden!==true&&row.available!==false&&(
  /^gpt-/.test(row.model)||geminiGateway&&/^gemini-/.test(row.model)||claudeGateway&&/^claude-/.test(row.model)&&!/^claude-fable-/.test(row.model)
 ));
}

// One user preference text shared by the three native main-agent entry points.
export const MODEL_ROLE_GUIDANCE = `K 使用者模型分工（2026-10-04）：
以下只供 AI 內部選模與安排工作，不向使用者主動重述分工，不新增分工／審核提醒、彈窗或確認流程；原本必要的登入、核准與工作失敗訊息不變。
這是本人的使用偏好，不是模型能力排名或硬性路由。當輪明確指定、已保存的手動模型／推理設定優先；不自行切換目前主代理，不強制派工。只使用已接通工具與官方目錄實際提供的模型、推理程度；角色不代表已有跨供應商派工能力。
- Astra：非日常必要步驟；只有使用者明確選用且實際可用時才使用，不作自動升級或失敗備援。
- Opus 5.5：通才、平常的大腦。文章以 Gemini 與 Opus 5.5 為主；考量本人訂閱成本，通常 Gemini 做多數閱讀、理解、撰寫與修改，Opus 5.5 最後提供不同想法、盲點與第二意見，不是它說了算；採納看理由、證據、文章效果，由使用者決定。
- Gemini 3.8 Flash：本人的低成本、快速主力工人，能交給 Flash 的一般工作優先交給 Flash；不只機械性工作，也負責文章、審美、Google 商家及相關生態工作，能主導簡單任務或提出大方向。程式可由 GPT／Claude 監工、Flash 執行。這是使用者的分工偏好，不保證 Google 工具已接通或另授權帳號操作。
- GPT-6.1 Sol：取代 Astra 的日常技術主腦（小 Astra），不是只盯進度的監工或輔助大腦；負責理解需求、規劃、架構、後端判斷、除錯、派工、測試與驗收。依本人的使用經驗，Sol 後端較強且額度消耗少，適合站在 Opus 與 Flash 之間的技術中間層，分攤工作與用量；不取代 Opus 的通才討論角色，不為平均額度硬派工，也不把這項偏好當成官方能力排名或額度保證。
- 一般程式工作：Opus 5.5 與使用者討論方向後，由 Sol 負責技術執行，Flash 快速實作及修正。Sol 按批次或完成事件檢查成果，不持續輪詢進度。Flash 出錯或多次修改不等於該換模型，只要仍有實質進展就可繼續；不設固定失敗次數。反覆同錯、越改越糟或確實無進展，才依 Flash → Sol → Opus 順序考慮由 Sol、再由 Opus 親自修改。接手前先確認原工作停止並檢查已有成果，只交接剩餘工作；這是明確的工作交接，不是 K 自動換模、重試或改掉手動選擇。
- 大量產碼以快速回報成果為優先：依本人經驗，GPT 系列較慢，不作一般大量寫碼工人的預設；優先交 Flash，GPT 用於技術判斷、檢查與必要補修。不要因 Luna 或其他工人較慢就反覆查進度、空轉消耗主代理額度；派工後有其他必要工作才繼續做，否則用已接通的完成通知或阻塞等待工具，不做短間隔輪詢。Claude 的 K 工人完成事件會自動送回原對話，可結束本輪等待，不呼叫 luna_wait／luna_inspect 輪詢。
- 現有能力：Opus 討論後可交接到 Sol 主聊天室，再由 Sol 派 Flash；Claude 派出的 Sol 子代理目前不能再派 Flash。不要把 Opus → Sol 子代理 → Flash 的自動分層派工說成已接通，也不為這份分工自行新增派工管道。
- GPT-6 Luna：除非使用者明確指定，僅在小任務對規則遵守有極高要求時選用，不再當一般預設工人；模型 ID 以官方目錄為準。
- 主代理／子代理是工作角色，不是能力高低。日常主代理可按需把有範圍的判斷、盲點及第二意見交給 Opus 等較強模型；交接保留需求、必要原文與程式證據、已知／未知和限制，不只給自己的結論。這不保證總 Token、額度或費用更少，也不強制每項工作找高階模型。
- Opus 5.5 要複查 Astra／GPT 寫的程式是否過度工程化：找不必要架構、重複檢查、無用備援、多餘狀態或設定；採最小完整解，不把小修做成新系統。刪減需核對真實用途，保留必要原生權限、核准與防止未知工作重播。
- GPT-6.1 Sol 寫的程式碼，最後必須由真正的 Opus 5.5 審核（正確性、錯誤處理、過度工程化）；自查、測試或其他模型不能替代。沒有可用的 Opus 5.5 審查管道時，在工程交接紀錄標示「待 Opus 5.5 審核」，保留給 Opus 聊天室的交接內容，不額外提醒使用者，不宣稱已完成審核，也不自行新增派工管道。審核必須做，意見仍依證據判斷，不是一律照改。
- 不需要 Gemini 主代理自動派 GPT／Claude；Gemini 做完後，由使用者另開 GPT／Claude 聊天室看成果，不把反向派工列成缺口。
- Gemini 帳號採逐一使用：除使用者明確指定外，持續使用目前帳號，不平均分散、不每項工作輪換，也不因另一帳號重置就切回。官方查詢確認目前帳號的 5 小時或每週額度已耗盡時，從目前帳號的下一個已保存位置往後循環查詢，選第一個官方確認可用帳號接後續工作（例如第四→第五→第一），不能每次從第一個重選；5 小時用完即可換，不必等週額度耗盡，也不強制等待該時段恢復。登入異常、權限拒絕、一般速率限制、網路錯誤、逾時或舊額度快取都不是已確認額度耗盡。只用既有 K 帳號工具，不自行改原生登入檔、不使用第三方 OAuth 外掛；不同帳號不並行。切換前等全部 Gemini 工作停止並核對已有成果，只交接剩餘工作、不重播未知結果。只有全數帳號都由官方確認無可用額度，才可依使用者已明確授權的備援模型接手剩餘工作；沒有該授權就等待或回報，不換模型／計費。accountId 只綁定目前工人帳號，不能藉此跳過交接順序；本人在設定頁手動切換不受此順序限制。這是用量管理偏好，不保證降低官方帳號風險。
模型偏好不增加工具、資料、登入、部署或發布授權；失敗／額度不足不暗換模型、不改 API 計費、不重播未確認工作。Gemini 帳號接手只依既有已授權流程，先確認原工人停止並檢查成果，再由新工人接剩餘工作。`;

// Preserve legacy metadata for readback; new execution validates the current policy.
export function normalizeWorkerPolicy(value = {}) {
 const model=value?.model??DEFAULT_WORKER_MODEL;
 if(typeof model!=='string'||!model.trim())throw new Error('請選擇子代理模型。');
 const effort=Object.hasOwn(value??{},'effort')?value.effort:(model==='auto'?DEFAULT_WORKER_EFFORT:null);
 return {model,effort};
}
export function validateWorkerPolicy(value,models=[],{geminiGateway=false,claudeGateway=false}={}) {
 const policy=normalizeWorkerPolicy(value);
 if(policy.model==='auto'&&policy.effort==='auto')return policy;
 if(policy.model==='auto'||policy.effort==='auto')throw new Error('子代理模型與推理程度必須同時設為「AI 自動選擇」，或同時指定。');
 if(policy.model.startsWith('gemini-')&&!geminiGateway||policy.model.startsWith('claude-')&&!claudeGateway)throw Error('子代理需要已接通的 gateway；未自動換模。');
 const selected=availableWorkerModels(models,{geminiGateway,claudeGateway}).find(m=>m.model===policy.model);
 if(!selected)throw new Error(`${policy.model} 目前不可用；未自動換模。`);
 const efforts=selected.supportedReasoningEfforts??[];
 // Older callers saved only the model and inherited high. Preserve that
 // native-supported default without inventing effort for no-effort models.
 if(!Object.hasOwn(value??{},'effort'))policy.effort=efforts.find(e=>e.reasoningEffort==='high')?.reasoningEffort??selected.defaultReasoningEffort??efforts[0]?.reasoningEffort??null;
 if(efforts.length?!efforts.some(item=>item.reasoningEffort===policy.effort):policy.effort!=null)throw new Error(`${policy.model} 不支援 ${policy.effort} 推理程度；未自動換模。`);
 return policy;
}
export function workerPolicyConfig(value,{baseInstructions='',models=[],geminiGateway=false,claudeGateway=false,provider='codex'}={}) {
 const policy=validateWorkerPolicy(value,models,{geminiGateway,claudeGateway});
 const auto=policy.model==='auto';
 const native=policy.model.startsWith('gpt-');
 const canUseFlash=geminiGateway;
 const choices=availableWorkerModels(models,{provider,geminiGateway,claudeGateway});
 const autoChoices=choices.map(row=>row.model).join(' or ');
 const gateway=provider==='claude'?'k_luna / luna_start':'k_gemini / gemini_start';
 const prefix=provider==='claude'?'luna':'gemini';
 const instructions=[
  ...(provider==='claude'?[]:[MODEL_ROLE_GUIDANCE]),
  'K HARNESS delegation preferences selected by the user:',
  'Delegation is optional. Work directly when delegation would not help; send only the necessary bounded context.',
  auto
   ? `For every delegated task, choose ${autoChoices} based on that task. Pass both model and officially supported effort explicitly (null when the model has no effort setting). This is task-by-task model selection by the main AI, not a K heuristic, failure fallback, or automatic retry; never replay an unknown failure or silently substitute a model. Follow explicit user choices.`
   : `User-selected default worker: ${policy.model}, reasoning effort ${policy.effort??'native default'}. Honor this manual choice; choose another model only when the user or an explicit task rule requests it, never merely because you consider it more appropriate. Do not silently substitute on failure.`,
  provider==='codex'?`For GPT use native delegation; Pass both choices explicitly. For Gemini or Claude use ${gateway}, including its existing inspect/list/wait/cancel tools. Never put a non-GPT model in agents.default_subagent_model.`:`For K-selected workers of any provider use ${gateway}; native Claude Agent remains available for explicitly requested native work, not as a way to ignore the user's worker model or effort.`,
  `目前官方可派模型與推理程度：${choices.map(m=>`${m.model}: ${(m.supportedReasoningEfforts??[]).map(e=>e.reasoningEffort).join(', ')||'native default (null)'}`).join('; ')}。`,
  'Independently inspect subagent results before accepting them. Model selection grants no additional tool or filesystem permissions.',
  ...(canUseFlash?[`K 程序型工單不在 Codex 原生 list_agents 清單；使用者詢問待確認工人而 requestId 不明時，先用 ${prefix}_list 列出本對話工單，再用 ${prefix}_inspect 查原始 task 與明細，不依賴 Chrome。舊工單 executionUnowned 不代表仍在執行、已完成或確認停止，不可因此重播。對尚無 reconciliation 的舊工單，依原任務核對實際落地檔案與相關後續處理紀錄，再用 ${prefix}_reconcile 留下或修正處理結論、實查依據及仍未知事項；查詢失敗必須寫未查明，不得冒稱已驗證；由主代理完成，不把識別碼管理交給使用者，也不要反覆查同張已註記工單。空 outputFiles 不代表無成果，後續複查完成不等於原交付驗收，其他章節成果更不能當原任務證據。查核註記不是停止證明，不得用來交接重播、換帳號或恢復暫停目標。`]:[]),
  canUseFlash?'Use the existing Codex subscription for GPT agents; do not change GPT accounts or subscription. Use gemini_accounts to actively check all saved Gemini quotas while idle; it temporarily switches logins and restores the original. Never declare exhaustion or stop the user task based on cached percentages or a refused/failed query. Gemini account selection/handoff is supported only through the gateway tools and their accountId/handoffFrom fields: inspect the original result first, then create a new handoff for remaining work as needed. Do not replay unknown failures or silently substitute a model.':'Use the existing Codex subscription runtime. Never switch credentials, models, providers or billing routes on failure or quota exhaustion; never replay an unknown outcome or silently substitute a model.',
 ].join('\n');
 return {agents:auto||!native?{enabled:true}:{enabled:true,default_subagent_model:policy.model,...(policy.effort!=null?{default_subagent_reasoning_effort:policy.effort}:{})},developer_instructions:[baseInstructions,instructions].filter(Boolean).join('\n\n')};
}
