# K HARNESS

以 Pi 為執行基底的通用工作 harness。

## 目前狀態

2026-09-15 專案管理補齊：工作區右側改為搜尋／檢視／新增／封存四個圖示，專案「⋯」支援顯示名稱、釘選與可還原封存。35 項相關測試與隔離瀏覽器操作驗收通過，正式封存聊天入口讀回成功。詳見[專案管理驗收](docs/project-menu-20260915.md)。

2026-09-15 側欄更新：依 DSH 操作方式改為明確的「新對話」、工作區搜尋／檢視選項／新增入口；封存用獨立清單視窗，可開啟或移回清單。新增工作區接 Windows 原生資料夾視窗。相關 49 項回歸、隔離介面操作驗收及真實封存清單讀回通過；原生視窗前景顯示與取消已實測。詳見[側欄與資料夾選擇驗收](docs/sidebar-navigation-20260915.md)。

2026-09-15 權限選單更新：參考 Codex 的「要求核准／代我核准／完整存取權」，進階保留唯讀，舊對話不自動升權。Luna 低推理已在兩個限定測試對話驗證原生自動審查、完整存取寫檔，以及切回要求核准；原生執行紀錄與檔案均已讀回。完整回歸 135／135 通過。詳見[權限選單與真實測試](docs/desktop-permissions-20260915.md)。

2026-09-15 最新：桌面主代理已能直接讀檔、修改程式、執行命令與交付檔案，不需要強制派工。新增「工作區可修改／唯讀」及原生命令、檔案、額外權限核准；修復停止回合後背景命令仍繼續執行的問題。Terra 真實直接讀改測、檔案單次核准／拒絕、重開成果、停止程序均通過；完整回歸 106／106。沿用 Codex 訂閱，沒有修改全域權限或計費。詳見[主代理直接工作驗收與限制](docs/main-direct-work-20260915.md)。尚不能因此宣稱全部 Codex App 功能、Blender 或所有長程工作都已驗證。

2026-09-14 模型選單階段：主代理選單改讀 Codex 實際可用模型，主代理、推理程度與預設子代理可分開選擇；一般子代理預設 Flash，圖像子代理依設定使用 Luna。Terra → Luna 實際看圖與重開讀回通過；當時回歸 95／95。另補淺色／暖色／深色與 14～22px 逐級字體選項。當時的主代理唯讀限制已由上方 9/15 桌面更新處理。詳見[模型選擇、派工驗證與限制](docs/model-routing-20260914.md)。以下為各階段歷史紀錄。

2026-09-14 後續：已加入 Codex 訂閱剩餘額度、Flash 本對話 Token、暖白／米灰配色、K 內建縮放及字體大小、正體中文用語補齊、工作區選擇與對話所屬資料夾保存。80／80 回歸通過，真實額度、舊對話 Token、工作區主控／Flash 接線與畫面操作已驗收。仍非獨立 EXE；詳見[用量、外觀與工作區](docs/desktop-usage-workspaces-20260914.md)。以下保留前階段紀錄。

2026-09-14 桌面介面已改用真正的 assistant-ui／React 聊天元件，接回既有 K 主控：附件上傳與閱讀、Markdown 表格／程式碼、成果預覽與下載、對話搜尋／命名／釘選／可恢復封存、原對話接續、核准及停止均已接線。Astra 實際從畫面讀取 TXT、PDF、DOCX、圖片；Sol 的原生核准卡片、拒絕後不重試，以及修正後的停止按鈕已實測。68／68 回歸通過；這是可使用的限定非臨床桌面工作介面，不是所有 Codex App 功能或長程工作皆已驗證。詳見[本輪介面交付與驗收](docs/desktop-workflow-20260914.md)。

桌面既有「K HARNESS」捷徑仍指向 `Start-K-Desktop.ps1`，會使用已建置的新前端。後端啟動、原對話重開、重複啟動沿用同一程序已實測；捷徑本身自動開窗仍受先前工具政策限制，未把它說成已點擊驗收。前端入口為本機 `http://127.0.0.1:47831/`。以下段落保留各階段歷史結果，不代表現在的最新功能清單。

新增 `Start-K.ps1 -List`：不用啟動模型即可找回已保存的 K 對話。對話 ID 提早落盤；重開或 `/workers` 可查看原工作指定輸出是否存在。跨程序強制終止測試確認成果保留、狀態未確認、不自動重派；詳見[重開與殘留成果查詢](docs/main-reopen-validation-20260914.md)。這次為模擬模型搭配實際程序中斷，並非整組真實主代理／Flash 崩潰驗證。

新增主控中止與恢復狀態檢查：工作中 Ctrl+C 不再直接離開 K，會中止主回合、確認本對話工人並回到輸入畫面；重開與 `/workers` 可直接查原工人，不耗模型回合或重派。真實 Astra 中止、跨程序 Pi 模擬工人取消保留成果分別通過，完整回歸 56／56；證據與未驗證組合見[中止與狀態回復](docs/main-stop-validation-20260914.md)。

最新：K 自己的 Astra／Sol 主控已各完成一次「判錯 → 派 Flash 修正 → 獨立讀回驗收」，沿用 ChatGPT 訂閱登入；新增 `Start-K.ps1` 終端對話入口、逐次核准及既有對話續聊，Astra 重開短對話已實測。完整回歸 52／52 通過。這不是圖形 App 或所有長程工作已驗證，詳見[主代理接入與驗收](docs/main-host-validation-20260914.md)。下方保留各階段歷史結果。

2026-09-14：已實作 Pi 工人、派工核心及官方 SDK 的 stdio MCP 接口；直接工人、派工、跨程序 MCP 三個入口各完成人工非敏感資料的 DeepSeek live 測試。Pi 0.85.1 與 MCP SDK 2.0.0 已安裝並鎖定。最新回歸與歷史檢索實測見下方紀錄。

離線測試使用腳本式模擬模型；live 測試則確實呼叫 DeepSeek API，由 Flash 讀取輸入、整理資料並建立正確輸出。MCP 已提供開始、查詢、事件等待、取消及結果回收。專案限定設定與使用者授權的 K 信任登記均已完成；新建於 K 原始工作目錄的 Astra App 任務已實際呼叫原生 MCP 工具，完成一次人工資料派工與獨立驗收。Sol、長任務續作及效果比較尚未驗證；這不是完整 K HARNESS 的完成宣告。

後續已完成兩件真實文件工作的 App／Flash 測試及一件 Luna 同題初稿對照：Flash 讀寫均成功，但兩份原稿均有實質錯漏，僅適合作為需驗收的草稿。目前不全面替換 Luna，未證明同品質端到端更快或訂閱節省；詳見 [實用性初判](docs/practical-assessment-20260914.md)。

再經一次合併的 Flash 定向修訂與原主代理三處表述收尾，[現況交接](docs/current-handoff.md)及[操作指南](docs/operator-guide.md)已通過本輪文件驗收；舊稿保留。修訂工人約 66 秒，派工至最終驗收約 237 秒，不含事前回饋整理或兩輪間的使用者等待。這不是 Flash 一次全對或速度勝出的證明；詳見[修訂驗收](.runtime/practical-tests/revision-20260914-061930/acceptance.md)。

專案位置：`D:\K-harness`。與既有 `D:\KAI`、DSH 工作環境及 CaseAgent 分開，不沿用它們的執行狀態。依使用者另行授權，既有全域 DeepSeek 金鑰已單獨複製到本專案 `.env.local`；沒有搬移原檔或其他帳號憑證。

新增選擇性程式工人能力：指定程式檔的唯一原文片段替換、修改前備份，以及固定 Node 測試。Flash 最新人工修復案例約 8.76 秒完成，重現 4 個失敗後修到 4／4 通過，主代理另外重跑並檢查額外案例（共 5 項測試）通過；沒有工具錯誤或主代理代改成果。此 live 證據來自直接工人入口，不等於 OS 沙箱、通用程式工作驗收或速度比較勝出。詳見[限定程式工人](docs/coding-worker.md)。

後續已把 `coding` 接到 dispatcher 與 MCP 0.2.0，跨程序離線修復／測試／取消驗證通過。但既有 App 任務仍載入舊 schema，尚看不到 `coding`；此次沒有送出 App 修程式任務，也沒有用其他入口冒充 App 驗證。需在 App 重新啟動 `k_flash` 後再驗證，詳見[App 接線狀態](docs/app-coding-integration-20260914.md)。全域及專案設定本輪未修改。

再續作已實際跑通「主代理發出請求 → 官方 MCP client → K 派工 → Pi／DeepSeek 修復 → 主代理驗收」：啟動與事件等待各一次，工人約 7.66 秒、5 次工具呼叫、0 錯誤，指定測試從 4 個失敗修到 4／4，另行準備的 5 項驗收測試全過。這證明 K 的限定工作流程能運作，不依賴先處理 App 介面；它仍不是 App 原生呼叫、獨立 K 主模型接入或所有通用任務穩定性的證據。詳見[工作流判定](docs/workflow-verdict-20260914.md)。

新增中斷接手驗證：真實 DeepSeek 工人寫完 checkpoint 後程序中斷，該檔存在但成功工具結果尚未保存。主代理以新增 `recover` 唯讀入口檢查並驗收成果，再給新工人唯讀 checkpoint 與最新需求，只完成剩餘兩檔，結果通過。這是受控新工人交接，不是自動 session 恢復或長上下文壓縮證明；詳見[中斷接續驗收](docs/recovery-validation-20260914.md)。

新增按需歷史查詢：主代理以 `historyIds` 授權同工作區的舊工人紀錄，新工人可查文字、來源與時間，不預先載入全部歷史。全新 Flash 工人從兩份真實工作紀錄找回最新明確更新、隨機標記、重複資料與原始要求，約 14.7 秒完成自動驗收；仍需人工核對語意，不代表長任務或節費已全面驗證。詳見[歷史檢索驗收](docs/history-validation-20260914.md)。

最新混合流程已通過「修程式 → 初稿 → 新程序／新需求 → 查歷史 → 擴充程式與最終文件」。程式與數字正確，文件出現兩處來源／截斷敘述錯誤，交由 Flash 修訂後經主代理接受。這是需要驗收的限定工作能力，不是免監督或長程全面可靠；詳見[混合工作流驗收](docs/mixed-workflow-validation-20260914.md)。

## 目標

- 通用非臨床工作：相對較省、端到端完成時間不增加、完成度相同、記憶能力至少同等。
- Astra／Sol 負責理解、策略、複雜判斷、整合與驗收；DeepSeek Flash 承擔適合委派的執行工作。
- 保留 Astra／Sol 訂閱額度處理高價值工作；DeepSeek 另行計費，不將訂閱額度視為 API 餘額。
- 不強制每項工作都派工；比較總完成時間、主代理額度消耗、工人費用與返工，而非只比較輸出速度。

## 已確定的方向

- 以 Pi 官方 SDK 元件建立工人執行層，優先透過公開介面擴充，不先維護整套上游 fork。
- 聊天外殼視為可替換元件，可沿用授權合適的成品；不把圖形介面作為核心選型的決勝因素。
- 主對話只能有一個執行與上下文管理的權威來源；工人保有各自的工作紀錄。
- DSH 僅作設計參考，不是新專案的必須依賴。既有 DSH 工作環境保持不變。
- 不納入已否決的 KAI L0／L1／L2 記憶架構。

## 已實作的工人能力

- 接收明確的任務、工作目錄、可讀檔案與可建立的輸出檔案。
- 預設只啟用 `read_input`／`write_output`，不暴露命令執行、目錄瀏覽、刪除或覆寫工具。沒有檔案授權時不提供對應工具。主程式明確傳入 `coding` 才新增 `replace_code`／`run_tests`；新版 MCP 可傳入逐任務權限，既有 App 須先重新載入新版工具。
- 只處理 UTF-8 文字；單一輸入／輸出上限 256 KiB。輸出父目錄須已存在；既有輸出一律拒絕，不先刪除重建。
- 任務開始時先保存 `job.json`；Pi 原始對話另外保存在同一任務目錄的 `sessions/`，不再複製成另一套對話歷史。
- 支援 `AbortSignal` 與命令列 Ctrl+C 中止；已建立的輸出保留，不宣稱已回復或撤銷。
- 區分 `completed`、`cancelled`、`failed`；對磁碟上未寫入終態的任務，查詢回傳 `unresolved`，不自動重新派工。
- `completed` 僅表示模型正常結束並給出非空最後回答，不代表成果驗收通過。所有工人結果保留 `acceptance: "not-reviewed"`，由主代理另行驗收。
- 不載入使用者／工作區的 Pi 外掛、技能、提示模板或 AGENTS 文件，也不讀取 Pi 登入檔。必要工作規則需由派工者明確帶入任務。
- 獨立命令列狀態查詢不載入 Pi 執行核心。MCP 程序啟動時會建立 Pi runtime，但列出工具與查詢不呼叫付費模型。

## 尚待完成或驗證的部分

- Astra／Sol 的接入：目前候選是 Codex 原生主控搭配 Pi 工人；尚未定為不可更換的核心契約。
- 跨程序 MCP 與 Astra App 原生派工已驗證，Sol 尚未驗證。SDK 只安裝在 K；全域設定只依使用者後續授權新增 K 的信任登記，沒有更動其他設定或建立常駐服務。App 驗證另依使用者授權新建一個 Astra 任務。
- 工人的工具與資料權限。Pi 的專案信任設定不是沙箱；外部工人不會自動繼承主代理的限制。
- 原始 Pi 對話已驗證可重新載入；尚未實作續跑指令或驗證模型在壓縮與重啟後的記憶表現。原型關閉自動壓縮與自動重試，超出上下文或發生錯誤時回報失敗，不暗中改用其他模型。
- 真實任務的速度、費用、完成度與記憶對照。舊 KAI 測試與小型 Flash 原型不作為本專案的完成證據。

## 技術起點

- Node.js：`>=22.19.0`，依 Pi 0.85.1 的套件要求宣告；沒有變更本機環境。
- Pi SDK：`@earendil-works/pi-coding-agent` 與直接使用的 `@earendil-works/pi-ai`，均精確指定 `0.85.1`。
- 官方 MCP SDK 採當前穩定的模組化 2.0.0：執行依賴 `@modelcontextprotocol/server@2.0.0`、`zod@4.6.5`；測試依賴 `@modelcontextprotocol/client@2.0.0`。這是官方 v2 套件名稱，不是自行重寫協定。
- 依賴已安裝，完整解析版本記錄於 `package-lock.json`。安裝停用套件 lifecycle scripts；npm 快取限於專案 `.local/npm-cache`，未升級 Node.js／npm 或安裝全域套件。
- 不將真實 API key、登入憑證、執行紀錄或使用者工作資料納入版本控制。

## 操作

在 `D:\K-harness` 開啟終端：

```powershell
npm test
npm run worker -- demo
npm run worker -- inspect .runtime/jobs/<任務目錄名稱>
npm run worker -- recover .runtime/jobs/<任務目錄名稱>
npm run worker -- models
```

- `demo` 使用離線腳本式模型，在 `.runtime/demos/` 的新目錄建立輸入與輸出，不呼叫 API。
- `inspect` 只讀回任務結果。`unresolved` 可能是仍在執行，也可能是程序中斷；不能只憑持久化狀態判定，更不能自動重播。
- `models` 只列出固定版本 Pi 內附的 DeepSeek 模型目錄，不代表帳號可用性或供應商即時模型清單。
- `npm test` 的測試資料保留在 `.runtime/tests/`，不自動刪除。該目錄不納入 Git。

真正的 DeepSeek 請求需具備相應 live 授權。使用者已授權將金鑰保存在本專案 `.env.local`，並確認寫入值與來源一致、Git 排除生效；原全域秘密檔保留。一般 worker 不自動搜尋憑證檔，使用 Node 的明確載入參數將本專案金鑰提供給程序；不在命令參數填入金鑰明文。

```powershell
# 執行指定的實際任務；範例要求輸出尚不存在。
node --env-file=.env.local src/cli.mjs run examples/request.json --live

# 單一人工資料測試：最多 6 次官方 API 請求、90 秒，另行產生新測試目錄。
node scripts/live-smoke.mjs --live --key-file .env.local

# 同一人工資料測試改走新派工核心，驗證開始、重複編號、等待與取回。
node scripts/live-smoke.mjs --live --dispatch --key-file .env.local

# 官方 MCP client 啟動實際 stdio server，再派一個人工資料任務。
node scripts/mcp-smoke.mjs --live
```

範例請求位於 [examples/request.json](examples/request.json)。必須指定精確模型 ID；worker 未傳入 `--live` 時，在讀取請求檔或建立模型執行環境前即拒絕執行。注意 `node --env-file` 會在程式開始前載入明確指定的檔案；這不等於 worker 已呼叫 API。模型不存在時直接報錯，不由 K 自行替換別名或 fallback。

DeepSeek 官方已說明：`deepseek-v4-flash`／`deepseek-v4-flash-vision-exp` 舊名稱目前也由 DeepSeek V4.1 Flash 服務；本次 API 實際回傳 `deepseek-flash`。本專案尚未更新 Pi 內附模型目錄，因此紀錄必須區分請求名稱與供應商回傳名稱，不把舊名稱當成固定舊模型版本，也不使用舊目錄價目宣稱實際費用。[官方說明](https://api-docs.deepseek.com/)

## 初版工人驗證

- 14／14 項離線測試通過：工具讀寫、原文不變、結果與原始對話回讀、越界／未授權工具／既有輸出拒絕、中止、不重試、外掛不自動載入，以及兩種實際程序中斷。
- 程序中斷分別發生在第一個模型回答前，以及寫出檔案之後；兩者均保留任務紀錄，查詢不重播。後者保留已寫出的檔案及對話中的工具結果。
- 命令列示範完成 3 次腳本式模型回應、2 次檔案工具呼叫，輸出內容與原文獨立讀回一致。
- 示範紀錄：`.runtime/jobs/job-VZFmSy/job.json`；示範輸出：`.runtime/demos/demo-hybpt1/output.txt`。這些是本次執行的本機證據，不是跨機器必備檔案。
- 上述 14 項測試與 demo 均為腳本式模擬；付費 API 驗證另見下一節。尚未證明速度、額度節省或任務品質勝出。

## DeepSeek live 驗證（2026-09-14）

- 任務：讀取四列人工資料，保留重複數值與未知欄位，計算總數、分類合計及狀態清單，再建立 JSON 輸出。模型需從輸入檔讀出隨機 marker，不能只根據任務提示猜答案。
- 請求名稱 `deepseek-v4-flash`；API 回傳名稱 `deepseek-flash`；Pi 實際採用的思考等級為 `high`，本輪未另外覆寫。
- 3 次 HTTP 請求均為 200；3 次模型回應、2 次工具呼叫、0 次工具錯誤。沒有自動重試或改用其他供應商。
- 工人執行時間 3,977 ms；從 Node 程序啟動至報告整理約 6,632 ms。兩者量測範圍不同，不當成一般任務的保證速度。
- 供應商回報：prompt 2,879 tokens，其中 cache hit 1,664、cache miss 1,215；completion 454 tokens。沒有把快取讀取算成新增輸入，也沒有以 Pi 舊價目計算費用或訂閱額度節省。
- 8 項檢查全數通過，主代理另以不同讀回程式重新確認輸出、合計、順序與未知欄位。輸入保持不變，金鑰未出現在工人紀錄中。
- 測試報告：`.runtime/live-tests/smoke-yD3bFK/report.json`；結果：`.runtime/live-tests/smoke-yD3bFK/workspace/result.json`；Pi 工人紀錄：`.runtime/jobs/job-otemkK/job.json`。
- 工人紀錄保留產生當時的 `acceptance: "not-reviewed"`；本次具體測試的獨立驗收在 `report.json` 的 `accepted: true`，沒有將單一驗收擴張成通用任務已合格。

## 程式入口

- `src/worker.mjs`：單次工人生命週期、狀態保存、結果與對話查詢。
- `src/dispatcher.mjs`：單一受信任主控程序的派工、事件等待、取消與讀回；不是 MCP 伺服器或常駐服務。
- `src/mcp.mjs`：六個 MCP 工具及簡短交接結果；普通串行工作可用 `k_worker_run` 一次啟動並等待，長程／並行工作保留 start／wait，恢復證據由 `k_worker_recover` 只讀提供；不反覆傳回整份任務提示或 Pi 對話。
- `src/mcp-stdio.mjs`、`src/mcp-transport.mjs`：明確 live／固定工作區／模型／憑證路徑啟動；stdio 斷線時取消工人並保存結果，不開網路監聽埠。
- `src/files.mjs`：明確檔案清單的讀取／新檔輸出工具。
- `src/runtime.mjs`：不讀取使用者 Pi 設定的模型執行環境；DeepSeek 明確模型與程序金鑰接入。
- `src/cli.mjs`：命令列操作與中止。
- `src/demo.mjs`：離線示範；不是實際模型或效能 benchmark。
- `test/worker.test.mjs`：整合與邊界測試，使用真實 Pi SDK。
- `test/dispatcher.test.mjs`：8 項派工整合測試。
- `test/mcp.test.mjs`、`test/fixtures/mcp-worker.mjs`：4 項真實子程序 stdio 整合測試，模型仍為離線腳本；全套合計 26 項。
- `scripts/live-smoke.mjs`：明確 live 開關、人工資料、API 回傳模型與用量紀錄、輸出驗收。每次執行建立新資料夾，不自動重送既有任務。
- `scripts/setup-deepseek-env.mjs`：使用者授權後，將明確指定來源的 DeepSeek 金鑰存入本專案 `.env.local`；不同既有值不覆蓋，相同值保持不變，僅回報非秘密狀態。
- `scripts/mcp-smoke.mjs`：真正 MCP／Pi／DeepSeek 跨程序驗證，人工資料、90 秒期限、結果獨立驗收；不自動重試。
- `scripts/check-codex-config.mjs <Codex 執行檔絕對路徑>`：呼叫原生 `config/read`，只列出 K 工具是否生效及設定層停用原因；不建立對話或寫設定。
- `.codex/config.toml`：K 專案限定的 `k_flash` 接入設定，無金鑰明文、無全域模型覆寫。

## 派工核心介面與驗證（2026-09-14）

`createDispatcher({ workspace, modelRuntime, model, stateDir? })` 綁定一個明確工作目錄與模型；不自行讀取金鑰或選擇其他模型。主控需在程序存活期間保留此物件：

- `start({ requestId, task, readFiles?, outputFiles?, thinkingLevel?, coding? })`：保存任務後立即回傳，不等模型完成。`requestId` 由主控產生，限 1–128 個英數字、底線或連字號；可使用 UUID。同一編號、相同請求（包含 coding 權限）回讀既有工作，不同請求拒絕，不以重送建立新工作。
- `inspect(requestId)`：讀回已知結果；只有持有該次執行的程序能判定仍在 `running`。其他程序讀到非終態時保持 `unresolved`，不冒充已接管。
- `wait(requestId, { timeoutMs?, signal? })`：預設最多等待 60 秒，由完成事件喚醒；逾時僅回傳 `timedOut`。取消等待不等於取消工人，不定時輪詢或重新派工。
- `cancel(requestId)`：向本程序持有的工人請求取消，回傳 `cancelRequested`；須再等待終態。已寫出的檔案不刪除、不宣稱回復。不能取消另一程序持有的工作。
- `close()`：停止接受新工作，取消並等待本程序持有的工人收尾；查詢既有結果仍可用。

任務使用既有 `job.json`／Pi 原始對話保存，不新增另一套派工帳本。新編號以獨占建立任務目錄避免碰撞；若目錄已保留但紀錄不可讀，回報未知、不重播。讀回不是續跑；也不能阻止主控以不同新編號錯誤重派同一工作，因此未知結果必須先人工／主代理查明。

API key 不得放入 task 或檔案授權；工具現在也直接拒絕本專案 `.env.local` 作為輸入／輸出。這項路徑拒絕不是 OS 沙箱，並不代表能識別所有秘密或抵禦外部程序的檔案競態。

驗證結果：

- 22／22 項離線測試通過：既有 14 項加上 8 項派工測試，涵蓋同時重送、完成喚醒、等待逾時／取消、取消後保留產物、新主控讀回、未知工作不接管、不重試及金鑰路徑拒絕。
- 派工 live 任務編號：`smoke-142436a6-e8d9-410c-a5de-1a96e11e8d34`。入口回報 `running`，27 ms 取得已保存的任務編號；這個時間不含 Pi SDK 與 runtime 的初始化。
- 一次事件等待收到終態；相同請求在執行中與完成後重送，均取回原任務。總共仍只有 3 次 HTTP 200、3 次模型回應、2 次工具呼叫、0 次工具錯誤。
- 供應商回傳 `deepseek-flash`；Pi 思考等級 `high`。派工及工人至結果讀回 4,185 ms，整個 Node 程序約 7,273 ms。僅是這個人工任務的觀測，沒有推論比 Luna 更快或更省。
- prompt 2,920 tokens，其中 cache hit 1,664、cache miss 1,256；completion 494 tokens。未使用舊模型價目估費，也未估計主代理訂閱額度。
- 11 項 live 檢查通過；主代理另以 PowerShell 從原始輸入重新計算並核對結果。報告：`.runtime/live-tests/smoke-4RmHt9/report.json`；輸出：同目錄 `workspace/result.json`；任務紀錄：`.runtime/jobs/smoke-142436a6-e8d9-410c-a5de-1a96e11e8d34/job.json`。

## MCP 接入驗證（2026-09-14）

以下保留初版 MCP 驗證紀錄；新版選擇性程式權限另見[App 接線狀態](docs/app-coding-integration-20260914.md)。四個工具：`k_worker_start`、`k_worker_wait`、`k_worker_inspect`、`k_worker_cancel`。模型與工作目錄由啟動設定固定；工具呼叫不能改工作區、供應商、金鑰或增加 shell 能力。初版派工只有明確檔案白名單，沿用不覆寫、不刪除、不讀 `.env.local` 的限制。

- 26／26 離線測試通過。新測試使用官方 MCP client 和真實子程序，驗證工具發現、schema／工作區邊界、派工結果、同編號不重播、等待取消與工人取消區分，以及關閉連線後保存取消狀態與既有輸出。
- 真實 MCP 測試：3 次 Pi 模型回應、2 次檔案工具呼叫、0 次工具錯誤；10 項驗收全部通過。主代理另從原始輸入重新計算結果並讀回，非只採信模型交接文字。
- 報告：`.runtime/live-tests/mcp-3MKzw3/report.json`；輸出：同目錄 `result.json`；Pi 任務：`.runtime/jobs/mcp-971f5b57-57ec-44da-bdea-bf5ce45535d2/job.json`。
- 整個測試程序約 9,567 ms，包含 SDK／子程序初始化、MCP 工具發現、派工、讀回與關閉。任務與之前測試不同，不能直接當作速度退步／進步或 Luna 對照。
- 此 MCP 測試沒有擷取原始 HTTP 回應模型名稱、HTTP 請求總數或實際帳單；`deepseek-v4-flash` 是請求別名，不以它宣稱固定供應商實體版本。無成本／訂閱節省結論。

Codex 設定讀回：

- `.codex/config.toml` 是新建檔，TOML 解析通過。只包含 `k_flash`；工具等候 60 秒、外層工具期限 75 秒，避免等待工具先被 60 秒的預設期限切斷。
- 初次原生 `config/read` 回報 `kFlashInEffectiveConfig: false`，專案設定層因尚未信任而停用；初次 `codex mcp get k_flash --json` 因此找不到伺服器。
- MCP 建置當輪未修改全域設定，當時 SHA-256 為 `1FD8C149097BF84B51E20727669F00B847C0891E5D48748F3510545990B18BBF`。後續使用者明確授權信任 K，才新增 `[projects.'d:\k-harness']` 與 `trust_level = "trusted"`。
- 變更前備份：`C:\Users\Paulus\.codex\config.toml.k-trust-20260914-133632-db3f4045.bak`。備份與原檔雜湊一致；修改後 TOML 解析通過，結構比較確認只有 K 信任項目新增，位元組比較確認其餘原文完全不變。
- 修改後原生 `config/read` 回報 `kFlashInEffectiveConfig: true`，K 專案層的 `disabledReason: null`；`codex mcp get k_flash --json` 回報 `enabled: true`，四個工具與原專案限定啟動參數一致。本次未呼叫付費模型，也未新增其他對話。
- 獨立 MCP 測試成功不等於 Codex App 已連線。此對話仍位於 `D:\KAI`；K 的專案限定設定不會套用到 KAI。
- 信任登記允許 Codex 載入 K 的專案設定與相關本地規則；不代表把 MCP 搬到全域或變更其他專案、主模型與權限模式。

## Astra App 原生派工驗證（2026-09-14）

- 使用者授權新建的 App 任務：`01a09e77-5916-76c3-b880-ed1c541917f7`，標題「驗證 Astra 在 App 派工給 Flash」；實際工作目錄為 `D:\K-harness` 原始專案。主模型指定 Astra，未另行覆寫思考等級。
- App 原始任務紀錄確認呼叫 `k_flash` 的 `k_worker_start`、`k_worker_wait`、`k_worker_inspect` 各一次，全部使用同一編號 `app-dcecf403-0b64-4b34-9244-cd03e2e1239d`。不是獨立測試 client 或命令列代跑。
- Flash 讀取三列人工資料並建立 JSON；合計 43、隨機 marker、原順序 IDs、重複值與未知 owner 均正確。新任務內 Astra 驗收後，原主代理另從實際輸入、輸出及 Pi 原始工具紀錄重算核對；只使用授權的讀取／建立工具，兩次工具呼叫、零工具錯誤，未重派。
- 工人從保存開始至終態為 3,459 ms；App 任務回報從 start 呼叫至 wait 回傳為 7,304 ms，包含主代理兩次呼叫間隔，不含準備與驗收。原主代理已核對工人時間，未另行重測 App 端時間；這兩個數字均不是整件任務的端到端耗時。
- 請求別名 `deepseek-v4-flash`；三次 Pi 模型回應記錄的 `responseModel` 均為 `deepseek-flash`。未獨立擷取原始 HTTP 次數、實體模型版本或帳單；不使用 Pi 目錄估價宣稱訂閱或費用節省。
- 報告：[report.json](.runtime/app-tests/app-dcecf403-0b64-4b34-9244-cd03e2e1239d/report.json)；輸入／輸出位於同一目錄；工人紀錄：[job.json](.runtime/jobs/app-dcecf403-0b64-4b34-9244-cd03e2e1239d/job.json)。工人原始 `acceptance: "not-reviewed"` 保留，個別驗收記在測試報告，不改寫原始工人狀態。
- 本輪沒有修改源碼、安裝套件或更動設定；原主代理讀回確認全域設定與信任完成後的雜湊相同。只新增測試產物與更新本文件。既有 26 項離線測試為之前結果，本輪未重跑未變更的程式。

## 後續最小實作範圍

### 2026-09-19 第一方能力與 worker 完整性

- Desktop 的 Flash 連線狀態只表示可選 worker 是否可用；連線中或失敗不再阻止主腦直接工作及原生 GPT 子代理。指定必須使用 Flash 時仍不得靜默換路線。
- K 直接使用已安裝 Codex app-server 的 Goal、`turn/steer`、計畫更新、token/context 與壓縮介面；K 不另存第二套全域計畫或 session 真值。
- `k_worker_run` 沿用同一 dispatcher、requestId、job、停止與查詢路徑；60 秒內完成時同一工具呼叫回傳結果，逾時則保留原 ID 與真實狀態。`k_worker_recover` 只讀回目前檔案／工具證據，不續跑、不重播、不接受成果。
- Desktop 的 worker 收集同時辨識 start 與 run；取消、失敗或 unresolved 狀態會按需附上恢復證據，仍維持 `completed != accepted`。

MCP 工具、SDK 安裝、專案設定、信任登記與 Astra App 人工資料派工已完成。[官方文件](https://learn.chatgpt.com/zh-Hant/docs/extend/mcp) 支援 stdio MCP 與受信任專案範圍設定；本專案已實際驗證這條 Astra 接入路徑，但 Sol 與完整主控能力仍未驗證。

現有讀檔／建立新檔能力已完成兩件真實非敏感文件工作及定向修訂。最終文件經原主代理收尾後通過，但還沒有同品質完整交付更快／更省的證據。下一個優先方向仍是縮小判斷型派工、降低驗收與返工負擔，不先擴建架構；不能把拿到明確錯誤清單後的修訂成功當成全新任務的一次通過率。後續編輯能力、對話續作與更完整工具隔離仍依實際需求決定；原型的路徑檢查不是作業系統沙箱，不能用來宣稱能安全執行任意命令或不受信任程式碼。

之後再使用程式修改、長篇整理、文件資料處理及中斷續作等實際非臨床工作比較品質、端到端時間與費用。後續安裝／升級、登入與模型呼叫仍依當時授權辦理，不直接搬用其他專案的秘密或設定。

## 上游來源

- [Pi 官方原始碼](https://github.com/earendil-works/pi)
- [Pi SDK 說明](https://pi.dev/docs/latest/sdk)
- [Pi 安全邊界](https://pi.dev/docs/latest/security)
- [官方 MCP SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [本次確認的 0.85.1 套件資訊](https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/0.85.1)

本專案目前沒有複製上游程式碼。未來如引入原始碼或介面成品，保留相應授權與來源。
