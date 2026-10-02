# 東區複查補修：測試來源固定與共用 Codex 登入網址（2026-10-03）

使用者確認既有更新沒有過度工程化，要求先修測試受本機聽寫設定影響及重複網址判斷，完成後再談推送。

## 最小修改

- `test/local-dictation.test.mjs`：兩個明確驗證 Python／Whisper 的舊測試加入 `provider: 'whisper'`，不依賴本機 `K_DICTATION_PROVIDER`。正式聽寫程式及機器設定不改。
- `shared/codex-login-url.mjs`：直接移入既有 Codex 官方 OAuth 網址判斷；`frontend/account-connections.jsx` 與 `src/electron-workbench.mjs` 共用此函式。允許／拒絕條件不變，沒有新增重試、備援或狀態。
- `test/electron-workbench-permissions.test.mjs`：既有拒絕案例補上非標準埠與錯誤 OAuth 路徑。
- 第 2 點啟動器目錄層級、第 3 點不合法 dictationProvider 的啟動行為依本次範圍不修改。

## 驗證及版本狀態

- 修改前，只在本輪測試程序指定 `K_DICTATION_PROVIDER=windows`，`local-dictation`、`native-dictation`、`dictation-session` 共 33 項得到 31 通過／2 失敗；兩個失敗均為預期 Python，實際走 Windows PowerShell。紀錄 `.runtime/bootstrap/review-dictation-before-20261003.log`。
- 修改後，`local-dictation`、`electron-workbench-permissions`、`electron-workbench-icon` 三個檔案：Windows 設定 **20/20**、Whisper 設定 **20/20**，均無失敗或跳過。僅改測試程序環境並於結束恢復，不移除或覆寫使用者／系統環境設定。紀錄 `.runtime/bootstrap/review-dictation-windows-20261003.log` 及 `review-dictation-whisper-20261003.log`。
- 候選建置與介面驗證待執行。本輪只準備本機程式與 Git 提交，不替換正在執行的正式 K、不重開、不 push、不搬登入憑證。

南區可透過後續 Git 整合取得共用來源及可重現測試；本機 Windows 聽寫選擇仍由各機器設定決定。
