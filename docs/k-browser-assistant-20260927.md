# K 瀏覽器助手（2026-09-27）

## 需求與狀態
使用者選定外部 Chrome，名稱「K 瀏覽器助手」；驗收是正式 K 新開 Astra 聊天室操作一般／無痕，不是只驗擴充。使用者取消強制「由我接手／交回 AI」按鈕，改為人工活動讓 AI 暫停，下一次本人在 K 下指示才繼續。

**02:26 已備份部署並重開正式 K，健康／工具／資產讀回通過；未驗證 K 內 Astra 真回合或 Google 真登入。** 擴充固定於 installed/k-browser-assistant，已由本人載入並允許無痕；八個 Sandboxie slots 的寫入保護已實測。未讀取或搬移日常 Chrome 登入資料。以下保留分階段紀錄，以文末正式部署段落為最新狀態。

## 差異與檔案
- `browser-extension/`：Microsoft Playwright Apache-2.0 公開擴充與 v2 relay，固定 commit `78ff4260d79b924724bdcc4ccd89e463b8f43b0d`，對應既有 Playwright `1.64.0-alpha-1789764292000`。K 名稱／圖示／獨立 ID `jhbfglfjhiebacbkjnohgmpgcppadblm`。沒有安裝新套件。
- `src/chrome-extension-context.mjs`：loopback WebSocket relay，精確擴充 origin、隨機 CDP bearer；本人選取分頁或明確允許新空白視窗。失敗不改用另一模式。斷開 K 不關使用者分頁。
- `src/external-browser-gateway.mjs`：`browser_session` 明確選一般／無痕；連線前即可取得完整既有 MCP schemas，沒有自己重造瀏覽器工具。沿用 owner gateway 的檔案與控制邊界。取消可中止等待連線，初始化失敗不假報成功。
- `src/k-browser-assistant.mjs`：只接受 vault 可信設定，專用 `vault/k-chrome-profile`；不使用日常 profile。人工活動或偵測器失效時阻擋下一筆 CDP 指令。
- `src/chrome-human-activity.mjs`、`scripts/chrome-human-activity.ps1`：按需隱藏子程序，以 Windows 最後輸入時間與前景程序名稱觀察活動；不記錄按鍵內容、座標、網址。關閉連線即結束，沒有服務／開機自啟動。
- `src/owner-browser-registry.mjs`、`src/isolated-desktop.mjs`：只由來源聊天室的本人新訊息恢復；模型工具不能自解暫停。
- `src/electron-isolated-main.cjs`、`src/electron-workbench.mjs`：可信設定存在才注入外部 gateway；不假裝把 Chrome 嵌入 K。
- `frontend/native-browser-panel.jsx`：外部模式只顯示必要狀態，不呈現接手／交回按鈕、不重造截圖操作面板。
- `scripts/verify-k-browser-assistant.mjs`、`scripts/chrome-extension-isolation-probe.mjs`：獨立假資料驗證。

## 已取得證據
- 本輪定向測試 15/15，另新增 relay 人工暫停逐指令測試，該檔 3/3。
- 真正載入候選擴充、全新測試 Chromium profile、localhost 假店：一般 fake login 保留，無痕讀不到；新建分頁留在正確無痕視窗；截圖成功；切回一般仍保留 fake login；關閉 K 連線後一般與無痕分頁都留著。
  - 選既有頁：`.runtime/k-browser-assistant-20260927/probe-1790445831989/result.json`。
  - 明確允許新視窗：`.runtime/k-browser-assistant-20260927/probe-1790446064492/result.json`。
- 隔離：空閒 KCandidate8 中的 Node 讀取新建 Chrome profile 假檔遭 EPERM；對假 Chrome 與可信測試 Node 的 VM_READ 被移除，RPM 0 bytes / error 5，NtReadVirtualMemory 0 bytes / STATUS_ACCESS_DENIED。可信正向控制均讀到 MZ。KCandidate3/4 前後 PID 不變，未干預其他工作、未改 ACL 或政策。
  - `.runtime/k-browser-assistant-20260927/chrome-isolation-1790446029401-39472/result.json`。
- Windows 觀察器本機啟動／ready／關閉成功；實際人工鍵鼠導致暫停尚待本人驗收，不把 mock 當真人驗證。
- 前端建置成功：`.runtime/k-browser-assistant-20260927/ui-build-final`；既有 bundle >500kB 警告保留，不擴修。

## 失敗與修正紀錄
- 第一輪平行全套 568/569；既有 Claude uncertain 通知測試觀察到 working。單檔重跑 47/47，未修改 Claude 生產程式；循序凍結全套結果另補。
- 前期 probe 因測試 profile 未啟用開發模式／service worker 重啟／選取但沒按允許失敗；後續改用真實允許按鈕成功，所有舊 probe 證據保留。
- Incognito 不支援一般 tab-group 流程：改為只追蹤選取與 K 建立的已連接分頁，不把其他無痕分頁自動拉入。
- 新空白頁 probe 第一次找不到按鈕：root 連線 URL 漏帶 newTab=true，補齊後實測通過。
- 隔離 probe 最初不必要地要求全部 box 空閒；修為只鎖定 KCandidate8，不停其他 box。PID 讀取／同步 IIFE 測試腳本錯誤均在假資料範圍修正，歷次 result 保留。
- 上游臨時 clone 已由子代理移入資源回收筒，固定來源副本與授權保留。早期建置 emptyOutDir 已改 false，後續不清理舊輸出。

## 邊界與尚未驗收
1. 本人一次性在專用 Chrome 載入受保護擴充、允許無痕；不繞過 Chrome 權限、不發布商店。
2. 一般登入狀態會保留；Chrome 的無痕視窗彼此共用當次暫存工作階段，全部關閉後才清除。無痕不隱藏 IP／所在地，也不刪除 K 已保存的結果。
3. 人工偵測每 125ms 觀察，Chrome-wide（其他 Chrome 視窗活動也可能暫停 K）；不是 AI 天生可即時知道人的動作，也不能撤回已送出的指令。登入／驗證時本人操作，下一次 K 指示才恢復。
4. 專用設定未啟用前正式仍用原路徑。正式部署需正常停止、備份與讀回；禁止把候選成功當正式完成。
5. 真 Chrome Google/TikTok 登入、K 內 Astra 一般／無痕完整回合、真人暫停、下載／上傳尚待驗收。外部 Chrome 不保證任何網站一定接受登入。

## 固定安裝位置（使用者要求後調整）
已將擴充 18 檔複製至 `D:\K-harness\installed\k-browser-assistant`，逐檔 SHA-256 與先前 vault 版本一致，manifest 名稱讀回「K 瀏覽器助手」。此目錄為 Chrome 唯一正式載入位置，後續不得任意搬移或當建置暫存清除。舊 vault 副本保留供還原，沒有刪除；原先要求使用者載入 vault 路徑已撤回。
新位置尚未完成模型寫入拒絕驗證，因此可以先由本人載入擴充，但不得據此宣稱正式 K 接線或隔離已驗收；正式啟用前必須完成新位置保護與實測。沒有變更 Sandboxie 政策或啟用設定。

## 凍結回歸與本人安裝確認
- 循序全套 569/569 通過，記錄 `.runtime/k-browser-assistant-20260927/regression-final.txt`（新增逐指令暫停測試前）；其後定向 27/27 含該新增測試通過，記錄 `targeted-final.txt`。
- 本人提供 Chrome 畫面：K 擴充已啟用、固定安裝位置正確、無痕權限開啟。另限定讀回 K 專用 profile 中該擴充的 path/incognito 欄位，確認 path 為 installed/k-browser-assistant、incognito=true；未輸出或取用其他登入資料。
- 使用者已回覆停止 K，主代理確認 47831 無 listener、沒有 K Electron 程序。正執行固定目錄保護／部署前驗證，尚未重新啟動。

## 02:26 正式部署與讀回
使用者明確表示已停止 K 並要求完成實驗。主代理獨立確認 K port / Electron 關閉；八個 boxes 均閒置。

固定擴充目錄保護已完成：八個 box 各新增一條 `ReadFilePath=D:\K-harness\installed\k-browser-assistant\*`，既有 OpenFilePath 不變；正式政策讀回與 SbieApi_QueryConf 有效規則吻合。KCandidate3 在整個 K 工作區 OpenFilePath 下，可讀假檔，覆寫／新增均 EPERM，工作區正常寫讀；18 個擴充產物 hash 不變。主代理讀回結果，並重跑相關 17 項測試通過。
- 政策備份／完整證據：`.runtime/k-browser-assistant-20260927/installed-extension-protection-1790447054134-31680/`。
- `src/sandboxie-workspaces.mjs` 依 candidate root 推導固定安裝位置，拒絕其被當作工作區；不是依 source/trusted-runtime 的相對位置推導。

已備份更新正式 21 個檔案／設定（後端、relay bundle、觀察器、前端與可信 opt-in 設定），來源／備份／目的地逐檔核對。
- 備份與還原對照：`.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/vault/k-browser-assistant-backup-20260927-022630/receipt.json`。
- 部署紀錄：`.runtime/k-browser-assistant-20260927/deployment.json`。
- 首次部署預檢因 PowerShell 直接叫 GUI Start.exe 未捕捉 stdout 而誤判占用，在任何寫入前停止；改以 Node execFileSync 取得精確 PID 清單後通過，沒有停止任何程序來繞過。
- 同步包含已驗證、原先待部署的 embedded restore refresh 小修；外部模式不再依賴嵌入畫面。舊路徑程式仍保留可還原，正式設定選外部。

由原 Start-K-Desktop.ps1 啟動，47831 health=isolated。正式模組 loadKBrowserAssistant 讀回 external=true；完整 27 個 MCP tools 包含 browser_session、navigate、snapshot、screenshot，連線前即可列出。正式 HTTP JS 與候選／部署檔 hash 一致：228f80f2048359b167cbf79ee32f5d4bfd39777a880aa4f4e2f70e28013b1ae1。
- 正式模組與資產讀回：`.runtime/k-browser-assistant-20260927/installed-smoke-1790447229258/result.json`。
- 此讀回沒有發送模型回合，也沒有操作 Chrome 網頁；不能當成 Astra 在正式 K 一般／無痕完整驗收。

獨立複查確認 ready 逾時、observer 啟動失敗及斷線不會選取舊模式；補斷線 browser_session 明確提示重開對話而非誤報人工接手，gateway 7/7 通過。Runtime observer 失效時仍 fail closed，但模型端 browser_session 錯誤可能泛稱人工接手；下一則本人訊息會顯示精確觀察器失效訊息。此為已記錄診斷限制，不允許繞過。

**目前正式 K 已更新且開啟，可開始本人要求的新 Astra 聊天室驗收。** 一般／無痕、假登入隔離、截圖、保留分頁是前述真擴充＋測試 Chromium 假頁證據；真人鍵鼠自動暫停、正式 K 內完整模型回合、Google 真登入仍未代驗。沒有搬移／刪除原對話、登入或日常 Chrome 資料。

還原：正常停止 K，依 receipt 把 Existed=true 的備份放回並核對 OldHash；新設定若要停用須另行明確處理（移入回收筒而非永久刪除）。不要執行舊部署腳本覆蓋回舊版。政策備份可用於精確還原這八條只讀新增規則，但保留新擴充時不應移除保護。


## 02:53 取消重複允許（0.1.1）
使用者明確要求：K 工作指令與既有權限就是瀏覽器操作授權，不再要求每次連線另按允許；登入／驗證由本人處理。此要求取代上文的逐次選取／允許流程。

- 擴充 connect UI 在有效 newTab=true 請求下自動建立指定一般／無痕空白分頁並連線，沒有允許按鈕；移除任意既有頁選取入口，不自動接管其他分頁。
- 保留 Chrome 一次性擴充／無痕權限、精確來源／loopback／模式核對，以及人工操作暫停。非同步錯誤顯示到頁面，不再只有未處理 Promise 與等待畫面。connect.html UTF-8 也補齊。
- 版本 0.1.1；本輪只覆蓋固定位置的擴充產物，不停止／修改仍執行中的 K 後端。根目錄 src/chrome-extension-context.mjs 的逾時訊息修正已測3/3，但未覆蓋正式後端，留待下次正常停止套用；正式 bridge 已有 newTab=true，與新版擴充相容。
- scripts/verify-k-browser-assistant.mjs 改為真正 spawn Chrome 命令列開啟連線頁，不再用 page.goto 或測試器點允許。一般／無痕兩種模式均無點擊即可連上；導航、假登入分離、新分頁、截圖、切回一般與斷開保留分頁通過。
- 證據：`.runtime/k-browser-assistant-20260927/probe-1790448780716/result.json`。獨立測試 Chromium＋localhost 假頁，不是正式 Opus 模型回合或 Google 登入。
- 已備份／套用20個產物並核對hash。備份：`.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/vault/k-extension-011-backup-20260927-025334/receipt.json`；部署記錄：`.runtime/k-browser-assistant-20260927/extension-011-deployment.json`。未刪除舊產物／假證據／登入狀態。
- Chrome 仍需一次重新載入擴充以更新已載入程序；這不是每次工作授權。正式K側Opus重測待此重新載入後進行，未冒稱已成功。

此前使用者只觀察連線頁框／等待，未取得精確錯誤，因此不能將其兩次逾時歸咎於沒按允許。舊版commandline啟動＋測試器允許的控制組曾成功（probe-1790448452387）；首輪控制組因測試仍找已隱藏列表失敗（probe-1790448428551）。本輪按明確產品決策取消額外允許，不宣稱已證實所有先前逾時的根因。

## 03:00 修復正式擴充載入失敗
使用者截圖明確錯誤：正式擴充根目錄留下 `__sandboxie-readonly-probe-1790447054134-31680`，Chrome 拒絕 `_` 開頭的保留名稱。這是本輪隔離驗證留下測試資料造成的部署錯誤，不是使用者操作／授權問題。
主代理核對完整路徑後，將該測試子目錄移至 `.runtime/k-browser-assistant-20260927/installed-extension-protection-1790447054134-31680/preserved-fake-files`，保留假檔，未刪除；正式擴充目錄已無 `_` 開頭項目。測試腳本前綴也改為非保留名稱，避免重現。
先前只測 build/dist，漏驗「加入隔離假檔後的正式安裝目錄」。現補以 **D:\K-harness\installed\k-browser-assistant 真正固定目錄**載入獨立 Chromium，命令列啟動及一般／無痕無允許點擊完整假頁流程通過，證據 `probe-1790449136098/result.json`。未讀取使用者日常瀏覽器資料；正式 Chrome 需使用者在原錯誤框按重試。

## 正式 Chrome 白畫面／逾時：重新開啟驗收
使用者回報 0.1.1 正式一般模式仍逾時，Chrome 視窗有開但白畫面且不能正常操作。此為正式驗收失敗，前述測試 Chromium 結果不足以宣稱正式 Chrome 可用。已限定讀回 K 專用 profile 的 K 擴充設定：固定路徑存在、developer_mode=true、has_started_service_worker=true、incognito=true；不是已證明只裝在日常 Chrome。尚未確認根因，不歸咎本人未允許。
正在檢查先前遺漏差異：正式 Chrome 由 Electron 首次啟動，原 probe 是先以 Playwright 啟動測試 Chromium 再開連線頁。正式 spawn 設 windowsHide:true，需與可見啟動／Electron父程序做獨立假資料對照。執行中profile的 exit_type 標記不能單独證明崩潰。

## 03:36 停止恢復與 Chrome 首啟修正

停止問題另見 `shutdown-repair-20260927.md`。依本人本次授權、逐一核對 PID／建立時間／路徑後清理卡住的 K 自有程序；日常 Chrome 14524 保持原程序，未刪除任何 profile 或登入資料。

### 實驗結論（不混同现场根因）

- Node 父程序／Electron-as-Node 不能重現；這兩者不等於正式 Electron app main。
- 真正 Electron 44.4.5 app.whenReady 後首開全新假 profile：原 windowsHide:true 在 12 秒內無可見視窗、localhost 請求 0；false 出現可回應 Chrome 首啟視窗，但 URL 仍未載入。
- 同樣新 profile 加 `--no-first-run --no-default-browser-check` 後，true/false 均載入假頁、視窗可回應。已證實首次設定畫面會阻擋 URL，而且隱藏啟動可使其無法操作；不是 Google 登入或擴充允許問題。
- 證據：`.runtime/k-chrome-electron-app-20260927-032358-471/result.json`、`k-chrome-electron-app-visible-20260927-032606-415/result.json`、`k-chrome-electron-nofirst-hidden-20260927-032743-491/result.json`、`k-chrome-electron-nofirst-visible-20260927-032848-077/result.json`（後三者同在 `.runtime`）。
- **重要限制**：終止舊卡住的專用 Chrome 後，既有正式專用 profile 以原產品啟動選項也恢復一般 804 ms／無痕 689 ms 接線，兩者 localhost 假頁成功。不能將新 profile 的首啟原因直接宣稱為舊現場唯一根因。證據 `.runtime/k-browser-real-electron-connect-20260927-033436-062/result.json`。

### 最小修正及部署

`src/chrome-extension-context.mjs` 的互動 Chrome 不再隱藏啟動，並略過首啟／預設瀏覽器提示，避免已重現的 URL 阻擋；不取消安全檢查、不搬登入、不新增 fallback 或重試。同步部署先前已修的逾時提示，不再要求不存在的「允許」按鈕。

03:36 備份後更新正式 runtime 同名檔，source/destination hash 相符；收據 `.runtime/k-browser-assistant-20260927/chrome-launch-deployment.json`，備份 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/vault/chrome-launch-repair-backup-20260927-033606`。擴充固定路徑及 0.1.1 產物未變，不要求重新載入擴充。

停止／bridge／gateway／assistant 定向回歸 24/24 通過；停止專項與 conversation 回歸 40/40 通過。真正 Electron main 載入正式安裝 bridge、實際 Chrome 專用 profile：一般 741 ms／無痕 707 ms 皆連上且讀回 localhost 假頁，各只附接一個新頁，沒有 fallback／額外允許；測試新頁關閉後專用 Chrome 程序為零。證據 `.runtime/k-browser-installed-product-connect-20260927-040500/result.json`（目錄為識別名；實際 completedAt 為 03:38:09）。此為接線驗證，不是 K 內 Opus 模型完整驗收或真登入驗收。

03:39 由原 Start-K-Desktop.ps1 重新啟動正式 K，啟動器 ready、health deployment=isolated；兩個正式更新檔與 source hash 一致。最終讀回 `.runtime/k-browser-assistant-20260927/repair-final-readback.json`。現在可由本人在 K 新聊天室交給 Opus 重測一般／無痕；不必再載入擴充。對話、登入與日常 Chrome 保留。

## 04:09 正式 K 內 Opus 一般／無痕實測（本聊天室）
取消人工活動自動暫停並重開正式 K 後，Opus 在正式 K 聊天室以 k_browser 工具實測。只用沙箱內自建本機假網站 `127.0.0.1:47999`（`.runtime/k-browser-opus-test-20260927/server.mjs`），沒開真實網站、沒真登入。
- 無痕：browser_session 連線成功；導航、讀頁、輸入、點擊（讀回「按到了:無痕測試123」）、連結開新分頁（tabs 列出第二頁）、假登入 cookie、截圖均成功。
- 一般：連線成功，看不到無痕的假登入（「未登入」）；輸入、點擊、假登入、截圖（影像讀回確認）、tabs new 均成功。
- 切回無痕：原分頁仍在，自身假登入保留。反向（無痕看不到一般登入）未另開全新無痕驗證。
- 觀察到的限制：data: 網址被 Chrome 拒絕（ERR_ABORTED）；分頁被新分頁蓋到背景時，點擊／截圖 5 秒逾時，browser_tabs select 切回前景後恢復。
- 此前三次 browser_session 逾時與一次「human-control」拒絕，分別由其他主代理修正首啟阻擋與移除自動暫停後解除；本聊天室未修改程式。
- 仍未驗收：真實網站登入（Google 等）、下載／上傳。
