export const DEFAULT_WORKER_MODEL = 'deepseek-v4-flash';
export const IMAGE_WORKER_MODEL = 'gpt-5.6-luna';

export function normalizeWorkerPolicy(value = {}) {
 const model=value?.model??DEFAULT_WORKER_MODEL;
 if(typeof model!=='string'||!model.trim())throw new Error('請選擇子代理模型。');
 return {model,imageModel:IMAGE_WORKER_MODEL};
}

export function validateWorkerPolicy(value,models) {
 const policy=normalizeWorkerPolicy(value);
 if(policy.model!==DEFAULT_WORKER_MODEL&&!models.some(m=>m.model===policy.model))throw new Error('指定的子代理模型目前不可用；未自動換模。');
 return policy;
}

// Flash keeps its existing Pi/MCP execution path; GPT workers use native Codex
// agents and the subscription login. Never put a DeepSeek model in Codex's
// native model field or forward the subscription credential to Pi.
export function workerPolicyConfig(value,{baseInstructions=''}={}) {
 const policy=normalizeWorkerPolicy(value);
 const nativeDefault=policy.model===DEFAULT_WORKER_MODEL?IMAGE_WORKER_MODEL:policy.model;
 const instructions=[
  'K HARNESS delegation preferences selected by the user:',
  'Delegation is optional. Work directly when a subtask would not benefit from delegation; never split work merely to use a subagent.',
  `The default general-purpose subagent is ${policy.model}.`,
  policy.model===DEFAULT_WORKER_MODEL
   ? 'Use k_flash only for suitable bounded text/file tasks within its declared tools. Flash is a cost-saving default, not the only allowed worker. For complex work unsuitable for Flash, work directly or use an appropriate available native Codex GPT subagent.'
   : `Use native Codex collaboration tools with model ${policy.model} for suitable delegated tasks. Do not silently replace that choice with Flash or another model.`,
  `Any delegated task requiring visual interpretation of images, screenshots, Blender scenes or rendered results must use native Codex model ${IMAGE_WORKER_MODEL}. Never delegate image interpretation to Flash or to another model. If Luna is unavailable, report the limitation instead of falling back.`,
  'Model selection does not grant tool or filesystem permissions. Use only actually available tools; report missing Blender or other capabilities. Independently inspect subagent results before accepting them.',
  'GPT subagents use the existing Codex subscription runtime. Flash uses its existing DeepSeek API connection. Do not switch credentials, providers or billing routes to bypass an unavailable model.',
 ].join('\n');
 return {agents:{enabled:true,default_subagent_model:nativeDefault},developer_instructions:[baseInstructions,instructions].filter(Boolean).join('\n\n')};
}
