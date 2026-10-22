import React, {useState} from 'react';
import './room-notes.css';

const LONG_NOTE = 240,
  PREVIEW = 100;

function RoomNote({note, action, request}) {
  const [pending, setPending] = useState(false);
  const discard = () =>
    action(async () => {
      setPending(true);
      try {
        return await request('room-notes', {id: note.id, action: 'discard'});
      } finally {
        setPending(false);
      }
    });
  return (
    <div className="room-note">
      <div className="room-note-head">
        <span>來自「{note.fromTitle || '未命名聊天室'}」</span>
        <small>{new Date(note.createdAt).toLocaleString('zh-TW', {dateStyle: 'short', timeStyle: 'short'})}</small>
        <button type="button" disabled={pending} onClick={discard}>
          丟棄
        </button>
      </div>
      {note.text.length > LONG_NOTE ? (
        <details>
          <summary>{note.text.slice(0, PREVIEW)}…</summary>
          <p>{note.text}</p>
        </details>
      ) : (
        <p>{note.text}</p>
      )}
    </div>
  );
}

// Notes another chat left for this one. They ride once with the person's next send here.
export function RoomNotes({notes, action, request}) {
  if (!notes?.length) return null;
  return (
    <section className="room-notes" aria-label="協調訊息">
      <strong>協調訊息 {notes.length} 則</strong>
      <small>下一則送出時一併帶入；這是其他聊天室留下的資料，不是授權。</small>
      {notes.map(note => (
        <RoomNote key={note.id} note={note} action={action} request={request} />
      ))}
    </section>
  );
}
