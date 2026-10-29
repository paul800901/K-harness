import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFile, mkdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {atomicWrite} from './atomic-write.mjs';

const execFileAsync = promisify(execFile);
const helperPath = fileURLToPath(new URL('../scripts/gemini-credentials.ps1', import.meta.url));
function accountIdFor(email) {
  return createHash('sha256').update(email.toLowerCase(), 'utf8').digest('hex').slice(0, 32);
}
function safeAccountId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/iu.test(value)) throw Error('Gemini 帳號識別碼格式無效。');
  return value.toLowerCase();
}
function parseOutput(stdout, operation) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw Error('Windows 憑證 helper 回傳格式無效。');
  }
  if (operation === 'assertIdle') return value;
  if (value === null) {
    if (operation === 'queryQuota') throw Error('Gemini 額度回傳缺失。');
    return null;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.email !== 'string' ||
    typeof value.accountId !== 'string' ||
    safeAccountId(value.accountId) !== value.accountId ||
    accountIdFor(value.email) !== value.accountId
  )
    throw Error('Windows 憑證 helper 回傳安全中繼資料無效。');
  const account = {accountId: value.accountId, email: value.email};
  if (operation === 'current') return {...account, writtenAt: iso(value.writtenAt)};
  if (operation !== 'queryQuota') return account;
  const checkedAt =
    typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt)) ? value.checkedAt : null;
  if (!checkedAt || !Array.isArray(value.windows)) throw Error('Gemini 官方額度回傳格式無效。');
  const windows = ['five_hour', 'seven_day'].map(key => {
    const rows = value.windows.filter(w => w?.key === key);
    if (rows.length !== 1) throw Error('Gemini 官方額度窗口缺失或重複。');
    const w = rows[0],
      disabled = w.disabled === true;
    if (!disabled && (!Number.isFinite(w.remainingPercent) || w.remainingPercent < 0 || w.remainingPercent > 100))
      throw Error('Gemini 官方額度數值無效。');
    return {
      key,
      label: key === 'five_hour' ? '5 小時' : '每週',
      minutes: key === 'five_hour' ? 300 : 10080,
      disabled,
      remainingPercent: disabled ? null : w.remainingPercent,
      resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt : null
    };
  });
  return {
    ...account,
    auth: {status: 'authenticated', checkedAt, requiresActivation: value.requiresActivation === true},
    quota: {status: 'ready', checkedAt, windows},
    refreshed: value.refreshed === true
  };
}
const HELPER_CODES = ['busy', 'identity', 'credential', 'quota_auth', 'quota_temporary', 'quota_client', 'quota_schema'];
const DIAGNOSTICS_MAX_BYTES = 1024 * 1024;
const HELPER_REASONS = [
  'identity_missing',
  'identity_json_invalid',
  'identity_email_invalid',
  'account_required',
  'saved_account_mismatch',
  'saved_account_removed',
  'native_process_present'
];
// Re-serialize instead of keeping the helper's text, so a time field cannot carry other content.
const iso = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value))
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const names = value =>
  (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .filter(name => typeof name === 'string' && /^[a-z][a-z0-9_]{0,31}$/u.test(name))
    .slice(0, 16);
const oneOf = (value, allowed) => (allowed.includes(value) ? value : null);
// Rebuild the helper's failure report from known fields only: names, booleans,
// sizes and times. Anything else the helper might print is dropped.
function helperFailure(stdout, operation) {
  let value;
  try {
    value = JSON.parse(String(stdout ?? ''));
  } catch {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const live = value.live && typeof value.live === 'object' && !Array.isArray(value.live) ? value.live : null;
  const processes = value.processes && typeof value.processes === 'object' ? [value.processes].flat() : null;
  return {
    operation,
    code: oneOf(value.errorCode, HELPER_CODES) ?? 'unknown',
    reason: oneOf(value.errorReason, HELPER_REASONS),
    line: Number.isSafeInteger(value.errorLine) && value.errorLine > 0 ? value.errorLine : null,
    ...(live
      ? {
          live: {
            present: live.present === true,
            unreadable: live.unreadable === true,
            bytes: Number.isSafeInteger(live.bytes) ? live.bytes : null,
            writtenAt: iso(live.writtenAt),
            json: live.json === 'invalid' ? 'invalid' : null,
            fields: names(live.fields),
            tokenFields: names(live.tokenFields),
            idToken: oneOf(live.idToken, ['absent', 'string', 'other']),
            idTokenEmail: oneOf(live.idTokenEmail, ['absent', 'valid', 'invalid', 'other']),
            identityReadable: typeof live.identityReadable === 'boolean' ? live.identityReadable : null
          }
        }
      : {}),
    ...(processes
      ? {
          processes: processes.slice(0, 16).map(row => ({
            pid: Number.isSafeInteger(row?.pid) ? row.pid : null,
            name: oneOf(row?.name, ['agy', 'Antigravity', 'Antigravity.exe']),
            startedAt: iso(row?.startedAt)
          }))
        }
      : {})
  };
}
function safeFailureMessage({code, reason, line, operation}) {
  const where = `（${operation}：${reason ?? code}${line ? `，第 ${line} 行` : ''}）`;
  if (code === 'busy')
    return `Antigravity 正在執行（可能是官方視窗關閉後留下的背景程式）；請等它停止，再新增、保存、取消或切換帳號，未變更登入。${where}`;
  if (code === 'identity') return `憑證身分缺失或不唯一，拒絕操作。${where}`;
  if (code === 'credential') return `Windows 憑證操作失敗；未輸出憑證內容。${where}`;
  return `Windows 憑證 helper 執行失敗；未輸出憑證內容。${where}`;
}

/** Credentials stay in the Windows helper process; Node receives safe identity/quota only. */
export function createGeminiCredentialVault({
  root,
  env = process.env,
  execImpl = execFileAsync,
  enabled = false,
  diagnosticsFile = null,
  clock = Date.now
} = {}) {
  if (typeof root !== 'string' || !/^[a-f0-9]{32,64}$/iu.test(root))
    throw Error('Gemini 憑證命名空間必須是外部提供的十六進位 root hash。');
  const namespace = root.toLowerCase();
  const powershell = path.join(
    env.SystemRoot ?? env.WINDIR ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  // Serialize helper reads/refreshes with capture/activation. A quota refresh
  // writes only its existing managed target, never the native live credential.
  let pending = Promise.resolve();
  // Engineering evidence kept for later repair (no secrets): every helper failure,
  // and each change of the shared login's last-written time seen by a read.
  let diagnostics = Promise.resolve(),
    lastWrittenAt;
  function diagnose(entry) {
    if (!diagnosticsFile) return;
    const line = JSON.stringify({at: new Date(clock()).toISOString(), ...entry}) + '\n';
    diagnostics = diagnostics.then(async () => {
      try {
        await mkdir(path.dirname(diagnosticsFile), {recursive: true});
        await appendFile(diagnosticsFile, line, 'utf8');
        if ((await stat(diagnosticsFile)).size <= DIAGNOSTICS_MAX_BYTES) return;
        let text = await readFile(diagnosticsFile, 'utf8');
        while (Buffer.byteLength(text) > DIAGNOSTICS_MAX_BYTES / 2 && text.includes('\n'))
          text = text.slice(text.indexOf('\n') + 1);
        await atomicWrite(diagnosticsFile, text);
      } catch {
        /* Diagnostics never change a credential operation's result. */
      }
    });
  }
  function invoke(...args) {
    const operation = pending.then(() => invokeHelper(...args));
    pending = operation.catch(() => {});
    return operation;
  }
  async function invokeHelper(operation, accountId, {preserveCurrent = true} = {}) {
    if (!enabled) throw Error('Gemini 多帳號憑證功能尚未啟用。');
    if (!['current', 'capture', 'activate', 'prepareLogin', 'assertIdle', 'queryQuota'].includes(operation))
      throw Error('Gemini 憑證操作無效。');
    if (typeof preserveCurrent !== 'boolean') throw Error('Gemini 憑證切換選項無效。');
    const args = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      helperPath,
      '-Operation',
      operation,
      '-Namespace',
      namespace
    ];
    if (accountId !== undefined) args.push('-AccountId', safeAccountId(accountId));
    if (operation === 'activate' && !preserveCurrent) args.push('-SkipCaptureCurrent');
    if (operation === 'queryQuota') {
      const executable =
        env.K_GEMINI_EXECUTABLE ?? (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe') : null);
      if (!executable) throw Error('找不到官方 Antigravity 執行檔，未查詢帳號。');
      args.push('-Executable', executable);
    }
    let result;
    try {
      result = await execImpl(powershell, args, {
        windowsHide: true,
        encoding: 'utf8',
        timeout: operation === 'queryQuota' ? 60000 : 15000,
        maxBuffer: 16384
      });
    } catch (error) {
      const failure = helperFailure(error?.stdout, operation);
      diagnose({kind: 'helper_failure', ...failure});
      if (operation === 'queryQuota') {
        const code = failure.code === 'unknown' ? undefined : failure.code;
        const signedOut = code === 'quota_auth';
        return {
          accountId,
          auth: {status: signedOut ? 'signed-out' : 'unknown'},
          failureCode: code ?? 'quota_temporary',
          temporaryFailure: ['quota_temporary', 'credential', undefined].includes(code),
          reason: signedOut
            ? '此帳號需重新確認官方登入。'
            : code === 'quota_client'
              ? '官方額度介面、權限或登入參數無法使用；需要檢查接頭，未切換帳號。'
              : code === 'identity'
                ? '帳號身分未確認；未接受額度資料。'
                : code === 'quota_schema'
                  ? '官方額度回傳格式改變或缺失；需要檢查接頭，未派工。'
                  : code === 'credential'
                    ? '本機憑證讀寫尚未確認；K 保留等待，未派工。'
                    : '官方額度暫時無法確認；不是額度耗盡。'
        };
      }
      throw Object.assign(Error(safeFailureMessage(failure)), {
        code: `GEMINI_CREDENTIAL_${failure.code.toUpperCase()}`,
        helperFailure: {operation, code: failure.code, reason: failure.reason, line: failure.line}
      });
    }
    let payload;
    try {
      payload = parseOutput(result?.stdout ?? '', operation);
    } catch (error) {
      if (operation !== 'queryQuota') throw error;
      return {
        accountId,
        auth: {status: 'unknown'},
        failureCode: 'quota_schema',
        temporaryFailure: false,
        reason: '官方額度回傳格式改變或缺失；需要檢查接頭，未派工。'
      };
    }
    if (operation === 'assertIdle') {
      if (payload?.idle !== true)
        throw Error('Antigravity 正在執行；請先關閉官方視窗並等工作停止，再新增、保存、取消或切換帳號。');
      return {idle: true};
    }
    if (operation === 'prepareLogin') {
      if (payload === null) return {previousAccountId: null};
      return {previousAccountId: payload.accountId};
    }
    if (operation === 'current' && payload) {
      if (payload.writtenAt !== lastWrittenAt) {
        if (lastWrittenAt !== undefined)
          diagnose({kind: 'live_login_rewritten', accountId: payload.accountId, writtenAt: payload.writtenAt});
        lastWrittenAt = payload.writtenAt;
      }
      return {accountId: payload.accountId, email: payload.email};
    }
    return payload;
  }
  return Object.freeze({
    // Tests wait for queued diagnostic writes.
    flushDiagnostics: () => diagnostics,
    async current() {
      return invoke('current');
    },
    async queryQuota(accountId) {
      return invoke('queryQuota', safeAccountId(accountId));
    },
    async assertIdle() {
      return invoke('assertIdle');
    },
    async capture() {
      await invoke('assertIdle');
      const account = await invoke('capture');
      if (!account) throw Error('目前沒有可保存的 Antigravity 帳號憑證。');
      return account;
    },
    async activate(accountId, {preserveCurrent = true} = {}) {
      await invoke('assertIdle');
      const account = await invoke('activate', accountId, {preserveCurrent});
      if (!account) throw Error('找不到指定的已保存 Antigravity 帳號。');
      return account;
    },
    async prepareLogin() {
      await invoke('assertIdle');
      return invoke('prepareLogin');
    }
  });
}
