# 設定內訂閱登入與官方頁面開啟修復（2026-10-03）

使用者在東區正式 K 回報：訂閱登入只能在新對話操作，設定內沒有入口；登入有問題，且明確要求 Claude 一起修好。

## 根因及最小修改

- `frontend/model-picker.jsx` 原本把兩家登入狀態、動作與欄位包在新對話。移到 `frontend/account-connections.jsx`，由設定與新對話共同使用；設定可以開始／停止登入、刷新狀態，Claude 保留完整單行官方授權碼輸入。設定操作不建立對話。
- `src/electron-workbench.mjs` 原本 `setWindowOpenHandler` 一律 deny，因此兩家 `target="_blank"` 的「開啟官方登入頁」都被攔下。現在官方 OAuth 頁交給 `shell.openExternal`；Electron 內仍不建立外部頁或容許任意網址開啟。沿用 Claude 官方 URL 規則，Codex 限 `https://auth.openai.com/oauth/authorize`。
- Codex 原本沒有前端登入進度輪詢，完成後需手動刷新。加入僅於 running 期間的狀態輪詢，完成後更新訂閱及新對話模型目錄；Claude 沿用既有進度、授權碼交付與完成刷新。
- `frontend/main.jsx` 接入設定，`README.md` 更正使用入口；原生登入協定、訂閱憑證位置、計費與工作權限不變。

## 驗證與套用

- 已準備候選 `prepare-1790957287740`，版本 `9c2d6d7001b0dc0b316831cfe8fc338b239e9907`；完整建置與 **514/514** 測試通過，無失敗或跳過。建置紀錄為 `.runtime/bootstrap/subscription-update-20261003.log`。
- 真正建置 UI 的假 API 操作測試通過：設定兩家登入／停止、Codex 自動完成刷新、Claude 授權碼交付及完成刷新、設定不建立對話、回到新對話保留同一登入狀態。兩張設定截圖已人工視覺檢查；產物在 `.runtime/bootstrap/subscription-settings-ui-20261003`。
- 原有 compact model picker 的八組 UI 回歸通過，14 個假官方模型與兩個被攔截的假開啟請求；未送任何模型工作。
- 真正 Electron 的 `target="_blank"` 行為 probe 通過：兩家官方網址各交付一次給替代 `shell.openExternal` 的紀錄函式，其他網址被拒，原 owner 頁及單一視窗保留。此為原生連結事件驗證，不是 Windows 預設瀏覽器或本人帳號授權驗收。probe 首次把絕對 Electron npm 模組當成內建 API 造成載入錯誤，改用 `require('electron')` 後成功；僅終止本輪該失敗 probe 自有程序。
- 部署前正式 K 的原生畫面擷取兩次逾時，只能取得控制項文字，點擊回報沒有座標幾何，Escape 未造成可觀察的關閉。沒有使用自訂 Win32 操作或讀取控制 cookie 繞過；當時請使用者用 K 原生「離開並停止 K」。最新回報後已實際確認正式埠及啟動器停止，並完成下列正式更新。

## 01:01 正式更新讀回

- 與 [工作列品牌修正](taskbar-branding-20261003.md) 一起完成新候選建置，514/514 測試及兩家真 Electron 新視窗事件驗證通過。
- 已套用 `64cc530d73fd6245f22038942ff5e5ea7fa92808`，上一版程式保留於 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1790960340904`；原入口重開、原生 health、帳號設定元件及相關五個來源檔、三個 HTTP UI 資產均實際讀回一致。驗證結果 `.runtime/bootstrap/active-update-verification-20261003.json`。
- Windows 內建聽寫設定保留。登入修正已正式套用，不再是 ready 候選；真實本人授權、模型回合及正式設定按鈕操作仍未驗收。Computer Use 擷取／座標問題仍在，未繞過控制 cookie 或讀取登入憑證。

本人登入與實際訂閱狀態仍待完成，不以假資料驗證宣稱成功。此次不 push。
