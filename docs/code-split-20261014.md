# 大檔拆分：前端與 desktop-controller（2026-10-14）

本人授權處理「主要檔案太大、寫得太擠，AI 修改要讀很大一塊」的技術債。Claude Opus 5.5 撰寫與自審；只搬移程式，不改行為。

## 變更

- `frontend/main.jsx` 104KB → 70KB，拆出：
  - `frontend/app-common.jsx`（3KB）：`api`、`remoteClient`、各 Context、`toolStatusName`、側欄偏好讀取、`IconButton`、`Modal`。
  - `frontend/chat-messages.jsx`（16KB）：訊息顯示元件（使用者訊息、助手回覆、工作過程、連結、圖片、Markdown、選取引用按鈕等）。
  - `frontend/dialogs.jsx`（17KB）：改名、封存管理、分支、核准對話框。
  - `App`、`ChatView`、`Chat`（`ChatView` 外層）及進入點留在 `main.jsx`；移除 5 個已無用途的匯入。
- `src/desktop-controller.mjs` 131KB → 125KB，拆出兩段不碰共用狀態的純函式：
  - `src/codex-attachments.mjs`：送給 Codex 的附件格式（`codexInput`）與歷史訊息附件還原（`projectUserAttachments`）。
  - `src/native-error-class.mjs`：原生錯誤分類 `recoveryErrorClass`（硬限制／一般限流／其他），新增 `test/native-error-class.test.mjs` 直接測試。

## 沒有拆的部分與理由

`desktop-controller` 其餘部分（約 1,170 行的單一 closure）與 `main.jsx` 的 `App`（45KB）、`ChatView`（19KB）共用大量可變狀態。以 Flash／Gemini 工人一區為例，它直接讀寫約 30 個共用變數（目前回合、目標接續、帳號交接、開關停旗標、送出流程）。硬拆需要把這些狀態改成跨模組的讀寫介面，程式反而更繞，且這一區正是時序問題高發處，拆分本身容易引入新的競態。依「最小完整解、不過度工程」原則暫不拆；之後若要改善，應在修改該區功能時順手以小步驟抽出，並各自有測試。

## 驗證

- 搬移由腳本依頂層定義範圍與匯入表自動計算依賴；發現並修正一次誤刪匯入（`main.jsx` 以 `...conversationPreview(...)` 展開使用，初版比對規則漏判）。
- 以 rolldown `parseAst` 做語法層「未定義名稱」檢查：以原始 `main.jsx`／`desktop-controller.mjs` 的自由名稱（瀏覽器與 Node 全域）為基準，7 個新舊檔案皆無未解析名稱；並以故意刪除匯入的檔案驗證檢查工具能抓到。
- `vite build` 成功；真瀏覽器介面實測 `user-message-copy`、`modal-focus`、`worker-count`、`steer-final` 四項通過，三家核心與多種寬度皆無頁面錯誤。
- 完整測試 1621/1621（含新增錯誤分類測試 3 項）；兩個直接讀 `main.jsx` 原始碼文字的測試檔改為讀拆分後的 4 個檔案。

## 部署

### 南區正式套用與讀回（2026-10-14）

- 本人指定程式版本 `72f04c22d6fc41d4bfcde35d2bc0ffbd69faac0e`；部署前 `main` 為 `368355a7175ac9afbeddc661ffa824ef0699fcc7`，工作樹乾淨，47831 無監聽、未發現正式 K 程序。沒有強制結束任何程式。
- 依 SOP 執行一次 `Update-K.ps1 -Ref 72f04c22d6fc41d4bfcde35d2bc0ffbd69faac0e`；相依安裝、介面／擴充／啟動器建置與完整測試成功，**1621/1621 通過、0 失敗**，正式程式已套用。本批沿用前述 Opus 5.5 撰寫與審核結果，未另修改程式。
- `.local/runtime.json.version` 讀回與指定完整 SHA 相同；`previous` 為 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1791911518346`，保留更新前的 `2f6cdc8`。帳號、對話、核心、語音與瀏覽器資料位置不變；本次部署前已存在的 121 個工作區附件 SHA-256 全部一致；新程式的 `.runtime/tests` 為空。
- 這次仍由舊版 `2f6cdc8` 的更新器執行，故不會執行新版退版保留邏輯。更新後四份中最舊的 `before-1791891326740` 以 Windows `SendToRecycleBin` 呼叫處理；原路徑已消失，但 Shell 與 D 槽回收 metadata 均未找到對應紀錄，**不可宣稱可還原**，未重試刪除、未清空回收筒，已停止其他清理。現在只剩 `before-1791897025592`、`before-1791897884691`、`before-1791911518346` 三份，最新 `previous` 存在。
- 啟動原桌面 `K HARNESS.lnk` 的工具操作遭政策拒絕，沒有改用另一條路徑繞過；本人手動啟動後，2026-10-14 01:26（臺灣）`http://127.0.0.1:47831/health` 回 **200**、`deployment: native`，正式 Electron 與原桌面啟動器程序存在，程式 SHA 再次讀回一致。
- 桌面工具兩次選到 K 視窗卻擷取到其他前景畫面，未據此點擊、未搶前景或宣稱 K 介面通過。本人指定改交 Claude 檢查既有聊天室、附件、側欄、訊息、核准、改名與封存管理；Codex 停止介面操作。**正式介面驗證待 Claude 結果；尚未 push**。不能用先前四項候選介面實測代替本次正式讀回。
- 部署前五個待推提交的新增內容未命中常見金鑰模式，Git 未追蹤 `.runtime`、`.local`、登入或憑證檔；未上傳私人證據。純 CRLF／既有檔尾空白警告未擴大整理。
- 本機證據在 `.runtime/archive/code-split-deploy-20261014/`：`precheck.json`、`post-update.json`、`health.json`、`recycle-readback.json`；`update.log` 的 PowerShell transcript 未收錄子程序標準輸出，1621/1621 以本次更新器工具回傳為據，不能把該空白輸出段當完整測試紀錄。
- **東區未更新**。本批未改設定、資料格式、權限、Defender 排除或三家原生核心；程式退版不還原對話。
