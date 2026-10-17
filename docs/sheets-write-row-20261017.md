# Gemini 試算表單列寫入（2026-10-17）

## 問題與根因

本人在營運資料工作區用 Gemini 3.8 Flash 交代「10/17 300+300+500 都是現金 存入」。Flash 正確讀回 `日業績` 第 319 列為最新紀錄，但回報無法寫入、只做出待寫入草稿。

- `k_sheets` 只開放 `sheets_metadata`、`sheets_read_values`（[唯讀接線](gemini-sheets-read-20261016.md) 當時刻意不開放寫入），workspace-write 下指令也被 deny，`k_browser` 未連線，Flash 沒有任何寫表管道。
- 過去的正式寫入都由 Claude／Codex 執行工作區的 Python guard，再呼叫同一個既有 CLI 的 `batch`。Flash 在 workspace-write 不能跑命令，即使有規則也無法走這條路。
- Flash 草稿另有欄位缺漏（未依 10-15 前例填 `unknown`／`UNKNOWN`），若直接以位置陣列寫入也有錯欄風險。

不是模型能力或 Google 登入問題。

## 本人授權

本人要求「完整治本」：Flash 要能處理口述收款登錄這類小事，也要能回答期間收入；做好後交 GPT-6.1 Sol 覆核，再由 Codex 的 Sol 更新 K。10/17 三筆保留，部署後交給 Flash 實際登錄。

## 修正內容

`src/google-sheets-mcp.mjs` 新增 `sheets_write_row`，仍只呼叫 owner 指定既有 CLI 的 `meta`／`get`／`cells`／`batch`，模型不能指定子命令、路徑或 batch 內容：

- **本人核准的可寫分頁與識別欄**：接線參數 `--write '{"<試算表ID>":{"<分頁>":"<識別欄>"}}'`。沒有這個參數時工具不出現，維持唯讀；模型不能自選識別欄或寫其他分頁。原本的 `allowWrite` 權限（read-only 聊天室自動排除）照舊。
- 欄位以第 1 列表頭名稱指定，未知或重複表頭拒絕，避免缺欄或多欄造成整列錯位。
- `append`：先確認識別碼不存在，再用 Google 的 `appendCells` 接在最後一列資料之後（列位置由 Google 原子決定，平行呼叫不會互相覆蓋），寫後以識別碼找回唯一一列。
- `update`：需列號，該列識別欄原始值（含型別）必須等於傳入值；識別碼不改寫，只改其他傳入欄位，空字串代表清空。
- 數字／布林／文字對應 `numberValue`／`boolValue`／`stringValue`，拒絕 `=` 開頭公式。身分比對與寫後驗收都讀 `userEnteredValue`（既有 CLI 的 `cells`），公式算出的值不會被當成空白或數字。
- 寫後讀回整列與表頭：逐欄比對（append 包含未指定欄應為空白），表頭在寫入期間改變也列為不符；回傳 `row`、`before`、`after`、`verified`、`mismatches`。
- 錯誤分類：寫前檢查失敗＝「未寫入」；`batch` 的 HTTP 4xx＝整批未套用；其他失敗、找不到或找到多筆、讀回失敗＝結果未知，要求先讀回、不重送。暫存檔清理失敗不影響結果判斷。不自動重試。
- 不提供刪列、清範圍、改分頁、格式或分享。

業務值（可用值、record_id 編號、去重、稽核收據、收入納入條件）屬營運資料庫規則，寫在該工作區 `StoreOps_新業績表/AI_日業績單筆登錄與收入查詢_k_sheets.md`，入口 README 加一行指向。K 不內建 StoreOps 規則，也不執行工作區內 Gemini 可改寫的 Python guard（避免 workspace-write 透過改寫腳本取得 K 程序執行權）。

## 驗證

證據在本工作樹 `.runtime/archive/sheets-write-20261017/`，不提交 Git。

- 程式：初版 `36c671125076980e6154bc57f6aaa10fcc28ba2c`，依覆核修正為 `f92a548e55fed73078d035f48b7f68e2d360fa24`（基底 `60203ef`）。
- 定向測試 5/5（平行 append、型別／公式身分、未核准分頁、識別欄缺漏、清空、4xx／未知／找不到、表頭改變、MCP 層訊息）。`npm run build:ui` 後完整 `npm test`：初版 1738/1738，修正版 **1739/1739 通過**（`full-tests.log`、`full-tests-r2.log`）。
- 真正 agy＋Gemini 3.8 Flash high、workspace-write，經 `createGeminiController` 與 `gemini-mcp.json` 綁定。試算表改用假 CLI（`fake-cli/`，同 `meta`／`get`／`cells`／`batch` 介面、原始值儲存，不連 Google），工作區為營運資料庫 AGENTS、README 與新規則的副本（試算表 ID 換成假 ID）。初版（`r1/`）與修正版各跑一次，結果相同：
  - 只送本人原句「10/17 300+300+500 都是現金 存入」：Flash 自行讀規則、metadata、表頭與近期資料，三次 append 寫入第 5–7 列 `PERF-20261017-001～003`，欄位與 10-15 正式前例一致，金額為數字，三筆 `verified=true`，並在 `audit/` 留收據。修正版經 `--write` JSON 參數接線，agy 啟動 MCP 時參數完整傳遞。
  - 接著問「10/15 到 10/17 總共賺多少」：只讀日期、visit_status、amount、paid_status 四欄，答 6 筆 2,400 元，正確。
  - 過程中失敗步驟：猜讀不存在的 MCP instructions.md 與舊收據、初版一次被 deny 的列目錄命令與一次假 CLI 不支援的 `A:A`；皆不影響結果，也沒有繞過拒絕。
- 未做真實 Google 寫入；正式 10/17 三筆保留到部署後由 Flash 登錄。

## GPT-6.1 Sol 覆核與取捨

K 工單 `sheets-write-row-review-20261017`（gpt-6.1-sol high，唯讀，覆核 `36c6711`）。原文在營運工作區 `.runtime/luna-bridge/…/sheets-write-row-review-20261017.output.md`。

- 必修 1 併發覆寫（兩次 append 選同一列且都回報成功）：採納。改用 `appendCells` 讓 Google 決定列位置，寫後以識別碼找回；update 寫後重讀識別碼與表頭。未加跨程序鎖：唯一剩下的競態是兩個寫入者同時用同一新識別碼，會被寫後「找到 2 列」偵測為結果未知。
- 必修 2 模型可換識別欄：採納。識別欄改由本人接線 `--write` 指定，順帶限制可寫分頁（Sol 建議 8）。
- 必修 3 清理失敗誤報「未修改表格」：採納，清理錯誤獨立吞掉。
- 必修 4 `UNFORMATTED_VALUE` 無法驗收原始型別：採納，身分與驗收改讀 `userEnteredValue`；append 不再需要空白列檢查。
- 必修 5 新流程與正式 StoreOps 規則（要求經 Python guard）不一致：同意不能宣稱等價取代 guard。K 端只負責位置、身分與讀回；營運規則檔已寫明保障與限制（可用值、型別、編號由 AI 負責）。本人同意後，已在正式規則 `04_業績_StoreOps/docs/STOREOPS_RULES_CURRENT.md` 第 0 節入庫流程與第 7 節第 10 項加註，新增第 13 項寫明此路徑的範圍、工具負責與不負責的檢查、與 guard 的差異及收據要求；該 repo 規定不得自動 commit，變更留在工作樹未提交。
- 建議 6 去重與編號應查完整日期、同句多筆不互相去重：採納，已改營運規則。
- 建議 9 收入查詢欄位字母改依表頭：採納，已改營運規則。
- 可忽略 7（無命令或公式注入入口）：確認。

修正版在交接時未再送 Sol 複審；本次 Codex 主代理部署前已獨立檢查 `f92a548` diff，確認必修 1–4 的修正與測試對應。本批程式由 Opus 5.5 撰寫，不適用「Sol 程式須 Opus 審」規則；部署未新增產品程式修改。

## 部署交接（給 Codex 主聊天室 GPT-6.1 Sol）

依 AGENTS 第二節發布流程；K 內 AI 不能更新自己所在的 K。

1. 核對本機 `main` 與其他聊天室最新已驗收批次；本分支 `feat/sheets-write-row-20261017` 基底 `60203ef`。若 main 已前進，rebase 後重跑 `npm test`。看一次 `f92a548` diff，確認覆核必修 1–4 已處理。
2. 合回 main（程式與本文件分開 commit），記錄完整 SHA。
3. 確認正式 K 閒置後完全停止，在 K 外以 `Update-K.ps1` 指定完整 SHA 更新；失敗保留原錯誤、不重試。
4. 合併正式私有 `vault/private-state/.runtime/gemini-mcp.json` 的營運工作區項目，保留其他內容：
   - `k_sheets.args` 尾端加 `"--write", "{\"<已核准試算表ID>\":{\"日業績\":\"record_id\"}}"`；
   - `allowWrite` 設為 `["mcp(k_sheets/sheets_write_row)"]`。
   讀回確認路徑仍指向正式 runtime 接頭與既有 CLI、試算表白名單未變。
5. 重開 K 後，health 200／native；在營運工作區新開 Gemini 3.8 Flash（workspace-write）聊天室，只確認 `sheets_write_row` 出現在工具清單、描述含「日業績（識別欄 record_id）」；read-only 聊天室不得放行寫入。**不要**由部署者寫正式表。
6. push 並讀回遠端 SHA；更新本文件「部署狀態」與 `development-log.md` 目前狀態。
7. 正式 10/17 三筆由本人在 Flash 聊天室交代；登錄前 Flash 依規則讀回該日紀錄，任何部分結果未知先核對，不重播整句口述。

## 部署狀態

### 2026-10-17 本機部署與讀回

- 原 `main` 已前進至 `f15af38d063b82df46b1d92b72fcf122c2e07039`（新增文件，沒有其他待合程式批次）；分支依交接 rebase 後完整 `npm test` **1739/1739 通過**，0 失敗／取消／略過，71.1 秒。`f92a548` 的接頭內容與 rebase 後完全相同。
- 已 fast-forward 合回 `main`。固定程式版本 **`a81475f345319c22413cb30040db90925fe65c1b`**（原 `f92a548` 重新套用後的 SHA）；程式與文件仍分開提交。公開文件範例改用 `<已核准試算表ID>`，也從待發布的文件提交歷史移除實際識別碼；私人設定沿用既有值。
- 更新前確認 47831 拒絕連線、正式 K／原生程序不在執行、啟動器沒有占用。在 K 外執行一次 `Update-K.ps1 -Ref a81475f345319c22413cb30040db90925fe65c1b`；介面／擴充／啟動器建置成功，更新器完整 **1739/1739 通過**，0 失敗／取消／略過，71.0 秒，正常套用、exit 0，未重試。沒有前端程式差異，未另重跑 `test:ui`。
- 15:32 讀回 `.local/runtime.json` 為上述 SHA，退版 **`releases/before-1792222347302`**，最新三份程式退版保留；本批兩個變更檔與固定 Git 版本按 checkout filter 比對完全相同。Node／語音設定未變，帳號 home、vault、workspace、browser-output 留在原處。程式退版不代表對話備份。
- 正式私有 `vault/private-state/.runtime/gemini-mcp.json` 已備存原檔後合併：只為原營運工作區的既有試算表加 `日業績: record_id` 寫入映射及 `mcp(k_sheets/sheets_write_row)` 許可。接頭仍指向正式 runtime、CLI 與試算表白名單未變；移除本次兩項差異後，整份設定與原檔完全相同。
- 正常啟動 K 一次，正式 `/health` **HTTP 200、deployment=native**。15:33 透過正式已部署 `createGeminiController` 在營運工作區新開真正 **Gemini 3.8 Flash high／workspace-write** 聊天室：原生載入的 `sheets_write_row.json` 確有工具名稱與「日業績」（識別欄 `record_id`）描述；唯一工具事件是成功的 `view_file`，只讀該定義，沒有呼叫任何試算表 MCP。
- 另開 **read-only** 聊天室，讀回原生 `settings.json`：沒有 writer／`k_sheets/*`／全部 MCP 的 allow，保留寫檔與命令 deny。這是正式權限設定讀回，**未呼叫 writer 測試原生拒絕**，不宣稱做過真實拒絕測試。兩個新聊天室均保留。
- **正式試算表零呼叫、零寫入**，沒有讀資料列或重播口述。10/17 三筆仍留給本人在 Flash 聊天室交代，登錄前須依工作區規則查核既有結果。
- 本批部署與讀回證據在原工作樹 `.runtime/archive/sheets-write-20261017/deploy-*`，包含完整測試、更新器原始紀錄、原設定、runtime／設定／health／原生定義與工具事件；不提交 Git。其他電腦未更新。
- 已檢查全部待發布提交的新增內容與秘密模式；首次 GitHub push 成功，`git ls-remote origin refs/heads/main` 讀回 **`90a0846c2b802f16f8ec6887297288e611821978`**，與本機完全相同。後續僅本節與工程索引收尾，仍會 push 並把最終遠端 SHA 存入本機 `deploy-remote-final.json`；不重啟 K，正式程式版本維持 `a81475f345319c22413cb30040db90925fe65c1b`。
