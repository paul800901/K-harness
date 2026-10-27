import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {atomicWrite} from './atomic-write.mjs';

const defaults = () => ({layout: 'grouped', sort: 'manual', order: []});
const validIds = value =>
  Array.isArray(value) &&
  value.length <= 50000 &&
  value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 300);
function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('側欄排序資料無效。');
  if (data.layout !== undefined && !['grouped', 'flat'].includes(data.layout)) throw Error('側欄分組方式無效。');
  if (data.sort !== undefined && !['manual', 'recent'].includes(data.sort)) throw Error('側欄排序方式無效。');
  for (const key of ['order', 'append'])
    if (data[key] !== undefined && !validIds(data[key])) throw Error('側欄對話順序無效。');
}

// One private setting for every screen connected to this K. Only explicit edits replace order;
// discovering new rooms appends IDs, so a stale screen cannot undo an existing arrangement.
export async function createSidebarPreferences(root) {
  const file = path.join(root, '.runtime', 'sidebar-preferences.json');
  let value = null,
    error = null,
    pending = Promise.resolve();
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    validate(saved);
    if (saved.layout === undefined || saved.sort === undefined || saved.order === undefined)
      throw Error('Incomplete sidebar preferences');
    value = {layout: saved.layout, sort: saved.sort, order: [...new Set(saved.order)]};
  } catch (cause) {
    if (cause.code !== 'ENOENT') error = '側欄排序無法讀取，原檔已保留；目前未同步排序。';
  }
  return {
    get value() {
      return value;
    },
    get error() {
      return error;
    },
    update(data) {
      const task = pending
        .catch(() => {})
        .then(async () => {
          if (error) throw Error(error);
          validate(data);
          if (data.initialize && value) return value;
          // A phone's discovered rooms must not win the first migration over the desktop's saved order.
          if (!value && data.append !== undefined) return null;
          const next = {...(value ?? defaults())};
          for (const key of ['layout', 'sort', 'order']) if (data[key] !== undefined) next[key] = data[key];
          next.order = [...new Set([...next.order, ...(data.append ?? [])])];
          if (JSON.stringify(next) === JSON.stringify(value)) return value;
          await atomicWrite(file, JSON.stringify(next, null, 2));
          value = next;
          return value;
        });
      pending = task;
      return task;
    }
  };
}
