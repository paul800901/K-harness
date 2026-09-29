# 紙、墨、黃銅：產品視覺實作與隔離驗證

> 最新狀態：使用者後續授權正式切換，2026-09-25 22:03 已部署並在原使用者視窗完成 live 讀回，後端未重啟。詳見 [正式切換紀錄](visual-formal-switch-20260925.md)。下文保留切換前的實作與驗證歷程。

日期：2026-09-25。狀態：**已實作、隔離建置與 UI 驗證完成；未正式部署、未重啟後端、未提交或 push**。Opus 已確認符合規格、無阻擋項；四項後續建議已完成本機修正，詳見 [複查後修正](visual-review-fixes-20260925.md)。

## 授權與範圍

- 原始規格：[visual-direction-20260925.md](visual-direction-20260925.md)。第 0 階段已交付離線樣稿。
- 使用者後續明確表示「都可以改，不用限制」，既有設定已能調多種字級，不以樣稿 16／17／18 的比較選項限制產品，也不再等待選字級才實作。
- 保留全部 14–22 字級、90／100／110／125／150% 縮放、18px 預設與既有儲存值。不做原規格的 18px 一次性遷移、不新增遷移標記。
- 只改前端呈現與必要的面板顯示狀態；不變更模型、計費、權限語意、並行執行、後端或真實對話資料。徽章 PWA 是[另案隔離候選](taskbar-badge-candidate-20260925.md)，本輪不合併、不安裝。
- 工作樹原有大量未提交修改，未擅自提交或重設。原始碼副本與可獨立服務的 build 固定本次基準；前端 CSS 和 JSX 分檔協作，其他工作保留。

## 第 1 階段：等值抽取

- 基準：`D:\K-harness\.runtime\visual-direction\stage-1\source-before`，建置 `stage-1\build-before`。
- 等值抽取後：`stage-1\build-after-css`。此中間步驟只抽取同值字級／相容 token，沒有宣稱已完成所有 CSS 合併。
- 三主題 × 七狀態（空白、Markdown、工作中、核准、成果、設定、側欄選單）於 1920×1000；紙色前三狀態另加 1366×768 與 1024×768。共 27 組 before／after。
- `stage-1\pixel-comparison.json`：27 組都低於 0.1%；最大 **0.000286%**（3 個像素），其餘幾乎完全相同；每張差異圖保留於 `stage-1\diff`。兩輪皆無頁面例外。
- 中間步驟統計：`.app` 欄寬區塊 25→25，固定 px 字級種類 15→0（保留原字級 fallback），色值種類 74→74，未定義 `--panel` 4 處仍存在；這些合併與配色清理在第 2 階段完成，不把中間結果寫成完整整理。

## 第 2–3 階段變更

- `frontend/tokens.css`、`style.css`、`sidebar.css`、`model-picker.css`、`permission-picker.css`、`usage.css`、`workspace.css`、`browser-panel.css`：三主題共用設計變數、系統字型、紙面版面與元件規則；移除 DSH 樣式匯入，保留原 DSH 檔案。
- `frontend/main.jsx`：移除假起始卡、助理標誌頭像、常駐操作說明及成果重複說明；標題改工作區／對話名稱，狀態只依畫面目前對話；成果分頁固定、其他分頁可關、＋只列未開分頁。
- 面板開關按聊天室記憶；沒有內容預設收起，新增成果自動展開，手動收起不會因一般事件重開。忽略連線中的暫態空資料，避免重連造成假新增成果。
- 回到底部按鈕仍使用現有 assistant-ui 的捲動與 disabled 判斷，保留在 Viewport 的 React context 內；外層定位區讓它浮在輸入框上緣而不占版面高度。
- `frontend/project-sidebar.jsx`：每室 `busy`／`pendingQuestions` 來源不變，以圓點取代日期位置；需要確認保留文字，處理中保留 tooltip／ARIA。
- `frontend/usage.jsx`：兩欄額度、清楚的本週／5 小時標籤、低於 20% 文字警示；額度來源與更新流程不變。
- `frontend/permission-picker.jsx`：`claude-auto` 顯示改「自動判斷」，原生模式／說明不變。
- `frontend/appearance.mjs`：只有未儲存主題與無效值 fallback 改紙色；有效主題、字級、縮放不變。`frontend/index.html` 與主題 effect 同步 theme-color。
- `test/appearance.test.mjs`、`test/ui-style-guard.test.mjs`：偏好保留及樣式變數回歸。

## 最終驗證

所有證據根目錄：`D:\K-harness\.runtime\visual-direction\stage-2`。使用專案既有 Chromium、臨時隔離 context、固定時間、假 API／假對話；未連真實模型或使用日常 profile。截圖不代表正式部署。

| 項目 | 結果與證據 |
|---|---|
| 預設全套測試 | 最終重跑 **366/366**，36.9 秒；`npm-test-final-recheck.log` |
| 循序全套測試 | **366/366**，116.7 秒；`npm-test-serial-final.log` |
| 樣式／外觀專項 | 最後樣式修正後 **8/8**；`style-appearance-final.log` |
| 建置 | `final-build`，`build-final.log`；只餘既有 >500 kB JS chunk 提醒，未擴大重構 |
| 54 張 UI 矩陣 | `screenshots-final\result.json`；無頁面例外、整頁水平溢出、空對話捲軸、輸入框工具鈕超界 |
| 實際互動 | `behavior\result.json` **12 類通過**：全部設定選項、字級實際套用、主題 meta、面板／新成果／重連、鍵盤、減少動態、捲動鈕、斷線與對比 |
| 聊天室導航 | `navigation-final\result.json` **9 類通過**：A 工作時切 B，來源綁定、草稿、附件、核准、停止及晚到回覆不串室 |
| 系統字型 | CDP 讀回空白主標與中文段落實際為 **Microsoft JhengHei UI**，非下載字型；見 `behavior\result.json` |

### 已知測試不穩定（不掩蓋）

- 第 0 階段已有原生 Claude 測試固定等待相關不穩定。本輪中途預設全套 363/363；加入 guard 後第一次預設全套 **365/366**，`test/claude-controller.test.mjs:280` 的 40ms 等待下預期 2 次呼叫、實際 1 次。
- 循序 366/366、停止截圖壓力後預設重跑 366/366。失敗 log 保留為 `npm-test-final.log`；沒有因本視覺任務修改後端測試或把一次成功宣稱為測試永久穩定。

### 截圖範圍與人工檢視

- 同第 1 階段的 27 張基本矩陣。
- 90／100／125／150% × 14／16／22px × 空白／對話，共 24 張。
- 另外保留使用者截圖中的 **110%／17px**：空白、對話、設定 3 張。
- Astra 直接檢視代表性的紙色空白／成果／設定、深色對話／設定、1024 窄窗、150%／22px 大字。依截圖修正了輸入框置中、8px 紙外縫、訊息操作鈕直排、設定說明黏行、無額度資訊擠行等問題，不只依賴建置成功。
- 最後另外把模型選單中兩處黃銅文字改墨色（黃銅只做非文字強調），重新建置與樣式／實際行為測試；此項不變更 54 張矩陣中的畫面內容。

主要截圖：

- [空白對話](D:/K-harness/.runtime/visual-direction/stage-2/screenshots-final/warm-empty-1920.png)
- [對話與成果](D:/K-harness/.runtime/visual-direction/stage-2/screenshots-final/warm-artifact-1920.png)
- [110%／17px 設定](D:/K-harness/.runtime/visual-direction/stage-2/screenshots-final/warm-settings-1920-scale110-font17.png)
- [150%／22px](D:/K-harness/.runtime/visual-direction/stage-2/screenshots-final/warm-empty-1920-scale150-font22.png)
- [深色對話](D:/K-harness/.runtime/visual-direction/stage-2/screenshots-final/dark-chat-1920.png)
- [同時有確認卡與成果](D:/K-harness/.runtime/visual-direction/stage-2/review-scene/warm-review-1920.png)
- [樣稿／產品並排比較](D:/K-harness/.runtime/visual-direction/stage-2/comparison/comparison.png)，另有同目錄 `comparison.html`。

### 對比值

實際 CSS token 讀回計算，非目測。欄位分別為輔助文字對四種背景、黃銅非文字對兩種背景。

| 主題 | ink-3／desk | ／sheet | ／raised | ／sunken | brass／desk | ／sheet |
|---|---:|---:|---:|---:|---:|---:|
| 紙色 | 4.77 | 5.24 | 5.51 | 4.81 | 3.57 | 3.93 |
| 白色 | 5.04 | 5.36 | 5.36 | 4.83 | 3.95 | 4.19 |
| 深色 | 6.93 | 6.65 | 6.07 | 5.69 | 7.70 | 7.39 |

全部符合輔助文字至少 4.5、黃銅至少 3。鍵盤焦點實際讀回 2px 黃銅實線；`keyboard-focus.json` 保留 Tab 順序與計算樣式。

### CSS 最終統計

`css-statistics.json` 使用 CSS parser 計算規則／字級：`.app` 欄寬規則 **25→9**（涵蓋側欄／面板開關與斷點），固定 px `font-size` 宣告種類 **15→0**，`--panel` 引用 **4→0**。色值種類 **74→70**（含三主題、透明度及瀏覽器畫面狀態），全部集中於 token 檔；其他 CSS 硬編碼色值為 **0**。移除已無 DOM 的起始卡與訊息頭像規則，以及舊 40px 品牌覆蓋；品牌以 30px／14px／700 明確呈現。

## 正式狀態與未完成

- 正式 `dist-ui`、正式後端、啟動器與使用者目前視窗均未切換；隔離 build 放 `.runtime\visual-direction`。
- 真正 `--app` 原生視窗標題列顏色未驗證；只會驗證網頁 theme-color 讀回，不宣稱 Windows 一定採用。
- Opus 已完成本版複查、無阻擋項；[四項後續修正與更新截圖](visual-review-fixes-20260925.md) 另行記錄，不改寫本文件的歷史證據。正式切換、真實對話狀態同步與 Windows 標題列仍待驗證。工作列 PWA 的真正 Windows 數字驗收仍屬另案，未安裝／未正式使用。
