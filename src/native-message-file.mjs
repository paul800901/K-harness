import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeDestinationKind, referencesNativeDestination} from '../shared/native-content.mjs';
import {readPresentedPath} from './desktop-files.mjs';

export function resolveNativeMessageFile(state, href) {
  if (
    typeof href !== 'string' ||
    nativeDestinationKind(href) !== 'file' ||
    !referencesNativeDestination(state.messages, href)
  )
    throw Error('這不是本聊天室原生回覆提供的檔案連結。');
  let name = href.replace(/#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/u, '').replace(/:\d+(?::\d+)?$/u, '');
  if (/^file:/iu.test(name)) name = fileURLToPath(name);
  else {
    try {
      name = decodeURIComponent(name);
    } catch {}
    // Markdown sometimes emits URL-style /D:/ paths. On Windows the leading
    // slash otherwise resolves against the current drive, producing D:\D:\...
    if (process.platform === 'win32') name = name.replace(/^\/([a-z]:[\\/])/iu, '$1');
    name = name.replaceAll('\\', path.sep);
  }
  return path.resolve(state.workspace, name);
}

export async function readNativeMessageFile(state, href) {
  return readPresentedPath(resolveNativeMessageFile(state, href));
}
