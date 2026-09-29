# 視覺複查後四項修正

> 最新狀態：使用者後續授權正式切換，2026-09-25 22:03 已部署並在原使用者視窗完成 live 讀回，後端未重啟。詳見 [正式切換紀錄](visual-formal-switch-20260925.md)。下文保留切換前的實作與驗證歷程。

日期：2026-09-25。狀態：**四項已實作並完成隔離驗證；未正式切換、未重啟後端、未提交或 push。**

來源：[Opus 複查](opus-review-visual-direction-20260925.md)。Opus 已接受上一版整體視覺，本紀錄是該次複查的後續小修；不代表 Opus 已重新驗收本輪修改，也不把「沒有阻擋項」視為正式部署授權。

## 實際差異

1. **停用送出鈕**：`frontend/style.css` 增加限定 `.send-button:disabled` 規則，背景用 `--k-line-strong`、箭頭用 `--k-raised`，`opacity:1`，不再把深色按鈕半透明混成中灰。其他停用按鈕與可用送出鈕不變。
2. **截圖狀態一致**：`.runtime/visual-direction/matrix.mjs` 依每個場景的 `busy`／`questions` 產生目前對話的側欄活動資料。逐張驗證側欄與標題列：閒置皆不顯示；工作中皆為「處理中」；核准時分別是「需要確認」／「等你確認」。背景 B 的「處理中」保持獨立，不影響目前 A。此項修正假資料與驗收證據，沒有改正式狀態來源。
3. **成果面板預設寬度**：`frontend/style.css` 預設改為 420 CSS px；`frontend/main.jsx` 依作用中瀏覽器分頁加上版面類別，瀏覽器仍採原本的寬版。使用者已手動設定的寬度優先，沒有新增永久儲存／重設設定；窄視窗的既有浮動版面斷點維持不變。
4. **新成果按檔名辨識**：`frontend/main.jsx` 沿用既有每室面板狀態 map，以曾出現的成果相對路徑／檔名集合取代數量。舊檔暫時消失再出現、排序改變不會重開；出現未見過的名稱才展開並選取成果。不同聊天室分別記憶，不新增後端紀錄或永久儲存。同名檔案更新內容不算新名稱，這是本次規則的界線。

保留全部 14–22 字級、90／100／110／125／150% 縮放及既有偏好；沒有調整字型、標誌、模型、權限語意、計費或並行工作邏輯。工作列 PWA 候選仍是另案，未合併、未安裝。

## 檔案與證據

- 產品修改：`frontend/main.jsx`、`frontend/style.css`。
- 隔離驗收腳本：`.runtime/visual-direction/matrix.mjs`、`.runtime/visual-direction/behavior.mjs`；後者接受輸出目錄參數，避免覆寫前輪證據。
- 本輪前端原始碼基準副本：`.runtime/visual-direction/review-fixes/before/`。
- 本輪建置、截圖與測試紀錄：`.runtime/visual-direction/review-fixes/`。這些 `.runtime` 檔案被 Git 忽略，保留在本機供複查，不當作已提交產物。
- 文件：本檔；同步更新規格／實作紀錄的複查狀態，以及 `docs/development-log.md` 索引。保留 Opus 原複查文字。

## 驗證結果

| 驗證 | 本輪結果 | 證據（位於 review-fixes） |
|---|---|---|
| 全套預設測試 | **366/366**，約 37.4 秒 | `npm-test.log` |
| 外觀／樣式測試 | **8/8** | `style-appearance.log` |
| 隔離正式模式前端建置 | 通過；既有 >500 kB chunk 提示保留 | `build.log`、`build/` |
| 假資料互動 | **19 類通過**、無頁面例外 | `behavior.log`、`behavior/result.json` |
| 多聊天室導航回歸 | **9 類通過** | `navigation.log`、`navigation/` |
| 截圖矩陣 | **54 張**，0 頁面例外、0 水平溢出、0 輸入工具列裁切；54 張狀態核對通過 | `matrix/result.json`、`matrix/*.png` |
| 確認卡＋成果代表場景 | 1 張，狀態核對通過 | `review/result.json`、`review/warm-review-1920.png` |

互動驗證新增項目包括：

- 三主題的停用送出鈕實際計算色值等於指定變數，透明度為 1。
- 成果初始寬度實測 420px；瀏覽器初始寬版；以鍵盤將寬度改為 444px 後，兩種分頁都保留 444px。
- 手動收起後，`ready` 暫時回報空清單再恢復原檔名，不展開；原本的 `connecting` 暫態亦通過。
- 成果數量相同但換成新檔名，會展開；已見過檔名恢復或重排，不展開。
- A 的已見過檔名在 B 仍是新成果；每室手動開關維持獨立。
- 原有字級／縮放、鍵盤焦點、減少動態效果、捲到最新訊息、三主題對比及對話來源綁定回歸均保留。

Astra 直接檢視本輪紙色空白／處理中／確認／成果、深色空白、1024 窄窗、瀏覽器寬版與確認卡＋成果共 8 張代表畫面。狀態判定讀取 DOM 的 `aria-label`，因為忙碌側欄刻意只顯示圓點，不能以空的 `textContent` 判斷。

### 代表截圖

- [空白頁與淺色停用送出鈕](D:/K-harness/.runtime/visual-direction/review-fixes/matrix/warm-empty-1920.png)
- [處理中：目前聊天室與背景聊天室分別顯示](D:/K-harness/.runtime/visual-direction/review-fixes/matrix/warm-working-1920.png)
- [需要確認：側欄／標題列同步](D:/K-harness/.runtime/visual-direction/review-fixes/matrix/warm-approval-1920.png)
- [確認卡＋420px 成果面板](D:/K-harness/.runtime/visual-direction/review-fixes/review/warm-review-1920.png)
- [瀏覽器分頁保留寬版；未啟用瀏覽器連線](D:/K-harness/.runtime/visual-direction/review-fixes/behavior/browser-default-wide.png)

### 執行中的非產品問題

- 第一輪互動腳本把瀏覽器關閉鈕名稱寫短，定位逾時；修正為現有完整名稱後，19 類全數通過。原失敗紀錄保留在 `behavior-first-selector-failure.log`，沒有為配合測試改產品標籤。
- 首次 Vite 建置使用相對輸出路徑，產物落於 `frontend/.runtime/visual-direction/review-fixes/build`；隨後改用絕對路徑建置，上表驗收全部使用專案根目錄 `.runtime/visual-direction/review-fixes/build`。多出的隔離建置未清理、未部署，不影響正式 `dist-ui`。

## 正式狀態與未完成

- **正式 K 未切換**。`dist-ui/index.html` 的檔案時間仍為 2026-09-25 13:47:50、432 bytes；本輪只建置隔離目錄，測試用 localhost 服務已結束。
- 真實對話出現待確認時的側欄／標題列同步，仍需正式切換後實測；本輪只證明假資料與前端呈現一致，不宣稱真實事件已驗收。
- Windows `--app` 視窗最上方標題列是否採用紙色，仍需正式切換後在使用者視窗確認。
- 正式切換時間由使用者決定。未重啟正式後端、未碰日常瀏覽器設定檔或帳號；未提交其他既有修改。
