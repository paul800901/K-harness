import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';

// Owner-installed bindings, not instructions or permissions read from the task's files.
// Transport definitions retain agy's native schema; K only selects the workspace and grants.
export async function geminiProjectMcp(root,workspace,accessMode){
 let entries;
 try{entries=JSON.parse(await readFile(path.join(root,'.runtime/gemini-mcp.json'),'utf8'));}
 catch(error){if(error.code==='ENOENT')return {mcpServers:{},allow:[]};throw Error('Gemini 專案工具設定無法讀取；未啟動工具。');}
 if(!Array.isArray(entries))throw Error('Gemini 專案工具設定須為工作區清單。');
 const target=await realpath(workspace),matches=[];
 for(const entry of entries){
  if(!path.isAbsolute(entry?.workspace??''))throw Error('Gemini 專案工具設定需要完整工作區路徑。');
  let canonical;
  try{canonical=await realpath(entry.workspace);}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))continue;throw error;}
  if(canonical===target)matches.push(entry);
 }
 if(matches.length>1)throw Error('同一工作區有重複 Gemini 工具設定，請合併後再使用。');
 if(!matches.length)return {mcpServers:{},allow:[]};
 const {mcpServers,allowReadOnly=[],allowWrite=[]}=matches[0];
 if(!mcpServers||typeof mcpServers!=='object'||Array.isArray(mcpServers))throw Error('Gemini 工具缺少原生 mcpServers 設定。');
 for(const [name,server] of Object.entries(mcpServers)){
  if(!/^[\w-]+$/u.test(name)||['k_browser','k_google_ops'].includes(name)||!server||typeof server!=='object'||Array.isArray(server))throw Error('Gemini 專案工具名稱或定義無效；不能取代 K 內建工具。');
 }
 for(const rules of [allowReadOnly,allowWrite]){
  if(!Array.isArray(rules)||rules.some(rule=>typeof rule!=='string'||!/^mcp\(([\w-]+)\/[^()]+\)$/u.test(rule)||!Object.hasOwn(mcpServers,rule.match(/^mcp\(([\w-]+)\//u)[1])))throw Error('Gemini 工具許可只能指定本工作區已登記的 MCP 工具。');
 }
 return {mcpServers,allow:[...new Set([...allowReadOnly,...(accessMode==='read-only'?[]:allowWrite)])]};
}
