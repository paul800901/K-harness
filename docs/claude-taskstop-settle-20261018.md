# Claude 停止背景指令後，K 仍顯示「子代理 工作中」（2026-10-18）

## 問題與本人決定

本人截圖：聊天室上方「子代理 · 工作中 2」，兩筆「模型待確認・執行中」，問「這個算不算BUG?」、「如果是BUG要不要一起修?」。查證後是 K 的 bug，與 [K 自行開啟 Chrome](k-chrome-auto-open-20261018.md) 同批部署。

## 查證

- `luna_list` 為空：派給 Sol／Fable 的 K 工人都已結束。兩筆是 Claude 主代理用原生 `TaskStop` 中途停掉的背景指令（`bxbisrcpl`、`bql01f9rs`），對應程序已不在。
- K 在 Claude 原生 `task_started`（`local_bash`）時把背景指令記為 `claude-native` 工作，等 `task_notification` 的 completed／failed／stopped 才結束。對話紀錄顯示：自然跑完的背景指令都有 `task_notification`，被 `TaskStop` 停掉的沒有；Claude Code 只在 `TaskStop` 的工具回覆裡寫「Successfully stopped task: <id>」，結構化結果為 `{message, task_id, task_type, command}`。K 沒處理這個回覆，所以一直顯示執行中。
- 正式 K 存下的聊天室狀態裡，這兩個 `TaskStop` 工具的 `details` 是 `{task_id}`、輸出以「Successfully stopped task: <id>」開頭，符合下述判斷。
- 影響：畫面誤顯示工作中；此類紀錄被視為「可能還活著」，會擋閒置釋放與換工作區。K 關閉時 `settleNativeChildrenAfterHostClose` 會把未結束的原生工作標成中斷，所以重開後不會殘留。

## 修改

- `src/claude-controller.mjs`：處理工具回覆時，若是成功（非 `is_error`）的 `TaskStop`（含舊名 `KillShell`／`KillBash`），且結構化結果的 `task_id` 等於輸入的 `task_id`（或 `shell_id`），或回覆文字含「stopped task: <該 id>」，就把同一 `nativeTaskId` 的 `claude-native` 工作標為 `stopped`、已結束。停止失敗不改狀態。只依 Claude Code 自己的明確回覆，不猜測程序狀態。
- `test/claude-controller.test.mjs`：結構化結果、只有文字、停止失敗三種情況；修正前的程式上此測試失敗。

## 驗證與複查

- 完整 `npm test` 1748/1748（建置介面後）。
- 待 Sol 驗收、Fable 第二審；與 K 自行開啟 Chrome 批次一起部署。
