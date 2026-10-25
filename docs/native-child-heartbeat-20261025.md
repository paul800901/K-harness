# 長指令心跳被誤認為 Claude 原生子代理（2026-10-25）

## 起因

本人在「比特幣投資試驗」聊天室看到上方「子代理 · 工作中 1」，快覽列出一筆「模型待確認 · 執行中」，但實際沒有任何子代理在跑。

實查（聊天室 `claude-4270a877-…`）：

- 該房 K 工單全部 completed／settled；主代理沒有用過原生 Agent／Task。
- 10:37 主代理的一個 Bash（搜尋近期 log）超過 120 秒，被 Claude Code 自動移到背景（task `bjae6eayg`），10:39 前正常結束（輸出檔 `exited with code 0`）。
- `claude.exe` 對執行中的工具會送 `tool_progress` 心跳：`parent_tool_use_id` 是該工具自己的 tool_use_id（另有 `bash_progress`、`agent_api_retry` 走同一型別）。

## 原因

`src/claude-controller.mjs` `onClaudeMessage` 只要訊息帶 `parent_tool_use_id` 就交給 `recordNativeChild`，找不到 worker 就新建一筆 `provider: 'claude-native'`、`status: 'running'`、沒有型號的工人。Bash 的 tool_result 只結算 Agent／Task 工人，`task_notification` 以 `nativeTaskId` 比對而這筆沒有，所以它永遠停在執行中：

- 快覽顯示「模型待確認 · 執行中」（5 分鐘無活動後改「待確認」），不會自己消失；
- `fork()` 因「請先結束工人」被擋；
- 直到該房 Claude host 關閉，`settleNativeChildrenAfterHostClose` 才標為 interrupted。

## 修正

`recordNativeChild` 新建工人前加一個判斷（`src/claude-controller.mjs`）：

- 上層工具已知：只有 Agent／Task／Skill 建立工人（官方 stream-json 文件說子代理事件的 `parent_tool_use_id` 指向 Agent／Skill 呼叫）；Bash 等其他工具的事件只吞掉、不建工人。
- 上層工具未知：心跳（`tool_progress`）不建；其他事件照舊建立（既有測試依賴）。
- 已存在工人的處理不變。

測試（`test/claude-controller.test.mjs`）：Bash 的心跳與一般子事件都不建；完整模擬事故（`task_started` local_bash → tool_result → `task_notification`）後只剩一筆已結算的 command；未知上層心跳不建；已知 Agent 首筆心跳即建立、completed 結果結算、晚到子事件不復活；Skill 子事件建立。突變驗證：拿掉防護、只擋心跳、回到第一版寫法、拿掉 Skill，四種都會讓此測試失敗。

## 驗證

- 工作樹建置介面後完整 `npm test` 1928/1928（兩版各跑一次）。未建置介面時 branding、desktop、claude-host 3 項失敗，主工作樹同 3 項全過，屬工作樹缺 `dist-ui`，與本修正無關。

## 分工與複查

- Opus 5.5 查因與規格；Gemini 3.8 Flash 實作第一版 `038ebad`；Opus 逐行複查、格式化、確認測試能抓到 bug。
- GPT-6.1 Sol 後端複查第一版，三項意見查證後全部採納，由 Opus 修正為 `943c44d`：
  1. （P2）第一版一律略過心跳：已知 Agent 若第一筆子事件是心跳就不建工人，completed 結果沒有對象可結算，晚到子事件反而新建一筆永不結算的工人。改為已知 Agent 時心跳也建立。
  2. （P3）測試的 Bash 案例同時命中兩個條件，分不出「已知非 Agent 上層」那條是否有效；已拆開並補事故完整生命週期。
  3. （P2 相容）第一版只允許 Agent／Task，會把官方文件所列的 Skill 子代理事件整個丟掉；已加入 Skill，維持修正前行為。
- Sol 複核第二版：三項均妥善處理、未發現新回歸，`claude-controller.test.mjs` 142/142；已知限制都不需阻擋本批，結論「可部署」。程式碼由 Gemini 與 Opus 撰寫、Opus 已逐行審過，無 GPT 撰寫的程式。

## 已知限制（本批不處理）

- 上層工具未知時先收到非心跳事件而建立工人，之後才知道上層不是 Agent 時，不重新分類（修正前就如此，未觀察到實例）。
- Skill 工人不由 tool_result 結算（修正前就如此），只能等 host 關閉標為中斷。
- 子代理內部長 Bash 心跳的 `parent_tool_use_id` 是 Agent 還是內部 Bash：未查明。若是內部 Bash（未知上層），心跳不會建工人；若是 Agent，沿用該 Agent 的工人。
- 已存在的假工人不會因本修正消失；該房 host 關閉（例如 K 更新重開）時會被標為中斷。

## 部署狀態

程式 `943c44d5713e1e2d512d3c9fd1d0a659ba62bffc` 與本文件已快轉合回 `main`，並寫入 `.local/update-ready.json`；等本人按側欄「更新」套用（同時包含已部署的上一批之後所有程式變更，目前只有本修正）。套用後由 AI 讀回 `.local/self-update-result.json` 再 push 並讀回遠端。東區未更新。
