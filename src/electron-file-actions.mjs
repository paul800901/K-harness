import {execFile} from 'node:child_process';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function openFileWith(target, {ownerHandle, execFileImpl = execFile} = {}) {
  if (process.platform !== 'win32') throw Error('開啟方式選擇器目前僅支援 Windows。');
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = fileURLToPath(new URL('../scripts/open-file-with.ps1', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = execFileImpl(
      executable,
      ['-NoProfile', '-STA', '-NonInteractive', '-File', script],
      {windowsHide: true, encoding: 'utf8', maxBuffer: 65536},
      error => (error ? reject(new Error('無法開啟 Windows 開啟方式選擇器。', {cause: error})) : resolve())
    );
    child.stdin.on('error', () => {}); // execFile reports a spawn failure.
    const parent = ownerHandle
      ? (ownerHandle.length === 8 ? ownerHandle.readBigInt64LE() : ownerHandle.readInt32LE()).toString()
      : '0';
    child.stdin.end(JSON.stringify({path: target, parent}));
  });
}

// Only a native context-menu click can reach these actions. No renderer IPC or
// HTTP endpoint can ask the OS to open an arbitrary Markdown destination.
export function nativeFileMenuItems({electron, window, owner, app, params, isClosing, openWith = openFileWith}) {
  let url;
  try {
    url = new URL(params.linkURL);
    if (
      url.origin !== app?.origin ||
      url.pathname !== '/api/message-file' ||
      !url.searchParams.get('path') ||
      !url.searchParams.get('threadId')
    )
      return [];
  } catch {
    return [];
  }
  const allowed = () => {
    try {
      return (
        !!params.frame &&
        !isClosing() &&
        !window.isDestroyed() &&
        !owner.isDestroyed() &&
        params.frame === owner.mainFrame &&
        new URL(owner.getURL()).origin === app.origin
      );
    } catch {
      return false;
    }
  };
  if (!allowed()) return [];
  const href = url.searchParams.get('path'),
    context = {threadId: url.searchParams.get('threadId')};
  const action = perform => async () => {
    try {
      if (!allowed()) throw Error('原視窗已關閉或離開 K。');
      // Recheck the original conversation at click time, not whichever room is
      // active now. Resolving the path does not read an entire book into memory.
      const target = await app.controller.messageFilePath(href, context);
      if (!(await stat(target)).isFile()) throw Error('這個連結不是一般檔案。');
      if (!allowed()) throw Error('原視窗已關閉或離開 K。');
      await perform(target);
    } catch (error) {
      if (!window.isDestroyed())
        await electron.dialog.showMessageBox(window, {
          type: 'error',
          title: '無法操作檔案',
          message: '檔案操作未完成。',
          detail: error.message,
          buttons: ['確定']
        });
    }
  };
  return [
    {
      label: '用預設程式開啟',
      click: action(async target => {
        const error = await electron.shell.openPath(target);
        if (error) throw Error(error);
      })
    },
    ...(process.platform === 'win32'
      ? [{label: '開啟方式…', click: action(target => openWith(target, {ownerHandle: window.getNativeWindowHandle()}))}]
      : []),
    {label: '在檔案總管中顯示', click: action(target => electron.shell.showItemInFolder(target))},
    {label: '複製完整路徑', click: action(target => electron.clipboard.writeText(target))}
  ];
}
