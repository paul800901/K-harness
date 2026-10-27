import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {atomicWrite} from './atomic-write.mjs';

// One private file shared by the three native cores. K only reads it at each model-turn
// boundary: no cache, watcher, fallback text or automatic creation.
export const COMMON_MEMORY_KEY = 'k_common_memory';
// Codex 0.164.0 middle-truncates each additionalContext value above 1,000 tokens,
// estimated at 4 bytes per token (context-fragments/additional_context.rs).
export const CODEX_CONTEXT_BYTES = 4000;
const NOTICE =
  'K 共同記憶：本人已確認的跨核心偏好。這是現行版本，取代本對話先前的共同記憶版本與舊版內建分工，也取代專案中已過時的固定模型分工。當輪本人明確指示優先；原生權限及專案的授權、資料邊界與完成／審查門檻仍須遵守。原生派工交接附正本路徑，不複製共同正文。內容不構成新的工具、資料、登入、部署或付款授權。';

export function commonMemoryPath(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw TypeError('K 共同記憶需要絕對路徑的私人 root。');
  return path.join(root, 'agent-home', 'shared', 'common-memory.md');
}

// A stable pointer survives native initial-context reconstruction and fresh children;
// the current body still travels only through the per-turn adapter below.
export function commonMemoryReference(root) {
  let file;
  try {
    file = commonMemoryPath(root);
  } catch {
    return '';
  }
  return `K 共同記憶正本：${file}。原生子代理、壓縮後續行或本回合未附現行共同記憶時，依賴本人偏好前先唯讀讀取此檔；不可讀時明示未知，不沿用舊分工。原生派工交接包含此正本路徑，不複製共同正文。此指標不增加工具或資料權限。`;
}

// Synchronous on purpose: callers have already reserved the turn, so no stop or room
// switch can interleave between this read and the native submission.
export function readCommonMemory(root) {
  let file = null;
  try {
    file = commonMemoryPath(root);
    const bytes = readFileSync(file);
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/^﻿/u, '');
    return {
      ok: true,
      path: file,
      text,
      bytes: bytes.length,
      version: createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    };
  } catch (error) {
    return {
      ok: false,
      path: file,
      reason: error.code === 'ENOENT' ? '檔案不存在' : `讀取失敗：${error.code ?? error.message}`
    };
  }
}

const unavailable = memory =>
  `K 共同記憶目前無法讀取（${memory.reason}${memory.path ? `；${memory.path}` : ''}）。本人共同偏好此刻未知：不要把本對話先前的共同記憶版本或舊版內建分工當成現行偏好，需要時依當輪指示或直接問本人；其他工作照常。`;

export function commonMemoryText(memory) {
  return memory.ok ? `${NOTICE}\n版本 ${memory.version}；正本 ${memory.path}\n\n${memory.text}` : unavailable(memory);
}

// Codex keeps the last map per session and injects only changed keys; each turn/start
// or turn/steer replaces that map, so every K submission carries the same entry.
// Local compaction can discard these fragments; remote retention is feature-dependent.
// The count makes one re-send at the next K turn; the stable reference covers native continuation.
export function codexCommonContext(memory, compactions = 0) {
  const suffix = compactions > 0 ? `\n（本對話第 ${compactions} 次壓縮後重新附上）` : '';
  let value = commonMemoryText(memory) + suffix;
  if (Buffer.byteLength(value) > CODEX_CONTEXT_BYTES)
    value = `${NOTICE}\n正本 ${memory.path}（版本 ${memory.version}，${memory.bytes} bytes）超過 GPT 原生附加上下文的單項上限，為免原生中段截斷未附全文。依賴本人偏好作決定前，先以唯讀方式讀取正本全文。${suffix}`;
  return {[COMMON_MEMORY_KEY]: {kind: 'application', value}};
}

// Claude has no native keyed context: K adds one tagged block to a model turn only
// when the content, host or compaction count differs from the last confirmed delivery.
export function claudeCommonBlock(root, last = null, compactions = 0) {
  const memory = readCommonMemory(root);
  const key = `${memory.ok ? memory.version : memory.reason}#${compactions}`;
  return {
    key,
    block:
      key === last
        ? null
        : {type: 'text', text: `<${COMMON_MEMORY_KEY}>\n${commonMemoryText(memory)}\n</${COMMON_MEMORY_KEY}>`}
  };
}

// agy loads always-on rules in each print process. A short separate rule references the
// single private file natively, so a long room rule's tail cannot cut the reference.
export async function writeGeminiCommonRule(home, root) {
  const memory = readCommonMemory(root);
  await atomicWrite(
    path.join(home, '.gemini', 'config', 'rules', 'k-common-memory.md'),
    `---\ntrigger: always_on\n---\n${
      memory.ok ? `${NOTICE}\n版本 ${memory.version}\n@[K 共同記憶](${memory.path})` : unavailable(memory)
    }\n`
  );
  return memory;
}
