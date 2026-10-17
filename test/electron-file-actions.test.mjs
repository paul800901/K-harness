import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {nativeFileMenuItems, openFileWith} from '../src/electron-file-actions.mjs';
import {resolveNativeMessageFile} from '../src/native-message-file.mjs';
import {messageFileUrl} from '../shared/native-content.mjs';
import {scratchBase} from './scratch.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(scratchBase, 'file-menu-'));
  const file = path.join(root, '中文 #書 (1).md');
  await writeFile(file, 'original file');
  const origin = 'http://127.0.0.1:45678',
    calls = [],
    errors = [];
  const state = {workspace: root, messages: [{role: 'assistant', text: `[書](<${file}>)`}]};
  const frame = {url: origin + '/'};
  let closed = false,
    currentUrl = origin + '/';
  const app = {
    origin,
    controller: {
      messageFilePath(href, context) {
        calls.push(['resolve', href, context]);
        assert.equal(context.threadId, 'original-room');
        return resolveNativeMessageFile(state, href);
      }
    }
  };
  const args = {
    app,
    window: {isDestroyed: () => closed, getNativeWindowHandle: () => Buffer.alloc(8)},
    owner: {mainFrame: frame, isDestroyed: () => closed, getURL: () => currentUrl},
    params: {frame, linkURL: origin + messageFileUrl(file, 'original-room')},
    isClosing: () => closed,
    electron: {
      shell: {
        openPath: async target => {
          calls.push(['open', target]);
          return '';
        },
        showItemInFolder: target => calls.push(['reveal', target])
      },
      clipboard: {writeText: target => calls.push(['copy', target])},
      dialog: {showMessageBox: async (_window, data) => errors.push(data)}
    },
    openWith: async target => calls.push(['open-with', target])
  };
  return {
    args,
    file,
    root,
    state,
    calls,
    errors,
    close: () => {
      closed = true;
    },
    navigate: value => {
      currentUrl = value;
    }
  };
}

test('file menu is inert until the human selects an action and keeps the original room and path', async () => {
  const f = await fixture(),
    items = nativeFileMenuItems(f.args);
  assert.equal(items.length, process.platform === 'win32' ? 4 : 3);
  assert.deepEqual(f.calls, []);
  for (const item of items) await item.click();
  assert.deepEqual(
    f.calls.filter(c => c[0] !== 'resolve'),
    [
      ['open', f.file],
      ...(process.platform === 'win32' ? [['open-with', f.file]] : []),
      ['reveal', f.file],
      ['copy', f.file]
    ]
  );
  assert.equal(f.calls.filter(c => c[0] === 'resolve').length, items.length);
  assert.deepEqual(f.errors, []);
});

test('file actions are unavailable for foreign URLs, missing room, subframes and departed owner', async () => {
  const f = await fixture();
  for (const linkURL of [
    'file:///D:/file.md',
    'https://example.test/api/message-file?path=a&threadId=b',
    f.args.app.origin + '/api/artifact?path=a&threadId=b',
    f.args.app.origin + '/api/message-file?path=a'
  ])
    assert.deepEqual(nativeFileMenuItems({...f.args, params: {...f.args.params, linkURL}}), []);
  for (const frame of [null, undefined, {url: f.args.app.origin}])
    assert.deepEqual(nativeFileMenuItems({...f.args, params: {...f.args.params, frame}}), []);
  f.navigate('about:blank');
  assert.deepEqual(nativeFileMenuItems(f.args), []);
  assert.deepEqual(f.calls, []);
});

test('menu click revalidates native source, file existence and window lifecycle; shell errors are reported once', async () => {
  const f = await fixture(),
    items = nativeFileMenuItems(f.args);
  f.state.messages = [];
  await items[0].click();
  assert.match(f.errors.at(-1).detail, /本聊天室/);
  f.state.messages = [{role: 'assistant', text: `[檔案](<${f.file}>)`}];
  f.args.electron.shell.openPath = async () => 'OS refused to open';
  await items[0].click();
  assert.equal(f.errors.at(-1).detail, 'OS refused to open');
  const missing = path.join(f.root, 'missing.md');
  f.state.messages.push({role: 'assistant', text: `[缺檔](<${missing}>)`});
  const absent = nativeFileMenuItems({
    ...f.args,
    params: {...f.args.params, linkURL: f.args.app.origin + messageFileUrl(missing, 'original-room')}
  });
  await absent[0].click();
  assert.match(f.errors.at(-1).detail, /ENOENT/);
  await mkdir(path.join(f.root, 'folder'));
  f.state.messages.push({role: 'assistant', text: `[資料夾](<${path.join(f.root, 'folder')}>)`});
  const folder = nativeFileMenuItems({
    ...f.args,
    params: {
      ...f.args.params,
      linkURL: f.args.app.origin + messageFileUrl(path.join(f.root, 'folder'), 'original-room')
    }
  });
  await folder[0].click();
  assert.match(f.errors.at(-1).detail, /不是一般檔案/);
  const before = f.calls.length;
  f.close();
  await items[0].click();
  assert.equal(f.calls.length, before);
  assert.equal(f.errors.length, 4);
});

test(
  'Open With passes Unicode and shell-looking file names only as stdin data, with a hidden STA helper',
  {skip: process.platform !== 'win32'},
  async () => {
    const target = 'D:\\中文 & $(not-a-command)\\a #100%.md';
    let request, argsSeen;
    const ownerHandle = Buffer.alloc(8);
    ownerHandle.writeBigInt64LE(42n);
    await openFileWith(target, {
      ownerHandle,
      execFileImpl: (exe, args, options, done) => {
        assert.match(exe, /System32.*powershell.exe$/i);
        argsSeen = args;
        assert.ok(args.includes('-STA'));
        assert.equal(options.windowsHide, true);
        queueMicrotask(() => done(null));
        return {
          stdin: {
            on() {},
            end(value) {
              request = JSON.parse(value);
            }
          }
        };
      }
    });
    assert.deepEqual(request, {path: target, parent: '42'});
    assert.ok(!argsSeen.join(' ').includes(target));
    await assert.rejects(
      openFileWith(target, {
        execFileImpl: (_exe, _args, _options, done) => {
          queueMicrotask(() => done(Error('spawn failed')));
          return {stdin: {on() {}, end() {}}};
        }
      }),
      /選擇器/
    );
  }
);

test(
  'Windows PowerShell helper preserves Unicode, compiles native interop and handles cancellation without changing associations',
  {skip: process.platform !== 'win32'},
  async () => {
    const root = await mkdtemp(path.join(scratchBase, 'open-with-'));
    const file = path.join(root, "中文 & $(noop) # '100%.md");
    await writeFile(file, 'probe');
    const source = await readFile(new URL('../scripts/open-file-with.ps1', import.meta.url), 'utf8');
    const exe = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const run = script =>
      execFileSync(
        exe,
        ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        {
          input: JSON.stringify({path: file, parent: '42'}),
          encoding: 'utf8',
          windowsHide: true
        }
      );
    const output =
      '\n[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @{path=$info.File;parent=$parent.ToInt64();flags=$info.Flags}|ConvertTo-Json -Compress';
    // Compile the real P/Invoke declaration without displaying a dialog.
    const declarationOnly = source.replace(
      '$result = [KOpenWith]::SHOpenWithDialog($parent, [ref]$info)',
      '$result = 0'
    );
    assert.notEqual(declarationOnly, source);
    assert.deepEqual(JSON.parse(run(declarationOnly + output)), {path: file, parent: 42, flags: 4});
    // Keep the complete PowerShell flow; replace only the OS dialog with a C# stub.
    for (const result of [0, -2147023673, -2147467259]) {
      const fake = source
        .replace(/^\s*\[DllImport\([^\n]+\n/m, '\n')
        .replace(
          'public static extern int SHOpenWithDialog(IntPtr parent, ref OPENASINFO info);',
          `public static int SHOpenWithDialog(IntPtr parent, ref OPENASINFO info) { return ${result}; }`
        );
      assert.notEqual(fake, source);
      if (result === -2147467259) assert.throws(() => run(fake), /Command failed/);
      else assert.deepEqual(JSON.parse(run(fake + output)), {path: file, parent: 42, flags: 4});
    }
  }
);
