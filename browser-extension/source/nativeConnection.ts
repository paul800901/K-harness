/**
 * K browser native-messaging handoff. The native host may only ask this
 * extension to open its own, validated connection page in a background tab.
 */

export const K_NATIVE_HOST = 'com.k_harness.browser_assistant';

type NativeRequest = {
  id: string;
  type: 'openConnectPage';
  url: string;
};

type NativePort = {
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
  postMessage(message: unknown): void;
};

type ChromeApi = {
  runtime: {
    id: string;
    getURL(path: string): string;
    connectNative(host: string): NativePort;
    onStartup: { addListener(listener: () => void): void };
  };
  extension: { isAllowedIncognitoAccess(): Promise<boolean> };
  windows: {
    getAll(options: { windowTypes: string[] }): Promise<Array<{ id?: number; incognito?: boolean }>>;
  };
  tabs: {
    create(options: { url: string; active: boolean; windowId: number }): Promise<unknown>;
  };
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(value: Record<string, unknown>): Promise<void> } };
};

export class NativeConnection {
  private _chrome: ChromeApi;
  private _port?: NativePort;
  private _profileId?: Promise<string>;

  private _identity(): Promise<string> {
    // local (not sync) belongs to this Chrome subprofile, not a Google login.
    return this._profileId ??= (async () => {
      const stored = (await this._chrome.storage.local.get('kProfileId')).kProfileId;
      if (typeof stored === 'string' && /^[a-f0-9]{32}$/.test(stored))
        return stored;
      const id = crypto.randomUUID().replaceAll('-', '');
      await this._chrome.storage.local.set({ kProfileId: id });
      return id;
    })().catch(error => { this._profileId = undefined; throw error; });
  }

  constructor(chromeApi: ChromeApi = chrome) {
    this._chrome = chromeApi;
    this._chrome.runtime.onStartup.addListener(() => this.reconnect());
    // Exactly one attempt per service-worker start. A user action can request
    // a later retry through reconnect(); browser startup may reconnect after a
    // prior host disconnect, but disconnect itself never creates a retry loop.
    this.reconnect();
  }

  reconnect(): void {
    if (this._port)
      return;
    let port: NativePort;
    try {
      port = this._chrome.runtime.connectNative(K_NATIVE_HOST);
    } catch {
      console.warn('K native messaging host connection failed.');
      return;
    }
    this._port = port;
    void this._identity().then(async profileId => {
      const incognitoAllowed = await this._chrome.extension.isAllowedIncognitoAccess();
      if (this._port === port)
        this._reply(port, { type: 'profileHello', profileId, incognitoAllowed });
    }).catch(() => { console.warn('K browser profile registration failed.'); });
    port.onMessage.addListener(message => { void this._handleMessage(port, message); });
    port.onDisconnect.addListener(() => {
      if (this._port === port)
        this._port = undefined;
      // Do not retry automatically or open/focus any browser surface here.
      console.warn('K native messaging host disconnected.');
    });
  }

  private async _handleMessage(port: NativePort, input: unknown): Promise<void> {
    const request = input as Partial<NativeRequest> | null;
    if (!request || typeof request.id !== 'string' || request.id.length === 0 || request.id.length > 128)
      return;
    try {
      if (request.type !== 'openConnectPage' || typeof request.url !== 'string')
        throw new Error('invalid request');
      const target = this._validateConnectUrl(request.url);
      const normalWindows = await this._chrome.windows.getAll({ windowTypes: ['normal'] });
      const regularWindow = normalWindows.find(window => !window.incognito && Number.isInteger(window.id));
      if (regularWindow?.id === undefined)
        throw new Error('no existing regular Chrome window');
      if (target.mode === 'incognito' && !await this._chrome.extension.isAllowedIncognitoAccess())
        throw new Error('incognito permission denied');

      // Keep the selector page in an existing regular window for both modes;
      // the background worker creates the actual target window when needed.
      await this._chrome.tabs.create({ url: target.url, active: false, windowId: regularWindow.id });
      this._reply(port, { id: request.id, ok: true });
    } catch {
      // Never echo a URL, relay path, nonce, or Chrome exception text to host.
      this._reply(port, { id: request.id, ok: false, error: 'K could not open the validated background connection page.' });
    }
  }

  private _reply(port: NativePort, message: unknown): void {
    try {
      port.postMessage(message);
    } catch {
      // The host may have disconnected while Chrome was creating the tab.
    }
  }

  private _validateConnectUrl(input: string): { url: string; mode: 'regular' | 'incognito' } {
    const actual = new URL(input);
    const expected = new URL(this._chrome.runtime.getURL('connect.html'));
    // URL.origin is "null" for chrome-extension: URLs in some runtimes;
    // compare the scheme and authority explicitly instead of trusting origin.
    if (actual.protocol !== 'chrome-extension:' || actual.protocol !== expected.protocol || actual.host !== expected.host ||
        actual.pathname !== expected.pathname || actual.username || actual.password || actual.hash)
      throw new Error('not the K connection page');

    const required = ['mcpRelayUrl', 'mode', 'newTab', 'protocolVersion'];
    for (const key of required) {
      if (actual.searchParams.getAll(key).length !== 1)
        throw new Error('invalid connection parameters');
    }
    if (actual.searchParams.getAll('client').length > 1)
      throw new Error('invalid client parameter');
    const mode = actual.searchParams.get('mode');
    if (mode !== 'regular' && mode !== 'incognito')
      throw new Error('invalid browser mode');
    if (actual.searchParams.get('newTab') !== 'true' || actual.searchParams.get('protocolVersion') !== '2')
      throw new Error('invalid connection flow');

    const relay = new URL(actual.searchParams.get('mcpRelayUrl')!);
    if (relay.protocol !== 'ws:' || relay.hostname !== '127.0.0.1' || !/^\d{1,5}$/.test(relay.port) ||
        Number(relay.port) < 1 || Number(relay.port) > 65535 || relay.username || relay.password || relay.search || relay.hash ||
        !/^\/extension\/[a-f0-9]{64}$/.test(relay.pathname))
      throw new Error('invalid local relay');
    return { url: actual.href, mode };
  }
}
