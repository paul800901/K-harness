# 紙、墨、黃銅介面正式切換

日期：2026-09-25 22:03（臺灣時間）。狀態：**正式前端已切換，使用者原本的 K 視窗已重新整理並完成 live 讀回。後端沒有重啟。**

## 授權與切換範圍

- 使用者本輪明確要求：「正式 K 切換」。
- 採用已通過兩輪 Opus 複查、包含四項小修的 `.runtime/visual-direction/review-fixes/build`，直接部署同一份已驗收產物；不從含其他未提交工作的工作樹重新打包，也沒有合併工作列徽章 PWA。
- 正式位置：`D:\K-harness\dist-ui`；服務：`http://127.0.0.1:47831/`。健康端點讀回為 `k-harness-desktop`、工作區 `D:\K-harness\`。
- 新增 `assets/index-DEvU2dAB.js`、`assets/index-ByJm4fTn.css`；標誌 `k-logo-C1Rj6jze.jpg` 已存在且內容一致，沒有修改。新資源可讀且與候選逐一核對 SHA-256 後，才更新 `index.html`。
- 後端程序切換前後均為 PID 35072，啟動時間 2026-09-25 21:47:23；本輪未停止、啟動或重載後端。沒有送出模型工作、核准工具、切換聊天室、修改帳號／權限／計費或對話資料。

## 正式驗收

- HTTP 首頁與三個引用資源均成功讀回，內容與已驗收候選相同。首頁 SHA-256：`16ab9ab24cb0e3aa0cfbe63212e741f2b3c61706a6e09215bfb91985114b907c`。
- 先確認原視窗草稿為空、沒有待送附件，再重新整理原本的 K 分頁；沒有開另一個假資料畫面代替正式驗收。
- 實際頁面載入上述新 JS／CSS；既有對話與三項成果顯示正常。保留紙色主題、**17px 對話字級、110% 縮放**。
- 成果面板實測 420 CSS px（110% 縮放後為 462 個畫面像素）；停用送出鈕為淺色、透明度 1。`theme-color` 已是 `#f2ece2`。
- 目前閒置對話的標題列及所選側欄皆不顯示活動狀態。沒有畫面 alert、沒有瀏覽器 error 紀錄、沒有水平溢出。
- 這次沒有改產品原始碼，沿用該候選前一輪 **366/366 測試、19 類互動、9 類導航與 54 張矩陣** 的結果；本輪新增的是正式 HTTP／實際視窗驗收，不宣稱重跑整套測試。

證據位於 `.runtime/visual-direction/formal-switch-20260925/`：

- `deployment.json`：部署時間、候選／正式路徑與 HTTP 資源核對。
- `live-readback.json`：正式頁面資源、字級／縮放／配色／面板尺寸與錯誤讀回。
- `backend-after.json`：同一後端程序仍在執行。
- [正式 K 截圖](D:/K-harness/.runtime/visual-direction/formal-switch-20260925/live-k.png)。

## 可回復方式

- 舊首頁備份：`D:\K-harness\.runtime\visual-direction\formal-switch-20260925\previous-index.html`。
- 舊雜湊資源完整留在正式 `dist-ui/assets`，本輪沒有刪除。若需回復，只需在確認後把上述備份還原成 `dist-ui/index.html`，再重新整理 K 頁面；不需重啟後端。
- 舊首頁 SHA-256：`84f2c49da3480effcd2c7569177a127c7fad4e0521398b4adb7d2494b6bbec65`。這是前端程式回復，不是對話／資料回復；本輪沒有改那些資料。

## 仍未驗證

- 目前所選對話沒有真實待核准事項，沒有為驗收而額外送模型工作或製造核准。下一次真實出現「需要確認」時的側欄／標題列同步仍待實測；假資料版本已通過。
- 能讀回網頁 `theme-color`，但瀏覽器頁面截圖不包含 Windows 最外層標題列，**原生標題列是否採紙色仍未確認**。
- 工作列徽章候選沒有安裝或正式切換；原生瀏覽器功能與後端其他工程狀態亦不因本次前端部署而升級。

相關：[四項修正](visual-review-fixes-20260925.md)、[Opus 兩輪複查](opus-review-visual-direction-20260925.md)。
