# 原生額度通知：去除重複、Claude 正體中文呈現（2026-09-30）

## 使用者決定與狀態

- 保留 Claude 自己回傳的額度用完／恢復時間通知，不要 K 再做第二套；Codex 同樣不需要同義的額外通知。
- 後續補充：Claude 的這條通知改為正體中文、臺灣用語。
- **R3-1 候選補修，尚未部署。** 基底 `R3-1-candidate-20260930`（b853750）；補修標記 `R3-1-candidate-20260930-notices`。仍須 Opus 審查、使用者同意才能套用正式版。
- 開發工作樹：`C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`；D 槽驗證副本：`D:\K-harness\.runtime\r3-validation-20260930`。主工作樹只同步本輪規則與文件，沒有合併產品程式。

## 根因與最小修正

1. **Claude 重複來源**：`result.is_error` 已把原生文字放入主要錯誤列；`rate_limit_event` 又經 `claudeRateStatus` 產生「Claude 額度狀態：rejected」。移除後者及其唯一使用的通知建構程式，只保留額度資料更新。不是先產生再隱藏，也沒有新增合併服務或重試。
2. **Claude 文字呈現**：只在前端翻譯本次已觀察到的 `You've hit your session limit` 格式，可包含原生 AM/PM 時間與時區。例如畫面中的 `5:30pm (Asia/Taipei)` 呈現為「本時段額度已用完；17:30（臺灣時間）恢復。」不依本機時間重算、不自行推定五小時後恢復。後端的 `state.error` 保持原文。
3. **Codex 同類路徑**：原生 `error` 被 K 加上「Codex 回合錯誤／是否重試」制式說明，`turn/completed` 又帶同一錯誤到頂列。移除制式包裝；在頂列已顯示完全相同文字時，不再渲染第二份 `nativeError`。原生錯誤只有一處來源時仍顯示；不同警告／錯誤保留。不改原生重試、回合狀態或核准行為。
4. **版面**：移除 Claude 第二列後，其巢狀留白也不再佔空間。沒有新增彈窗、確認、額度狀態機或人類控制項，也沒有全面改 CSS。

## 檔案

- 產品：`src/claude-rate-status.mjs`、`src/claude-controller.mjs`、`src/desktop-controller.mjs`、`frontend/native-notices.mjs`、`frontend/native-ui.jsx`、`frontend/main.jsx`。本補修產品 6 檔新增 20 行、刪除 24 行，淨減 4 行。
- 測試：`test/claude-rate-status.test.mjs`、`test/claude-controller.test.mjs`、`test/desktop-native-events.test.mjs`、`test/native-notices.test.mjs`、`test/native-notices-ui-probe.mjs`。
- 規則與交接：`AGENTS.md`、本檔、`docs/r3-1-20260930.md`、`docs/development-log.md`。

## 驗證與中途結果

證據目錄：`D:\K-harness\.runtime\r3-validation-20260930\.runtime\r3\native-notice`。

| 證據 | 結果 |
|---|---|
| `before.log` | 未修版 5/5 預期失敗：Claude 產生重複通知、Codex 包裝原文、前端未去重、缺少中文呈現及未知原文保留函式 |
| `targeted.log` | 63/63，含真控制器＋假 host：額度資料仍更新、原生文字不改、沒有第二條 K 通知、不重送工作；不同原生警告保留 |
| `full.log` | **649/649，0 fail／0 skip，39.06 秒**。原 644 項加 5 項回歸；既有額度狀態測試改成使用者新要求，不再要求產生 K 通知 |
| `build.log` | 使用既有依賴 `npm run build:ui` 通過；保留原有 bundle >500 KB 提示，不為本次拆包 |
| `ui.log`、`ui/result.json` | 真建置前端＋獨立 headless Chromium＋假 API：Claude 只有一列中文通知，實測高 51px，第二通知容器隱藏，沒有「知道了」按鈕；Codex 相同錯誤只顯示一次，未知文字原樣保留，沒有 POST／模型工作 |
| `ui/claude-quota.png`、`ui/codex-single-error.png` | 候選假資料畫面；Claude 截圖已人工檢視，沒有第二條留白區。不是正式 K 的截圖 |

- 全套測試在 D 槽副本執行；改動檔案與候選讀回一致。`git diff --check` 通過。
- 正式 R2 部署收據的 16 個目標檔重新計算雜湊，**16/16 一致**；本輪沒有重開、停止或覆蓋正式 K，也沒有讀登入資料、送 provider 回合或變更計費。
- 沒有刪除日常檔案、安裝套件或改全域設定。查找時曾命中不存在的預想檔名，隨後以實際檔案清單定位；這些讀取失敗沒有改動執行環境。

## 限制／未完成

- 翻譯涵蓋本次實際看見的 Claude 時段額度通知，以及同格式的上午／下午／沒有恢復時間版本。未識別的通知、不同日期格式或其他原生錯誤仍完整顯示原文；**不宣稱 Claude 所有英文通知已完成翻譯**。
- 沒用真訂閱刻意耗盡額度重現；供應商錯誤依使用者截圖建立假事件，控制器、建置前端與 UI 都有實跑。
- 本批保留原有頂部一般工作狀態及通用錯誤列行為，不新增另一套「額度已用完」狀態或自動恢復／重新送出工作機制。
- 正式 K 仍是 R2；後續部署及正式畫面驗收未做。
