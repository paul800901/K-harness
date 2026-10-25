/**
 * Side channel that tells K which connection step this page reached, or why
 * it failed, so a stalled connection is diagnosable from K. Best effort only:
 * every failure here is swallowed and never affects the connection itself.
 */
export type ConnectReporter = {
  stage(text: string): void;
  fail(text: string): void;
  close(): void;
};

export function createConnectReporter(relayUrl: string, WebSocketImpl: typeof WebSocket = WebSocket): ConnectReporter {
  const queue: string[] = [];
  let ws: WebSocket | undefined;
  let closeWhenOpen = false;
  const send = (message: string) => {
    try {
      ws?.send(message);
    } catch {
      ws = undefined;
    }
  };
  try {
    const url = new URL(relayUrl);
    if (/^\/extension\/[a-f0-9]{64}$/.test(url.pathname)) {
      url.pathname = url.pathname.replace('/extension/', '/status/');
      const socket = new WebSocketImpl(url.href);
      ws = socket;
      socket.onerror = () => { ws = undefined; };
      socket.onopen = () => {
        for (const message of queue.splice(0))
          send(message);
        if (closeWhenOpen)
          try { socket.close(); } catch {}
      };
    }
  } catch {
    ws = undefined;
  }
  // readyState 0 = CONNECTING, 1 = OPEN.
  const post = (message: string) => {
    if (ws?.readyState === 1)
      send(message);
    else if (ws?.readyState === 0)
      queue.push(message);
  };
  return {
    stage: text => post(JSON.stringify({ stage: text })),
    fail: text => post(JSON.stringify({ error: text })),
    close() {
      if (ws?.readyState === 1)
        try { ws.close(); } catch {}
      else
        closeWhenOpen = true;
    },
  };
}
