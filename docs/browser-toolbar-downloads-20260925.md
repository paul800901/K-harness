# 瀏覽器工具列與下載（2026-09-25）

## 範圍與使用者可見結果
- 右側瀏覽器新增上一頁、下一頁、重新載入、網址輸入與下載清單。
- 接手後才能導覽；AI 操作時不能由人同時改頁面。上一頁／下一頁依真實 Edge 的歷史狀態啟用，不猜歷史。
- 下載顯示「下載中／已完成／下載失敗」，原生 API 沒提供可靠百分比，不製造假進度。
- 下載由 Page 原生 download 事件保存至每個 MCP 對話的專屬 output/downloads/<UUID>/<檔名>。清單內「儲存副本」走 K 的授權下載端點。
- 不包含擴充功能、密碼管理、cookie 匯入。正式瀏覽器未啟用、正式後端未重啟。

## 實作
- frontend/browser-panel.jsx、browser-panel.css：正常瀏覽器工具列、下載清單。
- src/browser-live-session.mjs：page.goBack/goForward/reload、CDP 導覽歷史、既有及新增頁面監聽下載、安全保存與依 ID 讀回。
- src/browser-mcp-stdio.mjs：僅傳入對話專屬 downloads 位置。
- src/browser-live-proxy.mjs、desktop-server.mjs：下載經目前對話及 session 檢查，下載 ID 不接受任意路徑，回應 attachment 而不執行內容。
- 檔名清理、UUID 子資料夾、逐層連結檢查；完成前不能取回。這些是路徑防護，不是同使用者 shell 的安全隔離。

## 驗證
- npm run build:ui 成功（保留既有 bundle size warning）。
- npm test：325/325 通過，記錄 .runtime/browser-toolbar-tests.log。
- 真實 Edge ＋右側 React 介面，以 CUA 操作隔離本機測試服務 47845／假頁 47846：
  1. 開啟瀏覽器分頁，接手，網址輸入第一頁與第二頁。
  2. 上一頁回第一頁，下一頁回第二頁，網址及分頁標題同步。
  3. 重新載入後假頁載入時間由 1790268696941 變為 1790268719770。
  4. 右側快照點擊本機下載連結；下載清單顯示 test-download.txt「已完成」。
  5. 點擊「儲存副本」；另對 K 授權 HTTP 端點讀回 200、attachment 檔名與原始內容 K local fake download，與實際保存檔一致。
- 隔離假檔：.runtime/browser-live-ui/downloads/06c16d5a-6c2e-48e5-bd45-1b6a1df31fd7/test-download.txt。
- 自動測試另涵蓋 downloading／failed 狀態、未完成拒絕讀回、檔名／ID、模式互斥、取消与恢復。未新增模型推論回合；沒有外站、真實帳號或正式開關變更。

## 限制／交給 Opus 複查
- 本輪確認 React → K proxy → 真實 Edge，但沒有再跑 Claude/Codex 模型下令下載；兩家共用同一 session，仍需區分這一點。
- 下載清單是工作階段內記錄；已保存檔不會因關閉而刪除，但尚未製作跨工作階段歷史下載管理。
- 目前取回檔案使用記憶體緩衝，不宣稱適用超大型下載。
- token／cookie 可被同 Windows 使用者 shell 讀取的既有風險未解決。正式開關仍關閉，不能登入真實帳號。
- Opus 可複查上述檔案與恢復文件，不需再花額度重跑已驗過的三種原生核准案例。
