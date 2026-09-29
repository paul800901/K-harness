import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readBrowserMcpConfig,withBrowserMcp,toClaudeBrowserMcpServer} from '../src/browser-mcp-config.mjs';

async function root(){return mkdtemp(path.join(os.tmpdir(),'k-browser-mcp-'));}

test('browser MCP is off with no appRoot setting or explicit false setting',async()=>{
 const appRoot=await root();
 assert.equal(await readBrowserMcpConfig({appRoot}),null);
 await mkdir(path.join(appRoot,'.runtime'));
 await writeFile(path.join(appRoot,'.runtime','browser-mcp.json'),'{"enabled":false}');
 assert.equal(await readBrowserMcpConfig({appRoot}),null);
});

test('explicit appRoot opt-in selects only the installed CLI and per-conversation profile',async()=>{
 const appRoot=await root();await mkdir(path.join(appRoot,'.runtime'));
 await writeFile(path.join(appRoot,'.runtime','browser-mcp.json'),'{"enabled":true}');
 const server=await readBrowserMcpConfig({appRoot,accessMode:'workspace-write',provider:'codex',conversationId:'claude-123e4567-e89b-42d3-a456-426614174000',nodeExecutable:'C:\\node\\node.exe'});
 assert.equal(server.command,'C:\\node\\node.exe');
 assert.equal(server.cwd,path.join(appRoot,'.runtime','browser-output','claude-123e4567-e89b-42d3-a456-426614174000'));
 assert.deepEqual(server.args,[path.join(appRoot,'src','browser-mcp-stdio.mjs'),server.cwd,path.join(appRoot,'.runtime','browser-profiles','claude-123e4567-e89b-42d3-a456-426614174000')]);
 assert.equal(server.args.some(arg=>/storage-state/i.test(arg)),false);
 assert.deepEqual(Object.keys(toClaudeBrowserMcpServer(server)).sort(),['args','command']);
 await assert.notEqual(server.args[1],(await readBrowserMcpConfig({appRoot,accessMode:'workspace-write',provider:'codex',conversationId:'codex-223e4567-e89b-42d3-a456-426614174000'})).args[1]);
});

test('browser MCP merge preserves K servers and refuses a name collision',()=>{
 const flash={enabled:false},luna={type:'http',url:'http://127.0.0.1:1/mcp'};
 const browser={command:'node',args:['cli.js','--user-data-dir=.runtime/browser-profiles/test']};
 assert.deepEqual(withBrowserMcp({k_flash:flash,k_luna:luna},browser),{k_flash:flash,k_luna:luna,k_browser:browser});
 assert.deepEqual(withBrowserMcp({k_flash:flash},null),{k_flash:flash});
 assert.throws(()=>withBrowserMcp({k_browser:browser},browser),/already in use/);
});

test('malformed and widened browser MCP settings fail closed',async()=>{
 const appRoot=await root();await mkdir(path.join(appRoot,'.runtime'));
 const setting=path.join(appRoot,'.runtime','browser-mcp.json');
 await writeFile(setting,'{"enabled":true,"args":["--user-data-dir=C:\\\\Users"]}');
 await assert.rejects(readBrowserMcpConfig({appRoot}),/exactly/);
 await writeFile(setting,'not json');
 await assert.rejects(readBrowserMcpConfig({appRoot}),/valid JSON/);
});
