import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {
  nativeDestinationKind,
  preserveNativeUrl,
  referencesNativeDestination,
  messageFileUrl,
  restoreNativeFileDestinations
} from '../shared/native-content.mjs';
import {readNativeMessageFile} from '../src/native-message-file.mjs';
import {remoteRouteAllowed} from '../src/remote-access.mjs';
import {scratchBase} from './scratch.mjs';

test('native destinations remain exact: Windows, file URI, web, email, custom and unsafe', () => {
  for (const href of [
    'D:/中文/交接.md',
    'D:\\中文\\交接.md',
    'file:///D:/中文/交接.md',
    '../交接.md',
    'https://example.test/a?q=1#x',
    'mailto:me@example.test',
    'tel:+886123',
    'vscode://file/D:/a.js',
    'javascript:alert(1)',
    'data:text/html,<script>x</script>'
  ])
    assert.equal(preserveNativeUrl(href), href);
  assert.equal(nativeDestinationKind('D:/中文/交接.md'), 'file');
  assert.equal(nativeDestinationKind('file:///D:/a.md'), 'file');
  assert.equal(nativeDestinationKind('http://example.test'), 'web');
  assert.equal(nativeDestinationKind('mailto:me@example.test'), 'external');
  assert.equal(nativeDestinationKind('javascript:alert(1)'), 'other');
  assert.ok(messageFileUrl('中文/a.md', 'room').includes('threadId=room'));
  assert.ok(remoteRouteAllowed('GET', '/api/message-file'));
  assert.equal(remoteRouteAllowed('POST', '/api/message-file'), false);
});

test('existing file links need no file-change artifact event; source must be this native assistant', async () => {
  const base = scratchBase;
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'native-content-')),
    workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const target = path.join(root, '已存在 #交接.md');
  await writeFile(target, 'existing native file');
  const state = href => ({workspace, messages: [{role: 'assistant', text: `[交接](<${href}>)`}], artifacts: []});
  for (const href of [target, pathToFileURL(target).href, `${target}#L3`, `${target}:3:2`])
    assert.equal((await readNativeMessageFile(state(href), href)).bytes.toString(), 'existing native file');
  const relative = '../已存在%20%23交接.md';
  assert.equal((await readNativeMessageFile(state(relative), relative)).bytes.toString(), 'existing native file');
  await assert.rejects(readNativeMessageFile({workspace, messages: [{role: 'user', text: `[x](${target})`}]}, target));
  await assert.rejects(readNativeMessageFile({workspace, messages: [{role: 'assistant', text: 'nothing'}]}, target));
  await assert.rejects(readNativeMessageFile(state('javascript:alert(1)'), 'javascript:alert(1)'));
  await assert.rejects(readNativeMessageFile(state(root), root));
});

test('encoded destinations, image links and reference definitions are attributed without unrelated read access', () => {
  assert.ok(
    referencesNativeDestination([{role: 'assistant', text: '![圖片](<中文/已存 圖.png>)'}], '中文/已存%20圖.png')
  );
  assert.ok(referencesNativeDestination([{role: 'assistant', text: '[交接][r]\n[r]: <中文/交接.md>'}], '中文/交接.md'));
  assert.equal(referencesNativeDestination([{role: 'assistant', text: 'arbitrary words x.md'}], 'x.md'), false);
  for (const text of ['[r](D:/a.md (title))', '[r](<D:/a.md> (title))'])
    assert.ok(referencesNativeDestination([{role: 'assistant', text}], 'D:/a.md'));
});

test(
  'Windows slash-prefixed drive links read the original file, including encoded names and line suffixes',
  {skip: process.platform !== 'win32'},
  async () => {
    const root = await mkdtemp(path.join(scratchBase, 'native-drive-'));
    const file = path.join(root, '中文 #交接 (1).md');
    await writeFile(file, 'exact original file');
    const href = '/' + file.replaceAll('\\', '/');
    for (const value of [href, encodeURI(href).replace('#', '%23'), `${href}#L2`, `${href}:2:3`]) {
      const state = {workspace: root, messages: [{role: 'assistant', text: `[檔案](<${value}>)`}]};
      assert.equal((await readNativeMessageFile(state, value)).bytes.toString(), 'exact original file');
      await assert.rejects(readNativeMessageFile({...state, messages: []}, value), /本聊天室/);
    }
  }
);

test('Windows repair preserves parentheses, outer nested links, titles and reference definitions without overriding mismatched nodes', () => {
  const cases = [
    ['link', '[t](D:\\.codex\\report(1).md)', 'D:.codex\\report(1).md', 'D:\\.codex\\report(1).md'],
    ['link', '[t](D:\\.codex\\r.md "title")', 'D:.codex\\r.md', 'D:\\.codex\\r.md'],
    ['link', '[![i](C:\\image.png)](D:\\.codex\\r.md)', 'D:.codex\\r.md', 'D:\\.codex\\r.md'],
    ['definition', '[r]: D:\\.codex\\r.md "title"', 'D:.codex\\r.md', 'D:\\.codex\\r.md'],
    ['link', '[t](D:\\x.md)', 'different.md', 'different.md']
  ];
  for (const [type, value, url, expected] of cases) {
    const node = {type, url, position: {start: {offset: 0}, end: {offset: value.length}}};
    restoreNativeFileDestinations()({children: [node]}, {value});
    assert.equal(node.url, expected, value);
  }
  assert.equal(nativeDestinationKind('D:%5C.codex%5Ca.md'), 'file');
  assert.ok(referencesNativeDestination([{role: 'assistant', text: '[r]: D:/a.md "title"'}], 'D:/a.md'));
});
