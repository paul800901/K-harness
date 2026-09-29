# 視覺第 0 階段：靜態樣稿與截圖

- 日期：2026-09-25
- 狀態：**樣稿完成、已做本機截圖與互動檢查；Opus 複查待完成。** 後續使用者已取消字級選擇關卡，允許實作；14–22 字級及所有既有偏好保留，不做字級遷移。
- 本紀錄保留第 0 階段當時的交付與驗證；後續第 1–3 階段見[產品視覺實作](visual-direction-implementation-20260925.md)。工作列數字徽章仍是另經使用者同意的隔離候選案，不混入正式改版。

## 產物與範圍

- `D:\K-harness\docs\visual-direction-20260925-mockup.html`：單檔 HTML，CSS／SVG 圖示及切換程式全部內嵌；標誌引用原本 `frontend/assets/k-logo.jpg`，未改圖。
- 空白／對話中兩個畫面；微軟正黑體／思源黑體；16／17／18px；附紙色、白色、深色切換。
- 下方明確標示「第 0 階段 · 靜態樣稿」。報價、對話、額度與成果均為假資料。核准、下載、模型等按鈕只提示是樣稿，不執行真實操作。
- 支援網址片段，例如 `#chat&fs=16&font=noto&theme=warm`；不寫產品外觀偏好。
- 工作樹已有大量未提交內容，本輪未提交、未清理、未回復既有修改；未變更正式 `frontend/`、`src/` 或啟動器。

## 截圖交付

五張指定截圖均為 **1920 × 1000、deviceScaleFactor 1**。專案既有 Playwright＋`.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe`，全新非持久 context；不使用日常瀏覽器設定檔。

| 畫面 | 字型／字級 | 截圖 |
|---|---|---|
| 空白對話 | 微軟正黑體 16px | [檢視](D:/K-harness/.runtime/visual-direction/stage-0/empty-jhenghei-16.png) |
| 對話中 | 微軟正黑體 16px | [檢視](D:/K-harness/.runtime/visual-direction/stage-0/chat-jhenghei-16.png) |
| 空白對話 | 思源黑體 16px | [檢視](D:/K-harness/.runtime/visual-direction/stage-0/empty-noto-16.png) |
| 對話中 | 思源黑體 16px | [檢視](D:/K-harness/.runtime/visual-direction/stage-0/chat-noto-16.png) |
| 對話中 | 微軟正黑體 18px | [檢視](D:/K-harness/.runtime/visual-direction/stage-0/chat-jhenghei-18.png) |

對話內容長於可用高度，不縮小內文、不刪附錄內容硬塞截圖；訊息區正常捲動，確認卡與輸入框固定在下方。另保存三張 `chat-*-bottom.png`，可複查完整表格、程式碼、操作列；附白色／深色的 `chat-jhenghei-16-light.png`、`chat-jhenghei-16-dark.png`。

截圖目錄：`D:\K-harness\.runtime\visual-direction\stage-0\`。本階段未修改產品，不製作假的產品前後差異圖；第 1 階段才做相同畫面的像素差異驗收。

## 驗證

- 一次性腳本：`D:\K-harness\.runtime\visual-direction\stage-0\capture.mjs`；讀回：同目錄 `verification.json`、`capture.log`。
- 實際字形讀回：正黑體為 `Microsoft JhengHei UI`，思源為 `Noto Sans TC`；英文／數字用 `Segoe UI Variable`，程式碼用 `Cascadia Code`。不是只改 CSS 名稱。
- 五張指定截圖無整頁水平／垂直溢出，對話欄寬 720px；空白畫面沒有訊息捲軸或回到底部按鈕。
- 16／17／18px、字型／場景／主題切換、網址重載、假核准按鈕、焦點框與側欄選單焦點顯示通過。
- 減少動態下動畫數為 0。截圖使用此選項，避免圓點呼吸亮度影響比較。
- 瀏覽器程式錯誤 0、HTTP／HTTPS 請求 0、標誌全部載入。
- Astra 直接檢視五張指定截圖，另看對話底部與深色截圖。
- 建置成功：`npm run build:ui -- --outDir ../.runtime/visual-direction/stage-0/build-ui`，**沒有覆寫正式 `dist-ui`**。既有大於 500 kB 的 chunk 提醒仍在，未擴大重構。
- 既有 `npm test` 兩輪各 **362/363**；失敗分別為 `test/claude-controller.test.mjs:119`、`:280` 的非同步保存／工人通知等待。單檔重跑 **35/35**。兩處固定等待分別為 30ms／40ms，結果顯示對排程時間敏感；未修改產品或放寬斷言。原始失敗保存於 `npm-test.log`、`npm-test-recheck.log`，不能宣稱預設全套穩定通過。
- 為分辨排程干擾，以 `node --test --test-concurrency=1 test/*.test.mjs` 將同一套測試循序執行，**363/363 通過**（114.5 秒）；見 `npm-test-serial.log`。這不抹除上方預設並行執行的兩次失敗；規格要求的預設 `npm test` 全綠門檻仍未滿足，留給後續正式改版前處理。

## 正式部署與待確認

- 正式前端未改版、後端未重啟；未安裝套件或字型、未呼叫真實模型、未 push。
- 字型與字級未定案。可先比較正黑體／思源 16px，偏好大字再切 17／18px；不把建議寫成使用者確認。
- Opus 尚未複查，Astra 的本機檢查不等於 Opus 核准。
- 第 1 階段開始前，仍須確認其他前端工作停止，由使用者決定是否提交當前工作樹。本輪未自行提交。
