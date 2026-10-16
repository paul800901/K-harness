export const gemmaConnection = model => /^gemma-(local|cloud)\//u.exec(model ?? '')?.[1] ?? null;
export const modelProvider = model =>
  gemmaConnection(model)
    ? 'gemma'
    : model?.startsWith('claude-')
      ? 'claude'
      : model?.startsWith('gemini-')
        ? 'gemini'
        : 'codex';
export const usesCodexCore = provider => provider === 'codex' || provider === 'gemma';
