// Existing Gemma IDs stay gemma-local/… and gemma-cloud/…; other self-hosted main agents
// use selfhost-<id>/…. All share the internal 'gemma' provider key (Codex core, no subscription).
export const gemmaConnection = model => {
  const match = /^(?:gemma-(local|cloud)|(selfhost-[a-z0-9][a-z0-9._-]{0,63}))\//u.exec(model ?? '');
  return match?.[1] ?? match?.[2] ?? null;
};
export const modelProvider = model =>
  gemmaConnection(model)
    ? 'gemma'
    : model?.startsWith('claude-')
      ? 'claude'
      : model?.startsWith('gemini-')
        ? 'gemini'
        : 'codex';
export const usesCodexCore = provider => provider === 'codex' || provider === 'gemma';
