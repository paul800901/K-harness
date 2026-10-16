// Shared worker-status vocabulary. Callers keep their own extra conditions
// (display, completion notice, release); only the ended test is common.
// 'canceled' is accepted on read; K itself writes 'cancelled'.
const ENDED_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled', 'stopped', 'interrupted']);
const LIVE_STATUSES = new Set(['running', 'starting', 'pending', 'unresolved']);

// settled:true wins; settled:false (for example failed with stop unconfirmed) is never ended.
export const workerEnded = worker =>
  worker.settled === true || (worker.settled !== false && ENDED_STATUSES.has(worker.status));

// Releasing or reusing a room needs the stricter test: a contradictory record
// such as running + settled:true still counts as possibly live.
export const workerMayBeLive = worker =>
  worker.settled === false || LIVE_STATUSES.has(worker.status) || !workerEnded(worker);
