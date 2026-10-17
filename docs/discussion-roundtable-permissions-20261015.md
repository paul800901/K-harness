# 討論 v2：廣泛唯讀、主代理主持與圓桌

以下實作與補修段落保留當時狀態；最新審核、發布與限制以文末紀錄為準。

本候選依 本人提供的「20261015 K 討論底層權限與圓桌 UI Astra 交接 v2」 實作，取代 v1；沒有修改需求定案。工作樹為 `discussion-skill/K-harness` 工作樹，分支 `astra/discussion-skill-gemini-outputs-20261015`，基底 `e173ad28dd0840a1b9f060711ee9e3e5c4326542`。全部修改未提交；未 commit、push、merge、部署、重啟或停止正式 K，未派工、未操作帳號或憑證。工程測試僅使用臨時 fixture、前景測試程序與自動關閉的測試伺服器。

收尾 `git diff --stat`：`29 files changed, 1222 insertions(+), 271 deletions(-)`；另有 7 個未追蹤檔案（兩份工程紀錄、圓桌 data/JSX/CSS、hosting 單元測試、圓桌 UI probe），不包含在該 stat。暫存區為空，HEAD 未變。完整 stat 與逐檔狀態在 `.runtime/tests/discussion-v2-diff-stat.txt`、`discussion-v2-worktree-status.json`；`git diff --check` 無錯誤。

## 甲、保留 Gemini 成果收據

保留 `geminiWriteTarget` 共用判準、成功原生寫檔目標累積、git 差異與逐檔 stat、finally/catch/帳號包裝層收據、`failureKind`／`nativeError`／`outputFilesNote`、`processFailure` 與 `onDiagnostic` 防護，以及 Gemini worker 測試。mtime 只供觀察，成果清單不保證完整，空清單不得觸發重播。詳見 [甲的短紀錄](discussion-skill-gemini-outputs-20261015.md)。

## 乙、先撤 v1，再做丙丁

先全撤 v1 指定的 frontend、conversation-controller、luna-gateway、claude-worker 與相關測試／規則；混合檔只保留甲，撤掉一般工人的逐工單 `accessMode`、唯讀分流與 MCP 掛載改變。完成撤回後、尚未開始丙丁時執行：

```powershell
git diff e173ad2 -- frontend src/conversation-controller.mjs src/luna-gateway.mjs src/claude-worker.mjs
```

結果無輸出；已在實作過程確認並回報。現在 frontend 與 conversation-controller 的 diff 是本輪丙丁需求，不是當時撤回未完成。`frontend/discussion.css`、`src/luna-gateway.mjs`、`src/claude-worker.mjs`、`test/luna-gateway.test.mjs`、`test/claude-worker.test.mjs`、`test/luna-bridge.test.mjs` 維持基底內容。

三種討論模式、API 選項與設定頁、插話、停止、歷史、整理、交接及一般工人顯示均保留；沒有 WorkerReports。

## 丙、參與者通道

| 通道 | 實作 | 本輪驗證範圍 |
| --- | --- | --- |
| Claude | discussionOnly 移除 restricted，僅 Read/Glob/Grep/WebSearch/WebFetch；保留 safe-mode、strict-mcp-config、空 MCP、plan；permission callback 同一白名單。 | 原生啟動參數與 callback 單元測試；真實 P2 未執行。 |
| Gemini | 真實 workspace cwd，`geminiSettings(workspace,'read-only',temps)`，各磁碟根 read allow、brain allow；不再 deny TEMP 讀取；保留獨立 home、空 MCP、rules 與 write/command/unsandboxed/MCP deny。 | 設定與假程序測試；真實 P3 未執行。沒有變更帳號排程。 |
| Codex | 移除 shell_tool:false，保留 multi_agent:false、MCP 全停、read-only/never、turn readOnly；Windows readiness 非 ready 時帶原因拒開 thread。 | 協定 request 與拒開測試；真實 P1 未執行。尚無證據判定 OS 唯讀隔離有效或失效。 |
| API | 接受絕對路徑、移除 protectedPart 名稱排除；保留 `..`、裝置名、尾點空白、連結／接合點、realpath 與一般檔案檢查。stat 超過 16 MiB 就拒讀；搜尋亦先 stat。外部列檔／搜尋回絕對路徑。 | 真實臨時檔案操作：工作區外假 `.env.fake` 可讀／可列／可搜尋，16 MiB+1 檔案被拒、搜尋列為 skipped；既有路徑與連結防護測試保留。不是對真實 API 供應商送模型請求。 |

提示同步為廣泛唯讀相關資料，不寫入或執行改變狀態的操作。不新增讀檔申請、憑證名稱排除或備援架構。

## 丁、主持、紀錄與 UI

- `discussion-controller` 只建立參與者 session；主持經 conversation → unified 的 `askHost()` 使用現有主 session。使用各核心既有 send 鎖、一般訊息佇列與工人完成通知狀態；等待時顯示「等待主代理」。佇列事件也會喚醒主持，避免移除最後一則待送訊息後停住。
- 每個主持回合在送出前保存固定 group/message 識別碼，Codex 回覆後再保存 native turn ID。後端 project 只依持久 ID 隱藏主持回合，仍提供全部討論原文。普通相同文字不會被藏；主持結束後的普通工人通知使用自己的 group。沒有文字猜測過濾。
- 停止使用各核心 `interruptDiscussion(id)`，只中止所屬主持回合；統籌層等原生終態才確認停止。主 session 不在參與者 Map，不會由 closeSessions 關閉。離線、送出不明或停止未確認會 failed/uncertain，不重送，不另開主持 session。
- 超過 32,000 字的主持材料逐字寫入本聊天室紀錄目錄，提示主模型讀取該檔；沒有無聲截斷。既有 handoff 與 discussionTranscript 不變。
- 參與者原文補 `participantId`、`round`；每次 askBatch 遞增。主持 speak/finish 的點名、要求、理由與時間另存 decisions，不加入 messages。插話保存原訊息 ID、位置與處理批次；新插話使未執行的主持安排標為 superseded。state.runs 提供摘要，不複製原文。存檔鏈可從一次失敗恢復，當次失敗仍回報。
- 聊天原始討論訊息顯示為一張入口卡，AI 整理留在下方。右側新增圓桌分頁、同聊天室場次切換；桌面新場次只自動開一次，手機不自動開。
- 桌面依參與者設定順序列欄，主持欄與表頭固定；格子約五行純文字與四種狀態，只有格子區橫捲。插話跨欄；整理可收合。全文閱讀器使用獨立 react-markdown，支援上一位／下一位／上一批／下一批，回格子保留位置；串流只在底部跟隨。
- 手機 ≤700px 為批次切換、色塊地圖、scroll-snap 全文卡，各卡自己直捲；第 0 批放任務書與整理。按鈕 ≥44px；返回從全文到格子再到聊天；直接關面板會清除閱讀狀態。
- 舊紀錄僅在前端依時間與發言者推估，標「推估」與「安排未記錄」，不改寫舊檔。同模型兩席位依 participantId 分開。補充按鈕使用既有輸入框與 target；手機先關面板。停止／插話帶 threadId＋runId，已結束、其他場次與其他聊天室的請求拒絕，runId 停止先檢查再進一般取消／停止邏輯。
- `react-markdown@10.1.0` 宣告為直接相依；使用既有套件，沒有另行安裝。新增樣式全用 `.discussion-roundtable` 前綴，未改全域 message/markdown/main 排版。

## 驗證方式與結果

Node v24.14.1。此 worktree 的 node_modules 是指向主樹相依套件的 junction，僅讀取套件；沒有安裝、修改套件或向其快取目錄寫入。建置採 native config loader；UI 測試的臨時 preload 把 Vite 快取放在此 worktree `.runtime/tests`，以系統 Chrome 的全新拋棄式 profile 跑 Playwright，不使用日常登入 profile，也未安裝瀏覽器。與專案預設 Chromium 的差異列為限制。

實際命令：

```powershell
# workdir 為上述 worktree
node --test --test-concurrency=4 test/*.test.mjs
npm run build:ui -- --configLoader native
$env:NODE_OPTIONS='--import=./.runtime/tests/ui-local-runtime.mjs'
$env:K_UI_EVIDENCE_DIR=(Join-Path (Get-Location) '.runtime/tests/ui-evidence')
npm run test:ui
```

完整輸出與圖片留於本 worktree `.runtime/tests`。沒有使用正式 K 執行測試。

已完成的檢查原文摘要：

```text
discussion-v2-unit-final.log
ℹ tests 1688
ℹ pass 1688
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 107435.6277

discussion-v2-unit-rerun.log
ℹ tests 1687
ℹ pass 1687
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0

discussion-final-focused.log
ℹ tests 103
ℹ pass 103
ℹ fail 0

discussion-ui-check4.log
4/4 UI probes passed.

discussion-v2-ui-full.log
47/47 UI probes passed.

discussion-v2-ui-final.log
47/47 UI probes passed.

roundtable-ui-final.log
4/4 roundtable UI scenarios passed (3/6 seats, 390px, long reports, legacy, same-model seats, run-bound operations).

discussion-v2-build-final.log
✓ 2746 modules transformed.
✓ built in 339ms
```

建置有產物超過 500 kB 的 bundle 大小警告（JS 約 880.49 kB），沒有當成建置失敗。圓桌 probe 包含 3／6 人、6 人 4 批長原文、390px、四種狀態、舊紀錄、同模型兩席位、桌面捲動位置、串流跟隨／不跟隨、手機返回與直接關閉、target focus、送出成功清空草稿，以及停止／插話 payload。另有後端測試拒絕過期操作、同 native ID、排程不碰撞、只中止主持、離線不另開、送出不明不重送、持久 ID 投影、長材料原文檔、存檔鏈失敗恢復。最後一次完整 UI 47/47 通過後，針對 probe 的假 API 成功回應與截圖取景再執行一次圓桌 probe，仍為 4/4；未因此更改產品程式。截圖在 `.runtime/tests/ui-evidence/discussion-roundtable-v2/`，已檢視六人桌面與 390px 手機圖。

開發中失敗亦保留，不能把最終通過套回前面批次：

- 最初的局部執行因舊 fixture 缺 askHost 而掛起，手動停止，沒有完整統計。
- `discussion-v2-focused.log`：137 tests / 134 pass / 3 fail；`discussion-v2-expanded.log`：287 tests / 284 pass / 3 fail。是舊主持 fixture 與新紀錄斷言／時序未同步，修正後局部回歸通過。
- `discussion-v2-unit-full.log`：1685 tests / 1661 pass / 24 fail / 0 cancelled / 0 skipped。22 項來自 Gemini send 的 discussionTurn 參數放錯函式；2 項來自新 CSS 未遵循字級／色彩 token。已修正，`v2-fixes-focused.log` 為 65 tests / 65 pass / 0 fail，後續完整 1687 全過。
- 首次圓桌 UI probe 發現全域 header 高度干擾停止按鈕，已在圓桌限定樣式修正。
- 討論 UI 中間批次為 2/4，失敗是舊 speaker／discussion probe 的逐則顯示期待、過快場次自動開啟與手機切換視窗後的面板操作。保留原功能斷言、修正對應 UI 操作，`discussion-ui-check4.log` 為 4/4。過程逾時原文在 `speaker-ui-*.log`、`discussion-ui-detail4.log` 等檔案。

## 既有斷言的必要調整

1. 原本測試另開 host session 的期待改為 `askHost`；只允許參與者 session，並驗證主 native ID 不變。停止測試等的是參與者已開啟，沒有假 host 計數。
2. 原本 Claude restricted/無工具、Codex shell:false、Gemini 隔離 cwd/TEMP deny，改成 v2 白名單、shell 可用、真 cwd/外部讀取 allow；增加 readiness 拒開。其他 no-MCP、no-write、停止與不重播斷言保留。
3. 原 API 工作區外／假敏感名稱必拒改為可讀；路徑穿越、裝置、連結、非一般檔案與非唯讀工具仍拒，新增 stat 上限與外部結果路徑。
4. 舊 UI 每則發言與底邊色彩的斷言改為入口卡＋AI 整理、圓桌模型欄名與小色標。仍檢查每個模型全文、三種模式、API 設定、指定插話、整組停止、同聊天室、一般對話交接、三主題、長文與無橫向溢出。窄視窗測試先關桌面側欄，避免兩個既有面板同時覆蓋；手機不再點被 CSS 隱藏的桌面收合按鈕。
5. 停止／插話 fixture 加 threadId＋runId。原始一般送訊息列表與內部主持列表分開；原文總數包含隱藏主持紀錄時，另核對 project 不顯示它。沒有移除一般聊天／一般子代理回歸檔案。

## 戊、真實 P1／P2／P3：未執行

本 worktree 沒有獨立可用的 `installed` 核心與已登入的隔離測試 home。環境現有登入與核心設定屬正式 K 的隔離環境；本次禁止讀取／複製其帳號、憑證、設定或經正式 K 探測，因此未啟動原生模型探測。以下是待執行步驟，不能用設定測試或模型自述代替。

共同準備：另以已獲授權且不依賴正式 K 的核心與測試 home，在臨時根目錄建立 `cwd`、`outside`；各放獨一隨機標記檔。明列待讀的兩條絕對路徑，待寫檔只能是該臨時根目錄內原先不存在的檔案。不讀真實敏感內容、不操作登入、不切換 Gemini 帳號。保存原生工具事件與檔案存在性證據，完成後只結束本探測擁有的程序。

| 探測 | 最小步驟與判準 | 狀態 |
| --- | --- | --- |
| P1 Codex | 以 K 專用隔離設定（含 Windows sandbox 設定），經 openDiscussionSession 的 initialize → readiness → config/read → thread/start；必須觀測 readiness=ready。以 read-only＋shell＋never 請它讀 cwd/outside 標記，再對臨時不存在路徑嘗試一個寫檔命令；記錄原生 command 事件／拒絕與實際檔案仍不存在。若真的寫入成功，才依交接改掛只讀 MCP 並完整重測。 | **未執行**；未證明 Windows sandbox 阻寫，也沒有觸發改備案的實測證據。 |
| P2 Claude | 經 discussionOnly 啟動；在臨時 cwd 放僅寫臨時 sentinel 的假 hook 設定。讀外部標記；保存 initialize 工具列表，確認沒有 Write/Edit/Bash；檢查假 hook sentinel 不存在，白名單讀取有原生事件及正確標記。 | **未執行**；不宣稱外部讀取或 hook 隔離已實證。 |
| P3 Gemini | 經真 cwd＋新 discussion home＋唯讀設定／外部 read allow 啟動，使用既有固定帳號且不做帳號操作；讀兩個標記，分別要求 write 與 command 寫入臨時 sentinel。核對原生 deniedTools／工具事件與檔案不存在。若外部標記讀不到，只能記錄「目前僅工作區內」，不能宣稱廣泛讀取通過。 | **未執行**；工作區外讀取與原生 deny 行為尚待實證。 |

## 風險、未知與審核

- 三家真實訂閱核心、原生工具清單、Windows OS 隔離與外部讀取尚未以 P1/P2/P3 驗證；本輪 hosting 通過的是假原生事件與真控制器回歸，不是實際模型回合。
- API 工具保留既有 lstat/realpath 防護，沒有另建作業系統檔案鎖；外部檔案在檢查後被其他程序替換的競態未實測。16 MiB 上限針對輸入檔案大小，不保證 PDF/DOCX 解壓後文字量。
- 舊紀錄的批次只能推估，尤其同模型同名席位無 ID 時無法證明原始歸屬；UI 明示推估，不回寫。
- UI 用系統 Chrome 的拋棄式 profile 通過；未用正式 K 或真實手機。bundle 大小警告仍存在。
- Opus 5.5 尚未審核，本輪沒有自行啟動審核子代理。尚未部署。

待 Opus 5.5 審核

## Opus v2 審後補修與不穩定測試追查（2026-10-15）

依本次交接，Opus 5.5 已整體通過上述 v2，要求修正 held-only 停止與追查一次未記下名稱的 `actual: 0, expected: 1`。本節只記本次後續工作；本次補修尚待 Opus 再審。工作樹為 `discussion-skill/K-harness` 工作樹，分支 `astra/discussion-skill-gemini-outputs-20261015`，HEAD 為 `e173ad28dd0840a1b9f060711ee9e3e5c4326542`。

### 最小修正

- `src/conversation-controller.mjs:1322`：無 runId 時仍拒絕 busy 討論；只有 held 且不 busy 時，取來源房間目前場次的 threadId＋runId 呼叫 discussion.stop，重試尚未確認的參與者清理。明確 runId 的原分支不變，過期操作不會落到一般工作的 stop。前端不需修改。
- `test/discussion-conversations.test.mjs:22,135,387`：fixture 增加可注入的 closeParticipant；新增 `held-only stop without a run ID retries cleanup in its room and never stops ordinary work via a stale run`。以真 conversation/discussion controller 和假參與者重現完成後清理失敗，驗證鎖定仍在、過期 run 不清理、無 runId 的第一次重試失敗仍可再試、第二次只清理殘留 session、切到另一房時仍清理來源房、一般送出恢復，以及已結束 runId 不會停止一般工作。
- 工程索引更新本文件的補修與追查描述；沒有修改其他產品檔案，保留進場時既有 v2 未提交修改。

### 驗證方式與完整原文

Node `v24.14.1`。為遵守不碰既有 `.runtime`，使用忽略目錄 `logs/opus-followup/scratch-location.mjs` 的載入鉤子，只將 `test/scratch.mjs` 的 scratch 根及四個舊測試檔中多餘的 `.runtime/tests` mkdir 導到 `logs/opus-followup/scratch`；沒有修改測試斷言、產品模組、計時器或排程。假工作區內的測試資料仍依既有 fixture 產生與清理，未讀寫正式 K、帳號、主工作樹或既有 `.runtime`。

完整測試指令：

```powershell
node --import ./logs/opus-followup/scratch-location.mjs --test --test-concurrency=4 --test-reporter=tap test/*.test.mjs
```

共六輪依序執行，另加一輪重疊執行以檢查負載下時序；後者與第五、六輪有重疊。七輪 exit code 均為 0，每份 TAP 的統計原文均為：

```text
# tests 1689
# suites 0
# pass 1689
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

| TAP 原文（相對 worktree） | duration_ms 原文 |
| --- | ---: |
| `logs/opus-followup/full-1.tap` | 106036.1542 |
| `logs/opus-followup/full-2.tap` | 106181.7411 |
| `logs/opus-followup/full-3.tap` | 105841.9219 |
| `logs/opus-followup/full-4.tap` | 105440.3084 |
| `logs/opus-followup/full-5.tap` | 106851.2158 |
| `logs/opus-followup/full-6.tap` | 105910.2495 |
| `logs/opus-followup/full-overlap.tap` | 106736.267 |

新增一項回歸，因此由交接的 1688 增為 1689。另完成：

- `held-focused.tap`：`# tests 21`、`# pass 21`、`# fail 0`。
- `discussion-repeat-1.tap` 至 `discussion-repeat-20.tap`：discussion-host、discussion-controller、discussion-conversations 三檔連跑 20 輪，每輪 `# tests 54`、`# pass 54`、`# fail 0`。
- `gemini-repeat-1.tap` 至 `gemini-repeat-10.tap`：gemini-worker 全檔連跑 10 輪，每輪 `# tests 64`、`# pass 64`、`# fail 0`。
- `held-before-fix.tap`：以 `before-fix.mjs` 載入鉤子僅將本次停止路由還原成進場時的 v2 分支，跑新增 held-only 測試，exit 1；原文 `# tests 1`、`# pass 0`、`# fail 1`，錯在預期清理失敗 `/尚未確認停止/`，卻收到 `Error: 停止討論須指定目前場次。`。這是刻意的修正前對照，並非待查的不穩定失敗。
- 兩個程式／測試檔的 Prettier check 通過；`git diff --check` 通過。產品 UI 未更動，本次沒有重跑建置或 UI probes。

### 不穩定測試結論與限制

七輪完整測試（含負載驗證）、討論三檔 20 輪與 Gemini worker 10 輪，均未重現 Opus 所述的 `assert.strictEqual` / `actual: 0, expected: 1`。完整 TAP 都已保存，沒有只保留成功摘要或忽略失敗。

**尚未定位該測試，無法判定是 v2 新改動的時序問題，或 e173ad2 已有的不穩定；不可宣稱已修復、已排除或屬於基底問題。** 原失敗缺少測試名稱與堆疊，現在沒有可供同檔比較的失敗案例，因此未對主工作樹執行測試，也未為猜測擴大修改。後續若再現，需從完整 TAP 取得名稱與行號，再對同一測試及相依實作做基底比對。

完整 `git diff --stat` 收在 `logs/opus-followup/git-diff-stat.txt`，包含進場前 v2 修改，不能當成本次新增量；該指令依 Git 行為不含既有未追蹤檔案。本次只修改以上兩個程式／測試檔、此工程紀錄與索引；載入鉤子與 TAP 留在忽略的 logs 目錄。沒有 commit、push、部署、重啟、派工或啟動背景服務。

待 Opus 5.5 審核

## Opus 最終通過與發布前驗證（2026-10-15）

- 本人本輪轉交 Opus 5.5 最終審核：held-only 停止補修及整批通過，可提交、合併、部署。Opus 自述四組討論畫面測試通過；完整單元測試八輪，六輪 1689/1689，另兩輪各有 1 項及 3 項 Claude 控制器時序測試失敗，該檔單跑六輪通過。其基底 e173ad2 三輪未失敗，因此「基底既有問題」仍未被證明；Opus 依程式影響範圍判斷不擋升級。這是本人提供的審核結果，不冒稱為本次發布者親跑八輪。
- 發布者本輪獨立驗證：介面建置成功；`node --test --test-concurrency=4 --test-reporter=tap test/*.test.mjs` 完整 **1689/1689** 通過，0 失敗／取消／略過。
- 全套介面首次 **46/47** 通過（四組討論均通過），`voice-composer-ui-probe.mjs` 等待語音文字逾時。查到測試工作樹預設語音 Python 不存在，正式安裝設定指向的既有 Python 與模型均存在。只為測試程序帶入這兩個既有路徑，未安裝或修改語音程式，該項完整重驗通過。故 47 項各有通過證據，不把首次執行改寫成 47/47。
- 介面驗證沿既有測試 preload 使用系統 Chrome 拋棄式 profile 與工作樹內 Vite 快取；語音使用 Electron、人工合成音訊及既有本機 Whisper，不使用真人錄音、真麥克風或模型 API。
- 公開前檢查差異與未追蹤來源，移除本文件的本機使用者工作樹路徑及私人交接完整路徑；測試假值不當成真憑證。未修改其他私人交接文件。
- 本機發布證據存於 `.runtime/archive/discussion-roundtable-release-20261015/`，不提交測試輸出或本機資料。三家原生權限實測與部署讀回另記於下方，未執行前不宣稱通過。

## 本次部署與原生實測狀態

**南區已部署並完成讀回。** 部署版本 `06de7fe1247a8d33c182fa935367fad3a88f9fdb`；程式提交 `8277245f0da5019068e54f3d5f7a6ecee51212ac`，其後為規則與驗證文件提交。

- 原工作樹修改已提交並快轉合回 main；已合併分支刪除，工作樹保留為 detached HEAD，未清理其歷史測試證據或 node_modules junction。
- 本人確認 K 沒有工作；實際核對更新前 K 自有程序與 47831 listener 均為零，不必操作小說房暫停或強制結束工作。指定更新只執行一次。
- 更新程式本輪重新建置與完整測試 **1689/1689** 通過（預設並行，0 失敗／取消／略過），與前述 concurrency=4 的驗證分別保存。
- `.local/runtime.json.version` 為部署版本；`previous` 指向 `releases/before-1792045413311`，其保存版本為 `ab601572428a9783284727bc4a0a08efdf0154b8`。退版三份，Node 與語音路徑設定未變。正式 runtime 中 21 個相對前版變更的程式／前端／套件宣告檔逐一與指定 Git blob 相符。
- **2026-10-15 14:29:41 +08:00**：原生探測程序已關閉，K 以既有桌面入口啟動，`/health` 回 **200**；正式服務送出的前端主程式與安裝產物 SHA-256 一致。檢視 1440px 桌面六席位與 390px 手機 probe 圖片，圓桌可讀、手機卡片未超出畫面；此為人工 fixture 畫面，不冒稱已操作真人聊天室。
- 本次 candidate 根層未留下新的 `prepare-*.zip`，正式確認上一批安裝的更新暫存清理已在這次正常更新執行。未另行手動清除暫存或使用者資料。

### 一場真實訂閱討論與補充權限探測

使用剛部署的 `createDiscussionController`／`openDiscussionSession` 與真實原生核心，建立獨立人工工作區、其外部 sibling 目錄及全新測試房。未讀原聊天室、小說內容或憑證。主代理為原生目錄提供的 GPT-6 Luna，主持使用該測試房同一 native ID；參與者各一席：GPT-6 Luna、Claude Fable 5.1、Gemini 3.8 Flash（皆 high）。平行討論一場完成，未重送；本段驗證不等於真實使用者 UI 發起流程已端到端操作。

| 項目 | 實際證據 | 判定與界線 |
| --- | --- | --- |
| 三家跨工作區讀取 | 三家皆透過原生讀檔工具／唯讀命令讀出兩個未放入提示的隨機標記；工作區內外內容完全相符。Codex command 完成碼 0；Claude Read 結果直接含標記；Gemini 有 view_file 事件及正確隨機標記。 | 本次指定人工檔讀取通過，不外推為所有路徑或敏感資料都已測過。 |
| Gemini 防寫 | 同一討論中 write_to_file 與 run_command 均有原生 deniedTools／拒絕事件，指定兩個測試檔不存在。 | 原生工具層的寫入與命令 deny 通過；不宣稱驗證 Windows ACL。 |
| Claude 工具與 hook | 原生 initialize 回應未提供工具名（空陣列），不能當成沒有工具。另以相同 discussionOnly 設定送一個僅回覆 OK、不用工具的 metadata 補充回合，捕獲 system/init 清單精確為 Glob、Grep、Read、WebFetch、WebSearch；沒有 Write/Edit/Bash，人工 SessionStart hook 的檔案不存在。 | 工具白名單與 safe-mode hook 隔離通過；不是作業系統層拒寫測試，亦未重送原討論。 |
| Codex 防寫 | 討論參與者 readiness=ready，但模型遵守唯讀指示而未嘗試寫入，所以那一場本身不足以證明沙盒阻寫。另透過同一已安裝核心、K 專用 home 的原生 command/exec 明確指定 sandboxPolicy={type:readOnly}；readiness 仍為 ready，對工作區內及外的兩個全新人工檔各做一次 wx 寫入，兩者皆 EPERM，檔案均不存在。 | 原生唯讀沙盒補充探測通過；明確區分模型討論與不經模型的沙盒命令探測。未放寬權限、未改成 API 或外部沙盒。 |
| 主持與收尾 | 討論 status=completed，主持前後 native ID 相同；所有人工寫入 sentinel 均不存在，測試 controller／host 關閉後才開回正式 K。 | 本測試房真實主持通過，沒有操作／重播原小說房工作。 |

Codex 補充命令依[官方 App Server 文件](https://learn.chatgpt.com/docs/app-server)及本台核心產生的 CommandExecParams schema 核對：該入口不建立模型回合，明確傳入 readOnly 政策。命令本身捕獲 EPERM 後正常結束，因此 command/exec 的 exitCode=0 不代表寫入成功，判準是逐目標 wrote=false、code=EPERM 與實體檔不存在。

原始證據：`runtime-readback.json`、`update.log`、`health-readback.json`、`ui-readback.json`、`live-permission-result.json`、`native-enforcement-supplement.json`，均在本機發布證據目錄，不上傳原生回覆、測試路徑或本機設定。文件與索引另開提交，不重啟 K。東區未更新，未改帳號、登入或計費。
