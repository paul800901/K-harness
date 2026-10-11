# 原工作與成果核對接連失敗：限定診斷

狀態：只讀診斷，沒有修改產品、重啟或部署；沒有在原翻譯房送出工作、恢復目標或停止其他房。正式程式仍為 `4af4b7d2bfcbefd8772329270b6432a50f9f44a3`，固定 Codex 核心 0.161.0。前批 JSONL 載入修正不能當成上游模型串流失敗已解決。

## 本次已確認

- 2026-10-12 02:14（臺灣）本人開啟新版 K；受影響主代理為 GPT-6.1 Sol／medium／標準速度，不是從 Luna 子代理推測主回合型號。
- 一般工作在 02:15 開始；02:38 的原生重試紀錄出現 high-demand 文案，原生核心重試並從 WebSocket 改走 HTTP。02:43:05 一般工作最終 failed。
- 相關工人結束後，02:43:27 K 確實送出一次同主代理成果核對回合；原生 rollout 的 tool output 名稱精確為 `k_native_goal_recovery`。不是前批 `systemError` 被 K 當 busy 而永遠漏接。
- 核對回合也經原生五次 sampling retry，在 02:43:43 failed。未見成果查核工具或 `goal_resume` 執行，沒有第三次核對回合。既有「單次核對不連鎖」界線在此生效，但不等於工作已恢復。
- 兩次最後請求都有 HTTP 200 及各自不同的 `x-oai-request-id`，隨後模型串流失敗；200 只證明請求得到回應，不代表生成完成。原工作與核對是兩次失敗，不是同一事件顯示兩遍。

## 必須更正的錯誤歸因

「目前需求量高，可能造成暫時性錯誤」**不能單獨證明模型容量不足**。查讀固定官方版本後確認：

1. [api_bridge.rs:179–180](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/codex-api/src/api_bridge.rs#L179-L180) 將 HTTP 500 映射到 `InternalServerError`。
2. [protocol/error.rs:168–169](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/protocol/src/error.rs#L168-L169) 的 high-demand 文字是該錯誤種類的固定顯示文案，不是服務負載量測。
3. 明確的 `server_is_overloaded` 會走不同的 `ServerOverloaded` 分類，參見 [responses_error.rs:81](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/codex-api/src/sse/responses_error.rs#L81)。個人額度耗盡也有另外分類。

因此，初期內部錯誤與最後一般串流錯誤必須分開。可以定位到原生上游請求／串流失敗，不能據此認定 Luna 太多人使用、個人額度用完、K 本機網路斷掉、上下文超限或所有歷史事故同因。錯誤前原生紀錄的上下文用量 193,849 低於當時壓縮門檻 244,800 與視窗上限 258,400，兩個超限旗標皆 false；這不支持把本次直接說成 context 超限，亦不保證整個歷史沒有問題。

限定讀回同時段其餘三個翻譯主房：一房曾出現一次原生 WebSocket 重試，另外兩房在查詢時段未見同類錯誤；三房未見該時段終局 failed。不把單房問題宣稱全服務中斷，也不把限定時段未見錯誤說成永久正常。

## 已證 K 呈現缺口，尚未改產品

- 核對回合失敗後，工具狀態改為 failed，但先前「核對已存成果，確認後接續剩餘工作」的提示仍保留，易讓人誤以為接續仍在進行。
- 原始 error.message 含 request ID，固定提示卻只說未回報欄位未知；需要區分「訊息已有 ID」與「專用欄未提供」。本次未提供 Retry-After，仍不能編造等待時間。
- 這兩項呈現缺口不是上游串流失敗的根因，不能只修文案便宣稱長任務已完整修復，也不能未驗證就增加無限重試、換模或重播原工作。

## 證據與複查邊界

原始帳號／對話不修改。本機限定證據在 `D:/K-harness/.runtime/stream-recurrence-20261012/`；`astra-error-classification.json`、`astra-error-timeline.json` 與 Sol 的 `recovery-report.md`、`boxer-readback.json` 交叉核對。精確 request／thread／turn ID 留本機，不在本文件複製私人歷史或請求 header。

真正 `claude-opus-5-5` 同案只讀複查已完成，官方 Claude Code 2.1.294／claude.ai 訂閱，session `e0d65588-0c07-4ad4-95e7-ebda4cbb552b`。初始封包將 high-demand 當負載線索，第一輪未讀到後補反證；原始結果保留。第二輪沿同 session，確實讀取三份精確來源片段後撤回「高需求已證容量不足」「K 核對送得太早」及「14 秒不足以跨過故障」等無證據推論，沒有換模或重跑原工作。

Astra 已獨立讀回增量結論、actual model/session、三項 Read 紀錄與固定來源。採納固定文案更正、兩次不同失敗、過期核對提示及 requestID 措辭缺口。服務回報錯誤不代表已證責任完全在服務端：特定 thread／request 觸發錯誤仍未排除，不以 Opus 意見代替根因證據。

「只核對一次」是現行工程上限，不是本人逐字禁止再次核對；不能把它當成要求本人重新授權的理由。但本次亦沒有證據支持特定延遲或固定循環必能修復，因此不藉此新增計時重送。沒有以既有測試數字冒充此次服務故障已修復；上述呈現修正仍未實作，產品及正式狀態不變。

## 03:41–03:42 三張子代理警告截圖的追加診斷

本人追加指出 Pick Me Up 分支、鐵血及學院仍執行，但持續出現「原生子代理已送出終止事件…未確認」提示。此提示由 K 的 `worker-attention` 核實流程產生，不是原生容量錯誤；正常完成、失敗或取消的終態都可能進入此流程，不能光看「終止」便判定失敗或容量不足。

Astra 03:44 的只讀原生 DB 查詢，限定當天 02:14 開啟後的直接子代理回合：學院 5 個 failed、鐵血 1 個、Pick 分支 1 個，全部為 GPT-6 Luna、一般 `other` 串流錯誤，其中一個發生於 remote compact。七個回合均未有明確 `serverOverloaded` 終態；相應 native retry 紀錄亦未有明確 capacity 文案。六個曾有前述固定 InternalServerError/high-demand 文字，不能據此推定高负載。前節「拳王相關三個工人完成」僅限該次事件，不可外推成其他房沒有子代理失敗。

兩條 K 邏輯已重現，未改產品：

1. **子代理終態漏判**：`native-workers.mjs` 只接受 `idle`／`notLoaded` 的最新明確終態；原生 `systemError` 加最新精確 `failed` 被回報 `unresolved`。相同假資料只改成 `idle` 即為 `failed`／settled。Sol 做五個最小對照，Astra 獨立再次執行兩種關鍵輸入，確認差異。正式來源與工程來源 LF 正規化後一致。前批已修主代理接續的 systemError 門檻，但這條子代理判別路徑未補；不能再將其全部歸為服務容量。
2. **舊回合提示殘留**：同一子代理開新回合時會移除舊待核實項，卻不處理舊 warning；之後只讀最新回合，舊警告再也對不上精確 ID。既有真 controller 配假原生回覆的序列／對照 2/2 已重現。不能因此把新回合完成当成舊回合成功，需另核實原回合或明確區分歷史提示。

尚未取得截圖各條提示在 K 記憶體中的精確 child／turn ID，不能聲稱每條都已逐一歸因。上述是已證邏輯缺口、與真子代理 failed 相容的成因；不是上游為何中斷的內因。工程證據在本機 `terminal-notices/`，原房、目標、metadata、帳號與執行中工作都未修改。本追加尚未產品修正或另交 Opus 程式複查，不宣稱已修好。

## 後續狀態
上述最後兩項子代理邏輯已另作修正候選，實作、驗證及停止等本人升級的界線見 [子代理終態與舊提示修正](native-terminal-state-fix-20261012.md)。本文件保留當時診斷狀態；不因此將核對提示／request ID 措辭或未知上游根因說成已修復。
