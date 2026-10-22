import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {atomicWrite} from './atomic-write.mjs';
import {quotaZeroUntil, quotaZeroRecheckDue} from './quota-zero.mjs';

const unknown = () => ({status: 'unavailable', windows: [], note: '尚未查詢此帳號的官方額度。'});
const clone = value => structuredClone(value);
// How often a saved account that is not the active one is re-read while K's screen is open.
const OTHER_ACCOUNT_QUERY_MS = 5 * 60000;
const validId = id => typeof id === 'string' && /^[a-f0-9]{32}$/u.test(id);

// One native login is shared by all Gemini processes. Settings and project data
// never enter this registry; secrets stay behind the Windows vault adapter.
export function createGeminiAccounts({
  root,
  login,
  vault,
  enabled = false,
  clock = Date.now,
  onChange = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  const file = path.join(root, '.runtime', 'gemini-accounts.json');
  let data = {version: 1, activeAccountId: null, accounts: [], loginPending: null, uncertain: false};
  let changing = false,
    running = 0,
    refreshPending = null,
    acquiring = null,
    recoveryAttemptedAt = null;
  const queries = new Map();
  let savePending = Promise.resolve(),
    retryDelay = 60000;
  const quotaWait = message => Object.assign(Error(message), {code: 'GEMINI_QUOTA_WAIT'});
  const handoffWaiters = new Map();
  // Account work a release started without waiting for it; see idle().
  let background = Promise.resolve();
  // The background read of a non-active account that usage() started; see usage().
  let otherQuery = null;
  // Which saved account a refresh-all is querying now, so the person sees it advance.
  let queryProgress = null;
  let handoffPending = null,
    resetTimer = null;
  const clearReset = () => {
    if (resetTimer !== null) {
      clearTimer(resetTimer);
      resetTimer = null;
    }
  };
  let loading;
  const load = () =>
    (loading ??= (async () => {
      try {
        data = JSON.parse(await readFile(file, 'utf8'));
        if (
          data.version !== 1 ||
          !Array.isArray(data.accounts) ||
          data.accounts.some(row => !validId(row.id) || typeof row.email !== 'string')
        )
          throw Error('Gemini 帳號紀錄格式不符，未覆寫。');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (data.quotaRefreshOriginalId) data.uncertain = true;
    })());
  const save = () => {
    const text = JSON.stringify(data, null, 2);
    const saved = savePending.then(() => atomicWrite(file, text));
    savePending = saved.catch(() => {});
    return saved.then(() => onChange());
  };
  const find = id => data.accounts.find(row => row.id === id);
  const stamp = () => new Date(clock()).toISOString();
  const queryAge = row =>
    clock() - Math.max(Date.parse(row?.lastQueryAt ?? '') || 0, Date.parse(row?.auth?.checkedAt ?? '') || 0);
  const quotaCurrent = row =>
    ['ready', 'available'].includes(row?.quota?.status) &&
    queryAge(row) < 60000 &&
    !(row.quota.windows ?? []).some(
      w => w.remainingPercent === 0 && Number.isFinite(w.resetsAt) && w.resetsAt * 1000 <= clock()
    );
  const cachedExhausted = row => quotaZeroUntil(row?.quota, clock()) !== null;
  const exhausted = cachedExhausted;
  // Derive the all-exhausted episode from successful observations, not a new
  // persisted flag. A failed recovery breaks the complete observation.
  const allRecheckAt = () => {
    if (!data.accounts.length) return null;
    const latestObserved = Math.max(
      ...data.accounts.map(row => Date.parse(row.quota?.checkedAt ?? row.lastQueryAt ?? ''))
    );
    if (!Number.isFinite(latestObserved)) return null;
    const resets = data.accounts.map(row => {
      return ['ready', 'available'].includes(row.quota?.status) ? quotaZeroUntil(row.quota, latestObserved) : null;
    });
    return resets.every(at => at !== null) ? Math.min(...resets) : null;
  };
  const allRecheckDue = () => {
    const at = allRecheckAt();
    return at !== null && at <= clock() && !(recoveryAttemptedAt !== null && at <= recoveryAttemptedAt);
  };
  const exhaustedMessage = () => {
    const resets = data.accounts.map(row => quotaZeroUntil(row.quota, clock()));
    const earliest = resets.length && resets.every(at => at !== null) ? Math.min(...resets) : null;
    return `Gemini 依序帳號皆已無可用額度，未開始工作。${earliest ? ` 最早重查：${new Date(earliest).toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'})}（臺灣時間）${allRecheckAt() !== null ? '；到時將重查全部帳號' : ''}。` : ''}`;
  };
  function publicRow(row) {
    const quota = clone(row.quota ?? unknown());
    // Return the last official result and its query time, without a display TTL.
    // Known zero remains dated evidence until its official reset, even past TTL.
    return {
      id: row.id,
      email: row.email,
      auth: clone(row.auth ?? {status: 'unknown'}),
      quota,
      querySuppressedUntil: quotaZeroUntil(quota, clock())
    };
  }
  function snapshot() {
    return {
      enabled,
      activeAccountId: data.activeAccountId,
      busy: changing || running > 0 || data.uncertain,
      checking: !!refreshPending,
      progress: queryProgress,
      uncertain: !!data.uncertain,
      loginPending: !!data.loginPending,
      accounts: data.accounts.map(publicRow),
      ...(data.uncertain ? {reason: '前次 Gemini 程序停止尚未確認；請先停止工作，再刷新確認。'} : {})
    };
  }
  const authFailure = row =>
    row.auth?.status === 'signed-out'
      ? '此 Gemini 帳號需重新確認登入，未開始工作。'
      : `${row.auth?.reason ?? '目前無法確認 Gemini 帳號狀態；尚無證據需要重新登入。'} 未開始工作。`;
  function assertEnabled() {
    if (!enabled) throw Error('本候選尚未允許真實 Gemini 帳號管理。');
  }
  async function exclusive(fn, {waitForRefresh = false} = {}) {
    await load();
    if (waitForRefresh && refreshPending) await refreshPending.catch(() => {});
    if (running)
      throw Error(
        'Gemini 正在工作或執行原生查詢，本次帳號操作未執行；這不是額度耗盡。請等全部 Gemini 工作結束後再操作。'
      );
    if (changing) throw Error('另一個 Gemini 帳號操作正在進行，本次未執行；這不是額度耗盡，請等該操作結束。');
    changing = true;
    onChange();
    let result;
    try {
      await Promise.allSettled([...queries.values()]);
      result = await fn();
    } finally {
      changing = false;
      onChange();
      if (handoffWaiters.size) {
        clearReset();
        queueMicrotask(() => void drainHandoff());
      }
    }
    return result?.accounts ? {...result, busy: running > 0 || data.uncertain} : result;
  }
  function requireIdleLogin() {
    if (data.loginPending) throw Error('請先完成或取消另一帳號的登入。');
    if (data.uncertain) throw Error('Gemini 程序停止尚未確認，不可切換或再派工作。');
  }
  async function current() {
    const identity = await vault.current();
    if (identity && find(identity.accountId)) {
      data.activeAccountId = identity.accountId;
      return find(identity.accountId);
    }
    data.activeAccountId = null;
    return null;
  }
  async function query(row) {
    if (queries.has(row.id)) return queries.get(row.id);
    const pending = queryAccount(row);
    queries.set(row.id, pending);
    try {
      return await pending;
    } finally {
      queries.delete(row.id);
    }
  }
  async function queryAccount(row) {
    let result;
    try {
      result = await vault.queryQuota(row.id);
    } catch {
      row.lastQueryAt = stamp();
      row.quota = {
        ...(row.quota ?? unknown()),
        status: row.quota?.windows?.length ? 'stale' : 'unavailable',
        note: '此次官方額度查詢未成功。'
      };
      await save();
      throw quotaWait('官方額度暫時查不到；K 保留等待，不把未知當作耗盡或可用。');
    }
    if (result?.accountId !== row.id) throw Error('額度回報與指定帳號不符，已丟棄此次結果。');
    row.lastQueryAt = stamp();
    // A failed quota lookup does not revoke a previously verified identity. Native
    // agy still authenticates each actual turn; keep the original verification time.
    if (!(result.temporaryFailure && row.auth?.status === 'authenticated'))
      row.auth = {
        status: result.auth?.status ?? 'unknown',
        checkedAt: result.auth?.checkedAt ?? stamp(),
        requiresActivation: result.auth?.requiresActivation === true,
        ...(result.auth?.status !== 'authenticated' ? {reason: result.reason} : {})
      };
    row.quota = result.quota ?? {
      ...(row.quota ?? unknown()),
      status: row.quota?.windows?.length ? 'stale' : 'unavailable',
      note: result.reason ?? '此次官方額度查詢未成功。',
      failureCode: result.failureCode ?? null
    };
    await save();
    if (result.failureCode && !result.temporaryFailure && row.auth.status !== 'signed-out')
      throw Error(result.reason ?? '官方額度介面無法辨識，未派工；需要檢查接頭。');
    return result;
  }
  async function activate(id, {restoring = false, refreshQuota = true} = {}) {
    if (!validId(id) || !find(id)) throw Error('Gemini 帳號尚未加入 K。');
    await vault.assertIdle();
    const before = await vault.current();
    if (before && !find(before.accountId) && !restoring)
      throw Error('目前登入尚未加入 K；請先確認並保存目前登入，未覆寫。');
    const identity = await vault.activate(id, {preserveCurrent: !restoring});
    if (identity.accountId !== id) throw Error('Gemini 切換後身分不符，未開始工作。');
    data.activeAccountId = id;
    if (find(id).auth) find(id).auth.requiresActivation = false;
    await save();
    if (refreshQuota) await query(find(id));
  }
  async function restoreQuotaAccount() {
    const id = data.quotaRefreshOriginalId;
    if (!id) return;
    try {
      await vault.assertIdle();
      const identity = await vault.current();
      if (identity && !find(identity.accountId)) throw Error('目前登入已在 K 外變更，未覆寫未登記帳號');
      if (identity?.accountId !== id) {
        const restored = await vault.activate(id);
        if (restored.accountId !== id) throw Error('還原後身分不符');
      }
      data.activeAccountId = id;
      delete data.quotaRefreshOriginalId;
      data.uncertain = false;
      await save();
    } catch (error) {
      data.quotaRefreshOriginalId = id;
      data.uncertain = true;
      await save();
      throw Error(`尚未確認已切回查詢前帳號；請停止 Gemini 程序後再按更新全部帳號恢復。${error.message}`);
    }
  }
  function remember(identity) {
    if (!validId(identity?.accountId) || typeof identity.email !== 'string')
      throw Error('無法確認 Gemini 帳號身分，未加入。');
    let row = find(identity.accountId);
    if (!row) {
      row = {id: identity.accountId, email: identity.email, auth: {status: 'unknown'}, quota: unknown()};
      data.accounts.push(row);
    }
    data.activeAccountId = row.id;
    return row;
  }
  const available = row =>
    row?.auth?.status === 'authenticated' &&
    quotaCurrent(row) &&
    row.quota.windows?.some(w => Number.isFinite(w.remainingPercent) && w.remainingPercent > 0) &&
    row.quota.windows.every(
      w => w.disabled === true || (Number.isFinite(w.remainingPercent) && w.remainingPercent > 0)
    );
  // Only the official usage windows prove exhaustion. Native error text merely
  // asks for this check after all currently running Gemini processes settle.
  const officialZero = row =>
    ['ready', 'available'].includes(row?.quota?.status) &&
    row.quota.windows?.some(
      w => w.disabled !== true && ['five_hour', 'seven_day'].includes(w.key) && w.remainingPercent === 0
    );
  async function nextWorkerAccount(original, {recovered = false, current = () => true} = {}) {
    const index = data.accounts.findIndex(row => row.id === original.id);
    const next = [...data.accounts.slice(index + 1), ...data.accounts.slice(0, index)];
    const attempted = new Set();
    try {
      for (const row of next) {
        if (!current()) throw Error('帳號交接等候已取消；未開始工作。');
        if (cachedExhausted(row)) continue;
        // A switch decision gets its own official candidate check. Only a complete
        // recovery scan in this same decision can supply that evidence already.
        if (!recovered || !quotaCurrent(row))
          try {
            await query(row);
          } catch (error) {
            if (error.code === 'GEMINI_QUOTA_WAIT') continue;
            throw error;
          }
        if (!current()) throw Error('帳號交接等候已取消；未開始工作。');
        const chosen = find(row.id);
        if (chosen.auth?.status === 'signed-out') continue;
        if (exhausted(chosen) || officialZero(chosen)) continue;
        if (!available(chosen)) continue;
        if ((await vault.current())?.accountId !== original.id)
          throw Error('查核期間共用登入已在 K 外變更，未覆寫或開始工作。');
        if (!current()) throw Error('帳號交接等候已取消；未開始工作。');
        attempted.add(row.id);
        await activate(row.id, {refreshQuota: false});
        if (!current()) throw Error('帳號交接等候已取消；未開始工作。');
        return chosen;
      }
      if (next.some(row => row.auth?.status !== 'signed-out' && !cachedExhausted(row) && !officialZero(row)))
        throw quotaWait('候選帳號額度尚未確認；K 保留等待並重查，未切換或派工。');
      if (next.length && next.every(row => row.auth?.status === 'signed-out'))
        throw Error('其他已保存 Gemini 帳號均需本人確認登入。');
      throw Object.assign(Error(exhaustedMessage()), {code: 'GEMINI_ACCOUNTS_EXHAUSTED'});
    } catch (error) {
      if (attempted.size) {
        try {
          const identity = await vault.current();
          if (identity?.accountId !== original.id && !attempted.has(identity?.accountId))
            throw Error('目前登入身分已改變或無法確認，未覆寫。');
          if (identity.accountId !== original.id) await activate(original.id, {restoring: true, refreshQuota: false});
        } catch (restoreError) {
          data.uncertain = true;
          await save();
          throw Error(`${error.message} 原帳號還原尚未確認：${restoreError.message}`);
        }
      }
      throw error;
    }
  }
  const waiterCurrent = row => !row.signal?.aborted && row.handoffCurrent?.() !== false;
  function publishHandoff(status, detail = {}) {
    const rooms = new Map();
    for (const [key, row] of handoffWaiters) {
      if (!waiterCurrent(row)) {
        handoffWaiters.delete(key);
        continue;
      }
      const room = rooms.get(row.parentId) ?? {
        parentId: row.parentId,
        requestIds: [],
        queryIds: [],
        notStartedIds: [],
        notify: row.onHandoff
      };
      if (row.queryOnly) room.queryIds.push(row.requestId);
      else {
        room.requestIds.push(row.requestId);
        if (row.notStarted) room.notStartedIds.push(row.requestId);
      }
      rooms.set(row.parentId, room);
    }
    if (status !== 'waiting') {
      handoffWaiters.clear();
      clearReset();
      retryDelay = 60000;
    }
    for (const {notify, notStartedIds, ...room} of rooms.values())
      try {
        if (status === 'positive') {
          const startedIds = room.requestIds.filter(id => !notStartedIds.includes(id));
          if (startedIds.length)
            notify({
              ...room,
              requestIds: startedIds,
              notStartedIds: [],
              queryIds: [],
              status: 'blocked',
              ...detail,
              switched: false,
              reason: '官方仍有額度；可能是速率限制，未換帳號，已執行失敗工單未重派或恢復。'
            });
          if (notStartedIds.length || room.queryIds.length)
            notify({
              ...room,
              requestIds: notStartedIds,
              notStartedIds,
              status: 'ready',
              ...detail,
              switched: false,
              reason:
                '官方確認目前共用帳號仍有可用額度，本次未切換。查詢已完成；只核對這些未送出工單，以新 ID 接剩餘。已執行而失敗工單不屬於本次接手，不重派或恢復。'
            });
        } else {
          const rows = [...handoffWaiters.values()].filter(row => row.parentId === room.parentId && waiterCurrent(row));
          if (status === 'waiting' && rows.every(row => row.lastNotification === 'waiting')) {
            // A waiting room stays quiet (one notice per state), but queries must still show the latest reason
            // and next official recheck instead of the first generic text.
            notify({...room, notStartedIds, status, ...detail, quiet: true});
            continue;
          }
          for (const row of rows) row.lastNotification = status;
          notify({...room, notStartedIds, status, ...detail});
        }
      } catch {
        /* notifications do not replay work or undo an account switch */
      }
  }
  function registerHandoff(options, accountId, {notStarted = false} = {}) {
    // A refused job never acquired an account or history. If its catch runs after
    // another drain finished, attach it to the now-current shared account.
    if (notStarted) accountId = data.activeAccountId ?? accountId;
    if (
      typeof options.parentId !== 'string' ||
      typeof options.requestId !== 'string' ||
      typeof options.onHandoff !== 'function' ||
      !waiterCurrent(options)
    )
      return false;
    const key = JSON.stringify([options.parentId, options.requestId]);
    if (handoffWaiters.has(key)) return true;
    handoffWaiters.set(key, {...options, accountId, notStarted, needsQuotaCheck: !notStarted});
    publishHandoff('waiting', {
      accountId,
      reason: '等待既有 Gemini 工作自然結束，再查核官方額度；尚未確認耗盡，未換帳號。'
    });
    if (!running && !changing && !acquiring && !handoffPending) void drainHandoff();
    return true;
  }
  async function drainHandoff() {
    if (handoffPending) return handoffPending;
    if (running || changing || resetTimer !== null || !handoffWaiters.size) return;
    // Reserve before the first await so no new Flash can slip into the drain.
    handoffPending = (async () => {
      while (acquiring) await acquiring;
      if (refreshPending) await refreshPending.catch(() => {});
      for (const [key, row] of handoffWaiters) if (!waiterCurrent(row)) handoffWaiters.delete(key);
      if (running || !handoffWaiters.size) return;
      let original,
        ownsChange = false;
      try {
        if (changing || running) return;
        if (data.uncertain && !data.quotaRefreshOriginalId) {
          try {
            await vault.assertIdle();
            data.uncertain = false;
            await save();
          } catch {
            throw quotaWait('尚待確認 Gemini 程序停止；K 保留等待，未知成果不重播。');
          }
        }
        requireIdleLogin();
        const recovered = allRecheckDue();
        if (recovered) await api.refreshAll({force: false});
        if (changing || running) return;
        assertEnabled();
        changing = true;
        ownsChange = true;
        onChange();
        try {
          await vault.assertIdle();
        } catch {
          throw quotaWait('仍有 Gemini 程序，K 等待停止，不強制結束。');
        }
        original = await current();
        if (
          !original ||
          [...handoffWaiters.values()].some(row => !row.notStarted && !row.queryOnly && row.accountId !== original.id)
        )
          throw Error('等候來源帳號與目前登入不符，未切換。');
        // Reuse the release-time official check; never infer quota from a rate error.
        if (
          !cachedExhausted(original) &&
          (!quotaCurrent(original) || [...handoffWaiters.values()].some(row => row.needsQuotaCheck))
        ) {
          await query(original);
          for (const row of handoffWaiters.values()) row.needsQuotaCheck = false;
        }
        for (const [key, row] of handoffWaiters) if (!waiterCurrent(row)) handoffWaiters.delete(key);
        if (!handoffWaiters.size) return;
        if (original.auth?.status === 'signed-out') throw Error(authFailure(original));
        if (original.auth?.status !== 'authenticated') throw quotaWait(authFailure(original));
        if (original.auth?.requiresActivation) await activate(original.id, {refreshQuota: false});
        if (!exhausted(original) && !officialZero(original)) {
          if (available(original)) return {status: 'positive', detail: {accountId: original.id}};
          throw quotaWait('官方額度尚未確認；K 保留等待，未換帳號或派工。');
        }
        const chosen = await nextWorkerAccount(original, {
          recovered,
          current: () => [...handoffWaiters.values()].some(waiterCurrent)
        });
        return {
          status: 'ready',
          detail: {
            accountId: chosen.id,
            switched: true,
            reason:
              '官方確認原帳號額度耗盡，已按保存順序換到有可用額度的帳號。先核對成果，以新工單接剩餘；原工單未重播。'
          }
        };
      } catch (error) {
        let nextQueryAt = allRecheckAt();
        const temporary =
          error.code === 'GEMINI_QUOTA_WAIT' ||
          (error.code === 'GEMINI_ACCOUNTS_EXHAUSTED' && !data.uncertain && !(nextQueryAt > clock()));
        const waiting =
          temporary ||
          (error.code === 'GEMINI_ACCOUNTS_EXHAUSTED' &&
            !data.uncertain &&
            nextQueryAt > clock() &&
            data.accounts.every(cachedExhausted));
        if (temporary) {
          nextQueryAt = clock() + retryDelay;
          retryDelay = Math.min(600000, retryDelay * 2);
        }
        return {
          status: waiting ? 'waiting' : 'blocked',
          quiet: temporary,
          detail: {accountId: data.uncertain ? null : data.activeAccountId, reason: error.message, nextQueryAt}
        };
      } finally {
        if (ownsChange) {
          changing = false;
          onChange();
        }
      }
    })();
    let result;
    try {
      result = await handoffPending;
    } finally {
      handoffPending = null;
    }
    // Clear the account lock before calling the room. A ready callback may enqueue
    // a new, explicitly reviewed job; it must not re-enter its own drain promise.
    if (result) {
      if (!result.quiet) publishHandoff(result.status, result.detail);
      if (result.status === 'waiting' && result.detail.nextQueryAt > clock() && handoffWaiters.size) {
        clearReset();
        resetTimer = setTimer(
          () => {
            resetTimer = null;
            void drainHandoff();
          },
          Math.min(2147483647, result.detail.nextQueryAt - clock())
        );
        resetTimer?.unref?.();
      }
    } else if (!running && !changing && handoffWaiters.size) void drainHandoff();
  }
  const api = {
    cancelWorkerHandoff({parentId, requestId} = {}) {
      for (const [key, row] of handoffWaiters)
        if (row.parentId === parentId && (requestId === undefined || row.requestId === requestId))
          handoffWaiters.delete(key);
      if (!handoffWaiters.size) clearReset();
    },
    get cachedUsage() {
      const rows = data.accounts.map(publicRow),
        active = rows.find(row => row.id === data.activeAccountId);
      return rows.length
        ? {
            ...(active?.quota ?? unknown()),
            accountId: active?.id ?? null,
            accountEmail: active?.email ?? null,
            accounts: rows,
            ...(queryProgress ? {checking: queryProgress} : {})
          }
        : null;
    },
    async list() {
      await load();
      return snapshot();
    },
    // Resolves when the account queries started by the latest release, and usage()'s background read, have finished.
    idle() {
      return Promise.all([background, otherQuery]);
    },
    async observe(options = {}) {
      await load();
      const value = () => ({
        ...snapshot(),
        dispatchAccountId: data.activeAccountId,
        quotaEvidence: 'last-official-observation',
        instruction:
          '一般新工單省略 accountId，由 K 按目前共用帳號及既有順序核對派工；不要為每個工單刷新全部帳號。快取不是目前額度保證。'
      });
      if (!data.accounts.length || data.loginPending || data.uncertain || !enabled)
        return {
          ...value(),
          scheduling: {
            status: 'blocked',
            notificationRegistered: false,
            reason: data.uncertain
              ? '程序停止或身分未確認'
              : data.loginPending
                ? '等待本人完成登入'
                : !enabled
                  ? '帳號管理未啟用'
                  : '目前沒有已保存帳號'
          }
        };
      const row = find(data.activeAccountId);
      if (
        row &&
        !changing &&
        !refreshPending &&
        !handoffPending &&
        !handoffWaiters.size &&
        !quotaCurrent(row) &&
        !cachedExhausted(row)
      )
        try {
          await query(row);
        } catch {
          /* owned wait below retries only the quota read */
        }
      // Observing a usable shared account never rotates through unrelated accounts.
      // Busy is not exhaustion. Startup still validates identity and quota itself.
      // A read of dated evidence is not a request to drain every other room. The
      // dispatch path checks the actual identity and rechecks quota when idle.
      // A fresh independent read may finish while existing work continues. Unknown
      // evidence becomes a K-owned wait, never permission to dispatch.
      if (!changing && !refreshPending && !handoffPending && !handoffWaiters.size && available(row))
        return {
          ...value(),
          scheduling: {
            status: row?.auth?.status === 'authenticated' ? 'ready' : 'blocked',
            notificationRegistered: false,
            ...(row?.auth?.status === 'authenticated' ? {} : {reason: '目前共用帳號登入尚未確認；未查詢或切換帳號。'})
          }
        };
      const registered = registerHandoff({...options, queryOnly: true}, data.activeAccountId, {notStarted: true});
      return {
        ...value(),
        scheduling: {
          status: registered ? 'waiting' : 'blocked',
          notificationRegistered: registered,
          waitId: registered ? options.requestId : null,
          reason: registered
            ? 'K 已接管等待，現有工作自然結束後核對目前帳號並通知本房。若原生目標仍 active 且無其他可做工作，使用等待工具及本 waitId，timeoutMs=null，維持回合等待事件；不要結束回合反覆喚起，不要輪詢、重派或僅因等待標為 blocked。'
            : '查詢沒有有效來源，未登記自動接續。'
        }
      };
    },
    async inspect(fn) {
      await load();
      if (refreshPending) await refreshPending;
      requireIdleLogin();
      if (changing) throw Error('Gemini 正在處理帳號操作。');
      running++;
      try {
        return await fn();
      } finally {
        running--;
        onChange();
        if (!running && handoffWaiters.size) background = drainHandoff();
      }
    },
    async capture() {
      assertEnabled();
      return exclusive(async () => {
        requireIdleLogin();
        const row = remember(await vault.capture());
        await save();
        await query(row);
        return snapshot();
      });
    },
    async startLogin() {
      assertEnabled();
      return exclusive(async () => {
        requireIdleLogin();
        await vault.assertIdle();
        // Retain the previous identity before clearing the live slot. The journal is
        // written first so an interrupted browser login still offers explicit restore.
        const existing = await vault.current();
        if (existing) remember(await vault.capture());
        data.loginPending = {previousAccountId: existing?.accountId ?? null};
        await save();
        await vault.prepareLogin();
        data.activeAccountId = null;
        await save();
        await login.start();
        return snapshot();
      });
    },
    async finishLogin() {
      assertEnabled();
      return exclusive(async () => {
        if (!data.loginPending) throw Error('目前沒有等待完成的 Gemini 登入。');
        const identity = await vault.capture(),
          row = {id: identity.accountId, email: identity.email};
        // Verify before adding a card or marking the new identity as active.
        await query(row);
        if (row.auth.status !== 'authenticated') throw Error('尚未確認官方登入成功，請完成登入並關閉官方程式後再試。');
        Object.assign(remember(identity), row);
        data.loginPending = null;
        await save();
        return snapshot();
      });
    },
    async cancelLogin() {
      assertEnabled();
      return exclusive(async () => {
        if (!data.loginPending) return snapshot();
        await vault.assertIdle();
        const previous = data.loginPending.previousAccountId;
        if (previous) await activate(previous, {restoring: true});
        else data.activeAccountId = null;
        data.loginPending = null;
        await save();
        return snapshot();
      });
    },
    async activate({accountId}) {
      assertEnabled();
      return exclusive(
        async () => {
          requireIdleLogin();
          await activate(accountId);
          return snapshot();
        },
        {waitForRefresh: true}
      );
    },
    async refresh({force = true} = {}) {
      await load();
      if (!data.accounts.length && !data.loginPending && !data.uncertain) return snapshot();
      assertEnabled();
      if (refreshPending) return refreshPending;
      if (changing) throw quotaWait('Gemini 帳號操作進行中，額度查詢稍候。');
      refreshPending = (async () => {
        if (data.loginPending) throw Error('登入完成後請按「完成登入」，或取消回原帳號。');
        if (data.quotaRefreshOriginalId) throw Error('上次全部額度查詢尚未還原帳號；請按更新全部帳號恢復。');
        if (data.uncertain)
          try {
            await vault.assertIdle();
            data.uncertain = false;
            await save();
          } catch {
            /* Independent reads remain safe; the execution lock stays uncertain. */
          }
        const row = await current();
        if (row && (force || !cachedExhausted(row))) await query(row);
        else if (!row) await save();
        return snapshot();
      })();
      try {
        return await refreshPending;
      } finally {
        refreshPending = null;
        if (handoffWaiters.size) {
          clearReset();
          queueMicrotask(() => void drainHandoff());
        }
      }
    },
    async refreshAll({force = true} = {}) {
      await load();
      assertEnabled();
      if (refreshPending) return refreshPending;
      if (changing) throw quotaWait('Gemini 帳號操作進行中，額度查詢稍候。');
      const pending = (async () => {
        if (data.loginPending) throw Error('請先完成或取消帳號登入。');
        // An interrupted batch restores its original login only; never resumes the batch.
        if (data.quotaRefreshOriginalId)
          return exclusive(async () => {
            await restoreQuotaAccount();
            return {...snapshot(), note: '已切回中斷查詢前的帳號；未重新執行全部查詢。'};
          });
        const recheckAt = allRecheckAt(),
          recovery = allRecheckDue();
        // Even a thrown vault/query error must not auto-replay this recovery batch.
        // A newly reported future reset permits the next episode; manual refresh is unchanged.
        if (recovery) recoveryAttemptedAt = clock();
        if (data.uncertain)
          try {
            await vault.assertIdle();
            data.uncertain = false;
            await save();
          } catch {
            /* Do not confuse quota readability with confirmed process settlement. */
          }
        if (!data.accounts.length) return snapshot();
        const rows = data.accounts.filter(row => force || recovery || !cachedExhausted(row));
        if (!rows.length)
          return {
            ...snapshot(),
            quotaCheck: {allExhausted: true, nextQueryAt: recheckAt},
            note: '全部帳號已有官方歸零紀錄，等待重設；未重新查詢。'
          };
        for (const [index, row] of rows.entries()) {
          queryProgress = {current: index + 1, total: rows.length};
          onChange();
          try {
            await query(row);
          } catch {
            /* retain this account as unknown; continue other independent reads */
          }
        }
        queryProgress = null;
        const failed = rows.filter(
          row =>
            !['ready', 'available'].includes(row.quota?.status) ||
            !row.quota.windows?.length ||
            row.quota.windows.some(w => w.disabled !== true && !Number.isFinite(w.remainingPercent))
        ).length;
        const skipped = data.accounts.length - rows.length;
        return {
          ...snapshot(),
          quotaCheck: {
            checkedAt: stamp(),
            allExhausted: failed ? null : data.accounts.every(cachedExhausted),
            nextQueryAt: allRecheckAt(),
            queried: rows.length,
            skipped
          },
          note: failed
            ? `已獨立查詢；${failed} 個帳號未取得最新額度，未切換目前登入。`
            : `已獨立查詢 ${rows.length} 個帳號，${skipped} 個歸零帳號等待重設；未切換目前登入。`
        };
      })();
      refreshPending = pending;
      try {
        return await pending;
      } finally {
        if (refreshPending === pending) refreshPending = null;
        if (queryProgress) {
          queryProgress = null;
          onChange();
        }
        if (handoffWaiters.size) {
          clearReset();
          queueMicrotask(() => void drainHandoff());
        }
      }
    },
    async usage(refresh = false) {
      await load();
      if (!data.accounts.length) return null;
      if (!changing && !data.loginPending && !data.uncertain && enabled) {
        const row = find(data.activeAccountId);
        const recheckAt = allRecheckAt();
        try {
          if (!refresh && allRecheckDue()) await api.refreshAll({force: false});
          else if (
            refresh ||
            (!(
              recheckAt !== null &&
              recoveryAttemptedAt !== null &&
              recheckAt <= recoveryAttemptedAt &&
              clock() - recoveryAttemptedAt < 60000
            ) &&
              (!row || (!cachedExhausted(row) && (quotaZeroRecheckDue(row.quota, clock()) || queryAge(row) >= 60000))))
          )
            await api.refresh({force: refresh});
        } catch {
          /* retain the last result, never claim a new successful query */
        }
        // The other saved accounts are read in the background too, one at a time, so the list is not a
        // snapshot of the last manual refresh. A failed read is simply retried on the same cadence. Checked again
        // after the await above, synchronously with the start, so an account change that began meanwhile either
        // skips this read or waits for it (exclusive() settles the queries it finds).
        const due =
          !otherQuery &&
          !refreshPending &&
          !changing &&
          !data.loginPending &&
          !data.uncertain &&
          data.accounts.find(
            row =>
              row.id !== data.activeAccountId &&
              row.auth?.status !== 'signed-out' &&
              !cachedExhausted(row) &&
              queryAge(row) >= OTHER_ACCOUNT_QUERY_MS
          );
        if (due)
          otherQuery = query(due)
            .catch(() => {})
            .finally(() => {
              otherQuery = null;
            });
      }
      const rows = data.accounts.map(publicRow),
        active = rows.find(row => row.id === data.activeAccountId);
      return {
        ...(active?.quota ?? unknown()),
        accountId: active?.id ?? null,
        accountEmail: active?.email ?? null,
        accounts: rows
      };
    },
    async acquire({accountId, worker = false, unboundHistory = false} = {}) {
      // Serialize only startup checks, not execution. Concurrent workers must not
      // mistake another worker's credential check for a human account switch.
      while (acquiring) await acquiring;
      let unlock;
      acquiring = new Promise(resolve => {
        unlock = resolve;
      });
      try {
        await load();
        if (refreshPending) await refreshPending;
        requireIdleLogin();
        for (const [key, row] of handoffWaiters) if (!waiterCurrent(row)) handoffWaiters.delete(key);
        if (worker && (handoffWaiters.size || handoffPending))
          throw Object.assign(
            Error('Gemini 正在等既有工作自然結束並查核帳號；未送出本工作。就緒時 K 會通知，勿立即重派。'),
            {code: 'GEMINI_HANDOFF_WAIT', accountId: data.activeAccountId}
          );
        const recovered = !running && allRecheckDue();
        if (recovered) await api.refreshAll({force: false});
        if (changing)
          throw Object.assign(
            Error('Gemini 正在切換帳號或登入，未開始工作。'),
            worker ? {code: 'GEMINI_HANDOFF_WAIT', accountId: data.activeAccountId} : {}
          );
        changing = true;
        let chosen = null;
        try {
          if (data.accounts.length) {
            assertEnabled();
            chosen = await current();
            if (unboundHistory) throw Error('此舊 Gemini 對話沒有帳號綁定，請以新對話交接；未跨帳號讀取原生歷史。');
            if (!chosen && !accountId) throw Error('目前 Antigravity 登入未加入 K，請先保存目前登入或選擇已加入帳號。');
            let target = accountId ?? chosen.id;
            if (worker) {
              if (!chosen) throw Error('目前 Antigravity 登入未加入 K，未開始工人工作。');
              if (accountId && !find(accountId)) throw Error('Gemini 帳號選擇無效，未開始工作。');
              // Keep official zero evidence until reset; only query a usable candidate.
              if (!cachedExhausted(chosen) && !quotaCurrent(chosen)) await query(chosen);
              if (chosen.auth?.status === 'signed-out') throw Error(authFailure(chosen));
              if (exhausted(chosen) || officialZero(chosen)) {
                if (running || handoffWaiters.size || handoffPending)
                  throw Object.assign(
                    Error('Gemini 工作或帳號交接尚未結束；未送出本工作。就緒時 K 會通知，勿立即重派。'),
                    {code: 'GEMINI_HANDOFF_WAIT', accountId: chosen.id}
                  );
                chosen = await nextWorkerAccount(chosen, {recovered});
                target = chosen.id;
              } else if (accountId && accountId !== chosen.id) {
                // Keep an explicit account expectation intact. Do not switch backwards or
                // silently run on another account: report the unstarted job through the
                // same owned scheduling path and supply the current account on readiness.
                throw Object.assign(
                  Error(
                    '工單指定的帳號與目前共用帳號不同；本工作未送出，也未切回舊帳號。K 已接管帳號核對，就緒後通知本房；勿輪詢或立即重派。'
                  ),
                  {code: 'GEMINI_HANDOFF_WAIT', accountId: chosen.id}
                );
              }
            }
            if (target !== chosen?.id) {
              const targetRow = find(target);
              if (!targetRow) throw Error('Gemini 帳號選擇無效，未開始工作。');
              if (targetRow.auth?.status === 'signed-out') throw Error('此 Gemini 帳號需重新確認登入，未開始工作。');
              if (exhausted(targetRow) || officialZero(targetRow))
                throw Error('此 Gemini 帳號官方額度已用完，未開始工作。');
              if (running) throw Error('其他 Gemini 工作尚未結束，不能換帳號；未送出本工作。');
              await activate(target);
              chosen = find(target);
            }
            if (!chosen || chosen.id !== target) throw Error('Gemini 帳號選擇無效，未開始工作。');
            if (exhausted(chosen) || officialZero(chosen))
              throw Error('此 Gemini 帳號官方額度已用完，等待重設；未重新查詢或開始工作。');
            const authStale = queryAge(chosen) >= 60000;
            if (chosen.auth?.status !== 'authenticated') {
              if (chosen.auth?.status === 'signed-out') throw Error(authFailure(chosen));
              await query(chosen);
            } else if (authStale) await query(chosen);
            if (chosen.auth.status !== 'authenticated') throw quotaWait(authFailure(chosen));
            if (exhausted(chosen) || officialZero(chosen)) throw Error('此 Gemini 帳號官方額度已用完，未開始工作。');
            if (!available(chosen)) throw quotaWait('目前 Gemini 額度尚未確認，K 保留等待；未送出工作。');
            if (chosen.auth.requiresActivation) {
              if (running) throw quotaWait('登入權杖已更新，等待既有 Gemini 程序停止後同步同一帳號；未派工。');
              await activate(chosen.id, {refreshQuota: false});
            }
            if ((await vault.current())?.accountId !== chosen.id) throw Error('派工前共用登入身分已改變；未開始工作。');
          } else if (accountId) throw Error('Gemini 帳號尚未加入 K。');
          running++;
        } finally {
          changing = false;
          onChange();
        }
        let released = false,
          quotaHinted = false;
        return {
          accountId: chosen?.id ?? null,
          accountEmail: chosen?.email ?? null,
          async quotaHint() {
            if (released || quotaHinted || !chosen) return;
            quotaHinted = true;
            try {
              await query(chosen);
            } catch {
              /* final outcome owns any scheduling wait */
            }
          },
          async release({settled = true, refresh = false} = {}) {
            if (released) return;
            released = true;
            running--;
            let saveError;
            if (!settled) {
              data.uncertain = true;
              // A failed save must not skip the notification and hand-off below; report it afterwards.
              await save().catch(error => {
                saveError = error;
              });
            }
            onChange();
            // Account queries can take tens of seconds; the worker's own result must not wait for them.
            if (!running && handoffWaiters.size) background = drainHandoff();
            else if (refresh && !running && !data.uncertain && chosen)
              background = api.refresh({force: false}).catch(() => {
                /* no replay; next status read shows cached quota */
              });
            if (saveError) throw saveError;
          }
        };
      } finally {
        acquiring = null;
        unlock();
        if (!running && handoffWaiters.size) queueMicrotask(() => void drainHandoff());
      }
    },
    async run(options, fn) {
      let lease;
      try {
        lease = await api.acquire(options);
      } catch (error) {
        error.dispatch = 'not-started';
        if (
          options.worker &&
          ['GEMINI_HANDOFF_WAIT', 'GEMINI_ACCOUNTS_EXHAUSTED', 'GEMINI_QUOTA_WAIT'].includes(error.code)
        ) {
          const registered = registerHandoff(options, error.accountId ?? data.activeAccountId, {notStarted: true});
          error.scheduling = {
            status: registered ? 'waiting' : 'blocked',
            notificationRegistered: registered,
            reason: error.message
          };
        }
        throw error;
      }
      let outcome;
      try {
        outcome = await fn(lease);
        return {...outcome, accountId: lease.accountId, accountEmail: lease.accountEmail};
      } catch (error) {
        if (error.settled === false) outcome = {settled: false, error};
        throw error;
      } finally {
        if (
          options.worker &&
          outcome?.status === 'failed' &&
          outcome.settled === true &&
          outcome.quotaCheckNeeded === true
        )
          registerHandoff(options, lease.accountId);
        try {
          await lease.release({settled: outcome?.settled !== false, refresh: true});
        } catch (releaseError) {
          // A failed registry save must not replace the worker's own result. An unconfirmed stop stays
          // unsettled (never "failed"); otherwise the original result or error stands. release() updates the
          // in-memory registry before saving, so the next successful save persists it.
          if (outcome?.settled === false)
            throw Object.assign(
              new Error(`${outcome.error?.message ?? '工人停止狀態未確認'}；帳號狀態保存失敗：${releaseError.message}`),
              {
                settled: false,
                cause: releaseError
              }
            );
        }
      }
    }
  };
  return api;
}
