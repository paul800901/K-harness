import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {atomicWrite} from './atomic-write.mjs';
import {formatRoomNotes} from '../shared/room-notes.mjs';

export const MAX_ROOM_NOTE_LENGTH = 4000;
export const MAX_PENDING_ROOM_NOTES = 20;
const MAX_SEND_LENGTH = 32000,
  KEEP_SETTLED = 100;

// One inbox file per target room. K owns a note only until it rides with a human send;
// once handed to the native core it is consumed and never sent again.
export function createRoomNotes({root, onChange = () => {}}) {
  const rows = new Map(),
    chains = new Map(),
    // Claimed notes that may still be restored keep their slots until commit; memory only, so a
    // restart frees them while consumed rows stay consumed.
    claimed = new Map();
  const file = id => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id ?? '')) throw Error('Invalid room note conversation.');
    return path.join(root, '.runtime/room-notes', id + '.json');
  };
  // Serialize each room's read-modify-write so concurrent notes and sends cannot lose an update.
  const locked = (id, task) => {
    file(id);
    const next = (chains.get(id) ?? Promise.resolve()).catch(() => {}).then(task);
    chains.set(id, next);
    return next.finally(() => {
      if (chains.get(id) === next) chains.delete(id);
    });
  };
  const read = async id => {
    if (rows.has(id)) return rows.get(id);
    let list = [];
    try {
      list = JSON.parse(await readFile(file(id), 'utf8')).notes ?? [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    rows.set(id, list);
    return list;
  };
  const save = async id => {
    let list = rows.get(id);
    const settled = list.filter(n => n.status !== 'pending');
    if (settled.length > KEEP_SETTLED) {
      const drop = new Set(settled.slice(0, settled.length - KEEP_SETTLED));
      list = list.filter(n => !drop.has(n));
      rows.set(id, list);
    }
    await atomicWrite(file(id), JSON.stringify({notes: list}));
  };
  const view = n => ({
    id: n.id,
    fromThreadId: n.fromThreadId,
    fromTitle: n.fromTitle,
    fromProvider: n.fromProvider,
    text: n.text,
    createdAt: n.createdAt
  });
  const api = {
    load: id => (id ? locked(id, () => read(id)).then(() => {}) : Promise.resolve()),
    // Synchronous projection for the state stream; rooms not loaded yet show nothing.
    pending: id => (rows.get(id) ?? []).filter(n => n.status === 'pending').map(view),
    count: id => locked(id, async () => (await read(id)).filter(n => n.status === 'pending').length),
    async add(id, {fromThreadId, fromTitle, fromProvider, text}) {
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_ROOM_NOTE_LENGTH)
        throw Error(`協調訊息須為 1–${MAX_ROOM_NOTE_LENGTH} 字元。`);
      return locked(id, async () => {
        const list = await read(id);
        if (list.filter(n => n.status === 'pending').length + (claimed.get(id) ?? 0) >= MAX_PENDING_ROOM_NOTES)
          throw Error(`目標聊天室已有 ${MAX_PENDING_ROOM_NOTES} 則未帶入的協調訊息；未寫入，請等本人處理。`);
        const note = {
          id: randomUUID(),
          fromThreadId,
          fromTitle: fromTitle ?? '',
          fromProvider: fromProvider ?? null,
          text,
          createdAt: new Date().toISOString(),
          status: 'pending',
          consumedAt: null,
          consumedMessageId: null
        };
        list.push(note);
        try {
          await save(id);
        } catch (error) {
          list.splice(list.indexOf(note), 1);
          throw error;
        }
        onChange();
        return view(note);
      });
    },
    discard(id, noteId) {
      return locked(id, async () => {
        const note = (await read(id)).find(n => n.id === noteId);
        if (!note || note.status !== 'pending') throw Error('找不到未帶入的協調訊息，可能已送出或丟棄。');
        note.status = 'discarded';
        try {
          await save(id);
        } catch (error) {
          note.status = 'pending';
          throw error;
        }
        onChange();
        return {discarded: true};
      });
    },
    // Marks the oldest pending notes that fit in one native send as consumed before the send.
    // restore() is only for a send that never reached the native core; commit() records the message.
    claim(id, text = '') {
      return locked(id, async () => {
        const chosen = [];
        for (const note of (await read(id)).filter(n => n.status === 'pending')) {
          if (formatRoomNotes(text, [...chosen, note]).length > MAX_SEND_LENGTH) break;
          chosen.push(note);
        }
        if (!chosen.length) return null;
        const consumedAt = new Date().toISOString();
        for (const note of chosen) Object.assign(note, {status: 'consumed', consumedAt});
        try {
          await save(id);
        } catch (error) {
          for (const note of chosen) Object.assign(note, {status: 'pending', consumedAt: null});
          throw error;
        }
        claimed.set(id, (claimed.get(id) ?? 0) + chosen.length);
        let open = true;
        const settle = () => {
          if (!open) return;
          open = false;
          const left = claimed.get(id) - chosen.length;
          if (left > 0) claimed.set(id, left);
          else claimed.delete(id);
        };
        onChange();
        return {
          text: formatRoomNotes(text, chosen),
          count: chosen.length,
          restore: () =>
            locked(id, async () => {
              if (!open) return;
              // Settle only after disk says pending; a failed write keeps memory consumed and the claim
              // open, so a retry really writes pending instead of returning early.
              for (const note of chosen) Object.assign(note, {status: 'pending', consumedAt: null});
              try {
                await save(id);
              } catch (error) {
                for (const note of chosen) Object.assign(note, {status: 'consumed', consumedAt});
                throw error;
              }
              settle();
              onChange();
            }),
          commit: messageId =>
            locked(id, async () => {
              if (!open) return;
              settle();
              for (const note of chosen) note.consumedMessageId = messageId ?? null;
              await save(id);
            })
        };
      });
    }
  };
  return api;
}
