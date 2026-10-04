import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {geminiProjectMcp} from '../src/gemini-project-mcp.mjs';
import {geminiSettings,geminiMcpConfig} from '../src/gemini-worker.mjs';
async function fixture(){const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'project-mcp-'));await mkdir(path.join(root,'.runtime'));const workspace=path.join(root,'project');await mkdir(workspace);return {root,workspace,save:entries=>writeFile(path.join(root,'.runtime/gemini-mcp.json'),JSON.stringify(entries))};}
const server={command:'node',args:['owner-approved-test-server.mjs'],disabledTools:['dangerous'],customNativeOption:true};
test('owner MCP binding selects exact workspace, preserves native config, scopes grants by access mode',async()=>{
 const f=await fixture();assert.deepEqual(await geminiProjectMcp(f.root,f.workspace,'read-only'),{mcpServers:{},allow:[]});
 await writeFile(path.join(f.root,'not-a-folder'),'fixture');
 await f.save([{workspace:path.join(f.root,'not-a-folder/child'),mcpServers:{}},{workspace:f.workspace,mcpServers:{fixture:server},allowReadOnly:['mcp(fixture/read)'],allowWrite:['mcp(fixture/write)']}]);
 const ro=await geminiProjectMcp(f.root,f.workspace,'read-only'),rw=await geminiProjectMcp(f.root,f.workspace,'workspace-write');
 assert.deepEqual(ro.allow,['mcp(fixture/read)']);assert.deepEqual(rw.allow,['mcp(fixture/read)','mcp(fixture/write)']);assert.deepEqual(geminiMcpConfig(null,null,ro),{mcpServers:{fixture:server}});
 const settings=geminiSettings(f.workspace,'read-only',[],null,null,ro);assert.ok(settings.permissions.deny.includes('write_file(*)'));assert.ok(settings.permissions.deny.includes('command(*)'));assert.ok(settings.permissions.allow.includes('mcp(fixture/read)'));assert.ok(!settings.permissions.allow.includes('mcp(fixture/write)'));
 await mkdir(path.join(f.workspace,'nested'));assert.deepEqual(await geminiProjectMcp(f.root,path.join(f.workspace,'nested'),'workspace-write'),{mcpServers:{},allow:[]});
 assert.deepEqual(await geminiProjectMcp(f.root,f.root,'workspace-write'),{mcpServers:{},allow:[]});
});
test('K binding loader ignores project files; owner config cannot override K tools or grant commands',async()=>{
 const f=await fixture();await mkdir(path.join(f.workspace,'.agents'));await writeFile(path.join(f.workspace,'.agents/mcp_config.json'),JSON.stringify({mcpServers:{rogue:server}}));
 assert.deepEqual(await geminiProjectMcp(f.root,f.workspace,'workspace-write'),{mcpServers:{},allow:[]});
 for(const binding of [
  {mcpServers:{k_browser:server}},
  {mcpServers:{k_google_ops:server}},
  {mcpServers:{fixture:server},allowReadOnly:['command(*)']},
  {mcpServers:{fixture:server},allowReadOnly:['mcp(other/*)']},
 ]){await f.save([{workspace:f.workspace,...binding}]);await assert.rejects(geminiProjectMcp(f.root,f.workspace,'workspace-write'));}
 const duplicate={workspace:f.workspace,mcpServers:{fixture:server}};await f.save([duplicate,duplicate]);await assert.rejects(geminiProjectMcp(f.root,f.workspace,'read-only'),/重複/);
 await writeFile(path.join(f.root,'.runtime/gemini-mcp.json'),'{secret-canary-invalid');await assert.rejects(geminiProjectMcp(f.root,f.workspace,'read-only'),e=>!e.message.includes('secret-canary'));
});
