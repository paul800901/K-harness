import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeDestinationKind, referencesNativeDestination} from '../shared/native-content.mjs';
import {readPresentedPath} from './desktop-files.mjs';

export async function readNativeMessageFile(state, href) {
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
    name = name.replaceAll('\\', path.sep);
  }
  const target = path.resolve(state.workspace, name);
  return readPresentedPath(target);
}
