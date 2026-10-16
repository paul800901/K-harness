import test from 'node:test';
import assert from 'node:assert/strict';
import {workerEnded, workerMayBeLive} from '../src/worker-status.mjs';
import {workerEnded as shownEnded} from '../frontend/work-status.mjs';

// [worker, ended, mayBeLive]
const matrix = [
  [{status: 'completed'}, true, false],
  [{status: 'cancelled'}, true, false],
  [{status: 'canceled'}, true, false],
  [{status: 'stopped'}, true, false],
  [{status: 'interrupted'}, true, false],
  [{status: 'failed'}, true, false],
  // Failed but the stop is unconfirmed: not ended, keeps the room.
  [{status: 'failed', settled: false}, false, true],
  [{status: 'running'}, false, true],
  [{status: 'unresolved'}, false, true],
  [{status: 'mystery'}, false, true],
  [{}, false, true],
  [{settled: true}, true, false],
  // Contradictory record: shown as ended, but release still treats it as live.
  [{status: 'running', settled: true}, true, true],
  [{status: 'unresolved', settled: true}, true, true]
];

test('shared worker status keeps ended and possibly-live distinct', () => {
  for (const [worker, ended, live] of matrix) {
    assert.equal(workerEnded(worker), ended, `ended ${JSON.stringify(worker)}`);
    assert.equal(workerMayBeLive(worker), live, `live ${JSON.stringify(worker)}`);
  }
});

test('display also treats the summary status ended as ended unless stop is unconfirmed', () => {
  for (const [worker, ended] of matrix) assert.equal(shownEnded(worker), ended, JSON.stringify(worker));
  assert.equal(shownEnded({status: 'ended'}), true);
  assert.equal(shownEnded({status: 'ended', settled: false}), false);
  assert.equal(workerEnded({status: 'ended'}), false, 'backend does not widen release on the UI summary status');
});
