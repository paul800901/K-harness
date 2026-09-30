# R3 工作單：盤點剩餘項目（2026-09-30，Opus 起草，交 Astra 實作）

> 依據：[重構前盤點](code-audit-overdefense-20260929.md)、[R2 審查紀錄](opus-review-r2-savefix-20260930.md)。基底：目前正式版 `R2-candidate-20260930-sol61`（f8fbb79）。
> 使用者 2026-09-30 要求「馬上加入」下一批，並希望在 10/10 GPT 方案降級前多用現在的 GPT 額度。

## 2026-09-30 使用者更新執行與審查順序

Claude 暫無額度，使用者明確要求 Astra 先自行驗證、直接套用目前完成的版本，不再等待 Claude 事前複審；恢復額度後再集中複查程式精簡、過度防禦與介面美感。Astra 仍負責功能與回歸驗證、保留 R2 還原版本、正式讀回及如實列出未驗事項。這次先部署 R3-1（含通知補修），R3-2～4 仍依後述順序分批完成，不順帶部署未做完項目；不自動發訊息或重送先前工作來等待額度。此更新取代下文原本的事前 Opus 門檻。

## 使用者 2026-09-30 的決定（請先寫入 AGENTS.md）

1. **模型選單自動跟官方清單**：不再由 K 寫死可選模型；官方標為隱藏的不顯示。已存對話維持原模型，不自動換。
2. **加入「確認後強制結束」**：正常關閉失敗時才出現，按下前必須再確認；預設選項是「不要」。這是使用者確認過的人類控制項。
3. **拿掉 DeepSeek 工人的「跑測試」功能**：不再宣稱或提供 `run_tests`，測試由主代理自己跑。
4. **舊架構清理加入本批**：Sandboxie 執行分支、內嵌 Electron 瀏覽器、舊 standard 部署與其他死碼從執行路徑移除。檔案保留在 git 歷史；不卸載 Sandboxie 系統元件、不改資料夾名稱與資料位置。

## 共通規則（每一批都適用）

- **單一寫入者**：Astra。Claude／Opus 後續集中複查，不同時改程式；沒有額度時不阻擋已由 Astra 驗證的批次。
- **只刪除或合併防護**。若認為必須新增檢查，先在交接文件寫明證據與理由，留供後續 Claude／Opus 複查；仍不得違反使用者指定的精簡方向。
- **保留 G 級防護**：
  - 可能已有副作用的工作不自動重送，不確定時標 uncertain。
  - 不改走 API 計費（Claude 訂閱檢查、Codex `account/read`=chatgpt）。
  - 原子寫入。
  - 刪除一律走資源回收筒。
  - 下載加 Zone.Identifier。
  - 本機伺服器保留 Host／Origin／cookie／啟動 token 檢查。
  - 核准只核准單次。
- **共享知識不碰**，維持只留實驗。
- **每一批的流程**：
  - 修 bug 先寫會失敗的測試。
  - 跑完整測試，在交接文件記錄差異、驗證結果與中途失敗，並更新 development-log。
  - 每批打一個標記（例如 `R3-1-candidate-YYYYMMDD`），留下 Claude／Opus 後續集中複查所需證據。
  - 依本次使用者更新的授權，由 Astra 驗證後可先部署；部署前另外保留 R2 程式備份，部署後正式讀回。
- **可以不等 Claude 審查就接著做下一批**，已完成必要驗證的批次可依更新授權套用；仍不得部署未測完項目。後續複查發現問題，在原分支修正並重新驗證。
- **Codex App 注意**：Codex App 直接執行 `D:\K-harness\src\mcp-stdio.mjs`（主工作樹）。動到 Pi 工人（mcp*、dispatcher、worker、coding、files、history、recovery）的批次，合併進主工作樹前要先講明：之後新開的 k_flash 程序會立刻用新版，包括 Astra 自己的工人工具。
- 不改全域設定、ACL、登入資料、API 計費；不 push。

## R3-1：使用者決定項＋卡住陷阱（優先）

### 1. 模型清單跟隨官方（D1）
- `unified-controller.mjs` `models()`：拿掉 `selectableGPT` 白名單，直接用 Codex 原生目錄（`listMainModels` 已排除 hidden）。
- `frontend/model-picker.jsx`：拿掉 `modelsByProvider`，改依目錄的 `provider` 分組。
- Claude 端：
  - 若 Claude Code 原生 initialize 回傳的模型清單可用，就改用它，並讓 `--model` 跟對話的設定走。
  - 做不到就維持現在的單一模型，並在交接寫明原因；不要自己另寫一份 Claude 模型清單。
- 推理程度：
  - Codex 用目錄的 `supportedReasoningEfforts`。
  - Claude 的 `['low','medium','high','xhigh','max']` 目前散在 7 處，收成一個常數，或改用原生能力。
- 保持不變：舊對話照原模型開啟、不暗換；已不在目錄的模型開啟時明確報錯。
- 測試（假目錄）：
  - 新模型不改程式就出現。
  - hidden 不出現。
  - 舊對話模型不變。

### 2. 拿掉 DeepSeek 工人的 run_tests（A2）
- `coding.mjs`：刪 `run_tests` 與 `runFixedTests`，保留 `replace_code`（含修改前備份）。
- `testFiles`／`timeoutMs` 從以下各處移除：`normalizeCoding`、`mcp.mjs` 的 `codingInput` schema、dispatcher 的比對、recovery。
- 一路移除 `testRunner` 參數。
- 更新 MCP 說明與工人 system prompt：只提供精確片段修改，測試由父代理自己跑；MCP 版本號加一。
- 相容：舊 job 紀錄照讀；舊 requestId 帶舊 coding 欄位視為不同請求即可，不做遷移。
- 測試：tools/list 沒有 run_tests；說明文字不再提測試器；replace_code 行為不變。

### 3. 連線中可以取消（C1）
- 問題：現在 `stop()` 在 opening 時直接拋錯；新開的聊天室在連線完成前也不在 `rooms` 裡，所以找不到；前端連線中整個介面都是 disabled。
- 需求：使用者在「正在載入對話…」時能取消。
  - 取消後這次連線建立的 claude.exe／codex app-server 要確實結束。
  - 取消後才完成初始化的 host 一律關閉、不採用，不能把狀態改回 ready。
  - 不影響其他聊天室。
  - 不重送任何訊息。
  - 取消後可以正常再開。
- 做法提示（可自行設計）：
  - openClaudeHost 與 inspectClaude 的子程序支援 AbortSignal。
  - desktop-controller 的 open 可以被中止；只關閉「這次 open 新建」的 host。
  - conversation-controller 在連線開始時就登記可取消的 handle。
- 前端：連線中顯示「取消」。這是既有停止功能的延伸，不算新設定。
- 測試：假 host 永不初始化 → 取消後 1 秒內結束、沒有殘留程序、晚到的初始化被忽略；另一個聊天室不受影響。

### 4. 確認後強制結束（C2）
- 範圍：`local-launcher/KTrayLauncher.cs` 的 StopK／ExitLauncher。
- 觸發：正常關閉被拒（有工作）、無法確認、或逾時時，跳出確認框：「K 無法正常關閉（原因）。要強制結束嗎？還在跑的工作可能中斷，之後需要查看狀態。」預設按鈕是「否」。
- 動作：選「是」才結束 supervisor 的整個程序樹（`taskkill /PID <pid> /T /F`；launcher 是 .NET Framework，不能用 Kill(true)），並寫入 launcher.log。
- 不改：正常關閉流程仍在前面，強制結束只是失敗時的最後出口。
- 下次啟動：沿用既有的 uncertain／不重送機制，在交接寫明使用者會看到的狀態。
- 交付：用 `Build-K-Launcher.ps1` 重建 exe。以假的「拒絕關閉」supervisor 實測：確認框出現、選「否」什麼都不做、選「是」程序樹全部結束。部署時要一併替換系統匣 exe（需先停止它）。

### 5. 共用原子寫入（F7，延伸 R2 的修正）
- 新增一個共用函式：同目錄暫存檔 → fsync → rename，rename 對 EPERM／EACCES／EBUSY 做有上限的重試（沿用 main-sessions 的參數）。
- 改用它的地方：main-sessions、input-queue、ui-message-timing、claude-controller 的 `saveRecord`、luna-bridge 的 `persist`、projects。不要再各寫一份。
- 測試：沿用 main-sessions 的暫時錯誤、用盡、其他錯誤三類測試，加在共用函式上。

### 6. 小項
- A4：`error.message` 改成 `String(error?.message ?? error)`（luna-gateway、mcp.mjs、worker.mjs）。
- electron-isolated-launcher 的 `electronEnvironment`：除了 `ELECTRON_RUN_AS_NODE`，一併剔除 `NODE_OPTIONS`。
- B3（luna-bridge）：`close()` 只取消未結束的任務；已結束的歷史任務不再逐筆 cancel／thread/read，也不因歷史紀錄「無法確認」而讓整個對話關不掉。

## R3-2：舊架構移除（檔案留在 git 歷史）

每項移除後，正式行為必須不變，完整測試通過；被刪模組的測試一起刪，其他引用它的測試改寫。

- **E1 Sandboxie**：
  - 刪 `execution:'sandboxie'` 分支、pool、workspaceAccess、8 個 box。
  - 刪模組：`sandboxie-control／pool／process／stdio-bridge／workspaces.mjs`、`isolated-provider-hosts.mjs`。
  - 刪參數：`runnerIdentity` 與 captureImpl／spawnImpl 配對檢查（claude-host、claude-login）；`sandboxPolicyForMode`／`executionPolicy`（desktop-controller、luna-bridge、isolated-desktop）。
  - 刪 native-notices 的 `externalSandboxNetwork`，以及已無人使用的 `isolatedAgentEnvironment`。
  - 不改：資料夾名稱（`sandboxie-candidate-…`）與已安裝的系統元件。
- **E2 內嵌 Electron 瀏覽器**：
  - 刪模組：`electron-browser-views`、`electron-scoped-context`、`electron-download`。
  - electron-workbench：刪 nativeGateway、boundsFor、pageIdentities 與內嵌 IPC。
  - electron-isolated-launcher／main：刪 `--remote-debugging-pipe`、CDP 中繼、`connectOverCDP`。
  - 保留：主視窗、owner view、麥克風／剪貼簿權限、外部 Chrome 模式需要的最小 IPC（例如還原時 refresh）。
  - 驗證：外部 Chrome 助手照常運作。
- **E3 舊 standard 部署**：
  - desktop-server 只留 native：刪 `web/` 資產路由與 `web/` 目錄；啟動 token 一律啟用；刪直接執行入口。
  - browser-live-session：刪 HTTP 控制模式、live.json、`assertProfileIdle`，以及自啟 Edge 的 `launchPersistentContext`；同時刪 E6 的 `browser-download-history.mjs`。
  - browser-mcp-stdio：刪 `startBrowserMcp`（stdio 入口），保留 `restrictedBrowserTransport`。
  - browser-live-proxy：刪 `browserLiveRequest`，保留 `consumeBrowserResponse`。
  - browser-mcp-config：刪 `readBrowserMcpConfig`，保留識別與合併函式。
  - 控制器的預設參數不再指向舊路徑。
  - 前端：刪 `LegacyBrowserPanel`、`browser-frame.mjs`；刪 state-stream 的舊裸 state 相容分支。
- **E4**：刪 `windows-dictation.mjs`、`scripts/Invoke-KWindowsDictation.ps1`、`/api/dictation` 路由。
- **E5 桌面 Flash 接線**：
  - desktop-controller：刪 flashUsage 輪詢、checkMainWorkers／collectWorkerIds；刪 `createWorkspaceRuntimeConfig` 的 k_flash 部分（只留 cwd）。
  - 前端：刪 DeepSeek token 顯示。
  - **保留** `disabledCodexMcpServer()` 覆蓋：避免工作區 `.codex/config.toml` 的 k_flash 被帶進桌面對話。
  - Pi 工人本體保留，Codex App 仍在用。
  - 刪 isolated-desktop 的 `createWorkerDispatcher`（無呼叫者）。
- **E7**：
  - 刪系統匣啟動器的 launchUrl／`OpenUrl`／`BrowserPath`／`ValidLaunchUrl`，與 C2 同一次重建。
  - 刪 isolated-launcher 的 legacy presentation。
- **可選**：若確認沒人使用，一併移除終端原型 `main-cli.mjs`／`main-questions.mjs`／`Start-K.ps1`；不確定就留著並在交接列出。

## R3-3：結構整理（行為不變）

- **F1 單一狀態定義**：新增一個模組，集中以下判斷並換掉目前約 7 種寫法：
  - 工人是否結束／是否仍在跑
  - 可否送出
  - 是否閒置
  - 供應商判斷
  - 推理程度清單
  - 同時讓 `workers()` 一律回傳陣列，刪掉呼叫端各自的相容寫法。
- **F2 本機 MCP 伺服器**：
  - luna-gateway 與兩個瀏覽器 gateway 共用一份 loopback／Host／Origin／Bearer 伺服器工具。
  - 內外兩層瀏覽器 gateway 合一，或內層改記憶體傳輸。
  - 工具說明一次定好，不再「先加文字、再用正規式刪」。
- **F3**：刪 isolated-desktop 對兩層 `selectWorkspace` 的猴補與重複驗證；「開啟對話時 model 必須與存檔一致」（C4）只留一處。
- **C3**：前端的全域 `action` 鎖改成以聊天室為單位，符合 AGENTS.md「A 工作時可切到 B」；後端 focusLock 不再讓改名、刪封存等無關操作報錯。
- **B4**：已有任一聊天室的 Codex host 時，模型目錄、額度、登入狀態直接借用它；模型目錄短暫快取，不為讀資料另開程序。
- **F4**：main.jsx 先做純排版提交（行為與測試不變），再拆成 Chat／Approval／面板等元件。
- **F5**：碰到的原始碼字串比對測試，改寫成行為測試或刪除。
- 可選：B5（串流時不必每次複製所有工具細節）、B6（瀏覽器面板每秒輪詢改成事件或閒置時放慢）。

## R3-4：文件

- README 開頭十多段歷史狀態收成一段「目前狀態」，歷史移到 docs。
- 更新過期說明：browser-extension/README（仍寫候選未安裝）、local-launcher/README 前段。

## 驗收時 Opus 會看的重點

- 每批完整測試數字與中途失敗紀錄都要附上。
- 正式行為：
  - 開關對話、送出、停止、核准、分支、封存刪除、外部 Chrome 助手、本機聽寫、額度顯示都照常。
  - 新增的只有：連線中取消、確認後強制結束、模型清單跟官方。
- 刪除量與新增量都要列出。這次重構的目標是總行數下降，不是上升。
