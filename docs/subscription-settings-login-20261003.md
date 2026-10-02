# 設定內訂閱登入與官方頁面開啟修復（2026-10-03）

使用者在東區正式 K 回報：訂閱登入只能在新對話操作，設定內沒有入口；登入有問題，且明確要求 Claude 一起修好。

## 根因及最小修改

- `frontend/model-picker.jsx` 原本把兩家登入狀態、動作與欄位包在新對話。移到 `frontend/account-connections.jsx`，由設定與新對話共同使用；設定可以開始／停止登入、刷新狀態，Claude 保留完整單行官方授權碼輸入。設定操作不建立對話。
- `src/electron-workbench.mjs` 原本 `setWindowOpenHandler` 一律 deny，因此兩家 `target="_blank"` 的「開啟官方登入頁」都被攔下。現在官方 OAuth 頁交給 `shell.openExternal`；Electron 內仍不建立外部頁或容許任意網址開啟。沿用 Claude 官方 URL 規則，Codex 限 `https://auth.openai.com/oauth/authorize`。
- Codex 原本沒有前端登入進度輪詢，完成後需手動刷新。加入僅於 running 期間的狀態輪詢，完成後更新訂閱及新對話模型目錄；Claude 沿用既有進度、授權碼交付與完成刷新。
- `frontend/main.jsx` 接入設定，`README.md` 更正使用入口；原生登入協定、訂閱憑證位置、計費與工作權限不變。

## 驗證與套用

目前為已實作、待候選建置及驗證。計畫使用現有測試與獨立假資料 UI，確認兩家登入、停止、Codex 自動完成刷新、Claude 授權碼與完成刷新、設定不建立對話，以及原新對話／模型選擇回歸；真正本人登入不以假資料驗證宣稱完成。

完成後追加實際測試、部署版本、備份及本機讀回。此次不 push。
