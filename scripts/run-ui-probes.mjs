// Runs every real-browser UI probe (test/*-ui-probe.mjs) one at a time against the built UI and lists the
// result. Probes use fixed ports, so they never run in parallel. Build first: npm run build:ui.
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
if (!existsSync(path.join(root, 'dist-ui', 'index.html'))) {
  console.error('dist-ui 尚未建置；請先執行 npm run build:ui。');
  process.exit(1);
}
const only = process.argv.slice(2);
const probes = readdirSync(path.join(root, 'test'))
  .filter(name => name.endsWith('-ui-probe.mjs') && (!only.length || only.some(part => name.includes(part))))
  .sort();
const failed = [];
for (const name of probes) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join('test', name)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 400000,
    windowsHide: true
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status === 0) console.log(`ok   ${name} (${seconds}s)`);
  else {
    failed.push(name);
    const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.split('\n').find(line => /Error/.test(line));
    console.log(`FAIL ${name} (${seconds}s)${detail ? ` — ${detail.trim().slice(0, 200)}` : ''}`);
  }
}
console.log(`\n${probes.length - failed.length}/${probes.length} UI probes passed.`);
process.exit(failed.length ? 1 : 0);
