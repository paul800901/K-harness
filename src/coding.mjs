import { mkdir, mkdtemp, open, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import { checkedPath, MAX_TEXT_BYTES } from './files.mjs';

// Trusted host configuration, never a model-supplied executable or shell command.
export function normalizeCoding(coding, readFiles, outputFiles) {
  if (coding == null) return null;
  const {editFiles}=coding;
  if(!Array.isArray(editFiles)||!editFiles.length||editFiles.some(name=>typeof name!=='string'))throw new Error('Coding requires non-empty editFiles.');
  const edits=[...new Set(editFiles)];
  if(!edits.every(name=>readFiles.includes(name)))throw new Error('Every editable file must also be an approved input.');
  if(edits.some(name=>outputFiles.includes(name)))throw new Error('Coding files cannot be new outputs.');
  return {editFiles:edits};
}

export async function createCodingTools(workspace, policy, readFiles, jobDirectory) {
  if (!policy) return [];
  const paths = new Map();
  for (const name of readFiles) paths.set(name, await checkedPath(workspace, name, false));
  for (const name of policy.editFiles) {
    if ((await lstat(paths.get(name))).nlink !== 1) throw new Error('Editing hard-linked files is not supported.');
  }
  return [{
    name: 'replace_code', label: 'Replace one exact approved code fragment',
    description: 'In an approved UTF-8 code file, replace the single exact occurrence of expectedText with newText. Read first; expectedText must be non-empty and unique. Other text stays unchanged. A durable full pre-edit backup is kept; no automatic rollback.',
    parameters: Type.Object({ path: Type.Union(policy.editFiles.map((name) => Type.Literal(name))), expectedText: Type.String(), newText: Type.String() }),
    executionMode: 'sequential',
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      if (!policy.editFiles.includes(args.path)) throw new Error('Code edit was not authorized.');
      if (!args.expectedText || args.expectedText === args.newText) throw new Error('No code change requested.');
      if (Buffer.byteLength(args.expectedText) > MAX_TEXT_BYTES || Buffer.byteLength(args.newText) > MAX_TEXT_BYTES) throw new Error('Code exceeds the text size limit.');
      const target = await checkedPath(workspace, args.path, false);
      const handle = await open(target, 'r+');
      try {
        const info = await handle.stat();
        if (info.nlink !== 1) throw new Error('Editing hard-linked files is not supported.');
        if (info.size > MAX_TEXT_BYTES) throw new Error('Code exceeds the text size limit.');
        const before = await handle.readFile();
        if (before.length > MAX_TEXT_BYTES) throw new Error('Code exceeds the text size limit.');
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before);
        const at = text.indexOf(args.expectedText);
        if (at < 0) throw new Error('expectedText is stale or absent; read it again before editing.');
        if (text.indexOf(args.expectedText, at + 1) >= 0) throw new Error('expectedText is ambiguous; include enough surrounding text to match once.');
        const after = Buffer.from(text.slice(0, at) + args.newText + text.slice(at + args.expectedText.length), 'utf8');
        if (after.length > MAX_TEXT_BYTES) throw new Error('Code exceeds the text size limit.');
        const backupRoot = path.join(jobDirectory, 'edits');
        await mkdir(backupRoot, { recursive: true });
        const backup = await mkdtemp(path.join(backupRoot, 'edit-'));
        const original = await open(path.join(backup, 'before.txt'), 'wx');
        try { await original.writeFile(before); await original.sync(); } finally { await original.close(); }
        await writeFile(path.join(backup, 'target.json'), JSON.stringify({ path: args.path }), { flag: 'wx' });
        signal?.throwIfAborted();
        // Recheck after backup I/O. The host must still provide exclusive workspace
        // ownership: this is not a cross-process lock or filesystem transaction.
        const currentTarget = await checkedPath(workspace, args.path, false);
        const currentInfo = await lstat(currentTarget);
        if (currentInfo.ino !== info.ino || currentInfo.dev !== info.dev || currentInfo.nlink !== 1 || currentInfo.size !== before.length || !(await readFile(currentTarget)).equals(before)) {
          throw new Error('Code changed during backup; no edit applied.');
        }
        signal?.throwIfAborted();
        let offset = 0;
        while (offset < after.length) {
          const { bytesWritten } = await handle.write(after, offset, after.length - offset, offset);
          if (!bytesWritten) throw new Error('Incomplete code write; inspect the backup before retrying.');
          offset += bytesWritten;
        }
        await handle.truncate(after.length);
        await handle.sync();
        return { content: [{ type: 'text', text: `Updated ${args.path}; previous content saved in ${path.relative(jobDirectory, backup)}.` }], details: { path: args.path, bytes: after.length, backup: path.relative(jobDirectory, backup) } };
      } finally { await handle.close(); }
    },
  }];
}
