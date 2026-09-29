import { readFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const CONFIG_RELATIVE_PATH = path.join('.runtime', 'browser-mcp.json');
// Local-only identity never appears in the provider's serialized MCP config.
const sessionIdentity=Symbol('K browser session');
export function identifyBrowserServer(server,key){Object.defineProperty(server,sessionIdentity,{value:key});return server;}
export function browserSessionKey(server){return server?.[sessionIdentity]??(server?.args?.[2]?path.basename(server.args[2]):null);}

/**
 * Return the project-local Playwright MCP server config only when explicitly
 * enabled in appRoot. The server uses the installed project CLI and a
 * dedicated K-owned profile directory; it never consults a user/browser profile.
 */
export async function readBrowserMcpConfig({ appRoot, conversationId, accessMode, provider, nodeExecutable = process.execPath } = {}) {
  if (typeof appRoot !== 'string' || !path.isAbsolute(appRoot)) throw new Error('Browser MCP appRoot must be an absolute path.');
  if (typeof nodeExecutable !== 'string' || !path.isAbsolute(nodeExecutable)) throw new Error('Browser MCP Node executable must be an absolute path.');

  let source;
  try {
    source = await readFile(path.join(appRoot, CONFIG_RELATIVE_PATH), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  let settings;
  try { settings = JSON.parse(source); }
  catch { throw new Error('Browser MCP setting file is not valid JSON.'); }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || typeof settings.enabled !== 'boolean' || Object.keys(settings).some(key => key !== 'enabled')) {
    throw new Error('Browser MCP setting must be exactly {"enabled":false} or {"enabled":true}.');
  }
  if (!settings.enabled) return null;
  const writableModes=provider==='codex'?['workspace-write','auto-review','danger-full-access']:provider==='claude'?['claude-manual','claude-acceptEdits','claude-auto','claude-bypassPermissions','claude-dontAsk']:[];
  if(!writableModes.includes(accessMode))return null;
  if (typeof conversationId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(conversationId)) throw new Error('Browser MCP requires a safe per-conversation identifier.');
  const output=path.join(appRoot,'.runtime','browser-output',conversationId);
  const profile=path.join(appRoot,'.runtime','browser-profiles',conversationId);
  for(const dir of [output,profile]){
    let current=await realpath(appRoot);
    // Check each ancestor before creating descendants, not after following a junction.
    for(const segment of path.relative(appRoot,dir).split(path.sep)){
      current=path.join(current,segment);
      try{await mkdir(current);}catch(error){if(error.code!=='EEXIST')throw error;}
      if((await realpath(current)).toLowerCase()!==current.toLowerCase())throw new Error('Browser runtime directory must not redirect through links.');
    }
  }

  return {
    command: nodeExecutable,
    args: [path.join(appRoot, 'src', 'browser-mcp-stdio.mjs'), output, profile],
    cwd: output,
    startup_timeout_sec: 30,
    tool_timeout_sec: 120,
  };
}

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
  const result=browserServer.url?{type:'http',url:browserServer.url,headers:{...(browserServer.http_headers??browserServer.headers)}}:{command:browserServer.command,args:[...browserServer.args]};
  return identifyBrowserServer(result,browserSessionKey(browserServer));
}
