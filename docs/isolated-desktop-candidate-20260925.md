# 獨立隔離候選：原生接線、可信瀏覽器與訂閱登入

日期：2026-09-25。狀態：**假資料執行驗證與 427 項循序回歸通過；右側假頁面顯示／人工接手另經 UI 驗證。獨立候選已開啟，等待使用者親自登入。非正式部署。**

## 授權與界線

- 延續已授權 Sandboxie Plus 官方元件與核心網路過濾試验。這輪復用先前已核對並移入回收筒的官方可攜程式副本，重新核對關鍵檔案 hash／簽章後，按需安裝 Manual 服務／驅動；沒有自啟動、購買、申請授權、重開機或 Windows 防火牆規則變更。
- 使用者本輪明確允許獨立候選，由本人登入官方 Claude／Codex 訂閱，驗證真正模型回合；確認用途為個人非商業。沒有搬取舊憑證，不改 API 計費，不登入其他網站，不取代正式 K。
- `KAgentSandbox` 仍停用。正式 `D:\K-harness` ACL 讀回與本輪開始相同；正式 `.runtime/browser-mcp.json` 不存在。
- 本輪沒有重新啟動正式 K。22:26 的正式重啟屬另一項附件修正，不是這輪隔離候選部署。

## 本輪實作

1. `src/isolated-desktop.mjs`：明確的獨立入口，把 Claude 主代理、Codex 主代理、Claude 的 Luna bridge、兩家登入／狀態檢查，都接同一隔離執行器。工作區固定在新假資料目錄；必須明確傳入可信程式路徑、隔離環境與受保護連接埠。登入預設關閉，只有授權候選明確開啟。
2. `src/sandboxie-pool.mjs`：每個原生程序生命週期獨立盒；全部盒先確認閒置，只有 runner 確認整盒停止才歸還。沒有可用盒或停止不確定時拒絕，不轉回主機執行。
3. `src/owner-browser-registry.mjs`、`src/browser-owner-gateway.mjs`、`src/browser-live-session.mjs`：瀏覽器／profile 留在可信 K 端；人工控制改成程序內呼叫，**不再有候選人工 HTTP 入口、人工 bearer 或 live.json**。原生代理只收到 AI MCP HTTP 權限，接手鎖仍由可信端執行。
4. `src/browser-mcp-config.mjs`、`src/desktop-controller.mjs`、`src/claude-controller.mjs`、`src/conversation-controller.mjs`、`src/browser-live-proxy.mjs`、`src/desktop-server.mjs`：接入上述 owner browser、官方兩家的 HTTP MCP 形式與登入工廠；原有非候選預設保留。晚到結果再次核對對話／連線。
5. `src/main-sessions.mjs`：保存非秘密的 browserSessionKey，使新 Codex thread 分配的 profile 在重開時延续；普通 metadata 更新不抹掉它。開啟 thread 失敗也會關閉已建立的 owner gateway。
6. `src/claude-login.mjs`：登入沿用明確新 home／指定官方 CLI；取消必須確認程序停止，不能把送出 kill 當完成。
7. `src/coding.mjs`、`src/worker.mjs`、`src/dispatcher.mjs`：Pi `run_tests` 也只能走可信端注入的 runner；不把 owner 環境的 API key 帶入測試程序。

### 相容性必讀

沒有注入 testRunner 的獨立 `mcp-stdio`／coding 呼叫，`run_tests` 現在會回報 `runner-not-configured`，不再直接在主機執行。其他授權工具不因此失效。候選工廠已提供同 runner 的 dispatcher；**不能把這件事寫成所有舊生產 Pi 入口都已接通**。

這輪全套第一次 424/425：舊 MCP 測試 fixture 沒有注入 runner。只修測試 fixture，明確注入測試專用 adapter，沒有在生產補回不安全 fallback。失敗紀錄保留。

## 可信部署與實際政策

本輪所有證據／候選在：

`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee`

- `trusted-runtime` 是本輪程式、相依與既有 dist-ui 的副本；`trusted-providers` 是核對過的官方 Claude／Codex 程式副本。不是從模型可寫的 workspace 動態載入程式。
- 模型對 runtime／provider／Sandboxie 執行檔只有讀取權；新 workspace、agent-home、browser-output 可寫。
- vault（profile／K 狀態）、owner 使用者目錄、原 K 金鑰／原瀏覽器 profile、Sandboxie 設定檔明確拒絕。
- 人類 K 連接埠 47831／候選 47971 由官方核心 WFP 拒絕盒內 TCP 存取；K 僅綁定 127.0.0.1。不是單靠 HTTP cookie 保護。
- K 啟動 capability 只存在記憶體，以一次性 60 秒連結交给人類介面；模型沒有取得 capability 的 HTTP 路由。
- 停用 Sandboxie Classic 的自動相容性檢查／自動開啟控制視窗，沒有套用相容性模板。Source 核對 `UserSettings_Portable` 優先於使用者 section，兩者都有關閉 auto-start 設定。
- **不是整台電腦所有秘密的全面保證**：Sandboxie 基本盒仍有其他主機唯讀範圍；同 SID DPAPI 也不能當成獨立身分。這轮驗收是明確受保護的 owner browser／K 記憶體、檔案、網路及可信程式寫入邊界。新代理 home 中官方 CLI 自己需要的訂閱憑證，不等於 owner browser 登入 cookie。

## 實測與證據

### 真實程序／真實瀏覽器，六組通過

最後重跑：`candidate-result-1790348027418.json`，逐組 log：`live-verified.log`。初次也通過：`candidate-result-1790347381356.json`。

1. 盒內 Node 讀假 cookie／假人工 token：EPERM；改 trusted-runtime 假檔：EPERM，原文仍 unchanged。不是「檔案不存在」。
2. 盒內 PowerShell 對 owner **假程序**讀記憶體：ReadProcessMemory error 5、0 bytes；NtReadVirtualMemory 0xC0000022、0 bytes；SbieDll 已注入。OpenProcess 雖成功，但 grantedAccess=0，不能誤寫成拿到讀權。
3. 實際 K 候選的 Claude／Codex auth API：兩家指定官方程式都在新 home 執行，讀回未登入；當時 login 預設 gate 拒絕。
4. 盒內 fetch 候選 K：EACCES。AI MCP 的獨立入口仍可呼叫。
5. 盒內 MCP 呼叫本機假頁，可信 K 讀到同頁 URL／真實 frame；人工接手→輸入→盒內 browser_snapshot 被拒絕→交回→盒內 snapshot 讀到人輸入的文字。
6. 真實 Pi coding `run_tests` 經同盒池執行，假測試 exitCode=0。這不是額外付費 Pi 模型回合。

測試結束八個盒均不忙碌，測試 owner／瀏覽器／HTTP 已關閉。**第 5 組是盒內程式模擬 MCP 客戶端，不是真正 Claude／Codex 模型回合。**

### 右側介面

`scripts/browser-owner-panel-probe.mjs` 使用真實 startDesktop HTTP、既有 dist-ui、owner gateway／真實瀏覽器與本機假頁。controller 為 fixture，**不是 boxed-model UI**。接手後的文字由實際網頁 DOM 讀回，再經 UI 交回 AI。

第一份 `vault/ui-probe/run-2026-09-25T14-44-57-935Z-89fdf260` 的互動成功，但主代理看圖發現白色快照，不能算視覺驗收，舊證據保留。後續核對 owner 原始截圖、gateway frame 與 K frame API 均能回傳正確假頁；probe 的舊等待條件沒有可靠確認目標頁已畫出。

改為同步檢查已解碼圖片中的假頁色塊，再核對最終儲存的整頁截圖像素，沒有修改產品前後端。重跑 `vault/ui-probe/run-2026-09-25T15-05-00-577Z-e6f44d44/result.json` 為 PASS：右側同頁顯示、點擊／輸入假文字、交回 AI 均通過。主代理親自看過 `browser-panel-human.png`，可見假頁標題、輸入欄與藍色標記；這仍是 fixture controller，不是真正模型回合。

最後一次 `vault/ui-probe/run-2026-09-25T15-05-43-569Z-59a667a4/result.json` 同樣 PASS，已儲存畫面的標記像素為 `[20,102,203,255]`；主代理亦親自查看交回 AI 後截圖。這次假 probe 的瀏覽器與 HTTP 已關閉；供本人登入的獨立候選 47971 保留運行。載入期間有空 frame 回應，稍後能取得並顯示真實 frame；不能把這項測試寫成即時影像或無延遲保證。

### 自動回歸

- 新增 `test/isolated-desktop.test.mjs` 4 項：固定 workspace、預設登入拒絕、Claude／Codex runner、Pi runner、Claude→Luna 原生 Codex runner 接線。
- owner registry 6 項、Claude login 5 項、pool 6 項通過。
- 主代理最終循序全套 **427/427**，`regression-final-427.log`（127.49 秒）；前一輪也 427/427，`regression-verified.log`。第一次缺 runner 的 424/425 保留在 `regression-final.log`。

### 實際候選入口驗收補正

- 主代理在真正候選 UI 發現「新對話」預設到了 vault/state，而不是 fake workspace；修正候選啟動時登記「隔離測試工作區」，將候選內部 state 標為封存，不修改正式 UI。
- 同時發現只有外層 selectWorkspace 的限制不夠，open(workspace) 的每室內層也必須限制；已包住各室原生 controller 的 selectWorkspace。測試明確拒絕其他目錄與 state vault，原生程序尚未啟動就拒絕。
- 主代理實際 UI 讀回：左側為「隔離測試工作區」，新對話預設亦相同，兩家為「尚未登入」。下拉仍列出封存的 state（既有共用 UI 行為），但候選拒絕以它開啟對話。
- 候選最初非 PTY 啟動的工具 stdin 提早關閉，無法更新過期啟動連結。确认該候選 PID 身分、無子程序／登入／瀏覽器後停止；`launcher-stdin-recovery.json` 保留。改成持續 stdin 的手動候選，並加 stdin 關閉即正常清理；後一次 `close` 已讀回完成。
- 現在一次性候選 Node PID 24764，127.0.0.1:47971；正式 47831 PID 50264 未操作。候選 fake URL／生命週期讀回在 `vault/candidate-lifecycle.json`，不含登入憑證或啟動 capability。

## 下一個人工步驟與未完成

**2026-09-26 更新**：兩家官方訂閱本人登入已完成，真實雙模型右側同頁／接手鎖／交回讀值已通過；另修正乾淨 Codex home 的停用 MCP 設定錯誤，431/431。最新候選 PID 49664。詳見 [雙模型 UI 驗收](isolated-model-ui-acceptance-20260926.md)；以下登入待辦是前輪歷史，不再要求使用者重登。Codex 原生沙箱尚未初始化，一般命令執行仍未驗收。

後續登入問題已修正，最新候選程序及人類操作方式見 [Claude 登入交接修正](claude-login-handoff-fix-20260925.md)。現在 47971 PID 37172；候選已讀回 Codex pro 訂閱，Claude 待本人完成。上方 PID 24764 是前一版，已正常結束。

啟動獨立候選後，由使用者本人依序點「登入 GPT / Codex」、「登入 Claude 訂閱」，在官方頁完成。**不要把密碼、驗證碼或授權碼貼到聊天**，不替使用者填寫憑證。

還要實際驗證：真正兩家模型透過候選右側讀同頁、核准、人工接手、交回後接續、重開後的假登入持續；原生 Codex 沙箱與外層 Sandboxie 同時運作的相容性也不能預先宣稱通過。完成前，不開正式瀏覽器、不登入其他網站帳號。

候選採一次性手動啟動；服務／驅動目前為本輪按需安裝，沒有 Windows 登入自動啟動。驗證結束後按使用者既有清理授權移除不再需要元件；新登入憑證不是可自動清掉的垃圾。
