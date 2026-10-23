// Native login expiry observed in a main-room turn. Process-wide, like the Claude
// inspection cache: the native status alone cannot show it for Codex, whose
// account/read reports a stored login even when its tokens can no longer refresh.
export {codexAuthExpired} from '../shared/codex-auth-error.mjs';

const expired = new Set();
const listeners = new Set();

export const authExpired = provider => expired.has(provider);

export function reportAuthExpired(provider) {
  expired.add(provider);
  for (const listener of listeners)
    try {
      listener(provider);
    } catch {}
}

export function clearAuthExpired(provider) {
  expired.delete(provider);
}

export function onAuthExpired(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
