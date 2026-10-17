# Gemini 跨聊天室調度生命週期修正（2026-10-13）

## 狀態與範圍

第一階段為候選實作／隔離驗證；當時未部署或切帳。**本人後續確認 K 已關閉，明確要求切帳完成複查並更新；本次正式狀態以本文末段追加為準。** 未恢復／重送真實翻譯工單，不改其他供應商登入／計費，不 push。 正式來源仍為 `a0662c581e31f92f0225f447b924f5f44734dd4d`；工程基底 `621e31b8f0a7ece2a77d40fa3e11c521b0faeda2`。保留既有不相關修改與測試檔，不做清理。

本輪本人要求完整處理四房共用帳號調度，並澄清：**禁止自動重送工單，允許新實質事件多次通知／喚醒同一主代理；禁止模型無效輪詢。** 不是終身只准喚醒一次，也不是同一不變事件一直花額度重問。K 本機等待、計時、接事件不需要模型待命；核對與後續工作會使用模型額度。

## 根因與實作

此前 10/12 已處理「工人額度失敗→自然排空→官方查核／順序換帳→通知原房」，但缺少兩個入口：其他房仍帶舊 accountId；查詢帳號但尚無工單的房間。後者呼叫全帳號實查會因共用身分忙碌被拒絕，沒有由 K 登記等待及回報，導致反覆詢問／blocked。前次元件測試未覆蓋四房實際組合流程。

- `src/gemini-accounts.mjs`：沿既有 manager 加入 `observe`。回傳目前共用派工帳號、有日期的最後官方證據及 waiting／ready／blocked；沒有假即時額度。需要等待時登記原房 queryId。舊明確帳號不符一律不送出、不悄悄重綁／切回；接入既有等待及通知。普通新工單可省略 accountId，由既有 acquire 核對當前身分與官方額度。人類完整實查入口保留。
- 有待交接房間時不讓新 Flash 工作無限延長排空；現有工人自然結束，不因安靜判死。只有官方零額度才順序換帳。一般速率／登入／未知與零額度分開。
- 全帳號官方確認零額度且有有效重設時間，單一本機 timer 到期查核；不叫模型定時監看。人工官方新結果可清除舊 timer 立即重判。無法確認重設／身分時通知原因，不編造可用或恢復時間。取消最後等待者清 timer；不從歷史／重啟復活。
- `src/luna-bridge.mjs`：queryId 與 job requestId 分離，來源 epoch 撤銷，等待期間查詢共用同一登記。終態通知須先確認所有涉及工單結果已落盤；不能僅憑記憶體 settled。沿既有 persistTails 判斷，不另造持久化系統。失敗落盤仍不可當已保存。
- `src/gemini-handoff.mjs`：兩種主代理共同使用的小型純函式；按事件識別碼保留／消耗收據。新事件不可覆蓋舊未送資料，送出中到達新事件不重送舊事件。混合「已執行速率失敗」與「尚未送出」分開 blocked／ready，不把前者說成已恢復。queryIds 不可拿來 handoffFrom。
- `src/desktop-controller.mjs`／`src/claude-controller.mjs`：query-only 也可通知；等待中的工單失敗不提前浪費模型回合。新 terminal blocker 只回報原因，不冒充 ready 或 goal recovery。主代理核對後，才明確用新 requestId 派剩餘工作。
- Codex 同一目標成功核對並經實際 `goal_resume` 恢復後，下一個新的工人／帳號等待可再綁定、再送可信核對；不重設一般失敗重試資格，不形成核對失敗自我重試。保留精確原生來源、無顯式 tokenBudget 的既有邊界、暫停／停止／新意圖撤銷及未知副作用不重播。
- 兩 controller 都處理「前一通知回合已完成，但 send promise 尚未返回」及「新事件到達 preflight」：只排仍未送出的新事件，不無限重排同一不變狀態。送出結果不明仍不重送。
- `src/luna-gateway.mjs`／`src/worker-policy.mjs`：說明觀察／等待通知契約，明示 busy 不是額度耗盡、不要每張工單遍查帳號、不要只為等待 blocked。工具會登記等待，因此不能標 readOnlyHint=true。

## 行為驗收矩陣

| 情境 | 核對的可觀察結果 |
|---|---|
| A 額度失敗、B 仍在跑、C 未送出、D 只查帳號 | B 未終結前不換帳；B 自然完成後官方查核，A/C/D 各自收到通知，零自動重播 |
| 共用帳號已由 A 換到 B，四房仍指定 A | 各工單未送出；K 通知當前 B，不切回 A，不偷偷替舊工單換帳；主代理新 ID 才派剩餘 |
| 房間取消／暫停／新意圖 | 僅撤銷原房舊等待；其他房工作不停止，舊回呼不復活 |
| 同房多個 ready／waiting／blocked、query-only | 獨立 IDs 保留，新通知只消耗已遞送部分，原工作不重播 |
| 全部零額度／人工刷新取得新官方結果 | 程式等官方重設；新有效結果可提前解除舊 timer，不喚醒模型輪詢 |
| 正常核對恢復→再次新等待→完成 | 同目標 createdAt／用量／預算保留，多次不同事件可再核對；無新真人訊息也不漏接 |
| 通知送出中／前置讀回中，新事件到達 | 新 query-only 或 worker 事件不消失、不重送舊事件 |
| 終態記憶體已更新、磁碟寫入尚未結束 | 新事件不能提前放行舊尚未保存的結果 |
| 未知身分／未確認停止／未知送出／原生失敗限制 | 不當零額度、完成、可重播或新授權 |

四房測試使用真正 DesktopController + LunaBridge + GeminiWorker + 共用 accounts manager；只替換原生 host、外部 agy、vault、gateway 設定等外部邊界，以假資料可控注入。**不是四個正式翻譯房長跑或真正 Google 帳號輪換驗收。** 相同測試在舊基底 0/3，先停於缺少 not-started 契約；不把這當成所有下游競態都已在舊版逐項重現。候選同鏈 3/3，重複三輪通過。

## 真正跨模型複查

既有官方 Antigravity 訂閱，CLI 實際版本 1.3.2；只讀候選程式與工程資料，獨立 profile，不搬憑證、不切帳、不用 API key。

- **Gemini 3.8 Flash high**：原生 init 實證；設計討論 `8db54f1a-138a-44da-a258-6e1d9c8308cc`，候選審查 `f0c59618-7667-417c-91d7-ae87fe99518e`。確實提出 timer、送出中收據消耗、同目標第二次等待及 terminal blocker 缺口；逐項重現／修正，不以其口頭認可替代測試。
- **Opus 4.6 thinking**：原生 init 實證；設計回合 `1f50326c-2162-492d-86ec-b91f04a523f9`。實際只完整讀到 manager／manager tests，controller 路徑猜錯且工具被只讀界線拒絕；完整四房鏈驗收建議採納，不能宣稱它已審完候選。增量候選回合 `39f56e93-f3af-408b-874e-5eb1876d8c5e` 回官方 Individual quota reached，**沒有取得末審**，未重送、換帳或購買額度。
- **Gemini 3.1 Pro**：本機官方 `agy models` 未列出；未假冒調用、未換成其他模型頂替。
- Flash 建議忽略不存在的 worker record，**未採纳**：合法 manager 回呼之前 record 已同步保留；query-only 有獨立 IDs，未知 ID 仍不能当 settled。另稱 accountQueryId 被清除導致覆寫，完整鏈未重現；反而獨立可控測試找到「其他終態提前 flush 尚未落盤工單」並補修。
- 不採納任何自動重執行舊工單、靜默重綁帳號或新增管理框架建議。真正 Opus 5.5 未複查，沿本人本輪額度不足不強求的決定。

### Flash 增量回合限制

`flash-incremental/result.json` 原生 model 仍為 `gemini-3.8-flash-high`，但正式結果標 failed／output token limit；雖取得部分審查文字，**不當成成功末審**，未重送。其新指摘獨立核對：

1. 稱 paused 守衛寫成 `!==`，實際提示包與來源均是 `===`，屬誤引程式，未照改。
2. 稱 consume 收到無 events 的單一物件；兩 controller 所有非 null 賦值都經 merge/combine，原始 callback 不直接傳入 consume，沒有此合法呼叫鏈，不為假設輸入增加備援。
3. 建議 failed 主回合也發 blocked 回合；本輪保留失敗後核對資格，blocked 原因不等於上游／權限／額度已恢復。UI 原因通知已存在；不讓 terminal blocker 繞過既有失敗限制重新叫模型。

該回合提示包早於最後 bridge 落盤與 query-only 收尾補修；末版由主代理獨立讀 diff、可控回歸與全套驗證，不聲稱外部模型已審過精確末版。

## 測試與失敗記錄

主要本機證據：`D:/K-harness/.runtime/scheduler-complete-20261013/`；子代理隔離測試 log 另在候選 `.runtime/tests/`。原始失敗保留，沒有以後來綠測覆寫紅測。

- 四房：`gemini-scheduler-rooms-result-20261013-072130.log`；舊基底 `gemini-scheduler-baseline-20261013-072222/four-room-baseline.log`。
- Flash 提出 timer／同目標第二次等待：`manual-refresh-red.log`、`repeated-goal-red.log` → `scheduler-extra.log`、`repeated-goal-green.log`。
- 真 bridge 落盤競態：`bridge-query-durable-readback-20261013-073853.log`；修後曾僅因合法 query IDs 到達順序不同而断言失敗，改比較集合，保留早送禁止斷言。`bridge-notice-final.log` **142/142**。
- 通知收尾競態：`notification-inflight-red.log` → `notification-inflight-green.log`；`receipt-inflight-red.log`、`blocked-preflight-red.log`、`claude-query-terminal-race-red-20261013-074417.log` → `receipt-races-green.log` **9/9**。
- 全套首輪 1556/1558：既有換房測試固定 sleep 改等待已送收據；另一項自然通知時序失敗後隔離 93/93，但仍補了可控同類競態 RED/GREEN，不僅歸為 flaky。第二輪 1564/1565：舊 mixed-room 斷言只准一 ready，補上本輪必要的 scoped blocked＋ready 兩事件。
- 最後固定来源全套 `full-suite-freeze.log`：**1572/1572，0 fail／cancelled／skipped，90.751 秒**。涵蓋最新 bridge durable guard 與兩 controller query-only 收尾競態。
- UI build 通過；保留原有大 chunk 警告。本批沒有改 UI，不另宣稱新增畫面實測。
- `git diff --check` 通過；正式六個相關產品檔逐一比對仍等於 a0662c5，見 `formal-source-readback.json`。

## 停止與未驗證事項

第一階段只留下候選；後續本人授權見下節。正式四房長任務、真帳號輪換、上游服務容量與網路故障未做故障注入；沒有保證所有外部失敗永不發生。K 不擁有原生模型內部排程，也不應因「完成通知」就自行驗收翻譯成果。重啟後未知舊工單仍需要讀回，不自動續跑；本次不增加跨重啟持久等待佇列。

## 本人授權切帳與上線準備（2026-10-13）

本人明確說明「K 早關了，切帳戶把事情做好做滿，然後更新 K」。先核對 K 自有程序、47831／5199 listener 均無，保留 Chrome 擴充原生 host，不強制停止。

沿正式既有 Windows credential-vault adapter，逐一切換五個已保存帳號查官方 `/usage` 與 `agy models`，全部查完切回原帳號；再依授權選第二帳號進行 Opus 4.6 複查。未讀取或輸出憑證、未新增帳號、未改 Chrome／GPT／Claude 登入或計費。工程證據 `D:/K-harness/.runtime/scheduler-deploy-20261013/account-scan-final.json`、`account-selected-2.json`。

| 保存順序 | Gemini 每週剩餘 | Gemini 五小時剩餘 | Claude/GPT 官方分組週／五小時剩餘 |
|---|---:|---:|---:|
| 1 |54%|100%|100%／100%|
| 2 |83%|100%|100%／100%|
| 3 |83%|0%|100%／100%|
| 4 |83%|0%|100%／100%|
| 5 |15%|100%|100%／100%|

以上為本次逐帳官方觀察、非相加總額或目前即時保證；分組額度仍不保證模型個別容量。前次 Opus `Individual quota reached` 僅證明當時單一帳號該呼叫失敗，不能宣稱五個帳號全耗盡。五帳目錄都有 `claude-opus-4-6-thinking`，皆未提供 Gemini 3.1 Pro；本人隨後明確表示沒有就不必再追查，故不調用其他型號冒充。

### 切帳後真正 Opus 4.6 末版複查

`opus-final-account2/result.json`：原生 `claude-opus-4-6-thinking`，conversation `2a625907-55ff-405f-8d3f-bf91d0c4f4f7`，code 0、native SUCCESS、completed／settled；沒有工具呼叫、拒絕或工具錯誤。提供精確最後 source／controller sections／diff／四房與收據測試，來源16個檔案仍等於已通過1572全套的固定hash。這次確實取得有效末審，未發現阻擋性問題，不沿用前次額度失敗當作末審。

主代理獨立核對其四項非阻擋觀察：

1. refreshAll 釋放鎖後的微任務窗口：正式 createGeminiAccounts 未注入觸發 exclusive 的 onChange；沒有可證實正式觸發路徑，不新增泛用鎖框架。
2. Claude pause：此原生目標解析只提供 active／ended／clear，沒有 Codex 式 paused；停止、新訊息、清目標走既有 cancelGeminiHandoff／epoch，不能把兩家目標語意假定相同。
3. 寫入失敗：Opus 稱磁碟恢復便會自動重試，這點不採信。實碼僅在後續 persist 呼叫時銜接前次失敗；沒有保證最後一次磁碟失敗後自動重試。本批正確邊界是未落盤不可通知可接手，磁碟失敗仍需查核；不為審查猜測加入無限寫入重試。
4. accountWait epoch：外層 recoveryCurrent 有精確 epoch／同目標比對，新 epoch 無法恢復舊 goal；不重複新增一套 epoch。

Gemini 3.8 Flash 的先前有效設計與候選審查仍有採納的實質修正；不把它後來 token-limit 部分輸出冒稱成功。本人已取消追查未提供的3.1 Pro。

本段時點：候選驗收通過，正式尚待固定程式版本封裝與上線讀回；完成後另追加證據。

## 正式更新與最後讀回（2026-10-13）

- 本人本輪已授權、K 自有程序與服務埠為空後，固定產品 `9550ade04090b413fc79a58c93efd80b99f4a8fd` 單次更新到南區正式 K；不是只留候選。部署證據 `D:/K-harness/.runtime/scheduler-deploy-20261013/`。未 push、未更新東區、未開原翻譯房或送任何模型工作。
- 原版本 `a0662c581e31f92f0225f447b924f5f44734dd4d` 程式、啟動器及設定可退回，保留於 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1791852429647`；這不是對話資料快照，不恢復或覆寫對話。
- 701 個封裝／正式來源逐檔與固定 Git 版本位元組相同；沿用相同 package／lock 及既有獨立 node_modules，沒有安裝或升級套件。UI、瀏覽器擴充、桌面啟動器三建置通過。
- 封裝完整測試 **1572/1572，0 fail／cancelled／skipped**，96.472秒；長訊息三尺寸UI探針3/3。安裝後直接從正式來源重跑四房／收據／原生目標恢復 **106/106**，54.960秒；外部供應商仍是假边界，沒有假稱正式四房長跑。
- 真正正式 owner 啟動：health 200、未授權 state 403、實際 served JS/CSS hash 與封裝一致；桌面1440×960及手機390×844兩尺寸登入載入、31個既有房間清單，0原房開啟／0 POST／0頁面錯誤。截圖已目視核對。這是 headless 真服務讀回，不是實體手機或 Windows 捷徑像素驗證。
- 79份 main-session metadata 不變，原生核心選擇、Codex設定、專案／GoogleOps設定及資料夾位置不變；部署不再切帳，維持本人授權審查時選定第2個已保存 Google 帳號。讀回只有該帳號3個查詢時間及官方五小時 reset快取更新，額度百分比／身分／帳號清單不變，已逐欄比對。GPT／Claude登入、計費与語音設定不變。
- 入口與封裝 hash、舊程式來源、還原設定核對通過，見 `launcher-rollback-readback.json`。正式 owner 完成讀回後正常關閉，K自有程序／listener空；Chrome既有擴充host未停止。未恢復或重播四房工單。

目前交付狀態：**已正式更新且正式載入讀回完成；K 保持關閉，下一次由原桌面捷徑開啟就是此版。** 真正四個翻譯房跨帳長任務尚未在正式資料上重跑；上游模型滿載／斷線仍可能發生，不把調度修正當作供應商永不失敗保證。
