import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';

// Explicit memory-only stores avoid reading the user's Pi login or model config.
export function createModelRuntime() {
  return ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
}

export async function createDeepSeekRuntime(modelId, apiKey) {
  if (typeof modelId !== 'string' || !modelId.trim()) {
    throw new Error('An exact DeepSeek model ID is required; no automatic model selection.');
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('DEEPSEEK_API_KEY is required for an explicitly authorized live run.');
  }
  const modelRuntime = await createModelRuntime();
  const model = modelRuntime.getModel('deepseek', modelId);
  if (!model) throw new Error('The selected DeepSeek model is not in the pinned Pi catalog.');
  await modelRuntime.setRuntimeApiKey('deepseek', apiKey);
  return { modelRuntime, model };
}
