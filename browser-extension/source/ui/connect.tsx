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

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Status =
  | { type: 'connecting'; message: string }
  | { type: 'connected'; message: string }
  | { type: 'error'; message: string }
  | { type: 'error'; versionMismatch: { extensionVersion: string; } };

const SUPPORTED_PROTOCOL_VERSION = 2;
type BrowserMode = 'regular' | 'incognito';

// Client name comes from the URL and never changes for the lifetime of this page.
const clientInfo = (() => {
  try {
    return JSON.parse(new URLSearchParams(window.location.search).get('client') || '{}').name || 'unknown';
  } catch {
    return 'unknown';
  }
})();
const browserMode = (() => {
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === 'regular' || mode === 'incognito' ? mode : null;
})();

const ConnectApp: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null);

  const setError = (message: string) => {
    setStatus({ type: 'error', message });
  };

  useEffect(() => {
    const runAsync = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const relayUrl = params.get('mcpRelayUrl');

        if (!browserMode)
          throw new Error('K 未指定有效的瀏覽器模式。');
        if (params.get('newTab') !== 'true')
          throw new Error('K 只允許透過明確的新分頁連線流程啟動瀏覽器助手；不會自動接管既有分頁。');
        if (!relayUrl)
          throw new Error('缺少本機連線位址。');

        const host = new URL(relayUrl).hostname;
        if (host !== '127.0.0.1' && host !== '[::1]') {
          throw new Error(`K 僅允許本機連線（127.0.0.1 或 [::1]）；收到的位址為 ${host}。`);
        }
        if (new URL(relayUrl).protocol !== 'ws:')
          throw new Error('K 僅允許透過本機 WebSocket relay 連線。');

        setStatus({
          type: 'connecting',
          message: `「${clientInfo}」正在連線至 K 瀏覽器助手，並建立專用的${browserMode === 'incognito' ? '無痕' : '一般'}空白分頁。`
        });

        const parsedVersion = parseInt(params.get('protocolVersion') ?? '', 10);
        const requestedVersion = isNaN(parsedVersion) ? 1 : parsedVersion;
        if (requestedVersion > SUPPORTED_PROTOCOL_VERSION) {
          const extensionVersion = chrome.runtime.getManifest().version;
          setStatus({ type: 'error', versionMismatch: { extensionVersion } });
          return;
        }
        if (requestedVersion < SUPPORTED_PROTOCOL_VERSION)
          throw new Error('K 瀏覽器助手版本不相容，請更新專案內候選版本。');

        const request = await chrome.runtime.sendMessage({ type: 'connectionRequested', mcpRelayUrl: relayUrl, mode: browserMode, newTab: true });
        if (!request?.success)
          throw new Error(request?.error || 'K 本機連線驗證失敗。');

        const connected = await chrome.runtime.sendMessage({ type: 'connectToNewTab', clientName: clientInfo, mode: browserMode });
        if (!connected?.success)
          throw new Error(connected?.error || '無法建立專用空白分頁連線。');
        setStatus({ type: 'connected', message: `「${clientInfo}」已連線至專用的${browserMode === 'incognito' ? '無痕' : '一般'}分頁。` });
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      }
    };
    void runAsync();
  }, []);

  return (
    <div className='app-container'>
      <div className='content-wrapper'>
        {status && (
          <div className='status-container'>
            <StatusBanner status={status} />
          </div>
        )}

      </div>
    </div>
  );
};

const VersionMismatchError: React.FC<{ extensionVersion: string }> = ({ extensionVersion }) => {
  return (
    <div>
      K 瀏覽器助手需要較新版本（目前版本：{extensionVersion}）。請更新專案候選版本後重新連線。
    </div>
  );
};

const StatusBanner: React.FC<{ status: Status }> = ({ status }) => {
  return (
    <div className={`status-banner ${status.type}`}>
      {'versionMismatch' in status ? (
        <VersionMismatchError
          extensionVersion={status.versionMismatch.extensionVersion}
        />
      ) : (
        status.message
      )}
    </div>
  );
};

// Initialize the React app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<ConnectApp />);
}
