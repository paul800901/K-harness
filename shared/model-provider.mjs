export const modelProvider = model => model?.startsWith('claude-') ? 'claude' : model?.startsWith('gemini-') ? 'gemini' : 'codex';
