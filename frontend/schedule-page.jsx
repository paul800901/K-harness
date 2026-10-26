import React, {useState, useEffect} from 'react';
import {PanelLeft} from 'lucide-react';
import {api, IconButton} from './app-common.jsx';
import './schedule-page.css';

const WEEKDAYS = '日一二三四五六';
const pad = n => String(n).padStart(2, '0');
const when = (iso, withYear = false) => {
  const d = new Date(iso);
  return `${withYear ? `${d.getFullYear()}/` : ''}${pad(d.getMonth() + 1)}/${pad(d.getDate())}（${WEEKDAYS[d.getDay()]}）${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const STATUS = {
  sent: '已送出',
  queued: '已排入待送',
  failed: '未送出',
  uncertain: '狀態不明（未重送）',
  sending: '送出中'
};

export function SchedulePage({scheduleRevision, sessions, onOpenSession, sidebar, setSidebar, mobile, setInspector}) {
  const [schedules, setSchedules] = useState(null),
    [error, setError] = useState(''),
    [expandedId, setExpandedId] = useState(null),
    [confirmId, setConfirmId] = useState(null),
    [busy, setBusy] = useState(false);

  const load = () =>
    api('schedules').then(
      r => {
        setSchedules(r.schedules);
        setError('');
      },
      e => setError(e.message)
    );
  useEffect(() => void load(), [scheduleRevision]);

  const act = async (route, data) => {
    setBusy(true);
    try {
      await api(route, data);
      setConfirmId(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const list = schedules ?? [],
    byNext = (a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? ''),
    groups = [
      {key: 'active', label: '使用中', items: list.filter(s => !s.paused && !s.done).sort(byNext)},
      {key: 'paused', label: '已暫停', items: list.filter(s => s.paused && !s.done).sort(byNext)},
      {
        key: 'done',
        label: '已結束',
        items: list.filter(s => s.done).sort((a, b) => (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? ''))
      }
    ].filter(g => g.items.length);

  const row = (s, group) => {
    const expanded = expandedId === s.id,
      target = sessions.find(x => x.threadId === s.threadId && !x.archived),
      last = `${STATUS[s.lastStatus] ?? '尚未執行'}${s.lastRunAt ? `（${when(s.lastRunAt)}）` : ''}`;
    return (
      <li key={s.id} className={`schedule-item${expanded ? ' expanded' : ''}`}>
        <button
          className="schedule-item-header"
          aria-expanded={expanded}
          onClick={() => {
            setConfirmId(null);
            setExpandedId(expanded ? null : s.id);
          }}
        >
          <span className="schedule-item-title">{s.title}</span>
          <span className="schedule-item-meta">
            <span>送進：{s.targetTitle?.trim() || '（聊天室已不存在或未命名）'}</span>
            {group === 'active' && <span>下次：{when(s.nextRunAt)}</span>}
            <span>上次：{last}</span>
          </span>
          {['failed', 'uncertain'].includes(s.lastStatus) && s.lastError && (
            <span className="schedule-item-error">原因：{s.lastError}</span>
          )}
        </button>
        {expanded && (
          <div className="schedule-item-details">
            <div className="schedule-text-label">指示內容</div>
            <div className="schedule-text-box">{s.text}</div>
            {s.upcoming.length > 0 && (
              <>
                <div className="schedule-text-label">接下來</div>
                <ul className="schedule-upcoming-list">
                  {s.upcoming.map(t => (
                    <li key={t}>{when(t)}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="schedule-created-at">建立時間：{when(s.createdAt, true)}</div>
            {confirmId === s.id ? (
              <div className="schedule-delete-confirm">
                <span>確定要刪除排程「{s.title}」？</span>
                <div className="modal-actions">
                  <button autoFocus disabled={busy} onClick={() => setConfirmId(null)}>
                    取消
                  </button>
                  <button
                    className="danger-button archive-delete-button"
                    disabled={busy}
                    onClick={() => act('schedules/remove', {id: s.id})}
                  >
                    確認刪除
                  </button>
                </div>
              </div>
            ) : (
              <div className="schedule-actions">
                <button
                  disabled={!target}
                  title={target ? '開啟所屬聊天室' : '所屬聊天室已不存在或已封存'}
                  onClick={() => onOpenSession(target)}
                >
                  開啟聊天室
                </button>
                {!s.done && (
                  <button disabled={busy} onClick={() => act('schedules/update', {id: s.id, paused: !s.paused})}>
                    {s.paused ? '恢復' : '暫停'}
                  </button>
                )}
                <button disabled={busy} onClick={() => setConfirmId(s.id)}>
                  刪除
                </button>
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="schedule-page">
      <header className="schedule-page-header">
        {!sidebar && (
          <IconButton
            title="展開側欄"
            onClick={() => {
              setSidebar(true);
              if (mobile) setInspector(false);
            }}
          >
            <PanelLeft size={18} />
          </IconButton>
        )}
        <h1>排程</h1>
      </header>
      <div className="schedule-page-scroll">
        <div className="schedule-page-content">
          {error && (
            <div className="schedule-error-alert" role="alert">
              {error}
            </div>
          )}
          {schedules?.length === 0 && (
            <div className="schedule-empty">目前沒有排程。在聊天室跟 AI 說要定時做什麼，排程就會出現在這裡。</div>
          )}
          {groups.map(g => (
            <section key={g.key} className="schedule-section">
              <h3 className="schedule-section-title">{g.label}</h3>
              <ul className="schedule-list">{g.items.map(s => row(s, g.key))}</ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
