import path from 'node:path';
import {stat, readFile} from 'node:fs/promises';

export const DESKTOP_CONTROL_GUIDANCE =
  'k_desktop 是 Windows 桌面控制，會接管本人的前景視窗、滑鼠與鍵盤。只在本人這次明確要求操作桌面或其他程式時使用；網頁工作優先用 k_browser。本人按 Ctrl+Alt+Shift+Backspace 或移動滑鼠就會收回控制，收回後不要再搶回，改在聊天室說明進度與需要本人決定的事。';

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
    const fileStat = await stat(binding.executable);
    if (!fileStat.isFile()) return null;
    return {
      command: binding.executable,
      args: ['serve', '--exclude-tools', 'PowerShell,FileSystem,Registry,Process,Scrape'],
      env: {ANONYMIZED_TELEMETRY: 'false'}
    };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
    throw error;
  }
}
