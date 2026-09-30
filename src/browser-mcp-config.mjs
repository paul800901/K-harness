// Local-only identity never appears in the provider's serialized MCP config.
const sessionIdentity=Symbol('K browser session');
export function identifyBrowserServer(server,key){Object.defineProperty(server,sessionIdentity,{value:key});return server;}
export function browserSessionKey(server){return server?.[sessionIdentity]??null;}

/** Merge K's optional browser server without replacing existing K MCP entries. */
export function withBrowserMcp(mcpServers, browserServer) {
  const result = { ...(mcpServers ?? {}) };
  if (!browserServer) return result;
  if (Object.hasOwn(result, 'k_browser')) throw new Error('The k_browser MCP name is already in use.');
  result.k_browser = browserServer;
  return result;
}

/** Claude Code's JSON MCP config omits Codex app-server timeout/cwd fields. */
export function toClaudeBrowserMcpServer(browserServer) {
  if(!browserServer)return null;
  const result={type:'http',url:browserServer.url,headers:{...(browserServer.http_headers??browserServer.headers)}};
  return identifyBrowserServer(result,browserSessionKey(browserServer));
}
