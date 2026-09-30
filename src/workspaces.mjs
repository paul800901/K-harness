import { lstat, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';


function samePath(left, right) {
  return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
}

function isFilesystemRoot(candidate) {
  return samePath(candidate, path.parse(candidate).root);
}

function homeDirectories() {
  const homes = new Set([path.normalize(os.homedir())]);
  for (const value of [process.env.USERPROFILE, process.env.HOME]) {
    if (typeof value === 'string' && value) homes.add(path.normalize(value));
  }
  return homes;
}

/**
 * Normalize a stored or selected workspace path without reading its contents.
 * Existence/type checks belong to validateWorkspace; this helper is also used
 * when reading old session records whose workspace may no longer exist.
 */
export function normalizeWorkspacePath(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim() || !path.isAbsolute(candidate)) {
    throw new Error('工作區必須是絕對資料夾路徑。');
  }
  const normalized = path.normalize(candidate);
  if (isFilesystemRoot(normalized) || [...homeDirectories()].some(home => samePath(normalized, home))) {
    throw new Error('不能選取磁碟根目錄或 HOME 作為工作區。');
  }
  return normalized;
}

/**
 * Validate one selected workspace and return its canonical absolute path.
 * This reads only filesystem metadata; it does not enumerate or inspect files.
 */
export async function validateWorkspace(candidate, { defaultWorkspace } = {}) {
  const requested = candidate === undefined ? defaultWorkspace : candidate;
  const normalized = normalizeWorkspacePath(requested);
  let canonical;
  try {
    canonical = await realpath(normalized);
    const info = await lstat(canonical);
    if (!info.isDirectory()) throw new Error('工作區必須是資料夾。');
  } catch (error) {
    if (error?.message === '工作區必須是資料夾。') throw error;
    throw new Error('工作區不存在或無法讀取。');
  }
  return normalizeWorkspacePath(canonical);
}

/**
 * List immediate child folders for a picker. The parent itself may be a drive
 * root so users can browse; only validateWorkspace rejects roots as selections.
 */
export async function listWorkspaceDirectories(parent) {
  if (typeof parent !== 'string' || !parent.trim() || !path.isAbsolute(parent)) {
    throw new Error('瀏覽位置必須是絕對資料夾路徑。');
  }
  let base;
  try {
    base = await realpath(path.normalize(parent));
    const info = await lstat(base);
    if (!info.isDirectory()) throw new Error('瀏覽位置必須是資料夾。');
  } catch (error) {
    if (error?.message === '瀏覽位置必須是資料夾。') throw error;
    throw new Error('瀏覽位置不存在或無法讀取。');
  }
  const entries = await readdir(base, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
    .map(entry => ({ name: entry.name, path: path.join(base, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
