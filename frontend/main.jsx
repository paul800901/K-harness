import {DiscussionRoundtable} from './discussion-roundtable.jsx';
import {DiscussionControls, useDiscussionConfig} from './discussion-controls.jsx';
import {uploadAttachment} from './attachment-upload.mjs';
import {WorkStatus, WorkerHealthLabel, WorkerDetails} from './work-status.jsx';

import {GoalDialog, goalStatusLabel} from './goal-dialog.jsx';
import {NativeNotices, NativeDiffs, NativeFilePicker, NativeReview} from './native-ui.jsx';
import {compactionLabel} from './compaction-status.mjs';
import {localizeNativeNotice} from './native-notices.mjs';
import React, {useState, useEffect, useLayoutEffect, useRef, useContext, useMemo, useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  ThreadPrimitive,
  ComposerPrimitive
} from '@assistant-ui/react';
import {
  Plus,
  Search,
  SlidersHorizontal,
  FolderPlus,
  PanelLeft,
  PanelRight,
  PanelRightClose,
  Paperclip,
  ArrowUp,
  Square,
  Check,
  FileText,
  Download,
  X,
  Settings,
  ChevronDown,
  Folder,
  RefreshCw,
  Activity,
  ShieldCheck,
  ArrowDown,
  Mic
} from 'lucide-react';
import './style.css';
import {useVoiceComposer, VoiceWaveform} from './voice-composer.jsx';
import {ResponseQuotes, ResponseSelectionPopover} from './response-annotations.jsx';
import {
  formatResponseAnnotations,
  loadResponseQuotes,
  MAX_RESPONSE_QUOTES,
  MAX_SEND_BODY_BYTES,
  normalizeResponseQuote,
  removeUnchangedResponseQuotes,
  saveResponseQuotes,
  shouldSubmitComposerEnter,
  utf8ByteLength
} from './response-annotations.mjs';
import {BrowserPanel} from './browser-panel.jsx';
import kLogo from './assets/k-logo.jpg';
import {Usage, UsageDetails} from './usage.jsx';
import './sidebar.css';
import {useAnchoredPopover} from './anchored-popover.jsx';
import {ProjectSidebar} from './project-sidebar.jsx';
import {conversationPreview} from '../shared/conversation-preview.mjs';
import {useCompletionAttention} from './completion-attention.jsx';
import {QueuedMessages} from './queued-messages.jsx';
import {workspaceName, sameWorkspace} from './workspace.jsx';
import {
  projectKey,
  isVisibleMainSession,
  completeSessionOrder,
  moveSessionOrder,
  searchSessions,
  sortSessions
} from './project-groups.mjs';
import {applyAppearance, readAppearance, saveAppearance, readTheme, saveTheme} from './appearance.mjs';
import {groupConversationMessages} from '../shared/conversation-groups.mjs';
import {applyStateEvent} from '../shared/state-stream.mjs';
import {connectState, remoteLoginRequired} from './state-connection.mjs';
import {sameChatState} from './chat-state.mjs';
import {ModelPicker, effortName} from './model-picker.jsx';
import {ReasoningPicker} from './reasoning-picker.jsx';
import {WorkerActivityPopover} from './worker-activity-popover.jsx';
import {SettingsDialog} from './settings-dialog.jsx';
import './model-picker.css';
import {PermissionPicker, claudePermissionModes} from './permission-picker.jsx';
import {modelProvider as providerOf} from '../shared/model-provider.mjs';
import './mobile.css';
import {AddResponseSelectionButton, AttachmentLabel, WorkProgress, messageComponents} from './chat-messages.jsx';
import {
  AppContext,
  IconButton,
  Modal,
  ResponseQuoteContext,
  TranscriptContext,
  api,
  convertMessage,
  emptyUploads,
  narrowScreen,
  readSidebarOrder,
  readSidebarPreference,
  remoteClient
} from './app-common.jsx';
import {Approval, ArchiveManager, BranchDialog, Rename} from './dialogs.jsx';
function Chat(props) {
  const latest = useRef(props);
  latest.current = props;
  const actions = useMemo(
    () =>
      Object.fromEntries(
        [
          'onOptions',
          'setUploads',
          'upload',
          'action',
          'roomAction',
          'setEffort',
          'setAccessMode',
          'onChooseModel'
        ].map(name => [name, (...args) => latest.current[name](...args)])
      ),
    []
  );
  const selected = useRef(props.state);
  if (!sameChatState(selected.current, props.state)) selected.current = props.state;
  return <ChatView {...props} {...actions} state={selected.current} />;
}
const ChatView = React.memo(function ChatView({
  mobile,
  onOptions,
  state,
  uploads,
  setUploads,
  upload,
  action,
  roomAction,
  effort,
  setEffort,
  modelLabel,
  modelButtonLabel,
  accessMode,
  setAccessMode,
  permissionConfirmed,
  onChooseModel,
  blocked,
  online,
  connecting,
  loginRequired
}) {
  const fileInput = useRef();
  const threadId = state.threadId;
  const threadApi = (route, data = {}) => api(route, {...data, threadId});
  const [discussionConfig, setDiscussionConfig] = useDiscussionConfig(threadId, state.discussion?.id);
  const {models: discussionModels, setModels: discussionCatalog} = useContext(TranscriptContext);
  useEffect(() => {
    const target = event => {
      const data = event.detail;
      if (data.threadId !== threadId || data.runId !== state.discussion?.id || !state.discussion?.busy) return;
      setDiscussionConfig({...discussionConfig, target: data.target});
      setTimeout(() => document.querySelector('.composer-input')?.focus(), 0);
    };
    window.addEventListener('k-discussion-target', target);
    return () => window.removeEventListener('k-discussion-target', target);
  }, [threadId, state.discussion, discussionConfig]);
  const [draftText, setDraftText] = useState('');
  const [responseQuotes, setResponseQuotes] = useState(() => loadResponseQuotes(sessionStorage, threadId)),
    [quoteSending, setQuoteSending] = useState(false),
    [quoteNotice, setQuoteNotice] = useState(''),
    [quotePopover, setQuotePopover] = useState(null);
  const responseQuotesRef = useRef(responseQuotes),
    quoteSendLock = useRef(false),
    voiceOwnerRef = useRef(null);
  const [voiceOwner, setVoiceOwner] = useState(null);
  responseQuotesRef.current = responseQuotes;
  const claimVoice = owner => {
    if (voiceOwnerRef.current && voiceOwnerRef.current !== owner) return false;
    voiceOwnerRef.current = owner;
    setVoiceOwner(owner);
    return true;
  };
  const reportVoiceActive = (owner, active) => {
    if (active) {
      if (!voiceOwnerRef.current || voiceOwnerRef.current === owner) {
        voiceOwnerRef.current = owner;
        setVoiceOwner(owner);
      }
    } else if (voiceOwnerRef.current === owner) {
      voiceOwnerRef.current = null;
      setVoiceOwner(null);
    }
  };
  const updateQuotes = updater =>
    setResponseQuotes(current => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      responseQuotesRef.current = next;
      saveResponseQuotes(sessionStorage, threadId, next);
      return next;
    });
  const addResponseQuote = value => {
    if (responseQuotesRef.current.length >= MAX_RESPONSE_QUOTES) {
      setQuoteNotice(`每則訊息最多引用 ${MAX_RESPONSE_QUOTES} 段。`);
      return null;
    }
    const quote = normalizeResponseQuote(value);
    if (!quote) {
      setQuoteNotice('所選文字超過引用上限或沒有可引用文字。');
      return null;
    }
    updateQuotes(current => [...current, quote]);
    setQuoteNotice('');
    return quote;
  };
  const mutateResponseQuotes = (_id, updater) => updateQuotes(updater);
  const addSelectedResponseQuote = () => {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed) return;
    const range = selected.getRangeAt(0).cloneRange(),
      anchor = selected.anchorNode,
      focus = selected.focusNode,
      element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement,
      focusElement = focus?.nodeType === 1 ? focus : focus?.parentElement,
      messageNode = element?.closest('[data-message-id]'),
      focusMessageNode = focusElement?.closest('[data-message-id]'),
      messageId = messageNode?.getAttribute('data-message-id'),
      source = state.messages.find(item => item.id === messageId);
    if (
      !messageNode ||
      messageNode !== focusMessageNode ||
      source?.role !== 'assistant' ||
      source.partial ||
      source.streaming
    )
      return;
    const quote = addResponseQuote({sourceMessageId: source.id, text: selected.toString()});
    if (!quote) return;
    setQuotePopover({mode: 'comment', quoteId: quote.id, range, rect: range.getBoundingClientRect()});
    selected.removeAllRanges();
  };
  const activeQuote = responseQuotes.find(item => item.id === quotePopover?.quoteId);
  useEffect(() => {
    if (quotePopover?.mode === 'comment' && !activeQuote) setQuotePopover(null);
  }, [quotePopover?.mode, quotePopover?.quoteId, activeQuote]);
  const provider = state.provider ?? providerOf(state.model);
  const capabilities = state.capabilities ?? {};
  const effectiveAccessMode =
    provider === 'claude'
      ? accessMode === 'workspace-write'
        ? 'claude-manual'
        : accessMode === 'read-only'
          ? 'claude-plan'
          : accessMode
      : accessMode;
  const submitText = async rawText => {
    const raw = typeof rawText === 'string' ? rawText : '';
    const quotes = responseQuotesRef.current.slice();
    if (!raw.trim() && !quotes.length && !uploads.some(a => a.id)) return;
    if (voiceOwnerRef.current) throw Error('請先停止目前聽寫，再送出訊息。');
    if (uploads.some(item => item.loading)) throw Error('附件仍在上傳，尚未送出；訊息與引用草稿已保留。');
    if (quoteSendLock.current) return;
    const text = formatResponseAnnotations(raw, quotes),
      payload = {
        threadId,
        text,
        attachmentIds: uploads.filter(a => a.id).map(a => a.id),
        accessMode: effectiveAccessMode,
        permissionConfirmed,
        ...(effort ? {effort} : {})
      };
    if (quotes.length && utf8ByteLength(JSON.stringify(payload)) > MAX_SEND_BODY_BYTES) {
      setQuoteNotice('引用、註解與訊息合計太長，未送出；請縮短或移除部分引用。');
      throw Error('引用與註解超出送出大小限制；草稿已保留。');
    }
    quoteSendLock.current = true;
    setQuoteSending(true);
    try {
      const discussing = state.discussion?.busy;
      if (discussing && payload.attachmentIds.length) throw Error('討論中的補充先用文字；附件留在輸入框，未送出。');
      const result = discussing
        ? await threadApi('discussion/message', {
            text,
            runId: state.discussion.id,
            target: discussionConfig.target || undefined
          })
        : await threadApi('send', {
            ...payload,
            // Armed discussion settings ride with the message; the main model starts the discussion when asked.
            ...(discussionConfig.mode !== 'normal'
              ? {
                  discussion: {
                    mode: discussionConfig.mode,
                    participants: discussionConfig.participants,
                    includeContext: discussionConfig.includeContext
                  }
                }
              : {})
          });
      if (!result.sent && !result.queued) throw Error('送出前已停止，訊息留在輸入框。');
      clearDraft(raw);
      const remaining = removeUnchangedResponseQuotes(loadResponseQuotes(sessionStorage, threadId), quotes);
      saveResponseQuotes(sessionStorage, threadId, remaining);
      responseQuotesRef.current = remaining;
      setResponseQuotes(remaining);
      setQuoteNotice('引用與註解已送入此對話。');
      setUploads(current => current.filter(item => !uploads.includes(item)));
    } catch (error) {
      try {
        if (!sessionStorage.getItem(`k-draft:${threadId}`) && raw) sessionStorage.setItem(`k-draft:${threadId}`, raw);
      } catch {}
      if (raw && !runtime.thread.composer.getState().text) runtime.thread.composer.setText(raw);
      action(() => {
        throw error;
      });
      throw error;
    } finally {
      quoteSendLock.current = false;
      setQuoteSending(false);
    }
  };
  const queueDraft = () => {
    if (blocked || !online) return;
    const text = runtime.thread.composer.getState().text;
    if (voiceOwnerRef.current) {
      setQuoteNotice('請先停止目前聽寫，再送出訊息。');
      return;
    }
    if ((!text.trim() && !responseQuotesRef.current.length && !uploads.some(a => a.id)) || uploads.some(a => a.loading))
      return;
    roomAction(threadId, () => submitText(text));
  };
  // The native UI library rebuilds its message store on adapter identity change.
  // Keep history inputs stable across background events and composer keystrokes;
  // callbacks still read this room's latest draft, attachments and permissions.
  const callbacks = useRef();
  callbacks.current = {
    submitText,
    cancel: () =>
      roomAction(threadId, () => threadApi('stop', state.discussion?.busy ? {runId: state.discussion.id} : {}))
  };
  const isDisabled = !online || !state.threadId || ['connecting', 'offline', 'error'].includes(state.status),
    isSendDisabled = blocked || uploads.some(a => a.loading) || state.status === 'uncertain';
  const adapter = useMemo(
    () => ({
      messages: state.messages ?? [],
      isRunning: !!state.busy,
      isDisabled,
      isSendDisabled,
      convertMessage,
      onNew: message =>
        callbacks.current.submitText(
          message.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n')
        ),
      onCancel: () => callbacks.current.cancel()
    }),
    [state.messages, state.busy, isDisabled, isSendDisabled]
  );
  const runtime = useExternalStoreRuntime(adapter);
  // A late acknowledgement belongs to this submitted draft, not a newer draft
  // typed after returning to the same room. Unmounted composers have no subscriber.
  const clearDraft = text => {
    try {
      if (sessionStorage.getItem(`k-draft:${threadId}`)?.trim() === text.trim())
        sessionStorage.removeItem(`k-draft:${threadId}`);
    } catch {}
    const current = runtime.thread.composer.getState().text;
    if (!current || current.trim() === text.trim()) {
      runtime.thread.composer.setText('');
      setDraftText('');
    }
  };
  const voice = useVoiceComposer({
    disabled: blocked || !state.threadId || ['connecting', 'offline', 'error', 'uncertain'].includes(state.status),
    sessionKey: threadId,
    onActiveChange: active => reportVoiceActive('main', active),
    onBackgroundResult: ({text}) => {
      const key = `k-draft:${threadId}`,
        existing = sessionStorage.getItem(key) ?? '';
      sessionStorage.setItem(key, existing + (existing && !/\s$/.test(existing) ? '\n' : '') + text);
    },
    onResult: ({text, send}) => {
      const composer = runtime.thread.composer,
        existing = composer.getState().text;
      composer.setText(existing + (existing && !/\s$/.test(existing) ? '\n' : '') + text);
      setDraftText(composer.getState().text);
      if (send) queueDraft();
    }
  });
  const startComposerVoice = () => {
    if (voiceOwnerRef.current && voiceOwnerRef.current !== 'main') {
      setQuoteNotice('另一段聽寫仍在進行，請先停止或完成。');
      return;
    }
    if (!voice.native && sessionStorage.getItem(voice.consentKey) !== 'yes') {
      void voice.start();
      return;
    }
    if (claimVoice('main')) void voice.start();
  };
  const acceptComposerVoice = () => {
    if (voiceOwnerRef.current && voiceOwnerRef.current !== 'main') {
      setQuoteNotice('另一段聽寫仍在進行，請先停止或完成。');
      voice.decline();
      return;
    }
    if (claimVoice('main')) voice.accept();
  };
  useEffect(() => {
    if (!state.threadId) return;
    const key = `k-draft:${state.threadId}`,
      composer = runtime.thread.composer;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      composer.setText(saved);
      setDraftText(saved);
    } // Do not re-render the parent while ComposerInput is synchronizing its controlled value.
    // A synchronous draft update here resets the textarea selection (and interrupts IME).
    let subscribed = true;
    const unsubscribe = composer.subscribe(() => {
      const text = composer.getState().text;
      queueMicrotask(() => {
        if (subscribed) setDraftText(text);
      });
      if (text) sessionStorage.setItem(key, text);
      else sessionStorage.removeItem(key);
    });
    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, [runtime, state.threadId]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ResponseQuoteContext.Provider
        value={{
          add: addResponseQuote,
          change: mutateResponseQuotes,
          quotes: responseQuotes,
          onVoiceActive: reportVoiceActive,
          claimVoice,
          voiceOwner,
          disabled:
            quoteSending ||
            blocked ||
            !state.threadId ||
            ['connecting', 'offline', 'error', 'uncertain', 'stopping'].includes(state.status)
        }}
      >
        <ThreadPrimitive.Root
          className={`thread ${!state.messages?.length ? 'thread-empty' : ''}`}
          onDragOver={e => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault();
          }}
          onDrop={e => {
            if (e.dataTransfer.files.length) {
              e.preventDefault();
              upload([...e.dataTransfer.files]);
            }
          }}
        >
          <AddResponseSelectionButton
            onAdd={addSelectedResponseQuote}
            disabled={quoteSending || blocked || !state.threadId}
          />
          <div className="viewport-region">
            <ThreadPrimitive.Viewport className="viewport">
              <div className="message-column">
                {state.connectionOpening && !state.messages?.length ? (
                  <div className="history-skeleton" role="status" aria-label="正在載入對話內容">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : (
                  !state.messages?.length && (
                    <div className="empty-state">
                      <img className="big-k" src={kLogo} alt="K 執行中樞" width="64" height="64" />
                      <h1>{state.threadId ? '這次要完成什麼工作？' : '你的工作，從這裡繼續。'}</h1>
                      <p>
                        {state.threadId
                          ? '可以拖入檔案、貼上圖片，或直接描述要交付的結果。'
                          : '從左側選擇對話，或建立一個新對話。'}
                      </p>
                    </div>
                  )
                )}
                <ThreadPrimitive.Messages components={messageComponents} />
                {state.threadId && !state.connectionOpening && (
                  <WorkStatus
                    state={state}
                    online={online}
                    connecting={connecting}
                    loginRequired={loginRequired}
                    footer
                  />
                )}
              </div>
              <ThreadPrimitive.ScrollToBottom className="scroll-bottom" aria-label="回到最新訊息">
                <ArrowDown size={17} />
              </ThreadPrimitive.ScrollToBottom>
            </ThreadPrimitive.Viewport>
          </div>
          {quotePopover && (
            <ResponseSelectionPopover
              selection={quotePopover}
              quote={activeQuote}
              threadId={threadId}
              onChange={mutateResponseQuotes}
              onClose={() => setQuotePopover(null)}
              onVoiceActive={reportVoiceActive}
              claimVoice={claimVoice}
              voiceOwner={voiceOwner}
              disabled={
                quoteSending ||
                blocked ||
                !state.threadId ||
                ['connecting', 'offline', 'error', 'uncertain', 'stopping'].includes(state.status)
              }
            />
          )}
          <div className="composer-area">
            <DiscussionControls
              state={state}
              models={discussionModels}
              config={discussionConfig}
              onChange={setDiscussionConfig}
              loadModels={() => api('models')}
              onCatalog={discussionCatalog}
              disabled={blocked || !state.threadId || (state.busy && !state.discussion?.busy)}
            />
            <WorkProgress plan={state.progress?.plan} />
            {!!state.questions?.length && (
              <div className="inline-requests" aria-label="需要你的確認">
                {state.questions.map(q => (
                  <Approval key={q.id} question={q} action={fn => roomAction(threadId, fn)} request={threadApi} />
                ))}
              </div>
            )}
            <NativeFilePicker
              state={state}
              draft={draftText}
              request={threadApi}
              onSelect={text => {
                runtime.thread.composer.setText(text);
                setDraftText(text);
              }}
            />
            {quoteNotice && (
              <div className="composer-note" role="status">
                {quoteNotice}
              </div>
            )}
            {voice.consent && (
              <section className="voice-consent" aria-label="啟用瀏覽器聽寫">
                <strong>啟用瀏覽器聽寫？</strong>
                <p>
                  音訊可能送往瀏覽器供應商的語音辨識服務（例如 Google 或 Microsoft），不保證是
                  Microsoft，也不是離線辨識。K 不保存錄音、不使用付費 API。
                </p>
                <div>
                  <button type="button" onClick={voice.decline}>
                    取消
                  </button>
                  <button type="button" onClick={acceptComposerVoice}>
                    同意並開始聽寫
                  </button>
                </div>
              </section>
            )}
            <>
              <QueuedMessages state={state} action={fn => roomAction(threadId, fn)} request={threadApi} />
              <ComposerPrimitive.Root className="composer-card">
                <div className="attachment-row">
                  {uploads.map((a, i) => (
                    <div className="file-chip attachment-chip" title={a.name} key={a.id ?? i}>
                      <AttachmentLabel name={a.name} />
                      {(a.loading || a.warning) && (
                        <small>
                          {a.loading
                            ? a.progress === 100
                              ? '電腦正在保存…'
                              : `正在上傳${a.progress === undefined ? '…' : ` ${a.progress}%`}`
                            : a.warning}
                        </small>
                      )}
                      <IconButton
                        title={`移除附件 ${a.name}`}
                        onClick={() => {
                          a.abortController?.abort();
                          setUploads(u => u.filter(x => x !== a));
                        }}
                      >
                        <X size={14} />
                      </IconButton>
                    </div>
                  ))}
                </div>
                <ResponseQuotes
                  quotes={responseQuotes}
                  onChange={mutateResponseQuotes}
                  threadId={threadId}
                  collapse={!!quotePopover}
                  disabled={quoteSending || !!voiceOwner || uploads.some(a => a.loading)}
                  onVoiceActive={reportVoiceActive}
                  claimVoice={claimVoice}
                  voiceOwner={voiceOwner}
                />
                <ComposerPrimitive.Input
                  className="composer-input"
                  placeholder={
                    state.threadId ? (mobile ? '交辦工作…' : '交辦工作，或把檔案拖到這裡…') : '請先建立或開啟對話'
                  }
                  aria-label="工作訊息"
                  readOnly={voice.active || !!voiceOwner}
                  onKeyDown={event => {
                    if (narrowScreen() && event.key === 'Enter') return;
                    const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
                    if (event.key === 'Enter' && composing) return;
                    if ((voice.active || voiceOwner) && event.key === 'Enter') {
                      event.preventDefault();
                      return;
                    }
                    if (
                      shouldSubmitComposerEnter({
                        key: event.key,
                        shiftKey: event.shiftKey,
                        isComposing: composing,
                        keyCode: event.nativeEvent.keyCode
                      })
                    ) {
                      event.preventDefault();
                      queueDraft();
                    }
                  }}
                  minRows={mobile ? 1 : 2}
                  maxRows={mobile ? 5 : 9}
                  submitMode="none"
                  addAttachmentOnPaste={false}
                  onPaste={e => {
                    const files = [...e.clipboardData.files];
                    if (files.length) {
                      e.preventDefault();
                      upload(files);
                    }
                  }}
                />
                <div className="composer-controls">
                  {voice.active ? (
                    <>
                      <button
                        type="button"
                        className="voice-button"
                        aria-label="取消聽寫"
                        title="取消聽寫"
                        onClick={voice.cancel}
                      >
                        <X size={17} />
                      </button>
                      <VoiceWaveform voice={voice} />
                    </>
                  ) : (
                    <div className="composer-options">
                      <IconButton
                        title="加入檔案"
                        disabled={
                          !state.threadId ||
                          blocked ||
                          ['connecting', 'offline', 'error', 'uncertain', 'stopping'].includes(state.status)
                        }
                        onClick={() => fileInput.current.click()}
                      >
                        <Paperclip size={19} />
                      </IconButton>
                      <input
                        type="file"
                        ref={fileInput}
                        multiple
                        hidden
                        onChange={e => {
                          upload([...e.target.files]);
                          e.target.value = '';
                        }}
                      />
                      {mobile && (
                        <button
                          type="button"
                          className="mobile-composer-options"
                          aria-label="對話設定"
                          disabled={!state.threadId || blocked}
                          onClick={onOptions}
                        >
                          <span>{modelButtonLabel}</span>
                          <SlidersHorizontal size={16} />
                          {/danger-full-access|bypassPermissions/.test(effectiveAccessMode) && (
                            <ShieldCheck size={15} className="mobile-access-warning" aria-label="完整存取權" />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        className="composer-model"
                        aria-label="選擇主代理模型"
                        title={modelLabel}
                        disabled={!state.threadId || blocked || state.busy || state.status === 'connecting'}
                        onClick={onChooseModel}
                      >
                        {modelButtonLabel}
                        <ChevronDown size={12} />
                      </button>
                      <PermissionPicker
                        value={effectiveAccessMode}
                        onChange={setAccessMode}
                        disabled={blocked || state.busy || !state.threadId || state.status === 'connecting'}
                        provider={provider}
                        browserEnabled={!!state.browserAccess?.enabled}
                      />
                      {effectiveAccessMode !== (state.accessMode ?? 'workspace-write') && <small>下次送出套用</small>}
                      {provider === 'codex' ? (
                        <ReasoningPicker
                          value={state.busy ? (state.effort ?? '') : effort}
                          currentEffort={state.effort}
                          efforts={state.efforts}
                          onChange={setEffort}
                          fastTier={state.fastTier}
                          serviceTier={state.serviceTier}
                          effectiveServiceTier={state.effectiveServiceTier}
                          busy={state.busy}
                          onTierChange={serviceTier =>
                            roomAction(threadId, () => threadApi('model', {model: state.model, serviceTier}))
                          }
                          disabled={
                            blocked ||
                            state.busy ||
                            ['connecting', 'offline', 'error', 'uncertain'].includes(state.status)
                          }
                        />
                      ) : (
                        provider !== 'claude' && (
                          <label className="composer-effort">
                            <span className="sr-only">推理程度</span>
                            <select
                              aria-label="推理程度"
                              value={state.busy ? (state.effort ?? '') : effort}
                              onChange={e => setEffort(e.target.value)}
                              disabled={state.busy}
                            >
                              <option value="">
                                沿用設定{state.effort ? `（${effortName[state.effort] ?? state.effort}）` : ''}
                              </option>
                              {state.efforts?.map(e => (
                                <option key={e} value={e}>
                                  {effortName[e] ?? e}
                                </option>
                              ))}
                            </select>
                          </label>
                        )
                      )}
                    </div>
                  )}
                  <div className="composer-send-actions">
                    {voice.active ? (
                      <>
                        <button
                          type="button"
                          className="voice-button"
                          aria-label="停止聽寫"
                          title="停止聽寫並填入文字"
                          disabled={voice.phase !== 'recording'}
                          onClick={() => voice.stop(false)}
                        >
                          <Square size={15} />
                        </button>
                        {!remoteClient && (
                          <button
                            type="button"
                            className="send-button"
                            aria-label="轉錄完成後送出"
                            title="轉錄完成後送出"
                            disabled={
                              !voice.canSendOnCompletion ||
                              voice.phase === 'starting' ||
                              blocked ||
                              uploads.some(a => a.loading)
                            }
                            onClick={() => voice.stop(true)}
                          >
                            <ArrowUp size={21} />
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="voice-button"
                          aria-label="開始聽寫"
                          title="開始聽寫；停止會填入文字，箭頭會在轉錄後直接送出"
                          disabled={
                            !state.threadId ||
                            blocked ||
                            ['connecting', 'offline', 'error', 'uncertain'].includes(state.status)
                          }
                          onClick={startComposerVoice}
                        >
                          <Mic size={18} />
                        </button>
                        {state.busy ? (
                          draftText.trim() || responseQuotes.length || uploads.some(a => a.id) ? (
                            <button
                              type="button"
                              className="send-button"
                              aria-label="送出訊息（加入待送）"
                              title="送出訊息（加入待送）"
                              disabled={blocked || !!voiceOwner || uploads.some(a => a.loading)}
                              onClick={queueDraft}
                            >
                              <ArrowUp size={21} />
                            </button>
                          ) : (
                            <ComposerPrimitive.Cancel className="send-button" aria-label="停止工作">
                              <Square size={17} />
                            </ComposerPrimitive.Cancel>
                          )
                        ) : (
                          <button
                            type="button"
                            className="send-button"
                            disabled={
                              !!voiceOwner ||
                              blocked ||
                              uploads.some(a => a.loading) ||
                              ['connecting', 'offline', 'error', 'uncertain', 'stopping'].includes(state.status) ||
                              (!draftText.trim() && !responseQuotes.length && !uploads.some(a => a.id))
                            }
                            aria-label="送出訊息"
                            title="送出（Enter）；換行：Shift + Enter"
                            onClick={queueDraft}
                          >
                            <ArrowUp size={21} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </ComposerPrimitive.Root>
            </>
            {(voice.notice || state.workerConnection === 'failed') && (
              <div className="composer-note">
                <span role="status">{voice.notice || '子代理目前不可用；主代理工作仍可繼續。'}</span>
              </div>
            )}
          </div>
        </ThreadPrimitive.Root>
      </ResponseQuoteContext.Provider>
    </AssistantRuntimeProvider>
  );
});

function App() {
  const [mobile, setMobile] = useState(narrowScreen);
  useEffect(() => {
    const media = window.matchMedia('(max-width:700px)'),
      change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    const viewport = window.visualViewport,
      resize = () =>
        document.documentElement.style.setProperty(
          '--mobile-height',
          Math.round(viewport?.height ?? window.innerHeight) + 'px'
        );
    viewport?.addEventListener('resize', resize);
    resize();
    return () => {
      media.removeEventListener('change', change);
      viewport?.removeEventListener('resize', resize);
    };
  }, []);
  const [appearance, setAppearance] = useState(() => readAppearance());
  const [nativeRefresh, setNativeRefresh] = useState(0);
  useEffect(() => {
    applyAppearance(saveAppearance(appearance));
  }, [appearance]);
  const [receivedState, setState] = useState({messages: [], status: 'idle'}),
    [sessions, setSessions] = useState([]),
    [projects, setProjects] = useState([]),
    [online, setOnline] = useState(false),
    [loginRequired, setLoginRequired] = useState(false),
    [connecting, setConnecting] = useState(remoteClient),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [archiveMessage, setArchiveMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [sidebar, setSidebar] = useState(() => !narrowScreen()),
    [inspector, setInspector] = useState(false),
    [panel, setPanel] = useState('artifacts'),
    [roundtableRun, setRoundtableRun] = useState(null),
    [roundtableReader, setRoundtableReader] = useState(null),
    [panelTabsByThread, setPanelTabsByThread] = useState(() => ({['']: ['artifacts']})),
    [browserInfo, setBrowserInfo] = useState(null),
    [modal, setModal] = useState(null),
    [models, setModels] = useState([]),
    [uploadsByThread, setUploadsByThread] = useState({}),
    [effort, setEffort] = useState(''),
    [accessMode, setAccessMode] = useState('workspace-write'),
    [theme, setTheme] = useState(() => readTheme()),
    [sidebarLayout, setSidebarLayout] = useState(() =>
      readSidebarPreference('k-sidebar-layout', 'grouped', ['grouped', 'flat'])
    ),
    [sidebarSort, setSidebarSort] = useState(() =>
      readSidebarPreference('k-sidebar-sort', 'manual', ['recent', 'manual'])
    ),
    [manualOrder, setManualOrder] = useState(() => readSidebarOrder()),
    [panelWidth, setPanelWidth] = useState(null);
  const roundtableReaderRef = useRef(null),
    seenRuns = useRef(new Map());
  roundtableReaderRef.current = roundtableReader;
  const [navigationTarget, setNavigationTarget] = useState(null);
  const state =
    navigationTarget && (!receivedState.connectionOpening || receivedState.threadId !== navigationTarget.threadId)
      ? {
          ...receivedState,
          ...conversationPreview(
            navigationTarget,
            receivedState.threadId === navigationTarget.threadId ? receivedState : undefined
          )
        }
      : receivedState;
  useEffect(() => {
    if (
      navigationTarget?.settled &&
      receivedState.threadId === navigationTarget.threadId &&
      !receivedState.connectionOpening
    )
      setNavigationTarget(null);
  }, [navigationTarget, receivedState.threadId, receivedState.connectionOpening]);
  const groups = useMemo(() => {
    const list = groupConversationMessages(state.messages);
    for (const group of list) group.latestAssistant = [...group.messages].reverse().find(m => m.role === 'assistant');
    return new Map(list.flatMap(group => group.messages.map(message => [message.id, group])));
  }, [state.messages]);
  useCompletionAttention(state, {online, covered: !!modal || !!state.connectionOpening, api});
  const lastAssistantId = useMemo(
    () => [...(state.messages ?? [])].reverse().find(message => message.role === 'assistant')?.id,
    [state.messages]
  );
  const workspaceDisplayName = path =>
    projects.find(project => sameWorkspace(project.path, path))?.name ?? workspaceName(path);
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const choosePermission = (mode, confirmed = false) => {
    setAccessMode(mode);
    setPermissionConfirmed(confirmed);
  };
  const stateProvider = state.provider ?? providerOf(state.model);
  const currentClaudeMode =
    claudePermissionModes[
      state.accessMode === 'workspace-write'
        ? 'claude-manual'
        : state.accessMode === 'read-only'
          ? 'claude-plan'
          : state.accessMode
    ] ?? claudePermissionModes['claude-manual'];
  const modelName = useCallback(
    m => {
      const model = models.find(x => x.model === m),
        name = model?.displayName || (m === state.model ? state.modelDisplayName : null) || m || '選擇模型',
        provider = model?.provider ?? providerOf(m);
      const source =
        provider === 'claude'
          ? 'Claude 訂閱'
          : provider === 'gemini'
            ? 'Antigravity 訂閱'
            : provider === 'gemma'
              ? '自架'
              : 'Codex 訂閱';
      return `${name} · ${source}`;
    },
    [models, state.model, state.modelDisplayName]
  );
  const modelButtonLabel = m => {
    const model = models.find(x => x.model === m),
      name = model?.displayName || (m === state.model ? state.modelDisplayName : null) || m || '選擇模型',
      provider = model?.provider ?? providerOf(m);
    return provider === 'claude' ? name.replace(/^Claude\s+/i, '') : name;
  };
  const viewMenu = useAnchoredPopover({width: 190}),
    panelMenu = useAnchoredPopover({width: 180});
  const navigationId = useRef(0),
    lock = useRef(false),
    stateRef = useRef(state),
    previewRequest = useRef(0),
    appRef = useRef(null),
    inspectorRef = useRef(null),
    panelDragRef = useRef(false),
    dismissedBrowserPages = useRef(new Map());
  stateRef.current = state;
  const hasNativeDiffs =
    !!state.turnDiffs?.length || (state.tools ?? []).some(tool => tool.patchChanges?.length || tool.hasPatchChanges);
  const activePanelThread = state.threadId ?? '',
    panelTabs = panelTabsByThread[activePanelThread] ?? ['artifacts'];
  const workerPanelRows = [
    ...(state.workers ?? []).filter(row => !row.conversationId || row.conversationId === state.threadId)
  ];
  for (const row of state.workerDetails ?? [])
    if (row.conversationId === state.threadId && !workerPanelRows.some(item => item.requestId === row.requestId))
      workerPanelRows.push(row);
  const setPanelTabs = update =>
    setPanelTabsByThread(previous => {
      const current = previous[activePanelThread] ?? ['artifacts'],
        next = typeof update === 'function' ? update(current) : update;
      return {...previous, [activePanelThread]: next};
    });
  // Presentation state belongs to the selected conversation, not another room's work.
  const panelByThread = useRef(new Map()),
    shownPanelThread = useRef(null);
  const hasBrowserPanel = !!state.browserAccess?.enabled && panelTabs.some(id => id.startsWith('browser:'));
  useEffect(() => {
    if (state.status === 'connecting') return;
    const key = state.threadId ?? '',
      previous = panelByThread.current.get(key);
    const artifacts = state.artifacts ?? [];
    const added = previous && artifacts.some(name => !previous.seenArtifacts.has(name));
    const open = mobile
      ? key === shownPanelThread.current && previous?.open === true
      : added
        ? true
        : (previous?.open ?? (artifacts.length > 0 || hasBrowserPanel));
    // Keep seen names across temporary omissions, so restored files do not reopen a closed panel.
    const seenArtifacts = new Set([...(previous?.seenArtifacts ?? []), ...artifacts]);
    panelByThread.current.set(key, {open, seenArtifacts});
    shownPanelThread.current = key;
    setInspector(open);
    if (added) setPanel('artifacts');
  }, [state.threadId, state.status, state.artifacts, hasBrowserPanel, mobile]);
  const chooseInspector = open => {
    if (mobile && open) setSidebar(false);
    if (!open) setRoundtableReader(null);
    const key = state.threadId ?? '',
      previous = panelByThread.current.get(key);
    panelByThread.current.set(key, {open, seenArtifacts: previous?.seenArtifacts ?? new Set(state.artifacts ?? [])});
    setInspector(open);
  };
  const openRoundtable = useCallback(
    runId => window.dispatchEvent(new CustomEvent('k-open-roundtable', {detail: {threadId: state.threadId, runId}})),
    [state.threadId]
  );
  const readRoundtable = cell => {
    if (mobile && cell && !roundtableReaderRef.current)
      history.pushState({kMobilePanel: true, kRoundtableReader: true}, '');
    if (mobile && !cell && history.state?.kRoundtableReader) {
      history.back();
      return;
    }
    setRoundtableReader(cell);
  };
  useEffect(() => {
    if (panel !== 'roundtable' && roundtableReaderRef.current) readRoundtable(null);
  }, [panel]);
  useEffect(() => {
    const open = event => {
      if (event.detail.threadId !== state.threadId) return;
      setRoundtableRun(event.detail.runId);
      setRoundtableReader(null);
      setPanelTabs(tabs => (tabs.includes('roundtable') ? tabs : [...tabs, 'roundtable']));
      setPanel('roundtable');
      chooseInspector(true);
    };
    window.addEventListener('k-open-roundtable', open);
    return () => window.removeEventListener('k-open-roundtable', open);
  }, [state.threadId, mobile]);
  const uploads = uploadsByThread[state.threadId ?? ''] ?? emptyUploads;
  const setUploads = update => {
    const threadId = state.threadId ?? '';
    setUploadsByThread(previous => {
      const current = previous[threadId] ?? [],
        next = typeof update === 'function' ? update(current) : update;
      return {...previous, [threadId]: next};
    });
  };
  const resizePanelAt = clientX => {
    const app = appRef.current;
    if (!app) return;
    const rect = app.getBoundingClientRect(),
      sidebarWidth = sidebar ? (app.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0) : 0;
    const maximum = Math.max(360, rect.width - sidebarWidth - 420 - 42),
      width = Math.max(360, Math.min(maximum, rect.right - clientX - 10));
    setPanelWidth(width);
  };
  const resizePanelBy = delta => {
    const rect = appRef.current?.getBoundingClientRect(),
      sidebarWidth = sidebar ? (appRef.current?.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0) : 0,
      maximum = Math.max(360, (rect?.width ?? 1200) - sidebarWidth - 462),
      width = inspectorRef.current?.getBoundingClientRect().width ?? Math.round(maximum / 2);
    setPanelWidth(Math.max(360, Math.min(maximum, width + delta)));
  };
  useEffect(() => {
    if (panelWidth === null) return;
    const app = appRef.current;
    if (!app) return;
    const clamp = () => {
      const rect = app.getBoundingClientRect(),
        sidebarWidth = sidebar ? (app.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0) : 0,
        maximum = Math.max(360, rect.width - sidebarWidth - 462);
      setPanelWidth(current => (current === null ? null : Math.min(current, maximum)));
    };
    const observer = new ResizeObserver(clamp);
    observer.observe(app);
    window.addEventListener('resize', clamp);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', clamp);
    };
  }, [panelWidth, sidebar]);
  // Overlapping refreshes can finish out of order; only the latest may update the sidebar, so an older
  // listing never brings back a room that was just archived or renamed.
  const refreshSequence = useRef(0);
  const refresh = async () => {
    const sequence = ++refreshSequence.current;
    const [result, registry] = await Promise.all([api('sessions'), api('projects')]);
    if (sequence !== refreshSequence.current) return;
    setSessions(result.sessions);
    setProjects(registry.projects);
    if (result.unreadable) setNotice(`${result.unreadable} 份舊紀錄無法讀取，已保留原檔。`);
  };
  const action = async fn => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  // Actions inside a room (send, stop, approval, queue, Fast) lock only that room, so work in one room never
  // disables another; only repeats in the same room are suppressed. Sidebar and dialog actions stay global.
  const roomLocks = useRef(new Set()),
    [busyRooms, setBusyRooms] = useState(() => new Set());
  const roomAction = async (threadId, fn) => {
    if (!threadId || roomLocks.current.has(threadId)) return;
    roomLocks.current.add(threadId);
    setBusyRooms(new Set(roomLocks.current));
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      roomLocks.current.delete(threadId);
      setBusyRooms(new Set(roomLocks.current));
    }
  };
  useEffect(() => {
    const disconnect = connectState({
      pauseWhenHidden: remoteClient,
      checkAccess: remoteClient ? remoteLoginRequired : undefined,
      onLoginRequired: setLoginRequired,
      onConnecting: remoteClient ? setConnecting : undefined,
      onEvent: event => {
        setState(previous => applyStateEvent(previous, event));
        if (event.type === 'snapshot') refresh().catch(e => setError(e.message));
      },
      onOnline: setOnline
    });
    return disconnect;
  }, []);
  useEffect(() => {
    if (!mobile || (!sidebar && !inspector)) return;
    const panel = appRef.current?.querySelector(sidebar ? '.sidebar' : '.inspector'),
      main = appRef.current?.querySelector('main'),
      before = document.activeElement;
    if (!panel) return;
    main?.setAttribute('inert', '');
    panel.querySelector('button')?.focus();
    const close = () => {
      setSidebar(false);
      chooseInspector(false);
    };
    const key = e => {
      if (document.querySelector('dialog[open],:popover-open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if (e.key === 'Tab') {
        const items = [
          ...panel.querySelectorAll('button:not([disabled]),a[href],input,select,summary,[tabindex="0"]')
        ].filter(el => el.getClientRects().length);
        if (!items.length) return;
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      main?.removeAttribute('inert');
      if (before?.isConnected) before.focus();
    };
  }, [mobile, sidebar, inspector]);
  const mobileOverlay = mobile && !!(sidebar || inspector || modal);
  useEffect(() => {
    if (!mobileOverlay) return;
    history.pushState({kMobilePanel: true}, '');
    let popped = false;
    const back = () => {
      if (roundtableReaderRef.current) {
        roundtableReaderRef.current = null;
        setRoundtableReader(null);
        return;
      }
      popped = true;
      setModal(null);
      setSidebar(false);
      chooseInspector(false);
    };
    window.addEventListener('popstate', back);
    return () => {
      window.removeEventListener('popstate', back);
      if (!popped && history.state?.kMobilePanel) {
        if (history.state.kRoundtableReader) history.go(-2);
        else history.back();
      }
    };
  }, [mobileOverlay]);
  useEffect(() => {
    refresh().catch(e => setError(e.message));
  }, [state.threadId, state.title, state.model, state.status === 'ready']);
  useEffect(() => {
    previewRequest.current++;
    setModal(current => (['preview', 'goal', 'conversation-options'].includes(current?.type) ? null : current));
    setEffort('');
    setNotice('');
    setAccessMode(state.accessMode ?? 'workspace-write');
    setPermissionConfirmed(false);
    setPanel('artifacts');
    setRoundtableRun(null);
    setRoundtableReader(null);
    setBrowserInfo(null);
  }, [state.threadId]);
  useEffect(() => {
    setEffort('');
  }, [state.model, state.effort]);
  useEffect(() => {
    if (state.busy) setNotice('');
  }, [state.busy]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = saveTheme(theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--k-desk').trim());
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem('k-sidebar-layout', sidebarLayout);
      localStorage.setItem('k-sidebar-sort', sidebarSort);
    } catch {}
  }, [sidebarLayout, sidebarSort]);
  useLayoutEffect(() => {
    if (sidebarSort === 'manual') setManualOrder(order => completeSessionOrder(order, sessions));
  }, [sidebarSort, sessions]);
  useEffect(() => {
    try {
      localStorage.setItem('k-sidebar-manual-order', JSON.stringify(manualOrder));
    } catch {}
  }, [manualOrder]);

  const upload = async files => {
    if (!files.length) return;
    // The phone picker may return before SSE resumes; HTTP validates the upload.
    if (!state.threadId || busy || ['connecting', 'offline', 'error', 'uncertain', 'stopping'].includes(state.status)) {
      setError('請先連線並開啟對話後加入附件。');
      return;
    }
    const threadId = state.threadId;
    for (const file of files) {
      const uploadId = crypto.randomUUID(),
        abortController = new AbortController();
      const pending = {uploadId, name: file.name, loading: true, abortController};
      const update = fn => setUploadsByThread(previous => ({...previous, [threadId]: fn(previous[threadId] ?? [])}));
      update(items => [...items, pending]);
      try {
        const saved = await uploadAttachment(file, threadId, {
          signal: abortController.signal,
          onProgress: ({loaded, total, lengthComputable}) => {
            if (lengthComputable)
              update(items =>
                items.map(a =>
                  a.uploadId === uploadId ? {...a, progress: Math.min(100, Math.floor((loaded / total) * 100))} : a
                )
              );
          }
        });
        update(items => items.map(a => (a.uploadId === uploadId ? saved : a)));
      } catch (e) {
        update(items => items.filter(a => a.uploadId !== uploadId));
        if (!abortController.signal.aborted && stateRef.current.threadId === threadId)
          setError(e.message || '附件上傳失敗，原始檔案與訊息草稿未變更。');
      }
    }
  };
  const open = async s => {
    if (mobile) setSidebar(false);
    if (
      s.threadId === state.threadId &&
      s.model === state.model &&
      state.status === 'ready' &&
      state.workerConnection !== 'failed' &&
      !state.browserAccess?.enabled
    )
      return true;
    const id = ++navigationId.current,
      record = sessions.find(row => row.threadId === s.threadId) ?? s;
    setError('');
    setModal(null);
    setNavigationTarget(record);
    try {
      const result = await api('open', {...s, title: record.title, workspace: record.workspace});
      if (id === navigationId.current)
        setNavigationTarget(current => (!result.superseded && current ? {...current, settled: true} : null));
      return result;
    } catch (e) {
      if (id === navigationId.current) {
        setNavigationTarget(null);
        setError(e.message);
      }
      return false;
    }
  };
  const metadata = async data => {
    await api('metadata', data);
    await refresh();
  };
  const projectMetadata = async data => {
    await api('projects/metadata', data);
    await refresh();
  };
  const updateProjectMetadata = data =>
    action(async () => {
      await projectMetadata(data);
      if (data.archived === true && state.threadId && sameWorkspace(data.path, state.workspace))
        await api('workspace', {path: state.workspace});
    });
  const preview = useCallback(
    async (name, route = 'artifact') => {
      const threadId = state.threadId,
        requestId = ++previewRequest.current;
      setModal({type: 'preview', name, threadId, route, loading: true});
      try {
        const r = await fetch(
          `/api/${route}?path=${encodeURIComponent(name)}&threadId=${encodeURIComponent(threadId ?? '')}`
        );
        if (!r.ok) {
          const e = await r.json();
          throw Error(e.error);
        }
        const result = r.headers.get('content-type')?.startsWith('image/')
          ? {name, image: true}
          : {...(await r.json()), name};
        if (previewRequest.current === requestId && stateRef.current.threadId === threadId)
          setModal({type: 'preview', threadId, route, ...result});
      } catch (e) {
        if (previewRequest.current === requestId && stateRef.current.threadId === threadId) {
          setModal(null);
          setError(e.message);
        }
      }
    },
    [state.threadId]
  );
  const createInProject = path => {
    const visible = projects.filter(p => !p.archived),
      selected = visible.find(p => sameWorkspace(p.path, path ?? state.workspace)) ?? visible[0];
    if (!selected) {
      setNotice('請先按「新增工作區」選擇工作資料夾。');
      return;
    }
    setModal({type: 'new', path: selected.path});
  };
  const latestConclusionId = useMemo(
    () =>
      [...(state.messages ?? [])].reverse().find(message => groups.get(message.id)?.conclusion?.id === message.id)?.id,
    [state.messages, groups]
  );
  const startBranch = useCallback(
    message => {
      if (state.connectionOpening) return;
      const sourceProvider = state.provider ?? providerOf(state.model),
        group = groups.get(message?.id),
        isLatestConclusion = sourceProvider !== 'claude' || group?.conclusion?.id === latestConclusionId;
      setModal({
        type: 'branch',
        threadId: state.threadId,
        messageId: message?.id,
        sourceProvider,
        targetProvider:
          sourceProvider === 'gemini'
            ? 'codex'
            : isLatestConclusion
              ? sourceProvider
              : sourceProvider === 'claude'
                ? 'codex'
                : 'claude',
        isLatestConclusion
      });
    },
    [state.connectionOpening, state.provider, state.model, state.threadId, groups, latestConclusionId]
  );
  const forkConversation = selection =>
    action(async () => {
      const result = await api('fork', {...selection, threadId: modal.threadId});
      if (!result.threadId) throw Error('分支未回傳新對話識別碼。');
      setModal(null);
      setEffort('');
      await refresh();
    });
  const createConversation = selection =>
    action(async () => {
      const workspace = modal.path ?? state.workspace;
      setModal(null);
      if (mobile) setSidebar(false);
      await api('open', {...selection, workspace});
      await refresh();
    });
  const addWorkspace = () =>
    action(async () => {
      const selected = await api('pick-workspace', {path: state.workspace});
      if (selected.cancelled) return;
      if (!selected.path) throw Error('工作區選擇器沒有回傳資料夾。');
      await api('projects', {path: selected.path});
      await refresh();
      setNotice(`已加入工作區：${workspaceName(selected.path)}`);
    });
  const openListed = async session => {
    const result = await open({model: session.model, threadId: session.threadId});
    if (result !== false && result !== undefined) setModal(null);
  };
  const restoreArchived = session =>
    action(async () => {
      await metadata({threadId: session.threadId, archived: false});
      setArchiveMessage(`已將「${session.title || '未命名對話'}」移回「${workspaceDisplayName(session.workspace)}」`);
    });
  const restoreArchivedProject = project =>
    action(async () => {
      await projectMetadata({path: project.path, archived: false});
      setArchiveMessage(`已還原工作區「${project.name}」；其中已封存的對話仍保留在對話封存清單。`);
    });
  const archiveRows = sortSessions(sessions.filter(s => isVisibleMainSession(s) && s.archived));
  const archivedProjectRows = projects.filter(project => project.archived);
  const archiveCount = archiveRows.length + archivedProjectRows.length;
  const searchRows = modal?.type === 'search' ? searchSessions(projects, sessions, modal.query) : [];
  const dateUsed = session =>
    session.lastOpenedAt && Number.isFinite(Date.parse(session.lastOpenedAt))
      ? new Date(session.lastOpenedAt).toLocaleDateString('zh-TW', {year: 'numeric', month: 'numeric', day: 'numeric'})
      : '日期未知';
  const moveToWorkspace = (session, workspace) =>
    action(async () => {
      await api('workspace/move', {threadId: session.threadId, workspace});
      setModal(null);
      await refresh();
    });
  const moveConversation = (session, list, direction) =>
    setManualOrder(order =>
      moveSessionOrder(
        order,
        sessions.filter(s => isVisibleMainSession(s) && !s.archived),
        list,
        session.threadId,
        direction
      )
    );
  const chooseView = (setter, value) => {
    setter(value);
    viewMenu.close();
  };
  const chooseSort = value => {
    if (value === 'manual' && sidebarSort !== 'manual') setManualOrder(completeSessionOrder([], sessions));
    setSidebarSort(value);
    viewMenu.close();
  };
  const openPanel = id => {
    setPanelTabs(tabs => (tabs.includes(id) ? tabs : [...tabs, id]));
    setPanel(id);
    panelMenu.close();
  };
  const closePanel = (id, {dismiss = true} = {}) => {
    if (id === 'artifacts') return;
    if (dismiss && id.startsWith('browser:')) {
      const threadId = stateRef.current.threadId ?? '',
        closed = dismissedBrowserPages.current.get(threadId) ?? new Set(),
        pageId = id === 'browser:current' ? browserInfo?.selectedPageId : id.slice('browser:'.length);
      if (pageId) closed.add(pageId);
      dismissedBrowserPages.current.set(threadId, closed);
    }
    const index = panelTabs.indexOf(id),
      remaining = panelTabs.filter(tab => tab !== id);
    setPanelTabs(remaining);
    if (panel === id) setPanel(remaining[Math.max(0, index - 1)] ?? 'artifacts');
  };
  const addBrowserPanel = () => {
    dismissedBrowserPages.current.delete(stateRef.current.threadId ?? '');
    const browserTabs = panelTabs.filter(id => id.startsWith('browser:'));
    if (browserTabs.length) {
      setPanel(browserTabs.at(-1));
    } else openPanel('browser:current');
    panelMenu.close();
  };
  const browserStateChanged = (id, data) => {
    setBrowserInfo(data);
    if (id === 'browser:current' && data?.selectedPageId) {
      const target = `browser:${data.selectedPageId}`;
      setPanelTabs(tabs =>
        tabs.includes(target) ? tabs.filter(tab => tab !== id) : tabs.map(tab => (tab === id ? target : tab))
      );
      setPanel(current => (current === id ? target : current));
    }
  };
  useEffect(
    () =>
      window.kBrowser?.onPageChanged?.(event => {
        if (event?.refresh) setNativeRefresh(value => value + 1);
      }),
    []
  );
  const disabled = busy || state.status === 'connecting' || !online;

  useEffect(() => {
    const d = state.discussion,
      threadId = state.threadId;
    if (!threadId || state.connectionOpening || state.status === 'connecting') return;
    let seen = seenRuns.current.get(threadId);
    if (!seen) {
      seen = new Set((d?.runs ?? []).map(run => run.id));
      if (d?.busy) seen.delete(d.id);
      seenRuns.current.set(threadId, seen);
    }
    if (!d?.id || seen.has(d.id)) return;
    seen.add(d.id);
    if (!mobile) openRoundtable(d.id);
  }, [
    state.threadId,
    state.connectionOpening,
    state.status,
    state.discussion?.id,
    state.discussion?.busy,
    mobile,
    openRoundtable
  ]);
  const messageIndex = useMemo(
    () => new Map((state.messages ?? []).map(message => [message.id, message])),
    [state.messages]
  );
  const userTurnIndex = useMemo(() => {
    const index = new Map();
    for (const message of state.messages ?? [])
      if (message.role === 'user' && !index.has(message.turnId)) index.set(message.turnId, message);
    return index;
  }, [state.messages]);
  // Which main model wrote each reply, replayed from the recorded switches. Claude keeps no switch record,
  // so its replies stay without a model here and show only the provider. A branch does not carry the
  // source room's switches and the view has no fork boundary, so its replies get a model only after a
  // switch recorded in the branch itself; earlier ones, inherited or not, show only the provider.
  const replyModels = useMemo(() => {
    const index = new Map(),
      changes = state.modelChanges ?? [];
    let model = state.parentThreadId ? null : (changes[0]?.fromModel ?? state.lastUsedModel ?? null);
    for (const message of state.messages ?? []) {
      const change =
        message.role === 'user' && changes.find(c => c.turnId === message.turnId || c.turnId === message.id);
      if (change) model = change.toModel;
      else if (message.role === 'assistant' && model) index.set(message.id, model);
    }
    return index;
  }, [state.messages, state.modelChanges, state.lastUsedModel, state.parentThreadId]);
  // Only transcript inputs invalidate message consumers; background-room activity,
  // quota refresh, draft typing and sidebar updates are not transcript changes.
  const transcriptState = useMemo(
    () => ({
      messages: state.messages,
      tools: state.tools,
      busy: state.busy,
      threadId: state.threadId,
      connectionOpening: state.connectionOpening,
      modelChanges: state.modelChanges,
      model: state.model,
      modelDisplayName: state.modelDisplayName,
      reasoning: state.reasoning,
      capabilities: state.capabilities,
      discussion: state.discussion
    }),
    [
      state.messages,
      state.tools,
      state.busy,
      state.threadId,
      state.connectionOpening,
      state.modelChanges,
      state.model,
      state.modelDisplayName,
      state.reasoning,
      state.capabilities,
      state.discussion
    ]
  );
  const transcript = useMemo(
    () => ({
      state: transcriptState,
      preview,
      modelName,
      models,
      setModels,
      branch: startBranch,
      groups,
      messageIndex,
      userTurnIndex,
      replyModels,
      openRoundtable
    }),
    [
      transcriptState,
      preview,
      modelName,
      models,
      startBranch,
      groups,
      messageIndex,
      userTurnIndex,
      replyModels,
      openRoundtable
    ]
  );
  const alertRaw = error || state.error || '介面暫時斷線；電腦可能仍在工作。恢復連線只讀回狀態，不會重送。',
    alertText = localizeNativeNotice(alertRaw, stateProvider, state.turnError?.error);
  return (
    <TranscriptContext.Provider value={transcript}>
      <AppContext.Provider
        value={{state, preview, modelName, models, setModels, error, branch: startBranch, groups, lastAssistantId}}
      >
        <div
          ref={appRef}
          className={`app ${sidebar ? '' : 'sidebar-hidden'} ${inspector ? '' : 'inspector-hidden'} ${panel.startsWith('browser:') ? 'browser-panel-active' : ''}`}
          style={panelWidth ? {'--inspector-width': `${panelWidth}px`} : undefined}
        >
          {mobile && (sidebar || inspector) && (
            <button
              className="mobile-backdrop"
              aria-label="關閉面板"
              onClick={() => {
                setSidebar(false);
                chooseInspector(false);
              }}
            />
          )}
          <aside
            className="sidebar"
            role={mobile ? 'dialog' : undefined}
            aria-label="工作區與聊天室"
            aria-modal={mobile && sidebar ? true : undefined}
          >
            <div className="brand">
              <img className="brand-icon" src={kLogo} alt="" width="30" height="30" />
              <div>
                K 執行中樞<small>通用工作台</small>
              </div>
              <IconButton title="收合側欄" onClick={() => setSidebar(false)}>
                <>{mobile ? <X size={19} /> : <PanelLeft size={17} />}</>
              </IconButton>
            </div>
            <div className="sidebar-toolbar">
              <button className="new-chat" onClick={() => createInProject()} disabled={disabled}>
                <Plus size={19} /> 新對話
              </button>
            </div>
            <div className="workspace-tools">
              <div className="workspace-heading">
                <span>工作區</span>
                <IconButton title="搜尋對話" onClick={() => setModal({type: 'search', query: ''})}>
                  <Search size={16} />
                </IconButton>
                <div className="view-control">
                  <IconButton
                    className="icon-button sidebar-sort-button"
                    title={`檢視選項：${sidebarSort === 'manual' ? '手動排序' : '最近訊息'}`}
                    aria-expanded={viewMenu.open}
                    ref={viewMenu.trigger}
                    popoverTarget={viewMenu.id}
                    aria-controls={viewMenu.id}
                  >
                    <SlidersHorizontal size={16} />
                    <span>{sidebarSort === 'manual' ? '手動排序' : '最近訊息'}</span>
                  </IconButton>
                  <div
                    ref={viewMenu.popup}
                    id={viewMenu.id}
                    popover="auto"
                    onToggle={viewMenu.onToggle}
                    className="sidebar-view-popover anchored-popover"
                    aria-label="檢視選項"
                  >
                    <strong>分組方式</strong>
                    <button
                      aria-pressed={sidebarLayout === 'grouped'}
                      onClick={() => chooseView(setSidebarLayout, 'grouped')}
                    >
                      {sidebarLayout === 'grouped' && <Check size={14} />}依工作區
                    </button>
                    <button
                      aria-pressed={sidebarLayout === 'flat'}
                      onClick={() => chooseView(setSidebarLayout, 'flat')}
                    >
                      {sidebarLayout === 'flat' && <Check size={14} />}單一清單
                    </button>
                    <span className="view-divider" />
                    <strong>排序方式</strong>
                    <button aria-pressed={sidebarSort === 'recent'} onClick={() => chooseSort('recent')}>
                      {sidebarSort === 'recent' && <Check size={14} />}最近訊息
                    </button>
                    <button aria-pressed={sidebarSort === 'manual'} onClick={() => chooseSort('manual')}>
                      {sidebarSort === 'manual' && <Check size={14} />}手動排序
                    </button>
                    {sidebarSort === 'manual' && <small>在對話選單中使用「上移／下移對話」調整順序。</small>}
                  </div>
                </div>
                <IconButton
                  title={remoteClient ? '新增工作區請在電腦操作' : '新增工作區'}
                  disabled={disabled || remoteClient}
                  onClick={addWorkspace}
                >
                  <FolderPlus size={17} />
                </IconButton>
              </div>
            </div>
            <ProjectSidebar
              {...{projects, sessions, state, disabled, modelName, order: manualOrder}}
              openDisabled={!online}
              conversationActivity={
                state.conversationActivity ??
                sessions.map(session => ({
                  threadId: session.threadId,
                  busy: session.busy,
                  pendingQuestions: session.pendingQuestions
                }))
              }
              layout={sidebarLayout}
              sort={sidebarSort}
              onOpen={open}
              onCreate={createInProject}
              onRename={session => setModal({type: 'rename', session})}
              onMetadata={data => action(() => metadata(data))}
              onMove={moveConversation}
              onMoveWorkspace={moveToWorkspace}
              onChooseWorkspace={session => setModal({type: 'move-workspace', session})}
              onRenameProject={project => setModal({type: 'rename-project', project})}
              onProjectDetails={project => setModal({type: 'project-details', project})}
              onProjectMetadata={updateProjectMetadata}
            />
            <div className="sidebar-bottom">
              <Usage state={state} online={online} onDetails={() => setModal({type: 'usage'})} />
              <button title="設定" onClick={() => setModal({type: 'settings'})}>
                <Settings size={16} /> 設定
              </button>
            </div>
          </aside>
          <main>
            {state.connectionOpening && (
              <div role="status" className="connection-loading">
                {state.historyReady ? '對話已顯示，正在準備連線…' : '正在載入對話…'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    ++navigationId.current;
                    setNavigationTarget(null);
                    api('stop', {cancelOpening: true}).catch(e => setError(e.message));
                  }}
                >
                  取消連線
                </button>
              </div>
            )}
            <header>
              <div className="header-title">
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
                <div>
                  <div className="header-breadcrumb">
                    {state.threadId && (
                      <>
                        <span title={state.workspace}>{workspaceDisplayName(state.workspace)}</span>
                        <span aria-hidden="true">/</span>
                      </>
                    )}
                    <h1>{state.threadId ? state.title || '新對話' : '通用工作台'}</h1>
                  </div>
                  {state.parentThreadId && (
                    <small className="branch-parent">分支自：{state.parentTitle || '原對話'}</small>
                  )}
                </div>
              </div>
              <div className="header-actions">
                <div className="header-status">
                  {remoteClient && (
                    <span className={`remote-connection ${online ? 'connected' : ''}`} role="status">
                      {online
                        ? mobile
                          ? '已連線'
                          : '電腦 K 已連線'
                        : connecting
                          ? '正在同步電腦 K'
                          : '電腦 K 狀態待確認'}
                    </span>
                  )}
                  {!state.connectionOpening && (
                    <>
                      {state.threadId && (
                        <button
                          className={`goal-header${
                            state.goalError ||
                            ['blocked', 'usageLimited', 'budgetLimited', 'failed'].includes(state.goal?.status)
                              ? ' warning'
                              : ['active', 'starting'].includes(state.goal?.status)
                                ? ' active'
                                : ''
                          }`}
                          disabled={!online || busy}
                          onClick={() => setModal({type: 'goal', threadId: state.threadId})}
                        >
                          目標 · {state.goalError ? '待確認' : goalStatusLabel(state.goal)}
                        </button>
                      )}
                      {state.threadId && (
                        <span
                          className="status compaction-count"
                          title="目前聊天室的主代理原生壓縮完成紀錄；不含子代理。舊紀錄不完整或核心未回報時，總次數未知。"
                        >
                          {compactionLabel(state.progress)}
                        </span>
                      )}
                      <WorkerActivityPopover
                        state={state}
                        models={models}
                        loadModels={() => api('models')}
                        onCatalog={setModels}
                        online={online}
                        onViewDetails={() => {
                          openPanel('workers');
                          chooseInspector(true);
                        }}
                      />
                      {!mobile && (
                        <WorkStatus
                          state={state}
                          online={online}
                          connecting={connecting}
                          loginRequired={loginRequired}
                        />
                      )}
                    </>
                  )}
                </div>
                <IconButton title="切換工具與成果面板" onClick={() => chooseInspector(!inspector)}>
                  <PanelRight size={19} />
                </IconButton>
              </div>
            </header>
            {(error || state.error || (!online && !connecting)) && (
              <div className={`alert${remoteClient && !online ? ' remote-disconnected' : ''}`} role="alert">
                <div className="native-notice-content">
                  <span>
                    {loginRequired
                      ? '手機登入已失效（可能已登出、逾期或被電腦端撤銷）。請先複製未送出的草稿，再按「重新登入」輸入存取金鑰；不會停止或重送電腦工作。'
                      : alertText}
                  </span>
                  {!error && state.turnError && state.turnError.error?.message === state.error ? (
                    <details>
                      <summary>查看原生錯誤詳細內容</summary>
                      <pre>{JSON.stringify(state.turnError, null, 2)}</pre>
                      <small>未回報的請求識別碼與建議等待時間維持未知。</small>
                    </details>
                  ) : (
                    !loginRequired &&
                    alertText !== alertRaw && (
                      // A summarized message without a native record still keeps its original text.
                      <details>
                        <summary>查看原始內容</summary>
                        <pre>{alertRaw}</pre>
                      </details>
                    )
                  )}
                </div>
                <IconButton title="關閉提示" onClick={() => setError('')}>
                  <X size={15} />
                </IconButton>
                {remoteClient && !online && (
                  <button className="remote-reconnect" onClick={() => location.reload()}>
                    {loginRequired ? '重新登入' : '重新連線／登入'}
                  </button>
                )}
              </div>
            )}
            {notice && (
              <div className="notice">
                {notice}
                <button onClick={() => setNotice('')}>知道了</button>
              </div>
            )}
            <NativeNotices state={state} error={error || state.error} />
            {state.workerConnection === 'failed' && (
              <div className="notice" role="status">
                {state.workerError || '子代理目前不可用。'} 主代理工作不受影響。
                <button onClick={() => open({threadId: state.threadId, model: state.model})}>重新連線</button>
              </div>
            )}
            <Chat
              mobile={mobile}
              onOptions={() => setModal({type: 'conversation-options', threadId: state.threadId})}
              online={online}
              connecting={connecting}
              loginRequired={loginRequired}
              key={state.threadId || 'empty'}
              blocked={busy || busyRooms.has(state.threadId) || !online}
              onChooseModel={() => setModal({type: 'model', threadId: state.threadId})}
              modelLabel={modelName(state.model)}
              modelButtonLabel={modelButtonLabel(state.model)}
              {...{
                state,
                uploads,
                setUploads,
                upload,
                action,
                roomAction,
                effort,
                setEffort,
                accessMode,
                permissionConfirmed
              }}
              setAccessMode={choosePermission}
            />
          </main>
          {inspector && (
            <div
              className="panel-resizer"
              role="separator"
              aria-label="調整聊天與工作面板寬度"
              aria-orientation="vertical"
              aria-valuenow={Math.round(panelWidth ?? inspectorRef.current?.getBoundingClientRect().width ?? 500)}
              tabIndex={0}
              onPointerDown={event => {
                event.currentTarget.setPointerCapture(event.pointerId);
                panelDragRef.current = true;
                resizePanelAt(event.clientX);
              }}
              onPointerMove={event => {
                if (panelDragRef.current) resizePanelAt(event.clientX);
              }}
              onPointerUp={event => {
                panelDragRef.current = false;
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                panelDragRef.current = false;
              }}
              onKeyDown={event => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  resizePanelBy(event.key === 'ArrowLeft' ? 24 : -24);
                }
              }}
            />
          )}
          <aside
            ref={inspectorRef}
            className="inspector"
            role={mobile ? 'dialog' : undefined}
            aria-label="成果與工作面板"
            aria-modal={mobile && inspector ? true : undefined}
          >
            <div className="mobile-panel-heading">
              <strong>成果與工作</strong>
              <IconButton title="回到聊天室" onClick={() => chooseInspector(false)}>
                <X size={20} />
              </IconButton>
            </div>
            <div className="panel-tabs" role="tablist" aria-label="工作面板">
              <div className="panel-tab-list">
                {panelTabs.map(id => {
                  const page = id.startsWith('browser:')
                    ? browserInfo?.pages?.find(item => item.id === id.slice('browser:'.length))
                    : null;
                  const label = id.startsWith('browser:')
                      ? page?.title || page?.url || '瀏覽器'
                      : id === 'roundtable'
                        ? '圓桌'
                        : id === 'workers'
                          ? '子代理'
                          : '成果',
                    closeTitle = id.startsWith('browser:') ? '關閉瀏覽器分頁檢視；網頁仍會保留' : `關閉${label}分頁`;
                  return (
                    <div className={`panel-tab ${panel === id ? 'active' : ''}`} key={id}>
                      <button role="tab" aria-selected={panel === id} title={label} onClick={() => setPanel(id)}>
                        {label}
                      </button>
                      {id !== 'artifacts' && (
                        <button
                          className="panel-tab-close"
                          aria-label={closeTitle}
                          title={closeTitle}
                          onClick={() => closePanel(id)}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="panel-tab-actions">
                {panel === 'workers' && (
                  <IconButton
                    title="重新查詢子代理"
                    disabled={!state.threadId || busy}
                    onClick={() => action(() => api('workers', {threadId: state.threadId}))}
                  >
                    <RefreshCw size={16} />
                  </IconButton>
                )}
                <div className="panel-add-wrap">
                  <button
                    className="panel-add"
                    aria-label="新增工作面板"
                    ref={panelMenu.trigger}
                    aria-expanded={panelMenu.open}
                    title="新增分頁"
                    popoverTarget={panelMenu.id}
                    aria-controls={panelMenu.id}
                  >
                    ＋
                  </button>
                  <div
                    ref={panelMenu.popup}
                    id={panelMenu.id}
                    popover="auto"
                    onToggle={panelMenu.onToggle}
                    className="panel-add-menu anchored-popover"
                    role="menu"
                  >
                    {!panelTabs.includes('roundtable') && (
                      <button role="menuitem" onClick={() => openPanel('roundtable')}>
                        圓桌
                      </button>
                    )}
                    {!panelTabs.includes('workers') && (
                      <button role="menuitem" onClick={() => openPanel('workers')}>
                        子代理
                      </button>
                    )}
                    {!panelTabs.some(id => id.startsWith('browser:')) && (
                      <button role="menuitem" onClick={addBrowserPanel}>
                        瀏覽器
                      </button>
                    )}
                    {panelTabs.includes('roundtable') &&
                      panelTabs.includes('workers') &&
                      panelTabs.some(id => id.startsWith('browser:')) && <span className="muted">所有分頁已開啟</span>}
                  </div>
                </div>
                <IconButton title="收合工作面板" onClick={() => chooseInspector(false)}>
                  <PanelRightClose size={16} />
                </IconButton>
              </div>
            </div>
            <div className="panel-body">
              {panel === 'roundtable' && (
                <DiscussionRoundtable
                  key={state.threadId}
                  state={state}
                  mobile={mobile}
                  runId={roundtableRun}
                  onRun={setRoundtableRun}
                  reader={roundtableReader}
                  onReader={readRoundtable}
                  onStop={runId => action(() => api('stop', {threadId: state.threadId, runId}))}
                  onTarget={(runId, target) => {
                    if (mobile) chooseInspector(false);
                    window.dispatchEvent(
                      new CustomEvent('k-discussion-target', {detail: {threadId: state.threadId, runId, target}})
                    );
                  }}
                />
              )}
              {panel === 'artifacts' && (
                <>
                  {state.artifacts?.map(name => (
                    <div className="artifact-card" key={name}>
                      <span className="artifact-icon">
                        <FileText size={20} />
                      </span>
                      <div>
                        <strong>{name.split('/').at(-1)}</strong>
                        {name !== name.split('/').at(-1) && <small>{name}</small>}
                        <div className="artifact-actions">
                          <button onClick={() => preview(name)}>預覽</button>
                          <a
                            href={`/api/artifact?path=${encodeURIComponent(name)}&threadId=${encodeURIComponent(state.threadId ?? '')}&download=1`}
                            className="icon-button"
                            aria-label={`下載 ${name}`}
                            title="下載"
                          >
                            <Download size={16} />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!state.artifacts?.length && (
                    <div className="panel-empty">
                      <Folder />
                      <p>尚無成果檔案</p>
                      <small>工作完成後，產生的檔案會顯示於此。</small>
                    </div>
                  )}
                  {(hasNativeDiffs || state.capabilities?.review === true) && (
                    <details className="on-demand-panel">
                      <summary>檔案變更與檢視</summary>
                      {hasNativeDiffs && <NativeDiffs state={state} />}
                      {state.capabilities?.review === true && (
                        <NativeReview
                          state={state}
                          request={(route, data = {}) => api(route, {...data, threadId: state.threadId})}
                          action={action}
                        />
                      )}
                    </details>
                  )}
                  {!!state.progress?.plan?.length && (
                    <details className="on-demand-panel">
                      <summary>工作計畫</summary>
                      <ol className="simple-plan">
                        {state.progress.plan.map((step, i) => (
                          <li key={`${i}-${step.step}`}>
                            {step.step}
                            <small>
                              {{
                                pending: '待處理',
                                inProgress: '進行中',
                                in_progress: '進行中',
                                running: '進行中',
                                completed: '已完成',
                                done: '已完成'
                              }[step.status] ?? '未確認'}
                            </small>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </>
              )}
              {panel === 'workers' && (
                <>
                  {workerPanelRows.map(w => {
                    const detail =
                      state.workerDetails?.find(
                        row => row.conversationId === state.threadId && row.requestId === w.requestId
                      ) ?? w;
                    return (
                      <article className="worker-card" key={w.requestId}>
                        <WorkerHealthLabel worker={detail} online={online} />
                        {w.task && <p>{w.task}</p>}
                        {w.outputFiles?.length > 0 && <small>交付 {w.outputFiles.length} 個檔案</small>}
                        {w.output && (
                          <details>
                            <summary>查看交付摘要</summary>
                            <p>{w.output}</p>
                          </details>
                        )}
                        <WorkerDetails worker={detail} />
                        {['unresolved', 'unavailable'].includes(w.status) && (
                          <p className="worker-warning">原工作狀態未確認；請勿直接重派。</p>
                        )}
                      </article>
                    );
                  })}
                  {!workerPanelRows.length && (
                    <div className="panel-empty">
                      <Activity />
                      <p>目前沒有子代理工作</p>
                      <small>啟動子代理後，工作狀態與交付結果會顯示於此。</small>
                    </div>
                  )}
                </>
              )}
              {panelTabs
                .filter(id => id.startsWith('browser:'))
                .map(id => (
                  <div className="panel-browser-slot" key={id} hidden={panel !== id}>
                    <BrowserPanel
                      threadId={state.threadId}
                      enabled={state.browserAccess?.enabled === true}
                      visible={inspector && panel === id}
                      refreshKey={nativeRefresh}
                      pageId={id === 'browser:current' ? null : id.slice('browser:'.length)}
                      onState={data => browserStateChanged(id, data)}
                    />
                  </div>
                ))}
            </div>
          </aside>
          {modal?.type === 'goal' && modal.threadId === state.threadId && (
            <GoalDialog key={modal.threadId} state={state} Modal={Modal} request={api} onClose={() => setModal(null)} />
          )}
          {modal?.type === 'usage' && (
            <Modal title="額度與用量" onClose={() => setModal(null)}>
              <UsageDetails state={state} online={online} />
              <div className="modal-actions">
                <button onClick={() => setModal(null)}>完成</button>
              </div>
            </Modal>
          )}
          {modal?.type === 'new' && (
            <Modal title="新對話" onClose={() => setModal(null)}>
              <label className="setting-row">
                <span>工作區</span>
                <select
                  aria-label="新對話工作區"
                  value={modal.path ?? state.workspace}
                  onChange={e => setModal(m => ({...m, path: e.target.value}))}
                >
                  {projects
                    .filter(p => !p.archived)
                    .map(p => (
                      <option key={p.path} value={p.path}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <ModelPicker
                currentModel={state.model}
                disabled={disabled}
                loadModels={() => api('models')}
                onCatalog={setModels}
                onClose={() => setModal(null)}
                onCreate={createConversation}
              />
            </Modal>
          )}
          {modal?.type === 'search' && (
            <Modal title="搜尋對話" onClose={() => setModal(null)}>
              <p className="modal-description">
                搜尋對話標題、工作區與模型名稱；不搜尋訊息內文。已封存的對話也會列出。
              </p>
              <label className="sidebar-dialog-search">
                <Search size={16} />
                <input
                  data-autofocus
                  autoFocus
                  aria-label="搜尋標題、工作區或模型"
                  placeholder="輸入標題、工作區或模型"
                  value={modal.query}
                  onChange={e => setModal(m => ({...m, query: e.target.value}))}
                />
                <IconButton title="清除搜尋" disabled={!modal.query} onClick={() => setModal(m => ({...m, query: ''}))}>
                  <X size={14} />
                </IconButton>
              </label>
              <div className="dialog-session-list search-results">
                {searchRows.map(s => (
                  <button className="search-result" key={s.threadId} disabled={disabled} onClick={() => openListed(s)}>
                    <span className="result-title">
                      <strong>{s.title || '未命名對話'}</strong>
                      {s.archived && <em>已封存</em>}
                    </span>
                    <small>
                      {workspaceDisplayName(s.workspace)} · {modelName(s.model)}
                    </small>
                    <time>{dateUsed(s)}</time>
                  </button>
                ))}
                {modal.query.trim() && !searchRows.length && <p className="dialog-list-empty">沒有符合條件的對話。</p>}
                {!modal.query.trim() && <p className="dialog-list-empty">輸入標題、工作區或模型名稱開始搜尋。</p>}
              </div>
              <div className="modal-actions">
                <button onClick={() => setModal(null)}>關閉</button>
              </div>
            </Modal>
          )}
          {modal?.type === 'archive' && (
            <ArchiveManager
              {...{
                archiveRows,
                archivedProjectRows,
                archiveMessage,
                disabled,
                state,
                workspaceDisplayName,
                dateUsed,
                openListed,
                restoreArchived,
                restoreArchivedProject
              }}
              onClose={() => setModal(null)}
              onBack={() => setModal({type: 'settings'})}
              onDelete={rows =>
                action(async () => {
                  const result = await api('archives/delete', {
                    threadIds: rows.map(row => row.threadId),
                    confirmed: true
                  });
                  await refresh();
                  const failed = result.failed ?? [];
                  setArchiveMessage(
                    `已刪除 ${result.deletedIds?.length ?? 0} 筆 K 對話紀錄（移入資源回收筒）。${failed.length ? ` ${failed.length} 筆未完成：` + failed.map(item => `${rows.find(row => row.threadId === item.threadId)?.title || item.threadId}：${item.error}`).join('；') : ''}`
                  );
                  return result;
                })
              }
            />
          )}
          {modal?.type === 'conversation-options' && modal.threadId === state.threadId && (
            <Modal title="對話設定" onClose={() => setModal(null)}>
              <div className="mobile-conversation-settings">
                <div className="setting-row">
                  <span>主代理模型</span>
                  <button
                    disabled={disabled || state.busy}
                    onClick={() => setModal({type: 'model', threadId: state.threadId})}
                  >
                    {modelName(state.model)}
                    <ChevronDown size={15} />
                  </button>
                </div>
                <div className="setting-row">
                  <span>操作權限</span>
                  <PermissionPicker
                    value={accessMode ?? state.accessMode ?? 'workspace-write'}
                    onChange={choosePermission}
                    disabled={disabled || state.busy}
                    provider={providerOf(state.model)}
                    browserEnabled={!!state.browserAccess?.enabled}
                  />
                </div>
                {providerOf(state.model) === 'codex' ? (
                  <div className="setting-row">
                    <span>推理與速度</span>
                    <ReasoningPicker
                      value={state.busy ? (state.effort ?? '') : effort}
                      currentEffort={state.effort}
                      efforts={state.efforts}
                      onChange={setEffort}
                      fastTier={state.fastTier}
                      serviceTier={state.serviceTier}
                      effectiveServiceTier={state.effectiveServiceTier}
                      busy={state.busy}
                      onTierChange={serviceTier =>
                        action(() => api('model', {threadId: modal.threadId, model: state.model, serviceTier}))
                      }
                      disabled={disabled || state.busy}
                    />
                  </div>
                ) : (
                  providerOf(state.model) !== 'claude' &&
                  state.efforts?.length > 0 && (
                    <label className="setting-row">
                      <span>推理程度</span>
                      <select
                        aria-label="推理程度"
                        value={effort}
                        onChange={e => setEffort(e.target.value)}
                        disabled={disabled || state.busy}
                      >
                        <option value="">沿用設定</option>
                        {state.efforts?.map(e => (
                          <option key={e} value={e}>
                            {effortName[e] ?? e}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                )}
                <p className="modal-description">保留目前對話；變更設定不會自動送出工作。</p>
                <div className="modal-actions">
                  <button onClick={() => setModal(null)}>完成</button>
                </div>
              </div>
            </Modal>
          )}
          {modal?.type === 'model' && (
            <Modal title="切換主代理模型" onClose={() => setModal(null)}>
              <ModelPicker
                mode="switch"
                currentModel={state.model}
                currentEffort={state.effort}
                hasHistory={state.messages?.some(m => m.role === 'user')}
                disabled={disabled}
                loadModels={() => api('models')}
                onCatalog={setModels}
                onClose={() => setModal(null)}
                onCreate={selection =>
                  action(async () => {
                    const result = await api('model', {threadId: modal.threadId, ...selection});
                    setEffort('');
                    setModal(null);
                    setNotice(`已選擇 ${modelName(result.model)}，下一則訊息套用。`);
                    await refresh();
                  })
                }
              />
            </Modal>
          )}
          {modal?.type === 'branch' && (
            <BranchDialog
              key={modal.messageId}
              modal={modal}
              state={state}
              onClose={() => setModal(null)}
              onFork={forkConversation}
            />
          )}
          {modal?.type === 'move-workspace' && (
            <Modal title="移至工作區" onClose={() => setModal(null)}>
              <p className="modal-description">保留這個聊天室的脈絡；後續工作使用新的資料夾與工具，不搬移專案檔案。</p>
              <div className="dialog-session-list">
                {projects
                  .filter(p => !p.archived && projectKey(p.path) !== projectKey(modal.session.workspace))
                  .map(p => (
                    <button
                      key={p.path}
                      disabled={disabled}
                      title={p.path}
                      onClick={() => moveToWorkspace(modal.session, p.path)}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
              <div className="modal-actions">
                <button onClick={() => setModal(null)}>取消</button>
              </div>
            </Modal>
          )}
          {modal?.type === 'rename' && (
            <Rename
              key={modal.session.threadId}
              title="重新命名工作"
              value={modal.session.title}
              label="工作名稱"
              onClose={() => setModal(null)}
              onSave={title =>
                action(async () => {
                  await metadata({threadId: modal.session.threadId, title});
                  setModal(null);
                })
              }
            />
          )}
          {modal?.type === 'rename-project' && (
            <Rename
              key={modal.project.path}
              title="重新命名工作區"
              value={modal.project.name}
              label="工作區顯示名稱"
              onClose={() => setModal(null)}
              onSave={name =>
                action(async () => {
                  await projectMetadata({path: modal.project.path, name});
                  setModal(null);
                })
              }
            />
          )}
          {modal?.type === 'preview' && (
            <Modal title={modal.name.split('/').at(-1)} onClose={() => setModal(null)}>
              {modal.loading ? (
                <p>載入成果…</p>
              ) : modal.image ? (
                <img
                  className="preview-image"
                  src={`/api/${modal.route ?? 'artifact'}?path=${encodeURIComponent(modal.name)}&threadId=${encodeURIComponent(modal.threadId ?? '')}`}
                  alt={modal.name}
                />
              ) : modal.isText ? (
                <pre className="file-preview">{modal.text}</pre>
              ) : (
                <p>此格式請下載後以本機應用程式開啟。</p>
              )}
              {modal.truncated && <p>預覽僅顯示前 256 KiB，下載保留完整內容。</p>}
              <div className="modal-actions">
                <a
                  className="primary"
                  href={`/api/${modal.route ?? 'artifact'}?path=${encodeURIComponent(modal.name)}&threadId=${encodeURIComponent(modal.threadId ?? '')}&download=1`}
                >
                  <Download size={15} />
                  下載完整檔案
                </a>
              </div>
            </Modal>
          )}
          {modal?.type === 'project-details' && (
            <Modal title="工作區詳細資訊" onClose={() => setModal(null)}>
              <h3>{modal.project.name}</h3>
              <p className="modal-description">
                這個工作區的對話預設從下列資料夾讀取檔案及執行工作；實際存取仍受對話權限限制。
              </p>
              <code style={{display: 'block', overflowWrap: 'anywhere', userSelect: 'text'}}>{modal.project.path}</code>
              <div className="modal-actions">
                <button onClick={() => action(() => navigator.clipboard.writeText(modal.project.path))}>
                  複製完整路徑
                </button>
                <button className="primary" onClick={() => setModal(null)}>
                  完成
                </button>
              </div>
            </Modal>
          )}
          {modal?.type === 'settings' && (
            <SettingsDialog
              disabled={disabled}
              theme={theme}
              onTheme={setTheme}
              appearance={appearance}
              onAppearance={setAppearance}
              mobile={mobile}
              archiveCount={archiveCount}
              onUsage={() => setModal({type: 'usage'})}
              onArchive={() => {
                setArchiveMessage('');
                setModal({type: 'archive'});
              }}
              onLogout={() =>
                action(async () => {
                  await api('remote/logout', {});
                  location.replace('/');
                })
              }
              onShutdown={() =>
                action(async () => {
                  await api('shutdown', {});
                  setModal(null);
                  setOnline(false);
                })
              }
              onClose={() => setModal(null)}
            />
          )}
        </div>
      </AppContext.Provider>
    </TranscriptContext.Provider>
  );
}
class ErrorBoundary extends React.Component {
  state = {error: null};
  static getDerivedStateFromError(error) {
    return {error};
  }
  render() {
    if (this.state.error)
      return (
        <div className="fatal">
          <h1>K 介面載入失敗</h1>
          <p>原工作未重新送出，後端可能仍在執行。</p>
          <pre>{this.state.error.message}</pre>
          <button onClick={() => location.reload()}>重新載入介面</button>
        </div>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
