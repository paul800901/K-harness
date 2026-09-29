# 2026-09-27 移除 Chrome 人工活動自動暫停

## 明確產品決定

使用者回報無痕已連線，但馬上被「人工操作」攔住；使用者當時在玩遊戲。舊 observer 以整台 Windows 的輸入 tick 加前景 processName=chrome 判斷，不區分 K Chrome／日常 Chrome，也無法可靠識別輸入發生時的目標視窗。這是有誤判風險的實作，不將遊戲中的這次事件逕自認定為日常 Chrome 操作。

使用者最新要求不是縮小偵測範圍，而是**完全不要因為人類操作自動暫停 AI，讓 AI 依任務自行判斷**。不需要停止滑鼠鍵盤、不需要把 Chrome 縮小，也不需要說「繼續」解鎖。

## 修改

- `src/k-browser-assistant.mjs`：不再啟動 Windows observer、維護 paused／observerFailed、包裝 resume。
- `src/chrome-extension-context.mjs`：移除人工活動 command gate。
- `src/external-browser-gateway.mjs`：移除 automaticPause／noteHumanActivity／resumeAfterUserMessage。
- `src/owner-browser-registry.mjs`、`src/isolated-desktop.mjs`：移除下一則使用者訊息自動解鎖鏈。
- `frontend/native-browser-panel.jsx`：移除自動偵測／暫停／請交代下一步的說明，不新增控制項。
- `test/chrome-extension-context.test.mjs`、`test/external-browser-gateway.test.mjs`：改驗證連續操作不中斷且沒有自動暫停 hook。
- 舊 observer 原始碼／PowerShell／專用測試移入 `.runtime/k-browser-assistant-20260927/retired-auto-pause-source`，原路径不存在、備份 hash 相符；未永久刪除。
- 明確的使用者停止／取消、原生核准、登入與驗證本人處理、隔離／token／origin／模式校驗、斷線不重送均保留。舊嵌入模式的明確人工控制不是本次自動偵測，未順手重構。

## 驗證與部署

- 定向回歸 48/48 通過（launcher、isolated desktop、browser owner／registry、external gateway、assistant、extension context）。
- UI 建置通過，既有大 chunk 警告仍在，沒有新增依賴。
- 使用者正常停止 K；03:47:14 啟動器 confirmed close，03:47:15 stopped by owner supervisor。這次未強制結束程序。
- 03:49 驗證 47831 關閉與 8 box 空後，備份套用 5 個 runtime 模組及兩份 UI 共 13 檔；hash 逐檔相符。正式 observer 兩檔移入 vault 備份，runtime 不再保留可啟動入口。
- 收據 `.runtime/k-browser-assistant-20260927/no-auto-pause-deployment.json`；可還原備份 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/vault/no-auto-pause-backup-20260927-034907`。
- 真正 Electron 的完整 loader/MCP 補測未完成：首輪 helper 無逐步紀錄，等待超過上限仍沒有 result，僅觀察到 regular child 目錄，无法證實停在哪一步。已只結束該測試 helper 10008，保留證據於 `.runtime/k-browser-full-loader-mcp-20260927-041200`；未終止既有專用 Chrome 20892 或操作其原頁。不得以單元測試替代這項完整實測。
- 03:59:52 已由原啟動器重新開啟正式 K：health=isolated、未授權 root 403、5 個更新模組 source/destination hash 一致且無自動暫停 hook，UI 新資產 hash 讀回。結果 `.runtime/k-browser-assistant-20260927/no-auto-pause-final-readback.json`、`no-auto-pause-installed-files.json`。observer 腳本已不在 runtime，精確 `-File ...chrome-human-activity.ps1` 程序為 0。
- 真實玩遊戲並行及 K 內 Opus 完整操作仍由本人驗收；不因已移除攔截機制就冒稱本輪一般／無痕完整實測通過。

擴充 0.1.1 固定安裝位置未變，不必重裝／重新允許。未刪除對話、登入資料或日常 Chrome。
