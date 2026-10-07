# 子代理協調全流程稽核與舊工單收尾（2026-10-07）

## 範圍與部署狀態

- 本人要求不再只改畫面，參考 Codex、OpenCode、Claude Code、OpenClaw 與本機 DSH 官方原始碼／文件，檢查工作協調與 K 各功能的接線。
- 本批在 `C:\Users\Paulus\.codex\worktrees\k-mobile-remote\K-harness` 實作；基底 `8f7b019b63b1ed8b954400eb3b4078acd1ee44e6` 保留前批聽寫切房修正。
- **本輪尚未部署。** 最初本人要求改好後先停；之後追加功能性對照並明確要求「全部修好後直接更新」，再告知「K Harness 關掉了」。完成必要驗證／真正 Opus 複查後，可依固定版本流程部署；仍不強停或重播。正式程式目前實讀為 `6dbd8cfb733e144c14c35b8077611a0028fa8936` 為準，收尾時再核對。
- 不操作真實翻譯目標、不重派、不切帳號、不修改真實工單或小說檔。沒有增加人用管理按鈕、排程或另一套代理核心。
- 本輪實查既有 GitHub 為公開庫，與舊 SOP 的私人描述不同；另向本人確認，明確回覆「允許推到目前公開庫」。本批驗證／正式讀回通過後可推既有 origin/main；只含程式、合成測試及去除真實工單識別碼的工程紀錄，不含登入、金鑰、原對話或工作檔。這不是擴張其他專案或往後資料發布授權。

## 已確認根因

真實畫面所列的是較早的翻譯舊工單，不是最近工作又重新卡住。該紀錄 `status=unresolved`、`settled=false`、`executionUnowned=true`；舊 PID 不能當現存工人使用，空 outputFiles 也不能證明沒有落地檔案。相關 review 工作成功，不等於原翻譯完成或停止證明。真實 requestId 與原始讀回僅保留本機排除發布的工程證據。

上一批已讓主代理用 K 的 list/inspect 查到工單，不再誤查 Codex 即時 list_agents 或依賴 Chrome；但仍缺「查過後留下處理結論」入口。加上以下同類問題，使使用者反覆面對待確認：

1. 沒有可保存、可修正的歷史查核註記，已查過的舊工單仍永久掛在待處理。
2. `input-queue` 和主回覆完成提醒仍把不屬於本次執行的舊紀錄當成在等的工人。
3. 原生 `thread/read` 只因 thread 為 idle/notLoaded，就可能把缺回合、queued 或未知回合當 completed。
4. 未 settled 的 failed 結果會使用完成通知 ID 並解除監聽；unknown 通知與真正終態混用，後續實際完成可能被吃掉。新 unresolved 也未立即交主代理判斷。
5. 擴大稽核重現：待送訊息通過就緒檢查後，先等待磁碟保存；這段空窗若同聊天室開始目標操作，訊息仍會送出，與原生目標更新競爭。直接 send 入口也未拒絕 goalPending。

## 公開實作對照與取捨

以下是 2026-10-07 實讀公開來源，並非聲稱外部產品不會故障，也不是把 Codex App 私有实现當作全公開。使用者口語「APU」未能唯一辨識，本批沒有假稱已查一個不存在或不確定的專案；另以明確的 OpenCode 作開源比較。

### Codex

來源固定於 `24edd7b89026865149d58d0a090694a2146b6d3c`：
- [agent/control.rs](https://github.com/openai/codex/blob/24edd7b89026865149d58d0a090694a2146b6d3c/codex-rs/core/src/agent/control.rs)：即時 agent 清單與狀態監聽不同於歷史工單；completion watcher 等原生終態後通知父代理，樹關閉不假裝是子任務成果。
- [父子關係持久化](https://github.com/openai/codex/blob/24edd7b89026865149d58d0a090694a2146b6d3c/codex-rs/state/migrations/0021_thread_spawn_edges.sql) 與 [spawn/resume 路徑](https://github.com/openai/codex/blob/24edd7b89026865149d58d0a090694a2146b6d3c/codex-rs/core/src/agent/control/spawn.rs)：持久 thread 關係、rollout 與執行中 registry 各有用途；不能從當前清單缺席推斷全部歷史都結束。所讀子樹恢復分支有 V1/V2 差異，不宣称所有路徑均有重啟自動恢復。

採納：K 的 Gemini 跨核心工單必须走自己的 requestId／父對話查詢；只接受明確原生終態；狀態注意與完成通知使用不同收據，不重造 Codex 原生代理調度。

### Claude Code

[官方 sub-agents 文件](https://code.claude.com/docs/en/sub-agents) 說明子代理 ID、獨立歷史、背景完成通知，以及重啟 Claude Code 後恢復同一 session 可再 resume 子代理。這是公開文件核對，**不是完整核心開源審查**；可恢復歷史不等於證明舊程序已停止，亦不保證任意跨核心工作或完成通知 exactly once。

採納：保留原身份與歷史，恢復／取消／新派工不是同一操作；K 只補跨核心協調，不以重新派工冒充恢復。既有 Claude 原生子代理仍由原核心處理。

### OpenCode

來源固定於 `ecc4916b5a9608c30e6dd58a67f2137b594407ca`：
- [task.ts](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/opencode/src/tool/task.ts)：task_id 維持子 session 身份，背景 job 完成／錯誤分別回父 session，取消另處理；背景子代理在所讀版本需 experimental flag。
- [background-job.ts](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/core/src/background-job.ts)：明註 process-local registry 非 durable；重啟／scope 關閉不是可靠的歷史查核庫。相同執行的 token/sequence 避免舊事件覆蓋新狀態，wait 期限與工作生命週期分開。

採納：保留 K 已有 revision／parent scope／原生終態判斷與非破壞等待；將歷史處理與 live execution 分開。不因此新增 durable supervisor、接管舊 PID、重播或新增帳號／記憶環境。

### OpenClaw

使用者口語「OpenCloud」本批按可能的 OpenClaw 查閱，但不宣稱名稱已確認。官方來源固定於 `45b18e215b548d55624905cbc7febbec479f9d19`：[restart-recovery.md](https://github.com/openclaw/openclaw/blob/45b18e215b548d55624905cbc7febbec479f9d19/docs/gateway/restart-recovery.md)、[subagents.md](https://github.com/openclaw/openclaw/blob/45b18e215b548d55624905cbc7febbec479f9d19/docs/tools/subagents.md)。

重啟恢復區分 child run、父對話及通知來源身份：中斷的子代理先保存 interrupted 結果而不自動重新派工；以当前身份和父生命週期辨識過期紀錄。通知恢復有 admission／claim／receipt，pending claim 不代表已送達，也不是外部收件端 exactly-once 保證。各工具、程序及 session 的跨重啟能力不同，不能概括成全部工作自动續跑。

採納其分離「已接收／已執行／結果可查／通知嘗試」的語意；K 保留原 requestId、原父對話及通知防重。K 現有 delivery-attempted 是本機不盲目重送的記錄，**不是已收到模型回覆的證明**。不搬入 OpenClaw 的 SQLite admission/recovery 框架或自動恢復主工作政策。

### DSH 官方原始碼副本

只讀 `D:\DSH架構\DeepSeekHarness-0.1.5-rc.2-official`，版本 `d2aea3874612d53aa750a0e9c9a45d983c09b2ef` 的 architecture、agent-lifecycle、core／subagent 文件；未改 DSH、未讀執行資料或憑證。其 durable SessionEvent 與即時 agent 活動有別，session 歷史由已提交事件產生；程序硬中斷前未落盤的串流不能當成持久成果。

採納證據層級區分，不將即時狀態當歷史真值。DSH 自己擁有核心的 session writer；K 不擁有三家原生歷史，不能照搬成第四套核心。

## 最小完整修正

### AI 可收尾，不把管理工作交給人

- `luna-bridge.mjs` 增加本父對話限定 `reconcile({requestId,summary,evidence})`；gateway 依接法提供 `gemini_reconcile` 或 `luna_reconcile`。
- 只接受失去本次執行歸屬、未 settled 的 Gemini 舊工單；目前持有／執行中、其他供應商、不同父對話、不存在或已 settled 紀錄拒絕。
- 沿用既有工單 JSON，增加單一 `reconciliation` 註記，包含結論、實讀證據／限制與伺服端時間；同內容重送不變時間，錯誤結論可修正。沒有新增工單狀態或另一個資料库。
- 先 atomicWrite 成功才發布註記；磁碟失敗不使記憶體／UI 假稱已處理。沿用既有操作序列，關閉中拒絕。
- inspect 回傳原任務，list 帶已處理標記。原生入口自動附指引：list → inspect 原任務 → 看實際檔案及相關紀錄 → 記結論；失敗檢查不能寫成查無結果。
- **不改 status、settled、acceptance、原錯誤或成果來假裝成功；查核註記不是完成、停止或新派工授權。** 不觸發 resultReady，不能吃掉完成通知。

### 等待、畫面與通知分開

- 桌面／手機已處理歷史折疊於「已核對的舊工單」，明列「非完成或停止證明」；尚未處理仍保留舊紀錄警示。當前 owned unknown 仍顯示待確認。
- input queue 與主回覆完成提醒不被 executionUnowned 歷史紀錄當作活工人阻塞；查核註記不放寬帳號切換、交接、移動、刪除、分支等停止安全條件。
- native-workers 與 luna-bridge 不再因 idle/notLoaded 就宣稱 completed，需明確終態回合；bridge 仍保留「已要求取消、沒有任何回合、原生 idle/notLoaded」可判 cancelled 的既有例外。原生 owned unknown 仍會阻止宣稱停止，以及需要停止證明的工作區切換／移動；一般切到另一個已有聊天室不等於移動工作區。
- failed/unresolved 且未 settled 送「狀態待確認」，不是「完成」。注意與完成通知 key 分離；注意通知送出不解除真正完成監聽。一般 unconfirmed 通知同工單只一次，之後再次轉 unknown 不再重複喚醒；既有獨立 quiet episode noticeId 與最後完成通知仍保留。排隊注意若原狀態已變、已結束或成歷史即丟棄。
- 保留明確取消會解除自動喚醒；仍不因觀察逾時、安靜或未知重送工作。
- 待送訊息保存完成、真正呼叫核心之前，再檢查同一對話、停止代次、目標及目前工作狀態；發現變更時保留 queued 並暫停佇列。Codex send 的入口及權限重開後也拒絕未完成的目標／submission，且這兩個確定未送出的拒絕標記 notSent，佇列不誤標 uncertain；其他結果不明仍保留 uncertain、不重播。正常忙碌回合的立即 steer 保留，但 goalPending 期間也先保留排隊，避免撞上目標操作。

## 全流程核對矩陣

| 階段 | 核對結果／必要約束 | 主要檔案與回歸 |
|---|---|---|
| 派工身份 | 既有 requestId 同內容回既有結果、不同內容拒絕；父對話目錄範圍不變 | luna-bridge / gateway tests |
| 活動與核准 | 真活動時間與讀回時間分開；核准等候不當卡死；安靜只作觀察 | worker-watch / work-activity tests |
| 失敗／未知 | 不當成 completed；注意通知不消耗最終收據 | worker-watch / codex-flash / claude-controller tests |
| 完成通知 | 持有工人終態回原父對話、手動已讀防重、送出不明不盲目再送 | codex-flash / claude-controller tests |
| 取消／關閉 | ACK 不等停止；只處理本次持有工人；unknown 不接管 PID | luna-bridge / native-workers / controller tests |
| 重啟讀回 | 明確原生終態才 settled；無 owner 的 Gemini 留原證據、不重播 | native-workers / luna-bridge tests |
| 歷史收尾 | 本對話主代理檢查實際成果，原 unknown 與處理註記分開，重開保留 | worker-reconciliation tests |
| UI／佇列／提醒 | 已處理舊紀錄不長掛待處理；歷史不冒充活工人；owned unknown 仍阻塞 | work-activity / conversation-controller / input-queue / completion-attention + UI probe |
| 帳號與交接 | 註記不是停止證明，不允許借此 switch／handoffFrom unknown | gemini-accounts / worker-reconciliation tests |

### 擴大功能性稽核

| 功能 | 實際核對／處理 | 證據與界線 |
|---|---|---|
| 對話切換／背景工作 | focusLock 拒絕重疊導覽；控制器依來源對話保存回調與停止目標 | conversation-controller / controller 回歸，未找到可重現錯房 |
| 目標／待送訊息 | 重現保存途中開始目標的競態，補送出前重查與直接 send 防護 | 假控制器 deterministic probe；不恢復真實目標 |
| 附件 | 上傳開始固定來源 threadId，原始串流不整檔 Base64；回覆遺失不重送 | attachment-stream UI／HTTP 回歸；不送出真人影音 |
| 聽寫 | 前批修正已轉錄時切房保留、結果回原草稿；返回不重啟、取消／失敗不覆蓋別房 | voice-room-switch built UI 假辨識；不等於本輪實際麥克風驗收 |
| 手機重連／登入 | SSE 恢復只讀狀態，命令 ID 在派發前保存；重複命令拒絕、結果不明不自動再送 | mobile-remote UI／remote-access tests；非 Android 實機 |
| Gemini 額度 | 原有 refreshAll 閒置排他、官方逐帳號查詢、最後恢復原帳號；中斷只恢復而不重跑查詢 | gemini-accounts tests；本輪不切真實帳號 |
| 黑窗／不搶前景 | 保留已部署共用派工規則与原生 hidden spawn；規則不是任意子命令的強制攔截 | 前批 console 診斷與既有測試，不宣稱所有代理永不違規 |

「未找到缺陷」只代表本輪已列程式路徑與回歸範圍，不是完整安全證明或所有外部服務皆驗收。

## 驗證與限制

- 本批初版全測 935/935；加入 lifecycle 補修後 945/945，佇列／目標競態修正後 949/949。最後 notSent 補修後來源全测 950/950（121,922.78 ms）；固定候選结果另列，不以較早測試替代。
- `test/worker-reconciliation.test.mjs` 4 個 composite cases 通過：持久化、修正／冪等、範圍、owned 拒絕、存檔失敗、gateway 白名單／前綴、handoff 仍拒絕 unknown。
- UI built probe：1440×960、390×844，收合／展開四張截圖，0 API 寫入、0 模型呼叫，保留未處理／已查歷史／owned unknown 分類。主代理已獨立看桌面及手機展開圖；這不是 Android 實機驗收。
- 擴大 UI 回歸實際重跑 `attachment-stream-ui-probe`、`voice-room-switch-ui-probe`、`mobile-remote-ui-probe`，全部 exit 0、stderr 空白；合成附件／假辨識、built UI 與獨立假 HTTPS，涵蓋來源草稿、切房、失敗／取消、登入失效、離線重連及已接受但回覆遺失不重播。證據 `.runtime/worker-reconciliation-20261007/functional-probes`，未接觸正式工作或真麥克風。
- 真正 Codex 原生 `gpt-6-luna/high` 透過 K 的真 gateway／bridge 操作合成舊工單：list → inspect → 讀兩個合成成果檔 → reconcile；以原生 thread/read 工具紀錄核對（`native-luna/native-tool-evidence.json`），不是只採模型自述。fresh account/read 與 model/list 核對、原始結果仍 unknown、沒有 Gemini 工作／取消／換帳號。原生 thread `01a1139a-6236-75c0-97e6-2e77a7a7db4f`。
- 上述首次實測的模型把一次失敗搜尋描述成查無後續資料；**不算證據措辭全部通過**。因此新增「失敗檢查必須列未驗證」指引，並將只寫一次的註記設計修正為可更正，不用新歷史框架掩蓋模型錯誤。
- 第二個全新合成 fixture／原生 thread `01a113a0-a0e6-7ba0-a3ea-42da51e7de36`，真正 Luna high 接到既有錯誤註記後重新 list／inspect／讀實檔，透過 reconcile 改正並明列搜尋失敗與範圍限制。原 unknown、settled=false、not-reviewed 保留，0 start/cancel/account；以原生 thread/read 再讀實際工具及命令輸出核對。
- 證據：`.runtime/worker-reconciliation-20261007/{ui,native-luna,native-luna-correction}`，沒有把合成工單當成正式舊工單驗收。
- 第一輪真正 Opus 5.5（官方 Claude 訂閱、唯讀包，session `ee451cb5-e2f1-499a-81eb-78648018991d`）未發現 P1/P2，要求精確記錄取消例外、unknown 對停止的影響、每工單注意次數與實測依據；已納入。它未讀外部來源或 runtime 證據，這些由主代理獨立核對。後加佇列競態需再複查。
- 第二輪整合 Opus（session `37be0538-9e23-4587-880b-faffc1879457`）未發現 P1/P2，另指出 submission 收尾空窗的 P3 誤標 uncertain：主回合完成後、送出函式仍在保存資料，佇列可能過就緒檢查但被 send 拒絕。採納 notSent 的最小補修與 regression，不新增錯誤框架。goalPending 期間立即送入也保留排隊的文案已如實記錄。
- Opus 另推測低層 queue.load 在送出保存途中切到別房；主代理再讀上層確認每聊天室各自擁有控制器／queue，且 unified.open 拒絕 queue.sending、分支拒絕待送內容，正常切房只改畫面投影。未取得產品入口可重現證據，未為低層任意組合新增機制；保留其審查原文，不冒稱修過一個未證實的 bug。
- 第三輪真正 Opus 5.5 聚焦最後 notSent 與上層 queue 歸屬（session `918c04a8-dde9-421d-8c3b-090c4508a30d`），結論可合併、沒有阻擋問題：兩個帶標記的檢查均在 native dispatch 前，一般 steer 保留，產品每房獨立 queue 且 sending 時不能重開。它未自行跑測試／正式環境，提及缺少跨層單一串接測試；已有 controller 零 dispatch 與 queue 分段 regression，未為低風險屬性傳遞再新增機制。
- 待收尾：固定候選建置／全測與正式部署。正式舊紀錄仍未寫入註記，須套用後由該主對話按原授權查核；本工程不擅自修改小說或恢復目標。
- 突然斷電、原生程序失聯、遠端工具已產生副作用但回覆丟失，仍可能留下未知結果；不能承諾「絕不再有未知」。本批修的是可發現、可處理且不冒充活工人的閉環，不是抹除證據或以重播消除警示。
