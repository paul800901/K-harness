# 本聊天室子代理快覽與 Pick Me Up 待確認誤列（2026-10-09）

## 最新授權與狀態

本人已撤回今晚立即關閉／更新，改為明天回到電腦再更新，修正累積在候選。正式 K 仍有小說工作；本輪沒有停止、重送、部署、重啟或 push。API／Exa 候選同樣保留，不設定自動更新時間。

## 本人定案的可見結果

- 上方子代理快覽只列本聊天室尚未結束的子代理。
- 每列只顯示原生回報的模型，以及「執行中／等待／待確認」。不顯示工人暱稱、工作識別碼、任務、主代理狀態、活動時間或說明段。
- 模型名稱按需讀既有原生目錄；缺少名稱時保留該子代理自己的模型 ID，缺少模型才寫「模型待確認」。不拿主代理模型代填，不編造型號。
- 工具／子代理等待與 pending／starting 顯示等待；核准、未知、斷線、久未回報保持待確認。久未回報不補判完成。
- 已完成與未持有的歷史工單不列入快覽；右側詳細面板、任務與歷史保留原樣。

`Thread.model` 是原生目前設定或最後保存的模型，不是逐回合實際執行遙測；因此不宣稱全面驗證每回合是否曾被供應商重新路由。

## Pick Me Up 的原生證據及根因限制

本人手機截圖顯示「子代理未結束 · 96」及大量狀態待確認。以正式 K 的 SQLite **唯讀**查詢、原生 JSONL 及本機官方 Codex 0.161.0 產生的協定核對：

- 截圖前 10 個子代理的父對話都是 `01a11caf-223c-7963-87fe-4628b6553927`（Pick Me Up），模型為 `gpt-6-luna`，最新回合均明確 `completed`。
- 當次唯讀盤點的 307 個直接子代理，原生 JSONL 最後工作事件均為 task_complete。這是盤點當下的歷史證據，不表示截圖當時或之後沒有新工作。
- 因此至少截圖前 10 筆存在已完成卻仍列待確認的現象；96 不能當作 96 個並行工作的數量。
- 現用 K 仍對所有歷史子代理請求 `thread/read(includeTurns:true)`；官方對 paginated 歷史送出 deprecationNotice，建議 metadata-only read 加原生分頁。

**不能斷言唯一根因已查明。** 未取得截圖當時正在運作 host 的 96 筆實際錯誤回覆；也未接入其 stdin／socket。舊讀法在完整離線歷史上仍可能成功。先前聊天把分頁／空清單直接說成唯一根因過於確定，本紀錄更正：已證實誤列及過時讀法，尚未證實那次誤列只由分頁造成。

## 最小程式修正

`src/native-workers.mjs` 先讀 metadata 並核對父對話；paginated 用 `thread/turns/list` 的 `limit:1, sortDirection:'desc', itemsView:'summary'` 取得最新回合。legacy 保留 full-history 讀取。不讀每筆工作的全部工具與文字。

父來源、最新回合與停止後再次讀回的要求不放寬：foreign、空清單、未知狀態、讀取失敗仍 unresolved；只在 idle／notLoaded 且最新回合明確 completed／interrupted／failed 才 settled。只中斷剛讀回的 inProgress 回合；不自動重送／接續，不把收到終止事件本身當交付成功。

既有更新觸發仍在：子代理 started／completed／status 事件、collaboration item、主回合完成及右側手動查詢。沒有新增輪詢、快取、狀態服務、備援或設定。

修改檔案：

- `frontend/worker-activity-popover.jsx`、`frontend/main.jsx`
- `src/native-workers.mjs`
- `test/native-workers.test.mjs`
- `test/worker-count-ui-probe.mjs`、`test/worker-wait-ui-probe.mjs`、`test/worker-reconciliation-ui-probe.mjs`、`test/mobile-remote-ui-probe.mjs`
- 本紀錄、工程索引及 API 候選延後更新註記。

## 驗證、失敗紀錄與界線

私有證據：`D:\K-harness\.runtime\worker-status-fix-20261009`。

- 完整序列測試 **1105/1105**（`serial-tests.log`）；native worker 定向 **10/10**，既有 Flash 定向 **19/19**。首次並行全套 1104/1105，一項 Flash 合成測試通知等待時序失敗；原紀錄 `all-tests.log` 保留，未改產品或該測試來掩蓋，定向及完整序列通過。
- UI build 通過，仍有既存 bundle 大小警告。三項快覽 built probes 通過桌面／手機／四尺寸；模型、三種狀態、其他聊天室排除、unknown／離線、terminal／unowned、右側歷史保留均查核。追加合成 96 個 unresolved→原生確認 terminal 後，快覽變已知零；這不是正式 96 筆已消失的證據。
- 手機 real HTTP/SSE＋測試 HTTPS probe 通過（6 房／3 次假送出），確認按需原生模型名稱載入。測試第一次缺假 HTTPS 憑證，生成新測試專用憑證（使用已安裝的 cryptography，未安裝套件）；接著發現目錄尚未載入只能顯模型 ID，窄補點開快覽時 GET 既有目錄，最後通過。未改登入／模型／權限。
- 主代理檢視手機快覽截圖：只列 GPT-6.1 Sol 執行中、Claude Opus 5.5 待確認與模型未知待確認；沒有暱稱、工單 ID、任務、主代理状态或活動時間。圖片在工作樹 `.runtime/core-catalog-audit-20261008/ui/mobile-quick-model-status.png`。
- 將上述 10 筆選定的原生歷史／SQLite 記錄複製到**獨立、無登入**的測試 home，用同版官方核心只 initialize／read／turns-list，新讀法 **10/10 completed**、turnId 與原生最新回合逐筆相符；沒有 deprecationNotice、模型回合、API 支付或正式 host 操作。見 `native-readback.json`。
- 最初離線 fixture 只有 JSONL，缺配套 SQLite，空清單／metadata 未知不能当正式根因證據；補齊配套記錄後才使用成功結果，原失敗保留。SQLite 是此次既有歷史診斷資料，不新增產品備份／ledger。
- 真正 Opus 5.5：官方 Claude.ai Pro，CLI 2.1.294，session `5919ebbf-1493-4b6d-b510-5ba335b85c33`；實際模型 claude-opus-5-5、code 0／success／is_error false，只讀 10 次。無 blocker、無過度工程；要求不要把離線結果或過時方法直接冒稱唯一根因／正式修復。見 `review/review.md`、`review/result.json`。

官方協定說明：[Codex App Server](https://learn.chatgpt.com/docs/app-server)；本輪版本細節以現場執行檔產生的 `protocol/v2/Thread.ts`、`ThreadTurnsListParams.ts` 為準。

## 待明天正式驗收

目前是**已實作並本地／原生歷史複本驗證的候選**，不是正式修復完成。正式程式指標仍 `1a45a73440a5f948c5cec625de02340863b7c67d`。

本人回來允許更新時，依既有流程核對工作停止、保留可退程式版本、只換程式與必要啟動器。更新後直接讀回 Pick Me Up 快覽：已結束歷史不再計數；未結束項只列原生模型／執行／等待／待確認。若仍待確認，取得那次原生讀取的實際失敗資料再定位；不假完成、不重送小說工作。API／Exa 等前批一併累積，Git push 與正式更新一起處理。
