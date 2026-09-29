export const DEFAULT_WORKER_MODEL = 'gpt-6-luna';
export const IMAGE_WORKER_MODEL = 'gpt-6-luna';

// Preserve legacy metadata for readback; new execution validates the current policy.
export function normalizeWorkerPolicy(value = {}) {
 const model=value?.model??DEFAULT_WORKER_MODEL;
 if(typeof model!=='string'||!model.trim())throw new Error('請選擇子代理模型。');
 return {model,imageModel:IMAGE_WORKER_MODEL};
}
export function validateWorkerPolicy(value,models) {
 const policy=normalizeWorkerPolicy(value);
 if(policy.model!==DEFAULT_WORKER_MODEL)throw new Error('一般子代理限 GPT-6 Luna；未自動換模。');
 if(!models.some(m=>m.model===policy.model))throw new Error('GPT-6 Luna 目前不可用；未自動換模。');
 return policy;
}
export function workerPolicyConfig(value,{baseInstructions=''}={}) {
 const policy=normalizeWorkerPolicy(value);
 if(policy.model!==DEFAULT_WORKER_MODEL)throw new Error('一般子代理限 GPT-6 Luna；未自動換模。');
 const instructions=[
  'K HARNESS delegation preferences selected by the user:',
  'Delegation is optional. Work directly when delegation would not help; send only the necessary bounded context.',
  'All delegated work, including visual interpretation, must use native Codex GPT-6 Luna (gpt-6-luna), reasoning effort high. Do not delegate to other models.',
  'Independently inspect subagent results before accepting them. Model selection grants no additional tool or filesystem permissions.',
  'Use the existing Codex subscription runtime. Never switch credentials, models, providers or billing routes on failure or quota exhaustion.',
  'DeepSeek API is an explicit user-selected emergency route only, not a normal worker or automatic fallback. It is not enabled in this conversation.',
 ].join('\n');
 return {agents:{enabled:true,default_subagent_model:DEFAULT_WORKER_MODEL},developer_instructions:[baseInstructions,instructions].filter(Boolean).join('\n\n')};
}
