# 工作列完成數字：隔離候選與驗收邊界

- 日期：2026-09-25
- 使用者要求：像 Codex 一樣，在 Windows 下方工作列的 K 圖示顯示完成聊天室數。
- 另行授權：使用者同意「另做隔離版本」，沿用後端與對話的技術路徑、不改模型計費；正式安裝與切換另等確認。
- 狀態：**隔離候選已實作並通過限定本機驗證；未安裝、未部署，Windows 實際工作列數字仍未驗證。**

## 現況與選擇理由

目前 `Start-K-Desktop.ps1`／`local-launcher/KTrayLauncher.cs` 以 Chrome／Edge 的 `--app=` 開啟 K，不是已安裝 PWA；現有 `NotifyIcon` 是系統匣圖示，不是下方工作列按鈕。不能只改 favicon 或系統匣圖示，便宣稱達成使用者要求。

採用可安裝 PWA 的 App Badging API。官方要求從已安裝應用程式執行，Windows 支援此路徑：[Chrome 官方文件](https://developer.chrome.com/docs/capabilities/web-apis/badging-api)。不改成另一套原生殼，不用額外模型 API 或計費。原生 `SetOverlayIcon` 對呼叫程序與視窗所屬關係有限制，不能假定既有 tray launcher 能替 Chrome 視窗掛數字：[Microsoft 官方文件](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-itaskbarlist3-setoverlayicon)。

## 候選位置與差異

`D:\K-harness\.runtime\taskbar-badge-candidate-20260925`

來源為當下工作樹必要程式副本，保留聊天室並行，不是舊 HEAD。未複製正式對話、登入資料或 API 金鑰；未安裝套件；正式 `frontend/`、`src/`、啟動器與 47831 服務不變。

- 候選修改：`src/desktop-controller.mjs`、`src/claude-controller.mjs`、`src/conversation-controller.mjs`、`src/desktop-server.mjs`、`frontend/main.jsx`、`frontend/index.html`。
- 候選新增：`src/completion-badges.mjs`、`frontend/public/manifest.webmanifest`、`frontend/public/service-worker.js`、兩張由原標誌衍生尺寸的 PWA 圖示、限定測試。
- manifest 名稱為「K 隔離驗證（完成數字樣稿）」，避免與正式 K 混淆。
- 詳細命令、差異、證據及限制：[候選實作紀錄](D:/K-harness/.runtime/taskbar-badge-candidate-20260925/implementation-notes.md)。

## 數字語意

1. 計算「成功主回合完成、尚未查看」的**聊天室數**，不是訊息數或工人數。同一室多次完成仍算 1。
2. 畫面可見且視窗有焦點，查看對應聊天室才清除；A 在背景完成、查看 B，不清 A。
3. 失敗、取消、子代理自己的事件、Claude 歷史重播不新增數字。
4. 最新完成 `turnId` 與已看回報一致才清除，避免晚到回報清掉新完成。
5. 成功保存後才發布新數量；寫入失敗不宣稱已保存，允許相同完成重試。與一般 session 快照分開，避免標題等寫回覆蓋完成狀態。
6. 封存／刪除的聊天室移出數量；後端重啟可讀回尚未查看狀態。

## Astra 獨立驗證

- 檢查候選相對於來源的差異，要求補齊晚到回報／保存失敗／一般 session 寫回三個一致性問題。
- 重跑儲存測試 **3/3**、假 host UI probe 通過、候選 UI 建置通過；只有既有類型的 >500 kB chunk 提醒。
- 增加兩個直接走真實候選 controller 的假 host 檢查，找出並修正 Claude 歷史重播誤算；最終 **5/5**。見候選 `.runtime/astra-final-tests.log`。
- 真正候選 HTTP server／conversation controller／儲存器，模型 host 為假：0→1、舊回報仍 1、目前回報→0；manifest／PNG 路由讀回通過。
- 專案內獨立 Chromium profile 的可安裝性與 manifest 檢查皆無錯誤，見候選 `.runtime/astra-server-probe.json`；沒有真的安裝 PWA。
- UI 的 Badging API、focus／visibility 是 stub 驗證，**不能當作 Windows shell 的數字截圖驗收**。本案不宣稱已驗證真正模型到工作列的端到端效果。
- 未重跑候選完整產品回歸；來源工作樹的 363 項循序／預設並行結果見[視覺第 0 階段紀錄](visual-direction-stage-0-20260925.md)，不把來源測試移算為候選完整通過。

## 正式狀態、限制與待辦

- 沒有正式安裝、釘選、換啟動器、重啟正式後端、改計費、push 或接真實帳號。
- 沒有離線 UI 快取、push、永久背景服務或定時輪詢；關閉全部 PWA 視窗後，不保證徽章更新。
- 下一次原生驗收需固定的隔離假資料服務、候選專用瀏覽器 profile，經確認後人工安裝，再實際截圖檢查 0／1／2、查看後扣除與最小化狀態。通過前不得整合／切換正式 K。
- 清理偏差如實記錄：候選早期測試曾永久清除該次新建假 fixture／阻擋目錄，不符合預設回收規則。已移除新增測試的永久清理；目前所有假資料及 profile 保留。另多複製的靜態樣稿副本已移入回收筒並讀回。未刪除正式或使用者既有資料；完整範圍記於候選紀錄。
