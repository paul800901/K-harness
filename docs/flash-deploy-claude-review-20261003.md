# Flash 與 Gemini 多帳號：Claude 複查及南區部署（2026-10-03）

## 授權與狀態

使用者明確要求「那就部署，剛好也讓 Claude 看過」。本輪先完成 Claude 官方訂閱只讀複查，再修復實質問題、完整測試、保留上一版程式與啟動器，最後部署南區並做正式讀回。**南區正式版已部署並完成讀回，版本 `b9a3633b2e7e8bbe4be8a104fa4b94eeedd30a05`；原入口重開成功。**

本輪不 push、不打 tag、不更新東區，不保存／切換真實 Antigravity 憑證、不代替本人登入第二帳號。未加入帳號時沿用目前官方登入；正式多帳號使用仍須另取得真憑證測試授權及本人登入。聽寫、GPT／Claude 帳號及 API 計費不變。

維護來源：`C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`，基底 `0ae4be1`。`D:\K-harness` 仍為保留實驗的舊工作樹；不得整批覆寫。

## Claude 實際執行方式

- 官方 Claude Code **2.1.285**，實際模型 **Claude Opus 5.5**（`claude-opus-5-5`）；先確認 `claude.ai`／`firstParty` Pro 訂閱，不帶 API／雲端替代計費變數。
- 專用審查資料夾含來源副本、基底、diff 與新增檔清單，138 個來源檔；排除 runtime、登入資料及秘密。只有 Read／Glob／Grep，plan、restricted、safe-mode、無 MCP、無 Chrome、無 shell／寫檔工具。來源內容為待審資料，不是授權。
- 真正執行成功：exit 0、result success、is_error false、26 native turns、無核准拒絕、無 web search；session `6ef8a132-5127-4969-8381-5e409bf86c26`。17:52 起執行。本次是 Claude Code review，不冒稱 Codex 的原生 /review。
- 能做：閱讀新增／保留程式與接線、指出可推演的並行及副作用問題。不能取代真實憑證操作、官方權限實測或 UI 驗收；Claude 未親自跑測試。原始回覆全文保留於下方，不把它的「未見阻擋部署」當成所有功能已驗收。
- 原始證據：維護來源的 `.runtime/flash-deploy-20261003/claude-review-{auth,start,result}.json`、`claude-review-raw.jsonl`、`claude-review-prompt.txt`、`claude-review.md`。原生 cost 欄只是模型用量估算，不表示改用 API 計費。

## Findings 與處理

| 發現 | 實際影響 | 最小修正方向 |
| --- | --- | --- |
| F1：執行超過 60 秒後，同帳號新工作被拒 | 舊登入確認時間過期，但刷新又要求沒有工作 | 既有同帳號工作持續時，沿用已驗證登入；不允許 signed-out／unknown／額度用完，也不放寬換帳號鎖 |
| F2：背景刷新額度與派工相撞 | 只讀刷新被誤當登入切換，直接讓新工作失敗 | 等目前既有的 refreshPending 完成，再檢查真正登入／切換鎖；失敗傳回，不重送工作 |
| F3：派工失敗前已換帳號 | 指定已知用盡／登出的帳號，切換後才拒絕 | 真切換之前先拒絕已知不合格目標；保留切換後原生身分與額度查詢 |

修正限 `src/gemini-accounts.mjs` 與測試，由 Luna/high 限定實作，Astra 獨立讀 diff／驗證。修前失敗、修後成功與最終完整測試已記在後段，不以讀碼推論冒充已重現。

## 仍保留的限制

- 真實多帳號的保存、登入、取消還原、A→B 切換及新工人接手尚未驗收；不以假資料通過宣稱已經可放心輪替。正式部署本身不新增帳號。
- 同一 Windows 登入為共用資源，加入 K 帳號後，官方 Antigravity／agy 程序仍開著會擋切換及新工作，這是避免競爭的保護。K 不動 Chrome Google 登入。
- 第一次加入帳號後，沒有帳號綁定的舊 Gemini 對話需要以新對話交接；不跨帳號接續原生歷史。
- 無法確認 Flash 程序已停止時仍 fail-closed，沒有完整的一鍵復原介面；不能為了關閉順利而默認完成或重播。
- Gemini 真 Chrome 操作、Gemini 跨派 GPT，以及跨既有對話的真額度 UI 切換仍沿用既有未驗證／未接入界線。
- 前一輪 GPT 與 Claude 各一次真 Flash 唯讀假檔、自動回原對話 **2/2** 已完成，本輪不再消耗已用過的限定兩次核准；詳見 [GPT／Claude 一起派 Flash](gpt-flash-20261003.md)。

## Claude 首次審查原文（未改寫）

以下是原生最終 result 的原文；其中行號及「尚未重現」描述對應補修前的副本，後續處理記在正文而不回改原文。

---

# K HARNESS Flash／Gemini 多帳號候選：部署前 code review

我只讀了 review-packet 內的檔案。沒有寫檔、沒有執行命令、沒有用網路或 MCP，也沒有派子代理；plan file 也沒有寫，因為你禁止寫檔。

## 結論先講

- **沒有阻擋部署的問題。** 在「還沒加入任何帳號」的狀態下部署，不會讀寫或切換 Windows 憑證。
- **找到 3 個問題，都要先加入至少一個 Gemini 帳號才會出現。** 前 2 個是中等嚴重度，會在加入帳號後讓多個 Flash 並行或背景額度刷新時出錯；建議在「本人加入帳號」之前修好。

## Findings

### F1（中）：Gemini 工作跑超過 60 秒時，其他 Gemini 工作一律被拒

- **位置**：`src/gemini-accounts.mjs:122`，相關判斷在 `:101`
- **原因**：開工前（`acquire`）若帳號登入確認已超過 60 秒，就要求重查；但只要有工作在跑（`running>0`），就直接報「帳號狀態待刷新」。同時背景刷新在有工作時又被跳過（`:101` 要求 `!running`）。結果是第一個工作跑滿 60 秒後，確認時間一定過期，第二個工作一定失敗。
- **重現**：
  1. 加入 1 個帳號。
  2. GPT 或 Claude 派 Flash A，任務要跑 2 分鐘。
  3. 60 秒後再派 Flash B（同一或另一個聊天室都一樣，帳號狀態是全域共用）。
  4. B 立刻變成 failed，訊息是「帳號狀態待刷新，請等現有 Gemini 工作結束」。Gemini 主對話在 Flash 執行中送出也會一樣失敗。
- **最小修正**：只有「需要換帳號」或「`running===0`」時才強制重查。不換帳號、而且有工作在跑時，沿用目前帳號上次的 `authenticated` 結果放行；但若上次結果是 signed-out 或額度用完，仍要拒絕。

### F2（中）：背景額度刷新會讓同時送出的 Gemini 工作失敗

- **位置**：
  - 刷新入口：`src/gemini-accounts.mjs:98-103`（`usage()` 呼叫 `api.refresh()`），經 `exclusive`（`:28-32`）把 `changing` 設為 true
  - 被拒的地方：`acquire`（`:110`）與 `inspect`（`:66`）看到 `changing` 就直接丟錯
  - 觸發來源：`src/desktop-server.mjs:126` 每次 `/api/usage` 都呼叫 `geminiAccounts.usage(false)`；前端 `frontend/usage.jsx` 每 10 秒輪詢一次
- **原因**：加入帳號後，大約每 60 秒會有一次背景刷新。刷新期間要跑 2 次 PowerShell helper 加 1 次 agy 狀態查詢，可能持續數秒，這段時間 `changing` 一直是 true。
- **重現**：
  1. 加入 1 個帳號，閒置超過 60 秒。
  2. 在下一次額度輪詢的同時送出 Gemini 訊息，或讓主代理派 Flash。
  3. 會得到「Gemini 正在切換帳號或登入，未開始工作」；Flash 紀錄變成 failed。
  4. 同一段時間內 `/api/models` 的 Gemini 目錄與 `/api/gemini/auth` 也會失敗。
- **最小修正**：背景額度刷新不要用代表「帳號正在切換」的 `exclusive/changing` 鎖。改用另一個 refreshing 狀態，讓 `acquire` 和 `inspect` 先等刷新做完（例如 `await refreshPending`），而不是直接拒絕。

### F3（低）：送出失敗時，仍可能已經把目前登入換掉

- **位置**：`src/gemini-accounts.mjs:118-124`
- **原因**：程式先執行 `activate(target)`（實際切換 live 憑證），之後才檢查目標帳號額度是否用完、登入是否有效。
- **重現**：
  1. 有 A、B 兩個帳號。某個 Gemini 對話綁定 A，A 的快取額度是每週 0%。
  2. 使用者手動切到 B。
  3. 在綁定 A 的對話送出訊息：live 憑證先被切回 A，接著才報「此帳號額度已用完」。
  4. 這次送出失敗，但目前使用的帳號已經變成 A。Flash 明確指定已用完的 `accountId` 時也會這樣。
- **最小修正**：在呼叫 `activate` 之前，先用 `find(target)` 檢查快取的 `exhausted` 和 `auth.status==='signed-out'`，不合格就直接拒絕、不切換。

## 我確認過沒有問題的重點

- **部署不會碰憑證。** 正式入口 `isolated-launcher.mjs:66` 設了 `allowLogin:true`，帳號管理在正式版是啟用的。但帳號數為 0 時，`list`、`usage`、`refresh`、`acquire`、`inspect`、`cachedUsage` 都會提早返回，不會呼叫 helper；只有本人按「保存目前登入」等按鈕才會寫入。
- **Windows credential helper 沒找到外洩管道。**
  - helper 只輸出 email、accountId 或錯誤代碼，stderr 是固定訊息。
  - Node 端用 `safeFailureMessage` 丟掉其他輸出，並限制 `maxBuffer` 4096。
  - 參數不含秘密，blob 用完會清零。
  - 只操作 `antigravity.gemini` 和 `K-Harness.Antigravity.<ns>.<id>` 這兩類目標。
- **派工不重送。** 同一個 requestId 若內容不同會被拒；接手（handoff）一定要新 ID，而且原工作必須已確認停止。完成通知只送一次，送出狀態不明時記為 uncertain、不重送；`stop()` 會先讀回原生回合再中斷。
- **權限沒有超過主對話。**
  - Codex 的 auto-review 對應 Flash 的 workspace-write；完整存取權對完整存取權。
  - k_gemini 是 loopback 加 bearer token 的專案限定設定。
  - Gemini 瀏覽器只預先核准 `mcp(k_browser/*)`，唯讀模式不開瀏覽器。
  - 所有 POST 都要帶 `X-K-Request` 並驗證 origin。
- **刪除內容沒有破壞引用。** `luna_*` 改名成 `gemini_*` 只影響 geminiOnly 模式；Claude 仍用 `k_luna`/`luna_*`。`validateWorkerPolicy` 的呼叫端只有 desktop-controller 和 luna-bridge（GPT 分支）。

## 部署風險（是設計決定或還沒驗證，不算已重現的 bug）

1. **第一次保存帳號後，舊的 Gemini 主對話會停用。** 已開始過的舊對話沒有帳號綁定，會一律被拒（`gemini-controller.mjs:138`，訊息在 `gemini-accounts.mjs:116`），要開新對話交接。
2. **加入帳號後，開著官方 Antigravity 程式會擋住所有 Gemini 工作。** 只要偵測到 agy 或 Antigravity 程序（`Assert-Idle`），Gemini 送出和 Flash 都會被擋。
3. **unresolved 的 Flash 會讓 Codex 聊天室無法關閉。** 狀態為 unresolved 的 Flash 紀錄（K 重啟、或程序終止未確認）會留在磁碟上。之後只要這個聊天室再用到 Flash，停止、切換對話、關閉 K 都會一直失敗（`desktop-controller.mjs:290`）。這是刻意的 fail-closed，但目前沒有解除的方法。
4. **憑證格式的假設都還沒用真憑證驗過：**
   - live target 名稱與 GENERIC 類型
   - blob 是 UTF-16 JSON、而且只含一個 email
   - 冷啟動時 `Add-Type` 編譯加上執行，能否在 15 秒內完成
5. **正式版 UI 會出現憑證寫入與切換按鈕。** 需要本人點按，但這些流程還沒經過真實驗收。

## 審查範圍

- **逐段看過**：`changes.diff` 裡的程式部分，包括 frontend 的 account-connections、model-picker、usage，以及 src 的 desktop-controller、desktop-server、gemini-controller（含圖片與瀏覽器候選）、gemini-worker、isolated-desktop、luna-bridge、luna-gateway、main-sessions、owner-browser-registry、unified-controller、worker-policy、claude-controller。
- **新檔看過**：`src/gemini-accounts.mjs`、`src/gemini-credential-vault.mjs`、`scripts/gemini-credentials.ps1`。
- **current/ 抽查**：luna-bridge 的 inspect、cancel、close、list；gemini-worker；isolated-launcher；desktop-server 的 POST 防護。
- **沒細看**：測試 diff 與新測試檔、docs、AGENTS/README 的文字、CSS，以及 base/ 的刪除內容（只確認引用）。

## 尚未驗證

- 真實帳號的保存、登入、完成、取消、A→B 切換與還原；目前尚未加入任何帳號。
- 額度用完後自動換帳號、以新工作 ID 接手的真流程。
- F1、F2 的並行情境：靠讀程式推論出來，沒有實際執行。
- Gemini 瀏覽器在真 Chrome 上的操作。
- 我沒有執行 632/632 測試、建置或 UI probe；那些結果是你提供的。

## 補修獨立驗證與 Claude 補看

- Astra 讀回兩個檔案的實際差異，沒有擴張登入／切換授權。
- 用首次審查保留的原實作副本，配合新增 6 項回歸再次實測，**1 pass／5 fail**；修後帳號測試 **24/24**，完整 **638/638**（33,841 ms），fail／cancelled／skipped 均 0。不是只採用子代理回報。
- UI 建置、GPT Flash 選擇與多帳號假資料 UI 均 PASS，沒有真模型或真憑證操作。既有 bundle 大小提示保留，不做無關拆包。
- 原始證據在維護來源 `.runtime/flash-deploy-20261003`：`root-original-regressions.log`、`root-accounts-final.log`、`root-full-final.log`、`root-build-ui.log`、`root-gpt-ui.log`、`root-accounts-ui.log`。前一項是 Astra 在補修後用保存的舊實作重現，不冒稱為子代理最初那次輸出。
- Claude 同一 Opus 5.5 session 補看兩個修正檔，exit 0、4 native turns；確認 F1／F2／F3 根因已處理，沒有新增阻擋部署問題。實際原文如下。
- **未處理原因**：補看另指出「閒置後同一瞬間派兩項工作，第一項開工前查詢仍會鎖住第二項」；此為既有帳號初始化競爭，不是背景刷新回歸，未加入帳號時不觸發。本次不另造排程／重試機制，保留在真多帳號啟用前的待處理清單。查詢失敗仍拒絕派工是刻意保留的身分保護；手改帳號紀錄缺 auth 欄位不擴成新 migration。

### Claude 補看原文（未改寫）

**結論：三項的根因都已處理，沒看到直接 regression，也沒有需要阻擋部署的問題。** 只剩一個同類的小縫和一個刻意的設計取捨，都要加入帳號後才會出現，不擋部署。這次我只讀了 followup-packet 的 `current/src/gemini-accounts.mjs` 和 `current/test/gemini-accounts.test.mjs`，沒有執行測試；638/638 是子代理回報的數字，不是我跑的。

## 三項確認

- **F1（已處理）**：同帳號已有工作在跑時，只要快取是 `authenticated`，就直接沿用、不重查（`:129-133`）。不是 `authenticated` 而且有工作在跑時，直接拒絕，不會在執行中去查狀態。測試在 `:57`。
- **F2（已處理）**：`acquire`（`:109`）和 `inspect`（`:66`）會先等正在進行的背景刷新做完，再檢查 `changing`。背景刷新不會再讓同時送出的工作失敗。測試在 `:65`。
- **F3（已處理）**：換帳號前，先擋掉找不到、已知 signed-out、額度已用完的帳號；這些檢查都在 `running` 檢查和 `activate` 之前（`:120-126`）。測試在 `:153`、`:160`。

## 剩下的問題（不擋部署）

1. **同類小縫：開工前重查狀態時，仍會拒絕同時進來的請求。**
   - **位置**：`acquire` 自己的 `query`（`:133`），重查期間 `changing` 保持 true。
   - **重現**：加入帳號後閒置超過 60 秒，主代理在同一回合同時派 2 個 Flash。第一個在重查狀態期間（數秒），第二個會收到「正在切換帳號或登入」；同時間的 `/api/models` 走 `inspect` 也會失敗。
   - **為什麼不是新的**：這跟 F2 是同一個根因（狀態查詢期間，別的請求被鎖拒絕），只是從背景刷新換成開工前重查。補修沒有讓它變差。
   - **最小修正**：把開工前的重查也做成一個可等待的 promise，讓其他 `acquire`／`inspect` 先等它結束再檢查；只有真正的帳號切換或登入操作才直接拒絕。
2. **刻意的設計取捨：背景刷新失敗時，正在等它的工作也會一起失敗。**
   - 測試 `:82` 明確要求這樣做（fail-closed）。背景刷新若因 helper 逾時或登入身分改變而失敗，同時送出的工作會跟著失敗。這是取捨，不算 bug；如果希望只有身分改變才擋，可以只在那種錯誤時往外丟。
3. **小地方**：`:129` 直接讀 `chosen.auth.checkedAt`，舊寫法有短路保護。正常流程中每個帳號都有 `auth` 欄位，只有手改過帳號紀錄檔才會丟 TypeError；`finally` 仍會清掉鎖，不影響部署。

**部署本身**：帳號數為 0 時，`:114` 會跳過所有帳號邏輯，`refreshPending` 也一直是 null，所以這次補修不會改變「部署不碰憑證」這一點。

## 真 UI 讀回追加補修：帳號畫面殘留忙碌

- 候選已建置但尚未套用時，真服務讀到三家已登入；Gemini 卡片卻仍顯示「正在工作」，保存按鈕鎖住。原生帳號查詢與帳號清單原本同時發出，清單快照抓到查詢中的 busy，查詢完成後沒有重新讀清單。這是實際產品問題，不是登入失敗。
- 修正 `frontend/account-connections.jsx` 三處接線：先完成登入查詢，再讀帳號清單；移除初次載入及刷新按鈕的重複平行查詢。保留實際工作忙碌時的保護，不強行解鎖、不寫憑證、不新增輪詢或按鈕。
- 將上述查詢時間差加入假資料 UI probe，修前得到可重現逾時；修後整套帳號 UI PASS。第一個修後斷言太早讀按鈕狀態，另保留失敗 log；改為等待查詢完的可用按鈕，不更改產品條件。這三行追加由 Astra 驗收，沒有冒稱 Claude 已看過這個後加修正。
- 首次真 UI 工程腳本另有一個獨立錯誤：設定帳號區預設已展開，腳本卻再點一次而收合；只修腳本的展開判定，原失敗保留。沒有藉由工程腳本操作保存／切換／登入。
- 維護來源證據：`.runtime/flash-deploy-20261003/accounts-busy-before.log`、`accounts-busy-after.log`、`accounts-busy-after-early-assertion.log`、`busy-fixed-full.log`。南區證據 `pre-ui-fix` 保留最初候選、測試及真 UI 失敗收據；準備全新後續候選，不覆寫原候選。

### 追加根因確認：不只有設定自己的登入查詢

按順序查詢的第一個修法雖通過假資料測試，真 UI 仍讀到忙碌；啟動時另外還有模型目錄等原生查詢，單一請求順序無法代表全部查詢結束。保留 `candidate-ui-sequenced-busy-failed.json`，未部署該中間版。

最終改為：帳號清單回傳 busy 時，畫面每秒只讀更新清單，直到 busy 解除即停止；不重新執行模型、不改後端鎖、不在未確認停止或本人登入中背景嘗試恢復。安靜刷新不把帳號卡片切回讀取畫面；關閉介面時取消計時器。前一個順序查詢修法撤回，避免維持無效的接線。這是已重現的忙碌狀態更新需求，不新增常駐服務或無條件輪詢。

假資料 probe 已模擬未加入帳號時的原生查詢暫時占用；有帳號後官方路由直接返回已知狀態，不再錯誤模擬每次都啟動原生查詢。修正前後的 fixture 失敗 log 保留，最終假資料 UI 及完整測試見 `accounts-busy-settled.log`／`busy-settled-full.log`；仍須以最後真 UI 證據判斷是否部署。

## 南區正式部署與讀回

- 使用本機 Git 提交 `b9a3633b2e7e8bbe4be8a104fa4b94eeedd30a05` 匯出全新候選；沒有推送 GitHub 或打新標記，東區不動。
- package／lock 與原正式版一致，只複製已安裝相依，沒有安裝或升級套件。UI、Chrome 擴充、Windows 啟動器重新建置；候選完整測試 **638/638**，35000.4455 ms，fail／cancelled／skipped 0。
- 首次準備受 Windows PowerShell 5.1 的 stderr 處理影響：Vite 已成功建置，但既有 bundle 警告讓工程腳本提前停止；同時準備收據的中文設定被隱含 ANSI 解碼。正式設定沒有寫入。保留原收據及 log，改用 UTF-8 讀回原設定，再以 PowerShell 7 繼續候選建置／測試；沒有重送任何模型工作。詳見 `preparation-recovery.md`。
- 候選真 UI 通過後，更新前再次檢查 K 程序為空，47831 無監聽，未強制結束工作；原生審查與測試程序已退出。
- `2026-10-03T10:17:01.152Z` 依既有 activateRuntime 交易交換程式。438 個 Git 檔案內容吻合（文字只正規化 CRLF/LF），未把測試產生的瀏覽器診斷部署出去。
- 可退回版本：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791022621083`。舊程式、啟動器及原設定皆保留並讀回；**這不是對話備份**，退版不還原對話。
- 本機設定只有 version／previous 更新；Whisper 路徑、K 專用 Codex 設定、核心執行檔與資料位置不變。
- 候選及正式的隱藏工程視窗都以真服務／真建置 UI 讀回：三家登入、Gemini 官方額度、GPT 可選 Flash（low／medium／high）、帳號入口。沒有攔截假 API、沒有建立對話、沒有送模型回合、沒有按保存／加入／切換帳號。正式帳號清單仍為空，帳號紀錄檔沒有新增。
- 工程視窗正常退出後，另執行原 Start-K-Desktop.ps1，不以工程殼冒充日常啟動器。正式視窗「K 執行中樞」、native health、b9a3633 版本及執行檔位置均讀回；3 個服務資產 HTTP 200 且 hash 相同，未授權 /api/state 仍 403。
- 實體麥克風、真 Chrome 操作與真雙帳號接手未新增實測；前輪真 GPT／Claude 各派 Flash 的 2/2 證據沿用，不宣稱這次又跑了兩次。

部署證據目錄：`D:\K-harness\.runtime\flash-deploy-20261003`，包含 `preparation.json`、建置／完整測試 log、`candidate-ui-readback.json`、`pre-activate-processes.json`、`activation.json`、`live-ui-readback.json`、`normal-start-readback.json`、`served-readback.json`。審查、補修及假資料 UI 證據保留於維護來源同名 .runtime 目錄。

## Claude 最終 UI 補看與結案

- 最後帳號 busy 清單刷新修正也交由同一 Claude Opus 5.5 session 只讀補看，exit 0、7 native turns，2026-10-03 18:14:55 完成。Claude 未見直接 regression 或阻擋部署問題。它沒有找到 packet 內的 probe（工程副本只收了本次來源程式），因此只確認前端實作；probe 與 638 項測試由 Astra 實際執行，不冒稱 Claude 已審過測試。
- 保留的低嚴重度限制：只讀清單刷新若網路失敗，會顯示不可用、停止刷新，需手動按原有刷新。沿用既有失敗處理，不為本次部署另加自動重試。
- 最後真 UI 證據已確認 busy=false、保存按鈕可用，但沒有按下。前一個讀回腳本仍使用舊的「更新 Gemini 額度」按鈕名稱而逾時；改為程式現行的「更新目前 Gemini 帳號額度」後候選及正式均通過，原失敗保留 `candidate-ui-old-quota-selector-failed.*`。
- 南區原入口於 **18:17:32** 啟動，**18:17:33** ready／視窗與 native health 讀回，18:17:34 三個服務資產 hash 及未授權 API 拒絕通過。沒有更新東區或推上 GitHub。
- 本輪實際修復合計：Claude 指出 3 項帳號行為問題，加上真 UI 發現 1 項忙碌狀態滯留；真多帳號啟用前的既有首次並行查詢限制仍列明，不宣稱所有多帳號驗收完成。

### Claude 最終 UI 補看原文（未改寫）

**結論：這個最小修正沒有直接 regression，也沒有阻擋部署的問題。** 我只讀了 `current/frontend/account-connections.jsx`。`current/test/gemini-accounts-ui-probe.mjs` 不在 ui-review-packet 裡（Glob 找不到），所以 probe 我沒審，修前失敗、修後通過的結果也沒能從程式確認。

## 確認過的行為（`account-connections.jsx:129-135`）

- **條件正確**：只有帳號清單 busy，而且不是 uncertain、loginPending、本人操作中、讀取中時，才會排程重查。
- **會停**：每次重查都換新的帳號清單物件，所以 busy 時每秒重排一次；busy 變 false 就停。effect 的 cleanup 會在條件改變或 unmount 時清掉計時器。
- **不會蓋掉本人操作**：quiet 重查也會遞增 generation。重查還在路上時，本人按下帳號操作或手動刷新，這次重查的結果會被丟掉，不會覆蓋。
- **不會跟一般讀取重疊**：有 `!geminiAccountsLoading` 的條件，quiet 和非 quiet 讀取不會同時排程；quiet 也不切換 loading，所以帳號卡片不會閃。
- **不碰後端鎖或憑證**：`/api/gemini/accounts` 只呼叫 `list()`，不會碰 vault 或 agy，每秒輪詢的成本很低。
- **掛載範圍有限**：元件只在設定視窗和模型選擇視窗裡掛載。切換模式下是 hidden，但 hooks 仍會執行；只會在 busy 時輕量輪詢，可以接受。

## 一個低嚴重度觀察（不擋部署）

- **現象**：quiet 重查若遇到網路或 HTTP 失敗，會走既有的 catch，把清單設成「不可用」（`enabled:false`、`busy:false`）。輪詢因此停止，畫面顯示「此版本尚未開放…」，按鈕也變 disabled，要手動刷新才恢復。
- **為什麼不是新問題**：非 quiet 讀取原本就是這樣處理失敗的。但 Flash 長時間執行、busy 一直是 true 時，每秒輪詢會讓偶發失敗比較容易遇到。
- **可選修正**：quiet 模式失敗時保留上一份清單，不要換成「不可用」。
