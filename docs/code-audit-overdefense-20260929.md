# K 程式碼盤點：過度防禦與寫過頭（2026-09-29）

> 執行者：Claude Opus 5.5（在正式 K 的 Claude 聊天室內）。性質：重構前盤點，**只讀＋基準測試**。
> 未修改任何程式碼、未部署、未重啟 K、未提交 git。唯一新增的是本文件、`docs/development-log.md` 一行索引，以及 `.runtime/audit-20260929/`（git 忽略）的測試紀錄。

## 一、結論摘要

規模：src 75 個模組約 600KB（全部逐檔讀過；Sandboxie 與內嵌瀏覽器等已確認不在正式路徑的模組只做結構確認）、前端約 294KB（主檔結構與關鍵行、各輔助模組）、擴充的 K 自寫部分、系統匣啟動器 C#、測試 638 項（實跑）、腳本 49 個（分類）。

最大的問題不是某一行寫錯，而是三種累積：

1. **舊架構撤下後沒拆乾淨**：Sandboxie 隔離、內嵌 Electron 瀏覽器、舊網頁介面、桌面 K 的 DeepSeek 接線都已不在正式路徑，但它們的防禦規則仍掛在正式執行路徑上（例如環境變數白名單、瀏覽器資料夾佔用探測、「沒有隔離執行器就不准跑測試」）。
2. **同一條規則各寫一份、彼此不一致**：狀態字詞、工人狀態清單、推理程度、供應商判斷、存取模式、路徑包含檢查、本機伺服器驗證，各在 5–19 處自寫，「工人是否已結束」至少 7 種寫法、判準不同（例：Codex 控制器切換工作區只擋 status=running 或 Codex 子代理未結束；unified 切換對話則擋任何 settled=false）。
3. **「無法確認就拒絕」疊太多層**：錯誤原因被換成固定句子、連線中不能停止、多個關閉點任何一個無法確認就讓 K 關不掉——安全目標本身合理，但疊加後會把系統卡住，而且卡住時看不出原因。

已確認造成實際影響的有 5 項（第三節 A 級）；另有 6 項會隨使用時間變慢、5 項卡死陷阱、5 項外部一改就壞的耦合。值得保留的防護列在 G 級，重構時不要一起拆。

## 二、能不能在 K 裡面看 K、改 K

可以，但要照順序做：

- **讀、改原始碼是安全的**：正式 K 跑的是部署副本 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/`（系統匣 → electron-isolated-launcher.mjs → electron-isolated-main.cjs；本聊天室的 claude.exe 是該 Electron 的子程序）。改 `D:\K-harness\src` 不會影響正在跑的 K 與本聊天室。
- **例外**：Codex App（另一個程式）直接以 `D:\K-harness\src\mcp-stdio.mjs` 啟動 k_flash 工人（盤點時有 9 個常駐程序）。改動 Pi 工人相關模組（mcp*、dispatcher、worker、coding、files、history、recovery、runtime、workspaces）會影響 Codex App 之後新開的工人，要先測好。
- **生效需要部署＋重啟 K**，而重啟會結束本聊天室的 Claude 程序（對話紀錄保留、可重開，但進行中的工作中斷）。因此應在一批修改完成、測試通過後，由使用者從系統匣重啟，或在明確授權下於工作結尾部署；不在工作途中自行重啟。
- **原始碼已含尚未部署的功能**：`src` 與部署副本相比，claude-controller／claude-host／desktop-controller 不同，shared-knowledge.mjs 只在原始碼（09-28 的共享知識工作）。下一次從原始碼部署會把它一起帶上線。
- **必須先建立 git 基準**：最後一次提交是 09-19（189641e），之後 10 天的 43 個 src 模組、大部分前端／測試／腳本都未納入版本控制。沒有基準提交就沒有可靠的回溯點。

## 三、問題分級清單

### A. 已造成實際影響或功能失效（建議最先修）

| # | 問題 | 位置 | 證據 |
|---|---|---|---|
| A1 | AI 代使用者執行的命令缺少 Windows 環境變數：COMSPEC、PATHEXT、ProgramData、ALLUSERSPROFILE、COMPUTERNAME、NUMBER_OF_PROCESSORS、PROCESSOR_ARCHITECTURE、PSModulePath 等 | electron-isolated-launcher.mjs `electronEnvironment` L16-21 → isolated-launcher.mjs L65-72 → sandboxie-control.mjs `isolatedAgentEnvironment` | 本聊天室 `env` 實測。三層白名單互相吃掉（下一層要挑的變數上一層已刪）。多數工具有預設可退，但依賴系統級設定的工具會出現難解失敗；這是 09-28「移除 Sandboxie 限制」後殘留的隔離邏輯 |
| A2 | Codex App 的 Flash 工人拿到 coding 授權時，`run_tests` 永遠回 `runner-not-configured`，無法跑測試 | coding.mjs `runFixedTests` L106-111；mcp-stdio.mjs L23 建 dispatcher 時不傳 testRunner | 程式讀證：唯一在用的入口從不提供 Sandboxie runner；MCP 說明仍宣稱提供固定測試器 |
| A3 | 正式外部 Chrome 每次建立瀏覽器連線，都先跑 PowerShell＋CIM 列舉所有 Chrome/Edge 程序檢查資料夾佔用，再對同一資料夾做下載歷史 SQLite 整理——但檢查的是 K 自己的 `external-regular` 目錄，不是 Chrome 真正的資料夾 | browser-live-session.mjs `assertProfileIdle` L16-37、getContext L125-128；browser-download-history.mjs | 程式讀證＋vault 設定確認正式走外部 Chrome。同一段唯讀程序掃描在本機實測 1.2–1.9 秒／次（`.runtime/audit-20260929/time-profile-probe.mjs`）；且 CIM 讀不到任一程序命令列時會回報「無法確認瀏覽器資料是否閒置」而失敗 |
| A4 | 錯誤原因被換成固定句子，呼叫端模型看不到真因 | mcp.mjs L46-54（所有 Flash 工具錯誤）、luna-gateway.mjs L22-24、worker.mjs L169（只記錯誤類別名）、mcp-stdio.mjs L28-31 | 程式讀證。檔案越界、輸出已存在、coding 衝突、DeepSeek 401／限流都變成同一句「Request rejected or result unavailable」，模型只能瞎猜或放棄 |
| A5 | 測試在平行負載下不穩 | test/claude-controller.test.mjs（固定 40ms `tick()`）；全套 40 處固定毫秒等待（19 檔） | 基準 638 項中 2 項失敗，單獨重跑兩次皆過、整檔 47/47 |

### B. 會隨使用時間變慢或變脆

| # | 問題 | 位置 | 現況 |
|---|---|---|---|
| B1 | 對話清單紀錄只增不減：每次存檔新建一個檔，每次讀清單讀取並解析整個目錄 | main-sessions.mjs | 正式 state 8 個對話已 147 檔（單一對話 47 檔）；清單讀取在開對話、閒置檢查、每次存檔前都會發生 |
| B2 | Claude 對話每次存檔都重讀、解析「所有」Claude 對話（含完整訊息） | claude-controller.mjs `readRecords`／`persisted()` | 目前 5 檔 1.9MB（最大 867KB）；對話越多、越長越慢 |
| B3 | Luna 子代理關閉時對該對話全部歷史任務逐一 cancel＋讀回（每筆 3–5 次 RPC）；任一筆歷史無法「確認」就拋錯，該對話關不掉 | luna-bridge.mjs `close`／`cancel` L243-302 | 程式讀證（風險推論，非已觀察到的故障） |
| B4 | 臨時開 Codex／Claude 程序只為讀資料：每開一個新 Codex 對話先開一個臨時 app-server 讀模型清單；模型選單、登入狀態每次查詢各開一個；額度每 5 分鐘各開一個 Codex 與 Claude 程序 | desktop-controller.mjs `models()` L334-342、open L415；codex-login.mjs；claude-controller/desktop-controller `usage()` | 程式讀證；清單用的 catalog 控制器永遠沒有 host |
| B5 | 串流時每 60ms 對所有訊息與工具的非文字欄位做 structuredClone＋JSON 比較，含工具的整份檔案差異 | shared/state-stream.mjs | 工具多的長對話，串流 CPU 成本線性上升 |
| B6 | 瀏覽器面板開著時每秒輪詢一次狀態；後端對每個分頁執行 JS 取標題＋新建／關閉一個 CDP session 取上下頁歷史，全部經擴充中繼 | native-browser-panel.jsx L50；browser-live-session.mjs `state()`／`historyForPage` | 分頁越多，對 Chrome 的背景干擾越大 |

### C. 卡死陷阱（防禦規則擋住使用者操作）

| # | 問題 | 位置 |
|---|---|---|
| C1 | 連線中不能停止：`stop()` 在 opening 時直接拋錯；新開的聊天室在連線完成前也不在可操作清單內；前端連線中整個介面 disabled。卡住只能等各步驟逾時（Claude 初始化 15 秒＋預檢子程序；Codex 每步最多 30 秒） | claude-controller.mjs L395、desktop-controller.mjs L280、conversation-controller.mjs `target()`、main.jsx L225 |
| C2 | 多個關閉點「無法確認就拒絕」且沒有強制結束出口：Codex 子代理未確認停止、Luna 歷史無法確認、Claude 登入程序、本機聽寫程序任一卡住 → K_SHUTDOWN_PARTIAL → 系統匣只顯示「K 停止未確認」，只能用工作管理員 | desktop-controller.mjs L600、luna-bridge.mjs、claude-login.mjs L116-120、local-dictation.mjs L179-194、desktop-server.mjs L43-64、KTrayLauncher.cs StopK |
| C3 | 全域操作鎖：任何一個操作進行中，其他點擊無聲忽略、整個介面 disabled；後端另有 focusLock 讓快速切換、改名、刪封存直接報錯 | main.jsx `action` L143；conversation-controller.mjs `focusLock` L25 |
| C4 | 開對話要求前端送來的 model 必須等於存檔，否則「對話設定已更新，請重新整理清單」（外層、內層、Codex 控制器各檢查一次） | conversation-controller.mjs L85、unified-controller.mjs L81、desktop-controller.mjs L406 |
| C5 | K 專用 Chrome 的 native host 斷線後擴充刻意不重試，K 端提示使用者「手動重新載入擴充」 | browser-extension/source/nativeConnection.ts；chrome-native-connection.mjs |

### D. 脆弱耦合（外部一改就壞）

| # | 問題 | 位置 |
|---|---|---|
| D1 | 模型白名單硬寫在前後端兩處（astra/sol/luna、claude-opus-5-5、Claude 推理選項）；新模型上線會被藏起來，違反「主代理可選 Codex 實際提供的模型」 | unified-controller.mjs L68-71、model-picker.jsx L9、claude-controller/claude-host 多處 |
| D2 | 依 Codex 錯誤訊息原文決定分支（`list_turns is not supported yet`、archived 句子、`thread not loaded`、`no rollout found`） | desktop-controller.mjs L448、L494、L519 |
| D3 | 解析 Playwright MCP 給人看的 Markdown 文字找目前分頁、改寫分頁標題；工具說明先附加再由外層正規式刪除 | browser-mcp-stdio.mjs L77-82、L123、L129-153；external-browser-gateway.mjs L25-31 |
| D4 | 用自己的錯誤訊息文字當控制流程 | luna-bridge.mjs L234、dispatcher.mjs L130 |
| D5 | 硬寫路徑：node.exe、候選根目錄（名稱仍是 sandboxie-candidate）、Claude Code 版本門檻 2.1.280 | KTrayLauncher.cs L15-17、isolated-launcher.mjs L11、claude-host.mjs L229 |

### E. 死碼與舊架構殘留（可從執行路徑移除，檔案可在 git 歷史保留）

- E1 Sandboxie：sandboxie-pool／process／stdio-bridge／workspaces／control、isolated-provider-hosts 約 953 行，另有 `runnerIdentity`、`sandboxPolicyForMode`／externalSandbox、`execution:'sandboxie'` 參數散布在 isolated-desktop、desktop-controller、luna-bridge、claude-host、claude-login、coding。
- E2 內嵌 Electron 瀏覽器：electron-browser-views（17KB）、electron-scoped-context、electron-download、electron-workbench 的 nativeGateway／IPC、以 `--remote-debugging-pipe` 啟動 Electron 並由 Node 父程序中繼 CDP。正式用外部 Chrome，但每次啟動仍建立。
- E3 舊 standard 部署：desktop-server 的 `web/` 舊介面資產路由與 standard 模式、browser-live-session 的 HTTP 控制模式＋live.json、browser-live-proxy、browser-mcp-config 的 stdio 模式、LegacyBrowserPanel＋browser-frame.mjs、state-stream 的舊裸 state 相容分支、native-notices 的 externalSandboxNetwork。
- E4 Windows Win+H 聽寫：windows-dictation.mjs、Invoke-KWindowsDictation.ps1、`/api/dictation`（前端已不呼叫）。
- E5 桌面 K 的 Flash 接線：k_flash 在桌面已被 `disabledCodexMcpServer()` 覆蓋，但 flashUsage 仍每 10 秒輪詢、checkMainWorkers／collectWorkerIds／createWorkspaceRuntimeConfig 的 k_flash 設定仍在；isolated-desktop 的 `createWorkerDispatcher` 無呼叫者。（Pi 工人本體仍被 Codex App 使用，不可整包刪。）
- E6 browser-download-history.mjs：舊「Playwright 自啟 Edge」路徑的下載崩潰修補。
- E7 系統匣啟動器的 launchUrl／Chrome `--app` 開啟路徑、isolated-launcher 的 legacy presentation。
- E8 腳本：約 30 個一次性 probe／pilot／verify 腳本（electron-*-pilot、verify-*、browser-*-probe、chrome-*-probe、Sandboxie 試驗），不在任何正式路徑。

### F. 重複與過密（維護成本，重構主體）

- F1 狀態字詞沒有單一定義：對話 status 10 種、工人 status 至少 9 種（同時寫 `cancelled`／`canceled`），可送出／可繼續／閒置的判斷在 input-queue、conversation-controller、unified-controller、claude-controller、desktop-controller 各自手寫且已不一致；推理程度清單 7 份、供應商推導 13 份、`startsWith('claude-')` 19 處、存取模式清單至少 3 份。
- F2 四個本機伺服器（external-browser-gateway、browser-owner-gateway、luna-gateway、native host）各自完整實作 loopback／Host／Origin／Bearer／大小上限／JSON-RPC 驗證；其中兩個瀏覽器 gateway 在同一程序內以 HTTP 互相呼叫。
- F3 控制器四層（conversation → unified → claude/desktop → host）＋ isolated-desktop 對兩層猴補 `selectWorkspace`，同一次切換驗證兩遍；`workers()` 回傳兩種形狀，呼叫端至少 5 處各自相容。
- F4 main.jsx 308 行但 88KB，Chat 的 JSX 單行 7,994 字元、Approval 單行 7,682 字元；claude-controller／desktop-controller 各約 55KB，recordTool 單行 600+ 字元。
- F5 約 72 個測試斷言直接對原始碼文字做正規式比對，重新排版或改名就失敗——重構的主要阻力。
- F6 常數被當設定一路傳遞：`workerPolicy` 永遠是 Luna，卻存進 main-sessions、state 並在 open／fork 驗證。
- F7 保存格式各自一套：main-sessions（append-only）、claude-sessions（整份投影）、ui-message-timing、input-queues、luna-bridge、shared-knowledge、projects，寫入樣板（tmp＋rename、promise 串接）重複 6 份以上。
- F8 文件與執行殘留：README 42KB 開頭堆疊十多段不同日期狀態；development-log 42KB；docs 126 份；擴充 README、local-launcher README 前段已過期。開發目錄 `.runtime` 已達 11GB、485 個項目（測試紀錄、探針、瀏覽器資料、部署副本與多份備份），根目錄另有 8 張截圖；清理須經使用者同意並走資源回收筒。

### G. 值得保留的防護（重構時不要一起拆）

- 可能已有副作用的工作「不自動重送」、送出不確定時標記 uncertain（input-queue、兩個控制器、dispatcher）。
- 不自動切到 API 計費（claude-host 的訂閱檢查、Codex 的 ChatGPT 帳號檢查）——可簡化成單次檢查，但規則保留。
- 原子寫入（暫存檔＋rename）。
- 刪除封存走資源回收筒（archive-delete，符合使用者規則）。
- 下載檔加 Zone.Identifier 標記。
- 本機伺服器的 Host／Origin／cookie／啟動 token 檢查（desktop-server）。
- 原生權限模式、核准只核准單次（desktop-permissions）。

## 四、建議重構順序

每一步都先有測試、可獨立回溯，並依 AGENTS.md 在專案內記錄差異與驗證。

0. **基準**（不改行為）：建立 git 基準提交（需使用者同意）；把 72 個原始碼字串測試改成行為測試或移除；以條件等待取代固定毫秒等待；對 main.jsx 與兩個控制器做純排版（單獨一個提交，測試不變）。
1. **修實際問題**（小而有感）：A1 原生模式改為「完整繼承環境、只剔除 API 憑證變數」；A3 外部 Chrome 路徑移除資料夾佔用探測與下載歷史整理；A4 讓工具錯誤回傳真實原因；A2 依使用者決定讓 Flash 在主機跑固定測試或拿掉 coding 宣稱；B1 main-sessions 改為每對話一檔；B2 依 ID 讀單一投影檔；C1 允許連線中取消。
2. **移除舊路徑**：E1–E7 從執行路徑拿掉（檔案保留在 git 歷史，不動系統元件）；對應測試一併調整。
3. **收斂結構**：建立單一狀態字詞模組（對話狀態、工人是否結束、可否送出）；共用一個 loopback MCP 伺服器工具；兩個瀏覽器 gateway 合一或內層改記憶體傳輸；控制器層數收斂；拆 main.jsx。
4. **依使用者決定**：共享知識去留；強制結束出口；模型白名單改為跟隨官方清單。

## 五、需要使用者決定的事項

1. 是否允許建立 git 基準提交（包含這 10 天未提交的工作與尚未部署的共享知識）。
2. 共享知識（shared-knowledge.mjs，尚未部署）保留、暫停，或延後到重構後再接。
3. Sandboxie、內嵌瀏覽器、舊入口：同意從執行路徑移除並只保留在 git 歷史（不卸載系統元件）。
4. 是否加入「確認後強制結束」出口（現在任何一個關閉點卡住 K 就關不掉）。
5. 模型選單是否改為直接跟隨官方提供的模型，不再由 K 另設白名單。
6. Flash 工人的 `run_tests`：允許在主機直接執行固定 Node 測試，或拿掉 coding 功能宣稱。

## 六、驗證紀錄

- 閱讀：src 全部 75 個模組（Sandboxie 與內嵌瀏覽器模組以結構＋引用關係確認不在正式路徑）；前端 main.jsx 全檔結構與關鍵行、各輔助模組；擴充 nativeConnection 與 native host；KTrayLauncher.cs；測試以模式搜尋＋抽讀。
- 正式路徑確認：執行中程序清單（系統匣 → trusted-runtime → Electron → claude.exe）；原始碼與部署副本 diff；vault 的 `k-browser-assistant.json` 為 enabled。
- 環境實測：本聊天室程序的環境變數清單（見 A1）。
- 狀態檔統計（只看檔名與大小，未讀內容）：main-sessions 147 檔／8 對話；claude-sessions 5 檔 1.9MB。
- 基準測試：`node --test test/*.test.mjs` 638 項、636 通過、2 失敗（41.8 秒）；2 項單獨重跑兩次皆通過。紀錄：`.runtime/audit-20260929/baseline-tests.log`。
- 正式部署狀態：無變更。未完成：前端 CSS 與部分小型 UI 元件、擴充的上游 Playwright 程式碼未逐行審閱（不影響上述結論）。

## 附錄：逐檔筆記

### 啟動鏈
- isolated-launcher.mjs：`startIsolatedOwner` 對 13 個由同檔常數 `path.join` 組出的路徑逐一做 isAbsolute、stat、realpath 包含檢查（L43-63）——路徑是自己組的，檢查幾乎不可能失敗。`execution` 仍保留 'sandboxie' 分支（pool、workspaceAccess、startExe、bridgePath、8 個 box），09-28 後正式只走 native。env 先由 `isolatedAgentEnvironment` 過濾再於 native 補回 9 個鍵（L65-72），兩層白名單。正式根目錄仍硬寫 `isolation-pilot\sandboxie-candidate-3b6c43ee`。`runIsolatedLauncherProtocol` 的 legacy presentation／launchUrl 路徑正式未用；L114 未知指令送 `{event:'error'}` 而非 `{type:'error'}`（小錯）；close() 內外兩層 catch 重複。
- electron-isolated-launcher.mjs：啟動 Electron 帶 `--remote-debugging-pipe`，由 Node 父程序把 CDP 訊息以 NUL 分隔轉送給 Electron 主程序（L40-56），只為讓 Electron 內嵌瀏覽器可被 Playwright 控制。若內嵌瀏覽器已不用（見 electron-workbench），整條 CDP 中繼是死重量。`electronEnvironment` 只傳 10 個環境變數給 Electron（無 PATHEXT、ComSpec、USERNAME、HOMEDRIVE、代理設定等），之後 claude.exe／codex.exe 均由此繼承——白名單過窄是潛在故障點（需查 isolatedAgentEnvironment 最終給 provider 的 env）。
- electron-isolated-main.cjs：每個 await 後重複 `if(shuttingDown||!process.connected)throw`（L39,53,59,63,70）；userData 路徑同一包含檢查做兩次（L45-50）；多個 `catch{}` 吞錯（L28,85,87）。
- electron-workbench.mjs：媒體／剪貼簿權限處理器對同一 origin 檢查 4-5 層且 `originMatches(expected,expected)`（L21 自己比自己，無意義），全部 try/catch→false，靜默拒絕麥克風時沒有任何錯誤訊息，未來 Electron 欄位變動會讓聽寫無聲失效。正式有 `browserGatewayFactory`（外部 Chrome），`k-native-browser-present` 直接回 `{external:true}`（L124）；內嵌瀏覽器整套（nativeGateway、boundsFor、pageIdentities、onPageActivated、views）在正式模式不顯示頁面，但仍建立。
- isolated-desktop.mjs：`validateSelectableWorkspace`／`validateRegisteredWorkspace` 同一路徑 validateWorkspace 兩次（L32-34, L40-42），native 下 validateWorkspacePath 為 undefined；`restrictWorkspace` 在 conversation 與 unified 兩層各猴補一次 selectWorkspace，同一次切換驗證兩遍；L64-65 內嵌 factory 單行過密，`candidate.toLowerCase()===stateRoot.toLowerCase()?selected:candidate` 重複；每次啟動 addProject＋把 stateRoot 自己登記為封存專案（L74-76）屬補丁式處理。
- desktop-server.mjs：`deployment` 三模式（standard／isolated／native）只剩 native 在用；仍服務舊 `web/` 介面資產（L75-77, L102-106：/app.js、/dsh/*.css、/icon.svg），dist-ui 已不引用——死碼；`/api/dictation`（Windows Win+H）前端已不呼叫（只剩 /api/dictation/transcribe）；routes 分派對 `!controller.concurrentConversations` 的舊介面相容（L187）；closeResources／closeLocalDictation 各自一套「promise 去重＋finally 清除」樣板。
- conversation-controller.mjs：控制器共四層（conversation→unified→claude/desktop→host），外加 isolated-desktop 兩層包裝。`safelyIdle` 先要求 status∈{ready,completed,interrupted} 又檢查 status∉{offline,error,...}（後者永遠不會成立）；同一組工人狀態清單在本檔重複 3 次且同時寫 'cancelled'/'canceled'；`workerRows` 兼容陣列／{workers} 兩種回傳形狀（全專案至少 5 處重複）。`focusLock` 讓快速點兩個聊天室直接報錯「正在切換聊天室」，改名／刪封存也被鎖。`open()` 要求前端送來的 model 必須等於存檔 model，否則報錯（清單過期就擋使用者）。
- unified-controller.mjs：重複 conversation 層已做的「只能開啟清單中對話」與 model 相符檢查（L78-81）；工人狀態清單與外層不一致——open() 用 [running,starting,pending]（無 unresolved），fork() 含 unresolved：同一概念兩套清單，目前靠 `settled===false` 補救；只要某個來源漏設 settled 就會出現行為差異。全專案同類判斷至少 7 種寫法（desktop-controller selectWorkspace 只擋 running 或 codex 未結束、claude-controller fork 用 `!w.settled`、deleteArchived 另一份…）。L155-158 包裝條件 `['send','selectWorkspace','answer'].includes(name)` 中 send／selectWorkspace 不在迴圈清單，死條件。`models()` 硬寫 GPT 白名單 astra/sol/luna 與 Claude 型號／推理選項（L68-71），違反「主代理可選 Codex 實際提供的模型」，新模型上線會被藏起來。
- input-queue.mjs：可送出狀態清單 `['ready','completed','failed','interrupted']` 與 resume 允許清單（多 'working'）不一致；hasWorkers 再一份工人狀態清單。整體設計（未送才歸 K、送出不確定不重送）合理。

### 主代理控制器與 host
- claude-controller.mjs（609 行、55KB）：狀態旗標 opening／closing／stopping／restartingHost／notifying／busy＋activeGeneration＋10 種 status 字串，約 10 處 `if(state.busy||opening||closing||stopping)` 用不同子集合組合。**使用者可見風險**：`stop()` 在 `opening` 時直接丟錯（L395），連線卡住時按停止無效，只能等 15 秒初始化逾時或關 K。推理程度清單 `['low','medium','high','xhigh','max']` 本檔重複 5 次（另見 claude-host、unified-controller）。send() L534 與 L538 兩個同樣的中止檢查緊鄰、中間沒有 await（重複）；L549-550 hostEffort 連設兩次；answer() L575 與 L579 同一 accept 檢查兩次；recordNativeChild 去重程式 L197/L199 重複；status 排除清單 L264/L270 重複。`changed()` 包 try/catch 吞掉 UI 例外（L62）。
- **持久化成本（實測）**：`readRecords` 每次 `persisted()`／`currentRecord()` 都讀取並解析「所有」Claude 對話投影檔（含完整訊息陣列）；而 saveCurrent 在每回合結束、成果變動、送出時都會觸發。正式 state 目前 5 檔共 1.9MB（最大 867KB），每存一次就全讀一次，對話越多越慢，屬 O(對話數×長度) 的隱性成本。
- **兩份紀錄同步**：Claude 對話同時寫 `.runtime/claude-sessions/<id>.json`（投影）與 main-sessions（清單），欄位在 saveCurrent、persistAccessMode、metadata、open 四處手抄；metadata() 呼叫 saveMainSession 未帶 effort，改名／釘選會把清單紀錄的 effort 重設為 null（投影檔仍保留，所以目前被掩蓋）。
- main-sessions.mjs：**append-only 永不清理**——每次 saveMainSession 新建 `<threadId>-<order>-<uuid>.json`，listMainSessions 每次讀取、lstat、解析整個目錄再取最新。正式 state 8 個對話已累積 147 檔（單一對話 47 檔）；listMainSessions 在 open、safelyIdle、每次 saveMainSession（parentThreadId 未傳時先讀一遍）都會被呼叫。saveMainSession 是「整筆覆寫＋未傳欄位用預設值」，任何呼叫端漏傳欄位就會被重設（title=''、archived=false、accessMode='read-only' 等），只有 parentThreadId／branchType／browserSessionKey 有沿用舊值——這是欄位遺失類 bug 的溫床。
- claude-host.mjs：每次開 host 先 inspectClaude（快取 5 分鐘），過期時連跑三個子程序（--version、auth --help 找 "status" 字樣、auth status），並從工作目錄一路往上讀到磁碟根的 .claude/settings*.json 與企業管理設定。runnerIdentity 與 captureImpl／spawnImpl 必須成對的檢查（L189-192、L264-265）是 Sandboxie 時代遺留，native 下只剩儀式。版本門檻 2.1.280 硬寫。`sanitizedEnv` 會移除所有 AWS_／AZURE_／GOOGLE_CLOUD_ 等變數——Claude 執行的所有命令都看不到這些（對一般使用者影響小，但屬隱性副作用）。`try{onMessage(message)}catch{}` 包的是 async 函式，對非同步錯誤無效（L370,373）。
- desktop-controller.mjs（Codex，602 行、56KB）：requestEpoch／viewEpoch／hostEpoch 三個世代計數＋stopRequested／opening／stopping／closing＋submission／pendingSteer／unsentSessions／browserRecoveryThreadId；每個 await 後都有 `host===active&&state.threadId===threadId&&epoch===...` 型過期檢查，分散且不一致。`models()` 無 host 時**另啟一個 codex app-server 子程序**只為讀模型清單（L335-341），open／fork／selectModel／unified.models 都會呼叫；conversation-controller 的 catalog 控制器永遠沒有 host → 每次前端要模型清單就開關一次 Codex 程序。open() 一次開對話依序做約 15 個往返（清單、權限、瀏覽器、模型目錄、工人停止、終端、帳號、thread/read、timing、config/read、resume、沙箱就緒 5 秒、goal、存檔）。依 Codex 錯誤訊息「原文」字串判斷分支（L448 'list_turns is not supported yet'、L494 archived 句子、L519 'thread not loaded'／'no rollout found'）——Codex 改字就改行為。close() 在子代理未確認停止時拋錯，後端維持開啟（L600）→ 子代理卡住時 K 無法正常結束。`sandboxPolicyForMode`／executionPolicy externalSandbox 為 Sandboxie 遺留。recordTool 單行 600+ 字元（L99）。
- codex-host.mjs：結構合理；close() 對 processError 分支與 graceful 判斷重複（L95-108 processError 已在前面 return/throw，L103、L108 的 processError 判斷為死碼）。

### 瀏覽器子系統（14 個 src 模組＋擴充＋native host）
- **正式路徑已確認**：vault 有 `k-browser-assistant.json`（enabled），正式使用「外部 K 專用 Chrome＋擴充」。一次 AI 瀏覽器工具呼叫的路徑：Claude/Codex →〔HTTP＋Bearer〕external-browser-gateway →〔HTTP＋Bearer〕browser-owner-gateway → restrictedBrowserTransport → Playwright MCP → browser-live-session → Playwright CDP 用戶端 →〔WS＋Bearer〕chrome-extension-context 中繼 →〔WS〕Chrome 擴充 → chrome.debugger。**同一程序內兩層各自完整的 HTTP MCP 伺服器**，各自重做：loopback 檢查、Host／Origin 檢查、timingSafeEqual Bearer、1MB 上限、JSON-RPC 格式驗證、重複 ID 409、120 秒工具逾時、斷線取消。外層只為多工 regular／incognito 兩個子 gateway；內層可用 SDK 的記憶體傳輸或直接函式呼叫取代。
- restrictedBrowserTransport（browser-mcp-stdio.mjs）：9 個 Set/Map 追蹤訊息 ID；`browser_reload` 靠內部送一次 `browser_tabs list`，再用正規式 `/^- (\d+): \(current\) /m` 解析 Playwright 給人看的 Markdown 文字找目前分頁（L77-82, L123）；分頁清單標題也以正規式改寫（L139-153）。Playwright MCP 一升版、輸出格式一變就壞。工具說明「先附加 K 文字」（L129-137），外層 external-browser-gateway 的 `cleanDescription` 再用三條正規式把其中兩段刪掉（external L25-31）——同一系統內加了又刪。
- browser-live-session.mjs：**正式路徑的多餘探測**——每次建立瀏覽器 context 前（Windows）都 `assertProfileIdle`：啟動 PowerShell、CIM 列舉所有 msedge/chrome 程序並用正規式解析 --user-data-dir（L16-37）；任何 CommandLine 讀不到但程序仍在 → 回 'unknown' → 拋「無法確認瀏覽器資料是否閒置」。外部 Chrome 模式傳入的 profile 是 K 自己的 `external-regular` 目錄，不是 Chrome 真正的資料夾，這個檢查每次白花約 1.2–1.9 秒（實測），還多一個莫名失敗點。接著 `prepareBrowserDownloadHistory` 也對同一個非 Chrome 目錄跑（找不到 Default 就返回）。
- browser-download-history.mjs（235 行）：對 Edge headless profile 的 History SQLite 做下載紀錄封存／指紋去重／保留 5 批——為舊「Playwright 自啟 Edge」路徑的崩潰修補；正式外部 Chrome 路徑用不到。
- browser-live-session 的 `controlMode:'http'`＋live.json 描述檔＋HTTP 控制伺服器、browser-live-proxy 的 `browserLiveRequest`、browser-mcp-config 的 `.runtime/browser-mcp.json`＋stdio 模式、`startBrowserMcp`：只屬舊 standard 部署。正式走 owner registry 的 in-process 模式。但 claude-controller／desktop-controller／conversation-controller／desktop-server 的預設參數仍指向舊路徑。
- 內嵌 Electron 瀏覽器（electron-browser-views 17KB、electron-scoped-context、electron-download、electron-workbench 的 nativeGateway／boundsFor／pageIdentities／IPC、electron-isolated-launcher 的 CDP 中繼、electron-isolated-main 的 transport/connectOverCDP、Electron 以 `--remote-debugging-pipe` 啟動）：正式模式不顯示頁面，但每次啟動仍建立 views 與 CDP 連線。
- 存取模式清單 `['workspace-write','auto-review','danger-full-access']`＋Claude 五種模式在 owner-browser-registry L27 與 browser-mcp-config L34 各抄一份；「路徑不得經連結轉向」的 realpath 檢查在 owner-browser-registry、browser-mcp-config（逐層）、browser-live-proxy、k-browser-assistant、external-browser-gateway 各寫一版。
- notifyControl（browser-live-session L68-82）要求回呼必須同步，否則回 false → beginAiCall 失敗 → AI 看到「browser is in human-control mode or unavailable」：把程式契約錯誤變成使用者看到的誤導訊息。
- 下載防護（Zone.Identifier 標記＋讀回、逐層 lstat）屬合理安全措施，可保留但應集中。

### Luna 子代理與共享知識
- luna-gateway.mjs：第三份「loopback HTTP MCP＋Bearer＋Host/Origin＋1MB」樣板（與兩個瀏覽器 gateway 重複）。工具執行錯誤一律換成同一句「Luna request failed or its status is unresolved」（L22-24），真正原因（如訂閱模型清單沒有 luna/high、參數錯）模型看不到，無法自行修正——過度消毒的錯誤訊息。
- luna-bridge.mjs：**關閉時對整個對話的所有歷史 Luna 任務逐一 cancel**（close→bridgeList→每筆 cancel，未過濾已結束者，L286-293），每筆約 3-4 次 RPC（thread/read×2、終端清理、inspect）；任何一筆歷史紀錄狀態無法「確認」（例如未載入且最後回合 id 對不上，L259-262）就拋錯 → 該 Claude 對話無法關閉／切換。歷史越多越慢越脆。`start()` 以正規式比對自己錯誤訊息文字 `/timed out|not confirmed|do not replay/` 判定 unresolved（L234），與 codex-host 的錯誤措辭耦合。大輸出寫檔用 digest＋suffix 迴圈避免碰撞（L36-51），寫入使用者工作區 `.runtime/luna-bridge/`。`sandboxPolicyForMode` 為 Sandboxie 遺留。模型 gpt-6-luna／high 硬寫，每次建 bridge 都再查一次模型目錄。
- shared-knowledge.mjs（227 行、30KB，**尚未部署**，只在原始碼）：K 自有的跨供應商記憶層。停用詞表 `excerptQueryStopTerms` 含「項附、附你、見的、源依、據沒、有資、料的、目直、接說、案的、的項、復的」等雙字切片（L15）——明顯是針對某一句測試提問調出來的過度擬合；以正規式從使用者句首抓「決定／確認／結論／更正」當記憶訊號（L49-61）；correction／revocation／variants／relation／stale／conflict 多套規則；可選外部 Jev API（typesafe.ai）重排序，含自寫秘密偵測正規式。整合方式是在 claude-controller 與 desktop-controller 的 send／回合完成路徑各嵌一份（各約 10 行密集程式），Codex 側另有一條重複的剝除正規式（desktop-controller L464）。與 AGENTS.md「不引入舊記憶設計、優先驗證原始紀錄＋按需回讀」方向有張力——建議重構前先由使用者決定是否保留；若保留，應移到 unified 層單點整合。

### 環境變數白名單（實測確認的真實副作用）
- 三層過濾：KTrayLauncher（完整 env）→ electron-isolated-launcher `electronEnvironment` 只留 10 個 → isolated-launcher 以 sandboxie-control `isolatedAgentEnvironment` 再挑 7 個（COMSPEC、PATHEXT 等此時已被上一層刪掉）→ native 再補回 9 個（HOME、ProgramData 此時也已不存在，於是被 `delete`）。
- **本對話實測**（K 啟動的 claude.exe 子程序）：缺 COMSPEC、PATHEXT、ProgramData、ALLUSERSPROFILE、COMPUTERNAME、NUMBER_OF_PROCESSORS、PROCESSOR_ARCHITECTURE、PSModulePath、CommonProgramFiles、OS 等；HOME 由 Git Bash 自行補上。AI 代使用者執行的所有命令、安裝程式、Python／.NET／git 工具都在這個殘缺環境下跑——多數工具有預設值可退回，但凡依賴 ProgramData（系統級設定）、PATHEXT、COMSPEC 的工具會出現難以理解的失敗。這是 09-28「移除 Sandboxie 限制」後留下的隔離殘骸，與「K 只作薄接殼」方向直接衝突。

### 小型支援模組
- workspaces.mjs：`createWorkspaceRuntimeConfig` 產生 k_flash MCP 設定（指向 `<appRoot>/src/mcp-stdio.mjs`，正式 appRoot 是 vault/private-state，該路徑根本不存在），但 desktop-controller L485 立刻以 `disabledCodexMcpServer()` 覆蓋——只剩 cwd 有用。桌面 K 的 Flash（DeepSeek）接線已全數停用：flashUsage（每 10 秒輪詢）、checkMainWorkers、collectWorkerIds、UI 的 DeepSeek token 顯示都是死路徑。**注意**：Pi／DeepSeek 工人本體仍被 Codex App 經 `.codex/config.toml` 使用（目前系統上有 9 個 `mcp-stdio.mjs` 常駐程序），不能整包刪。
- isolated-desktop 的 `createWorkerDispatcher` 無任何呼叫者（死碼）。
- worker-policy.mjs：子代理模型永遠是 Luna，`workerPolicy` 卻仍一路存進 main-sessions、state、open/fork 參數與驗證——常數被當成設定傳遞。
- projects.mjs：`listProjects` 永遠把 root（正式為 state vault）列為專案，導致 isolated-desktop 每次啟動都要把它標成封存（補丁的根源）。addProject／updateProject 各寫一份 tmp+rename。
- archive-delete.mjs：搬到暫存→寫還原清單→PowerShell VisualBasic 送資源回收筒→讀回確認，符合使用者「刪除走回收筒」規則，屬合理；threadIds 驗證與 conversation-controller 重複。
- native-workers.mjs：每回合結束、每個子代理事件都對「本對話曾出現的每個原生子代理」做 thread/read（含全部 turns），子代理多的長對話每回合 RPC 量線性成長。
- codex-login.mjs：每次 `/api/codex/auth` 都開關一個 Codex app-server 程序（connect→read→release）。
- windows-dictation.mjs＋scripts/Invoke-KWindowsDictation.ps1＋`/api/dictation` 路由：前端已不呼叫（只用 /api/dictation/transcribe）——死碼。
- local-dictation.mjs：WAV 逐區塊解析驗證、base64 重新編碼比對（輸入來自 K 自己的前端），偏重但無害；Python／模型路徑硬寫到 `D:\錄音轉文字\…`（使用者授權沿用）。
- claude-login.mjs、local-dictation、desktop-controller、luna-bridge 的 close() 都在「無法確認停止」時拋錯 → desktop-server 回 K_SHUTDOWN_PARTIAL → 系統匣「K 停止未確認」且**沒有強制結束選項**。多個獨立的 fail-closed 關閉點疊加，任何一個卡住都會讓 K 關不掉，只能用工作管理員。
- conversation-handoff.mjs：K 自己命名的交接檔做了 4 次包含檢查（逐層 lstat、realpath、寫前再驗目錄、寫後 realpath），寫入使用者工作區 `.runtime/handoffs/`。
- KTrayLauncher.cs：Node 路徑硬寫 `C:\Program Files\nodejs\node.exe`；舊 launchUrl／Chrome `--app` 開啟路徑（L152-171、OpenUrl、BrowserPath、ValidLaunchUrl）在原生視窗後已不用；StopK 在 UI 執行緒 `Thread.Sleep` 迴圈最多約 20 秒，期間系統匣圖示無回應。

### Pi／DeepSeek 工人（Codex App 經 k_flash 仍在用）
- **功能實際失效**：coding.mjs `runFixedTests` 在沒有 `testRunner`（Sandboxie spawnImpl）時直接回 `runner-not-configured`、「host execution is disabled」。唯一在用的入口 mcp-stdio.mjs → createDispatcher 從不傳 testRunner，所以 Codex App 的 Flash 工人拿到 coding 授權時，`run_tests` **永遠跑不了測試**。MCP 說明卻仍寫「grants … a fixed Node test runner」。這是 Sandboxie 移除後「不准退回主機執行」的防禦規則把功能本身關掉的實例。
- **錯誤被過度消毒**（三處同型）：mcp.mjs 所有工具錯誤一律回「Request rejected or result unavailable…」（L46-54），檔案超出工作區、輸出已存在、coding 檔案衝突等明確原因，呼叫端模型都看不到；worker.mjs 只記錄錯誤類別名「Worker failed (Error)」（L169），DeepSeek 401／限流／上下文過長無從分辨；mcp-stdio.mjs 啟動失敗只印固定句子（L28-31）。理由是「可能含使用者資料」，但接收者正是送出這些資料的同一個父模型。
- mcp.mjs 說明文字仍寫 `gpt-5.6-luna`（其餘程式皆為 gpt-6-luna），過期敘述。
- dispatcher 以 `error.message === 'This request ID already belongs to a different request.'` 字串比對控制流程（L130）。
- history.mjs：每個 historyId 最多載入 16MB 逐字稿到記憶體（最多 20 個）。
- main-cli.mjs／main-questions.mjs／cli.mjs／demo.mjs：Start-K.ps1 終端原型，狀態寫在開發目錄 `.runtime`，與正式 state 分開；桌面 K 上線後屬舊入口。

### Sandboxie 殘留（正式 native 不走）
- sandboxie-pool／process／stdio-bridge／workspaces／control、isolated-provider-hosts 共約 953 行，只在 `execution:'sandboxie'` 分支使用；正式只借用 `isolatedAgentEnvironment`（即上面造成環境變數殘缺的函式）。另有 `sandboxPolicyForMode`／externalSandbox／runnerIdentity 參數散布在 isolated-desktop、desktop-controller、luna-bridge、claude-host、claude-login、coding。AGENTS.md 允許保留檔案，但不必留在執行路徑。

### 前端
- main.jsx：308 行但 88KB，平均每行近 300 字元；Chat 的 JSX 單行 7,994 字元（L100）、Approval 元件單行 7,682 字元（L305）、App 元件橫跨 L104-280 含數十個 state。人工無法審閱、git diff 無法閱讀、AI 編輯時 old_string 容易不唯一或過長。最便宜也最安全的第一步重構：自動格式化（不改行為）後再拆元件。
- 重複推導：`state.provider??(state.model?.startsWith('claude-')?'claude':'codex')` main.jsx 8 份、全專案 13 份；`startsWith('claude-')` 判斷共 19 處；Claude 權限對應 `accessMode==='workspace-write'?'claude-manual':…` 多處；status 清單如 `['connecting','offline','error','uncertain','stopping']` 各處自寫。
- 全域 `action` 鎖（L143）：任何一個操作進行中，其他點擊直接無聲忽略並整個介面 disabled；與後端 conversation-controller 的 focusLock 疊加。長對話 open（Codex 約 15 次往返）期間整個 UI 凍住，與「A 工作時可切到 B」的方向有張力。
- 舊版殘留：browser-panel.jsx 的 `LegacyBrowserPanel`＋browser-frame.mjs（截圖式即時畫面）只在非 Electron 使用；shared/state-stream.mjs 的「legacy desktop server 裸 state」相容分支（applyStateEvent 開頭）已無來源。
- shared/state-stream.mjs：每次狀態變更（串流時每 60ms）對「所有」訊息與工具的非文字欄位做 structuredClone＋JSON.stringify 比較，工具的 details／patchChanges（整份檔案差異）也在內；工具多的長對話，串流時 CPU 成本線性上升。
- model-picker.jsx 送出時硬寫 `workerPolicy:{model:'gpt-6-luna'}`。

### 瀏覽器擴充與 native host
- scripts/k-browser-native-host.mjs：第四個 loopback 伺服器（WS＋Bearer＋描述檔交握）；每次 Chrome 啟動 native host 都執行一段 PowerShell，並以 `Add-Type` 當場編譯 C#（CommandLineToArgvW）逐層檢查父程序 Chrome 的 --user-data-dir——擴充本身已只裝在 K 專用 profile，且 Chrome 以 allowed_origins 限制呼叫者，這是第三層重複確認，且每次多 1-3 秒。
- browser-extension/source/nativeConnection.ts：native host 斷線後刻意「不重試」（只在 service worker 重啟或使用者操作時重連），配合 K 端錯誤訊息要使用者「手動重新載入擴充」——防重試迴圈的規則把恢復工作交給非工程師使用者。
- browser-extension/README.md 仍寫「候選、不是已安裝或正式啟用」，與正式 vault 已啟用不符（文件過期）。

### 測試（基準已實跑）
- 2026-09-29 基準：`node --test test/*.test.mjs` 共 **638 項，636 通過、2 失敗**（41.8 秒）。失敗兩項都在 claude-controller.test.mjs（Luna 完成通知送達），**單獨重跑兩次皆通過**、整檔單跑 47/47——屬平行負載下的時序不穩：測試以固定 `tick()`＝40ms 等待，而送達路徑前面要先做兩輪含 fsync 的存檔（見「持久化成本」）。全套測試共 40 處固定毫秒等待（19 檔）。紀錄：`.runtime/audit-20260929/baseline-tests.log`。
- 約 72 個斷言直接讀原始碼文字做正規式比對（如 `assert.match(source,/visible=projects\.filter\(p=>!p\.archived\)/)`；conversation-navigation-ui 30 個、native-browser-panel 12、isolated-launcher 11、response-annotations-ui 9、desktop-launch-entry 7）。只要重新排版或改變數名就會失敗，行為沒變也一樣——這是重構的主要阻力，重構時應改寫成行為測試或刪除。

### 文件與版本控制
- README 42KB、development-log 42KB、docs 126 份；README 開頭堆疊十多段時間戳狀態（09-14 至 09-28），新舊狀態混雜，已有多處過期（例如擴充 README、local-launcher README 前段）。
- git 最後提交 09-19；之後的 43 個 src 模組、大部分前端／測試／腳本都未納入版本控制——任何重構前必須先建立基準提交，否則無法回溯。
