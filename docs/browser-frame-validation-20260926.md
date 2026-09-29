# Browser frame / viewport 驗證（2026-09-26）

## 範圍

本次只讀檢查 `frontend/browser-frame.mjs`、`frontend/browser-panel.jsx`、`frontend/browser-panel.css`、`src/browser-mcp-stdio.mjs`。UI 使用 fit-contain 顯示原生 screenshot，點擊 helper 依實際圖片尺寸和 letterbox 空白轉換回 viewport 座標；MCP 工具提示重用原生 `browser_resize`、`browser_evaluate` 與 `browser_tabs`，沒有新增人工解析度或縮放控制。

## 驗證

新增 `test/browser-owner-gateway.test.mjs` 的 Edge 端對端測試。使用官方 Playwright MCP API 連到隔離的 Microsoft Edge persistent context，`navigator.userAgent` 確認為 Edge (`Edg/`)；頁面只由本機測試 server 提供，不登入真實帳號。

- 原生 MCP `browser_resize` 設成 1440×900；Edge page viewport 與 browser frame JPEG 讀回都為 1440×900。
- 原生 MCP `browser_evaluate` 設 `document.documentElement.style.zoom` 為 0.8、重設為 1，再讀回確認；後續以縮放後真實頁面元素 bounding box 經 `browserFramePoint` 換算 letterbox panel click 座標，human action click 後輸入 `EDGE_FAKE_INPUT`，Edge DOM input 讀回相符。
- takeover 期間原生 resize/evaluate 都由官方 MCP boundary 拒絕。
- 兩個假頁面先以 AI `browser_tabs` 明確選中第二頁；human live preview 改選第一頁並回到 AI 後，原生 AI snapshot 仍在第二頁；再明確選第一頁後才回到第一頁。
- 工具清單描述包含 panel-fit、CSS zoom 及 AI tab explicit select 的提示。

執行：`node --test test/browser-owner-gateway.test.mjs`，5/5 通過（含既有 4 項測試與新增 Edge 測試）。截圖 bytes 僅在測試中讀取尺寸，未另存畫面檔。

## 限制／狀態

只證明本機 Edge + 官方 MCP API + 假資料頁的實際行為；未啟動 K 桌面 UI 進行視覺／真實面板點擊驗收，未登入帳號，未驗證候選或正式部署。
