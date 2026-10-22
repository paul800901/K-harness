# K 介面視覺層次修正（2026-10-22）

## 背景與結論

本人反映 K 配色好看但「沒有層次、很難分辨」。Claude Fable 與 Gemini 3.8 Flash 討論後定案：根因不是色相，而是文字三階（ink／ink-2／ink-3）、底色、邊框透明度、字級擠在肉眼難分的區間，留白也沒有跳階。本批只拉開既有階梯，不換色相、不加第二強調色、訊息氣泡不加陰影、AI 回覆不包卡片、側欄不做斑馬紋、不新增人用設定或按鈕；三個主題（暖色預設、淺色、深色）一致處理。

- 分支：`ui-visual-hierarchy-20261022`（基底 `9a2ec97`）；程式 commit `c89e5ee9df02962bd940f2dbc46b23d22020b991`
- 實作：Claude Opus 5.5 子代理
- 複查：**待 GPT-6.1 Sol 複查**
- 部署狀態：**未部署**（未合回 main、未 push）

## 改動檔案

- `frontend/tokens.css`：三主題文字、邊框、選取、浮起底色階梯；新增 `--k-text-section`、`--k-space-1`～`--k-space-4`
- `frontend/sidebar.css`：工作區列改分類標頭外觀；已選聊天室加左側黃銅標記
- `frontend/style.css`：設定分章、對話框與頂部標題、目標狀態色、對話間距、模型小標籤
- `frontend/discussion-api-settings.css`：討論 API 卡片邊框、陰影、標題字級
- `frontend/settings-dialog.jsx`：設定內容分成四章，每章一個分組標籤
- `frontend/discussion-api-settings.jsx`：原本自帶的「討論用 API 連線」h3 移到章節標籤，避免重複
- `frontend/main.jsx`：目標按鈕依狀態加 `active`／`warning` class；依模型切換紀錄算出每則回覆的模型
- `frontend/chat-messages.jsx`：AI 回覆開頭顯示模型小標籤

未改後端 `src/`、`package.json`、`mobile.css`；未碰 `.runtime`。

## 對應工單 A–F

### A. 階梯拉開（tokens.css）

| 主題 | ink-2 | ink-3 | line | line-strong | selected | 其他 |
| --- | --- | --- | --- | --- | --- | --- |
| 暖色（預設） | #5b5146 → #544a3f | #71665a → #786d60 | .12 → .16 | .20 → .26 | .09 → .15 | raised #fffdf9 → #fff（sheet 維持 #fbf7f0） |
| 淺色 | #4a4f58 → #454a53 | #656b76 → #6e7480 | .12 → .15 | .20 → .25 | .08 → .13 | sheet #fff → #fbfbfc，讓 raised #fff 分得出 |
| 深色 | 不變 #c3c7d0 | #9ba1af → #8a909c | .10 → .14 | .18 → .24 | .10 → .16 | raised／sheet 原本就分得開 |

相對亮度（ink／ink-2／ink-3）：暖色 .019／.071／.158（原 .019／.086／.138）、淺色 .020／.068／.174（原 .020／.078／.146）、深色 .807／.570／.278（原 .807／.570／.356）。ink-3 對 ink-2 的對比由約 1.4–1.5 拉到 1.7–1.9；ink-3 在 sheet 上仍 ≥ 4.5（暖 4.73、淺 4.54、深 5.37）。

- 新增 `--k-text-section: 12px`（分組標籤）與 `--k-space-1: 4px`、`--k-space-2: 8px`、`--k-space-3: 16px`、`--k-space-4: 28px`；間距變數只用在本次修改處。
- `--k-text-lg`（20px）用在對話框標題（原本就是）與頂部聊天室標題（本次由 14px 升上去）。

### B. 設定對話框

- 依現有內容分四章：「帳號與核心」（遠端裝置顯示為「額度」）、「顯示」（介面外觀、介面縮放、對話字體大小）、「討論用 API 連線」、「資料」（已封存、附件說明）。功能、按鈕、文字都不變；只把「介面縮放／對話字體大小」移到「介面外觀」旁，同屬顯示。
- 每章上方 12px 粗體分組標籤（`--k-text-section`、`--k-ink-2`、letter-spacing .02em），章與章之間 `--k-space-4`（28px）。
- 章內 `.setting-row`、原生核心更新、帳號連線、附件說明之間的 1px 隔線拿掉，列距改為上下各 8px，用留白分組。只作用在 `.settings-section` 內，手機「對話設定」等其他 `.setting-row` 不受影響。
- 討論 API 卡片（含新增／編輯表單）：邊框 `--k-line-strong`、底色 `--k-raised`、`--k-shadow-1`；卡片標題 1.15em（約 15px）、粗體、`--k-ink`；網址與模型清單沿用整區的 `--k-ink-3`。
- 對話框標題維持 `--k-text-lg`、粗體。

### C. 側欄

- 工作區列（`.project-row`／`.project-toggle`／`.project-label`）：12px（`--k-text-section`）、粗體、`--k-ink-2`、letter-spacing .02em；資料夾圖示降為 `--k-ink-3`（含目前聊天室的工作區仍為 ink-2）。聊天室列維持 14px、`--k-ink`。
- 已選聊天室：底色用新的 `--k-selected`，左側加 3px 寬黃銅直立標記（`::before`，上下內縮 7px、圓角 2px，不破列的圓角，`pointer-events:none`）。
- 「工作區」小標與底部剩餘額度未動。

### D. 主畫面頂部

- 閒置／無事項目：壓縮次數、「無未結束的子代理」、遠端「已連線」原本就是 `--k-ink-3`；本次把「目標 · 未設定」等目標按鈕預設也降為 `--k-ink-3`。目標進行中／啟動中為 `--k-ink-2`，受阻、額度暫停、預算用完、失敗或讀取錯誤為 `--k-warn`。執行中／待核准（黃銅圓點）、離線／錯誤（danger）維持原樣。
- 「連線正常」字樣在桌面頂部不存在（閒置時工作狀態不顯示），無需改。
- 聊天室標題（麵包屑 h1）14px → `--k-text-lg`（20px）；手機版由 mobile.css 覆寫為 16px，不變。
- 沒有改成膠囊，沒有新增元件。

### E. 對話區

- `.message-column` 間距 24px → 32px（手機 mobile.css 仍為 20px）。
- AI 回覆開頭新增 12px、`--k-ink-3` 的模型小標籤（`.assistant-model`，不參與引用選取，複製內容不變）。原本一般回覆沒有模型名（只有底部時間），討論訊息已有發言者列，故討論訊息不加，避免重複。
- 模型資料來源：一般回覆紀錄本身不存模型。改由前端依既有的模型切換紀錄（`modelChanges`）與 `lastUsedModel` 依序推算每則回覆的模型，顯示目錄中的顯示名稱（例：GPT-6.1 Sol）。**Claude 核心目前不記錄對話中途換模型**（後端只改 `state.model`，`modelChanges` 永遠是空的），無法得知舊回覆是哪個 Claude 型號，因此 Claude 對話的回覆只標「Claude」，不拿目前模型冒充；GPT／Gemini 缺紀錄時同樣只標供應商。
- Gemini 的切換紀錄以使用者訊息 id 作為 turnId，推算時兩種都比對。
- 限制：切換紀錄出現前的舊 Codex 對話，`lastUsedModel` 由後端以存檔中的模型補上，若當時中途換過模型，早期回覆可能標成後來的型號；這是既有紀錄的精度，前端不另猜。
- `settings-dialog.jsx` 縮排加深後以專案 Prettier 設定整理，連帶修正一行原本就超過行寬的文字。
- 沒有做回覆左側直線、氣泡陰影或回覆外框。

### F. 排除

- 未改圓桌、瀏覽器面板、用量等其他面板；token 改動只會讓它們的邊框／次要文字一起變清楚，未發現破版（UI probe 見下）。
- 未新增使用者設定，未改後端與 package.json。

## 與工單規格不同之處

1. **字重 600 改為 700**：既有守門測試 `test/ui-style-guard.test.mjs` 只允許 400／700（中文字型微軟正黑體只有一般與粗體，600 對中文本來就落到粗體，對英文則變半粗，同一行會不一致）。依「不改測試讓它過」原則，分組標籤、側欄工作區列、卡片標題、對話框與頂部標題一律用 700。
2. **卡片標題用 1.15em 而非 15px**：同一守門測試要求字級走變數或 em；討論 API 區字級為 13px，1.15em ≈ 15px。
3. **暖色 ink-3 用 #786d60 而非建議的 #7d7265**：#7d7265 在 sheet 上對比約 4.4，低於 4.5；#786d60 為 4.73，與 ink-2 的差距仍明顯拉開。
4. **淺色 sheet 改 #fbfbfc**：淺色原本 raised 與 sheet 都是 #fff，不改就無法「分得開」。
5. **Claude 對話的模型標籤只顯示「Claude」**：理由見 E；要顯示確切型號需在 `src/claude-controller.mjs` 換模型時寫入 `modelChanges`，本工單不准改後端，列為未做事項。

## 驗證

- `npm run build:ui`：成功（既有的 chunk > 500 kB 提示，非本次造成）。
- `npm test`：第一次 1802/1803，`ui-style-guard` 擋下 15px 與 font-weight 600，依上述 1、2 修正後 **1803/1803 通過**。
- `npm run test:ui`：第一次完整執行 48/49（`menu-viewport-ui-probe.mjs` 失敗，見下節）；最終建置後完整重跑 **49/49 通過**。
- 三主題：**未實際截圖**。專案沒有三主題截圖 probe；以建置、全部 UI probe（含設定、側欄、手機遠端、討論 API 設定等）與 CSS 檢視為準。
- mobile.css 檢查：未覆寫 `.project-*`、`.session.selected`、`.goal-header` 顏色、`.assistant-model`、`.settings-section*`；`.header-breadcrumb>h1`（16px）與 `.message-column` 間距（20px）由 mobile.css 後載入覆寫，手機維持原樣；`dialog .setting-row` 的手機 12px 列距在設定章節內被新規則改為 8px，排版方向與換行不變。

### menu-viewport probe

- 失敗內容：`remote-360-740`、`remote-320-480` 兩個手機遠端視窗的 `composer-model-menu` 標為 required-check-not-reached（「對話設定 → 主代理模型 → 模型選單」入口當下沒找到）。本次沒有改這條路徑的元件或選擇器（`.mobile-conversation-settings .setting-row` 不在 `.settings-section` 內）。
- 改動版共執行 23 次（完整套件、執行器與直接執行合計），失敗 3 次，其中最後連續 10 次直接執行全部通過；最終完整 `test:ui` 49/49。
- 基底 `9a2ec97`（暫存改動後重建）直接執行 8 次全部通過。樣本數不足以斷定與本次無關；`docs/codex-credits-display-20261017.md` 已記錄同一 probe「重跑兩次一敗一過」的既有不穩定。測試未修改、斷言未放寬。**列為待 Sol 複查確認的已知不穩定，不宣稱已排除。**

## 未做事項

- Claude 換模型時寫入 `modelChanges`（後端，需另開工單），完成後 Claude 回覆即可顯示確切型號。
- 三主題實際截圖目視（交 Sol 複查或本人看）。
- 設定章節名稱與分組是依現有內容的判斷，可在複查時調整。
