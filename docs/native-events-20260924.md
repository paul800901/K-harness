# Codex 原生通知與沙箱就緒狀態（2026-09-24）

## 本次完成

- `src/desktop-controller.mjs` 依專案隨附 `.runtime/codex-protocol-schema/v2` 實際協定 schema 接收 Codex 通知；未以預期的 UI 形狀反推協定欄位。
- 對外 controller state 新增 `notices`、`reasoning`、`turnDiffs` 與 `sandboxReadiness`。
  - `notices`: `{id, level, message, kind, turnId, createdAt}`。含 `error`、`warning`、`configWarning`、`guardianWarning`、`deprecationNotice`、`model/rerouted`、Windows world-writable warning 與 sandbox setup completed。全域通知先於 thread 篩選處理；帶 thread ID 的通知只接受目前對話。通知最多保留 100 筆。
  - `error` 通知只記錄原生 `error.message` 和 `willRetry`：明示重試由 Codex 原生控制，K 不另外重送；不直接改變 busy / terminal 狀態，仍以 `turn/completed` 為準。錯誤通知限定目前 thread。
  - `reasoning`: `{id, turnId, groupId, text}`，只接收 `item/reasoning/summaryPartAdded` 與 `item/reasoning/summaryTextDelta` 的 native summary；不接收原始 `item/reasoning/textDelta`。最多保留 200 項，每項最多 16,000 字元並加上「摘要已截斷；僅顯示部分內容」標記，避免把截斷內容誤當全文。
  - `turnDiffs`: `{turnId, diff}`，由 `turn/diff/updated` 更新，每個 turn 僅保留最新 diff；`item/fileChange/patchUpdated` 對應變更更新至工具列的 `details` / `patchChanges`，並優先於後續 item snapshot 中較舊的 `changes`。
  - `sandboxReadiness`: 每次成功開啟時以 5 秒 request timeout 只讀呼叫 `windowsSandbox/readiness`，取得 `ready | notConfigured | updateRequired`；非 ready 或查詢失敗會建立通知。本次不啟動 setup，查詢逾時不阻擋開啟。
- `model/rerouted` 通知顯示 schema 提供的 `fromModel`、`toModel`、`reason` 與 `turnId`，不改寫 K 已選模型。
- view 開啟時重設上述臨時視圖資料；notice、summary 與 turn-diff 都有保留上限。host 連線 epoch 使舊連線的遲到通知不再寫入目前狀態；readiness 結果另以 host、thread、view epoch 檢查，避免過期非同步回應污染新對話。

## 協定依據

使用 `.runtime/codex-protocol/ServerNotification.json` 與 `.runtime/codex-protocol-schema/v2/` 的 `ErrorNotification`、`WarningNotification`、`ConfigWarningNotification`、`GuardianWarningNotification`、`DeprecationNoticeNotification`、`ModelReroutedNotification`、`ReasoningSummaryPartAddedNotification`、`ReasoningSummaryTextDeltaNotification`、`TurnDiffUpdatedNotification`、`FileChangePatchUpdatedNotification`、`WindowsWorldWritableWarningNotification`、`WindowsSandboxSetupCompletedNotification`，以及 `ClientRequest.json` 所列 `windowsSandbox/readiness`（無參數；回應 `WindowsSandboxReadinessResponse`）。

## 驗證與界線

- `node --test test/desktop-native-events.test.mjs test/desktop.test.mjs`：31/31 通過（包括既有桌面回歸與同一 controller 的 review/file-search 測試）；`git diff --check` 通過。
- 新增測試覆蓋全域與 thread 通知篩選、error 通知與 native willRetry 說明、錯誤通知不改 busy/status、模型 reroute 不改選擇、只累積 native summary 與單項截斷標記、diff/patch 更新在後續 item snapshot 後仍保留、readiness 5 秒 timeout 參數/僅查詢、開新對話重設，以及舊 host 通知被忽略。
- 另有同任務的官方 Codex 只讀 app-server 證據 `.runtime/native-readonly-proof/evidence.json`：readiness 回報 `ready`，fuzzy file search 在隔離目錄命中假檔，`modelTurnsStarted: 0`。沒有發出真實模型回合，也沒有重啟或部署桌面程式；故 error / reroute / summary / patch 等通知的實際供應與完整 UI 呈現仍未驗證。此改動提供 controller state contract，非 UI / 全面線上 parity 驗收。
