import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import {createConnection} from '@playwright/mcp';
import {createBrowserLiveSession} from './browser-live-session.mjs';
import {restrictedBrowserTransport} from './browser-mcp-stdio.mjs';

/**
 * One browser profile driven through the official Playwright MCP server, called
 * in-process by the external browser gateway. Only that gateway's loopback
 * endpoint reaches a model; this object and its profile path stay in K.
 * This is NOT OS isolation.
 */
export async function createBrowserOwnerGateway({directory, profile, launchContext}) {
  if (!path.isAbsolute(directory ?? '') || !path.isAbsolute(profile ?? ''))
    throw new Error('Absolute browser directories are required.');
  const root = await realpath(directory),
    profileRoot = await realpath(profile);
  const relative = path.relative(root, profileRoot);
  if (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)))
    throw new Error('The browser profile must be outside AI browser files.');
  const live = await createBrowserLiveSession(profileRoot, {
    launchContext,
    downloadDirectory: path.join(root, 'downloads')
  });
  let mcp,
    closing = false,
    closePromise;
  const raw = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator: undefined});
  const transport = restrictedBrowserTransport(raw, root, live);

  /**
   * Handle one JSON-RPC message and return the SDK's response. Aborting `signal`
   * before the response body ends cancels a running tool call the same way an
   * MCP client would; an abort after the body ended is not a cancellation.
   */
  async function request(message, signal) {
    if (closing) throw new Error('Browser session is closing.');
    signal?.throwIfAborted();
    let ended = false;
    const cancel = () => {
      if (!ended && message?.method === 'tools/call')
        raw.onmessage?.({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: message.id}});
    };
    signal?.addEventListener('abort', cancel, {once: true});
    const end = () => {
      ended = true;
      signal?.removeEventListener('abort', cancel);
    };
    let response;
    try {
      response = await raw.handleRequest(
        new Request('http://k-browser.invalid/mcp', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'},
          body: JSON.stringify(message)
        })
      );
    } catch (error) {
      cancel();
      end();
      throw error;
    }
    if (!response.body) {
      end();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const item = await reader.read();
          if (item.done) {
            end();
            controller.close();
          } else controller.enqueue(item.value);
        } catch (error) {
          end();
          controller.error(error);
        }
      },
      async cancel(reason) {
        cancel();
        end();
        await reader.cancel(reason);
      }
    });
    return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
  }
  async function close() {
    if (!closePromise)
      closePromise = (async () => {
        closing = true;
        await live.close();
        await mcp?.close();
      })();
    return closePromise;
  }
  try {
    mcp = await createConnection(
      {browser: {browserName: 'chromium'}, outputDir: root, allowUnrestrictedFileAccess: false, webmcp: false},
      live.contextGetter
    );
    mcp.listRoots = async () => ({roots: [{uri: pathToFileURL(root).href, name: 'K browser files'}]});
    await mcp.connect(transport);
  } catch (error) {
    await close();
    throw error;
  }
  return {request, getState: live.getState, close};
}
