import http from 'node:http';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {createConversationController} from './conversation-controller.mjs';
import {computeUpcoming} from './room-schedules.mjs';
import {createClaudeLogin} from './claude-login.mjs';
import {createCodexLogin} from './codex-login.mjs';
import {onAuthExpired} from './auth-expiry.mjs';
import {officialCodexLoginUrl} from '../shared/codex-login-url.mjs';
import {createGeminiLogin} from './gemini-login.mjs';
import {listProjects, addProject, updateProject} from './projects.mjs';
import {readSelfUpdate} from './self-update.mjs';
import {createSidebarPreferences} from './sidebar-preferences.mjs';
import {readPresentedPath} from './desktop-files.mjs';
import {pickWorkspaceDirectory} from './workspace-picker.mjs';
import {validateWorkspace} from './workspaces.mjs';
import {createStateStream} from '../shared/state-stream.mjs';
import {remoteStateEvent} from '../shared/remote-state.mjs';
import {createLocalDictation, LocalDictationError, MAX_JSON_BYTES} from './local-dictation.mjs';
import {
  readRemoteConfig,
  clearRemoteSessions,
  createRemoteAccess,
  remoteRouteAllowed,
  remoteLoginHtml,
  remoteLoginJs,
  remoteLoginCss
} from './remote-access.mjs';

// Same opener the official Claude CLI uses; only a validated official URL is passed.
const openInDefaultBrowser = url =>
  new Promise((resolve, reject) => {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

export async function startDesktop({
  root,
  executable,
  port = 47831,
  controllerFactory = createConversationController,
  pickWorkspace = pickWorkspaceDirectory,
  localDictationFactory = createLocalDictation,
  claudeLoginFactory = createClaudeLogin,
  codexLoginFactory = createCodexLogin,
  openExternalUrl = openInDefaultBrowser,
  geminiLoginFactory = createGeminiLogin,
  geminiAccounts,
  discussionApi,
  coreUpdates,
  browserRequest,
  selfUpdate,
  validateProjectWorkspace = validateWorkspace,
  uiRoot = new URL('../dist-ui/', import.meta.url),
  maxPendingEventBytes = 16 * 1024 * 1024,
  maxBehindMs = 15000
}) {
  const sidebarPreferences = await createSidebarPreferences(root);
  const remoteFile = path.join(root, '.local', 'remote-access.json');
  let remoteConfig = null,
    remoteError = null;
  try {
    remoteConfig = await readRemoteConfig(remoteFile);
  } catch (error) {
    remoteError = error.message;
  }
  if (!remoteConfig) await clearRemoteSessions(remoteFile);
  const remote = remoteConfig ? createRemoteAccess(remoteFile, remoteConfig) : null;
  let remoteServer;
  const cookie = randomBytes(32).toString('hex'),
    clients = new Set(),
    remoteClients = new WeakSet(),
    stateListeners = new Set(),
    stateStream = createStateStream();
  let scheduled;
  // Delivery of this one-use URL
  // belongs to the trusted launcher; there is deliberately no HTTP mint route.
  let launchToken = null,
    launchExpires = 0;
  const cookieMatches = req => req.headers.cookie?.split(';').some(c => c.trim() === `k_session=${cookie}`);
  const claudeLogin = claudeLoginFactory({cwd: root});
  const codexLogin = codexLoginFactory({cwd: root, executable});
  const geminiLogin = geminiLoginFactory({cwd: root});
  const localDictation = localDictationFactory();
  let localDictationClose = null;
  const closeLocalDictation = () => {
    if (localDictationClose) return localDictationClose;
    const pending = Promise.resolve().then(() => localDictation.close());
    let wrapped;
    wrapped = pending.finally(() => {
      if (localDictationClose === wrapped) localDictationClose = null;
    });
    localDictationClose = wrapped;
    return wrapped;
  };
  let closing = false;
  // An update is reserved while its checks run, then for three minutes after the hand-off; if the
  // launcher could not close K in that time, the button works again.
  let updateChecking = false,
    updateHandedOffAt = 0,
    writesInProgress = 0;
  const updating = () => updateChecking || Date.now() - updateHandedOffAt < 180_000;
  // Everything a normal close would interrupt, from the live snapshot.
  const selfUpdateSnapshotBusy = () => {
    const busy = [];
    for (const act of controller.state.conversationActivity ?? []) {
      const name = act.title || '未命名聊天室';
      if (act.busy) busy.push(`聊天室：${name} 工作中`);
      else if (act.pendingQuestions > 0) busy.push(`聊天室：${name} 等待確認中`);
      else if (act.pendingWorkers > 0) busy.push(`聊天室：${name} 子代理執行中`);
    }
    if (controller.discussionBusy) busy.push('討論進行中');
    if (coreUpdates?.pending) busy.push('核心更新進行中');
    if (claudeLogin.progress?.().login?.status === 'running') busy.push('Claude 登入程序執行中');
    if (codexLogin.progress?.().login?.status === 'running') busy.push('Codex 登入程序執行中');
    if (localDictation.busy) busy.push('語音聽寫進行中');
    if (writesInProgress) busy.push('有操作正在處理');
    return busy;
  };
  // The slower checks, then the snapshot again right before the hand-off; anything that cannot be
  // confirmed counts as busy.
  const selfUpdateBusy = async () => {
    const busy = [];
    try {
      const gemini = await geminiAccounts?.list?.();
      if (gemini?.busy || gemini?.checking || gemini?.loginPending) busy.push('Gemini 程序執行中');
      if ((await controller.backgroundCommands?.()) > 0) busy.push('背景命令執行中');
    } catch {
      busy.push('部分工作狀態無法確認');
    }
    return [...busy, ...selfUpdateSnapshotBusy()];
  };
  let pickerAbort = null;
  // A native login expiry in a main room starts the official sign-in in the owner's
  // default browser. Claude's CLI opens it itself; Codex only returns the URL. An
  // already-waiting sign-in is reused, so repeated failures do not open more pages.
  const recoveringLogin = new Set();
  let openedCodexUrl = null;
  const stopAuthExpiry = onAuthExpired(provider => {
    if (closing || recoveringLogin.has(provider) || !['claude', 'codex'].includes(provider)) return;
    recoveringLogin.add(provider);
    (async () => {
      if (provider === 'claude') return void (await claudeLogin.start());
      const url = officialCodexLoginUrl((await codexLogin.start())?.login?.url);
      if (url && url !== openedCodexUrl && !closing) {
        await openExternalUrl(url);
        openedCodexUrl = url;
      }
    })()
      .catch(() => {})
      .finally(() => recoveringLogin.delete(provider));
  });
  const publicState = () => {
    const state = {
      ...controller.state,
      sidebarPreferences: sidebarPreferences.value,
      sidebarPreferencesError: sidebarPreferences.error
    };
    return geminiAccounts?.cachedUsage
      ? {...state, usage: {...state.usage, gemini: geminiAccounts.cachedUsage}}
      : state;
  };
  // When each screen's unsent backlog first went over the limit; see broadcast().
  const behindSince = new WeakMap();
  const broadcast = event => {
    if (!event) return;
    let localFrame, remoteFrame;
    for (const client of clients) {
      if (client.destroyed) continue;
      // Events are differences, so none can be skipped. A screen that cannot keep up (e.g. a phone on a weak
      // network) is disconnected instead of buffering without bound; it reconnects to a fresh snapshot. Only a
      // backlog that stays over the limit counts: a single large event or snapshot is still being read by a
      // working screen, and cutting it then would make it reconnect to the same large snapshot again. During that
      // grace period events keep queueing (at most a few hundred at the 60 ms publish throttle). This lessens the
      // reconnect loop but cannot end it for a screen too slow to read one huge event within the grace period.
      if (client.writableLength <= maxPendingEventBytes) behindSince.delete(client);
      else if (!behindSince.has(client)) behindSince.set(client, Date.now());
      else if (Date.now() - behindSince.get(client) > maxBehindMs) {
        client.destroy();
        continue;
      }
      client.write(
        remoteClients.has(client)
          ? (remoteFrame ??= `data: ${JSON.stringify(remoteStateEvent(event))}\n\n`)
          : (localFrame ??= `data: ${JSON.stringify(event)}\n\n`)
      );
    }
  };
  const publish = () => {
    if (scheduled) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    const state = publicState();
    for (const listener of stateListeners) listener(state);
    broadcast(stateStream.update(state, controller.historyVersion));
  };
  const controller = controllerFactory({
    root,
    executable,
    onChange() {
      scheduled ??= setTimeout(publish, 60);
    }
  });
  const closedResources = new Set();
  let resourceCloseAttempt = null;
  const closeResources = () => {
    if (resourceCloseAttempt) return resourceCloseAttempt;
    const pending = (async () => {
      closing = true;
      stopAuthExpiry();
      launchToken = null;
      pickerAbort?.abort();
      clearTimeout(scheduled);
      scheduled = null;
      await coreUpdates?.close();
      const failures = [];
      for (const [name, close] of [
        ['本機語音辨識', closeLocalDictation],
        ['Claude 登入', () => claudeLogin.close()],
        ['Codex 登入', () => codexLogin.close()],
        ['對話控制器', () => controller.close()]
      ]) {
        if (closedResources.has(name)) continue;
        try {
          await close();
          closedResources.add(name);
        } catch (error) {
          failures.push({name, error});
        }
      }
      // Releases above may have started Gemini account work in the background (hand-off, quota refresh) that
      // can be switching the shared login; give it a bounded chance to finish before the process exits.
      await Promise.race([geminiAccounts?.idle?.(), new Promise(resolve => setTimeout(resolve, 15000).unref())]);
      if (failures.length) {
        const error = new Error(`K 尚未完全關閉：${failures.map(item => item.name).join('、')}。程序停止後請重試。`, {
          cause: failures[0].error
        });
        error.name = 'DesktopShutdownError';
        error.code = 'K_SHUTDOWN_PARTIAL';
        error.statusCode = 503;
        error.failures = failures;
        throw error;
      }
      for (const client of clients) client.end();
    })();
    let wrapped;
    wrapped = pending.finally(() => {
      if (resourceCloseAttempt === wrapped) resourceCloseAttempt = null;
    });
    resourceCloseAttempt = wrapped;
    return wrapped;
  };
  let serverClosePromise = null;
  const closeServer = () => {
    if (serverClosePromise) return serverClosePromise;
    if (!server.listening) return Promise.resolve();
    const pending = Promise.all(
      [server, remoteServer]
        .filter(s => s?.listening)
        .map(
          s =>
            new Promise((resolve, reject) => {
              s.close(error => (error ? reject(error) : resolve()));
              s.closeAllConnections();
            })
        )
    );
    // Owned work is already settled; do not let renderer HTTP connections keep shutdown alive.
    server.closeAllConnections();
    serverClosePromise = pending.finally(() => {
      serverClosePromise = null;
    });
    return serverClosePromise;
  };
  let origin;
  const handleRequest = isRemote => async (req, res) => {
    const json = (code, value) => {
      res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(value));
    };
    let requestPath = '';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data: http: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    try {
      const requestOrigin = isRemote ? remoteConfig.origin : origin;
      const remoteIdentity = isRemote ? await remote.identity(req) : null;
      if (isRemote ? !remoteIdentity : req.headers.host !== new URL(origin).host)
        return json(403, {error: 'Invalid remote identity or host'});
      const url = new URL(req.url, requestOrigin);
      requestPath = url.pathname;
      const authenticated = isRemote ? await remote.authorized(req, remoteIdentity) : cookieMatches(req);
      if (isRemote) {
        if (authenticated && url.pathname !== '/api/remote/logout') {
          try {
            const refreshed = await remote.refresh(req);
            if (refreshed) res.setHeader('Set-Cookie', refreshed);
          } catch (error) {
            console.error('[remote session renewal]', error.message);
          }
        }
        res.setHeader('Strict-Transport-Security', 'max-age=31536000');
        if (req.method === 'POST' && url.pathname === '/api/remote/login') {
          if (
            req.headers.origin !== requestOrigin ||
            req.headers['x-k-request'] !== '1' ||
            !req.headers['content-type']?.startsWith('application/json')
          )
            return json(403, {error: 'Explicit same-origin request required'});
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 1024) return json(413, {error: 'Request too large'});
          }
          const session = await remote.login(JSON.parse(body).key, remoteIdentity);
          if (!session) return json(403, {error: 'Remote access denied'});
          res.setHeader('Set-Cookie', session);
          return json(200, {ok: true});
        }
        if (req.method === 'GET' && ['/remote-login.js', '/remote-login.css'].includes(url.pathname)) {
          const js = url.pathname.endsWith('.js');
          res.setHeader('Content-Type', js ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
          return res.end(js ? remoteLoginJs : remoteLoginCss);
        }
        if (req.method === 'GET' && url.pathname === '/' && !authenticated) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end(remoteLoginHtml);
        }
        if (req.method === 'POST' && (req.headers.origin !== requestOrigin || req.headers['x-k-request'] !== '1'))
          return json(403, {error: 'Explicit same-origin request required'});
        if (req.method === 'POST' && url.pathname === '/api/remote/logout' && authenticated) {
          res.setHeader('Set-Cookie', await remote.logout(req));
          return json(200, {ok: true});
        }
        if (url.pathname.startsWith('/api/') && !remoteRouteAllowed(req.method, url.pathname))
          return json(403, {error: '此操作只在電腦端提供。'});
        if (['/bootstrap', '/health'].includes(url.pathname)) return json(403, {error: 'Local entry only'});
      }
      if (
        closing &&
        !(req.method === 'GET' && ['/health', '/api/state'].includes(url.pathname)) &&
        !(req.method === 'POST' && url.pathname === '/api/shutdown')
      )
        return json(503, {error: updating() ? 'K 正在更新並重新啟動，約 2 分鐘後再試。' : 'K 正在關閉，請稍後重試。'});
      if (req.method === 'GET' && url.pathname === '/bootstrap') {
        const actual = Buffer.from(url.searchParams.get('token') ?? ''),
          expected = Buffer.from(launchToken ?? '');
        if (
          !launchToken ||
          Date.now() > launchExpires ||
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          return json(403, {error: '啟動連結無效或已使用，請重新從桌面開啟。'});
        launchToken = null;
        launchExpires = 0;
        res.writeHead(303, {'Location': '/', 'Set-Cookie': `k_session=${cookie}; HttpOnly; SameSite=Strict; Path=/`});
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/health')
        return json(200, {app: 'k-harness-desktop', version: 1, deployment: 'native', workspace: root});
      if (
        req.method === 'GET' &&
        (url.pathname === '/' ||
          url.pathname === '/manifest.webmanifest' ||
          /^\/icons\/k-(192|512)\.png$/.test(url.pathname) ||
          /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname))
      ) {
        if (url.pathname === '/' && !authenticated) return json(403, {error: '請從可信桌面入口開啟 K。'});
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const type = name.endsWith('.js')
          ? 'text/javascript'
          : name.endsWith('.css')
            ? 'text/css'
            : name.endsWith('.html')
              ? 'text/html'
              : name.endsWith('.jpg')
                ? 'image/jpeg'
                : name.endsWith('.png')
                  ? 'image/png'
                  : name.endsWith('.webmanifest')
                    ? 'application/manifest+json'
                    : 'application/octet-stream';
        let body = await readFile(new URL(name, uiRoot));
        if (isRemote && name === 'index.html')
          body = body.toString('utf8').replace('<html ', '<html data-k-remote="true" ');
        res.writeHead(200, {'Content-Type': `${type}; charset=utf-8`});
        return res.end(body);
      }
      if (!authenticated)
        return json(403, {
          error: isRemote ? '遠端授權已失效，請重新登入。' : '請從桌面啟動 K。',
          ...(isRemote ? {code: 'K_REMOTE_AUTH_REQUIRED'} : {})
        });
      if (isRemote && req.method === 'POST') await remote.acceptCommand(req);
      if (req.headers.origin && req.headers.origin !== requestOrigin)
        return json(403, {error: 'Cross-origin request denied'});
      if (req.method === 'GET' && url.pathname === '/api/events') {
        // The snapshot below resets the shared diff baseline. Always flush pending differences to existing
        // screens first: a change made in place but not yet announced (no timer scheduled) would otherwise
        // be folded into the new baseline and never reach them.
        publish();
        res.writeHead(200, {'Content-Type': 'text/event-stream', 'Connection': 'keep-alive'});
        const snapshot = stateStream.snapshot(publicState(), controller.historyVersion);
        res.write(`data: ${JSON.stringify(isRemote ? remoteStateEvent(snapshot) : snapshot)}\n\n`);
        clients.add(res);
        if (isRemote) remoteClients.add(res);
        const heartbeat = setInterval(async () => {
          try {
            if (isRemote && !(await remote.authorized(req))) {
              clients.delete(res);
              res.end();
              return;
            }
            if (!res.destroyed) res.write(': alive\n\n');
          } catch (error) {
            console.error('[remote heartbeat]', error.message);
            clients.delete(res);
            res.end();
          }
        }, 20000);
        res.on('close', () => {
          clearInterval(heartbeat);
          clients.delete(res);
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/codex/auth') return json(200, await codexLogin.status());
      if (req.method === 'GET' && url.pathname === '/api/discussion/models')
        return json(200, discussionApi ? await discussionApi.models() : {models: []});
      if (req.method === 'GET' && url.pathname === '/api/discussion/connections')
        return json(200, discussionApi ? await discussionApi.list() : {connections: []});
      if (req.method === 'GET' && url.pathname === '/api/gemini/accounts')
        return json(
          200,
          geminiAccounts
            ? await geminiAccounts.list()
            : {enabled: false, activeAccountId: null, busy: false, loginPending: false, accounts: []}
        );
      if (req.method === 'GET' && url.pathname === '/api/gemini/auth') {
        const managed = await geminiAccounts?.list();
        if (managed?.accounts.length) {
          const row = managed.accounts.find(a => a.id === managed.activeAccountId);
          return json(200, {
            available: true,
            auth: row?.auth ?? {status: 'unknown'},
            quota: row?.quota,
            reason: managed.reason
          });
        }
        return json(
          200,
          await (geminiAccounts ? geminiAccounts.inspect(() => geminiLogin.status()) : geminiLogin.status())
        );
      }
      if (req.method === 'GET' && url.pathname === '/api/claude/auth') {
        const result = await claudeLogin.status({refresh: url.searchParams.get('refresh') === '1'});
        if (!isRemote) return json(200, result);
        const {loggedIn, authMethod, apiProvider, subscriptionType} = result.auth ?? {};
        return json(200, {available: result.available, auth: {loggedIn, authMethod, apiProvider, subscriptionType}});
      }
      if (req.method === 'GET' && url.pathname === '/api/claude/login') return json(200, claudeLogin.progress());
      if (req.method === 'GET' && url.pathname === '/api/sessions') return json(200, await controller.sessions());
      if (req.method === 'GET' && url.pathname === '/api/projects')
        return json(200, await listProjects(root, (await controller.sessions()).sessions));
      if (req.method === 'GET' && url.pathname === '/api/models') return json(200, await controller.models());
      if (req.method === 'GET' && ['/api/tool', '/api/turn-diff'].includes(url.pathname)) {
        const state = controller.state;
        if (!state.threadId || url.searchParams.get('threadId') !== state.threadId)
          return json(409, {error: '聊天室已切換，請回到原對話查看紀錄。'});
        const kind = url.pathname === '/api/tool' ? 'tool' : 'diff',
          record = (kind === 'tool' ? state.tools : state.turnDiffs)?.find(
            item => (kind === 'tool' ? item.id : item.turnId) === url.searchParams.get('id')
          );
        return record ? json(200, {[kind]: record}) : json(404, {error: '這筆紀錄目前無法讀取；未重開或重送工作。'});
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(200, publicState());
      if (req.method === 'GET' && url.pathname === '/api/schedules') {
        const {schedules} = await controller.schedules.list();
        return json(200, {schedules: schedules.map(s => ({...s, upcoming: computeUpcoming(s)}))});
      }
      if (req.method === 'GET' && url.pathname === '/api/browser/state') {
        const threadId = url.searchParams.get('threadId'),
          session = controller.state.browserAccess?.sessionKey;
        const result = await browserRequest(root, controller.state, threadId, '/state');
        if (threadId !== controller.state.threadId || session !== controller.state.browserAccess?.sessionKey)
          throw new Error('對話已切換。');
        return json(200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/self-update') {
        // Without the tray launcher (tests, development) there is simply nothing to update.
        if (!selfUpdate) return json(200, {available: false, updating: false, failed: null});
        const info = readSelfUpdate(selfUpdate.repoRoot);
        return json(200, {
          available: !!info.available,
          updating: updating(),
          failed: info.failed
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/usage') {
        const refresh = url.searchParams.get('refresh') === '1',
          usage = await controller.usage(refresh),
          managed = await geminiAccounts?.usage(false);
        return json(200, {...usage, ...(managed ? {gemini: managed} : {})});
      }
      if (req.method === 'GET' && url.pathname === '/api/directories')
        return json(200, await controller.directories(url.searchParams.get('path') ?? undefined));
      if (req.method === 'GET' && ['/api/artifact', '/api/attachment', '/api/message-file'].includes(url.pathname)) {
        const context = {threadId: url.searchParams.get('threadId')};
        if (url.pathname !== '/api/attachment') {
          const file =
            url.pathname === '/api/artifact'
              ? await controller.artifactSource(url.searchParams.get('path'), context)
              : await (async () => {
                  const target = await controller.messageFilePath(url.searchParams.get('path'), context);
                  return {path: target, ...(await readPresentedPath(target, {maxBytes: 0}))};
                })();
          if (url.searchParams.get('download') === '1' || file.contentType.startsWith('image/')) {
            if (url.searchParams.get('download') === '1')
              res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
            res.setHeader('Content-Type', file.contentType);
            res.setHeader('Content-Length', String(file.size));
            await pipeline(createReadStream(file.path), res);
            return;
          }
          const preview = file.isText ? await readPresentedPath(file.path, {maxBytes: 262144}) : file;
          return json(200, {
            name: file.name,
            isText: file.isText,
            text: file.isText ? preview.bytes.toString('utf8') : null,
            truncated: file.size > 262144,
            size: file.size
          });
        }
        if (url.pathname === '/api/attachment' && url.searchParams.get('download') === '1') {
          const file = await controller.attachmentSource(url.searchParams.get('id'), context);
          res.writeHead(200, {
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            'Content-Type': file.contentType,
            'Content-Length': String(file.size)
          });
          await pipeline(createReadStream(file.path), res);
          return;
        }
        const file = await controller.attachmentFile(url.searchParams.get('id'), context);
        if (file.contentType.startsWith('image/')) {
          res.setHeader('Content-Type', file.contentType);
          return res.end(file.bytes);
        }
        return json(200, {
          name: file.name,
          isText: file.isText,
          text: file.isText ? file.bytes.subarray(0, 262144).toString('utf8') : null,
          truncated: file.bytes.length > 262144,
          size: file.bytes.length
        });
      }
      if (
        req.method === 'POST' &&
        url.pathname === '/api/upload' &&
        req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() === 'application/octet-stream'
      ) {
        if (req.headers['x-k-request'] !== '1') return json(403, {error: 'Explicit local request required'});
        const threadId = req.headers['x-k-thread-id'],
          encodedName = req.headers['x-k-file-name'];
        if (typeof threadId !== 'string' || typeof encodedName !== 'string')
          return json(400, {error: '附件資料不完整。'});
        let name;
        try {
          name = decodeURIComponent(encodedName);
        } catch {
          return json(400, {error: '附件名稱無效。'});
        }
        if (!req.headers['x-k-command'] || typeof req.headers['x-k-command'] !== 'string')
          return json(400, {error: '附件請求識別無效。'});
        // A streamed upload skips the JSON body check below, so it is refused here during an update.
        if (updating()) return json(503, {error: 'K 正在更新並重新啟動，約 2 分鐘後再試。'});
        return json(200, await controller.uploadStream({threadId, name}, req));
      }
      if (
        req.method !== 'POST' ||
        req.headers['x-k-request'] !== '1' ||
        !req.headers['content-type']?.startsWith('application/json')
      )
        return json(403, {error: 'Explicit local request required'});
      // Attachments have no K-specific byte cap. Keep the limits on other commands,
      // and decode once so large uploads do not repeatedly copy/scan the whole body.
      const chunks = [],
        maxBody =
          url.pathname === '/api/upload'
            ? Infinity
            : url.pathname === '/api/dictation/transcribe'
              ? MAX_JSON_BYTES
              : 65536;
      let bodyBytes = 0;
      for await (const chunk of req) {
        bodyBytes += chunk.length;
        if (bodyBytes > maxBody) {
          if (url.pathname === '/api/dictation/transcribe')
            throw new LocalDictationError('請求過大。', {code: 'REQUEST_TOO_LARGE', statusCode: 413});
          throw new Error('請求過大。');
        }
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      // Checked after the body arrived: while an update is reserved no new work may start. Stopping,
      // answering a question and closing stay available.
      if (updating() && !['/api/shutdown', '/api/self-update', '/api/stop', '/api/answer'].includes(url.pathname))
        return json(503, {error: 'K 正在更新並重新啟動，約 2 分鐘後再試。'});
      if (url.pathname.startsWith('/api/discussion/connections/')) {
        if (!discussionApi) throw Error('此版本未接通討論 API 設定。');
        const operation = {
          '/api/discussion/connections/save': 'save',
          '/api/discussion/connections/models': 'discover',
          '/api/discussion/connections/remove': 'remove'
        }[url.pathname];
        if (!operation) throw Error('API 連線操作無效。');
        return json(200, await discussionApi[operation](data));
      }
      if (url.pathname === '/api/self-update') {
        if (!selfUpdate) return json(404, {error: 'Self-update not configured'});
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 0)
          return json(400, {error: '更新要求格式無效。'});
        if (updating()) return json(409, {error: '已經在更新了。'});
        const ref = readSelfUpdate(selfUpdate.repoRoot).available;
        if (!ref) return json(409, {error: '目前沒有可更新的版本。'});
        // Obvious work is refused at once; otherwise the update is reserved before the first await, so a
        // second press and any new work are refused until the hand-off.
        let busy = selfUpdateSnapshotBusy();
        if (busy.length) return json(409, {error: '還有工作在跑，等結束再按。', busy});
        updateChecking = true;
        try {
          busy = await selfUpdateBusy();
          if (busy.length) return json(409, {error: '還有工作在跑，等結束再按。', busy});
          updateHandedOffAt = Date.now();
          await selfUpdate.request(ref);
          return json(200, {started: true});
        } catch {
          updateHandedOffAt = 0;
          return json(503, {error: 'K 無法開始更新，沒有關閉。'});
        } finally {
          updateChecking = false;
        }
      }
      if (url.pathname === '/api/core-update') {
        if (!coreUpdates) throw Error('請從正式桌面入口更新核心。');
        return json(200, await coreUpdates.update(data.provider));
      }
      if (url.pathname === '/api/dictation/prepare') {
        // The request stays open until transcription adopts the preloaded helper or it ends: the
        // connection is the lease, so cancel, a closed page or a dropped network releases the GPU.
        if (
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data) ||
          Object.keys(data).length !== 1 ||
          typeof data.id !== 'string' ||
          !data.id.trim() ||
          data.id.length > 128
        )
          throw new LocalDictationError('預先載入要求格式無效。', {code: 'INVALID_REQUEST', statusCode: 400});
        const abort = new AbortController();
        const disconnected = () => {
          if (!res.writableEnded) abort.abort();
        };
        res.once('close', disconnected);
        req.once('aborted', disconnected);
        try {
          const result = await localDictation.prepare({id: data.id, signal: abort.signal});
          if (abort.signal.aborted || res.destroyed) return;
          return json(200, result);
        } finally {
          res.off('close', disconnected);
          req.off('aborted', disconnected);
        }
      }
      if (url.pathname === '/api/dictation/transcribe') {
        if (
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data) ||
          Object.keys(data).length !== 2 ||
          typeof data.id !== 'string' ||
          !data.id.trim() ||
          data.id.length > 128 ||
          typeof data.audioBase64 !== 'string'
        )
          throw new LocalDictationError('請提供有效的 id 與 audioBase64 音訊資料。', {
            code: 'INVALID_REQUEST',
            statusCode: 400
          });
        const abort = new AbortController();
        const disconnected = () => {
          if (!res.writableEnded) abort.abort();
        };
        res.once('close', disconnected);
        req.once('aborted', disconnected);
        try {
          const result = await localDictation.transcribe(data.audioBase64, {id: data.id, signal: abort.signal});
          if (abort.signal.aborted || res.destroyed) return;
          return json(200, result);
        } finally {
          res.off('close', disconnected);
          req.off('aborted', disconnected);
        }
      }
      if (url.pathname === '/api/codex/login') return json(200, await codexLogin.start());
      if (url.pathname.startsWith('/api/gemini/accounts/')) {
        const operation = {
          'capture': 'capture',
          'login': 'startLogin',
          'finish': 'finishLogin',
          'cancel': 'cancelLogin',
          'activate': 'activate',
          'refresh': 'refresh',
          'refresh-all': 'refreshAll'
        }[url.pathname.slice('/api/gemini/accounts/'.length)];
        if (!operation || !geminiAccounts) throw Error('此版本未提供 Gemini 多帳號操作。');
        const result = await geminiAccounts[operation](data);
        broadcast(stateStream.update(publicState(), controller.historyVersion));
        return json(200, result);
      }
      if (url.pathname === '/api/gemini/login') {
        if ((await geminiAccounts?.list())?.accounts.length)
          throw Error('請在 Gemini 多帳號區使用加入帳號或重新登入。');
        return json(
          200,
          await (geminiAccounts ? geminiAccounts.inspect(() => geminiLogin.start()) : geminiLogin.start())
        );
      }
      if (url.pathname === '/api/codex/login/cancel') return json(200, await codexLogin.cancel());
      if (url.pathname === '/api/claude/login') return json(200, await claudeLogin.start());
      if (url.pathname === '/api/claude/login/cancel') return json(200, await claudeLogin.cancel());
      if (url.pathname === '/api/claude/login/code') return json(200, await claudeLogin.submitCode({code: data.code}));
      if (url.pathname === '/api/pick-workspace') {
        if (pickerAbort) throw new Error('資料夾選擇視窗已開啟，請先完成或取消。');
        if (data.path !== undefined && typeof data.path !== 'string') throw new Error('資料夾路徑無效。');
        const abort = new AbortController();
        pickerAbort = abort;
        const disconnected = () => abort.abort();
        res.once('close', disconnected);
        try {
          const picked = await pickWorkspace({
            path: data.path ?? controller.state.workspace ?? root,
            signal: abort.signal
          });
          if (abort.signal.aborted) return;
          if (picked?.cancelled === true) return json(200, {cancelled: true});
          if (picked?.cancelled !== false || typeof picked.path !== 'string' || !picked.path)
            throw new Error('資料夾選擇器未回傳有效結果，請重新選擇。');
          return json(200, {cancelled: false, path: await validateProjectWorkspace(picked.path)});
        } finally {
          res.off('close', disconnected);
          if (pickerAbort === abort) pickerAbort = null;
        }
      }
      if (url.pathname === '/api/projects') {
        const folder = await validateProjectWorkspace(data.path);
        const project = await addProject(root, folder);
        const existing = (await listProjects(root)).projects.find(
          item => item.path.toLowerCase() === project.path.toLowerCase()
        );
        if (existing?.archived) return json(200, await updateProject(root, {path: project.path, archived: false}));
        return json(200, project);
      }
      if (url.pathname === '/api/projects/metadata')
        return json(200, await updateProject(root, data, (await controller.sessions()).sessions));
      if (url.pathname === '/api/sidebar/preferences') {
        if (isRemote && data.initialize) return json(403, {error: '首次排序沿用電腦已保存的設定。'});
        const preferences = await sidebarPreferences.update(data);
        publish();
        return json(200, {preferences});
      }
      if (url.pathname === '/api/attention/read') return json(200, controller.markViewed(data));
      // The page only pauses, resumes or deletes; edits to timing or text go through the AI tools.
      if (url.pathname === '/api/schedules/update') {
        if (typeof data.paused !== 'boolean') throw Error('排程更新只接受暫停或恢復。');
        return json(200, await controller.schedules.update({id: data.id, paused: data.paused}));
      }
      if (url.pathname === '/api/schedules/remove') return json(200, await controller.schedules.remove({id: data.id}));
      const routes = {
        '/api/discussion/message': 'discussionMessage',
        '/api/fork': 'fork',
        '/api/queue': 'queue',
        '/api/room-notes': 'roomNote',
        '/api/open': 'open',
        '/api/send': 'send',
        '/api/steer': 'steer',
        '/api/goal': 'goal',
        '/api/compact': 'compact',
        '/api/stop': 'stop',
        '/api/answer': 'answer',
        '/api/workers': 'workers',
        '/api/upload': 'upload',
        '/api/metadata': 'metadata',
        '/api/archives/delete': 'deleteArchived',
        '/api/workspace': 'selectWorkspace',
        '/api/workspace/move': 'moveWorkspace',
        '/api/model': 'selectModel',
        '/api/native/review': 'review',
        '/api/native/files/search': 'fuzzyFileSearch'
      };
      if (routes[url.pathname])
        return json(
          200,
          await controller[routes[url.pathname]](
            ...(!controller.concurrentConversations &&
            ['/api/workers', '/api/stop', '/api/compact'].includes(url.pathname)
              ? []
              : [data])
          )
        );
      if (url.pathname === '/api/shutdown') {
        await closeResources();
        json(200, {closed: true});
        setTimeout(() => {
          void closeServer().catch(() => {});
        }, 100);
        return;
      }
      json(404, {error: 'Not found'});
    } catch (e) {
      if (!res.headersSent) {
        const status = e.statusCode ?? 400;
        if (requestPath === '/api/dictation/transcribe') {
          const diagnostic = e instanceof LocalDictationError ? e.diagnostic : (e.diagnostic ?? e.message);
          json(status, {
            ok: false,
            error: e instanceof LocalDictationError ? e.message : '轉錄要求無法處理。',
            code: e.code ?? 'INVALID_REQUEST',
            ...(!isRemote && diagnostic ? {diagnostic} : {})
          });
        } else json(status, {error: e.message});
      } else res.end();
    }
  };
  // Every write still being handled holds back an update: closing K would cut it off midway.
  const handler = isRemote => {
    const handle = handleRequest(isRemote);
    return async (req, res) => {
      let path = '';
      try {
        path = new URL(req.url ?? '', 'http://127.0.0.1').pathname;
      } catch {}
      const write = req.method === 'POST' && path !== '/api/self-update';
      if (write) writesInProgress++;
      try {
        return await handle(req, res);
      } finally {
        if (write) writesInProgress--;
      }
    };
  };
  const server = http.createServer({requestTimeout: 0, headersTimeout: 60_000}, handler(false));
  server.once('close', () => {
    if (!closedResources.has('本機語音辨識')) void closeLocalDictation().catch(() => {});
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  if (remoteConfig) {
    remoteServer = http.createServer({requestTimeout: 0, headersTimeout: 60_000}, handler(true));
    try {
      await new Promise((resolve, reject) => {
        remoteServer.once('error', reject);
        remoteServer.listen(remoteConfig.port, '127.0.0.1', resolve);
      });
    } catch (error) {
      remoteError = error.message;
    }
  }
  if (remoteError) console.warn('K 遠端入口未啟動；本機入口維持可用：', remoteError);
  return {
    origin,
    remoteOrigin: remoteServer?.listening ? remoteConfig.origin : null,
    remoteError,
    controller,
    onStateChange(listener) {
      stateListeners.add(listener);
      listener(publicState());
      return () => stateListeners.delete(listener);
    },
    onClosed(listener) {
      server.once('close', listener);
    },
    createLaunchUrl() {
      launchToken = randomBytes(32).toString('hex');
      launchExpires = Date.now() + 60000;
      return `${origin}/bootstrap?token=${launchToken}`;
    },
    async close() {
      await closeResources();
      await closeServer();
    }
  };
}
