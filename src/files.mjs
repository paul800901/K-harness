import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from '@earendil-works/pi-ai';

export const MAX_TEXT_BYTES = 256 * 1024;
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
  if (!inside(root, actual)) throw new Error('Resolved input is outside the workspace.');
  return actual;
}

export async function createFileTools(workspace, readFiles = [], outputFiles = []) {
  if (!path.isAbsolute(workspace)) throw new Error('workspace must be an absolute directory.');
  const root = await realpath(workspace);
  if (!(await lstat(root)).isDirectory()) throw new Error('workspace must be a directory.');
  if (!Array.isArray(readFiles) || !Array.isArray(outputFiles)) throw new Error('File allowlists must be arrays.');
  const reads = [...new Set(readFiles)];
  const outputs = [...new Set(outputFiles)];
  for (const name of reads) await checkedPath(root, name, false);
  for (const name of outputs) await checkedPath(root, name, true);
  const tools = [];
  if (reads.length) {
    tools.push({
      name: 'read_input',
      label: 'Read an approved input',
      description: `Read one explicitly approved UTF-8 input, at most ${MAX_TEXT_BYTES} bytes. No directory browsing.`,
      parameters: Type.Object({ path: Type.Union(reads.map((name) => Type.Literal(name))) }),
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        if (!reads.includes(args.path)) throw new Error('Input was not authorized.');
        const target = await checkedPath(root, args.path, false);
        const handle = await open(target, 'r');
        try {
          if ((await handle.stat()).size > MAX_TEXT_BYTES) throw new Error('Input exceeds the text size limit.');
          const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
          let size = 0;
          while (size < buffer.length) {
            const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
            if (!bytesRead) break;
            size += bytesRead;
          }
          if (size > MAX_TEXT_BYTES) throw new Error('Input exceeds the text size limit.');
          signal?.throwIfAborted();
          return { content: [{ type: 'text', text: buffer.subarray(0, size).toString('utf8') }], details: { path: args.path, bytes: size } };
        } finally {
          await handle.close();
        }
      },
    });
  }
  if (outputs.length) {
    tools.push({
      name: 'write_output',
      label: 'Create an approved output',
      description: `Create one approved UTF-8 output, at most ${MAX_TEXT_BYTES} bytes. Never overwrite an existing file.`,
      parameters: Type.Object({ path: Type.Union(outputs.map((name) => Type.Literal(name))), text: Type.String() }),
      executionMode: 'sequential',
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        if (!outputs.includes(args.path)) throw new Error('Output was not authorized.');
        const size = Buffer.byteLength(args.text, 'utf8');
        if (size > MAX_TEXT_BYTES) throw new Error('Output exceeds the text size limit.');
        const target = await checkedPath(root, args.path, true);
        signal?.throwIfAborted();
        const handle = await open(target, 'wx');
        try {
          await handle.writeFile(args.text, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        // Do not report an already-completed write as undone if cancellation arrives now.
        return { content: [{ type: 'text', text: `Created ${args.path} (${size} bytes).` }], details: { path: args.path, bytes: size } };
      },
    });
  }
  return { workspace: root, tools, readFiles: reads, outputFiles: outputs };
}
