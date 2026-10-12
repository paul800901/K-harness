# 各聊天室獨立載入與已受理交接收尾（2026-10-12）

## 本輪授權與驗收界線

本人要求修正兩個已確認缺口，修好候選後停止，待本人關閉 K 後再測試／更新。正式 K 仍有工作：本輪不部署、不關閉、不重啟、不讀寫或恢復原翻譯房、不重送、不 push、不預約更新、不新增套件或更換原生核心／帳號／計費。候選及假資料通過不是正式驗收。

來源 worktree：`C:\Users\Paulus\.codex\worktrees\room-lock-fix-20261010\K-harness`，基準 `7543e7a5c51f96b88182b32cc56bdd2a178cac25`（產品基準 `5a2558633bdb040af2c8a26265f1fcfb2e5ad569`）。既有未追蹤 `node_modules-root-link/`、`test/fixtures/descendant.pid` 未納本輪提交、未清理。證據置於此 worktree 的 `.runtime/independent-load-handoff-20261012/`。

## 已確認根因與要求的可觀察行為

1. `conversation-controller` 的全域 `pendingOpen`／`navigationSettled` 將聊天室載入串行化。慢 B 已開始時，C 雖顯示載入畫面，實際仍等 B；再點 D 還會略過 C。要求每一間已點選的房間獨立載入，最後選取決定畫面，切走不取消其他房的載入／原工作；同房重點不能建立第二個執行控制器。明確取消只取消目前載入目標，完整關閉才收尾所有載入。
2. `finishContinuation` 與原生 adapter 的 `prepareContinuation` 將 `completed` 當唯一交接終態。要求在工具請求**已正式受理**後，若只是舊回合尾聲原生服務錯誤，仍可核對精確回合已結束與交接條件後，單次建立空白房及送交接。停止／改口／新工作／不明終態／未結束工人／背景命令／已知權限或額度硬限制仍阻止接手；不將自然語言承諾視為工具請求，不重播舊工作、不連鎖重試，不另造模型核心。

先前「我殺了學院玩家」14:22 的滿載案例尚未呼叫建房工具；不是此處「受理後被取消」的現場實證。後者由實際程式條件及隔離重現驗證，兩者不可混同。成功的「拳王轉生」則已有 fresh/sent 收據；本輪不重新執行這些真實房間。

## 最小實作與檔案

- `src/conversation-controller.mjs`：不同房各自載入，同 ID 共用正在執行的載入；最後選取只控制畫面，不控制其他房壽命。取消只取消選中的載入，關閉才等待所有載入結束。閒置回收排除載入中的房；同房移動／中途變更不能另建 owner，其他房仍可操作。
- 同檔交接：受理單保留到單次交接完成，沿用原收據而非建立新排程。以記憶體內檢查函式核對最新真人意圖、原生目標身分／狀態／預算、工人身分及新增工具活動；合法工人列順序與單純用量／更新時間變動不會阻擋。來源停止、新訊息及新工作可取消等待中的交接；若新房已知建立則保留，不再重建或重送。
- `src/desktop-controller.mjs`：核對原 host／選擇／停止世代，並讀回原生最新精確 turn ID、status、error；fresh 已受理交接可接受沿既有 `recoverableError` 分類的明確失敗，fork 維持 completed。未知、硬限制、未結束工人／背景命令仍不接手。沒有重造錯誤分類、計帳或模型核心。
- `src/luna-gateway.mjs`：僅補 fresh 工具說明，讓模型知道 accepted 不等於 created／started，受理後應結束而非继续工作；不把自然語言承諾當受理。
- `test/sidebar-ux.test.mjs`、`test/chat-continuation.test.mjs`、`test/luna-gateway.test.mjs`：載入、精確失敗、新意圖／新工作、停止競態、單次交接及硬限制回歸。
- `test/independent-loading-ui-probe.mjs`：實際 HTTP/SSE、built UI 與 conversation controller 的隔離桌面／手機操作；只有 provider 是假資料。可指定 `K_PROBE_CONTROLLER_MODULE` 唯讀載入舊來源作同一探針比較；不呼叫正式服務。

## 驗證與狀態

- 修正前：Astra 的 `test/independent-loading-ui-probe.mjs` 使用真 HTTP/SSE、建置後介面及真 conversation controller，只有原生供應商是假資料。B 延遲時切 C，C 輸入框仍禁用而超時，證據 `ui-red.log`。沒有呼叫模型或正式服務。
- Sol 原碼聚焦 `red.log`：36 項中 6 失敗，重現全域等待、略過已點選房及 fresh failed 取消。後續最終完整 `full-regression-final.log`：**1457/1457**，0 fail／cancelled／skipped，4 並行。Astra 已讀回結果，核對三產品＋三測試檔 SHA 與該次測試固定來源一致。
- Astra 獨立 `astra-focused.log`：**79/79**。包括真 conversation＋desktop controller 串接（原生 host 為假資料）：MCP accepted → 相同回合 failed → 精確讀回 → child `thread/start`／交接 `turn/start` 各一次；沒有 fork 或原工作重播，重複 terminal 不再建房。prepare／child open 中停止、新意圖、新工人或命令皆撤銷；已建立房保留且 0 交接送出。
- `build-ui.log` 建置成功；僅既有大 bundle 提醒，未為本需求順手拆包。
- Astra 修正後雙尺寸 **1440×960、390×844** (`astra-ui-final.log`、`ui/result.json`)：B 持續載入時 C 已可輸入且送出訊息只到 C；B 晚完成不搶 C 畫面；再選 B 不開第二 owner；取消 E 不取消 D，A 的工作始終未動。實際畫面另由 Astra 檢視。UI 無 JavaScript 錯誤；E 的使用者取消會回 HTTP 400 `已取消連線`，已與其他失敗分開精確核對。
- 同一探針對正式安裝的**舊來源程式**、獨立假資料根目錄再跑，`ui-baseline-red.log` 及 `ui/failure-1440.txt`：C 等待 B 而逾時；calls 只有 A、B，證明新 C 尚未真正開始。沒有連接正式 K 或呼叫模型。
- 早期 UI 探針自身缺少真原生 state 的陣列欄位，造成候選 C ready 畫面錯誤；補齊假資料 shape 後重跑，沒有因此改產品或隱藏錯誤。初次取消 HTTP 400 被探針誤列頁面失敗亦保留於 `ui-green-v2.log`；最終探針只接受精確 E 取消回應，不忽略其他錯誤。原失敗 log 均保留。
- 真正 Opus 5.5 首審完成：官方 Claude Code 2.1.294、`claude.ai`／firstParty／pro，回傳模型 `claude-opus-5-5`，14 次 Read／Glob／Grep，成功 session `4d739596-5bc4-4fc6-a9fe-2824e055496c`。`opus/review.md` 提出兩項必要补修：B1 已進 `child.send` 的交接不能再宣稱取消；B2 MCP HTTP 與 stdout 事件不同通道，交接工具自己的 item 晚到不能被當成新增工作。Astra 獨立採納，交 Sol 限定補修；首審是有條件通過，**不算最終驗收**。
- B1／B2 補修：送出邊界只加必要 `sending` 標記，之後來源 stop／send／steer／queue 明確回報「交接已送出或結果待查」及已知新房 ID，不改收據、不謊稱取消；交接工具自身的項目排除於新增工作判斷之外，其他工具仍核對。補修只改 conversation controller 四行（含註解），沒有新增機制或正式操作。先留 `blocking-red.log` **49 pass／11 fail**，Sol 中途遇服務容量限制時先讀回已保存測試，再由同一 Sol 接續修正，沒有換模或重複修改。
- Astra 獨立補修驗收：`astra-blocking-focused.log` **90/90**、`astra-blocking-ui.log` 桌面／手機 **2/2**。涵蓋 send 送出邊界前／後，成功與 unknown 各路徑，以及 HTTP 受理先於 stdout 自身 tool item 的 fresh failed、fresh completed、fork completed 三種真 controller 串接。
- 補修後完整回歸首輪 `blocking-full-green.log` **1467 pass／1 fail**：既有 `native-wakeup.test.mjs:215` 的 UNKNOWN 排程探針預期 1、實際 0；沒有覆寫失敗原件。原樣單檔 `blocking-native-wakeup-isolated.log` **39/39**。此 fixture 不匯入 conversation controller，也不呼叫本批 desktop 的交接路徑，未見直接變更因果；有限事件迴圈等待與並發歷史查核是待證假說，不把單檔通過當成根因已解，未改無關測試或延長 timeout。
- 固定來源完整再驗 `blocking-full-second.log` **1468/1468**，0 fail／cancelled／skipped，65.37 秒。Astra 已讀回結果並核對 `sol-blocking-final-source-hashes.json` 六檔全部一致；重跑成功不代表上一項時序失敗的根因已解。最終 conversation controller SHA256：`50349126C270C7E4FBB37A532637A87FED7207A662A8E10F37B658FCCDC5B383`。
- 真正 Opus 5.5 增量末審：`opus-r1/review.md`，官方回傳模型 `claude-opus-5-5`，11 次唯讀工具，成功 session `3a5b35b2-98d1-4ff2-9e3c-6444953a79d4`；確認 B1／B2 已修，未見阻擋性回歸。Opus 沒有執行測試，測試及 UI 結果由 Astra 獨立核對，不把複查意見當作正式驗收。末審產品封包與固定來源三檔一致。
- 正式不變讀回：`formal-before.json`／`formal-after.json` 的 runtime 設定、已安裝 conversation controller／desktop controller／frontend 四項 SHA 一致。本輪沒有套用候選、停止或重啟正式 K；此四項核對不冒稱所有執行中資料完全不變。
- **停止狀態：候選實作、相稱回歸、隔離桌面／手機尺寸 UI 與真正 Opus 複查已完成；依本人要求停止。**正式更新及原生工作鏈驗收尚未執行，待本人關閉 K 後再進行；沒有安排背景更新。

## 已知邊界

- 本輪只修上述两個缺口，沒有消除上游滿載／斷流，沒有證明所有長任務或記憶偏移都已解決。模型在工具受理前就失敗的情況，不會凭空建立交接。
- 來源鎖定、尚在建立交接時，新 send／steer／queue 會先撤銷舊交接，再回報當下未送出新工作；不悄悄排隊重送。原生送出結果未知時仍保留已知房並提示待查，不提供虛假的跨原生原子取消保證。
- 本次真原生錯誤以隔離 fake host 重現；沒有對翻譯房製造滿載，沒有續跑真實翻譯工作。只有官方 Opus 訂閱工程唯讀複查使用模型；實際工作供應商鏈路與正式部署後讀回均留待本人關閉 K 後驗證。

## 後續正式驗收（本人關閉 K 後另行執行）

- 核實 K 自有工作已停止，依正式更新授權套用固定候選並保留程式退版。
- 正式桌面／手機入口：慢 A 載入中切 B 能先使用 B；切回 A 已完成，不再次重讀；背景工作／草稿／附件／核准沒有串房。
- 真正新假資料房驗證工具受理、來源終態核對、新房出現、單次交接及重開；上游故障以隔離可控方式注入，不以真實翻譯房製造錯誤。
- 正式證據未取得前，只能標示候選通過，不能聲稱所有 harness 問題或上游滿載／斷流均已解決。
