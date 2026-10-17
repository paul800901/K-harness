# 帳號觀察／事件等待與聊天效能修正（2026-10-13）

## 目前狀態

本人後續明確「已關 更新」，本批已於 **2026-10-13 11:49（臺灣）**正式套用 `a95fd65b1ae140c6b9220272dab68bbfbffc5370`。安裝來源、退版、既有資料及正式介面讀回完成後正常關閉；沒有接續翻譯房。下方候選階段敘述保留當時邊界，部署結果見文末。

## 候選階段邊界（更新前紀錄）

本輪本人要求「把整理出來這些修好，然後放著」，等本人停止 K 後再授權更新。**本批僅候選，未部署、未停止或重啟正式 K、未對真實翻譯房送訊息／派工／取消／重派、未切帳或刷新官方額度。** 原工作可以繼續執行。

候選工作樹：`C:/Users/Paulus/.codex/worktrees/room-lock-fix-20261010/K-harness`，工程基底 `8ad0803`，正式產品仍 `9550ade04090b413fc79a58c93efd80b99f4a8fd`。本輪補充要求真正 Opus 5.5 複查本次及先前因額度不足未完成的部分；審查結果於文末追加，不沿用舊額度失敗當作通過。

## 根因與實際修改

### 1. 普通帳號觀察不應阻塞所有聊天室

四房正式唯讀紀錄和正式模組隔離重現證明：最後官方額度是正值，僅超過 60 秒快取期限，`observe` 就登記全域交接；其他房新工單於是等待所有既有工人自然結束。這不是已證額度耗盡。

- `src/gemini-accounts.mjs`：一般觀察回傳具日期的既有身分／額度；沒有真零額度、帳號操作或既有交接時，不因 TTL 自造 drain。`ready` 只表示可嘗試派工，不承諾即時額度充足；認證未知維持明確 blocked。
- 真正零額度、本人帳號操作、明確舊 accountId 不符與既有交接仍走原排程；實際 acquire 仍驗身分與額度，沒有放寬切帳或重播。

### 2. 本機等待事件，而不是主代理反覆結束／再開原生目標回合

正式紀錄可见主代理結束回合後，Codex active goal 立即原生接續；拳王同一 account-query 約 69 秒問 14 次。因此只說「不要輪詢、可結束回合」並沒有接管等待。

- `src/luna-bridge.mjs`、`src/luna-gateway.mjs`：Gemini gateway 預設 `timeoutMs=null`，一個工具呼叫等待原工人／帳號 waitId 的實質事件，不設本機短週期返回；`0` 保留單次讀回，正數只結束等待、不終止原工單。
- 完成、新 attention、新核准或排程 ready／blocked 可返回；相同 quiet／待核准狀態不重複立即返回。核准數量增加代表新請求；減少只更新觀察，不當工作完成。新活動不等於新成果；安靜不當死掉，未知不當可重派。
- runtime-only observation 接住 query-only 及已結束但 `dispatch=not-started` 的派工嘗試。排程等待不是已執行；就緒不是原工單自動啟動或 goal resume 授權。重新開啟時的舊 waiting 紀錄顯示 unconfirmed，不從磁碟復活舊授權。
- 停止／新意圖／epoch 改變／連線關閉撤銷等待；原生呼叫取消訊號接實際 MCP v2 的 `context.mcpReq.signal`，只取消等待、不重送或終止工人。非 Gemini gateway 保留預設 30 秒，可明確選 null，仍受原生 client timeout 限制。
- `src/desktop-controller.mjs`：專案 k_gemini 的原生 MCP client ceiling 設 `tool_timeout_sec=86400`；這不是工人執行期限或重试，也不更改全域設定。指示 active goal 無獨立工作時維持工具等待，而不是靠回合自動續接。
- `src/gemini-handoff.mjs` 與兩個 controller：模型已由 wait 結果收到的精確 request／query、帳號及狀態收據才消費，不再結束回合後重複通知；其他收據保留。僅仍有效、尚在等待的可信 recovery 自身 request／query 收據不提前消費；已嘗試、失效或不相關收據不能被舊 recovery 留住。最後 ready 收據已讀才撤除相應 info 提示，真 blocked 警告保留。
- terminal wait 讀回先等原執行與必要落盤，再核對取消／epoch；不把尚未落盤的結果當接手證據。

### 3. 真正權限拒絕與一般讀檔失敗分開

`src/gemini-worker.mjs` 原 `/permission.*(?:denied|failed)/` 會把「declaring permissions … failed to read file … file not found」誤列 deniedTools。改成實際 permission denied／deny-rule 語意；不存在檔案仍保留原工具錯誤，不宣稱工人已死或可以重派。沒有隱藏任何原始事件。

### 4. 避免背景活動重算所選聊天室整段歷史

實機 45 組取樣顯示 renderer 平均占單核心等效 43.32%、主程序 25.13%；最忙 renderer 執行緒取樣峰值 77.40%。沒有量到單執行緒持續 100%，不將使用者 CPU20 截圖直接當根因證明。

- `src/conversation-controller.mjs`：Flash 沒有 nativeThreadId 時不掃 Codex 工具；各聊天室原生／討論資料更新才推進其 historyVersion，背景房更新不弄髒目前房的歷史。
- `shared/state-stream.mjs`、`src/desktop-server.mjs`：版本相同只比較必要狀態欄位，不反覆複製、簽章、逐筆比較歷史。版本變更仍重建獨立 baseline，原地 native mutation 正常送出；未提供版本的呼叫維持原完整比較。所有 snapshot／update／reconnect 入口均已接線。
- `frontend/main.jsx`：訊息使用独立 TranscriptContext、Map 查找、穩定 runtime adapter；收合過程不建立不可見 timeline。實際 profile 另外確認：即使 adapter 不變，Chat 父元件因背景更新重繪仍會讓第三方 UI provider 廣播歷史订閱，所以再以 memo ChatView 隔離背景更新。
- `frontend/chat-state.mjs`：只忽略全域側欄／額度等欄位；當前房 workerDetails、訊息、工具、核准、busy、錯誤及未來新增欄位仍使 Chat 更新。操作轉接讀最新 props，Chat 按 threadId 掛載，不將草稿／附件／權限固定成舊值。
- 沒有安裝套件、改 CPU 親和性／優先權／電源設定，也沒有另造 UI 框架或提前加入歷史分頁。metadata 整份保存是候選熱點，但未量到正式高頻率，這次不改持久化语意。

## 驗證與失敗紀錄

本機證據：`D:/K-harness/.runtime/scheduler-performance-fix-20261013/`；正式唯讀基線另於 `four-room-readonly-audit-20261013/`、`performance-readonly-audit-20261013/`。它們是固定觀察與隔離測試，不是持續監控或正式四房驗收。

- Opus 修正後完整 `node --test --test-concurrency=2 test/*.test.mjs`：**1589/1589，0 fail／cancelled／skipped，163.635 秒**。候選 `.runtime/scheduler-performance-opus-final-tests.txt`。第一輪完整 1583/1583、213.707 秒紀錄亦保留於 `.runtime/scheduler-performance-full-final-tests.txt`，沒有以舊測試冒稱涵蓋追加修正。
- 四個實際 DesktopController＋manager＋worker＋bridge，外部 provider 假邊界：A 真零額度、B 原工單仍執行、C not-started、D query-only；A/C/D 各保持單一 pending wait，B 自然結束後一次換帳、零新工單、零停止、零 duplicate 通知，goal 維持 active。
- 涵蓋 cancellation／晚到事件／async observe revocation／同一 quiet 去重／持久化先後／歷史 unconfirmed／精確 receipt consumption／blocked goal 保留可信 recovery；實際 MCP HTTP 預設 null 與明確 0 均驗證。
- 第一輪完整 1579 項：1577 pass、1 fail、1 cancelled。新增 MCP timeout 使舊設定精確斷言需更新；原交接測試持有 lease 卻等待 account-ready 的舊 helper 不再適用 event wait，改成 inspect setup + wait(0) durable readback。未修改產品期限掩蓋測試。中間追加提示撤除斷言曾誤放入另一測試（rooms 未定義），已移到正確四房情境；原失敗保存。修後聚焦 121/121，再跑上述最終完整套件。
- UI build 通過；既有大 chunk 建議保留，不宣稱已拆包。`git diff --check` 通過。

### 真 GPT-5.6 Luna 分工與原生等待驗證

本人指定 GPT-5.6 Luna，實際使用既有 Codex 訂閱 CLI，runtime 回報 `gpt-5.6-luna`；未另指定 effort，不冒稱 high。初次讀寫工具被唯讀政策拒絕，沒有放寬或假稱已執行；主要程式由主代理實作。Luna 改以已取得的差異文字提出盲點。

`native-wait-result.json`：固定 Codex 0.161.0 接本機假 MCP bridge，省略 timeoutMs 的工具呼叫僅一次，**75.007 秒**後返回、exit 0，沒有假工人模型工作。證明超過原短等待可維持原生工具回合，不代表 24 小時或真上游長跑通過。

Luna 提出的等待競態、caller 接線、前端回歸已用上述證據檢查。其單一事件兼容提案未採：目前 controller 收據只由 merge 產生 events 結構，既有 consume 同樣使用 events；未發現可達單一事件入口，不為假設增加相容層。其 MCP context 猜測依實際安裝 v2 型別與真 HTTP／原生試驗排除，沒有改成舊 SDK 欄位。

### 建置 UI 的隔離效能與操作讀回

`ui-final-probe.mjs` 用相同四房 timing 結構、替代文字及假 controller；基線載入正式版資產的隔離副本，候選載入本次建置。沒有連正式 K API、沒有送真翻譯工作。

| 相同 100 次背景更新、目前房 2761 訊息／2636 工具 | 正式版來源隔離基線 | 候選 |
|---|---:|---:|
| renderer TaskDuration | 10.387099 秒 | 1.504459 秒 |
| renderer ScriptDuration | 10.057418 秒 | 1.277597 秒 |
| 完成本段所經時間 | 11.175 秒 | 8.307 秒 |

此情境 renderer CPU 處理時間減少約 **85.5%**，不是整機 CPU 或正式操作延遲降低 85.5% 的保證。先前僅拆 Context／穩定 adapter 仍約 7.8 秒，未當作足夠；profile 指向 provider 重新渲染，補 Chat 邊界後取得末版結果。

同一探針確認草稿不被背景更新／四房切換清除、所選房新訊息可見、假 room0 只收到一次對應 send、預覽請求仍綁 room0、無頁面錯誤。桌面 1440×1000 已目視核對。原手機截圖是側欄，補 `ui-mobile-check-v2` 以可見收合按鈕關閉側欄，再驗 390×844 實際聊天與草稿輸入，截圖已目視；前次點全螢幕背景中央被側欄攔截的探針失敗保留，不據此修改產品或強制點穿。

## 正式未動與未驗範圍

`formal-source-unchanged.json` 最後讀回：本次涉及、正式已存在的 **11 個產品檔**逐 bytes SHA256 仍等於 `9550ade`；加上候選新增 `frontend/chat-state.mjs` 合計 12 個產品檔，該新模組沒有複製進正式。正式正在工作，沒有以可變對話資料 hash 宣稱其資料完全未變。既有不相關未追蹤檔保留。

尚未驗正式四房長時間執行、真帳號換帳、外部故障注入、實體手機及安裝後行為。原生模型仍可能不遵循等待／分工，不能靠 K 禁止所有模型判斷錯誤；本次修工具可觀察語意與等待路徑，不修改小說成果或代替主編驗收。上游容量、網路中斷與超過 native client ceiling 不在「永不失敗」保證內。

## Opus 5.5 補審

本人追加要求後，建立精確唯讀封包，範圍從最後完成有效 Opus 5.5 末審的 `c1d5e38` 起：429 接續、fresh model 選擇、交接受理後 settlement、長文字／模型提示、晚到工人 goal recovery、9550ade 四房調度，以及本次候選。正式資料、帳號與登入秘密不在封包內。

真正 Claude Code **2.1.294 / claude-opus-5-5** 經既有官方 Claude 訂閱完成第一輪；不是 Gemini 通道的 Opus 4.6，也沒有切 API 計費、搬憑證或修改正式工單。`opus-55-review/result.json` 記錄 exit 0、success、實際 model、49 次唯讀工具；session `92a65932-61a4-41ca-a747-0d86163ccc36`。`review.md` 逐範圍列出已讀與未驗內容。

第一輪找到兩個中度阻擋，均由主代理重現後修正，不把審查建議直接當事實：

1. 舊 goal recovery 即使 attempted／cancelled，accountWait 仍 truthy，跳過新結果收據消費；因此多喚醒一次。修成只保留有效待恢復、且精確屬於該 recovery 的 request／query。
2. 未變的待核准狀態每次 wait 都立即返回。改以進入時的核准數量觀察新增請求，不重複返回舊狀態；保留第二個並行核准及原工單完成的喚醒。

六個新增反例全部先 RED，再以原有等待／恢復／四房測試一起 GREEN **126/126**。日志在候選 `.runtime/opus-wait-red.txt`、`.runtime/opus-wait-green.txt`；副本隨第二輪精確封包保存。

第一輪的其餘欠審產品路徑沒有提出阻擋問題；這是程式審查，不是正式回歸讀回。非阻擋建議未順手擴張清理：單事件 fallback 未證可達、Claude 提示累積未證造成此次卡頓，未重構；NativeReasoning 的缺失來源已補給第二輪，主代理已核對只讀 reasoning／capabilities，投影均含有。

**第二輪已完成，A／B 修正獲確認，未找到新的阻擋問題。** `opus-55-review-r2/result.json` 記錄 exit 0、success、實際 `claude-opus-5-5`、24 次唯讀工具；session `a42c801c-bfcd-4180-8561-014174c4ab2d`。實讀修後 delta、恢復／receipt／approval／wait 周邊路徑、六項反例及 NativeReasoning 投影；不是重跑未變的全部 backlog。主代理独立檢查相同 diff、完整 1589 測試、UI 證據與正式來源未變讀回後結案。

補審涵蓋的歷史產品批次：`2a18509`（429／response-first）、`4595e96`／`f5ef4ab`（fresh model／收尾交接）、`ee8992d`／`a0662c5`（長訊息／切模提示／晚到工人恢復）、`9550ade`（四房排程）。第一輪沒有逐份讀完所有舊文件，`chat-source-guard-probe` 僅看差異標頭；實際審查深度見原報告，不把「補審範圍」說成所有歷史行為實測通過。

**最終狀態：候選修正、相稱驗證及真正 Opus 5.5 兩輪複查完成；停止於待本人關 K 後再授權更新。未部署、未重啟、未對原翻譯房送訊息／重派、未 push／更新東區／排程上線。**

## 本人授權後正式更新與讀回（2026-10-13）

本人明確「已關 更新」後，先確認 K 自有主程式／工人與 47831、5199 listener 均不存在；Chrome 原生訊息 host 仍在，並非 K 執行工作，原樣保留。未強制關閉任何程序、未切帳、未操作正式翻譯房。

### 封裝與驗證

- 固定產品來源 `a95fd65b1ae140c6b9220272dab68bbfbffc5370`，705 個追蹤檔逐 bytes 與 Git 比對零差異。既有相依版本未變，使用原正式相依，沒有安裝套件、改全域設定或供應商核心。
- 三項建置（UI／擴充／啟動器）成功。封裝第一輪完整測試 1588/1589：`fresh native selection: effort only changes child` 在測試用收據落盤時遭 Windows `EPERM` 拒絕 rename，因此狀態保留 uncertain，而非 sent；沒有自動重建或重送。
- 失敗原件、暫存收據及日誌保留。造成 EPERM 的持有程序／底層原因未證，沒有宣稱已修復，也沒有更改程式、增加重试或放寬斷言來通過。相同來源的 17 項 fresh-target 測試連續三次全過，再重跑完整封裝 **1589/1589，0 fail／cancelled／skipped，151.788 秒**；三尺寸 long-user UI probe 3/3。兩次完整測試分開保存，沒有覆蓋失敗紀錄。
- 採用上述真正 Opus 5.5 兩輪複查及主代理獨立驗收，不把另一模型或舊額度不足記錄當末審。部署前後所有 705 個安裝來源再核對一致；正式安裝路徑聚焦調度／事件等待／goal recovery／收據測試 **126/126，0 fail／cancelled／skipped，55.982 秒**。

### 正式套用與保留

- 只執行一次程式交易式切換，正式 `9550ade` → `a95fd65`。`D:/K-harness/.local/runtime.json` 版本及退版指標讀回一致，其餘欄位不變。
- 可退回程式位於 `D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1791863397103`。舊入口／啟動器 hash、旧 runtime 關鍵來源與原版本一致；新入口及桌面啟動器與封裝一致。桌面既有 `K HARNESS.lnk` 仍指向原啟動器。這是程式退版，不是對話資料備份或還原。
- **79 份聊天室 metadata 完整 hash 不變**；專案、核心選擇、Codex 設定、Google 操作設定及既有資料目錄位置／清單保留。未搬動任何登入資料。
- 真正啟動正式 owner 做介面讀回時，既有當前 Gemini 第 3 帳僅 `auth.checkedAt`、`quota.checkedAt`、`lastQueryAt` 三個正常查詢時間更新；逐欄核對帳號清單／activeAccountId／額度數值／reset 等其餘內容不變。没有換帳、逐帳查額度或改計費。

### 正式讀回與停止

- 正式 HTTP health 200，未授權 state 403；實際送出的 JS／CSS hash 等於安裝檔。1440×960 與 390×844 headless 正式介面載入成功，31 個可列對話，截圖由主代理目視核對。
- 兩尺寸均維持 `threadId=null`、`busy=false`，0 工作 POST、0 頁面錯誤；沒有開啟真翻譯房、派工、恢復目標或重播未知工作。手機尺寸核對的是正式頁面／側欄，不是實體手機或翻譯聊天長跑。
- 讀回完成後正常關閉 owner，服務不可連、K 自有程序與 listener 再確認為空；保留原 Chrome host。**K 維持關閉，下一次從原桌面捷徑開啟即使用新版。**
- 未 push、未更新東區、未排程、未續跑原四房。真實四房長任務、真帳號輪換與實體手機仍待日常驗證；不把隔離效能改善當成正式整機卡頓全解，也不承諾供應商故障不再發生。

證據目錄：`D:/K-harness/.runtime/scheduler-performance-deploy-20261013/`，包括 `candidate.json`、`validation.json`、兩輪完整測試日誌、`activation.json`、`preserved.json`、`formal-readback.json`、雙尺寸截圖、`post-readback-preservation.json`、`stopped-after-readback.json`、`launcher-rollback-readback.json`。最新狀態為**已正式更新、讀回完成、K 已關閉**，取代上文候選待授權狀態。
