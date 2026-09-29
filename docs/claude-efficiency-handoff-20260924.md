# 給 Claude 的審閱交接：主代理額度、事件通知與附件

日期：2026-09-24。實作者：Astra。Luna 仍固定 gpt-6-luna / high。

## 狀態

程式與 UI 已實作，204/204 回歸測試通過，UI 建置通過；真實訂閱長工作、取消、唯讀附件與隔離 UI 讀回通過。
正式 K 後端尚未重新載入：工具政策拒絕重啟操作，沒有繞過。已請使用者從系統匣完整結束 K 後，以原捷徑啟動。單純刷新網頁只會載入新 UI，不能替換舊後端。
沒有 push、沒有改全域設定、沒有換 Luna 模型/effort、沒有停用 Claude 原生連接器。

## 為何 P1 沒採用拉長 wait

使用者最後決定：不要讓 Opus 反覆輪詢，改由 Luna 完成時通知。

因此正式路徑是：
1. Opus 用 luna_start 交出明確工作。
2. 有其他工作就繼續，沒有就結束目前模型回合。
3. K 接到官方 Codex turn/completed 事件，排入原 Claude 對話。
4. 原回合結束後，K 經同一個持續存在的 Claude Code stream-json 程序送入工人完成資料，Opus 接手驗收。

通知由 K 負責，不依賴 Luna 自己呼叫喚醒工具。等待期間不用 Opus 推理回合；完成後的驗收回合仍會消耗 Claude 額度。
沒有增加 MCP_TOOL_TIMEOUT，也沒有把 wait 改成 10 分鐘：正常路徑不再阻塞等待 MCP。luna_wait / luna_inspect 仍保留作手動查明，工具說明要求不要拿來輪詢。

安全/一致性：
- 通知限定原 parentId，等主代理當前回合結束再交付。
- requestId 派工原有去重保持不變；通知送出前記錄 delivery-attempted，送出不明時不自動重送。
- 停止會清除排隊通知、取消 Luna，晚到的結果不再喚醒 Opus。
- 工人結果明確標成資料，不是使用者新授權，也不表示通過驗收。
- 此功能限 K 程序與原對話仍開啟時；沒有新增排程器或離線自動喚醒。切換/關閉仍遵循既有停止與查明流程。

## 精簡工人結果

未結束的工具回應只提供狀態與 outputLength，不送累積 output。
結束後 <=4000 字元直接回傳；更長則完整存於「該工作區」的 `.runtime/luna-bridge/<parentId>/<requestId>.output.md`，回傳前1000字預覽、絕對路徑與總長度。
這是原文預覽，不是再呼叫模型產生摘要。移除原 thread/read 的 20000 字截斷。
目錄逐層檢查 junction/symlink，ID 受限，沿用 checkedPath；檔案不覆寫不同內容。K 根目錄和實際工作區不同時，模型可讀結果仍放在實際工作區，沒有放寬權限。

## P2

採用 8 KiB UTF-8 byte 門檻（不是中文字數）。小附件內嵌；大附件送 name/path/bytes、1000字預覽及明確「這不是全文」提示。原檔完整保存，Claude 可按需要 Read；圖片不變。
這能避免無條件將每份大檔塞進上下文，但若任務本來需要全文，Read 全文仍會消耗上下文；不宣稱一定省下固定比例，也不以預覽冒充全文。

## P3：真正的官方訂閱額度

實際 stream-json 捕捉到 rate_limit_event（本次三個事件）。其 unifiedWindows.utilization 是比例，不能誤當百分比。
完整顯示改讀官方 Claude Code `get_usage` control（skip_behaviors:true），對應官方 SDK 的實驗性 usage 介面。這個回應的 rate_limits.*.utilization 是 0–100 的已用百分比、resets_at 是 ISO 時間。
不啟動模型回合，不讀取/轉交 OAuth 秘密，不掃描全部歷史來估算。

- Claude 與 Codex 額度並列；Claude 顯示5小時、每週、官方若提供則顯示模型週額度與重置時間。
- 前端定期讀取，後端約60秒節流；手動更新可立即查。
- 沒開 Claude 對話時只啟動臨時官方唯讀主控查詢，查完關閉，不送 user prompt。
- 錯誤保留已取得資料並標「舊」；缺值不當零，也不捏造剩餘額度。
- 實驗性控制協定可能隨官方升級改動；失敗時明示，保留 /usage 核對提示。

為了使用者要求的 UI，除了原四個來源檔，多改 src/unified-controller.mjs（兩方額度合併）與 frontend/usage.jsx（顯示）。沒有另建新服務或付費路由。

## 驗證與證據（絕對路徑）

- 全套：D:\K-harness\.runtime\claude-efficiency-20260924\full-tests.txt，204/204。
- 建置：D:\K-harness\.runtime\claude-efficiency-20260924\build.txt，成功；既有大 bundle 提醒仍在，未為此擴張重構。
- 長工作與附件：D:\K-harness\.runtime\claude-efficiency-20260924\live-1790226495661\evidence.json。
  - 整體 87.514 秒，Luna 執行受控70秒命令並核對 fixture。
  - luna_start 1次、luna_wait 0次、luna_inspect 0次、完成通知1次，Opus 自動回覆 K_OPUS_EVENT_OK 與實際結果。
  - 另開 plan 對話，對 >8KiB 附件呼叫原生 Read，正確讀到預覽外的檔尾識別碼。
- 真實停止：D:\K-harness\.runtime\claude-efficiency-20260924\stop-1790226639323\evidence.json。
  - 在 Luna 原生命令已開始後停止，726ms 完成，狀態 interrupted，沒有完成通知喚醒 Opus。
- 官方額度與隔離 UI：D:\K-harness\.runtime\claude-efficiency-20260924\ui-usage.json。
  - UI 實際顯示 Claude 五小時剩94%、週剩99%，五小時重置2026/9/24 16:59:59、每週重置2026/9/29 10:59:59（臺灣時間）。數字是該次讀取快照，不是保證後續不變。
  - 隔離測試頁已目視與可及性樹核對；不是正式47831後端已重載的證據。
- 第一個長測試未通過：live-1790226409018/evidence.json。測試誤用了另外安裝的 npm Codex，其模型清單沒有 Luna/high，bridge 在原生工作建立前拒絕；未啟動 Luna，也未靜默換模。查到正式 K 使用桌面附帶 CLI 後，以正式相同路徑重新做隔離測試才通過。保留失敗證據，不算成成功。

## 本輪來源與測試修改清單

- D:\K-harness\src\luna-gateway.mjs
- D:\K-harness\src\luna-bridge.mjs
- D:\K-harness\src\claude-controller.mjs
- D:\K-harness\src\claude-host.mjs
- D:\K-harness\src\unified-controller.mjs
- D:\K-harness\frontend\usage.jsx
- D:\K-harness\test\claude-controller.test.mjs
- D:\K-harness\test\claude-host.test.mjs
- D:\K-harness\test\luna-bridge.test.mjs

原專案已有大量未提交修改，因此不能把 git diff 全部算成本輪。精確本輪比較：
D:\K-harness\.runtime\claude-efficiency-20260924\review.diff
修改前副本：D:\K-harness\.runtime\claude-efficiency-20260924\before

官方參考：
- https://code.claude.com/docs/en/statusline （官方5小時、每週額度欄位）
- https://platform.claude.com/docs/en/agent-sdk/typescript （Agent SDK 協定）
- 已核對官方 npm 套件 @anthropic-ai/claude-agent-sdk 的 SDKControlGetUsageRequest/Response 定義，並以本機實際 control 回應驗證。

請審阅 scoped review.diff 與上述 evidence；尤其是通知去重、停止競態、workspace 路徑，以及 get_usage 失敗時是否維持誠實的額度狀態。不要再把 Luna effort 改成參數化。
