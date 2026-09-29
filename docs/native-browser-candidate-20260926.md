# 真正嵌入瀏覽器候選（2026-09-26）

**最新入口：** 本文件保留各階段候選歷史；其中「未修改正式／尚未驗證」均以該段當時版本為準。最後候選結果見文末「候選最終驗證」。正式入口後續發現並修正 `require.main` 自啟動誤判（候選 fixture 未覆蓋），18:20 正式系統匣啟動、健康狀態及原生視窗已讀回；精確狀態、測試缺口和還原位置以 [正式更新紀錄](native-browser-release-20260926.md) 為準。

## 使用者要求與授權

- 取代每秒截圖的人類控制面板，使用現成瀏覽器元件。AI 平常操作，人類必要時可直接點擊、輸入、捲動、登入及使用彈出視窗；同頁、同登入狀態延續。
- 使用者明確允許僅 K 專案安裝 Electron 與必要相依、建立獨立候選及假資料驗證。不改全域、不搬登入憑證、不登入其他網站。
- 正式更新仍以互動及隔離驗收通過為前提；不能把候選或套件安裝當正式完成。

## 差異與目前狀態

- `package.json` / `package-lock.json`：專案限定 `electron@44.4.5` 開發依賴；`npm install` 回報新增 11 套件、audit 0 vulnerabilities。這不是 Electron 整合的安全驗收。
- `AGENTS.md`：記錄本輪限定授權。
- `scripts/electron-browser-pilot.cjs` / `scripts/verify-electron-browser-pilot.mjs`：獨立假頁測試，不載入正式 K、不連模型、不使用真帳號。
- `src/electron-browser-views.mjs` / `src/electron-scoped-context.mjs`：候選接線，尚未接正式啟動器。

## 已確認的接線限制

現有官方 Playwright MCP 的 `createConnection(config, contextGetter)` 可接受 owner 提供的 context。但目前安裝的 Playwright Electron/CDP 連線會把未知 partition 的 target 歸入 default context。不能把包含 K 人類介面的原始 context 直接交給模型。

候選須驗證：由可信端依 Electron session / WebContents 身分限定頁面集合，建頁與關閉只作用於該對話，原始 context、K UI 頁、跨對話頁與調試端點不得傳给模型。這層接線是 K 的責任，不宣稱 Electron 或 MCP 已自動完成此隔離。

## 安裝過程

初次官方 Node 下載器沒有取得內容，後回報 `TypeError: terminated`，未重跑該程序。改用相同官方 GitHub release URL 下載，已核對 npm 套件附帶 SHA-256，才解壓到專案 `node_modules/electron/dist`。不採第三方鏡像，不借用其他專案執行檔。

- 官方 ZIP：`.runtime/electron-cache/electron-v44.4.5-win32-x64.zip`，158184819 bytes。
- SHA-256：`11C395820A5AAA8EBCC0686B476D0AC98A730274EBFBDC8CF5538A7C2815CB5D`。
- 執行檔版本讀回 44.4.5；沒有更改全域安裝。

## 本輪實測（持續更新，不是正式驗收）

- 基線回歸 `node --test --test-concurrency=1 test/*.test.mjs`：492/492；記錄 `.runtime/electron-cache/regression-before-native.log`。這是原生工作台接線完成前的基線，不代表新面板已驗收。
- 原生基線 `scripts/verify-electron-browser-pilot.mjs`：真 WebContentsView 的 DOM 輸入、捲動、假登入彈窗、session 分離、無 renderer Node 通過。早期使用 Electron GUI stdin EOF 關閉生命週期不正確，曾出現 ERR_FAILED／ECONNRESET；改為 Node 私有 IPC 才正常完成並關閉。失敗紀錄保留。
- 安全負面證據：原始 Playwright default context 包含 owner UI，不能交給 MCP。新增 scoped context 限定已登記的 Electron session + WebContents；陌生頁 CDP、建頁、關閉均限定對話範圍。這是 K 的工具範圍防護，不宣稱是官方預設隔離。
- 原始 TCP 除錯基線只用假資料。後續 `scripts/verify-electron-scoped-pilot.mjs` 已改用 Electron 官方 `--remote-debugging-pipe` 與 inherited handles + 私有 Node IPC，不開 TCP 除錯入口。官方 44.4.5 自帶同一模式測試，且本機已實測 Playwright public transport overload 可用。
- Scoped native MCP 實測：9 個檢查通過，包含官方 MCP 導航／evaluate 同一 native page、人工接手拒絕 MCP、交回後原輸入及假 cookie 仍在、陌生 owner page 拒絕、MCP new tab 仍限定 scope、瀏覽器導航 owner origin 拒絕、關閉 scope 不關閉 owner UI。證據 `.runtime/electron-browser-pilot-20260926/scoped-result-1790410531193.json`。
- 上述人工輸入是測試程式模擬，不是使用者本人操作；不等同正式 Sandboxie + 真模型驗收。
- 真 K React + native workbench 的首輪整合抓到 viewport CSS 名稱不一致造成零高度，已修；後续導航/彈窗整合仍在修驗。測試超時曾由 runner 終止其自己啟動的假資料 Electron，不涉及正式 K。不得用前述 scoped 成功掩蓋完整 UI 尚未通過。
- 使用者看到的 `Invalid webContents. Created window should be connected to webContents passed with options object` 是本輪候選的實作錯誤：自訂 popup createWindow 丟掉了 Electron 傳入的 `options.webContents`，另建一個 renderer。已改為沿用該 WebContents 並設定 sandbox/session 的 override；下一次真 React 候選實測已完成 popup 假登入與關閉，沒有再出現该主程序錯誤。候選測試的 uncaught exception 會寫失敗證據並以失敗退出，不再把主程序錯誤對話框留在桌面；這不是忽略錯誤。
- 上述 UI 失敗已修正：popup 關閉回到原頁、延遲 present/hide 競態及啟動時視窗未顯示均已處理。`.runtime/electron-browser-pilot-20260926/workbench-1790411827247` 的真 React + 原生網頁候選 7 項通過：無快照輪詢、同頁輸入、popup 假登入、下載內容/list/Windows Zone、交回 AI 同步鎖、原生滑鼠接手/輸入/滾輪、網頁無 owner preload。正常結束 exit 0，無 shutdownErrors；僅假資料候選，正式未更新。

## 新增接線檔案

- `src/electron-workbench.mjs`、`src/electron-owner-preload.cjs`：可信 workbench 才有 native present/hide bridge，web page 不載入該 preload。頁面原生 view 與人類輸入遮罩由可信端控制。
- `frontend/native-browser-panel.jsx`、`frontend/browser-panel.jsx`、`frontend/browser-panel.css`：有可信 preload 才走 native panel；現有正式 Chrome 路徑未切換，舊版呈現仍保留可回復。新面板沒有 `/frame` 輪詢或模擬文字／按鍵面板。
- `src/browser-live-session.mjs`、`src/browser-owner-gateway.mjs`、`src/owner-browser-registry.mjs`：可信端才有 ownerPresentation 與同步輸入 gate callback，不放到 HTTP／MCP。
- `src/desktop-server.mjs`：增加可信呼叫者可指定候選 UI assets 目錄，預設位置不變。
- `scripts/electron-workbench-pilot.cjs`：真 K frontend + 假 controller／本機假頁，不呼叫模型，不讀帳號。
- 候選 UI 建置在 `.runtime/electron-native-ui`，不覆寫正式 dist-ui；首次建置的 `frontend/.runtime/native-browser-ui-build` 仍保留，未清理。

## 驗收狀態

- 已有局部通過：真正 WebContentsView／MCP 同頁與假登入、工具接手鎖、owner page 拒絕；詳見上節範圍。
- 已驗證：完整 React native 面板、原生輸入事件、焦點互斥與安全下載；另於完整 Electron 程序關閉後重新啟動，假 cookie 延續通過，A/B cookie 與頁面 scope 分離、切換/關 B 保留 A 也通過。證據 `.runtime/electron-browser-pilot-20260926/scoped-1790412270818`（第一程序 11 項，第二程序 2 項）。測試使用假頁，不代表所有網站接受嵌入式登入。`UnknownVizError` 為測試以 URL 選到另一個正在關閉的同 URL renderer，改用 Target ID 精確對應後通過，失敗記錄保留。
- 已完成（17 時段，詳下節）：AI viewport 等比例貼合、owner modal/選單覆蓋、Sandboxie 對新程序／私有 pipe 的假資料隔離驗證，以及正式啟動器來源接線與候選父子程序測試。
- 尚未完成：真模型同頁及人工接續、隱藏面板時新彈窗回復顯示、正式重啟及 UI 讀回。
- 正式 K 未修改／未重啟；目前不能交付為可用正式版本。

## 官方來源

- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/session
- https://playwright.dev/docs/api/class-electron
- https://playwright.dev/docs/api/class-electronapplication
- https://github.com/electron/electron/blob/v44.4.5/spec/chromium-spec.ts （remote-debugging-pipe）

來源只證明公開 API 存在，不替代本專案的驗收。


## 暫停後續作（17 時段）

- `scoped-1790413166444`：第一程序 14 項及全關閉後第二程序 2 項通過。新增官方 MCP locator 點擊、AI `browser_resize`、原生滑鼠等比例座標、snapshot/screenshot、A/B 分離、關閉人類面板後 AI 仍可 resize/click，以及程序重開假 Cookie 延續。
- `workbench-1790413192147`：真 React + native webview 9 項通過；包含 popup 的 `window.opener.postMessage` 回傳、下載、原生輸入、owner 選單/權限 popover 遮擋、1000/1920px 真視窗截圖。主代理已逐張查看寬窄版。1000px 仍沿用既有浮動成果面板覆蓋聊天設計，沒有在本輪另改整體版面。
- 初次 `enableDeviceEmulation(scale)` 造成原生人類點擊正常、Playwright locator hit-test 錯位；改 CDP scale 仍失敗。最終改以 Electron 原生獨立縮放 `setZoomMode('isolated')` + `setZoomFactor`，由 native Page adapter 設定實體 View 尺寸，不混用 Playwright 的裝置模擬 viewport，雙方點擊與 viewport（整數四捨五入 ±1px）通過。未改上游、未改 DOM CSS、未用 dispatchEvent 假造點擊。
- 完全 detach 的 WebContentsView 會停掉動畫幀，造成背景 locator 穩定性判斷逾時。改為將背景 View 放在不透明 owner UI 的下層並關閉該瀏覽頁的 backgroundThrottling；使用者看不到/點不到背景頁，但 AI 仍能工作。隱藏時焦點轉回 owner，互斥鎖未放寬。
- `src/electron-isolated-launcher.mjs` / `src/electron-isolated-main.cjs`：真 Node 私有 pipe 父程序與 Electron 主入口；session data 只在既有 vault 下。`startIsolatedOwner` 明確傳真正 Node 路徑給沙箱，不把 Electron exe 當 Node 執行代理。
- `scripts/verify-electron-entry-pilot.mjs` 使用真父子入口 + 假 services：握手/顯示、忙碌拒絕停止、重新顯示、正常停止及 Electron exit 0，4 項通過。證據 `vault/native-entry-probe-1790412878503`，ready/open 未輸出 bootstrap URL；不是 source-only 宣稱。
- 獨立 staging 在既有 `trusted-runtime/native-candidate-20260926` 新子目錄，正式 runtime 檔案與 launcher EXE 未覆寫。測試 entry 使用獨立 vault 子目錄，沒有搬憑證、修改 policy/ACL 或新開帳號。
- 中途完整循序回歸 506/506；這不是最後版本回歸，最終測試尚待接線完成後重跑。
- 仍未完成：新程序 Sandboxie 假資料邊界、真模型同頁實測、正式部署及正式讀回。

官方 API 依據：[webContents](https://www.electronjs.org/docs/latest/api/web-contents)、[backgroundThrottling](https://www.electronjs.org/docs/latest/api/structures/web-preferences)。API 說明不取代上述實跑。

### 17:10 後驗收讀回

- 最終當時版本完整循序測試 **506/506**，`.runtime/electron-cache/regression-native-final.log`；後續若再修 UI 則另補針對性回歸。
- `workbench-1790413373983` **10 項通過**：新增官方 MCP 點擊下載連結，真正 Electron download 的列表、內容與 Windows Zone 記錄正常。主代理再次查看此輪 1000px／1920px 真視窗截圖。
- Sandboxie 最終假資料 **5 項通過**：`electron-isolation-1790413383506-38268/result.json`。同一活著的 Node／Electron MZ 正對照可讀，盒內 RPM／NtReadVirtualMemory 0 bytes/access denied，VM_READ／DUP_HANDLE 權限位元未授予；vault 拒讀、工作區可讀寫、47831 人類入口拒絕。`DuplicateHandle(source=0)` 本身不是獨立證據。詳見 [隔離紀錄](../scripts/electron-isolation-20260926.md)。全部假程序退出、8 盒 idle、47831 已釋放；沒有修改隔離政策／ACL。
- 主代理新增 `scripts/verify-electron-model-pilot.mjs`，搭配 `scripts/electron-model-pilot.cjs`，使用真正 staged Electron 主入口、現有官方訂閱及新 state/profile；只核准本機假頁瀏覽器操作，不核准 shell、檔案或外站。
- 初兩次模型目錄測試尚未送模型回合即失败：測試 fixture 把 browser-output／workspace 改成子目錄，與既有唯讀政策基準不符；改用既有已核准根目錄、保留新私有 state/profile，且補拷貝 staging 的工作區讀回腳本後，兩家模型目錄可用。未為測試修改政策。接著第一個 Codex 回合因測試核准器誤認 details 含工具名稱而停止，沒有核准未知請求；依現行 Codex form 契約修正測試核准器。這些是測試接線失敗，不能當真模型通過，也未重送原回合。
- 獨立 source review 找到隱藏面板開新 popup 的事件可能遺失，修正與補測中；在完成前不部署。此為當時狀態，以下記錄後續候選讀回。

## 候選最終驗證（2026-09-26）

本節更新上述未完成項目的後續候選讀回；只記錄隔離候選與假頁結果，不代表正式部署或正式驗收。中途失敗仍保留在前述紀錄及各 runner 證據中。

- 最後一次全套循序回歸 **513/513 通過**，fail 0，記錄 `.runtime/electron-cache/regression-native-release.log`。全套後的 targeted coverage 另有兩份：native 核心 focused **24/24**（`.runtime/electron-cache/native-final-focused.log`）；UI focused **12/12**（`.runtime/electron-cache/native-ui-release-focused.log`，`native-browser-pages.test.mjs`、`native-browser-panel.test.mjs`、`ui-style-guard.test.mjs`）。最終真 React + Electron workbench **14 項通過**，結果 `.runtime/electron-browser-pilot-20260926/workbench-result-1790414452295.json`，runner pipe/stderr `.runtime/electron-browser-pilot-20260926/pipe-run-1790414452399.json`，證據目錄 `.runtime/electron-browser-pilot-20260926/workbench-1790414441796`。這些全套後的定點改動沒有再宣稱重跑 513 項。
- 14 項 workbench 覆蓋首次從未顯示過的 WebContentsView 由官方 MCP 導航、resize、點擊；首次 AI 導航自動呈現原生頁面；同頁人工輸入、popup 假登入共用 session、受控下載、AI/人工同步互斥、原生滑鼠/文字/捲動、browser 無 owner preload、owner UI 遮擋、隱藏時 popup tab、視窗關閉重開後還原同頁，以及 1000/1920px 面板尺寸。結果狀態為 `native-workbench-candidate-pass-not-production-ready`。最後 runner stderr 有一次晚到的 closed-page present 拒絕，沒有崩潰；不宣稱 stderr 空白。
- 首次頁面在尚未顯示時 MCP 點擊曾因 renderer 背景節流卡在等待穩定狀態；候選修正在 `dom-ready` 明確關閉該 WebContents 的 `backgroundThrottling`，並由 owner 在首個 AI 頁面導航時自動打開原生瀏覽面板。完成後由上述 14 項候選 UI 驗證覆蓋。關閉後重開視窗會刷新 presentation state 並恢復同一瀏覽頁；該修正亦包含在最終 UI 結果中。
- Codex 真模型候選：`.runtime/electron-browser-pilot-20260926/model-parent-1790414292788.json` 顯示 Codex `gpt-6-luna`（high）已到 `provider-complete`；但同一父 runner 隨後在 Claude ToolSearch fixture 遇到 `unapproved-tool-observed` 而整體失敗。因此只能記錄 Codex provider-complete，不能把此雙供應商 run 說成整體通過。前面各次 fixture／核准器失敗仍保留，不以後續結果覆寫。
- Claude 獨立候選 run `.runtime/electron-browser-pilot-20260926/model-parent-1790414417011.json` 通過；脫敏證據 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/vault/native-model-1790414377797-5de3f79d-state/native-model-pilot-evidence.json` 記錄 `claude-opus-5-5`（high）兩回合，假頁瀏覽工具操作、人工接手 marker 往返、cookie 往返、native presentation、takeover、release 後鎖回 AI 均完成。Codex 的 provider-complete 與 Claude 的獨立完整通過是兩份不同證據，不合併成同一輪雙模型成功。
- 先前列為待驗的 Sandboxie 新程序假資料邊界已另有 **5 項候選檢查通過**：`.runtime/electron-isolation-1790413383506-38268/result.json`；詳情仍以 [隔離紀錄](../scripts/electron-isolation-20260926.md) 為準。這更新候選進度，不改寫當時的歷史紀錄。
- 上述模型及 UI 測試均限隔離候選與本機假站；不代表真實網站登入相容、不代表使用者本人已實際操作接手，也不代表正式 K 已讀回驗收。正式狀態另列，不由本候選紀錄推定。
