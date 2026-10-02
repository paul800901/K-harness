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
- 已提交程式修正 `eba08d92a40eaaa18347a387fc8cb5b4c39ea6d2`，使用 `--prepare-only` 準備候選 `prepare-1790962001170`。完整 UI／擴充／啟動器建置及 **514/514** 測試在 `K_DICTATION_PROVIDER=windows` 下通過，無失敗或跳過；紀錄 `.runtime/bootstrap/review-followup-build-20261003.log`。
- 候選真正建置 UI 配合假訂閱 API 操作通過：設定兩家登入／停止、Codex 自動刷新、Claude 授權碼及自動刷新、新對話共用狀態、設定不建立對話。紀錄 `.runtime/bootstrap/review-followup-ui-20261003.log`，截圖保存於 `review-followup-ui-20261003`；沒有真實本人登入或模型回合。
- 正式 `.local/runtime.json` 讀回仍為上一版 `64cc530d73fd6245f22038942ff5e5ea7fa92808`，Windows 聽寫保留。本輪只準備本機程式與 Git 提交，未替換正在執行的正式 K、未重開、未 push、未搬登入憑證。

南區可透過後續 Git 整合取得共用來源及可重現測試；本機 Windows 聽寫選擇仍由各機器設定決定。
