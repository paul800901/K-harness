// Real hidden Electron renderer + native context-menu event. OS launch/clipboard
// calls are recorded rather than opening apps, changing clipboard or taking focus.
import electron from 'electron';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {createElectronWorkbench} from '../src/electron-workbench.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {readNativeMessageFile, resolveNativeMessageFile} from '../src/native-message-file.mjs';
import {scratchBase} from './scratch.mjs';

async function run() {
  const out = process.env.K_FILE_MENU_EVIDENCE ?? scratchBase;
  await mkdir(out, {recursive: true});
  const root = await mkdtemp(path.join(scratchBase, 'native-menu-'));
  const file = path.join(root, '中文 #原始檔.md');
  await writeFile(file, 'native renderer preview');
  electron.app.setPath('userData', path.join(root, 'profile'));
  electron.app.setPath('sessionData', path.join(root, 'profile'));
  await electron.app.whenReady();
  const href = '/' + file.replaceAll('\\', '/');
  const state = {
    threadId: 'original-room',
    workspace: root,
    status: 'completed',
    busy: false,
    model: 'gpt-6.1-sol',
    messages: [{id: 'reply', role: 'assistant', text: `[測試檔案](<${href}>)`}],
    tools: [],
    questions: [],
    workers: [],
    artifacts: [],
    capabilities: {}
  };
  const calls = [],
    errors = [],
    menus = [];
  let workbench, menuReady;
  const menuPromise = new Promise(resolve => {
    menuReady = resolve;
  });
  class HiddenWindow extends electron.BaseWindow {
    constructor(options) {
      super({...options, show: false});
    }
    show() {
      calls.push(['startup-show-suppressed']);
    }
    focus() {
      throw Error('Probe must never steal focus');
    }
  }
  const shim = {
    ...electron,
    BaseWindow: HiddenWindow,
    app: {setName() {}, setAppUserModelId() {}},
    shell: {
      openPath: async target => {
        calls.push(['open', target]);
        return '';
      },
      showItemInFolder: target => calls.push(['reveal', target]),
      openExternal: async target => calls.push(['external', target])
    },
    clipboard: {writeText: target => calls.push(['copy', target])},
    dialog: {showMessageBox: async (_window, value) => errors.push(value)},
    Menu: {
      buildFromTemplate(items) {
        const menu = electron.Menu.buildFromTemplate(items);
        menus.push(items);
        return {
          popup() {
            menuReady(menu);
          }
        };
      }
    }
  };
  try {
    workbench = await createElectronWorkbench({
      electron: shim,
      servicesFactory: async () => ({
        app: await startDesktop({
          root,
          port: 0,
          controllerFactory: () => ({
            state,
            models: async () => ({models: []}),
            usage: async () => ({}),
            sessions: async () => ({sessions: []}),
            messageFile: (value, context) => {
              assert.equal(context.threadId, 'original-room');
              return readNativeMessageFile(state, value);
            },
            messageFilePath: (value, context) => {
              assert.equal(context.threadId, 'original-room');
              return resolveNativeMessageFile(state, value);
            },
            close: async () => {}
          })
        })
      })
    });
    const wc = workbench.owner.webContents;
    const rect = await wc.executeJavaScript(`new Promise((resolve, reject) => {
      const timer=setTimeout(()=>{observer.disconnect();reject(Error('file link not rendered'));},10000);
      const check=()=>{const link=document.querySelector('a.inline-file');if(!link)return;
        clearTimeout(timer);observer.disconnect();link.scrollIntoView();const r=link.getBoundingClientRect();
        resolve({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),href:link.href,draggable:link.draggable});};
      const observer=new MutationObserver(check);observer.observe(document.body,{subtree:true,childList:true});check();
    })`);
    assert.equal(rect.draggable, false);
    // Left click goes through the owner preload to the main process and reveals
    // the file; it never opens the in-page preview in the desktop shell.
    await wc.executeJavaScript("document.querySelector('a.inline-file').click()");
    for (let i = 0; i < 100 && calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(calls, [['startup-show-suppressed'], ['reveal', file]]);
    assert.deepEqual(errors, []);
    assert.equal(await wc.executeJavaScript("!!document.querySelector('.file-preview')"), false);
    calls.length = 1;
    let watchdog;
    const boundedMenu = Promise.race([
      menuPromise,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(Error('native context-menu event missing')), 10000);
      })
    ]);
    wc.sendInputEvent({type: 'mouseDown', button: 'right', x: rect.x, y: rect.y, clickCount: 1});
    wc.sendInputEvent({type: 'mouseUp', button: 'right', x: rect.x, y: rect.y, clickCount: 1});
    const menu = await boundedMenu.finally(() => clearTimeout(watchdog));
    assert.deepEqual(
      menu.items.map(i => i.label),
      ['用預設程式開啟', '開啟方式…', '在檔案總管中顯示', '複製完整路徑']
    );
    assert.deepEqual(calls, [['startup-show-suppressed']], 'opening menu alone never launches files');
    for (const label of ['用預設程式開啟', '在檔案總管中顯示', '複製完整路徑'])
      await menus[0].find(i => i.label === label).click();
    assert.deepEqual(calls.slice(1), [
      ['open', file],
      ['reveal', file],
      ['copy', file]
    ]);
    assert.deepEqual(errors, []);
    await writeFile(
      path.join(out, 'native-result.json'),
      JSON.stringify(
        {
          ok: true,
          electron: process.versions.electron,
          nativeMenuEvent: true,
          labels: menu.items.map(i => i.label),
          leftClickReveal: true,
          boundary:
            'Hidden real Electron; native Menu constructed, popup and OS actions intercepted. Open With dialog UI not exercised; no formal state or focus change.'
        },
        null,
        2
      )
    );
    await workbench.close();
    electron.app.exit(0);
  } catch (error) {
    await writeFile(path.join(out, 'native-failure.txt'), error.stack);
    await workbench?.close().catch(() => {});
    electron.app.exit(1);
  }
}
void run().catch(error => {
  console.error(error);
  electron.app.exit(1);
});
