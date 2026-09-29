# 原生瀏覽器最小化後恢復黑畫面（2026-09-27）

## 結論

在本機 fake page + 真 Electron `BaseWindow` + 真 K React workbench candidate 重現：Windows minimize 使瀏覽器 `WebContentsView` 移到 owner UI 下層；restore 後頁面 renderer、URL、DOM、輸入值及假 cookie 仍在，但原生 view 沒有回到 owner UI 上方，所以面板顯示為空白／黑畫面。修正是監聽原生 `restore`，沿用既有 `k-native-browser-page {refresh:true}` 通道，讓 `NativeBrowserPanel` 重置 `lastRect` 並重新 present 同一 page。沒有 reload、重建 page 或修改人類輸入鎖／thread selection。

此因果目前有真 Electron fake-candidate 證據，不等於正式 K 或使用者正式分頁讀回。未部署。

## 最小差異

- `src/electron-workbench.mjs`：增加 `refreshNativePresentation`，只在視窗仍可見、非最小化且 workbench 未關閉時送現有 refresh event；掛到 Electron `restore` event。
- `scripts/electron-workbench-pilot.cjs`：增加 fake-workbench minimize/restore evidence：window lifecycle events、view attachment、同一 Playwright `Page`、URL/DOM/input/fake cookie/zoom/thread/control lock、native page raster。
- `test/native-browser-panel.test.mjs`：保護 restore event 到既有 refreshKey/lastRect reset 的接線。

基線備份：`.runtime/native-minimize-restore-20260927/electron-workbench.before.mjs`（原始 SHA-256 `9C67269F875C69267D7CDCDCD5FAB4357ADF0105ADA82072D4DF7D7B5CF7C453`）；probe 原始副本與 test 基線也留在該目錄。產品 source 未碰 screenshot zoom patch。

## 證據

改動前 fake candidate：`.runtime/electron-browser-pilot-20260926/pipe-run-1790442006551.json`，scope `fake-controller-local-pages-only`；minimize/restore 各一事件，after-restore `attached=false`。URL、同一輸入值、cookie `fake_native_login=ok`、頁面 DOM仍讀得到；`capturePage` 656,970/659,776 pixels 非黑。證據顯示 native view 被隱藏到 owner 下，不是 page renderer 已關閉或資料遺失。

改動後相同 public workbench fixture：`.runtime/electron-browser-pilot-20260926/pipe-run-1790442279192.json`，證據目錄 `.runtime/electron-browser-pilot-20260926/workbench-1790442268774`。restore event=1、restore後 `attached=true`、`samePage=true`；URL、輸入、假 cookie、zoom、thread id、`humanInputAllowed=false` 均與 minimize 前相同。candidate 回報 14 項通過；productionChanged=false。視窗合成截圖 `workbench-1790442268774/window-after-minimize-restore.png` 已目視確認右側同一假網頁可見，而非黑畫面。

可重跑：`$env:K_SKIP_FIRST_HIDDEN_PAGE_PROBE='1'; node scripts/verify-electron-scoped-pilot.mjs workbench`。該變數只略過既有且與本任務無關的首個未呈現 page resize preflight；不代表該路徑通過。未略過時該舊 preflight 在到達 workbench UI 前已失敗：`pipe-run-1790441941848.json` 記錄 requested 1280×720、actual 1024×768。測試完成後應移除該 process 環境變數。

## 驗證與限制

- 有跑真 Electron workbench candidate（fake controller、localhost page）；不是只跑 source-only surrogate。
- 有跑定點 Node tests：`node --test test/native-browser-panel.test.mjs test/electron-workbench-icon.test.mjs`。
- candidate runner stderr 仍有三筆 `Browser bounds exceed owner window`，發生於其他 resize/present 競態；沒有在本任務擴修。故只確認 minimize/restore 回復路徑，不宣稱整個 workbench run stderr clean。
- 沒有讀正式 K／正式分頁／登入資料；沒有部署、重啟正式 K、安裝套件或改權限。正式使用者 black-screen 尚待主代理驗收與正式讀回。



