import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeWorkspacePath, validateWorkspace} from './workspaces.mjs';

const key = value => path.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
const pending = new Map();

async function readProjects(root) {
  try {
    const list = JSON.parse(await readFile(path.join(root, '.runtime/projects.json'), 'utf8'));
    if (!Array.isArray(list)) throw new Error('Invalid projects');
    return list.map(item => {
      const project = typeof item === 'string' ? {path:item} : item;
      const folder = normalizeWorkspacePath(project?.path);
      if (project.name !== undefined && (typeof project.name !== 'string' || !project.name.trim())) throw new Error('Invalid name');
      for (const field of ['pinned','archived']) if (project[field] !== undefined && typeof project[field] !== 'boolean') throw new Error('Invalid state');
      return {...project,path:folder};
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('專案清單無法讀取，原檔已保留。');
  }
}

// Only saved paths and conversation metadata; no recursive directory scan.
export async function listProjects(root, sessions = []) {
  const projects = new Map();
  for (const item of [{path:root}, ...await readProjects(root), ...sessions.map(s => ({path:s.workspace}))]) {
    const normalized = normalizeWorkspacePath(item.path);
    const previous = projects.get(key(normalized));
    projects.set(key(normalized), {path:normalized,name:path.basename(normalized),...previous,...item});
  }
  return {projects:[...projects.values()]};
}

// Serialize additions in this local server so two browser tabs cannot lose an add.
export async function addProject(root, candidate) {
  const folder = await validateWorkspace(candidate);
  const operation = (pending.get(root) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const projects = await readProjects(root);
    if (!projects.some(p => key(p.path) === key(folder))) {
      projects.push({path:folder});
      const directory = path.join(root, '.runtime');
      await mkdir(directory, {recursive:true});
      const temporary = path.join(directory, `projects-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(projects.map(p => Object.keys(p).length === 1 ? p.path : p), null, 2), {flag:'wx'});
      await rename(temporary, path.join(directory, 'projects.json'));
    }
    return {path:folder, name:path.basename(folder)};
  });
  pending.set(root, operation);
  try { return await operation; }
  finally { if (pending.get(root) === operation) pending.delete(root); }
}

// Display metadata only: never rename folders or alter conversation records.
export async function updateProject(root, data, sessions = []) {
  const folder = normalizeWorkspacePath(data.path);
  const patch = {};
  if (data.name !== undefined) {
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 200) throw new Error('專案名稱需為 1 至 200 字。');
    patch.name = data.name.trim();
  }
  for (const field of ['pinned','archived']) if (data[field] !== undefined) {
    if (typeof data[field] !== 'boolean') throw new Error('專案狀態無效。');
    patch[field] = data[field];
  }
  if (!Object.keys(patch).length) throw new Error('未指定專案變更。');
  const operation = (pending.get(root) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const known = (await listProjects(root,sessions)).projects.find(p => key(p.path) === key(folder));
    if (!known) throw new Error('找不到專案。');
    const projects = await readProjects(root);
    const index = projects.findIndex(p => key(p.path) === key(folder));
    const updated = {...(index < 0 ? {path:known.path} : projects[index]),...patch};
    if (index < 0) projects.push(updated); else projects[index] = updated;
    const directory = path.join(root,'.runtime');
    await mkdir(directory,{recursive:true});
    const temporary = path.join(directory,`projects-${randomUUID()}.tmp`);
    await writeFile(temporary,JSON.stringify(projects.map(p => Object.keys(p).length === 1 ? p.path : p),null,2),{flag:'wx'});
    await rename(temporary,path.join(directory,'projects.json'));
    return {...known,...patch};
  });
  pending.set(root,operation);
  try { return await operation; }
  finally { if (pending.get(root) === operation) pending.delete(root); }
}
