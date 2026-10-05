# 三家原生目標模式與人用入口（2026-10-05）

## 範圍與現況

使用者要求和真正 Opus 5.5 討論，將 Claude／Gemini 原生目標及人用操作補齊。K 仍是薄接殼；不新增自有持續執行迴圈、計時派工、預設預算、失敗重播、暗換模型／帳號或 API 計費。

本批在開發版接通，尚未部署或 push。前一批壓縮次數修正一併保留；正式 K 是否可更新須在收尾讀回，不中斷執行中工作。

## 可見行為與原生差異

表頭新增小型「目標 · 狀態」入口，不新增常駐管理面板。本人可設定／更新目標、查看、停止、清除；操作永遠綁定開啟視窗時的聊天室，切換聊天室即關閉目標視窗。執行中仍可開啟查看及停止，不能同時改寫正在啟動的操作。

| 核心（本機實測版） | 原生接法 | 停止與重開 | 可確認結果 |
| --- | --- | --- | --- |
| Codex 0.160.0 | app-server thread/goal get/set/clear；原生自行續作 | 先 pause 再 interrupt；可原生 resume；空白聊天室先設目標也持久保留 | 原生狀態、目標、用量；get 失敗保留未知 |
| Claude Code 2.1.289 | stream-json 的 /goal；以 command_lifecycle 與 synthetic local_command_run 確認，不採信普通模型文字 | interrupt、原生 clear、關閉 host；重新設定才啟動；active 舊目標重開只讀狀態、不自行重送 | 原生 active 或不再啟用；後者標「已結束，結果待確認」，此串流未提供 met/failed 區別 |
| Antigravity 1.2.16 | -p /goal；init 的 system goal expansion 確認；原生 goal loop | 停止自有程序樹；重開只還原呈現，不重跑；再次啟動須本人操作 | 原生 SUCCESS 且有 GOAL_COMPLETE 標記才標完成；缺證據為 ended／unknown |

Claude 的原生 Stop hook 在單次請求內續作，不等於 Codex 閒置後仍可由核心自行開下一輪。K 因此只對 Codex 的閒置自續作保留程序／延後待送訊息；三家 pending 控制都受保護。背景閒置釋放不刪聊天室。停止失敗會如實標示，仍盡力中止原生回合／關閉 Claude host，不因 goal pause/clear 的錯誤跳過停止。

Claude 完成與無法完成在官方 stream-json 皆可能只讀回 No goal set，不能用「已完成」冒充。已排除另讀私有 transcript 的監看器。Gemini 原生 goal 不再套 K 的一般 600 秒印出逾時或整份 stdout 8 MiB 截斷；保留串流解析及本人停止，一般聊天路徑不改。

完成提示是「這個聊天室有新結束回覆」，不是目標驗收通過。active／starting／unknown 及未完成工人不報整體完成；已結束目標不會永久封鎖日後普通回覆的提示。

## 變更檔案

- frontend/goal-dialog.jsx、main.jsx、style.css：人用入口、狀態、同聊天室操作及字級。
- src/desktop-controller.mjs：Codex 原生操作、空聊天室提交標記、停止、工人結果與原生續作競爭處理；只有原生明確拒絕的通知可留待下一輪，傳輸失敗不重送。
- src/claude-host.mjs、claude-controller.mjs：原生指令確認、狀態解析、保存、停止與查詢；不把本地指令結果當聊天內容或形成查詢迴圈。
- src/gemini-controller.mjs、gemini-worker.mjs：原生 /goal 執行、可信 expansion 確認、完成標記、長程串流及停止。
- src/conversation-controller.mjs、input-queue.mjs、completion-attention.mjs：原生輪間保護、待送與完成提示。
- 對應 test 檔：原生事件、停止失敗、通知、佇列、閒置、工人競爭與原生確認界線。

## Opus 5.5 實際討論與取捨

兩次均使用 K 專用 Claude 2.1.289、官方 firstParty claude.ai 訂閱、真正 claude-opus-5-5；唯讀 review packet，不讀真實聊天、憑證、不派工。

- 設計討論 session 40fa1db0-03db-4d50-936d-b6a8437b92f1：採納原生續作、停止必須停目標而非僅停一輪、未知不當完成、簡潔人用入口。
- 程式首查 session 1aed1ca7-7f76-4893-b623-b7bcacef490d：三個 P1 已修（舊目標擋後續通知、Claude 閒置 active 卡待送、Codex pause 失敗跳過 interrupt）。P2 查詢污染／自我刷新／Claude clear 失敗／工人結果競爭已補修或縮限，附回歸測試。
- 「表頭執行中 disabled」未採納：該 busy 是短暫人用操作鎖，不是 state.busy，真瀏覽器已驗證工作中關閉再開啟目標視窗及停止。
- Codex 空白房間先設 paused 目標、立即關閉重開已實測正常；Claude 多行目標 synthetic args 未被改寫，實測設定及 clear 成功，不加不必要正規化。
- 修後最終 review session 8348aba9-0bae-46ca-aeb0-5e4ef16bdbc5：真正 claude-opus-5-5，exit 0／success，明確表示無阻擋 P1/P2、可固定版本；其最後所列 Gemini 未複驗是當下時間點，隨後已取得上述完整真原生複驗。Opus 為唯讀程式複查，未冒稱由它重跑測試。

## 驗證與證據

本機證據在開發 worktree 的 .runtime/goals-20261005/，不提交原生 transcript 或帳號資料。全部使用新假資料聊天室／目錄，不操作使用者工作。

- 完整單元／回歸 797/797 通過，UI build 通過（all-tests-final.txt、build.txt）。首次整套只有兩個新字級寫成 px 而觸發既有 style guard；已改回共用變數，不刪 guard。
- 真 Codex：設定→原生達標→close/open 保留→clear→長目標立即 stop 為 paused→重開 ready、不重跑。另驗 paused 空白目標在首輪前持久保存。codex-validation.json、native-extra.json。
- 真 Claude：設定→原生執行結束→狀態 ended→close/open 保留→clear→長目標立即 stop/clear→重開無目標；多行目標確認也通過。claude-validation.json、native-extra.json。
- 真 Gemini：首輪原生設定／complete／重開／clear／stop／重開不重跑已通過；修後複驗曾於模型目錄唯讀查詢逾時，尚未啟動工作，保留該失敗，不算 goal 執行失敗或重播。之後原生 models 唯讀診斷 1.8 秒成功；再次用未改動的產品路徑完整複驗通過（gemini-final-readback.txt、gemini-validation.json，session gemini-6a5df8f5-c5ea-4c36-88ce-05b776c04f00）：complete→重開保留→clear→stop interrupted→重開 ready／不重跑。兩次目錄逾時都在送出工作前，未重播任何未知工作。
- 原生失敗探索：早期 Codex 假目標禁止所有工具，阻止模型呼叫 update_goal，故原生持續回覆而觸及測試觀察期限；只停止該假房間，修正測試允許原生完成工具後通過。未加 K 自動 retry。
- 真 Chrome 本機假後端：三家畫面、設定／更新、停止／繼續／清除、工作中重新開目標視窗、900／1100／1920 寬度、來源 threadId 驗證及無 pageerror 通過。ui/result.json 及截圖；這不是正式 UI 已部署證據。

## 官方參考與邊界

- https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- https://code.claude.com/docs/en/goal
- https://antigravity.google/docs/cli/headless/
- https://www.antigravity.google/changelog?tab=cli

以本機原生實測優先，不把其他版本、終端 App 或 API SDK 的能力當成本次訂閱接頭能力。沒有刻意耗盡真實額度、執行數小時破壞性目標、或讓兩個真實供應商同時改使用者檔案。純文字假目標不能替代每種實務任務的結果驗收。

## 固定版本與部署

最終複查及驗證已通過，本地程式固定為 **35de2b5d7a106bbde9a0859bcd75e3380305e2a1**（codex/modal-focus-fix），包含前批壓縮次數程式 276114989338c00564f7dcdf0aeffc0e9ef58c88。之後的本次文件收尾 commit 只記錄版本，不代表另一次程式變更或部署。正式 K 仍是 4ead4bf24ed609a01b4d6acfb4f5bdf48d574248；2026-10-05 收尾讀回 127.0.0.1:47831 仍由 PID 18548 監聽。未取得完整停止，因此不部署、不重啟、不推 GitHub、不建立或移動發布標記。已請本人工作告一段落後離開並停止 K。前批壓縮次數一併保留，待停止後以本批固定 SHA 準備候選、保留程式退版、部署及正式讀回，再按 SOP push；東區不動。

## 留存限制（不擴成本批新機制）

Opus 註記：Gemini 重開後 unknown 目標需本人查明／清除紀錄，未清前完成提示採保守呈現；Claude clear 失敗即使 host 已關，目標仍維持待確認，重開再讀回；Codex 明確拒收後的工人通知只等待下一個原生回合，不另加重試排程，關閉不重播，工人原始紀錄仍可查。以上不宣稱已自動恢復。
