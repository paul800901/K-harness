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
const failed = [],
  known = [];
for (const name of probes) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join('test', name)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 400000,
    windowsHide: true
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1),
    output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  known.push(...output.split('\n').filter(line => line.startsWith('KNOWN REGRESSION ')));
  if (result.status === 0) {
    console.log(`ok   ${name} (${seconds}s)`);
    continue;
  }
  failed.push(name);
  // A probe killed on timeout skips its own cleanup; its browser or server may still hold a fixed port.
  const detail = result.signal
    ? `逾時或被中止（${result.signal}）；請確認沒有殘留的 node／chrome 程序`
    : result.error
      ? `無法執行（${result.error.code ?? result.error.message}）`
      : output
          .split('\n')
          .find(line => /Error/.test(line))
          ?.trim()
          .slice(0, 200);
  console.log(`FAIL ${name} (${seconds}s)${detail ? ` — ${detail}` : ''}`);
}
console.log(`\n${probes.length - failed.length}/${probes.length} UI probes passed.`);
if (known.length) console.log(`已知退化（待本人決定，不算失敗）：\n${known.map(line => `  ${line}`).join('\n')}`);
process.exit(failed.length ? 1 : 0);
