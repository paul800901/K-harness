import fs from 'node:fs';
import path from 'node:path';

const HEX_40 = /^[0-9a-f]{40}$/;

function readJsonSync(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function readSelfUpdate(repoRoot) {
  if (!repoRoot || typeof repoRoot !== 'string') {
    return {available: null, failed: null};
  }
  const runtime = readJsonSync(path.join(repoRoot, '.local', 'runtime.json'));
  const updateReady = readJsonSync(path.join(repoRoot, '.local', 'update-ready.json'));
  const result = readJsonSync(path.join(repoRoot, '.local', 'self-update-result.json'));

  const version = typeof runtime?.version === 'string' ? runtime.version : null;
  const rawRef = typeof updateReady?.ref === 'string' ? updateReady.ref : null;
  const ref = rawRef && HEX_40.test(rawRef) ? rawRef : null;

  const available = ref && ref !== version ? ref : null;
  const failed =
    ref && result && result.ok === false && result.to === ref
      ? {reason: result.reason ?? '', finishedAt: result.finishedAt ?? null}
      : null;

  return {available, failed};
}
