# 第三輪複查接續修正

## 來源與判讀
已讀 Opus 第三輪紀錄與三份 round2 evidence.json。Codex 要求核准、Claude 手動的負向上傳進到原生核准要求後被 K 回覆拒絕；Claude Auto 在分類器拒絕，沒有 K 核准要求。
這是單一負向操作的證據，不概括所有工具，也不把原生攔截當成 K 檔案防護的模型路徑驗收。K guard 仍以之前直接 MCP 測試為證。

## 修正
- `frontend/permission-picker.jsx`：瀏覽器啟用時，權限選單及切換權限確認區都揭露「自動審查或略過权限提示時，瀏覽器操作可能不經你核准」。手動模式亦不承諾每次操作詢問；不新增 K 自動放行規則。
- `scripts/browser-approval-probe.mjs`：保留 Opus 加入的 tool_result 記錄；假檔判斷不再比對 JSON 字串，改用 `input.paths` 的單一完整路徑及精確工具名稱。
- `scripts/browser-probe-permission.mjs`、`test/browser-approval-probe.test.mjs`：純測試用判斷函式與 Windows 反斜線回歸；錯誤路徑、多檔、偽工具名不會誤認。已知與未知操作仍一律拒絕，未擴張授權。

## 驗證
完整測試 314/314 通過，0 失敗（`.runtime/browser-review-followup-tests.log`）；UI 建置成功，既有 bundle 大小警告仍在。未實際開啟權限選單做本輪視覺驗收，不宣稱已在正式介面載入。

## 下一階段
原生權限的本輪問題已釐清，接著需做同一瀏覽器的右側顯示與人工接手。現有 K 是 Chrome/Edge app 網頁，不是多 WebView 容器；不得用另一個 iframe 假裝與 MCP 同一頁。必須驗證同頁顯示、接手時停止 AI 操作及交回，再驗證放大與切換清理。
本輪沒有新增視圖服務、額外套件或正式開關；右側畫面及人工接手仍未完成。無需重跑三個付費原生回合驗證字串修正。正式 `.runtime/browser-mcp.json` 保持不存在，47831 未重啟。
