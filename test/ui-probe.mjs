// Shared setup for the real-browser UI probes (run by hand: node test/<name>-ui-probe.mjs).
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scratchBase} from './scratch.mjs';

// The project's own Chromium in .runtime/playwright-browsers, from this checkout or, for a worktree under
// .runtime, from the main checkout above it. Every probe measures layout in the same browser.
function browsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  for (let dir = fileURLToPath(new URL('..', import.meta.url)); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, '.runtime', 'playwright-browsers');
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) throw Error('找不到專案的 .runtime/playwright-browsers。');
  }
}
// Playwright reads the browsers path when it is first imported.
process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath();
const {chromium} = await import('playwright');

// A probe that imports Playwright (directly or via src/) before this module would silently use another browser.
if (!path.resolve(chromium.executablePath()).startsWith(path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH)))
  throw Error('Playwright 已在 ui-probe.mjs 之前載入；請讓實測先 import ./ui-probe.mjs。');
export function launchProbeBrowser(options = {}) {
  return chromium.launch({channel: 'chromium', headless: true, ...options});
}
export function launchProbeContext(profile, options = {}) {
  return chromium.launchPersistentContext(profile, {channel: 'chromium', headless: true, ...options});
}
// Screenshots and result files go to this run's auto-cleaned scratch folder unless K_UI_EVIDENCE_DIR asks
// to keep them (for an engineering record).
export function probeEvidenceDir(name) {
  return path.join(process.env.K_UI_EVIDENCE_DIR ?? scratchBase, name);
}
// A throwaway self-signed localhost certificate for the HTTPS remote probes, made per run with the openssl
// that ships with Git for Windows; nothing is kept after the run.
export async function probeTlsCertificate() {
  const {execFileSync} = await import('node:child_process');
  const {mkdtempSync, readFileSync} = await import('node:fs');
  const dir = mkdtempSync(path.join(scratchBase, 'tls-'));
  const key = path.join(dir, 'key.pem'),
    cert = path.join(dir, 'cert.pem');
  const gitOpenssl = 'C:/Program Files/Git/usr/bin/openssl.exe';
  execFileSync(
    existsSync(gitOpenssl) ? gitOpenssl : 'openssl',
    ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1'].concat([
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
      '-keyout',
      key,
      '-out',
      cert
    ]),
    {stdio: 'ignore'}
  );
  return {key: readFileSync(key), cert: readFileSync(cert)};
}
// Recorded regressions awaiting a product decision (docs/ui-probes-20261014.md). These cases still run and are
// reported on every run (npm run test:ui lists them), but do not fail the probe. Delete an entry once fixed.
const knownRegressions = new Set(['900x700@150']);
export function knownRegression(width, height, scale) {
  return knownRegressions.has(`${width}x${height}@${scale}`);
}
export function reportKnownRegression(probe, width, height, scale, error) {
  console.error(`KNOWN REGRESSION ${probe} ${width}x${height}@${scale}: ${String(error?.message).split('\n')[0]}`);
}
