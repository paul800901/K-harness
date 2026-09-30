export const DEFAULT_WORKER_MODEL = 'auto';
export const DEFAULT_WORKER_EFFORT = 'auto';
export const WORKER_MODELS = ['gpt-6.1-sol','gpt-6-luna'];

// Preserve legacy metadata for readback; new execution validates the current policy.
export function normalizeWorkerPolicy(value = {}) {
 const model=value?.model??DEFAULT_WORKER_MODEL;
 if(typeof model!=='string'||!model.trim())throw new Error('請選擇子代理模型。');
 const effort=value?.effort??(model==='auto'?DEFAULT_WORKER_EFFORT:'high');
 return {model,effort};
}
export function validateWorkerPolicy(value,models) {
 const policy=normalizeWorkerPolicy(value);
 if(policy.model==='auto'&&policy.effort==='auto')return policy;
 if(policy.model==='auto'||policy.effort==='auto')throw new Error('子代理模型與推理程度必須同時設為「AI 自動選擇」，或同時指定。');
 if(!WORKER_MODELS.includes(policy.model))throw new Error('子代理請選 GPT-6.1 Sol 或 GPT-6 Luna；未自動換模。');
 const selected=models?.find(m=>m.model===policy.model);
 if(!selected)throw new Error(`${policy.model} 目前不可用；未自動換模。`);
 if(Array.isArray(selected.supportedReasoningEfforts)&&!selected.supportedReasoningEfforts.some(item=>item.reasoningEffort===policy.effort))throw new Error(`${policy.model} 不支援 ${policy.effort} 推理程度；未自動換模。`);
 return policy;
}
export function workerPolicyConfig(value,{baseInstructions='',models}={}) {
 const policy=normalizeWorkerPolicy(value);
 if(policy.model!=='auto'&&!WORKER_MODELS.includes(policy.model))throw new Error('子代理請選 GPT-6.1 Sol 或 GPT-6 Luna；未自動換模。');
 const auto=policy.model==='auto'&&policy.effort==='auto';
 if(!auto&&(policy.model==='auto'||policy.effort==='auto'))throw new Error('子代理模型與推理程度必須同時設為「AI 自動選擇」，或同時指定。');
 const availableEfforts=models?[`目前官方可用推理程度：${models.filter(m=>WORKER_MODELS.includes(m.model)).map(m=>`${m.model}: ${(m.supportedReasoningEfforts??[]).map(e=>e.reasoningEffort).join(', ')}`).join('; ')}。`]:[];
 const instructions=[
  'K HARNESS delegation preferences selected by the user:',
  'Delegation is optional. Work directly when delegation would not help; send only the necessary bounded context.',
  auto
   ? 'For every delegated task, choose gpt-6.1-sol or gpt-6-luna and one officially supported reasoning effort based on that task. Pass both choices explicitly to the native delegation call. This is task-by-task model selection by the main AI, not a K heuristic, failure fallback, or automatic retry. Follow explicit user choices.'
   : `Default native subagent: ${policy.model}, reasoning effort ${policy.effort}. You may choose gpt-6.1-sol or gpt-6-luna and its officially supported reasoning effort for each task. Follow explicit user choices; do not silently substitute on failure.`,
  ...availableEfforts,
  'Independently inspect subagent results before accepting them. Model selection grants no additional tool or filesystem permissions.',
  'Use the existing Codex subscription runtime. Never switch credentials, models, providers or billing routes on failure or quota exhaustion.',
 ].join('\n');
 return {agents:auto?{enabled:true}:{enabled:true,default_subagent_model:policy.model,default_subagent_reasoning_effort:policy.effort},developer_instructions:[baseInstructions,instructions].filter(Boolean).join('\n\n')};
}
