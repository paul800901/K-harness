import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const credentialFile = fileURLToPath(new URL('../.env.local', import.meta.url));

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function checkedPath(root, name, isOutput) {
  if (typeof name !== 'string' || !name || path.isAbsolute(name) || /[:\0]/u.test(name)) {
    throw new Error('File names must be workspace-relative paths.');
  }
  const parts = name.split(/[\\/]/u);
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Empty path segments and dot segments are not allowed.');
  }
  const target = path.resolve(root, ...parts);
  if (path.relative(credentialFile, target) === '') {
    throw new Error('The K HARNESS credential file must never be a worker input or output.');
  }
  if (!inside(root, target)) throw new Error('File is outside the workspace.');
  let cursor = root;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const last = index === parts.length - 1;
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if (isOutput && last && error.code === 'ENOENT') return target;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed.');
    if (!last && !info.isDirectory()) throw new Error('The parent path is not a directory.');
    if (last && isOutput) throw new Error('Output already exists; this worker never overwrites files.');
    if (last && !info.isFile()) throw new Error('Input must be a regular file.');
  }
  const actual = await realpath(target);
  if (path.relative(credentialFile, actual) === '') {
    throw new Error('The K HARNESS credential file must never be a worker input or output.');
  }
  if (!inside(root, actual)) throw new Error('Resolved input is outside the workspace.');
  return actual;
}
