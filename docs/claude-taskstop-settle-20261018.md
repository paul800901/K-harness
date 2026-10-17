# Claude 停止背景指令後，K 仍顯示「子代理 工作中」（2026-10-18）

## 問題與本人決定

本人截圖：聊天室上方「子代理 · 工作中 2」，兩筆「模型待確認・執行中」，問「這個算不算BUG?」、「如果是BUG要不要一起修?」。查證後是 K 的 bug，與 [K 自行開啟 Chrome](k-chrome-auto-open-20261018.md) 同批部署。

## 查證

- `luna_list` 為空：派給 Sol／Fable 的 K 工人都已結束。兩筆是 Claude 主代理用原生 `TaskStop` 中途停掉的背景指令（`bxbisrcpl`、`bql01f9rs`），對應程序已不在。
- K 在 Claude 原生 `task_started`（`local_bash`）時把背景指令記為 `claude-native` 工作，等 `task_notification` 的 completed／failed／stopped 才結束。對話紀錄顯示：自然跑完的背景指令都有 `task_notification`，被 `TaskStop` 停掉的沒有；Claude Code 只在 `TaskStop` 的工具回覆裡寫「Successfully stopped task: <id>」，結構化結果為 `{message, task_id, task_type, command}`。K 沒處理這個回覆，所以一直顯示執行中。
- 正式 K 存下的聊天室狀態裡，這兩個 `TaskStop` 工具的 `details` 是 `{task_id}`、輸出以「Successfully stopped task: <id>」開頭，符合下述判斷。
- 影響：畫面誤顯示工作中；此類紀錄被視為「可能還活著」，會擋閒置釋放與換工作區。K 關閉時 `settleNativeChildrenAfterHostClose` 會把未結束的原生工作標成中斷，所以重開後不會殘留。

## 修改

- `src/claude-controller.mjs`：處理工具回覆時，若是成功（非 `is_error`）的 `TaskStop`（含同一工具的別名 `KillShell`／`KillBash`），且回覆文字「Successfully stopped task: <id>」的 id 與輸入的 `task_id`（或 `shell_id`）完全相同，就把同一 `nativeTaskId`、尚未結束的 `claude-native` 工作標為 `stopped`，並清掉先前「原生背景清單已無此工作」的錯誤。停止失敗、「had already ended」都不算停止。只依 Claude Code 自己的明確回覆，不猜測程序狀態。
- `test/claude-controller.test.mjs`：停止成功、停止失敗、「早就結束」、id 前綴相同的另一工作（`bg-de`）、`bg-1` 與 `bg-10` 並存、已結束的工作不被改寫、背景清單先移除再停止會清錯誤。第一版程式上此測試失敗。

## 驗證與複查

- GPT-6.1 Sol 驗收（`ddfd8cc`）：「不同意」，兩項 P2——文字比對用 `includes`，回覆寫 `bg-ab` 會誤結案 `bg-a`；背景清單先移除再收到停止成功時，殘留「尚未收到完成結果」錯誤。其餘（多個工具回覆、原生 Agent、舊工具名、前後到達的 task_notification、晚到事件、host 關閉）通過；隔離槽 `npm test` 1748/1748。認為結構化與文字兩種證據並存不算過度。已修（`a966386`）。
- Fable 5.1 唯讀第二審（`ddfd8cc`）：無 P1／P2。從本機 Claude Code 2.1.285 的實作核對：成功文字固定為「Successfully stopped task: <id> (<command>)」，`KillShell`／`KillBash` 是同一工具別名；輸入 id 不精確命中時走代理名稱解析而非前綴，失敗回錯誤；工作已結束時回「Task <id> had already ended (...)」且 `task_id` 仍等於輸入。採納：P3 結構化證據會把「早就結束」標成 stopped、測試未真正驗到結構化路徑、補測試缺口、id 邊界。主代理據此簡化為只認成功文字（`e67adc1`）：工具回覆的內容就是完整的結構化結果，另一條判斷沒有增加證據，反而會誤標。另記：`local_bash` 的 `task_started` 沒有 `isReplay` 防護（`local_agent` 分支有），目前看不出會被重播，不在本批處理。
- 完整 `npm test` 1748/1748（`e67adc1`，建置介面後）。
- Sol 複驗（`e67adc1`）：「同意」合回 main。兩項 P2 通過（`bg-ab` 不再誤結案 `bg-a`；停止成功後清除 backgroundMissing／error）；同意移除結構化 id 判斷（id 相同無法區分成功停止與早已結束），JSON 字串與文字區塊格式的成功訊息都能正確結案；K host 把 stream-json 訊息原樣交給 controller。隔離槽補充案例 18/18、`npm test` 1748/1748、`build:ui` 成功。未驗：真實 Claude Code TaskStop 流程、`test:ui`、正式 K。
- 已合回 main 並 push（遠端讀回 `ecdfe44`）：程式 `ddfd8cc`、`a966386`、`e67adc1`；紀錄 `bf25a4f`、`dd0c8b0`、`ecdfe44`。
- 部署：與 [K 自行開啟 Chrome](k-chrome-auto-open-20261018.md) 一起，固定程式版本 `e67adc1e2ddf17fedfaa0a25a6d3dd838d9a3c1c`，由本人在 K 外更新。
- 2026-10-18 已於 K 外與瀏覽器批次一起部署；更新器 1748/1748、health 200／native，退版與完整讀回見 [共同部署狀態](k-chrome-auto-open-20261018.md#部署狀態)。本次未代測真實 Claude Code TaskStop 流程。
