import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs, parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Run only after the user authorizes copying the key into this project.
async function main() {
  const { values } = parseArgs({ options: { source: { type: 'string' } } });
  if (!values.source) throw new Error('An explicitly authorized source file is required.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const destination = path.join(root, '.env.local');
  execFileSync('git', ['check-ignore', '--quiet', '.env.local'], { cwd: root });
  if (execFileSync('git', ['ls-files', '--', '.env.local'], { cwd: root, encoding: 'utf8' }).trim()) {
    throw new Error('Destination is tracked; refusing to write a credential.');
  }
  const source = parseEnv((await readFile(path.resolve(values.source), 'utf8')).replace(/^\uFEFF/u, ''));
  const key = source.DEEPSEEK_API_KEY;
  if (typeof key !== 'string' || !key.trim() || /[\r\n]/u.test(key)) throw new Error('The source does not contain a usable single-line key.');
  let existing;
  try { existing = parseEnv(await readFile(destination, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && existing.DEEPSEEK_API_KEY !== key) throw new Error('A different destination credential already exists; no overwrite performed.');
  if (!existing) {
    await writeFile(destination, `DEEPSEEK_API_KEY=${JSON.stringify(key)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const readback = parseEnv(await readFile(destination, 'utf8'));
  if (readback.DEEPSEEK_API_KEY !== key) throw new Error('Credential readback did not match.');
  process.stdout.write(`${JSON.stringify({ destination, status: existing ? 'unchanged' : 'created', readbackMatches: true, gitIgnored: true, sourcePreserved: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`Credential setup stopped (${error?.name ?? 'Error'}). No credential values are displayed.\n`);
  process.exitCode = 1;
});
