import { createSandboxieSpawn } from './sandboxie-process.mjs';
import { createSandboxieBoxControl } from './sandboxie-control.mjs';

function busyError(message) {
  const error = new Error(message);
  error.code = 'ERR_SANDBOXIE_POOL_BUSY';
  return error;
}

function confirmed(value) {
  return value === true || value?.confirmed === true;
}

// Each provider lifecycle gets an independent Sandboxie box. The injected
// runner is returned unchanged so its stdio and terminate contract are kept.
export async function createSandboxiePool({
  startExe, nodeExecutable, bridgePath, boxNames, env, prepareLaunch,
  runnerFactory = createSandboxieSpawn,
  controlFactory = createSandboxieBoxControl,
} = {}) {
  if (!Array.isArray(boxNames) || !boxNames.length || boxNames.some((name) => typeof name !== 'string')) {
    throw new TypeError('At least one explicit Sandboxie box name is required.');
  }
  if (!env || typeof env !== 'object' || Array.isArray(env) ||
      !Object.entries(env).every(([key, value]) => key.length > 0 && !key.includes('=') && typeof value === 'string')) {
    throw new TypeError('An explicit string-valued Sandboxie environment is required.');
  }
  const names = new Set();
  for (const name of boxNames) {
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate Sandboxie box name: ${name}`);
    names.add(key);
  }
  if (typeof runnerFactory !== 'function' || typeof controlFactory !== 'function') {
    throw new TypeError('Sandboxie runner and box-control factories are required.');
  }

  const slots = boxNames.map((boxName) => {
    const control = controlFactory({ startExe, boxName, env });
    if (!control || typeof control.assertIdle !== 'function' || typeof control.stopBox !== 'function') {
      throw new TypeError(`Sandboxie control for ${boxName} must provide assertIdle and stopBox.`);
    }
    const spawnImpl = runnerFactory({ boxName, startExe, nodeExecutable, bridgePath,
      stopBox: control.stopBox, launcherEnv: env,
      prepareLaunch: prepareLaunch ? async details => { await control.assertIdle(); await prepareLaunch(details); } : undefined });
    if (typeof spawnImpl !== 'function') throw new TypeError(`Sandboxie runner for ${boxName} must be a spawn function.`);
    return { boxName, control, spawnImpl, active: null };
  });

  // Do not expose any slot until every configured box has passed preflight.
  await Promise.all(slots.map((slot) => slot.control.assertIdle()));

  let cursor = 0;
  let closed = false;
  let closing = false;
  let closeOperation = null;

  function spawnImpl(command, args, options) {
    if (closed || closing) throw busyError('Sandboxie pool is closing or closed.');
    let slot;
    for (let offset = 0; offset < slots.length; offset += 1) {
      const candidate = slots[(cursor + offset) % slots.length];
      if (!candidate.active) {
        slot = candidate;
        cursor = (slots.indexOf(candidate) + 1) % slots.length;
        break;
      }
    }
    if (!slot) throw busyError('No isolated Sandboxie box is available; host execution is disabled.');

    // Reserve before calling the runner, because it starts asynchronously and
    // another synchronous caller must not select this same box meanwhile.
    const lease = { child: null, closePromise: null, resolveClose: null, error: null };
    lease.closePromise = new Promise((resolve) => { lease.resolveClose = resolve; });
    slot.active = lease;
    let child;
    try { child = slot.spawnImpl(command, args, options); }
    catch (error) {
      lease.error = error;
      throw error; // Unknown runner startup state: deliberately retain the slot.
    }
    if (!child || typeof child.once !== 'function' || typeof child.terminate !== 'function') {
      lease.error = new Error('Sandboxie runner returned no child with confirmed terminate support.');
      throw lease.error; // Do not free a potentially started box.
    }
    lease.child = child;
    child.once('error', (error) => { lease.error = error; });
    child.once('close', () => {
      // createSandboxieSpawn emits close only after stopBox confirms the box is
      // empty. An error alone never returns this slot to the pool.
      if (slot.active === lease) slot.active = null;
      lease.resolveClose();
    });
    return child;
  }

  async function close() {
    if (closed) return;
    if (closeOperation) return closeOperation;
    closing = true;
    closeOperation = (async () => {
      const leases = slots.filter((slot) => slot.active).map((slot) => ({ slot, lease: slot.active }));
      const failures = [];
      await Promise.all(leases.map(async ({ slot, lease }) => {
        if (!lease.child) {
          failures.push(new Error(`Sandboxie box ${slot.boxName} has an unconfirmed startup and no terminable child.`));
          return;
        }
        try {
          const result = await lease.child.terminate('pool-close');
          if (!confirmed(result)) throw new Error(`Sandboxie termination of ${slot.boxName} was not confirmed.`);
          await lease.closePromise;
          if (slot.active === lease) throw new Error(`Sandboxie close event for ${slot.boxName} was not observed.`);
        } catch (error) {
          failures.push(new Error(`Could not safely close Sandboxie box ${slot.boxName}: ${error?.message ?? 'unknown error'}`, { cause: error }));
        }
      }));
      if (failures.length) throw new AggregateError(failures, 'Sandboxie pool close failed; unconfirmed boxes remain reserved.');
      closed = true;
    })();
    try { await closeOperation; }
    catch (error) { closeOperation = null; throw error; }
  }

  return { spawnImpl, close, get boxes() { return slots.map(({ boxName, active }) => ({ boxName, busy: Boolean(active) })); } };
}
