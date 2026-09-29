# Opus 複查修正：Claude 額度狀態（2026-09-24）

## 範圍

修正 `opus-review-native-20260924.md` 第 2 項。未改 Claude 原生限流決策、計費設定或正式服務。

## 差異

- 新增 `src/claude-rate-status.mjs`：只投影原生 rate-limit event 的 status 與已明確觀察到的 org-level extra-usage-disabled 狀態。正常 `allowed + rejected + org_level_disabled` 不產生通知；未知欄位維持未知。
- `src/claude-controller.mjs` 對非 `allowed` 狀態僅在狀態轉換時建立通知；同狀態連續事件不重複通知。返回 `allowed` 後再次進入相同非允許狀態，會再次提示。額度查詢合併而非覆蓋 rate-limit 投影，所以成功或失敗刷新不會清掉它。
- `frontend/usage.jsx` 僅在 CLI 實際回報 `org_level_disabled` 後，於 Claude 用量詳細面板顯示「依目前觀察到的 Claude CLI 狀態，額外用量：未啟用（額度用完即停止，不會加價計費）。」這是該次 CLI 狀態的讀取，不是對其他帳號或計費設定的保證。

## 驗證

- `node --test test/claude-rate-status.test.mjs test/claude-controller.test.mjs`：35/35 通過（含同檔 Claude 串流整合測試）。
- 覆蓋正常 allowed 無通知、非 allowed 去重與狀態變化、未知 status 保持未知，以及額度刷新後狀態仍保留。
- 正式後端未重啟，沒有正式環境讀回；目前為本機程式與測試驗證。

## 檔案

- `src/claude-rate-status.mjs`
- `src/claude-controller.mjs`
- `frontend/usage.jsx`
- `test/claude-rate-status.test.mjs`
- `test/claude-controller.test.mjs`

## 未完成

- 需正式後端重啟後，以真實 Claude CLI 事件確認詳細面板顯示及限流狀態通知。沒有變更任何額外用量或計費設定。
