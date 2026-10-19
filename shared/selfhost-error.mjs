// K's self-host bridge rejects with {"error":{"message","code":"k_selfhost_…","diagnostic"}}.
// Installed Codex 0.163.0 was observed to fail the turn with that complete JSON body
// as error.message (codexErrorInfo "other", no retry). Used by the UI notice and by
// goal-recovery classification; never by itself a reason to retry or replay.
export const selfHostPreparationCodes = new Set([
  'k_selfhost_prepare_failed',
  'k_selfhost_load_failed',
  'k_selfhost_state_unknown',
  'k_selfhost_busy'
]);

export function selfHostBridgeError(error) {
  for (let value of [error?.message, error?.additionalDetails]) {
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    const found = value?.error;
    if (typeof found?.code === 'string' && /^k_selfhost_[a-z_]+$/u.test(found.code) && typeof found.message === 'string')
      return found;
  }
  return null;
}
