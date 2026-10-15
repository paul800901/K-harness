import React, {useMemo, useState, useRef, useLayoutEffect} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {discussionModes, discussionStatus} from '../shared/discussion.mjs';
import {discussionRuns, roundtableData} from './discussion-roundtable-data.mjs';
import './discussion-roundtable.css';
const seatColor = i =>
  [
    'var(--k-discussion-gpt)',
    'var(--k-discussion-claude)',
    'var(--k-discussion-gemini)',
    'var(--k-ok)',
    'var(--k-brass)',
    'var(--k-danger)'
  ][i % 6];

function InterjectionRows({messages, run}) {
  return messages.map(m => {
    const processedRound = run.interjections?.find(e => e.messageId === m.id)?.processedRound;
    return (
      <tr key={m.id}>
        <td colSpan={(run.participants?.length ?? 0) + 1} className="discussion-roundtable-interjection">
          <strong>
            插話
            {m.target && m.target !== 'all'
              ? ` → ${run.participants.find(p => p.id === m.target)?.displayName ?? m.target}`
              : ''}
            ：
          </strong>
          {m.text}
          <small>{processedRound ? `已由第 ${processedRound} 批處理` : '等待處理／舊紀錄未記錄'}</small>
        </td>
      </tr>
    );
  });
}

export function DiscussionEntry({record, state, onOpen}) {
  const run = discussionRuns(state.discussion, state.messages).find(r => r.id === record.runId);
  const data = useMemo(() => roundtableData(run, state.messages), [run, state.messages]);
  if (state.messages.find(m => m.kind === 'discussion' && m.runId === record.runId)?.id !== record.id) return null;
  return (
    <section className="discussion-roundtable-entry" aria-label="討論入口">
      <strong>{run?.question ?? '多模型討論'}</strong>
      <p>
        {discussionModes[run?.mode] ?? '歷史討論'} · {run?.participants?.length ?? 0} 人 ·{' '}
        {data.inferred ? '推估 ' : ''}第 {data.last} 批 · {discussionStatus[run?.status] ?? '歷史紀錄'}
      </p>
      <button onClick={() => onOpen?.(record.runId)}>開啟圓桌</button>
    </section>
  );
}

function FullText({cell, label, onRead}) {
  const scroll = useRef(),
    following = useRef(true),
    previous = useRef(cell.text);
  useLayoutEffect(() => {
    if (previous.current !== cell.text && following.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
    if (previous.current === cell.text && scroll.current)
      following.current = scroll.current.scrollHeight - scroll.current.clientHeight - scroll.current.scrollTop < 32;
    previous.current = cell.text;
  }, [cell.text]);
  return (
    <article
      className="discussion-roundtable-full"
      ref={scroll}
      onScroll={e => {
        const el = e.currentTarget;
        following.current = el.scrollHeight - el.clientHeight - el.scrollTop < 32;
      }}
    >
      <header>
        {onRead ? (
          <button onClick={onRead}>
            {label} · {cell.name}
          </button>
        ) : (
          <strong>
            {label} · {cell.name}
          </strong>
        )}
        <small>{cell.status}</small>
      </header>
      <div className="discussion-roundtable-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{cell.text || '尚無發言。'}</ReactMarkdown>
      </div>
    </article>
  );
}

export function DiscussionRoundtable({state, runId, onRun, reader, onReader, onTarget, onStop, mobile = false}) {
  const runs = useMemo(() => discussionRuns(state.discussion, state.messages), [state.discussion, state.messages]);
  const run = runs.find(r => r.id === runId) ?? runs.at(-1);
  const data = useMemo(() => roundtableData(run, state.messages), [run, state.messages]);
  const [mobileRound, setMobileRound] = useState(0),
    grid = useRef(),
    scrollPosition = useRef({top: 0, left: 0});
  const rounds = [data.zero, ...data.rows];
  const row = rounds.find(r => r.round === reader?.round);
  const cell = row?.cells.find(c => c.id === reader?.id);
  const label = n => `${data.inferred && n ? '推估' : ''}第 ${n} 批`;
  const live = run?.id === state.discussion?.id && state.discussion?.busy;
  const open = cell => {
    if (grid.current) scrollPosition.current = {top: grid.current.scrollTop, left: grid.current.scrollLeft};
    onReader({round: cell.round, id: cell.id});
  };
  useLayoutEffect(() => {
    if (!reader && grid.current) grid.current.scrollTo(scrollPosition.current.left, scrollPosition.current.top);
  }, [reader]);
  const chosen = rounds.find(r => r.round === mobileRound) ?? data.zero;
  const move = (dr, dc) => {
    const next = rounds[rounds.indexOf(row) + dr];
    const nextCell = next?.cells[Math.max(0, Math.min(next.cells.length - 1, row.cells.indexOf(cell) + dc))];
    if (nextCell) onReader({round: next.round, id: nextCell.id});
  };
  if (!run)
    return (
      <section className="discussion-roundtable">
        <p>本聊天室尚無討論紀錄。</p>
      </section>
    );
  return (
    <section className="discussion-roundtable" aria-label="圓桌">
      <header className="discussion-roundtable-title">
        <select
          aria-label="討論場次"
          value={run.id}
          onChange={e => {
            onRun(e.target.value);
            onReader(null);
            setMobileRound(0);
          }}
        >
          {runs.map(r => (
            <option key={r.id} value={r.id}>
              {r.question ?? '歷史討論'}
            </option>
          ))}
        </select>
        <span>
          {discussionModes[run.mode] ?? '歷史討論'} · {discussionStatus[run.status] ?? '歷史紀錄'}
        </span>
        {live && (
          <button disabled={run.status === 'stopping'} onClick={() => onStop(run.id)}>
            停止討論
          </button>
        )}
      </header>
      {run.error && <p role="alert">{run.error}</p>}
      {data.inferred && <small>舊紀錄：依時間與發言者推估批次；安排未記錄。</small>}
      {cell ? (
        <div className="discussion-roundtable-reader">
          <nav aria-label="閱讀導覽">
            <button onClick={() => onReader(null)}>回到格子</button>
            <button disabled={row.cells.indexOf(cell) === 0} onClick={() => move(0, -1)}>
              上一位
            </button>
            <button disabled={row.cells.indexOf(cell) === row.cells.length - 1} onClick={() => move(0, 1)}>
              下一位
            </button>
            <button disabled={row.round === 0} onClick={() => move(-1, 0)}>
              上一批
            </button>
            <button disabled={row.round === data.last} onClick={() => move(1, 0)}>
              下一批
            </button>
          </nav>
          <FullText key={`${run.id}-${cell.round}-${cell.id}`} cell={cell} label={label(cell.round)} />
        </div>
      ) : (
        <>
          {!mobile && (
            <details className="discussion-roundtable-summary" open>
              <summary>討論整理（AI 產生）</summary>
              <p>{data.summary?.text ?? '尚未產生整理。'}</p>
              <button onClick={() => open(data.zero.cells[1])}>閱讀整理全文</button>
              <button onClick={() => open(data.zero.cells[0])}>閱讀任務書</button>
            </details>
          )}
          {!mobile && (
            <div className="discussion-roundtable-grid" ref={grid}>
              <table>
                <thead>
                  <tr>
                    <th>
                      主持人
                      <br />
                      {run.facilitator?.displayName ?? run.facilitator?.model ?? '原聊天室主代理'}
                    </th>
                    {(run.participants ?? []).map((p, i) => (
                      <th key={p.id}>
                        <i style={{background: seatColor(i)}} />
                        {p.displayName ?? p.model}
                        {live && <button onClick={() => onTarget(run.id, p.id)}>補充給此人</button>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <InterjectionRows messages={data.zero.interjections} run={run} />
                  {data.rows.map(r => (
                    <React.Fragment key={r.round}>
                      <tr>
                        {r.cells.map(c => (
                          <td key={c.id} data-status={c.status}>
                            <button className="discussion-roundtable-cell" onClick={() => open(c)}>
                              <strong>{label(r.round)}</strong>
                              <small>{c.status}</small>
                              <p>{c.text || '尚無發言。'}</p>
                            </button>
                          </td>
                        ))}
                      </tr>
                      <InterjectionRows messages={r.interjections} run={run} />
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mobile && (
            <div className="discussion-roundtable-mobile">
              <nav>
                <select aria-label="批次" value={chosen.round} onChange={e => setMobileRound(Number(e.target.value))}>
                  {rounds.map(r => (
                    <option key={r.round} value={r.round}>
                      {label(r.round)}
                      {r.round === 0 ? ' · 整理與任務書' : ''}
                    </option>
                  ))}
                </select>
                <div className="discussion-roundtable-map">
                  {chosen.cells.map(c => (
                    <button
                      key={c.id}
                      title={`${c.name}：${c.status}`}
                      aria-label={`翻到 ${c.name}`}
                      onClick={() =>
                        document
                          .getElementById(`roundtable-${run.id}-${chosen.round}-${c.id}`)
                          ?.scrollIntoView({block: 'nearest', inline: 'start', behavior: 'smooth'})
                      }
                    >
                      <i
                        style={{
                          background: seatColor(run.participants.findIndex(p => p.id === c.id)) ?? 'var(--k-ink-3)'
                        }}
                      />
                    </button>
                  ))}
                </div>
              </nav>
              <div className="discussion-roundtable-pages" ref={grid} key={`${run.id}-${chosen.round}`}>
                {chosen.cells.map(c => (
                  <div
                    className="discussion-roundtable-page"
                    id={`roundtable-${run.id}-${chosen.round}-${c.id}`}
                    key={c.id}
                  >
                    {live && c.id !== 'host' && chosen.round > 0 && (
                      <button onClick={() => onTarget(run.id, c.id)}>補充給此人</button>
                    )}
                    <FullText cell={c} label={label(chosen.round)} onRead={() => open(c)} />
                  </div>
                ))}
              </div>
              {chosen.interjections.map(m => (
                <p key={m.id} className="discussion-roundtable-interjection">
                  插話：{m.text}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
