# Opus 複查：右側瀏覽器畫面與人工接手（2026-09-25）

審查對象：`browser-live-view-20260924.md`，以及 `src/browser-live-session.mjs`、`src/browser-mcp-stdio.mjs`、`src/browser-live-proxy.mjs`、`src/desktop-server.mjs` 瀏覽器路由、`frontend/browser-panel.jsx`。
`npm test` 319/319（Opus 重跑）。正式開關 `.runtime/browser-mcp.json` 不存在；沒有重啟正式後端，沒有使用真實帳號或真實網站。

## 一、程式複查

### 確認正確
- **接手互斥**（`browser-live-session.mjs`）：
  - 接手時立刻切到 `human`，新的 AI 工具呼叫由 `beginAiCall` 拒絕；
  - 已經開始的 AI 呼叫未結束前，`ensureHuman` 不允許人工操作；
  - 人工操作進行中不能交回；
  - 交回前必須沒有進行中的 AI 呼叫。
  判斷和設定 `humanAction` 在同一個同步區段，不會發生並發競態。
- **切換對話不串頁**：
  - `browser-live-proxy.mjs` 在送出請求前核對 threadId 和 sessionKey；`desktop-server.mjs:64` 在拿到結果後再核對一次；
  - endpoint、port、token 只從目前對話的 profile 讀取，realpath 必須完全一致，不接受前端傳入；
  - 前端用 `threadGeneration` 丟棄舊對話晚到的回應。
- **隱藏分頁不重複新增**（`browser-panel.jsx:58`）：隱藏的面板只消耗新增訊號，不執行；只有可見的面板會新增。
- **沒有擴大檔案讀取權限**：上傳和拖放的路徑防護、`run_code_unsafe` 的封鎖、listRoots 限定，都保留在同一個 transport。人工導航只允許不含帳密的 http 和 https。

### 發現的問題
1. **AI 呼叫被取消時，計數可能卡住（中，推論，需實測）**
   - `restrictedBrowserTransport` 只在送出回應時呼叫 `endAiCall`。
   - 如果 MCP client 送出 `notifications/cancelled`，例如使用者在瀏覽器工具執行中按停止，或者 Codex 的 `tool_timeout_sec` 到期，server 依規範可能不回應，`aiCalls` 就一直大於 0。
   - 結果：接手一直顯示忙碌，無法人工操作，也無法交回。只有 MCP 處理程序重啟才會恢復。
   - 修法：收到 `notifications/cancelled` 時，如果 requestId 在 `activeCalls` 裡，就呼叫 `endAiCall`。補一個測試：在長時間的瀏覽器工具（例如 `browser_wait_for`）執行中停止，之後接手要成功。
2. **模型讀得到 `live.json` 的 token，可以冒充「人工」（中，設計問題；使用真實登入前必須決定）**
   - `live.json` 的 token 和瀏覽器 profile（包含 cookie）都放在 `D:\K-harness\.runtime\browser-profiles\<key>\`。
   - 在 K 專案工作區時，Claude 的 Read、Bash 和 Codex 的 shell 都讀得到。拿到 token 後，就能透過 loopback 直接執行接手、點擊、導航，繞過瀏覽器工具的核准和人機互斥。使用者真的登入後，cookie 也在同一個目錄。
   - Windows 上 `mode:0o600` 沒有實際保護作用。
   - 修法方向：
     - profile 和控制描述檔移到任何工作區以外的位置，例如 `%LOCALAPPDATA%\K-harness\browser\<key>`；
     - token 改用處理程序間傳遞，不寫檔；
     - 至少先在專案 `.claude/settings.json` 對 `.runtime/browser-profiles/**` 加上 deny。但這擋不住 Bash 和 Codex。
3. **AI 的目前分頁和人工選取的分頁可能不同（低，未驗證）**：人工新增或切換分頁後交回，Playwright MCP 的目前分頁不會跟著改變，AI 會繼續在它自己的分頁上操作。這次探測只有單一頁面，沒有涵蓋這個情況。

## 二、隔離實測：Claude 和 Codex 各一次

腳本：`scripts/browser-live-handoff-probe.mjs`（Opus 新增）。
- 預設只做演練；每次只測一個 provider。
- 每次建立新的隔離目錄 `.runtime/browser-live-probe/<key>/`，裡面有工作區、output 和 `.runtime/browser-profiles/<key>`。
- 只啟動 127.0.0.1 的本機假頁面：有隨機標記、一個 Note 輸入框，以及同步顯示內容的 Mirror 行。
- 使用正式同一套 `browser-mcp-stdio.mjs`。
- 右側畫面和人工接手，是透過正式 `browserLiveRequest`（同一個 proxy 函式）呼叫 live session 完成。**沒有經過 K 的 React 面板**。

流程：
1. 模型導航到假頁面並取得 snapshot，讀出標記；
2. 讀回右側的 `/state` 和 `/frame`，對照網址是否相同；
3. 人工接手，點擊 Note 輸入框並輸入 `K_HUMAN_EDIT_<tag>`；
4. 模型在接手期間呼叫 snapshot；
5. 交回 AI；
6. 模型再次 snapshot，讀回輸入框的值。

核准政策：只允許 ToolSearch、`browser_navigate`（網址必須等於假頁面）和 `browser_snapshot`，其他一律拒絕。

| 檢查 | Claude（manual，Opus 5.5 low） | Codex（workspace-write／on-request，gpt-6-luna low） |
|---|---|---|
| 模型讀到假頁標記 | ✅ `K_FAKE_PAGE_414EC37A` | ✅ `K_FAKE_PAGE_2A179258` |
| 右側和模型是同一頁 | ✅ 同一個網址，1 頁，frame 15.5KB | ✅ 同一個網址，1 頁，frame 15.6KB |
| 接手後切成人工 | ✅ human，不忙碌 | ✅ |
| 人工點擊並輸入 | ✅ 輸入後 frame 更新（18.5KB） | ✅（18.6KB） |
| 接手期間 AI 工具被拒 | ✅ 核准層放行，**由 K 接手互斥拒絕**：「browser is in human-control mode or unavailable」 | ✅ 同上；snapshot 狀態為 failed，原因相同 |
| 交回 AI | ✅ ai，不忙碌 | ✅ |
| 交回後模型讀到人工輸入 | ✅ Mirror 和 Note 都是 `K_HUMAN_EDIT_414EC37A` | ✅ 都是 `K_HUMAN_EDIT_2A179258` |
| 只存取本機假頁 | ✅ 只有 `GET /` 和 `/favicon.ico`，來源是 127.0.0.1 | ✅ 同左 |

補充觀察：
- **核准次數不同**：Claude manual 對每一個瀏覽器工具都要核准（navigate 和 snapshot 共 4 次）。Codex on-request 只對 `browser_navigate` 跳核准，`browser_snapshot` 沒有跳，推測是因為工具標註為唯讀。所以 Codex 的「要求核准」不代表每個瀏覽器動作都會問。
- 測試結束後，沒有殘留的 msedge 或 `browser-mcp-stdio` 處理程序。

證據：
- Claude：`.runtime/browser-live-probe/probe-claude-6d397972-6f69-402e-9f4f-72a72c0b0b1b/evidence.json`
- Codex：`.runtime/browser-live-probe/probe-codex-df9c7013-1287-4cb7-9d0d-4acfb504a948/evidence.json`

耗用：每個 provider 3 個 low effort 短回合。

## 三、未驗證
- K 的 React 右側面板在實際模型對話中的表現：點擊換算、每秒更新、放大、按鈕鎖定，以及開著面板時切換對話。這次繞過 UI，直接呼叫同一個 proxy 函式。
- 多頁面時，AI 的目前分頁和人工選取的分頁如何對應（第一節第 3 點）。
- 取消或逾時後的 AI 計數卡住問題（第一節第 1 點）。
- 原生密碼管理器、檔案選擇器、CAPTCHA、瀏覽器安全警告、真實登入延續。
- 正式啟用與正式後端重啟。

## 五、第二輪：取消修正與右側寬幅面板（依 `browser-cancel-followup-20260925.md`）
`npm test` 321/321（Opus 重跑）。正式開關仍不存在，正式後端沒有重啟。

- **取消卡住（第一節第 1 點）已修，而且做法比我建議的更保守，這是正確的**
  - 做法：收到 `notifications/cancelled` 後，不直接把計數減一，而是先 `failClosed` 關閉整個 browser context，關閉完成後才釋放計數。
  - 取消之後，晚到的回應不會提前放行（`send` 會略過 cancelledCalls 裡的請求）。
  - 關閉失敗時保持鎖定，不會以逾時強行解鎖。
  - `browser-mcp-boundary.test.mjs` 用真實 MCP 加空白 Edge，在 `browser_wait_for` 執行中取消，讀回 `available=false`、`busy=false`。
- **待確認：Codex 的「重新開啟對話以重連」是否真的有效**
  - `failClosed` 之後，該 MCP 處理程序內的工作階段會永久不可用，必須換一個新的 MCP 處理程序才能恢復。
  - Claude 重開對話會重啟 host 和 MCP，應該有效。
  - Codex 重開同一個對話，走的是同一個 app-server 上的 `thread/resume`。官方是否會為此重啟 MCP 處理程序，目前未知；如果不會，瀏覽器要等 K 後端重啟才能恢復。需要實測，或改由 K 主動觸發 MCP 重新載入（例如 `config/mcpServer/reload`，要先查證語意）。
- **第一節第 2 點（token 和 cookie 放在模型讀得到的位置）仍未解決**。Astra 的判斷正確：移到 LOCALAPPDATA 或加 Read deny，都擋不住同一個 Windows 使用者之下、有 shell 權限的模型，需要另外設計隔離。目前的權宜做法是面板常駐警告「只用假資料，勿登入真實帳號」。這只是提示，不是技術隔離。
- **右側寬幅面板**：預設和聊天等寬、可以調整、分頁與＋在同一列、快照保持原比例，避免點擊座標偏移。隔離 UI 以鍵盤調寬讀回，實際拖曳沒有驗收。Opus 只看程式和紀錄，沒有重跑 UI。

## 六、第三輪：工具列與下載（依 `browser-toolbar-downloads-20260925.md`）
`npm test` 325/325（Opus 重跑）。正式開關仍不存在。Opus 只複查了程式，沒有重跑介面，也沒有使用模型回合。

### 確認正確
- 下載存到每個對話專屬的 `output/downloads/<UUID>/<檔名>`：
  - 目錄逐層檢查不經過連結；
  - 目標已存在就拒絕，不覆寫；
  - 儲存後再核對一次；
  - 下載完成前不能取回。
- 檔名清理：只取 basename，替換 `<>:"/\|?*` 和控制字元（連帶排除 `:` 開頭的 ADS），去掉結尾的點和空白，長度上限 180。
- 「儲存副本」端點：
  - 需要 cookie，並核對對話和 session；
  - 下載 ID 必須是 UUID 格式，不接受路徑；
  - proxy 路由用白名單 regex；
  - 回應是 `application/octet-stream` 加 `attachment`，並有全域 `nosniff`，瀏覽器不會直接執行或顯示內容。
- 上一頁、下一頁依真實歷史啟用；沒有製造假的下載進度。

### 建議修正
1. **下載檔案沒有「來自網際網路」的標記（中低）**
   - Playwright 的 `saveAs` 不會寫入 Windows 的 Mark of the Web，也就是 `Zone.Identifier` 資料流。
   - 使用者之後再用「儲存副本」取得檔案時，來源變成 `127.0.0.1`。所以從任意網站下載的執行檔、Office 文件、捷徑，開啟時可能不會觸發 SmartScreen 或 Office 保護檢視。
   - 修法：儲存後寫入 `<檔案>:Zone.Identifier`，內容為 `[ZoneTransfer]`、`ZoneId=3`、`HostUrl=<download.url()>`。下載清單顯示來源網址；對 `.exe/.msi/.bat/.cmd/.ps1/.lnk/.url/.js/.vbs/.hta/.scr` 等類型加上明顯警告。
2. **Windows 保留裝置名稱沒有處理（低）**：`CON`、`NUL`、`COM1`、`AUX`、`LPT1`，以及 `con.txt` 這類名稱，`safeName` 不會改寫。目前多半只會讓儲存失敗，應該不會造成越界，但建議遇到保留名稱時加上前綴。
3. **沒有大小上限（低，文件已承認）**：「儲存副本」會把整個檔案讀進 MCP 處理程序的記憶體，下載本身也沒有容量上限。建議先設一個上限，例如 200 MB，超過就只提示路徑、不提供副本。

### 未驗證
- 由 Claude 或 Codex 模型下令觸發的下載（這次只有人工在介面點擊）。
- AI 操作期間，網站自行觸發的下載會被自動保存。這和一般瀏覽器的行為相近，但目前沒有提示。

## 七、第四輪：下載安全補強、Codex 重連與持續登入方案
依 `browser-download-security-20260925.md`、`browser-reconnect-fix-20260925.md`、`browser-persistent-login-plan-20260925.md`。
`npm test` 326/326（Opus 重跑）。正式開關仍不存在。Opus 只複查程式和紀錄，沒有花模型回合，也沒有重跑介面。

### 確認正確
- 來源標記：存檔後寫入並讀回 `Zone.Identifier`（`ZoneId=3`），寫入失敗就不標成功。
  - 另外找出上游 Playwright MCP 會另存一份，並包裝 Download 的公開 `saveAs`，讓兩條路徑都有標記，也沒有修改 `node_modules`。這點找得好。
  - 標記只寫 ZoneId，沒有寫 HostUrl，因此不會把網址裡的 token 留在檔案上，這個取捨可以接受。
- 保留檔名加上前綴；下載清單只顯示 origin；危險類型要再確認才提供副本；64 MiB 上限在 proxy 端依實際串流累計，不信任 Content-Length。
- Codex 重連：實測證實在同一個 app-server 上 resume 會沿用舊的 MCP（token 不變），所以改成重建 K 自己的 app-server host（token 改變，新的 Edge 可以用）。這回答了我在第五節提出的疑問，做法正確。
- 如實標示限制：「儲存副本」經由 HTTP 另存，不保證保留來源標記。

### 待查
- **假 `.exe` 下載失敗之後，整個瀏覽器變成不可用（中低，原因未明）**。一般的下載失敗不應該拖垮整個工作階段；否則惡意網頁只要觸發特定下載，就能讓 AI 和人工都無法使用瀏覽器。需要釐清是 Edge 的下載保護、Playwright 的例外，還是 K 的保存流程（例如 saveAs 包裝丟出的錯誤沒被接住），然後讓失敗只影響那一筆下載。

### 持續登入方案：方向同意，而且比 Opus 先前建議的更正確
- 方案指出：即使把瀏覽器 profile 移到另一個帳號，人工憑證仍在 K 後端的記憶體裡，而 K 後端和模型是同一個身分。同一個使用者本來就能讀取同身分處理程序的記憶體，所以 Opus 先前提的「另一個帳號執行瀏覽器、token 放 K 記憶體」並不完整。
- 反過來讓 **AI 的 CLI 以低權限身分執行**，K 和瀏覽器留在人類身分，保護範圍才完整。驗收條件第 2、3 點（包括程序記憶體、環境、命令列、CDP、Docker 和 WSL）也涵蓋了這點。
- 實作前請先評估日常代價，並列給使用者：
  - Claude 和 Codex 的訂閱登入要在低權限帳號下重新登入一次；
  - K 要以另一個身分啟動 CLI，需要評估憑證保存方式；
  - 工作區的 ACL 要讓低權限身分可以讀寫；
  - git、node 等工具在另一個帳號下是否正常。

## 八、第五輪：輸入框游標跳尾、下載崩潰調查
`npm test` 327/327（Opus 重跑）。

### 游標跳尾（`composer-caret-fix-20260925.md`）
- 修法：`frontend/main.jsx:56` 把父層的 `setDraftText` 延到 microtask 執行，並在對話切換後以 `subscribed` 旗標丟棄舊的排程。這是最小修正，沒有強制移動游標，也沒有修改上游套件。紀錄中還保留「只移除重複 onChange 無效」的反證，做得好。
- 修正前後的 selectionStart 讀回（52 → 1），以及中段插字、選字替換都有證據。
- 尚未驗證 Windows 輸入法候選字窗在組字過程中的行為，需要使用者實際確認。如果組字時仍然跳動，下一步是在 composition 期間（`compositionstart` 到 `compositionend`）暫停父層同步。

### 下載崩潰（`browser-download-crash-investigation-20260925.md`）
- 分層做得正確：不經過 K、只呼叫官方 `download.path()` 就能重現原生退出碼 `0xC0000005`，所以不是 K 的 saveAs 包裝造成的。新 profile 可以正常下載；取消下載只影響那一筆。
- 換成 Chromium 仍然重現，因此否決換成正式預設。這個判斷正確，也沒有浪費模型回合。
- **要注意：這會直接擋住「持續登入」方案。** 持續登入必須重用同一個 profile，而目前重用 profile 後下載就會讓整個瀏覽器崩潰。
- 還可以試的方向（全部只用假 profile，不花模型回合）：
  1. 找出 profile 裡觸發崩潰的狀態：逐一移除舊 profile 中和下載相關的檔案（例如 `History` 裡的下載紀錄、`Download Service` 目錄），看是哪一項。如果能找到，就可以每次啟動前只清掉那一項，保留 cookie 和登入狀態；
  2. 用 Chromium 參數停用下載泡泡或下載服務相關功能，確認能否避開；
  3. 最後的備案：對一般 http(s) 附件類型的回應，改由 Node 端 `route.fetch()` 取得內容並自行存檔，不走瀏覽器的下載機制。這個做法不涵蓋 blob 和 JS 產生的下載，只能部分避開。

## 九、第六輪：重用 profile 下載崩潰的修正（`browser-download-history-fix-20260925.md`）
`npm test` 334/334（Opus 重跑）。正式開關不存在，正式後端沒有重啟。

### 確認正確，調查品質很好
- 對照組完整：未修改的 clone 會崩潰，只清三張下載表就通過；只移除 slices 仍然失敗；只處理 `state=1` 不夠（已經否決並保留證據）；等待 5 秒也無效。最後把範圍縮到三張原生下載表的全部舊列，是有證據支持的最小處理。
- `src/browser-download-history.mjs`：
  - 在 `BEGIN EXCLUSIVE` 同一個交易裡，先備份再刪除，出錯就 rollback；
  - 備份表名只用 UUID hex，沒有 SQL 注入風險；
  - schema 不符就拒絕；
  - profile、History 和 sidecar 都不接受連結；
  - profile 正在使用時拒絕處理。
- 找出 MCP 斷線時沒有正常關閉，導致登入資料沒寫回（SDK 的 StdioServerTransport 沒有處理 EOF）。修前修後都有反證，這對「持續登入」很關鍵。
- 假登入只在第一輪注入一次，後續 cookie、localStorage、IndexedDB 都讀回相同，證明資料確實延續，不是每次重新注入。

### 建議補強（低）
- **備份表會無限累積，而且含有下載網址**：
  - 紀錄提到原生表的舊列重開後會再出現，所以每次啟動都會把重複的列再備份一批。長期使用下，History 會持續變大；
  - 更重要的是隱私：使用者在瀏覽器裡清除下載紀錄後，K 的備份表仍然保留那些網址，網址裡可能有 token。而這個 profile 目前模型讀得到。
  - 建議：依 `guid` 去重，只備份新的列；並設保留上限，例如最近 5 批或 30 天。或者在確認不需要還原後，不再保留網址欄位。
- 「舊列重開後會再出現」的來源還沒查明，屬於未解之謎。目前的做法每次啟動都會處理，所以不影響修正，但升級瀏覽器後要重跑 regression，紀錄裡也已經寫明。

## 十、第七輪：下載備份去重與保留上限（`browser-download-retention-20260925.md`）
`npm test` 340/340（Opus 重跑）。正式開關不存在。
- 第九節的建議已處理，做法比建議更周全：
  - 以「父列加上全部子列」為一組完整比對去重，不只看 GUID，所以同一個 GUID 的狀態變更也不會漏掉；
  - 用 `seen` 摘要避免已淘汰的原文被重新存回；
  - 淘汰和新增在同一個交易裡完成，並有「中途失敗整體 rollback」的測試。
- 限制都如實寫明：舊版 UUID 批次不自動刪除；清除瀏覽器下載紀錄時 K 的備份不會同步清除；`DROP TABLE` 不是安全抹除。這些都是需要使用者決定的項目，不該由工程端擅自清理，處理方式正確。
- 沒有新的阻擋項目。等以後做「人工清除下載紀錄」功能時，再一併處理舊批次和同步清除。

## 四、結論
「讀取 → 人工接手修改 → 交回 → 模型讀回同一頁」這條路徑，Claude 和 Codex 在隔離環境各實測一次，都通過。接手期間 AI 工具確實由 K 的互斥層拒絕。
在正式讓使用者登入真實帳號之前，必須先處理第一節第 2 點，也就是 token 和 cookie 放在模型讀得到的位置。第 1 點建議一併修正。
