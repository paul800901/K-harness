# 瀏覽器權限接線修正（2026-09-24）

## 差異

- Codex 與 Claude controller 建立原生對話／設定 MCP 時，均以實際供應商與 access mode 呼叫瀏覽器設定 helper。Codex 唯讀設定明確送入 `k_browser: {enabled:false}`，避免原 thread 沿用舊 MCP 設定。state 只在原生 host/session 開啟成功後讀回 `browserAccess.enabled` 與 `browserAccess.networkAccess`；失敗與初始值均為關閉。
- Codex 送出訊息時若權限模式改變，先以相同原生 thread 重開／resume，重新套用 MCP 設定，再送新回合。既有原生歷史照常讀回，不把歷史訊息重新送出。Claude 已在模式變更時重開原 session；本次把新模式帶入 MCP 設定產生。
- `PermissionPicker` 接受 `browserEnabled`，主 composer 傳入 controller 的實際 state；啟用時揭露：「瀏覽器已啟用：可存取網路與網站；不受命令沙箱網路限制，核准依原生工具政策」。未改 Codex 或 Claude 原生權限語意。

## 檔案

- `src/desktop-controller.mjs`
- `src/claude-controller.mjs`
- `frontend/permission-picker.jsx`
- `frontend/main.jsx`
- `test/desktop.test.mjs`
- `test/claude-controller.test.mjs`
- `docs/development-log.md`

瀏覽器 server 參數採本專案隔離 stdio wrapper；對應設定細節與根目錄／檔案防護由 [Playwright MCP 接線複查修正](opus-review-browser-mcp-20260924.md) 及該輪實作紀錄追蹤。

## 驗證與狀態

- `node --test test/desktop.test.mjs test/claude-controller.test.mjs`：64/64 通過；整套 `npm test`：311/311 通過。涵蓋 Codex 寫入轉唯讀時重建同一原生 thread 的 MCP 設定、唯讀下移除瀏覽器工具、Claude plan 不載入、Claude plan/manual 模式切換，以及 state enabled 讀回。
- `npm run build:ui` 成功；有既有的大型 chunk 警告。正式服務未重啟，正式 `.runtime/browser-mcp.json` 未啟用，未執行瀏覽器瀏覽、上傳或對外操作。
- Codex／Claude 原生工具核准對瀏覽器工具的實際彈出與處置行為，本輪沒有真實登入／模型驗證；不得宣稱核准已實測或已符合預期。揭露文案只說核准依原生工具政策。
