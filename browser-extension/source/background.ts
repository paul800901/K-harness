/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { debugLog } from './relayConnection';
import { PendingConnections } from './pendingConnection';
import { ConnectedTabGroup, cleanupStalePlaywrightGroups, isNonDebuggableUrl, ungroupTabs, uniqueGroupStyle } from './connectedTabGroup';
import { NativeConnection } from './nativeConnection';

type BrowserMode = 'regular' | 'incognito';

type PageMessage = {
  type: 'connectionRequested';
  mcpRelayUrl: string;
  mode: BrowserMode;
  newTab: boolean;
} | {
  type: 'connectToNewTab';
  clientName?: string;
  mode: BrowserMode;
} | {
  type: 'getConnectionStatus';
} | {
  type: 'disconnect';
  connectionId: number;
};

class PlaywrightExtension {
  private _connections = new Map<number, ConnectedTabGroup>();
  private _lastConnectionId = 0;
  private _pendingConnections = new PendingConnections();
  private _nativeConnection: NativeConnection;
  // Service worker restarts lose all connection state, so any existing
  // Playwright groups are stale. Connections wait on this before reconciling.
  private _cleanupPromise: Promise<void>;

  constructor() {
    chrome.runtime.onMessage.addListener(this._onMessage.bind(this));
    chrome.action.onClicked.addListener(this._onActionClicked.bind(this));
    this._nativeConnection = new NativeConnection();
    this._cleanupPromise = cleanupStalePlaywrightGroups();
  }

  // Promise-based message handling is not supported in Chrome: https://issues.chromium.org/issues/40753031
  private _onMessage(message: PageMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
    switch (message.type) {
      case 'connectionRequested': {
        const selectorTabId = sender.tab?.id;
        if (selectorTabId === undefined) {
          sendResponse({ success: false, error: '連線要求必須來自 K 瀏覽器助手連線頁面。' });
          return false;
        }
        this._validateRequest(selectorTabId, message).then(async () => {
          await this._releaseConnectPage(selectorTabId);
          this._pendingConnections.create(selectorTabId, message.mcpRelayUrl, message.mode);
          sendResponse({ success: true });
        }).catch((error: any) => sendResponse({ success: false, error: error?.message ?? 'K 連線要求處理失敗。' }));
        return true;
      }
      case 'connectToNewTab': {
        const selectorTabId = sender.tab?.id;
        if (selectorTabId === undefined) {
          sendResponse({ success: false, error: '連線要求必須來自 K 瀏覽器助手連線頁面。' });
          return false;
        }
        this._connectToNewTab(selectorTabId, message.clientName, message.mode).then(
            tab => this._connectTab(sender.tab!.id!, tab, message.clientName, message.mode).then(
                () => sendResponse({ success: true }),
                (error: any) => sendResponse({ success: false, error: error.message })),
            (error: any) => sendResponse({ success: false, error: error.message }));
        return true;
      }
      case 'getConnectionStatus':
        sendResponse({
          connections: [...this._connections].map(([id, group]) => ({
            id,
            clientName: group.clientName,
            connectedTabIds: group.connectedTabIds(),
          })),
        });
        return false;
      case 'disconnect':
        this._connections.get(message.connectionId)?.close('User disconnected');
        sendResponse({ success: true });
        return false;
    }
  }

  private async _connectTab(selectorTabId: number, tab: chrome.tabs.Tab & { id: number }, clientName: string | undefined, mode: BrowserMode): Promise<void> {
    try {
      if (mode !== 'regular' && mode !== 'incognito')
        throw new Error('Connection mode must be explicitly regular or incognito');
      const actualTab = await chrome.tabs.get(tab.id);
      if (actualTab.id === undefined || isNonDebuggableUrl(actualTab.url))
        throw new Error('K cannot attach to this browser page');
      if (actualTab.incognito !== (mode === 'incognito'))
        throw new Error(`Selected tab is not in the requested ${mode} window`);
      tab = actualTab as chrome.tabs.Tab & { id: number };
      await this._cleanupPromise;
      this._releaseTab(selectorTabId);
      if (tab.id !== selectorTabId && this._connectedTabIds().has(tab.id))
        throw new Error('This tab is already connected to another client');

      const connection = await this._pendingConnections.take(selectorTabId, mode, tab.windowId);
      if (!connection)
        throw new Error('Pending client connection closed');

      const id = ++this._lastConnectionId;
      const taken = [...this._connections.values()].map(group => group.groupStyle);
      const group = new ConnectedTabGroup(connection, tab, clientName, uniqueGroupStyle(clientName, taken), tabId => this._pendingConnections.has(tabId), mode);
      group.onclose = () => this._connections.delete(id);
      this._connections.set(id, group);

      if (tab.id !== selectorTabId)
        await chrome.tabs.remove(selectorTabId).catch(() => {});
    } catch (error: any) {
      debugLog(`Failed to connect tab ${tab.id}:`, error.message);
      throw error;
    }
  }

  private async _connectToNewTab(selectorTabId: number, clientName: string | undefined, mode: BrowserMode): Promise<chrome.tabs.Tab & { id: number }> {
    if (mode !== 'regular' && mode !== 'incognito')
      throw new Error('請求缺少有效的瀏覽器模式。');
    await this._validateConnectPage(selectorTabId, mode);
    if (!this._pendingConnections.matches(selectorTabId, mode))
      throw new Error('這個連線要求已失效或模式不符，請由 K 重新啟動。');
    if (mode === 'incognito' && !await chrome.extension.isAllowedIncognitoAccess())
      throw new Error('請先在 Chrome 的 K 瀏覽器助手擴充功能詳細資料中允許無痕模式。');
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const targetWindow = windows.find(window => window.incognito === (mode === 'incognito') && Number.isInteger(window.id));
    if (targetWindow?.id === undefined)
      throw new Error(mode === 'incognito'
        ? '請先開啟無痕 Chrome 視窗，再由 K 重試；K 不會自動彈出視窗。'
        : '請先開啟一般 Chrome 視窗，再由 K 重試；K 不會自動彈出視窗。');
    const tab = await chrome.tabs.create({ url: 'about:blank', windowId: targetWindow.id, active: false });
    if (!tab || tab.id === undefined || tab.incognito !== (mode === 'incognito'))
      throw new Error('Chrome 未建立符合所選模式的新分頁。');
    return tab as chrome.tabs.Tab & { id: number };
  }

  // Chrome may create the connect page inside the active client's group.
  private async _releaseConnectPage(tabId: number): Promise<void> {
    this._releaseTab(tabId);
    await ungroupTabs([tabId]);
  }

  private _releaseTab(tabId: number): void {
    for (const group of this._connections.values())
      group.releaseTab(tabId);
  }

  private async _validateConnectPage(selectorTabId: number, mode: BrowserMode): Promise<void> {
    const selectorTab = await chrome.tabs.get(selectorTabId);
    const actualUrl = new URL(selectorTab.url ?? '');
    const expectedUrl = new URL(chrome.runtime.getURL('connect.html'));
      if (actualUrl.protocol !== expectedUrl.protocol || actualUrl.host !== expectedUrl.host || actualUrl.pathname !== expectedUrl.pathname)
      throw new Error('連線頁面來源不符。');
    if (actualUrl.searchParams.get('newTab') !== 'true' || actualUrl.searchParams.get('mode') !== mode)
      throw new Error('K 只允許由指定模式的新分頁連線流程啟動；不會自動接管既有分頁。');
  }

  private async _validateRequest(selectorTabId: number, message: Extract<PageMessage, { type: 'connectionRequested' }>): Promise<void> {
    if (message.mode !== 'regular' && message.mode !== 'incognito')
      throw new Error('請求缺少有效的瀏覽器模式。');
    if (message.newTab !== true)
      throw new Error('K 只允許由明確的新分頁連線流程建立空白分頁。');
    const relay = new URL(message.mcpRelayUrl);
    if (relay.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(relay.hostname))
      throw new Error('K 僅允許連接至本機 relay。');
    await this._validateConnectPage(selectorTabId, message.mode);
    if (message.mode === 'incognito' && !await chrome.extension.isAllowedIncognitoAccess())
      throw new Error('請先在 Chrome 的 K 瀏覽器助手擴充功能詳細資料中允許無痕模式。');
  }

  private _connectedTabIds(): Set<number> {
    return new Set([...this._connections.values()].flatMap(group => group.connectedTabIds()));
  }

  private async _onActionClicked(): Promise<void> {
    // The explicit extension action may retry a failed native-host connection.
    this._nativeConnection.reconnect();
    await chrome.tabs.create({
      url: chrome.runtime.getURL('status.html'),
      active: true
    });
  }
}

new PlaywrightExtension();
