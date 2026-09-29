# 給 Opus：輸入介面、聽寫與五項複查修正

日期：2026-09-24。本輪沒有 push、改全域設定或讀取真金鑰。

## 狀態

- 原始碼修正完成；全套測試 266/266 通過，UI 建置成功。
- 隔離瀏覽器已實際操作：A 執行時空白輸入框只有停止；輸入 B 後同位置變送出箭頭；送出後才出現 B 待送列；再送 C 後可指定 C 立即送入，B 留在佇列。沒有額外 steer 輸入框、沒有「排隊送出」橢圓按鈕。
- Claude 真實訂閱隔離驗收：工作執行中停止，接著在同一 thread 送新指令，回覆 K_RESUME_OK。兩則使用者訊息，沒有重送舊指令。證據 `.runtime/ui-final-20260924/native-resume/evidence.json`。
- Windows helper 實際 Probe 編譯、INPUT=40 bytes、UTF-8 中文 JSON 與 BOM 檢查成功；沒有在使用者桌面送出測試快捷鍵，沒有實測麥克風辨識或東區 Win10。
- 正式 47831 後端仍需重新啟動載入本輪後端修改；UI 靜態檔已建置，但不能以新 UI 宣稱新後端已載入。先前自動重啟受工具政策阻擋，本輪不繞過，已請使用者用 K 系統匣正常重新啟動。

## 精確修正位置

1. `frontend/main.jsx` 的 Chat：刪除 steerText/steer-card 與 queue-submit；單一 composer 動態顯示送出或停止。只有 queuedMessages 非空顯示待送列，各列可立即送入或取消。`frontend/style.css` 移除上述多餘控制樣式。
2. `frontend/main.jsx` 的 TurnProcess：是否為目前回合依最後一則訊息所屬群組判斷，不再依最後一則助理訊息，避免舊中斷回合在新工作開始後繼續計時。
3. BranchDialog 改用共用 PermissionPicker，传遞 permissionConfirmed，切供應商清除確認。`src/unified-controller.mjs` fork 不再寫死 true；`src/desktop-controller.mjs` 與 `src/claude-controller.mjs` 的 fork 對升高權限檢查確認。同供應商原權限可沿用，不要求重複確認。瀏覽器已確認選「略過權限提示」出現確認畫面後取消，未建立或提高正式對話權限。
4. `src/claude-controller.mjs` onClaudeMessage：非回放的助理／工具結果活動，在非停止或故障狀態下恢復 busy/working；停止後晚到結果不得覆蓋 interrupted。補 acknowledgment → result → fresh activity，以及 replay/stop/late event 回歸。
5. `src/input-queue.mjs` ready 支援 failed/interrupted；state 提供 queueWaitingReason，等待 Luna 時 UI 明確顯示。uncertain 仍不得自動重送。
6. `frontend/permission-picker.jsx` dontAsk 名稱改「僅限已允許（其餘自動拒絕）」，原生模式值不變。
7. 聽寫：Chat 麥克風按下先聚焦 composer，再 POST `/api/dictation`。`src/desktop-server.mjs` 沿用原有 local session、same-origin 與 CSRF gate；`src/windows-dictation.mjs` 啟動一次隱藏 helper，5 秒逾時。`scripts/Invoke-KWindowsDictation.ps1` 確認 Chrome/Edge 前景應用程式標題為 K 執行中樞後送 Win+H；失敗會顯示原因和手動 Win+H 提示。不安裝、不常駐、不保存音訊、不自動送出文字。前景辨識是程序／視窗類別／標題，不是 URL 級身分證明。

## 測試與限制

- `test/desktop-permission-modes.test.mjs`、`test/unified-controller.test.mjs`、`test/claude-controller.test.mjs`：分支確認與原權限沿用。
- `test/input-queue.test.mjs`：失敗／中斷後接續與 Luna 等待理由。
- `test/desktop.test.mjs`：聽寫 API 合成拒絕、CSRF 與跨來源阻擋。
- `test/windows-dictation.test.mjs`：真實 PowerShell Probe，不發快捷鍵。主代理另抓到並修正唯讀 `$PID` 變數衝突與 SendInput INPUT union 結構尺寸問題。
- 全套輸出 `.runtime/ui-final-20260924/tests.txt`。建置保留既有大 bundle 警告，沒有擴張成打包重構。
- 未宣稱像素級全面複製 Codex；本次驗收的是使用者指出的單輸入框、單主按鈕、待送與插隊流程。
- 正式「重新啟動後正常關閉再重開」、實機聽寫與 Win10 準確度仍待實測。模型／權限／佇列變更不可因前端重新整理即當成正式已生效。

## 被拒絕原因更正

原生紀錄將建立 probe.env.local 的拒絕標示為 permission-rule，不能直接歸因為 Auto 自動判斷。`docs/ui-parity-security-20260924.md` 已更正「Bash 不受 deny 規則保護」的過度概括；沒有解除保護或用真金鑰測試。
