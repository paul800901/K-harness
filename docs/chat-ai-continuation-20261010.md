# AI 可呼叫同專案新聊天室接續（2026-10-10，候選）

## 使用者要求與界線

使用者明確要求先測試，並澄清重點不是強迫所有失敗／半途訊息出現分支按鈕，而是能命令下一個可工作的 AI 使用工具處理換房與交接。依此補 Codex 主代理可呼叫的 `k_gemini.conversation_continue`。沒有修改既有完成結論的分支按鈕條件。

候選實作與真正訂閱假資料實測，不是正式部署。未停止／更新／重啟正式 K、未 push、未恢復或重送小說工作、未移動原本聊天室。不宣稱修好 OpenAI 上游串流／remote-compaction 故障。

## 最小實作

- 工具接受明確 `nextInstruction`，不依賴訊息按鈕／messageId。只在本人明確要求同專案新房接續時使用；主對話 metadata 與目前原生回合必須相符，子代理不得操作。Claude／Gemini 主代理尚未接此工具。
- 工具只先受理；本輪正常完成後，K 讀回最新 stored turn、原生 goal、子代理及背景終端。舊 failed／interrupted 歷史不假裝成 completed，也不因舊輪失敗就全部丟掉。本輪停止／失敗／新真人插話或佇列則取消。
- **新獨立目的主控配置正常 K MCP 後直接執行原生 `thread/fork`**，保留來源最新回合以前的 stored history。同 workspace／模型／effort／service tier／已選原生權限／worker policy，不切帳號或 API 計費；已選完整存取權只原樣延續，不新提升。
- 原房及其原生主控保留。新房只送一次明確接續指令：核對現有成果、只做剩餘工作，不重播已執行或結果未知的副作用，不把歷史工具當新派工授權。歷史壓縮仍保留；不是清除壓縮或完整搬移活動執行狀態。
- active 原生目標、任何有 tokenBudget 的目標、未確認子代理或背景命令會阻止換房；不能用新房重設預算／用量。不自動暫停／恢復／新建原生目標，不轉移活 worker／terminal 所有權。
- 沿用專案 `atomicWrite` 保存單次受理及新房 ID，結果未知不重建／重送。重開時 pending 取消，creating／created 改未知，沒有恢復任務服務或自動重試。第一個程式接續回合不能遞迴換房；之後新的真人訊息仍可明確另行要求。
- 新房建立或送出部分失敗，原房提示已知新房 ID／未知結果；不把 accepted 當 started。未建立且可關閉的候選主控正常釋放，失敗的 teardown 留供關閉時處理。

檔案：`src/conversation-controller.mjs`、`src/desktop-controller.mjs`、`src/unified-controller.mjs`、`src/luna-gateway.mjs`、`test/chat-continuation.test.mjs`。没有新服務、依賴、人用設定、強制分支入口或模型 fallback。

## 保留的失敗證據與改正

1. 現有正式人用分支假資料：`D:\K-harness\.runtime\chat-fork-test-20261010`。原生 INITIAL_OK、manual compact、可控 interrupt、TRANSFER_READY 成功；來源 host fork 出 `01a1238a-f5e0-79a1-9e3f-0a37a2fa8275` 後，同 host resume 未啟用新 MCP，35 秒就緒等待失败，未送 child turn。原生日志另讀到 composing running thread resume response。**未宣稱此既有人用分支啟動缺口已修好**，本批不強迫 partial UI 分支。
2. 首次 AI 候選：`D:\K-harness\.runtime\chat-ai-continuation-20261010`。真模型工具受理、來源 fork 成功，另 host resume 返回 -32600；子房 `01a12398-3e43-7372-a637-e6152d42a131` 保留、未送 turn。不把該次未完整記錄的 native protocolMessage 當成已確定根因，不重新 fork／重送同工作。
3. 因此改為上方目的主控自行 fork，不依賴已載入新房的 resume。中間真原生實測成功見 `D:\K-harness\.runtime\chat-ai-continuation-fixed-20261010`，原房 `01a1239d-f6c1-7f91-ae9c-103d54af11b2`、新房 `01a1239e-5c41-7c33-af17-ccd6469cddb3`。失敗紀錄原地保留，不覆寫成成功。

## 最新來源的真正原生實測

證據：`D:\K-harness\.runtime\chat-ai-continuation-verified-20261010`，`run.mjs`／`start.json`／`result.json`。Codex **0.161.0**，GPT-6.1 Sol medium、read-only、同一 K ChatGPT 訂閱家目錄；API 入口清除，真 native host／gateway／conversation／unified controller。其他供應商模型目錄與派工關閉；guard 限這輪新增假資料 ID／workspace，原小說 ID 禁止任何 mutation。不是完整跨供應商實測。

- 原房 `01a123ab-e48d-7fc1-b215-34782233bde2`；新房 `01a123ac-4b4d-7ec1-8121-c53c41307f98`。
- 初始假回覆 → 真 manual compact → 真可控 native interruption → 真人新輪要求換房 → 真模型呼叫工具 → 正常 completed → 獨立主控 fork 一次 → 接續一次。
- 原房 4 個 turn ID 是新房 5 個 turns 的前綴；可控 interrupted turn 與 contextCompaction 都保留。同 workspace、新 ID，最後 `completed`，正確回覆「第2階段完成 AI_MOVE_VERIFIED_20261010」。
- child 原生 goal 讀回 null；假 `preserved.txt` 未變；`originalThreadsTouched:false`。測試主控正常關閉，所有檔案及失败证据保留。

**證據限制：**可控 interruption 不是原本 OpenAI 上游 failed 的真故障重現。failed 歷史由合成回歸驗證；尚未驗證原小說長負載、手機／桌面實機換房、真 active/budgeted goal 轉移（本來禁止）、背景活動轉移（禁止）或所有歷史附件在新房重開後的呈現。原生 stored history 包含壓縮，不承諾無限原文或回復已被壓縮掉的內容；檔案仍以現況及實際權限為準。

## 程式回歸與 Opus 複查

- scoped Luna 唯讀既有回歸 180/180，主代理獨立讀回；新候選 15 項涵蓋正常延後建立、來源 failed/interrupted、新真人／steer／queue／stop 取消、goal／worker 拒絕、未知結果不重試、關閉／重開、live snapshot／metadata、native echo 去重、首輪遞迴拒絕與後續真人允許。
- 最新完整 `node --test test/*.test.mjs` **1122/1122，0 failed**，候選 `.runtime/chat-continuation-full-test-final.log`。主代理獨立檢查 diff 及上述真原生結果；非正式驗收。
- 真正 Claude Code **2.1.294 / claude-opus-5-5**，官方 Claude.ai Pro／firstParty 訂閱，API 路徑清除、只讀 Read/Glob/Grep、無 Bash／MCP／寫入。最初 tool-design 封包受 restricted 檔案範圍限制，是設計討論不是程式碼審查；初次 code-review 則實際讀封包來源，24 次讀取，session `bb3d2e04-8d46-4088-90b1-9549b209e2be`。
- 初查指出過 await 的舊 state 快照／受理回合結束競態、native user echo 去重與來源、Flash 待回報，及取消／重開／原生 error／teardown 小缺口。主代理逐項核對並修正，不擴建框架。
- 第二次完整來源審查實際 17 次 Read/Glob/Grep，session `f3615c28-7445-4453-b70b-458e5ab9912a`，code 0/success，實際 model Opus 5.5。無重送／提升權限／重設預算阻擋，但指出建房前錯誤 `notCreated` 遺失；主代理補局部 fork-attempt 判別，未呼叫 fork 取消、已發出未知保持 uncertain，且將真人訊息要求套用全部來源（背景通知不能自行換房）。補 real-adapter catalog/history/config 與 fork-response/MCP 錯誤回歸；測試曾抓出 catalog 在內層 catch 外，移至最外層分類後才通過。另移除已無第二呼叫的 fork 包裝，既有人用分支維持原程式。
- UI build 通過（`.runtime/chat-continuation-build.log`），既有單包大於 500KB 提醒保留，不順手重構；沒有以 build 宣稱手機／桌面換房已驗收。
- 最後小修由同一真正 Opus 5.5 session 再讀最新來源，10 次 Read/Glob/Grep、code 0/success，明確「沒有阻擋，可以收尾」，不要求新增架構。原始證據 `D:\K-harness\.runtime\chat-continuation-discussion-20261010\code-review-closeout`（上一輪在 `code-review-final`）。Opus 只讀程式，沒有代替主代理執行測試；所有測試數及最新 verified 原生讀回由主代理獨立執行／查核。既有保守未知結果、核准模式／長任務／附件／正式 UI 未驗證限制保留。

## 正式狀態

候選已實作、上述本地／真訂閱假資料驗證及真正 Opus 複查完成，可與前批候選整合更新；不是正式已套用。正式 K 仍 **1a45a73440a5f948c5cec625de02340863b7c67d**，未停止／部署／重啟／push。依本人要求停等回家更新，不替原聊天室接續工作。
