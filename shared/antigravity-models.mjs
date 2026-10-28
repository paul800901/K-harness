// Keep existing Gemini IDs stable. Other agy models need a core-qualified ID so
// a Claude/GPT model offered by Antigravity cannot enter another subscription.
export const isAntigravityModel = model =>
  typeof model === 'string' && (model.startsWith('gemini-') || model.startsWith('antigravity:'));
export const antigravityModelId = native => (native.startsWith('gemini-') ? native : `antigravity:${native}`);
export const antigravityNativeModel = model => (model.startsWith('antigravity:') ? model.slice(12) : model);
// Only these native models have verified view_file media support.
export const antigravitySupportsMedia = model =>
  ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.1-pro'].includes(model);

export function antigravityModelNames(stdout) {
  return [
    ...new Set(
      stdout.split(/\r?\n/u).flatMap(line => {
        const id = line.trim().split(/\s/u)[0];
        return /^[a-z0-9][\w.-]*$/u.test(id) ? [id] : [];
      })
    )
  ];
}
