# 聊天室檔案連結：左鍵改為「在檔案總管中顯示」

## 起因與需求

2026-10-24，本人在 CaseAgent 聊天室點助理回覆裡的 mp4 連結（`/E:/…/0073_…_發布影片.mp4`），左鍵跳出 K 內建預覽：視窗空白、標題顯示百分比編碼（`61023_%E7%99%BC%E5%B8%83…mp4`）。本人點檔案時要的是跳到檔案總管裡的位置，方便拖進 LINE 或自己再點開，在 K 裡預覽沒有用處。

本人要求：
1. 本機檔案連結左鍵改為「在檔案總管中顯示」（開所在資料夾並選好檔案）。
2. 右鍵維持四項：用預設程式開啟／開啟方式…／在檔案總管中顯示／複製完整路徑。
3. 還會顯示檔名的地方，百分比編碼轉回中文。
4. 沿用既有安全檢查（原 `threadId` 核對來源、檔案存在、拒絕外部網址與子 frame），失敗顯示原因、不暗中重試。
不改權限、帳號、聊天紀錄；不部署、不 push，停在重啟前。

## 修改

- `src/electron-file-actions.mjs`：把右鍵選單原有的連結解析、主 frame／同源／生命週期檢查、點擊時依原房重查來源與 `isFile()`、失敗對話框抽成共用的 `messageFileAction`；新增 `revealMessageFile`，**只做** `shell.showItemInFolder`。開啟檔案、開啟方式、複製路徑仍只能從原生右鍵選單觸發。非 K 檔案連結、非主 frame、K 服務未就緒時回 `false`，不碰 OS。
- `src/electron-workbench.mjs`：在 owner 頁的 webContents 上註冊 `k-native-reveal-message-file`（`webContents.ipc.handle`，只限這個頁面），以 `event.senderFrame` 當 frame 檢查。
- `src/electron-owner-preload.cjs`：`kBrowser.revealMessageFile(linkURL)`。
- `frontend/chat-messages.jsx`、`frontend/main.jsx`：左鍵在桌面殼呼叫 `revealFile`；被拒或 IPC 失敗時以既有錯誤列顯示「無法在檔案總管中顯示：…」，不重試、不改走預覽，切房後的遲到失敗不顯示到新房。來源消失、缺檔、目錄等由主程序以原生對話框顯示原因（與右鍵相同），不重複顯示。
- 檔名顯示：`shared/native-content.mjs` 新增 `readableDestination`（解碼一次，格式錯誤保留原文）。連結 hover、訊息檔案預覽的標題與圖片 alt 改顯示中文；預覽標題同時以 `/` 或 `\` 取檔名。成果（artifact）檔名本來就是實際路徑，不解碼，避免真實檔名 `圖%20.png` 被顯示成 `圖 .png`。助理回覆裡的連結文字是原文內容，不改。

### 網頁版（瀏覽器或手機遠端開 K）

網頁沒有桌面殼，無法叫電腦開檔案總管；左鍵**維持原本的 K 內建預覽／下載**，標題已改顯示中文。右鍵是瀏覽器自己的選單，沒有 K 的四項檔案操作。mp4 等非文字檔在網頁版仍是「此格式請下載後以本機應用程式開啟」加下載鈕；伺服器回應前會整檔讀入，大檔可能停在「載入成果…」較久，這是本人這次看到「空白」的可能原因，本批未改（桌面版已不走這條路）。

## 驗證

- 完整 `npm test`：最終版見下方〈最終結果〉。第一次（Astra 修改前）1920/1922，失敗兩項：preload API 清單測試（預期內，新 API 須登記，已更新並加檢查只呼叫專用頻道）與 `main-sessions` 150 對話併行列表一次 149/150（單獨重跑 3 次皆過、Astra 單跑也過；本批未改該路徑，判斷為既有時序抖動，根因未查明）。修正後第二次 1922/1922。
- 新增測試：左鍵只接受主 frame 的 K 檔案連結、原房核對、缺檔／來源消失／目錄／OS 失敗各報一次、非同步期間導頁／關閉／換 frame 時不動作、服務未就緒拒絕；preload 只呼叫專用頻道；前端被拒／IPC 失敗顯示一次且不重試、切房不誤報；百分比編碼只解碼一次、成果名稱不解碼。
- 隱藏真 Electron 44.4.5 原生探針（`test/file-menu-native-probe.mjs`）：左鍵經 preload→主程序，只收到一次 `showItemInFolder(原檔完整路徑)`，沒有開預覽；右鍵四項不變且各自只傳原檔路徑。OS 動作由 spy 接住，沒有在本人桌面開視窗或搶焦點。第 1 次在右鍵步驟逾時（未改的 main 在同環境也逾時一次），之後重跑均通過；失敗紀錄保留。
- 介面測試（Astra 修改前的建置）50/51，唯一失敗 `mobile-remote-ui-probe`，與檔案連結無關（該測試不碰檔案連結）；網頁版檔案連結預覽測試 `native-content-ui-probe` 通過。最終版結果見下方。
- 未操作正式 K，也未真的打開 Windows 檔案總管；正式更新後須由本人實際點一次確認。
- 本機證據：`.runtime/archive/file-link-reveal-20261024/`（測試紀錄、探針結果、最終 SHA）。

### 最終結果（程式版本 `3921e9f543612063dcabc78b1110ab20eac555bb`）

- 重新 `npm run build:ui` 成功；完整 `npm test` **1927/1927**，0 失敗、取消、略過。
- 完整介面測試 **51/51**（`mobile-remote-ui-probe` 這次通過，前一輪失敗屬偶發）；語音測試沿用 `.local/runtime.json` 的 Whisper 路徑、瀏覽器沿用主工作樹 `.runtime/playwright-browsers`，只以環境變數傳入本次測試程序。工作樹第一次沒帶瀏覽器路徑 1/51 無法啟動，紀錄保留。
- 原生探針最終版通過：右鍵四項、左鍵只定位原檔、不開預覽。

## 複查

- 主代理（Opus 5.5）實作並自查。
- 依本人指定，GPT-6 Astra（xhigh）收尾抓 bug：確認新 IPC 只增加「定位已通過來源核對的檔案」，沒有任意路徑或開啟程式能力；`senderFrame` 為 null 安全拒絕、IPC 不會重複註冊。修 3 項（commit `3921e9f`）：左鍵忽略 IPC 拒絕／失敗而沒有可見錯誤；成果檔名被誤解碼；圖片預覽 alt 漏解碼。
- Astra 寫的修改由真正的 Opus 5.5（本主代理）逐行審過後採納：主程序已對來源／檔案錯誤顯示原生對話框，前端只處理被拒與 IPC 失敗，不會重複報錯；沒有多餘狀態或重試。

## 部署狀態

依本人指示**停在重啟前**：未部署、未 push，東區未更新。程式 `3921e9f` 與本文件已快轉合回 `main`，並寫入 `.local/update-ready.json`（`ref` 為程式版本完整 SHA），本人按側欄「更新」才會套用；只關掉再開 K 不會套用新版。套用後由 AI 讀回 `.local/self-update-result.json` 再 push 並讀回遠端。
