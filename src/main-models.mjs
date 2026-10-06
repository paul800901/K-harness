// The Codex app-server is the authority for the account's picker-visible
// models.  Keep this helper deliberately catalog-only: it never starts a
// thread or a turn and it never falls back to a local model list.
export async function listMainModels(host) {
  if (!host?.request) throw new Error('Codex host is required.');
  const models = [];
  let cursor;
  const seenCursors = new Set();
  do {
    const params = {limit: 100, includeHidden: false};
    if (cursor) params.cursor = cursor;
    const page = await host.request('model/list', params);
    for (const model of page?.data ?? []) {
      if (model && model.hidden !== true) models.push(model);
    }
    const next = page?.nextCursor ?? null;
    if (next && seenCursors.has(next)) throw new Error('Codex model catalog pagination repeated a cursor.');
    if (next) seenCursors.add(next);
    cursor = next;
  } while (cursor);
  return models;
}

export function findMainModel(models, model) {
  return models.find(entry => entry?.model === model);
}

export function validMainModel(model) {
  return typeof model === 'string' && model.trim().length > 0 && model.length <= 256;
}

export function reasoningEfforts(model) {
  return (model?.supportedReasoningEfforts ?? [])
    .map(entry => entry?.reasoningEffort)
    .filter(value => typeof value === 'string' && value.length > 0);
}

export function fastServiceTier(model) {
  const tiers = model?.serviceTiers;
  if (!Array.isArray(tiers)) return null;
  const fast = tiers.filter(tier => tier?.name === 'Fast' && typeof tier.id === 'string' && tier.id.length > 0);
  return fast.length === 1 ? {...fast[0]} : null;
}

export function mainServiceTier(model, requested) {
  const fast = fastServiceTier(model);
  return fast && requested === fast.id ? fast.id : 'default';
}

export function supportsImages(model) {
  // Official compatibility rule for older catalogs lacking this field.
  return !Array.isArray(model?.inputModalities) || model.inputModalities.includes('image');
}
