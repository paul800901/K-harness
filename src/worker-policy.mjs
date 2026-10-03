export const DEFAULT_WORKER_MODEL = 'auto';
export const DEFAULT_WORKER_EFFORT = 'auto';
export const WORKER_MODELS = ['gpt-6.1-sol','gpt-6-luna'];
// Gateway-only subscription workers; never feed these into Codex native agents.
export const GEMINI_WORKER_MODELS = ['gemini-3.8-flash'];
export const GEMINI_WORKER_EFFORTS = ['low','medium','high'];

// Preserve legacy metadata for readback; new execution validates the current policy.
export function normalizeWorkerPolicy(value = {}) {
 const model=value?.model??DEFAULT_WORKER_MODEL;
 if(typeof model!=='string'||!model.trim())throw new Error('請選擇子代理模型。');
 const effort=value?.effort??(model==='auto'?DEFAULT_WORKER_EFFORT:'high');
 return {model,effort};
}
export function validateWorkerPolicy(value,models,{geminiGateway=false}={}) {
 const policy=normalizeWorkerPolicy(value);
 if(policy.model==='auto'&&policy.effort==='auto')return policy;
 if(policy.model==='auto'||policy.effort==='auto')throw new Error('子代理模型與推理程度必須同時設為「AI 自動選擇」，或同時指定。');
 const geminiWorker=GEMINI_WORKER_MODELS.includes(policy.model);
 if(geminiWorker&&(!geminiGateway||!GEMINI_WORKER_EFFORTS.includes(policy.effort)))throw new Error('Gemini Flash 子代理需要已接通的 gateway，並使用 low、medium 或 high；未自動換模。');
 if(!geminiWorker&&!WORKER_MODELS.includes(policy.model))throw new Error('子代理請選 GPT-6.1 Sol、GPT-6 Luna 或已接通 gateway 的 Gemini Flash；未自動換模。');
 if(geminiWorker)return policy;
 const selected=models.find(m=>m.model===policy.model);
 if(!selected)throw new Error(`${policy.model} 目前不可用；未自動換模。`);
 if(Array.isArray(selected.supportedReasoningEfforts)&&!selected.supportedReasoningEfforts.some(item=>item.reasoningEffort===policy.effort))throw new Error(`${policy.model} 不支援 ${policy.effort} 推理程度；未自動換模。`);
 return policy;
}
export function workerPolicyConfig(value,{baseInstructions='',models,geminiGateway=false}={}) {
 const policy=validateWorkerPolicy(value,models,{geminiGateway});
 const auto=policy.model==='auto';
 const flash=policy.model==='gemini-3.8-flash';
 const canUseFlash=geminiGateway;
 const geminiTools='k_gemini 的 gemini_start、gemini_inspect、gemini_wait、gemini_cancel、gemini_accounts';
 const gptChoices='gpt-6.1-sol or gpt-6-luna';
 const autoChoices=canUseFlash?`${gptChoices} or gemini-3.8-flash` : gptChoices;
 const effortText=canUseFlash?'low, medium, high for Flash; choose officially supported efforts for GPT':'officially supported reasoning effort';
 const instructions=[
  'K HARNESS delegation preferences selected by the user:',
  'Delegation is optional. Work directly when delegation would not help; send only the necessary bounded context.',
  auto
   ? `For every delegated task, choose ${autoChoices} based on that task. ${canUseFlash?`For Flash, use low, medium, or high and the ${geminiTools}; `:''}For GPT use the native delegation call and a supported reasoning effort. Pass both choices explicitly to the native delegation call for GPT. This is task-by-task model selection by the main AI, not a K heuristic, failure fallback, or automatic retry; never replay an unknown failure or silently substitute a model. Follow explicit user choices.`
   : flash
    ? `Default worker: gemini-3.8-flash, reasoning effort ${policy.effort}, through ${geminiTools}. GPT Sol/Luna remain native agents; do not set a Gemini model as agents.default_subagent_model. You may still choose a suitable native GPT worker for a task when explicitly requested or more appropriate; do not silently substitute after an unknown failure.`
    : `Default native subagent: ${policy.model}, reasoning effort ${policy.effort}. You may choose ${autoChoices} and the ${effortText} for each task. Follow explicit user choices; do not silently substitute on failure.`,
  `目前官方可用推理程度：${models.filter(m=>WORKER_MODELS.includes(m.model)).map(m=>`${m.model}: ${(m.supportedReasoningEfforts??[]).map(e=>e.reasoningEffort).join(', ')}`).join('; ')}。`,
  'Independently inspect subagent results before accepting them. Model selection grants no additional tool or filesystem permissions.',
  canUseFlash?'Use the existing Codex subscription for GPT agents; do not change GPT accounts or subscription. Gemini account selection/handoff is supported only through the gateway tools and their accountId/handoffFrom fields: inspect the original result first, then create a new handoff for remaining work as needed. Do not replay unknown failures or silently substitute a model.':'Use the existing Codex subscription runtime. Never switch credentials, models, providers or billing routes on failure or quota exhaustion; never replay an unknown outcome or silently substitute a model.',
 ].join('\n');
 return {agents:auto||flash?{enabled:true}:{enabled:true,default_subagent_model:policy.model,default_subagent_reasoning_effort:policy.effort},developer_instructions:[baseInstructions,instructions].filter(Boolean).join('\n\n')};
}
