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

import { RelayConnection, debugLog } from './relayConnection';

export type BrowserMode = 'regular' | 'incognito';

type PendingConnection = {
  relayUrl: string;
  mode: BrowserMode;
};

// Relay URLs recorded by `connectionRequested`, keyed by the connect page tab
// id. The relay WebSocket opens only after the K-initiated new-tab request.
export class PendingConnections {
  private _map = new Map<number, PendingConnection>();

  constructor() {
    chrome.tabs.onRemoved.addListener(tabId => this._map.delete(tabId));
  }

  create(selectorTabId: number, mcpRelayUrl: string, mode: BrowserMode): void {
    this._map.set(selectorTabId, { relayUrl: mcpRelayUrl, mode });
  }

  // A validated K connect page with an outstanding connection request.
  has(selectorTabId: number): boolean {
    return this._map.has(selectorTabId);
  }

  matches(selectorTabId: number, mode: BrowserMode): boolean {
    return this._map.get(selectorTabId)?.mode === mode;
  }

  async take(selectorTabId: number, mode: BrowserMode, targetWindowId: number): Promise<RelayConnection | undefined> {
    const pending = this._map.get(selectorTabId);
    if (pending === undefined)
      return undefined;
    this._map.delete(selectorTabId);
    if (pending.mode !== mode)
      throw new Error('Connection mode changed while awaiting approval');
    return openRelayConnection(pending.relayUrl, mode, targetWindowId);
  }
}

async function openRelayConnection(mcpRelayUrl: string, mode: BrowserMode, targetWindowId: number): Promise<RelayConnection> {
  try {
    const socket = new WebSocket(mcpRelayUrl);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('WebSocket error'));
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
    return new RelayConnection(socket, mode, targetWindowId);
  } catch (error: any) {
    const message = `Failed to connect to MCP relay: ${error.message}`;
    debugLog(message);
    throw new Error(message);
  }
}
