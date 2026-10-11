# 原生主回合失敗後：先核對成果再接續

狀態：候選已實作；正式仍 cfd4eba（產品 e3f2ecd），本功能未部署。工程基底 8b75fbc。上一個產品凍結版的真正原生假資料 E2E v2 已由 Astra 獨立讀回通過；真正 Opus 5.5 首次 code review 找到三項阻擋，已最小補修並凍結，目前產品凍結20a540f0已通過真正 Opus 最後產品複查、E2Ev4及零模型空房正常關閉，完整1287/1287、必要fixture短複查亦通過，Astra已獨立接受本批候選；先前 Opus 只有只讀方案討論，不當成本批 code review。未操作原小說房、換模型／帳號、變更核心／計費／全域設定、push 或更新東區。

## 使用者要求與改變

本人允許「核對後自動接續」，不是忽略壓縮警告，也不是讓高階模型一直推理待命。先前 K 忠實保存 failed，但主回合 failed 後既有 dispatch 只接受 completed，沒有先核對成果的接續回合。本批把一次核對接到原有 dispatch，而不另造排程／重試核心。

- 等待工人／背景命令與只讀原生狀態由 K 程式做，不新增模型生成。
- 資格成立後才呼叫同一主代理核對與接續；這部分使用原訂閱模型額度。原生 retry／compact 本身也不能宣稱免費。
- 原生服務 compact／stream 的內部失敗原因仍 UNKNOWN。本修解決終態後可安全協調的 K 接線，不宣稱供應商故障已修。

## 最小接線與界線

`src/desktop-controller.mjs`：

1. 只記本次 live 主 turn 曾屬 active 的公開目標；PublicThreadGoal 沒 goalId，以 threadId、createdAt、objective、tokenBudget 加既有 requestEpoch 綁定。不從 open/history/restart 建恢復意圖。blocked 在 failed 前先通知、或 failed 後才持久化，都保留這次 active 歸屬。
2. 同 turn 明確 failed 才建一個記憶體候選。固定原生錯誤 enum 的 context／budget／usage／rate／auth／permission／security／badRequest 等硬限制，以及 HTTP401／403／429拒絕；Other 的公開型別允許未來分類，因此不以 allowlist 排除未知合法服務錯誤、不猜 message。缺失終態 error 不能當可恢復證據。
3. 在 `deliverFlashResults` 獨佔範圍讀最新 goal、thread idle、latest exact failed、全部相關 child settled、parent＋loaded children 原生背景清單空、無待核准／提問。每 await 檢查原 host/thread/epoch/目標/選項；既有 workerRead 防止讀取期間新子回合的舊快照派送。
4. 原生 active 自行進展時讓路；同 goal 暫時仍 active 則等 blocked，不把通知順序差異丟掉。UNKNOWN／仍執行僅沿既有 1→2→…30秒唯讀 recheck 等自然結束，不中止工作、不呼叫監工模型。
5. 單次 `thread/loaded/list` 以公開不設 limit 的完整清單核實本 host loaded 範圍；只重讀 loaded 或未確證 settled 的子代理。已核實 settled 且 unloaded 的歷史不每次重掃，也不對已卸載房送 background RPC。缺欄／錯誤／不完整頁不是空清單。普通 workers／stop 原契約不變。
6. 已 settled 工人通知與核對合成一次 `turn/start input:[] + toolOutput k_native_goal_recovery`，保留 thread/model/effort/serviceTier/原生權限。送出前消耗一次資格，不先將 goal 改 active、不先 compact、不偽造 user message。
7. 核對指示要求主代理先讀 `k_gemini.conversation_context` 最新本人意圖，再讀實際已保存檔案及工人結果；已完成不重做、副作用／結果未知不重送或重派。確認原目標仍適用且有剩餘工作後才用既有 trusted automatic `goal_resume`。已全部完成則記完成、不恢復。
8. `src/luna-gateway.mjs` 與 controller developer instructions 僅增加這個受信任當前核對回合的授權例外，其他 toolOutput／歷史摘要不能當授權。goal_resume 每 await 再核 exact audit、同 goal 及撤銷，無新 origin 偽裝。
9. pause/stop/edit/clear/newsend/open/close/hostloss 撤銷。未送出只讀 preflight 期間本人新訊息可正常送出並撤銷候選，不因隱藏 busy 鎖住人。保留已送 audit 身分到其終態，以拒絕本人撤銷後舊 audit 的 goal_resume。
10. 核對自身成功／失敗不 rearm；後續同目標非核對 active 工作正常 completed 或本人交代新工作才重具資格。重複 terminal、已知拒絕或 transport ambiguity 不重送。原 failed raw/details/partial 保留，沿現有 notice/tool 呈現「核對已存成果」。不加面板、設定或另種狀態。

### 目標預算（工程限制，不是另一條人類禁令）

固定 native 0.161.0 的 blocked 核對不納入原目標計帳；mid-turn goal_resume 從當下 baseline 計後續用量，不能追溯 audit 消耗。公開 TurnStartParams 無原子「附核對指示＋掛同 goal 計帳」入口。因此本次僅無顯式 tokenBudget 自動核對；有預算保留人工明確恢復，不暗中在預算外生成，不重設預算／用量、不造 K 計帳。這不是宣稱有預算工作不能繼續。

### 公開協定競態限制

公開 toolOutput 的 turn/start 是 StartOrSteer，沒有 CAS／expectedPreviousTurnId 或 started/steered 回傳欄位。K 以 fresh idle/latest failed 讀回、單一 dispatch/local reservation 和本機事件讓路；未知外部 client 在查核後搶開 turn 的競態仍不能宣稱完全原子隔離。原生背景清單也不是任意脫離原生管理的 OS 程序清單；未知副作用仍須主代理核對。

## 固定官方來源

原生 0.161.0 public commit `979011409de0a60b52f179721948e65531d26144`，本機摘錄與精確行號在 `D:/K-harness/.runtime/native-goal-recovery-20261011/source-proof.md`。

- `app-server-protocol/src/v2/thread.rs` PublicThreadGoal、TurnStart 公開 shape；`app-server-protocol/src/v2/shared.rs:76–135` CodexErrorInfo/Other forward-compatible。
- `app-server/src/request_processors/thread_processor.rs:960–975,2403–2434,2777–2823`：background 只取 loaded runtime；loaded/list 省略 limit 取得完整 loaded IDs。
- `app-server/src/request_processors/thread_lifecycle.rs:434–469`：ShutdownComplete 才 remove，timeout 保持 loaded；`core/src/codex/handlers.rs:288–311` shutdown 終止原生管理程序。
- goal `extension.rs:248–282`／`runtime.rs:225–241`／`accounting.rs:305–333` blocked audit 與 midturn accounting 限制；turn_processor.rs 公開 toolOutput StartOrSteer。

## 回歸與可觀察證據

新增 `test/native-goal-recovery.test.mjs` 36項真 controller／假協定回歸，零模型：live ownership、原始 error／partial、child/background 自然等待、無 budget／已有 blocked聊天、hard error、stop/edit/revocation、one attempt／正常進展 rearm、transport/rejection不重送、UNKNOWN自然恢復、active midturn、舊ACK／resume await、future分類、failed→blocked延遲、人類preflight新送，以及300個 settled unloaded＋1 live child不在 recovery timer 重掃 history／不對 unloaded 查背景。

- 有效初始 RED：4 pass／6 fail（`implementation-red-observable.log`）；更早兩次 fixture 初始化缺陷完整留存，不當產品因果證據。
- 首次 GREEN：9 pass／1 fail，失敗為 uncertainty fixture 正常關閉需先沿既有 stop reconcile；修 fixture後10/10。
- Astra 中途指出四個直接契約反例，追加可控 RED 0 pass／4 fail（`parent-review-red.log`），最小補修後相稱 focused **131/131**（`focused-revised-green.log`）；alias 必要補修後 **132/132**（`focused-accepted-green.log`），原 no-active-goal capacity/no-retry 與 pending-only native-wakeup 契約仍 green。
- 首次完整固定4並行1271項：1269 pass／2 fail，保留 `full-concurrency4.log`。未改的 browser-native-profiles descriptor token 讀回第一次不等，單檔複核 pass，歷史內因 UNKNOWN；conversation-native-regression 的 fake completion 用舊 local roomID 拼 turnID，與實際 turn/start native ID 不同，僅修 fixture 取 actual latest RPC params，保留精確 terminal 與 queue/no-replay 斷言。
- loaded/list raw native ID 與 K stable local alias 必須同識別域比較，補 parent/child/cache 三處比較及 alias 回歸；正確 active alias fixture RED1/1 → 新回歸 GREEN21/21。最早 alias fixture 因 close 原本就將 active goal 暫停而未再啟用，另記診斷不當成產品證據；修 fixture後保留真正門檻 RED。
- 第二完整 run1272項：1271 pass／1 fail，當時 alias fixture未重設 active 的同一測試初始化錯誤，不能當已全綠。其原 `full-concurrency4-final.log` 被本輪最終1287/1287誤覆蓋；原錯誤摘要／工具輸出與獨立alias診斷仍有，但未找到完整原run存檔，不能宣稱所有原始log都保留，未合成復原日誌。最終完整固定4並行 **1272/1272**（`full-concurrency4-accepted.log`，65.06秒），無 skipped/cancelled。
- UI build 成功（既有 chunk-size warning），`build-ui.log`。
- 主代理首次真正原生假資料 E2E 使用 [IO.File]，在原生 workspace-write ConstrainedLanguage 不允許，未建檔；已確認回合終態並正常關閉，不當成 recovery 故障或 E2E pass，改正常 Set-Content 在全新假 thread 重驗。
- 真同模型假資料 E2E v2 已通過，Astra 逐項獨立讀回 `native-e2e-v2/astra-readback.json`，source hash與凍結controller `1ea7ad977b4d0626d8e42a55a34ee1ed656702f884aad90a56a88df11e651e56`一致。新 Sol 原生 thread `01a12a5d-eaa7-7bd0-a207-0c6a162d7d1b`，同thread/model/tier/核准/沙箱；僅2次 turn/start（初始工作＋一次核對input[]），0原房操作。UTC09:49:44.088 conversation_context→09:49:56.120成功Get-Content證明A存在／B不存在→09:49:58.973 automatic goal_resume→09:50:05.627只寫剩餘B並讀回兩檔→原生goal complete。A hash/mtime保持，raw failed留存，自有host正常idle close。
- v2 核對模型首次嘗試.NET讀取同樣被原生ConstrainedLanguage拒絕，失敗保留；自行改正常Get-Content成功後才resume，不改權限。故障是原生回合已結束後的K-boundary terminal/latest-summary精確注入，不是供應商真compact outage重現。這證明成果核對順序與接線可用，不能宣稱服務端故障已治。
### 真正 Opus code review 後的必要增量

- 官方訂閱真正 Opus 5.5 session `d0e7c8d4-2843-496a-a9a3-45bc24cee51a`，18次 Read/Glob/Grep，`opus-code/review.md` 指出三項阻擋。Astra 獨立同意後才補修；首次 review 不能當作已通過。createdAt 公開 i64 與 E2E 實際數字已核實；review 封包中的舊 full/E2E 狀態是當時快照，不改寫當時失敗紀錄。
- 未送出 batch 在 persist/markSubmitted await 間被撤銷：改在 finally 刪除未送 marker 並保存；同 host/room/epoch、未 stop/pause 且 recordCurrent 才放回原佇列。human edit 與 workerRead 競態可留待後續派送；停止／暫停不復活工單。保留最後 workerRead guard，不採 review 的移除建議。
- 明確 protocol rejection 且無已觀察 audit turn，清未綁 claim；transportunknown 留 revoked 身分及現有 flashDeliveryUncertain，人工 active/compact 不能繞未知。已確認 stop/read idle 後才清未綁 claim；若讀到 active turn 則先綁 exact ID 再沿原 interrupt。明確人類 active RPC 成功、同 epoch 且沒有較新的 stop/close 後才解除 stopRequested，不由任意 active 事件解鎖舊停止工作。
- 合法人工 compact 在只讀 preflight 先撤銷候選，正常沿原生 compact RPC；不先行壓縮作為恢復措施。
- 三阻擋可控 RED **0/7**（`opus-blockers-red.log`）→ GREEN；persist fixture 只在精確唯一 source await 後插入 promise gate，隔離檔 import 仍指向真來源，不改產品 signature/fs/global、不是未加工 native 證據。對 stop→human resume 的控制 RED **0/1**（暫時只移除人源 stopRequested reset，try/finally 原樣恢復）→ GREEN；另 native pause 先於 transportunknown 的反例 RED **0/1**，補上同房 unknown 保存後 GREEN，晚到 revoked audit 仍無權 goal_resume。
- 上一輪凍結新回歸 **30/30**（`opus-blockers-green.log`）；六檔相稱 focused **141/141**（`focused-opus-blockers-green.log`），無 skipped/cancelled，原 no-active-goal/no-retry、native pending-only 通知契約仍 green。該輪 controller SHA256 `927e5945ae4a7f56e9ab30f52196d5bf5cf6b1e63d3023d4764529c59b00b23f`；gateway 未追加變更。本輪完整固定4並行 **1281/1281**（`full-concurrency4-opus-blockers.log`，61.31秒），0 fail/skip/cancel；UI build pass（`build-ui-opus-blockers.log`，既有 chunk warning）。新 E2Ev3 下列已通過；真正 Opus 增量驗收進行中，未部署。
- 上述 E2Ev2 證明的是舊凍結版正常成果核對順序，不冒稱涵蓋本輪競態補修。該輪凍結 controller `927e5945…` 的真正原生 E2Ev3 已 PASS，Astra 獨立驗收 raw 事件／工具／檔案，證據 `native-e2e-v3/astra-readback.json`。新 native thread `01a12a6c-94c2-7b41-87fa-00006a066024`：UTC10:05:48.461 conversation_context→10:05:49.206成功讀已保存A→10:05:52.604 trusted automatic goal_resume→10:05:59.524只寫剩餘B並讀回兩檔→goal complete。2次 native turn/start／1次audit、同原生選項；A SHA256 `37e596c0c3f61e0279a7c91bf182c21d805b4d6708030f0ec03bf844c926c39c` 與mtime不變，10:06:07.629正常idle close，零原房操作。
- v3 同樣只是原生初始 turn 確實完成後的 K 邊界 failed/latest-summary 精確注入；真同模型與工具核對成果、再接剩餘可用，不等於服務端真compact outage重现、無限長工作保證或已部署。真正 Opus 增量 evidence 目錄 `opus-final` 的 session `95be6fb1-3342-4342-8776-4ecfd8ce11bf` 已完成：確認原三阻擋修好，另提 systemError/notLoaded 停止受阻的條件阻擋與 implicit-active 風險。Astra 查固定官方來源後採最小補修；此 review 尚不能代替補修後的末審。

### 原生狀態與未知送出限制的末審補修

- 固定官方 ThreadStatus 確有 systemError/notLoaded，但 systemError 僅證明當時 loaded 非 running／無待核准提問，不證背景命令清空；仍走原 stopThreadTerminals 實際 clean/readback。notLoaded 是本 host 已卸載，background RPC 反而拒 thread not found。只讀來源與精確行號追加於 `source-proof.md`，不以 Opus 記憶擴白名單。
- reconcile 只接受 idle/systemError/notLoaded，active無ID／缺漏／未來未知仍拒絕；本次查核結果局部傳給 stop。parent 的 stop/close/open/selectWorkspace 四個已存在背景清核入口共用最小局部 helper：必要 fresh thread/read includeTurns:false，只確證 notLoaded 才略過 parent background，其他狀態仍原樣清核。沒有持久狀態、重載／重派或更改通用 background/worker 模組。
- native goal/set omitted status 取 existing status，沒有 goal 則預設 active，可直接啟動 idle turn；unknown delivery 不能用 clear→objective-only 新 goal 繞保護。active結果（含 editOnly 的 fresh goal/get）仍拒絕，原 paused/blocked 文字編輯與 clear 允許，不改原目標／預算策略。
- 有效 RED **3 pass／3 fail**（`opus-final-native-status-red-valid.log`）涵蓋 systemError背景、notLoaded stop/close及implicit active；缺漏/active無ID/future未知三項保持拒絕。只修 stop 的中間 GREEN5/6 如實保留，剩餘 failure 正是 notLoaded 在 close 又查 parent background；採上述共用 helper 後通過。再以 stale cached blocked、fresh goal/get active 的同一編輯路徑 RED0/1→最小GREEN，不讓 stale state 繞 unknown。
- 當前 frozen controller SHA256 `20a540f09272d6a1014f964eec45b5553277180ab9b44618ac32ee2a7635a16c`；新檔36項，六檔 **147/147**（`focused-opus-final-status-green.log`），diff-check通過。UI build成功（`build-ui-opus-final-status.log`，既有 chunk warning）。本hash產品末審、E2Ev4、零模型native空房關閉見下；v3真模型證據仍只對上個927e5945來源，不改寫歷史證據。
- Opus 建議 Flash 在 pause 後重新放回核對批次，Astra 未採：明確暫停不應藉撤銷中的核對復活通知；原工人結果／保存檔仍可讀，不是原成果資料刪失。未改這條契約或加新恢復策略。

### 最後產品驗收與 metadata fixture 契約補正

- 官方訂閱真正 Opus 5.5 `opus-acceptance/result.json` session `4f876a86-8339-437a-9865-2f80857978b7`：只讀對照三輪產品差異與固定原生來源，無阻擋；Astra 獨立讀回接受20a540f0。這不宣稱Opus自行跑過tests，也不把後加test-only微diff冒稱已讀。
- 當前20a540f0真同模型E2Ev4 PASS，Astra獨立raw事件／工具／檔案驗收，`native-e2e-v4/astra-readback.json`。新thread `01a12a75-d4a7-7060-9014-cf7a5910bd74`：UTC10:15:51.615 context→10:15:56.371實際讀已保存A→10:15:59.528 trusted automatic goal_resume→10:16:07.245只寫剩餘B＋兩檔讀回→complete；10:16:13.071正常idle close。2 starts／1audit、同native selection；A hash `ea2d0507044eac2b81a43edc7e612799a8ed853a21008a27a70de419be7d3763` 與mtime不變，0原房操作。故障依然是原生完成後的K邊界注入，非provider compact outage重現或無限工作保證。
- 同hash零模型native空房open→未送出直接close PASS，`native-empty-close/result.json`，thread `01a12a78-5f48-7dd3-ab04-b629d156e576`。實際metadata thread/read includeTurns:false成功，0 turn/start／0 goal mutation，正常自有host關閉；這是空房關閉入口實證，不涉及原房。
- 新helper的metadata讀取暴露舊empty-room假host只讀durable、不讀已loaded未materialized runtime，與固定原生 thread_processor2844–2920及以上真空房證據相反。首輪完整1287：1276pass／10fail／1cancel，idle-pool fixture漏cleanup掛住；只在Astra批准並核對exact CIM後停止自有 child24084（parent45660），K／Chrome／Codex App未動，partial/error/owned termination證據全部保留。remote-access自然完成，無相同因果，不改它。
- 唯一mock補正：thread/read includeTurns:false可讀loaded runtime，thread/resume與includeTurns:true仍durable-only，unknown首次送出不重建等全部assertion保持。空房單檔9/9。後續完整1287／1284pass／3fail／0cancel自然結束（`full-concurrency4-opus-acceptance.log`），失敗全是舊history read count把新增metadata算成history。
- 完整失敗run結束後才補3個精確filter includeTurns===true：desktop-switch保留history []、desktop保留history1、manual-fork保留history2並明示不重讀parent history，原no-replay/no-interrupt斷言不動；連同empty-room共四個test-only差異存 `metadata-fixture-final.diff`，四檔81/81（`metadata-fixture-contract-green.log`）。最終純快照固定4並行 **1287/1287**（`full-concurrency4-final.log`，62.90秒），0 fail/skip/cancel；不把混合快照或掛起run標成全綠。官方訂閱真正 Opus 5.5短fixture複核 `opus-test-fixture/result.json` session `13bd175d-2235-4232-83cd-41f5c0bfc16b` 無阻擋，Astra獨立接受四個test-only差異。未採非必要的 !==false 建議，保留 ===true。產品20a540f0未變，候選驗收完成、正式仍未部署。

全部 evidence 在 `D:/K-harness/.runtime/native-goal-recovery-20261011/`。正式狀態以 Astra 最終追加與 runtime 讀回為準；候選目前不自行部署、push 或操作原工作。
