# K 介面視覺層次修正（2026-10-22）

## 背景與結論

本人反映 K 配色好看但「沒有層次、很難分辨」。Claude Fable 與 Gemini 3.8 Flash 討論後定案：根因不是色相，而是文字三階（ink／ink-2／ink-3）、底色、邊框透明度、字級擠在肉眼難分的區間，留白也沒有跳階。本批只拉開既有階梯，不換色相、不加第二強調色、訊息氣泡不加陰影、AI 回覆不包卡片、側欄不做斑馬紋、不新增人用設定或按鈕；三個主題（暖色預設、淺色、深色）一致處理。

- 分支：`ui-visual-hierarchy-20261022`（基底 `9a2ec97`）；程式 commit `c89e5ee9df02962bd940f2dbc46b23d22020b991`；Sol 複查後修正 `aa04c56392c05cf4e5a44d68d8a76b2c71ce63a1`（分支回覆標籤、ink-3）、`33379cbb5a4aca9a2ace2bb11733000a4539b51d`（menu-viewport probe 競態）
- 實作：Claude Opus 5.5 子代理
- 複查：GPT-6.1 Sol 已複查，必修兩項已修（見「Sol 複查與修正」）；修正版 Sol 最終覆核通過（build:ui 成功、test:ui 49/49、npm test 1803/1803，模型標籤 16 組情境通過，無剩餘必修）
- 合併：以 main `198e38d`（含同日 Gemini 派工修正 `docs/gemini-dispatch-idle-20261022.md`）為基底合回，合併 commit `e7b478c`；合併後於 main 重跑 build:ui、npm test、test:ui（結果見「驗證」末段）
- 部署狀態：**南區已部署、程式版已 push 並讀回**；2026-10-22 17:32:06（臺灣時間）由 K 外的 Codex App 套用 `2f46ccc1d0a6ccb6e7a8157ebad559fcc1ab20e5`，與同日 Gemini 派工修正同批發布。K 保持關閉，三主題與正式操作待本人驗證；東區未更新。

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
| 暖色（預設） | #5b5146 → #544a3f | #71665a → #74695c | .12 → .16 | .20 → .26 | .09 → .15 | raised #fffdf9 → #fff（sheet 維持 #fbf7f0） |
| 淺色 | #4a4f58 → #454a53 | #656b76 → #6c727e | .12 → .15 | .20 → .25 | .08 → .13 | sheet #fff → #fbfbfc，讓 raised #fff 分得出 |
| 深色 | 不變 #c3c7d0 | #9ba1af → #8a909c | .10 → .14 | .18 → .24 | .10 → .16 | raised／sheet 原本就分得開 |

相對亮度（ink／ink-2／ink-3）：暖色 .019／.071／.146（原 .019／.086／.138）、淺色 .020／.068／.167（原 .020／.078／.146）、深色 .807／.570／.278（原 .807／.570／.356）。ink-3 對 ink-2 的對比：暖色 1.38 → 1.61、淺色 1.54 → 1.84；ink-3 在側欄底色 desk 與主畫面 sheet 上都 ≥ 4.5（暖 desk 4.56／sheet 5.02、淺 4.55／4.67、深 5.60／5.37）。ink-3 原本實作時是 #786d60／#6e7480，只顧到 sheet，desk 上只有 4.30／4.42，Sol 複查指出後再微調（見「Sol 複查與修正」）。

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
- 模型資料來源：一般回覆紀錄本身不存模型。改由前端依既有的模型切換紀錄（`modelChanges`）與 `lastUsedModel` 依序推算每則回覆的模型，顯示目錄中的顯示名稱（例：GPT-6.1 Sol）；推算不出型號的回覆只標供應商（GPT／Claude／Gemini／自架模型），不拿目前模型冒充。實際行為：
  - 非分支的 GPT／Gemini 聊天室：起點模型取第一筆切換紀錄的 `fromModel`，沒有切換紀錄就用 `lastUsedModel`，之後每遇到切換紀錄就換成 `toModel`，所以中途換模型前後都標得出型號。只有連 `lastUsedModel` 都沒有時才只標供應商。
  - 分支聊天室（`parentThreadId` 有值，含手動分支與「接續」）：後端建立分支時不帶來源的 `modelChanges`，前端也拿不到分支點（`forkThroughTurnId` 只存在後端紀錄，不在畫面狀態裡），分不出哪些回覆是繼承來的。因此分支聊天室**不推定起點模型**：只有在分支自己記下的切換紀錄之後的回覆標型號，之前的回覆（繼承的，以及分支後還沒換過模型的）一律只標供應商。代價是「分支後一直用同一個模型」時，分支裡新寫的回覆也只標供應商；這是寧可少標、不可標錯的取捨。
  - Claude 聊天室：**Claude 核心目前不記錄對話中途換模型**（後端只改 `state.model`，`modelChanges` 永遠是空的，`lastUsedModel` 也不寫），所以回覆只標「Claude」。
  - `modelChanges` 是空陣列、`undefined` 或 `null` 時都當成沒有紀錄，不會出錯。
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
3. **暖色 ink-3 用 #74695c 而非建議的 #7d7265**：#7d7265 在 sheet 上對比約 4.4，低於 4.5。初版用 #786d60（sheet 4.73），但側欄 desk 上只有 4.30；Sol 複查後改 #74695c，desk 4.56、sheet 5.02，與 ink-2 的對比 1.61，仍比原本的 1.38 明顯拉開。
4. **淺色 sheet 改 #fbfbfc**：淺色原本 raised 與 sheet 都是 #fff，不改就無法「分得開」。
5. **Claude 對話的模型標籤只顯示「Claude」**：理由見 E；要顯示確切型號需在 `src/claude-controller.mjs` 換模型時寫入 `modelChanges`，本工單不准改後端，列為未做事項。

## 驗證

- `npm run build:ui`：成功（既有的 chunk > 500 kB 提示，非本次造成）。
- `npm test`：第一次 1802/1803，`ui-style-guard` 擋下 15px 與 font-weight 600，依上述 1、2 修正後 **1803/1803 通過**。
- `npm run test:ui`：第一次完整執行 48/49（`menu-viewport-ui-probe.mjs` 失敗，見下節）；最終建置後完整重跑 **49/49 通過**。
- 三主題：**未實際截圖**。專案沒有三主題截圖 probe；以建置、全部 UI probe（含設定、側欄、手機遠端、討論 API 設定等）與 CSS 檢視為準。
- mobile.css 檢查：未覆寫 `.project-*`、`.session.selected`、`.goal-header` 顏色、`.assistant-model`、`.settings-section*`；`.header-breadcrumb>h1`（16px）與 `.message-column` 間距（20px）由 mobile.css 後載入覆寫，手機維持原樣；`dialog .setting-row` 的手機 12px 列距在設定章節內被新規則改為 8px，排版方向與換行不變。
- 合回 main 後（合併 commit `e7b478c`，基底 `198e38d`）由主代理 Claude Fable 5.1 重跑：`npm run build:ui` 成功、`npm test` **1806/1806**（多出的 3 個是同日 Gemini 派工修正的回歸測試）、`npm run test:ui` **49/49**。

### menu-viewport probe

- 失敗內容：`remote-360-740`、`remote-320-480` 兩個手機遠端視窗的 `composer-model-menu` 標為 required-check-not-reached（「對話設定 → 主代理模型 → 模型選單」入口當下沒找到）。本次沒有改這條路徑的元件或選擇器（`.mobile-conversation-settings .setting-row` 不在 `.settings-section` 內）。
- 改動版共執行 23 次（完整套件、執行器與直接執行合計），失敗 3 次，其中最後連續 10 次直接執行全部通過；最終完整 `test:ui` 49/49。
- 基底 `9a2ec97`（暫存改動後重建）直接執行 8 次全部通過。樣本數不足以斷定與本次無關；`docs/codex-credits-display-20261017.md` 已記錄同一 probe「重跑兩次一敗一過」的既有不穩定。測試未修改、斷言未放寬。
- Sol 複查找到原因：probe 切到「切換主代理模型」對話框後立刻用 `count()` 找「主代理模型」按鈕，但 `frontend/model-picker.jsx` 的模型目錄是非同步載入，載入中只顯示「正在讀取模型清單…」、不渲染該按鈕，於是檢查被跳過、記成 required-check-not-reached。這是測試的競態，不是畫面退化。處理見下節。

## Sol 複查與修正

GPT-6.1 Sol 複查初版（`c89e5ee`、`8c693ea`）後的處置：

- **必修 1：分支對話回覆模型誤標（已修，`aa04c56`）**。Sol 以原碼重現：Codex 建分支時後端不繼承來源的 `modelChanges`，初版以「第一筆切換紀錄的 `fromModel`，否則 `lastUsedModel`」當整段歷史的起點，於是「來源用 A → 用 B 建分支 → 分支送出第一則後」，繼承來的舊回覆全被標成 B。前端沒有可靠的分支點（見 E），改為分支聊天室不推定起點模型、只在分支自己的切換紀錄之後標型號，其餘只標供應商；未改後端。四種情境（非分支含中途換模型、分支、Claude、`modelChanges` 空或缺）以同一段推算邏輯的模擬資料逐一核對，結果與 E 所列行為一致。
- **必修 2：文件與實際行為不符（已修，本次文件）**。初版寫「GPT／Gemini 缺紀錄時同樣只標供應商」，實際上缺紀錄時會用 `lastUsedModel` 推定，也沒寫分支問題；E 已依修正後的行為改寫。
- **建議修：menu-viewport probe 競態（已修，`33379cb`，單獨 commit）**。在 probe 找「主代理模型」按鈕前，先等它出現（最多 5 秒）；等不到時照舊記為 required-check-not-reached 而失敗，既有斷言一條都沒放寬。對照紀錄：修前本分支連跑 5 次全部通過、切到 `main`（`9a2ec97`，重新建置）連跑 3 次全部通過；修後本分支連跑 5 次全部通過。這幾輪都沒重現失敗，所以修正是依程式碼分析補上的等待，不是看到失敗後才改的。
- **建議修：側欄小字對比（已調，`aa04c56`）**。ink-3 在側欄底色 desk 上，暖色 4.30、淺色 4.42，未達 4.5。暖色 #786d60 → #74695c（desk 4.56、sheet 5.02）、淺色 #6e7480 → #6c727e（desk 4.55、sheet 4.67）；深色原本 desk 5.60，不調。與 ink-2 的對比仍有 1.61（暖）／1.84（淺），比改版前的 1.38／1.54 拉得開，沒有貼回 ink-2。另外，滑過（hover）或已選聊天室底色上的 ink-3 小字（例如時間）仍低於 4.5（暖色 4.13／3.55、淺色 4.15／3.56），改版前也是這樣；要補到 4.5 就得讓 ink-3 幾乎等於 ink-2，會失去本批要的層次，所以不追。
- **可接受項目**：本工單沒有逐條列出 Sol 判為可接受的項目；除上述四項外，初版其餘內容（A–F 各項與「與工單規格不同之處」）本次沒有更動。

修正後驗證：`npm run build:ui` 成功（同一則 chunk > 500 kB 既有提示）；`npm test` **1803/1803 通過**（含 `ui-style-guard` 3/3）；`npm run test:ui` **49/49 通過**。

## 正式部署與讀回

- 2026-10-22 17:32:06（臺灣時間）完成正式套用。部署前確認正式 K 無相關程序、47831 連線拒絕，且執行者位於外部 Codex App 後，依 `docs/git-install-update.md` 執行一次 `Update-K.ps1 -Ref 2f46ccc1d0a6ccb6e7a8157ebad559fcc1ab20e5`。當時 main 為該 SHA、工作樹乾淨。
- 更新器完成 lockfile 安裝、介面／擴充／啟動器建置與完整測試 **1806/1806**；本輪未重跑 UI probes，沿用上節 main 已驗證的 **49/49**。輸出保留在 `.runtime/archive/deploy-2f46ccc-20261022.log`。
- 更新器實際設定位置是 `D:\K-harness\.local\runtime.json`，不是候選目錄下的 `.local/runtime.json`。讀回 `version` 完整等於上述 SHA；部署前為 `fb2754150a52c685d5fc412d94a931e173d61c15`，設定差異僅 `version`、`previous`。
- 正式 `trusted-runtime` 的 **816 個 Git 來源檔**全部對應指定版本：11 檔位元組完全相同，805 檔僅 Windows CRLF 差異（本機 `core.autocrlf=true`），換行正規化後無差異。沒有修改程式碼或三家核心。
- 上一版程式與啟動器保留於 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1792661526026`；現存退版為 `before-1792439332866`、`before-1792599782594`、`before-1792661526026`，共三份，均讀回程式與啟動器存在。舊的 `before-1792414820257` 原路徑已消失，資源回收筒有一筆相符項目，可還原；這是程式退版，不是對話備份。
- push 前檢查待發布 10 個提交的路徑與新增內容，未發現私人執行資料或憑證型態；`git push origin main` 後於 **17:34:35（臺灣時間）**讀回遠端 `main` 為 `2f46ccc1d0a6ccb6e7a8157ebad559fcc1ab20e5`。本次兩份工程紀錄與索引另作純文件提交，不改正式程式版本、不重啟 K。
- K 套用後仍停止，未啟動正式模型、未操作帳號／對話／瀏覽器資料，未改計費與權限。**尚未做啟動後 health 或正式互動驗證**；由本人啟動後檢查四章設定、API 卡片邊框、側欄標頭與黃銅選取條、頂部標題、回覆模型小標籤，並切換暖色／淺色／深色。Gemini 雙聊天室與切換帳號檢查見同日派工紀錄；東區仍待當地更新。

## 未做事項

- Claude 換模型時寫入 `modelChanges`（後端，需另開工單），完成後 Claude 回覆即可顯示確切型號。
- 三主題實際截圖目視（交 Sol 複查或本人看）。
- 設定章節名稱與分組是依現有內容的判斷，可在複查時調整。

## 10-22 第二批：章節標題再拉開

使用者看設定頁截圖後指出：章節小標「顯示」「討論用 API 連線」是 12px，比底下 14px 的列標題小，眼睛先落在子項；「討論用 API 連線」三段說明文和標題擠在一起，重心落在說明文。本批只調數值，不改方向、結構、元件與後端。

- `frontend/style.css` `.settings-section-label`：字級 `--k-text-section`（12px）→ `--k-text-md`（14px），與列標題同級並維持 700 加粗；顏色 `--k-ink-2` → `--k-ink`；字距 `.02em` → `.01em`；下方間距 `--k-space-1`（4px）→ `--k-space-2`（8px）。章節之間 `margin-top` `--k-space-4`（28px）→ `--k-space-5`（32px）。
- `frontend/tokens.css`：新增 `--k-space-5: 32px`，只在 `:root` 定義一次，三主題共用（各主題區塊本來就不覆寫 space）。
- `frontend/discussion-api-settings.css`：`.discussion-api-intro`、`.discussion-api-notice` 明確設 `color: var(--k-ink-3)`、`font-size: var(--k-text-sm)`（13px）、`line-height: 1.6`；原本單獨的 `.discussion-api-notice{line-height:1.5}` 併入。
- 說明文顏色查證：三段說明文都是 `.discussion-api-intro`，顏色一路繼承外層 `.discussion-api-settings` 的 `--k-ink-3`，全前端沒有其他規則把它蓋成 ink-2 或 ink，因此沒有覆蓋來源可修；截圖看起來偏深，是因為說明文原本比 12px 標題大、又緊貼標題。本批靠標題放大加深與間距拉開解決，未加 `!important`。
- 不動：側欄 `.project-toggle`／`.project-label`（仍為 12px 分類標頭）；`mobile.css` 沒有覆寫 `.settings-section-label`，不需對齊。
- 驗證：`npm run build:ui` 成功（僅既有的 chunk 大小提醒）；`npm test` **1806/1806**；`npm run test:ui` **49/49**。
- 分支 `ui-section-label-20261022`（基底 main `ce1e2c1`）。部署狀態：**未部署**，未合併、未 push。
