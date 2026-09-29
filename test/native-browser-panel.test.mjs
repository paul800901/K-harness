import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('native browser panel uses a live viewport and keeps screenshot controls legacy-only',async()=>{
 const wrapper=await readFile(new URL('../frontend/browser-panel.jsx',import.meta.url),'utf8');
 const panel=await readFile(new URL('../frontend/native-browser-panel.jsx',import.meta.url),'utf8');
 assert.match(wrapper,/window\.kBrowser\?\.present==='function'/);
 assert.match(wrapper,/NativeBrowserPanel/);
 assert.match(panel,/data-native-browser-viewport/);
 assert.match(panel,/window\.kBrowser\.present\(/);
 assert.match(panel,/window\.kBrowser\?\.hide\?/);
 assert.doesNotMatch(panel,/onPageChanged/);
 assert.match(panel,/ResizeObserver/);
 assert.match(panel,/const schedule=\(\)=>\{if\(alive&&!raf\)/);
 assert.match(panel,/viewId:viewId\.current/);
 assert.match(panel,/urlDirty\.current/);
 assert.match(panel,/syncUrl\(selected\.url/);
 assert.match(panel,/\/api\/browser\/state/);
 assert.match(panel,/\/api\/browser\/action/);
 assert.doesNotMatch(panel,/\/api\/browser\/frame/);
 assert.doesNotMatch(panel,/type:'text'|type:'key'|type:'scroll'/);
 assert.doesNotMatch(panel,/browser-text-form|browser-key-controls|browser-scroll-controls/);
});

test('native overlay suspends for owner menus and dialogs while app reconciles native pages',async()=>{
 const main=await readFile(new URL('../frontend/main.jsx',import.meta.url),'utf8');
 const panel=await readFile(new URL('../frontend/native-browser-panel.jsx',import.meta.url),'utf8');
 assert.match(main,/suspendNativeBrowser=!!\(modal\|\|panelMenuOpen\|\|viewOpen\|\|ownerMenuOpen\|\|ownerPopoverOpen\)/);
 assert.match(main,/suspended=\{suspendNativeBrowser\}/);
 assert.match(main,/setOwnerMenuOpen\(openMenus\(\)\.length>0\)/);
 assert.match(main,/beforetoggle',popoverToggle,true/);
 assert.match(main,/bridge\.onPageChanged/);
 assert.match(main,/fetch\(`\/api\/browser\/state\?threadId=/);
 assert.match(main,/reconcileNativePageChange\(event/);
 assert.match(main,/planNativePagePanelChange\(change,event/);
 assert.match(main,/panelTabsByThread/);
 assert.match(main,/dismissedBrowserPages\.current/);
 assert.doesNotMatch(panel,/onPageChanged/);
 assert.match(main,/if\(page\.select!==false\)setPanel\(id\)/);
 const views=await readFile(new URL('../src/electron-browser-views.mjs',import.meta.url),'utf8');
 const workbench=await readFile(new URL('../src/electron-workbench.mjs',import.meta.url),'utf8');
 assert.match(views,/wc\.on\('did-navigate',reportNavigation\)/);
 assert.match(workbench,/onPageActivated:async \(page,reason='popup-open'\)/);
 assert.match(workbench,/reason\}\);break;/);
});

test('native workbench restore refreshes the existing presentation without replacing the page',async()=>{
 const workbench=await readFile(new URL('../src/electron-workbench.mjs',import.meta.url),'utf8');
 const main=await readFile(new URL('../frontend/main.jsx',import.meta.url),'utf8');
 const panel=await readFile(new URL('../frontend/native-browser-panel.jsx',import.meta.url),'utf8');
 assert.match(workbench,/const refreshNativePresentation=\(\)=>\{if\(closed\|\|closing\|\|!window\.isVisible\(\)\|\|window\.isMinimized\(\)\)return;owner\.webContents\.send\('k-native-browser-page',\{refresh:true\}\);\};/);
 assert.match(workbench,/window\.on\('restore',refreshNativePresentation\)/);
 assert.match(main,/if\(event\.refresh\)\{setNativeRefresh\(value=>value\+1\);return;\}/);
 assert.match(panel,/useEffect\(\(\)=>\{lastRect\.current='';\},\[refreshKey\]\)/);
});
