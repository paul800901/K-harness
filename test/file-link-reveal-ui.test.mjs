import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {functionInitializer} from './source-text.mjs';
import {readableDestination} from '../shared/native-content.mjs';

const main = await readFile(new URL('../frontend/main.jsx', import.meta.url), 'utf8');
// Exercise the real callback without starting a browser or desktop service.
const reveal = functionInitializer(
  main.replace(/const revealFile = useCallback\(\s*/, 'const revealFile = '),
  'revealFile'
);

test('desktop reveal reports declined or rejected IPC once and does not preview or retry', async () => {
  for (const result of ['handled', 'declined', 'rejected']) {
    const calls = [],
      errors = [];
    const run = vm.runInNewContext(`(${reveal})`, {
      state: {threadId: 'original-room'},
      stateRef: {current: {threadId: 'original-room'}},
      setError: value => errors.push(value),
      window: {
        kBrowser: {
          async revealMessageFile(linkURL) {
            calls.push(linkURL);
            if (result === 'rejected') throw Error('IPC disconnected');
            return result === 'handled';
          }
        }
      }
    });
    const linkURL = 'http://127.0.0.1:45678/api/message-file?path=file.md&threadId=original-room';
    await run(linkURL);
    assert.deepEqual(calls, [linkURL]);
    assert.equal(errors.length, result === 'handled' ? 0 : 1);
    if (result === 'declined') assert.match(errors[0], /來源或原視窗已失效/);
    if (result === 'rejected') assert.match(errors[0], /IPC disconnected/);
  }
});

test('late IPC rejection cannot put the old room error into the newly selected room', async () => {
  const stateRef = {current: {threadId: 'original-room'}},
    errors = [];
  const run = vm.runInNewContext(`(${reveal})`, {
    state: {threadId: 'original-room'},
    stateRef,
    setError: value => errors.push(value),
    window: {
      kBrowser: {
        async revealMessageFile() {
          stateRef.current.threadId = 'other-room';
          throw Error('old request failed');
        }
      }
    }
  });
  await run('original-link');
  assert.deepEqual(errors, []);
});

test('preview title and image alt decode message destinations once while preserving literal artifact names', () => {
  const name = main.match(/const previewName =[\s\S]*?;/)[0],
    previewMarkup = main.slice(main.indexOf("{modal?.type === 'preview'")),
    title = previewMarkup.match(/<Modal title=\{([^}]+)\}/)[1],
    alt = previewMarkup.match(/alt=\{([^}]+)\}/)[1];
  for (const [route, file, expected] of [
    ['message-file', '/E:/%E4%B8%AD%E6%96%87/%E5%9C%96.png', '/E:/中文/圖.png'],
    ['message-file', 'D:\\圖%2520.png', 'D:\\圖%20.png'],
    ['artifact', 'D:\\圖%20.png', 'D:\\圖%20.png'],
    [undefined, 'D:/圖%20.png', 'D:/圖%20.png']
  ]) {
    const display = vm.runInNewContext(`${name}\n({title: ${title}, alt: ${alt}})`, {
      modal: {type: 'preview', route, name: file},
      readableDestination
    });
    assert.equal(display.title, expected.split(/[\\/]/).at(-1));
    assert.equal(display.alt, expected);
  }
});
