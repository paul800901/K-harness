# Gemini 額度恢復後，Codex 原房未接續與舊橫幅（2026-10-30）

## 範圍與結論

本人要求查程式、日誌並修復 Gemini 額度中斷後原房未接續，另指出 Claude 主房可接續、GPT 主房未接續。來源房的業務工單只作既有紀錄查證；本批沒有操作、取消、重派或接手該工單，也沒有讀寫其工作區。

根因是 K 在帳號交接通知前，只用 Codex 訂閱視窗的零額度作執行封鎖，忽略同一原生帳號回報的可用點數。來源房的原生紀錄同時有 `secondary.used_percent=100`、未到期的 reset、`credits.has_credits=true` 及正餘額；人類追問後同一模型仍成功回覆。`codexQuota` 原本丟掉 `hasCredits`，`deliverFlashResults.current()` 的 `quotaZeroUntil` 會攔下自動核對；畫面卻已先寫成「帳號已就緒，待核對」。這是 K 的條件判斷錯誤，不能歸因於 Astra 不願接續。

另一個可重現的缺陷是：Codex 收到後續 waiting 事件時，若已有任何未清除的交接橫幅就不更新。因此帳號又進入忙碌等待時，仍可顯示先前的 ready。Claude 的對應程式會先清除舊橫幅，沒有這個同樣的更新缺口。

## 時序與證據邊界（臺灣時間）

| 時間 | 實際查得 |
| --- | --- |
| 14:28:57.977 | 中斷工單開始。 |
| 14:29:00.200 | 原生主回合 `task_complete`；主代理告知候選檔製作中。 |
| 14:29:00.196 | 同回合 `token_count.rate_limits` 回報週視窗已用 100%，同時有可用點數。 |
| 14:32:14.702 | 工單保存為 `failed`、`settled=true`，原生錯誤為 `Individual quota reached`；`quotaCheckNeeded=true`。空成果清單附有「清單可能不完整」說明，不能推論無任何落地。 |
| 14:34:57.077／14:35:41.275 | 既有憑證診斷記錄共用帳號登入檔的寫入時間／觀察時間，身分已不同於失敗工單。只讀診斷，未讀憑證內容。這不等同 ready callback 的精確時間。 |
| 約 15:25 | 本人看到 ready 橫幅。既有程式沒有保存該 callback 的逐次時間，精確發送時刻未查明；橫幅顯示證明事件已到控制器。 |
| 15:25:58.289 | 下一筆原生 `task_started` 來自本人追問；14:29 後至此沒有自動核對回合。原生 SQLite 日誌同時間範圍亦無中間主房送入紀錄。 |
| 15:26:47.661 | 原房代理查得 `goal=null`；讀回舊工單，四項 v3 指定交付物均不存在。其後查得部分校訂／驗證腳本。這些是原房當時保存的查核結果，本批沒有重新執行業務腳本。 |
| 15:27:17.281 | 保存的帳號查詢結果：新共用帳號有正額度、`busy=true`；排程 `waiting`、`notificationRegistered=true`、`waitId=account-query-1-2`。畫面觀察約 15:26，工具正式結果保存於此時。 |

查證原件：來源房原生 rollout、同房 `luna-bridge` 工單 JSON、`main-sessions` 通知標記、Codex `logs_2.sqlite` 唯讀查詢、`diagnostics/gemini-credential.jsonl`。私有識別碼及讀回證據保留於本機 `.runtime/archive/gemini-quota-resume-20261030/incident-evidence.json`，不進 Git。正式 runtime 的五個相關檔與本批基底一致（`gemini-handoff.mjs` 只有 CRLF/LF 差異）。

完整程式路徑：`gemini-accounts.run` 對確已結束的額度失敗登記等待 → 現有工作自然結束後 `drainHandoff` 查核官方額度／必要時按既有規則換帳號 → `publishHandoff` → `luna-bridge.receiveHandoff/flushHandoff` 等原工單結果持久化 → `recordGeminiHandoff` 更新橫幅並排程通知 → `deliverFlashResults` 查原生房、工人及背景命令 → `startNativeTurn` 只送核對通知。此案卡在最後的主代理可用性判斷；沒有證據支持「ready 根本漏送」。

`goal=null` 不是此案的根因：已正常完成的主回合原本就能收 worker／帳號通知。修正後的測試以無 goal 重現並驗證同房核對，沒有建立或恢復目標。原生失敗回合、暫停、明確停止及預算限制仍沿既有獨立規則處理。

## 修改

- `src/usage.mjs`：保留原生 `hasCredits`；新增執行判斷，原生明確回報可用點數或 unlimited 時不以訂閱 0% 阻擋。數字餘額本身、可兌換 reset credit 都不當執行授權；不購買、兌換、切帳或改計費。`quotaZeroUntil` 仍用於避免重複查詢訂閱零額度。
- `src/desktop-controller.mjs`：帳號交接及既有核對／交接入口使用上述判斷；原生額度推播可更新被舊零額度凍住的快取並喚起尚有效通知，較早發出的額度讀取不能蓋掉較新的推播。waiting 取代舊 ready 橫幅；不同工單未送達的通知仍保留。原生接受通知、確實取得 turn ID 後才顯示「主代理已接續，正核對…」，該回合結束即清除。
- `src/gemini-accounts.mjs`、`src/luna-bridge.mjs`：等待事件帶回忙碌及上次正式查核可用狀態；額度失敗本身不拿失敗前快取宣稱恢復。
- `src/gemini-handoff.mjs`、`src/claude-controller.mjs`、`src/gemini-controller.mjs`：共用簡短文字，區分「上次查核有額度但忙碌」「等待主代理核對」「主代理本身額度不足」。沒有新增人用開關或模型等待迴圈。
- 沿用 `epoch`、停止／暫停撤銷、原工單 settled 與持久化檢查、送出前再查核、送出不明不重送，以及新 `requestId`／`handoffFrom` 的接手規則；沒有自動重派原工作。

## 驗證與複查

- 修改前新增兩項回歸：無 goal＋訂閱零額度＋原生可用點數，以及 ready 後 busy waiting 橫幅更新，均失敗；修改後通過。
- 新增原生點數推播後恰好一次通知、不同 waiting 收據保留、停止／暫停／新意圖後舊事件不可復活、不可由任意餘額或 reset credit 推定可執行、失敗快取與忙碌觀察區分。
- 完整 `npm test`：第一輪 **2,046／2,046**，補上舊查詢不得覆蓋新推播的競態後 **2,047／2,047**；Opus 意見修正後最終 **2,049／2,049**（`full-test-reviewed.log`）。首輪局部測試有一項因新工作樹未建置 `dist-ui` 失敗；完成 `npm run build:ui` 後完整測試通過。開發中曾修正一項測試把合併事件中的 waiting 資料誤當 ready 範圍的斷言，現改查實際收據狀態。
- `npm run build:ui` 通過；完整 `npm run test:ui` **55／55**（`full-ui.log`）。新增 1920／390 px 橫幅轉換實測，確認舊橫幅消失、畫面只有該狀態，查看畫面不會發送工作。首輪手機截圖被預設開啟的側欄遮住，主代理實際看圖後修正測試收合側欄及狀態假資料，單獨補跑通過並再看圖（`ui-final/engineering-notices-20261001/ui/`）。這是本機假核心瀏覽器測試，不冒稱真來源房恢復實測。
- Sonnet 5.5 medium 唯讀提供可能原因：未載入主房與舊 `executionUnowned` 工人。主代理核對後不採為本案根因：沒有原房被卸載的實查證據，來源房十六張工單都保存 settled；Claude 通知路徑其實也要求工人 settled。其「忽略 unowned」「從歷史重建派工資格」建議會放寬未知結果及歷史授權邊界，不採納。橫幅缺口意見與實測一致。
- 最後程式複查：本人已澄清 Sonnet 5.5 medium 是處理雜事，最後複查仍依現行規則交真正 Opus 5.5，並無衝突；先前由主代理誤解而多問一次。
- 真正 Opus 5.5 high 第一輪：唯一必修是 blocked 通知送給主代理後不應顯示「已接續」或清除受阻警告。主代理先補兩項測試，在舊碼均失敗；修正為只有 ready 才顯示已接續，孤立 blocked 警告保留。另採納可選意見：官方額度恢復推播即時更新仍待送的 ready 橫幅，其他等待／受阻／核對中通知不改。兩項與八項相關回歸共 **10／10**，完整測試如上；介面探針補驗通過（`ui-reviewed/`）。
- 可選意見取捨：多張收據保留完整接手範圍，橫幅維持最新事件／剩餘事件呈現；「上次查核有可用額度」明確是有日期的既有觀察，不宣稱此刻額度保證，不為顯示新增查詢／派工。
- 真正 Opus 5.5 high 第二輪只複核剩餘修正，在 `230dc3f` 獨立跑新增兩項 **2／2**，結論「可以合併」，沒有未解必修。主代理再次讀差異、核對實測後接受。

## 發布狀態

工作分支 `fix/gemini-quota-resume-20261030`，基底 `8f9aec4`，初版程式 `6af1378`，Opus 意見修正後固定程式 **`230dc3f6035d5a5ffd1152024f4e2c5d07da0ed3`**。已完成驗收，接續合回 main 並準備此版本更新標記。

正式版仍為 `0d157293cb23b49ce69b095413288dff445e2542`，尚未部署、東區未更新。本房在正式 K 內執行，不能自行停止／替換該 runtime；由本人使用現有「更新」按鈕，閒置檢查通過才套用。來源房接續仍由原代理負責，本批沒有以歷史通知重啟它。公開差異只含程式、測試與本工程說明；原始對話、帳號資料、點數值及本機收據不進 Git。
