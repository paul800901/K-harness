import path from 'node:path';
import {stat, readFile} from 'node:fs/promises';

export const DESKTOP_CONTROL_GUIDANCE =
  'k_desktop 是 Windows 桌面控制，會操作本人的前景視窗、滑鼠與鍵盤。只在本人這次明確要求操作桌面或其他程式時使用；網頁工作優先用 k_browser。本人按停止或傳訊息就停手，不自動重做被中斷的動作。';

// Pinned stdio (a ~/.windows-mcp config cannot switch it to HTTP) and no takeover
// monitor: --no-control keeps idle rooms from holding global keyboard/mouse hooks.
// Shell, files, registry and processes stay with the native cores; web stays with k_browser.
const ARGS = [
  'serve',
  '--transport',
  'stdio',
  '--no-control',
  '--exclude-tools',
  'PowerShell,FileSystem,Registry,Process,Scrape'
];

// The owner binds the existing installation once in private state. An editable
// project cannot register a new executable merely by creating matching files.
export async function desktopControlMcp({root, fullAccess} = {}) {
  if (!root || !fullAccess) return null;
  let binding;
  try {
    binding = JSON.parse(await readFile(path.join(root, '.runtime/desktop-control.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!path.isAbsolute(binding?.executable ?? '')) throw Error('桌面控制本機接線位置無效。');
  try {
    if (!(await stat(binding.executable)).isFile()) return null;
    return {command: binding.executable, args: [...ARGS], env: {ANONYMIZED_TELEMETRY: 'false'}};
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
    throw error;
  }
}
