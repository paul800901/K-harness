# Opus 複查修正：Claude 正式啟動旗標與串流（2026-09-24）

對應 opus-review-native-20260924.md 第 1 點；第 2 點見 opus-review-rate-status-fix-20260924.md。

## 根因與差異
- src/claude-host.mjs：正式 openClaudeHost 參數新增 --include-partial-messages，非探測腳本另加。
- src/claude-controller.mjs：取 message_start usage、合併公開 text_delta。以 native message ID 對應同一則 UI 訊息，不使用每個事件各異的 UUID 建立重複泡泡。忽略 thinking 區塊；其 assistant envelope 不會提前終止文字串流。最終文字快照覆蓋對應 block，不重複追加。
- content block 依 index 組合；message_stop 結束串流，result 定案與清理。已停止/回放/孤立 delta 不會重新啟動 busy。
- parent_tool_use_id 非空的子事件不塞進主代理文字；此為必要歸屬防護，尚未實測原生 Agent/Task，不能宣稱完整子代理 UI 已完成。
- test/claude-host.test.mjs 假 CLI 若啟動參數缺旗標即失敗；controller regression 覆蓋 usage、thinking envelope、增量/最終去重、子事件隔離、回放/停止/孤立 delta。

## 真實 K 流程隔離驗證
使用 createClaudeController 預設真實 openClaudeHost / gateway；沒有注入 spawnImpl、没有自行追加參數；只送一次無工具六句短文字請求，effort=low，沿用 Claude 訂閱。
- 對話：claude-e4f981cb-a2c6-44a1-808d-8e27b1902b21。
- 25 次可見 streaming 狀態更新，最終只有 1 則 assistant 訊息，結尾 K_STREAM_OK。
- 最新請求輸入 27529 tokens（2 + 14784 cache read + 12743 cache creation），原生 contextWindow=1000000。
- allowed/extraUsageDisabled=true 沒有額度警告。用量詳情固定行可見。
- 原始證據 .runtime/claude-stream-live-20260924/evidence.json；脚本 probe.mjs；隔離工作區位於同目錄 workspace。
- 真實回覆/用量證據透過隔離 UI 47841 讀回：進度顯示 27529/1000000、累計未知；用量詳情顯示額外用量未啟用。這是證據重現頁，不冒稱正式 47831 驗收。

## 界線
沒有重啟正式後端，也沒有重送或修改正式聊天室。正式 47831 須使用者重啟載入後再驗收。原生子代理完整歸屬、TodoWrite/ExitPlanMode 仍未完成。

最終驗證：完整 npm test 300/300 通過，0 失敗；npm run build:ui 成功（既有 bundle-size 警告）。測試紀錄 .runtime/claude-stream-live-20260924/tests.log。
