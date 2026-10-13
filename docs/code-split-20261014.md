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

待與前批一起交 Codex 部署；本批為純搬移，未改設定、資料格式或權限。
