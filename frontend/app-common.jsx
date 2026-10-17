import {X} from 'lucide-react';
import React, {createContext, useContext, useEffect, useId, useRef} from 'react';

export const remoteClient = document.documentElement.dataset.kRemote === 'true';
export const narrowScreen = () => window.matchMedia('(max-width:700px)').matches;

export const emptyUploads = [];
export const AppContext = createContext(null);
export const TranscriptContext = createContext(null);
export const convertMessage = m => ({id: m.id, role: m.role, content: [{type: 'text', text: m.text}]});
export const ResponseQuoteContext = createContext(null);
export const toolStatusName = {
  inProgress: '執行中',
  running: '執行中',
  completed: '已完成',
  failed: '失敗',
  declined: '已拒絕',
  cancelled: '已取消',
  interrupted: '已停止',
  approved: '已核准',
  denied: '已拒絕',
  timedOut: '審查逾時',
  aborted: '審查中止'
};
export const api = async (route, data) => {
  let r, v;
  try {
    r = await fetch(
      `/api/${route}`,
      data === undefined
        ? {}
        : {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-K-Request': '1',
              ...(remoteClient ? {'X-K-Command': crypto.randomUUID()} : {})
            },
            body: JSON.stringify(data)
          }
    );
    v = await r.json();
  } catch {
    throw Error(data === undefined ? '無法讀取電腦狀態。' : '操作結果未確認；沒有自動重送。請重新連線讀回後再決定。');
  }
  if (!r.ok) throw Error(v.error ?? '請求失敗');
  return v;
};
export const readSidebarPreference = (key, fallback, allowed) => {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
};
export const readSidebarOrder = () => {
  try {
    const value = JSON.parse(localStorage.getItem('k-sidebar-manual-order') ?? '[]');
    return Array.isArray(value) ? value.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
export function IconButton({title, children, ...props}) {
  return (
    <button type="button" className="icon-button" title={title} aria-label={title} {...props}>
      {children}
    </button>
  );
}
export function Modal({title, onClose, children}) {
  const {error} = useContext(AppContext) ?? {};
  const ref = useRef(),
    restoreFocus = useRef(null),
    backdropDown = useRef(false),
    headingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    restoreFocus.current = document.activeElement;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[data-autofocus]')?.focus();
    return () => {
      if (dialog.open) dialog.close();
      const target = restoreFocus.current;
      if (target?.isConnected) target.focus();
    };
  }, []);
  const isBackdrop = e => {
    if (e.target !== ref.current) return false;
    const r = ref.current.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onCancel={onClose}
      onPointerDown={e => {
        backdropDown.current = isBackdrop(e);
      }}
      onClick={e => {
        const startedOutside = backdropDown.current;
        backdropDown.current = false;
        if (startedOutside && isBackdrop(e)) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={headingId}>{title}</h2>
        <IconButton title="關閉" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      <div className="modal-body">
        {error && (
          <p className="model-load-error" role="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
