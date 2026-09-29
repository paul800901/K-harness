# Opus 複查：原生通知／可見性／搜尋審查（2026-09-24）

審查範圍：`development-log.md` 本輪 6 份紀錄。重點抽查 `native-events`、`claude-visibility`、`native-actions`，對照程式與 `.runtime/ui-parity-20260924/` 的原生探測證據。

## 需修正

### 1. Claude 上下文用量在正式環境不會出現（中）
- `claude-controller.mjs` 的 `tokenUsage.last` 從 `stream_event.message_start` 取值（第 84、95、207 行）。
- 但正式 host（`claude-host.mjs:258` 起的啟動參數）**沒有** `--include-partial-messages`，所以正式環境收不到任何 `stream_event`。
- 原生探測能看到 402 個 `stream_event`，是因為探測腳本 `.runtime/ui-parity-20260924/claude-probe.mjs` 自己加了 `--include-partial-messages`，和正式啟動參數不同。
- 後果：正式 K 的 Claude 上下文用量會一直顯示未知。離線測試會通過，是因為它直接餵入 `stream_event`，沒有涵蓋啟動參數。
- 修法：
  1. 正式 host 加上 `--include-partial-messages`；
  2. 同時處理 `content_block_delta` 的文字增量，讓 Claude 回覆逐字串流顯示（Claude 缺口清單第 1 項，和這點是同一個參數）；
  3. 確認 `stream_event` 不會觸發 `nativeTurnActivity` 的誤判，也不會讓訊息重複出現：串流增量和最後完整的 assistant 訊息必須合併成同一則；
  4. 補一個測試：斷言 host 的啟動參數含有這個旗標；
  5. 用真實 K 對話讀回上下文用量和逐字串流。

### 2. Claude 額度狀態被當成警告，並且重複跳出（低，但使用者已經注意到）
- 正式畫面每次請求都會新增一條「Claude 目前請求仍獲允許；額外用量因組織層級設定遭拒」，橫幅會一直疊加。
- 實際意義：`status=allowed` 加上 `overageStatus=rejected / org_level_disabled`，代表帳號沒有開啟按量加價（extra usage）。額度用完就停止，不會加收費用。這是正常而且符合使用者期望的狀態，不是警告。
- 修法：
  - 不要用通知橫幅顯示，改在用量詳細面板固定一行：「額外用量：未啟用（額度用完即停止，不會加價計費）」；
  - 只有 `status` 變成非 `allowed`（接近上限、已被限流）時才跳通知；
  - 同一種狀態要去重，只顯示一次。

## 第二輪複查（串流與額度通知修正後）

已確認：
- 正式 host 參數已含 `--include-partial-messages`，並有啟動參數測試（`test/claude-host.test.mjs:25`）。
- 串流增量依原生 message id 合併，完成後不會重複（`streamText`）。
- 停止或關閉後晚到的 `stream_event` 會被忽略。
- `npm test` 300/300（Opus 重跑確認）。

### 3. 每個請求都會多出一條「Claude 正在處理。」通知橫幅（低，和第 2 點同類）
- `claude-controller.mjs:223`：每收到一次 `system/status=requesting`，就用原生 uuid 新增一則 info 通知。
- 一個回合裡每次工具迴圈都是一次新的請求，所以會觸發很多次，而且 uuid 各不相同，去重擋不住。
- `frontend/native-ui.jsx:12` 會把所有等級的通知都顯示成橫幅。
- 正式後端重啟後，這會重演第 2 點的重複橫幅問題。
- 修法：「正在處理」屬於狀態，不是通知。改在狀態列或摺疊列顯示，或者乾脆不要記錄。通知橫幅只給 warning、error 這類需要使用者注意的事項。

### 備註：子代理事件目前直接丟棄
- `claude-controller.mjs:209`：帶有 `parent_tool_use_id` 的事件直接 return，所以子代理內部的內容不會被當成主對話的結論。這個方向正確。
- 但現在子代理的活動在畫面上完全看不到。之後做完整歸屬時，應該把它放進摺疊的處理過程。已列為未完成。

## 仍未處理（前一份 Claude 缺口清單）
- 原生子代理訊息的歸屬（`parent_tool_use_id`）：探測中沒有出現任何非空的 `parent_tool_use_id`，代表這次沒測到原生子代理，問題仍然未知。需要讓 Claude 實際使用一次原生 Agent/Task 來實測：子代理內部的發言，是否會被當成主對話訊息顯示或計入結論。
- TodoWrite 對應進度面板、計畫模式（ExitPlanMode）的計畫內容呈現：本輪沒有提到。

## 確認合理
- Claude thinking：探測中 7 個 thinking 區塊的文字都是空的，本來就沒有內容可以顯示，所以標成 `reasoningSummary=false` 符合實際。
- Codex 通知：只接收目前對話與全域通知；`error` 不改變回合狀態，重試交給原生處理；舊 host 晚到的通知會被忽略。都正確。
- Codex 推理：只接收原生摘要，不接收原始推理文字，並有保留上限和截斷標記。
- `fuzzyFileSearch`：搜尋範圍固定在目前工作區，不採用呼叫端傳入的 roots，也會排除越界的候選。
- `review/start`：需要確認才會啟動，只做 inline 審查。它會消耗 GPT 額度，要求確認是對的。
- 沙箱就緒檢查只讀、不啟動設定。「就緒」不等於「隔離已驗證」，文件也寫明了。

## 更正 Opus 先前說法
先前把 `thread/revert` 描述成「把改動退回」是錯的。它只回溯對話歷史，不還原檔案。專案規則已正確區分這兩件事。

## 正式狀態
正式後端尚未重啟，所以本輪的所有功能都還沒上線。`review/start` 也還沒有真實執行過。
