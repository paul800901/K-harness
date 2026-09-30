import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyBrowserServer,browserSessionKey,withBrowserMcp,toClaudeBrowserMcpServer} from '../src/browser-mcp-config.mjs';
test('HTTP browser configuration retains private session identity without serializing it',()=>{
 const server=identifyBrowserServer({url:'http://127.0.0.1:1234/mcp',http_headers:{Authorization:'Bearer fixture'}},'local-session');
 assert.equal(browserSessionKey(server),'local-session');assert.doesNotMatch(JSON.stringify(server),/local-session/);
 const claude=toClaudeBrowserMcpServer(server);
 assert.deepEqual(claude,{type:'http',url:server.url,headers:{Authorization:'Bearer fixture'}});
 assert.equal(browserSessionKey(claude),'local-session');assert.equal(toClaudeBrowserMcpServer(null),null);
 assert.equal(browserSessionKey(null),null);
});
test('browser MCP merge preserves existing native servers and refuses a name collision',()=>{
 const existing={k_luna:{url:'http://127.0.0.1:1234/mcp'}},browser={url:'http://127.0.0.1:1235/mcp'};
 assert.deepEqual(withBrowserMcp(existing,browser),{...existing,k_browser:browser});assert.deepEqual(withBrowserMcp(existing,null),existing);
 assert.throws(()=>withBrowserMcp({k_browser:{}},browser),/already in use/);
});
