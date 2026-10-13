# 程式碼排版：拆開擠成一行的寫法（2026-10-14）

本人全權授權處理「檔案寫得太擠，AI 修改容易改錯又耗額度」。Claude Opus 5.5 執行；Fable 5.1 獨立第二審（結果見下節）。

## 為什麼先排版

拆檔前實測：`frontend/main.jsx` 平均每行 232 字、10 行超過 1,000 字、最長一行 7,778 字；`desktop-controller.mjs` 最長 1,740 字。AI 用精確字串比對修改時，必須比對整條超長行；改一個字，差異就是整行，人和其他模型都無法審核。這比檔案大小更直接影響 AI 的修改品質。

## 做法

- 專案內安裝開發用 Prettier `3.9.10`（固定版本，`devDependencies`），設定 `.prettierrc.json`：每行 120 字、單引號、箭頭參數不加括號、大括號內不加空格、無尾逗號、LF。`.prettierignore` 只納入 K 自己的 JavaScript：`src`、`frontend`（.jsx／.mjs）、`shared`、`scripts`、`test`（含 fixtures），共 329 檔；瀏覽器擴充、CSS、C# 啟動器、文件不動。
- 結果：`main.jsx` 平均每行 232→41 字、最長 7,778→301；`desktop-controller.mjs` 平均 103→41；`claude-controller.mjs` 92→39；`conversation-controller.mjs` 86→41。剩下最長的幾行是無法拆的長提示字串。

## 行為不變的證明

以 rolldown `parseAst` 解析排版前（Git `HEAD`）與排版後的每個檔案，去除位置、原始字面（引號樣式）與多餘括號，再逐節點比對：329／329 檔語法樹相同。等價規則只有三條，皆不影響執行：

1. JSX 子節點依 React／Babel 的 JSX 空白規則換算後比對（Prettier 會把可見空白改寫成 `{" "}`）。
2. 同一種 `??`／`||`／`&&` 連續運算攤平比對（唯一一處：`main.jsx` 的 `panelWidth ?? (寬度 ?? 500)` 變成 `panelWidth ?? 寬度 ?? 500`，兩者取值與求值順序相同）。
3. 忽略多餘的空語句（兩個測試探針檔原本有多打的分號）。

比對工具先以「未排版應全相同」與「故意把一個識別字改名應被抓到」驗證有效。工具收錄為 `scripts/check-format-equivalence.mjs`（`node scripts/check-format-equivalence.mjs <排版前版本> <檔案…>`），日後升級 Prettier 或重新排版時可重用。

## 必須跟著改的測試（只改測試，未改產品程式）

部分測試依賴原始碼的「寫法」而非行為，排版後需調整：

- `native-goal-recovery`、`chat-continuation`：先讀 `desktop-controller.mjs` 原始碼、以字串替換把 30 秒冷卻改短或插入暫停點後再載入。替換用的字串改為排版後的寫法。
- `conversation-navigation-ui`、`response-annotations-ui`、`voice-composer-window-hidden`：以正規表示式檢查原始碼寫法。新增 `test/source-text.mjs` 的 `compactSource`，把排版加上的空白去掉、還原成原本的緊湊形狀再比對，原斷言一字未改；會被當作程式執行的原文（preload）改回逐字讀取。
- `voice-consent`：從原始碼切出函式實際執行。改用 `functionInitializer` 依括號配對切出完整函式，不再依賴「整段在同一行」。

## 順帶修正的不穩定測試

排版後連跑完整測試時出現兩個時有時無的失敗（每次不同、單獨跑都通過）。程式已證明等價，原因在測試本身：

- `native-goal-recovery`「Codex Gemini ready is consumed…」：送出後立即檢查「就緒提示已處理」，但處理在送出後非同步完成。改為等兩者都成立；若產品真有 bug 仍會逾時失敗。
- `claude-controller` 的 `waitFor` 上限 5 秒：等待的結果包含存檔，而存檔遇鎖可合理等到 10 秒，改為 15 秒，與 `chat-continuation` 一致。

## 驗證

- 語法樹等價 329／329；`prettier --check` 全部符合。
- 完整測試連跑 3 次皆 1621／1621，跑完無暫存殘留；`vite build` 成功；瀏覽器介面實測 `user-message-copy`、`modal-focus`、`worker-count`、`steer-final`、`conversation-navigation` 五項通過、無頁面錯誤（證據在 `.runtime/archive/format-verify-20261014/`）。

## 未處理

- 這批只排版、不拆檔。`desktop-controller` 的單一 closure 與 `App` 元件的拆分，在排版後可逐步進行，另批處理。
- 程式碼差異約 9 萬行，其他聊天室若有以排版前版本為基礎的未合併修改，會產生衝突；本次確認無進行中的 K 程式修改。

## Fable 5.1 獨立第二審（2026-10-14）

經 K 工人通道派 `claude-fable-5-1`（high），只讀審核 97af2f5、72f04c2、b7b4086、1a43675。結論：**無阻擋、無應修**。Fable 另做了探針：括號不會被誤判為等價、指令／BigInt／正規表示式都有比到、拆分搬出的 40 個頂層定義與拆分前逐節點相同、無循環匯入。建議項目及處理：

| 建議 | 處理 |
|---|---|
| 樣板字串只比 `cooked`，應連 `raw` 一起比（`String.raw` 看 raw） | 採納。改後重跑無新增差異。 |
| `{" "}` 合併為文字會掩蓋元件收到「字串或陣列」的差異 | 採納。只在小寫原生 DOM 元素內合併；元件與 Fragment 嚴格比對。改後格式化版 `main.jsx` 仍等價。 |
| `git show` 找不到新檔時工具崩潰；紀錄「329／329」無法由提交重現 | 採納。新檔改列 `NEW` 不比對，結果分「相同／差異／新檔」。說明：329／329 是排版當下（測試尚未調整）的結果；對 `72f04c2` 重跑時，正式程式檔全部等價，差異只有刻意修改的 7 個測試檔與刪除未用匯入的 `main.jsx`，另 2 個新檔。 |
| 括號處理是死碼（`parseAst` 不產生 ParenthesizedExpression） | 採納，刪除。 |
| `native-goal-recovery` 替換冷卻字串缺「恰好一次」斷言 | 採納，補上。 |
| `functionInitializer` 找不到 `=>` 或遇到表達式體時會亂切 | 採納。只看第一個 `=>`，其後必須是 `{`，否則明確報錯；三種邊界已測。 |
| `main.jsx` 尚有 20 個拆分後無用的匯入 | 部分採納：查證後 19 個確實無用，已刪；`conversationPreview` 在第 920 行仍使用（即先前修過的誤刪），保留。 |
| `app-common.jsx`、`dialogs.jsx` 的 `import React` 在自動 JSX runtime 下不需要，且其他元件檔沒有 | 不採納：26 個元件檔有 24 個匯入 React，維持一致；前提與實況不符。 |
| `atomicWrite` 遇目標是資料夾即失敗屬過度防禦，可刪 | 不採納：既有「存檔失敗要顯示通知」測試以資料夾占位模擬永久失敗，少這 2 行就得白等 10 秒；成本低、無副作用。 |
