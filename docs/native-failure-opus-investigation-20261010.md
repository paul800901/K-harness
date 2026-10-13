# 原生失敗與 Pick Me Up 切換回跳：真正 Opus 5.5 調查討論

## 結論與目前完成狀態

2026-10-10 本人要求和 Opus 5.5 討論如何查清三聊天室連續失敗，並追加 Pick Me Up 點擊後顯示「此聊天室正在更新，請稍候。」、立即回到原聊天室的症狀。

**調查必須拆開原生串流失敗、壓縮作業失敗、舊指令誤生效及 K 導覽鎖四條線。**相同錯誤文字與時間接近只構成關聯線索，不證明共同根因。先讀既有原始資料，不先換房、更新核心、加記憶平台或自動重送。

本輪完成正式來源碼唯讀、K 專用 logs 資料庫 schema／檔案 metadata 核對、官方協定資料查閱及真正 Opus 兩輪討論。**尚未查 logs rows、未重現鎖問題、未修產品。**未停止／恢復／重送小說、改 goal、安裝／升級／重啟／部署／push 或上傳資料。原有 dirty／untracked 檔案保留。本輪僅新建討論封包、證據和本紀錄，追加工程索引。

## 一、Pick Me Up 為何會跳回原聊天室

本輪正式來源根目錄為 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\trusted-runtime`。根工作樹的 controller 與正式檔不同，不能拿根工作樹版本代替。

### 可以確認的直接機制

1. 正式 `frontend\main.jsx:257–259`：點選先設 `navigationTarget`，暫時投影目標聊天室；`api('open')` 失敗時，清掉該投影並顯示錯誤，因此回到原先 `receivedState` 的聊天室。
2. 正式 `src\conversation-controller.mjs:150–195`：開啟已存在的房間時，第175行若 `locked.has(existing)`，就拋出與截圖完全一致的「此聊天室正在更新，請稍候。」。`finally` 清掉 `pendingView`，原本 `active` 未被切換。
3. 同文亦見 `moveWorkspace` 第230行，但本次一般側欄點選走 `open`；不能由重複字串推斷本人做了工作區移動。

所以回跳不是證據顯示 Pick Me Up 的資料被刪除、核心記憶損壞或自動換房；它與**導覽失敗後返回原投影**的路徑吻合。但沒有取得當時 live lock owner／階段，不能宣稱已證實永久死鎖。

### 可以縮小、仍不能指名的持鎖路徑

一般導覽遇到 `focusLock` 會顯示另一句「正在更新聊天室，請稍候。」；截圖是「此聊天室正在更新，請稍候。」。依正式程式可達路徑，應優先查不取得全域導覽鎖而持有房間鎖的三個候選：

- `releaseIdleRooms`：對排序落在隱藏房間第4名以後的候選，**先鎖住再查是否閒置**。期間可能讀清單、兩次 worker 狀態、瀏覽器狀態，最後才決定是否 `close()`；不代表 Pick 當時符合所有條件。
- `discussionStart`：開始共用討論時的準備／閒置檢查。
- 有共用討論時的 `api.send`：送訊息相關流程。

原生一般 request 有預設30秒限制，但整條多步流程不是30秒；其他 worker／bridge／browser 呼叫與 close 階段還需按實際實作逐一確認。`finally` 會清鎖，只限其等待真的結束；不能因存在 `finally` 就排除卡住。反過來，也不能只因 `await` 沒有外層 timer 就認定底層沒有時限。

`failed` 房間在一般回收閒置初檢會直接不合格，不支持「原生一失敗就必定進入卡鎖回收」的說法。Pick 當時狀態／持鎖者／持續時間未知，兩種錯誤目前未建立因果。

### 不採直接刪鎖／逾時當停止的修法

閒置判斷到真正關閉之間，以及 close 與 reopen 之間，仍須避免 send／queue／goal／discussion 插入和使用已關閉 host。`Promise.race` 超時不會取消底層作業，不能因此無條件解鎖、移除 owner、重開或宣稱已停。

候選只限必要方向：純閒置查核是否可讓路給導覽；若讓路，晚到的結果須重新確認 `active`／導覽次序／現況，不能關掉剛被選取的房間。進入真正 close 的未知操作仍保留持有者。先用假 controller 測可達性與競爭，不先建立新的鎖管理架構。

## 二、原生五筆錯誤如何往下查

精確 thread、request、時間與行號沿用本輪前次[原生核對紀錄](three-room-stream-errors-20261010.md)，不是 Opus 推測。四筆一般 stream 與一筆明確 remote compact，均 generic／other；不能把沒有 compact 前綴的筆數當成已排除壓縮相關請求問題。

本輪讀取 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\agent-home\.codex\logs_2.sqlite` 時使用 `DatabaseSync(...,{readOnly:true})`，只讀 `sqlite_master`，未讀 body／秘密／小說，也未做 checkpoint、integrity check 或 live app-server 呼叫。當時可見主檔約76.4MB、WAL約32.4MB；檔案大小不證明五筆所需資料都有保存。

`logs` 實際欄位包括 `id, ts, ts_nanos, level, target, feedback_log_body, module_path, file, line, thread_id, process_uuid, estimated_bytes`。只有 schema 不能保證 process_uuid 是 PID 格式；內容保存時間與錯誤當時的完整性仍未知。

最新[官方 app-server 協定](https://learn.chatgpt.com/docs/app-server)列有 error 的分類／附加詳情及可用時的上游 HTTP status，也有 contextCompaction item 生命週期。**文件有欄位不代表本次登入、失敗當時版本與原始紀錄都提供。**本輪 selected core 是0.161.0、已有 session 起始資料曾是0.160.1；兩者都不能證明每個失敗當下 host 實際使用版本。

### 最小第一批唯讀工作單（尚未執行）

1. 五筆各自按 thread／turn／request／UTC 時間建立對照。從同一回合邊界取有限的 event 類型、錯誤物件、壓縮開始／完成與 token 數值，不固定只看 ±50行、不讀正文。找不到同回合就標示未知，不借上一回合代替。
2. logs 先查保存時間範圍及各錯誤時間窗的 thread／process／level／target 筆數，再按需要讀 WARN／ERROR 的白名單分類與去敏感內容；不輸出任意完整 body。缺少精確 thread 的共通 host 紀錄，要另作時間／process 關聯，不能掃全庫當替代。
3. 找當时原生 request detail、錯誤分類、HTTP／transport／timeout 類訊號與程序退出；檢查同時段是否有成功回合及背景負載。成功對照只能縮小假設，不直接排除間歇故障。
4. 歷史 host 版本只憑同時刻啟動／exe 路徑／版本等能相互對上的證據；selected-cores、現在 runtime.json、更新目錄 mtime、session 起始版本不能單獨採用。找不到保持 UNKNOWN。
5. Pick 另外讀三個持鎖候選的 worker、discussion、browser、close 實作，列出每個等待的既有上限、是否有狀態改變及鎖解除條件。不能靠聊天室忙碌圖示判斷持鎖者。

此批不需要新增模型測試／額外 API／正式程式變更；人工或模型分析本身仍有工作成本，不稱整套調查「零模型消耗」。讀 logs rows 屬唯讀診斷，不與新增持久診斷混為同一授權。

### 判斷矩陣與證據限制

| 假設 | 需要的區分證據 | 現有資料不能直接證明的事 |
|---|---|---|
| 上游服務端處理 | request 可關聯的上游錯誤／HTTP／官方追查 | generic processing 文字與request ID不等於已知服務端根因 |
| 串流傳輸／idle | 原生transport分類、實際網路活動／等待相關紀錄 | rollout最後事件到錯誤的秒差不是網路idle證據 |
| 請求形狀／大小／壓縮 | 同回合數據、壓縮請求生命週期及同條件成功對照 | token_count不是精確wire payload大小；壓縮次數缺分母不能作因果 |
| K程序／協定／細節未保存 | 原生與K收到的完整錯誤、host退出／處理關聯 | 原生也有other不能證明K沒漏別的notification或stderr |
| 日誌缺口／共通本機資源 | 當時寫log／磁碟／程序證據 | 10/07的warning不能當10/10根因，也不能絕對排除共通資源問題 |

正式 `codex-host-diagnostics.mjs` 現有檔案只保存指定SQLite分類及日誌warning，**不保存所有網路stderr**；這是該通道的侷限，不是認定 logs_2.sqlite 也沒有網路細節。不能為找問題先啟用全量DEBUG、記prompt／header／憑證或直接上傳原始資料。

若需要一致快照，使用SQLite支援的讀法；不能複製正在寫入的主檔卻漏WAL，不能用忽略WAL的immutable模式當當前完整資料，也不為唯讀調查做checkpoint。

## 三、既有資料不足才增加的下一階段

尚未執行，不能因本輪討論當成取得產品改動／部署授權：

- 假 sessionFactory fixture：每個持鎖候選分別阻塞／解除；再測導覽優先後的晚到閒置結果不關閉active、close仍未結束不誤開、忙碌工作與未知工單不重播。模擬只能證明路徑，不能認定真實當時的持鎖者。
- 若真缺歷史觀察，才補專案限定、短時窗、白名單錯誤／lock phase診斷，優先沿既有通道，欄位只取實際提供且必要者。thread／turn／request／host版本來源／錯誤分類均要區分可得與未知，不假定每個錯誤都有request ID、HTTP status、token或compaction flag。不在模型主流程加診斷阻塞，不新造常駐服務／人用管理頁。
- 真模型／壓縮／版本對照測試另外限定假資料、模型／effort／範圍／訂閱成本；額度扣減不能事先精準承諾，不換計費、transport或重播原小說。

### 調查停止條件

查完可得的現有資料，仍只有generic other且無足以區分的訊號時，明確回報「定位到原生請求失敗，根因仍UNKNOWN」，不無限查、不編根因。可準備僅含request IDs、UTC時間、錯誤原文、已驗證版本或UNKNOWN、compact分類的最小官方追查包；**不自動上傳**。Pick鎖若無歷史owner，fixture界定候選、必要時限定新觀察；沒有當時資訊就不能補寫成已找到。

## 四、真正 Opus 5.5 與主代理獨立複核

官方 Claude Code **2.1.294／Claude.ai Pro／firstParty**；兩輪實際 assistant model **`claude-opus-5-5`**，session **`0c3080e4-cbe5-49b3-af65-b9a58c4fec6b`**。兩輪exit0／success／is_error=false，第二輪是已完成討論的明確接續，不是失敗重試。第一輪17次Read／Glob／Grep，具名路徑均在限定packet；第二輪0工具。沒有呼叫其他模型或付費API。

原始證據保留於 `D:\K-harness\.runtime\native-failure-discussion-20261010`：`packet`、`subscription-preflight.json`、`start.json`、`raw.jsonl`、`result.json`、`review.md`及`round2`。模型回報duration_ms為135635／33496；usage合計input20、cache creation70913、cache read382418、output15444。這是討論用量，不是方案性能、獨特資料量或訂閱實際扣額證明。

主代理獨立指出、Opus第二輪修正：process_uuid格式與歷史版本過度確定；固定行數窗口與同回合token混淆；rollout秒差當network idle；用原生other斷言K未丟細節；把寫log絕對排除；由壓縮次數不同否定關聯；逾時當取消；把唯讀logs query錯列為新寫入授權。亦撤回把雙方未主張的確定因果寫成「反駁Astra」。

第二輪工作單中的「零模型消耗」未原樣採用，改為「不新增模型測試」。日誌資料不足時，不先承諾補機制；所有設計仍是候選，不是修復完成。

