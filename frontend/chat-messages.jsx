import {DiscussionEntry} from './discussion-roundtable.jsx';
import {ActionBarPrimitive, MessagePrimitive, SelectionToolbarPrimitive, useAuiState} from '@assistant-ui/react';
import {Check, Copy, FileText} from 'lucide-react';
import {CopyFeedback, NativeReasoning} from './native-ui.jsx';
import {MarkdownTextPrimitive} from '@assistant-ui/react-markdown';
import React, {useContext, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {RemoteRecord} from './remote-record.jsx';
import {effortName} from './model-picker.jsx';
import {elapsedConversationMs, formatElapsed} from '../shared/conversation-groups.mjs';
import {
  messageFileUrl,
  nativeDestinationKind,
  preserveNativeUrl,
  restoreNativeFileDestinations
} from '../shared/native-content.mjs';
import {parseResponseAnnotations} from './response-annotations.mjs';
import remarkGfm from 'remark-gfm';
import {TranscriptContext, api, toolStatusName} from './app-common.jsx';

export function CodeHeader({language, code}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-header">
      <span>{language || '程式碼'}</span>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? '已複製' : '複製程式碼'}
      </button>
    </div>
  );
}
export function NativeLink({href, children, title}) {
  const {preview, state} = useContext(TranscriptContext),
    kind = nativeDestinationKind(href);
  if (kind === 'file')
    return (
      <a
        href={messageFileUrl(href, state.threadId)}
        draggable={false}
        className="inline-file"
        title={title || href}
        onAuxClick={event => event.preventDefault()}
        onClick={event => {
          event.preventDefault();
          preview(href, 'message-file');
        }}
      >
        <FileText size={14} />
        {children}
      </a>
    );
  if (['web', 'external', 'fragment'].includes(kind))
    return (
      <a href={href} title={title} target={kind === 'fragment' ? undefined : '_blank'} rel="noreferrer">
        {children}
      </a>
    );
  return (
    <span>
      {children}
      {href && <code className="native-destination">{href}</code>}
    </span>
  );
}
export function NativeImage({src, alt, title}) {
  const {state} = useContext(TranscriptContext),
    kind = nativeDestinationKind(src);
  if (['file', 'web'].includes(kind) || /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/iu.test(src ?? ''))
    return (
      <img
        className="native-message-image"
        src={kind === 'file' ? messageFileUrl(src, state.threadId) : src}
        alt={alt ?? ''}
        title={title}
        referrerPolicy="no-referrer"
      />
    );
  return (
    <span>
      {alt}
      {src && <code className="native-destination">{src}</code>}
    </span>
  );
}
// The main model's start mark reads as a short note, not a code block. Whether a discussion actually started
// shows in the room (the discussion itself, or a "討論未開始" notice).
const discussionStartMark = {
  CodeHeader: () => null,
  SyntaxHighlighter: () => <p className="discussion-start-mark">主模型標記：開始討論</p>
};
export function Markdown() {
  return (
    <MarkdownTextPrimitive
      className="markdown"
      remarkPlugins={[remarkGfm, restoreNativeFileDestinations]}
      urlTransform={preserveNativeUrl}
      smooth={false}
      components={{CodeHeader, a: NativeLink, img: NativeImage}}
      componentsByLanguage={{'k-discussion': discussionStartMark}}
    />
  );
}
export function AttachmentLabel({name}) {
  const type = name.match(/\.([^.]+)$/)?.[1].toUpperCase() ?? '檔案';
  return (
    <>
      <span className="attachment-type">{type}</span>
      <span className="attachment-name">{name}</span>
    </>
  );
}
export function UserMessageText({children}) {
  const [expanded, setExpanded] = useState(false),
    [long, setLong] = useState(false),
    contentRef = useRef(null),
    buttonRef = useRef(null),
    restoreFocus = useRef(false),
    contentId = useId();
  useLayoutEffect(() => {
    const content = contentRef.current;
    // Measure wrapped text, not character count: phone widths and font sizes differ.
    const measure = () => setLong(content.scrollHeight > 8 * parseFloat(getComputedStyle(content).lineHeight) + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (expanded || !restoreFocus.current) return;
    restoreFocus.current = false;
    buttonRef.current?.focus({preventScroll: true});
    buttonRef.current?.scrollIntoView({block: 'nearest', behavior: 'instant'});
  }, [expanded]);
  return (
    <>
      <div id={contentId} className="user-message-text" data-expanded={expanded}>
        <div ref={contentRef}>{children}</div>
      </div>
      {long && (
        <button
          ref={buttonRef}
          type="button"
          className="user-text-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => {
            restoreFocus.current = expanded;
            setExpanded(!expanded);
          }}
        >
          {expanded ? '收合' : '展開全文'}
        </button>
      )}
    </>
  );
}
export function UserContent({record}) {
  if (record?.discussionHandoff)
    return (
      <>
        <small>已帶入前段討論，保留各模型原始意見與分歧。</small>
        <UserMessageText>{record.displayText}</UserMessageText>
      </>
    );
  const envelope = parseResponseAnnotations(record?.text ?? '');
  if (!envelope)
    return (
      <UserMessageText>
        <MessagePrimitive.Parts />
      </UserMessageText>
    );
  return (
    <>
      {envelope.text && (
        <UserMessageText>
          <div className="user-quote-prompt">{envelope.text}</div>
        </UserMessageText>
      )}
      <details className="user-quote-context">
        <summary>引用 {envelope.references.length} 段助理回覆</summary>
        {envelope.references.map((item, index) => (
          <section key={`${index}-${item.source_message_id ?? ''}`}>
            <strong>引用段落 {index + 1}</strong>
            <blockquote>{item.quote}</blockquote>
            {item.annotation && (
              <p>
                <strong>我的註解</strong>
                {item.annotation}
              </p>
            )}
          </section>
        ))}
      </details>
    </>
  );
}
export function userCopyText(record) {
  if (record?.discussionHandoff) return record.displayText ?? '';
  const text = record?.text ?? '',
    envelope = parseResponseAnnotations(text);
  return envelope
    ? [
        envelope.text,
        ...envelope.references.map(
          (item, index) =>
            `引用段落 ${index + 1}\n${item.quote}${item.annotation ? `\n\n我的註解\n${item.annotation}` : ''}`
        )
      ]
        .filter(Boolean)
        .join('\n\n')
    : text;
}
export function UserMessage() {
  const id = useAuiState(s => s.message.id);
  const {state, modelName, models, messageIndex, userTurnIndex, openRoundtable} = useContext(TranscriptContext);
  const record = messageIndex.get(id);
  if (record?.kind === 'discussion' && !record.summary)
    return <DiscussionEntry record={record} state={state} onOpen={openRoundtable} />;
  const worker =
    record?.kind === 'worker-completion' || record?.source === 'worker-completion' || id.startsWith('luna-completion-');
  if (worker)
    return (
      <MessagePrimitive.Root className="message worker-event" data-aui-quote-selectable="false">
        <div role="note">
          <strong>K 系統事件</strong>
          <p>{record?.summary ?? 'Luna 工人完成通知'}</p>
          <details>
            <summary>查看工人結果資料</summary>
            <pre>{record?.text}</pre>
          </details>
        </div>
      </MessagePrimitive.Root>
    );
  const files = record?.attachments ?? [],
    change = state.modelChanges?.find(c => c.turnId === record?.turnId),
    capacityChange = change?.reason === 'capacity',
    changeAnchor = change ? userTurnIndex.get(change.turnId) : null,
    isCapacityContinuation = capacityChange && changeAnchor?.id === id,
    threadId = state.threadId,
    copyText = userCopyText(record);
  const plainModelName = model =>
    models.find(item => item.model === model)?.displayName ||
    (model === state.model ? state.modelDisplayName : null) ||
    {'gpt-6-luna': 'GPT-6 Luna', 'gpt-6.1-sol': 'GPT-6.1 Sol'}[model] ||
    model ||
    '選擇模型';
  return (
    <MessagePrimitive.Root
      className={`message user-message${isCapacityContinuation ? ' capacity-continuation' : ''}`}
      data-aui-quote-selectable="false"
    >
      {isCapacityContinuation ? (
        <div className="capacity-model-change-note" role="note" data-aui-quote-selectable="false">
          服務容量不足，主代理已改由 {plainModelName(change.toModel)}／{effortName[change.toEffort] ?? change.toEffort}{' '}
          接續（原 {plainModelName(change.fromModel)}）
        </div>
      ) : (
        !capacityChange &&
        change &&
        changeAnchor?.id === id && (
          <div className="model-change-note">
            主代理已切換：{modelName(change.fromModel)} → {modelName(change.toModel)}
          </div>
        )
      )}
      {!isCapacityContinuation && (
        <div className="user-bubble">
          <UserContent key={`${threadId}:${id}`} record={record} />
        </div>
      )}
      {!isCapacityContinuation && !!files.length && (
        <div className="attachment-row">
          {files.map(a => (
            <a
              className="file-chip attachment-chip"
              title={a.name}
              aria-label={`下載附件 ${a.name}`}
              href={`/api/attachment?id=${a.id}&threadId=${encodeURIComponent(threadId ?? '')}&download=1`}
              key={a.id}
            >
              <AttachmentLabel name={a.name} />
            </a>
          ))}
        </div>
      )}
      {!isCapacityContinuation && !!copyText && (
        <div className="message-actions">
          <CopyFeedback text={copyText} />
        </div>
      )}
    </MessagePrimitive.Root>
  );
}
export function TurnProcess({group, state}) {
  const [now, setNow] = useState(Date.now()),
    [expanded, setExpanded] = useState(false),
    summaryRef = useRef(null),
    restoreFocus = useRef(false);
  const groupLatestAssistant = group?.latestAssistant,
    latestPartial = !!(groupLatestAssistant?.partial || groupLatestAssistant?.streaming),
    isLatest = !!group && group.messages.some(m => m.id === state.messages?.at(-1)?.id),
    active = isLatest && !!state.busy,
    unfinished = latestPartial && !active;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useLayoutEffect(() => {
    if (expanded || !restoreFocus.current) return;
    restoreFocus.current = false;
    // A pinned header moves back into flow on collapse; keep this reply reachable.
    summaryRef.current?.focus({preventScroll: true});
    summaryRef.current?.scrollIntoView({block: 'nearest', behavior: 'instant'});
  }, [expanded]);
  if (!group) return null;
  const close = () => {
    restoreFocus.current = true;
    setExpanded(false);
  };
  const elapsed = elapsedConversationMs(active || unfinished ? {...group, completedAt: null} : group, now),
    items = group.messages.filter(
      m =>
        m.role !== 'user' &&
        m.id !== group.conclusion?.id &&
        (m.role !== 'assistant' || m.partial || m.streaming || !m.completedAt)
    ),
    tools = (state.tools ?? []).filter(t => t.groupId && t.groupId === group.id);
  const timeline = expanded
    ? [
        ...items.map(item => ({id: item.id, createdAt: item.createdAt, kind: 'message', item})),
        ...tools.map(item => ({id: `tool-${item.id}`, createdAt: item.createdAt, kind: 'tool', item}))
      ].sort((a, b) => {
        const aa = Date.parse(a.createdAt ?? ''),
          bb = Date.parse(b.createdAt ?? '');
        return Number.isFinite(aa) && Number.isFinite(bb) ? aa - bb : 0;
      })
    : [];
  return (
    <details className="turn-process" open={expanded}>
      <summary
        ref={summaryRef}
        onClick={event => {
          event.preventDefault();
          if (expanded) close();
          else setExpanded(true);
        }}
      >
        <span>
          {active
            ? `已耗時 ${elapsed === null ? '' : formatElapsed(elapsed)}`
            : unfinished
              ? '未完成'
              : elapsed === null
                ? '處理過程'
                : `處理了 ${formatElapsed(elapsed)}`}
        </span>
        <span className="turn-process-toggle">
          {expanded ? '收合細節' : '查看細節'}{' '}
          <span className="turn-process-chevron" aria-hidden="true">
            ›
          </span>
        </span>
      </summary>
      {expanded && (
        <div
          className="turn-process-content"
          tabIndex={0}
          role="region"
          aria-label="處理細節"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <NativeReasoning state={state} group={group} />
          {timeline.map(entry =>
            entry.kind === 'message' ? (
              <section key={entry.id}>
                <strong>
                  {entry.item.kind === 'worker-completion' || entry.item.source === 'worker-completion'
                    ? 'K 系統事件'
                    : entry.item.role === 'user'
                      ? '送入工作中的訊息'
                      : '助理過程'}
                </strong>
                <pre>{entry.item.summary ?? entry.item.text ?? ''}</pre>
              </section>
            ) : (
              <section key={entry.id}>
                {entry.item.detailsDeferred ? (
                  <RemoteRecord
                    threadId={state.threadId}
                    kind="tool"
                    id={entry.item.id}
                    summary={`工具：${entry.item.name} · ${toolStatusName[entry.item.status] ?? entry.item.status}`}
                  >
                    {({tool}) => (
                      <pre>
                        {tool.output ??
                          (typeof tool.details === 'string' ? tool.details : JSON.stringify(tool.details)) ??
                          tool.status}
                      </pre>
                    )}
                  </RemoteRecord>
                ) : (
                  <>
                    <strong>工具：{entry.item.name}</strong>
                    <pre>
                      {entry.item.output ??
                        (typeof entry.item.details === 'string'
                          ? entry.item.details
                          : JSON.stringify(entry.item.details)) ??
                        entry.item.status}
                    </pre>
                  </>
                )}
              </section>
            )
          )}
        </div>
      )}
    </details>
  );
}
export function AssistantMessage() {
  const id = useAuiState(s => s.message.id),
    {state, branch, groups, messageIndex, openRoundtable} = useContext(TranscriptContext);
  const record = messageIndex.get(id),
    messageGroup = groups.get(id),
    groupLatestAssistant = messageGroup?.latestAssistant,
    groupHasTrailingPartial = !!(groupLatestAssistant?.partial || groupLatestAssistant?.streaming),
    isConclusion = messageGroup?.conclusion?.id === id,
    isGroupLatest = id === groupLatestAssistant?.id,
    latestPartial = isGroupLatest && groupHasTrailingPartial,
    group =
      (latestPartial && (state.busy || record?.partial || record?.streaming)) ||
      (isConclusion && !groupHasTrailingPartial)
        ? messageGroup
        : null;
  const quoteable = record?.role === 'assistant' && !record?.partial && !record?.streaming,
    completedReply = quoteable && !!record?.completedAt;
  if (record?.kind === 'discussion' && !record.summary)
    return <DiscussionEntry record={record} state={state} onOpen={openRoundtable} />;
  if (record?.kind !== 'discussion' && groups.has(id) && !group && !isConclusion && !completedReply) return null;
  const discussion = record?.kind === 'discussion',
    speaker = record?.summary ? '討論整理（AI 產生）' : record?.speaker;
  const speakerProvider =
    record?.summary || record?.background
      ? 'neutral'
      : record?.model?.startsWith('gpt-')
        ? 'codex'
        : record?.model?.startsWith('claude-')
          ? 'claude'
          : record?.model?.startsWith('gemini-')
            ? 'gemini'
            : 'neutral';
  return (
    <MessagePrimitive.Root
      className={`message assistant-message${discussion ? ' discussion-message' : ''}`}
      data-discussion-provider={discussion ? speakerProvider : undefined}
    >
      <div className="assistant-body">
        {discussion && (
          <div className="discussion-speaker">
            <strong>{speaker}</strong>
            {record.effort && <span>／{effortName[record.effort] ?? record.effort}</span>}
            {record.partial && <span> · 未完成</span>}
          </div>
        )}
        {group && !discussion && <TurnProcess group={group} state={state} />}
        <div
          className="assistant-response-content"
          data-aui-quote-selectable={quoteable ? 'true' : 'false'}
          tabIndex={0}
          aria-label="助理回覆文字，可選取引用"
        >
          <MessagePrimitive.Parts components={{Text: Markdown}} />
        </div>
        <ActionBarPrimitive.Root className="message-actions">
          {(isConclusion || completedReply) && (!discussion || isConclusion) && (
            <>
              {discussion && <span className="discussion-speaker-end">{speaker}</span>}
              <CopyFeedback text={record?.text} />
              {isConclusion && !groupHasTrailingPartial && !discussion && (
                <button
                  type="button"
                  title="從此結論分支新對話"
                  disabled={state.connectionOpening}
                  onClick={() => branch?.(record)}
                >
                  <Copy size={15} /> 分支
                </button>
              )}
              {record?.completedAt && (
                <time>
                  {new Date(record.completedAt).toLocaleTimeString('zh-TW', {hour: 'numeric', minute: '2-digit'})}
                </time>
              )}
            </>
          )}
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}
export const messageComponents = {UserMessage: React.memo(UserMessage), AssistantMessage: React.memo(AssistantMessage)};

export function SelectionToolbarAction({onAdd, disabled, toolbarRef}) {
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    let frame = 0;
    const clamp = () => {
      frame = 0;
      const rect = toolbar.getBoundingClientRect(),
        maxLeft = Math.max(8, window.innerWidth - rect.width - 8),
        maxTop = Math.max(8, window.innerHeight - rect.height - 8),
        left = Math.min(Math.max(8, rect.left), maxLeft),
        top = Math.min(Math.max(8, rect.top), maxTop);
      if (Math.abs(left - rect.left) > 0.5 || Math.abs(top - rect.top) > 0.5) {
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${top}px`;
        toolbar.style.transform = 'none';
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(clamp);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(toolbar, {attributes: true, attributeFilter: ['style']});
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [toolbarRef]);
  useEffect(() => {
    const dismiss = event => {
      if (event?.type === 'keydown' && event.key !== 'Escape') return;
      const selected = window.getSelection(),
        anchor = selected?.anchorNode,
        element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
      if (!selected || selected.isCollapsed || !element?.closest('[data-message-id]')) return;
      selected.removeAllRanges();
    };
    document.addEventListener('keydown', dismiss);
    window.addEventListener('resize', dismiss);
    window.visualViewport?.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('keydown', dismiss);
      window.removeEventListener('resize', dismiss);
      window.visualViewport?.removeEventListener('resize', dismiss);
    };
  }, []);
  return (
    <button type="button" aria-label="加入聊天" disabled={disabled} onClick={() => onAdd?.()}>
      加入聊天
    </button>
  );
}
export function AddResponseSelectionButton({onAdd, disabled}) {
  const toolbarRef = useRef(null);
  return (
    <SelectionToolbarPrimitive.Root ref={toolbarRef} className="response-selection-toolbar">
      <SelectionToolbarAction toolbarRef={toolbarRef} onAdd={onAdd} disabled={disabled} />
    </SelectionToolbarPrimitive.Root>
  );
}

export function WorkProgress({plan}) {
  if (!Array.isArray(plan) || !plan.length) return null;
  const completed = plan.filter(item => ['completed', 'done'].includes(item?.status)).length,
    total = plan.length,
    current = plan.find(item => ['in_progress', 'inProgress', 'running'].includes(item?.status));
  const currentText = current?.activeForm || current?.step;
  const label = status =>
    ({
      pending: '待處理',
      in_progress: '進行中',
      inProgress: '進行中',
      running: '進行中',
      completed: '已完成',
      done: '已完成'
    })[status] ?? '未確認';
  return (
    <details className="chat-work-progress">
      <summary>
        工作進度 {completed}/{total}
        {currentText ? ` · ${currentText}` : ''}
      </summary>
      <ol>
        {plan.map((item, index) => (
          <li key={`${index}-${item?.step ?? ''}`} data-status={item?.status}>
            <span>{item?.step ?? item?.activeForm ?? '未命名項目'}</span>
            <small>{label(item?.status)}</small>
          </li>
        ))}
      </ol>
    </details>
  );
}
