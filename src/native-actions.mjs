import path from 'node:path';

const MAX_QUERY_LENGTH = 256;

export function validateNativeReviewRequest({confirmed}={}) {
  if (confirmed !== true) throw new Error('請先明確確認要審查目前 Codex 工作區變更。');
  return {target:{type:'uncommittedChanges'},delivery:'inline'};
}

export function normalizeFileSearchQuery({query}={}) {
  if (typeof query !== 'string') throw new Error('檔案搜尋文字無效。');
  const normalized=query.trim();
  if (!normalized || normalized.length > MAX_QUERY_LENGTH) throw new Error('檔案搜尋文字不可為空或超過 256 個字元。');
  return normalized;
}

function samePath(a,b) {
  const resolve = process.platform === 'win32' ? path.win32.resolve : path.resolve;
  const normalize = value => resolve(value).replace(/[\\/]+$/,'').toLocaleLowerCase('en-US');
  return normalize(a)===normalize(b);
}

function workspaceRelative(workspace, root, candidate) {
  if (typeof root !== 'string' || typeof candidate !== 'string' || !candidate) return null;
  if (!samePath(root,workspace)) return null;
  const impl=process.platform==='win32'?path.win32:path;
  const absolute=impl.isAbsolute(candidate)?impl.resolve(candidate):impl.resolve(workspace,candidate);
  const relative=impl.relative(impl.resolve(workspace),absolute);
  if (!relative || relative==='.' || relative==='..' || relative.startsWith(`..${impl.sep}`) || impl.isAbsolute(relative)) return null;
  return relative.split(/[\\/]/).join('/');
}

export function normalizeNativeFileSearchResults(response, workspace) {
  const files=Array.isArray(response?.files)?response.files:[];
  const result=[]; const seen=new Set();
  for (const file of files) {
    const relative=workspaceRelative(workspace,file?.root,file?.path);
    if (!relative || !['file','directory'].includes(file?.match_type) || seen.has(relative.toLocaleLowerCase('en-US'))) continue;
    seen.add(relative.toLocaleLowerCase('en-US'));
    result.push({path:relative,fileName:String(file.file_name??''),matchType:file.match_type,score:Number.isFinite(file.score)?file.score:0,...(Array.isArray(file.indices)?{indices:file.indices.filter(Number.isInteger)}:{})});
  }
  return result;
}

export function assertNativeActionAvailable({provider,changing,sending,queued,busy,questions,workspace}={}) {
  if (provider !== 'codex') throw new Error('此原生 Codex 功能目前不支援 Claude 對話。');
  if (changing || sending || (queued ?? 0) > 0 || busy || (questions?.length ?? 0)) throw new Error('目前工作、待送訊息或核准尚未結束，請稍後再操作。');
  if (typeof workspace !== 'string' || !workspace) throw new Error('請先選擇工作區。');
}
