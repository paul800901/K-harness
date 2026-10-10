# 長任務可重現 K 缺口修補（2026-10-11）

## 狀態與界線

工程基底 `2c90d300406e725c5dbb24257e2bfc049d759d54`、正式基底 `92a11c4337ed4a4c8d6c19b1ee77c5efd3f6ce25`。本人要求繼續修好再更新，並確認 K 未開。Astra 裁決與獨立驗收；真正 GPT-6.1 Sol 分頭執行，唯一整合／複查／部署者。**目前候選通過本地全回歸，真正 Opus 5.5 合併末審完成，有條件 B1 已以現行入口來源證據由 Astra 解除、候選獨立驗收通過；尚未部署。**

不是把前批診断 UNKNOWN 改成「三因全解」：只修下面三組已實證 K 缺口；早晨上游服務內因、長篇品質／模型誤 pause 是否由壓縮致因仍未證。

## 1. 關閉失敗：既有 protocol 保留固定診斷

舊 fanout 造成回覆丟失／30 秒 native query 對 15 秒 launcher 的機制已由先前 12 併發 bounded 查詢處理。現場事故仍缺完整 binary／父子 PID 綁定，不能說唯一歷史原因。本次只補仍會丟掉的關閉拒絕原因。

產品四檔：`src/electron-isolated-main.cjs`、`src/electron-isolated-launcher.mjs`、`src/isolated-launcher.mjs`、`local-launcher/KTrayLauncher.cs`。既有 closed:false 多一個最小 diagnostic：固定 stage/code、本地 elapsedMs；timeout／實際 resource partial／disconnect／unconfirmed 分開。child 任意 code/message 不直接轉出；假 secret／小說文字不進 protocol 或 launcher log。closed:true 格式、15 秒、UNKNOWN 不等於成功、force 再確認預設 No、權限及未知工作不重播不變。沒有新服務／enum framework／設定。

red 19 項中 15 pass／4 fail；兩既有測試檔 focused 25/25，另 close-recovery 1/1。真 compiled C# handler 四類失敗與正常成功另外驗證，非混算 JS 項數。初次 reject wrapper 分類錯誤與相對路徑編譯失敗皆保留。

### 隱藏真程序鏈正常關閉

真 C# StartK/OpenK/StopK(false) → 真 Node → Electron 44.4.5 → 真 IPC/owner services → 新空 native 假房。僅 test harness presentation 抑制：BaseWindow show:false、show/focus no-op、Notify no-op、MessageBox 固定 No／sentinel。沒有產品 hidden 模式或新設定。正常 closed:true、owned supervisor exit 0、0 Dialog、沒有 force；新空房 `01a1270e-f74e-7a50-8c54-0e369b42fc74`，0 turn/start，thread ID 僅自身。自有程序正常結束，47831／5199 無 listener。

此為**隱藏真程序鏈生命週期**，不是人工 tray 點擊／UI 提示驗收。截圖取在 React 尚未完成連線時呈 offline，未以此宣稱房間前端驗收。首回 fixture 缺 paths.root 的初始化失敗保留，無建房／模型；次回僅修測試路徑。其 candidate 套 shutdown 四檔，不假稱驗過本批其他兩組新碼。

證據：`D:\K-harness\.runtime\long-task-repair-20261011\shutdown\repair-report.md`、同根 `daily-launcher-result.json`／`daily-launcher.log`／`hidden-native-{room,ready,preclose,close}.json`；不在 hidden-native-candidate 子目錄。

## 2. 記憶輔助：本人原文的來源粒度與完整回讀

確定缺口 A：同一 turn 的 205／1000 非人 items 可把最新本人「繼續」擠出舊五頁×40 scan。缺口 B：2763 Unicode 字元訊息只有頭 2000，尾端取消舊 pause 遺失；nextCursor=null 仍無同 message 後半讀取。這是 K 輔助通道缺口，不是原生歷史丟失。

`src/conversation-context.mjs`、`src/luna-gateway.mjs`、controller 的 readContext 小段：hook 用 bounded native turns summary 跳過無 userMessage 的自動 turn；普通 reader 預設仍 items，續 cursor 帶同 source。新增本房 exact `{messageId,turnId,offset}` 原文分段，最多五頁×40，同 ID userMessage／每段最多2000 Unicode code points，nextOffset 到 null 精確重組。未找到、超界、逾時／超頁如實 UNKNOWN，不猜鄰近訊息。頭尾只是引用，中段需讀回；renderer 4k／12k 再裁切仍保留引用／charCount，opaque native cursor 不再截300字、null 保持 null。

原總8秒／單RPC≤5秒、當前主房／hook身份／換房丟結果不變。hook 不可利用 original/source 指定外房；沒有重建另一記憶系統／控制分類器／fallback，沒有硬攔原生目標工具。

正式舊碼 fixture red 7/7 fail，最終 focused 59/59（含既有 stream 整合）。真 Codex Sol/medium 新假房／root-fork/on-off 身份核對、一次 compact 與真 controller/MCP 原文回讀；2763字元 offset0→2000→null SHA 相等，模型實際讀到被頭尾省略中段。205 inject ACK 但未 materialize，**不能稱 native 密集歷史驗收**；密集案例仍為真 schema 零模型 fixtures。未做上百次壓縮／小說長任務或其他供應商 hook，不能保證模型必定遵循全文回讀。

證據：工程樹 `.runtime/long-task-repair-20261011/memory/report.md`、`handoff.json`、`native-original-fixed/result.json`／`close.json`。report SHA `7830f41b3017dfbf35bed94fce71f12aef0fa992c32eb2d1846695e7b8d6d53a`。

## 3. Stream：末端排空與主要錯誤不被次要故障覆蓋

真 Node child 零模型重現：exit 早於 stdio close，舊 host stopped 導致已寫出的 final/error/turncompleted 三事件全丟。另 stdin EPIPE／child.error 共用 failAll 也丟尾端。新 `src/codex-host.mjs` exit 後禁止新 request/notify/approval 與已排程 onRequest，保留尾端讀取；error 拒待請求但不提前停 parser，明確 abort 保持停止。3 秒僅在 exit 後處理 inherited pipe，到期關本 client stdio、close 拒絕／未確認，不 kill 已退 PID 或未知孫程序，無重送。

controller 的 completed secondary catch／active.closed：worker 查詢、活動保存、斷線不能蓋原生 terminal error/raw/requestID/partial，次要問題留既有 notice；既有 host/thread/viewEpoch/requestEpoch/activity 身分防止舊 catch 污染新 turn。正常新錯誤仍為主錯誤，無新 token 狀態或模組。

red／第二入口 EPIPE red 均保留；host seams/diagnostics 17/17，整合 host/controller 148/148，真 built frontend 1440／393 假事件讀回、原始詳情入口／partial／secondary 提示保留，0 POST/pageerror/overflow。不能把本次排空缺陷倒推為早晨事故唯一根因；缺當時 wire／程序時序，官方161限定 parser 路徑仍不證明服务內因。

證據：`D:\K-harness\.runtime\long-task-repair-20261011\stream\repair-report.md`、`regression-green.log`、`ui-result.json`、兩張 secondary-error 圖。

## 合併驗證與末審

- explicit `node --test --test-concurrency=1 test/*.test.mjs`：**1213/1213，0 skipped，exit0**，181770 ms。
- UI／extension／真 C# launcher build 成功；僅既有 bundle-size warning。extension builder 只有生成換行差異，先核對相等再恢復原 bytes，未混入產品差異。git diff --check 通過。
- 8 個產品檔＋8 個測試檔合併完整 source/hash/diff packet；新 test/codex-host-tail 與 test/conversation-context-original 均納入。保留既有 untracked，未改套件／登入／全域環境。
- 全新官方訂閱 Claude2.1.294／claude-opus-5-5、claude.ai/firstParty Pro，唯讀 Read/Glob/Grep、無 Shell/MCP，未沿巨大舊 session。臺灣02:30:30開始，fresh session `eee274b6-f873-48d3-a5c1-6bdd1faa30d8`，工具原始讀回為18次 Read/Glob/Grep＋1次 Write 嘗試，後者被 No such tool available/disabled 阻擋，未寫入；不是19次只讀，保留模型自述不採。結論沒有確定 blocking，但 B1 conditional UNKNOWN 要確認真 runner 是否會 close。按它明列解除方式只讀核對：現行 isolated-desktop 的 Codex factory 未注入 spawnImpl，直接 host 默認 Node spawn；自訂 launch/terminate 假 runner 僅測試 seam，不在正式路徑。補充 `conditional-b1-source-readback.{json,md}` 保留原末審，不另開模型或改產品，Astra 獨立讀來源／真鏈／16檔hash後解除 B1，批准唯一正式更新。有關 K_SHUTDOWN_PARTIAL 的 UNKNOWN 亦以 desktop-server:71 實際 resource failure 產生端補證。非blocking精簡與極長cursor等建議不擴張。code0不是驗收。
- 真正末審與 Astra 獨立驗收已完成；下一步固定 SHA／保留程式與啟動器退版／單次南區更新，正式讀回後 K 日常關閉。不 push／東區，不 resume/start/stop/replay 原小說，資料與登入原處保留。

整合證據根：`D:\K-harness\.runtime\long-task-repair-20261011`；前批原因層級仍見 [三根因分層查證](three-root-causes-20261011.md)。

末審文字把 exit 簡化成拒絕 pending 並不精確：實際 exit 保留既有 pending response 到 close；stdin EPIPE／process error 才立即拒絕 pending。以產品來源與測試為準，未依模型簡述改正確實作。

固定產品／測試 commit：`fc65ab5fc12d0e926b08bca24a89ad12e07d1139`（16檔）。真正末審與 Astra 驗收後未再改產品；正式更新仍待下節 live receipt，不把 commit 當上線。
