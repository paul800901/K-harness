# Codex 原生串流失敗：診斷與候選呈現修正（2026-10-10）

## 本人要求與範圍

本人提供手機「我殺了學院玩家」截圖，要求找出問題、與真正 Opus 5.5 討論、修正並由 Opus 檢查程式碼及防禦性／過度工程化，完成後停止，等本人回來與前批一起更新。

本輪只修候選錯誤呈現，沒有停止／部署／重啟正式 K、push、恢复目標、重送小說、換模型或修改工作成果。前批 API／Exa、子代理快覽等候選保留。

## 原生證據與根因界線

- 以唯讀 SQLite／JSONL 查該聊天室的既有原生紀錄，最新回合於 **2026-10-10 臺灣 07:04:57** 結束，status 為 **failed**，模型 GPT-6.1 Sol。
- 原生錯誤是 `stream disconnected before completion: An error occurred while processing your request...`，`codexErrorInfo='other'`、`additionalDetails=null`。完整錯誤含 request ID，與截圖一致。
- 同一 request ID 的原生日誌記錄 `/responses` **HTTP 200 OK**，隨後記錄串流回合錯誤。這不是手機介面自行推測的失敗，也不能從這個錯誤推論為 429／500、容量不足或額度不足。OpenAI 更內部原因沒有回傳，仍未知；不能宣稱本輪修好 OpenAI 服務。
- 該失敗回合的原生歷史仍有 **6 筆 completed commandExecution** 與 **2 筆 completed collabAgentToolCall**，因此「回合失敗」不等於「之前沒有執行任何工作」。本輪只核對事件種類與狀態，不驗收小說內容，也不重做成果。
- K 已保留原生 failed／受阻及部分回覆；缺口在 `frontend/native-notices.mjs` 原本只辨識容量／用量限制，串流錯誤直接回傳整段英文。

官方協定：[Codex App Server — Errors](https://learn.chatgpt.com/docs/app-server#errors) 說明原生 failed 與原始 error；本次實際 error 形狀以現場紀錄為準。沒有 HTTP 錯誤碼或 Retry-After 就不編造。HTTP 200 來自原生日誌，不擅自填入原生 error 物件。

## 最小完整修正

產品只在 `frontend/native-notices.mjs` 增加 **5 行**：

1. 原生結構化 `responseStreamDisconnected` 辨識為串流中斷。
2. 本次實際 generic `other` 或舊紀錄無 code 時，僅辨識**開頭** `stream disconnected before completion:`。具體容量／用量／登入等碼不被文字覆蓋，其他未知錯誤與非 Codex 供應商維持原文。
3. 顯示「**Codex 回覆在完成前中斷；本輪未完成。接續前先核對已保存成果，K 不會自動重送。**」

既有 raw error／request ID 折疊詳情保留、不變造事件或新增狀態。原生 `willRetry` 仍先顯示重連／等待網路／重試提示，不誤說已終止。沒有新增重試按鈕、模型備援、快取、解析 request ID 的狀態或恢復機制。

修改檔案：
- `frontend/native-notices.mjs`
- `test/native-notices.test.mjs`、`test/codex-capacity-fallback.test.mjs`
- `test/stream-error-ui-probe.mjs`
- 本紀錄與 `docs/development-log.md`。

## 驗證與真正 Opus

私有證據目錄：`D:\K-harness\.runtime\stream-error-fix-20261010`，含實際原生證據、討論／審核封包及完整結果；不提交登入資料或原始小說內容。

- 真正 Opus 5.5 事前討論：官方 Claude.ai Pro／CLI 2.1.294，實際 `claude-opus-5-5`，session `fee46283-a81b-435f-abce-adc4d9e70cb9`，code 0／success／is_error false，6 次唯讀工具。支持只修顯示；要求允許實際 other、結構化码優先、查所有呼叫者與實測詳情，不加重播／換模／備援。
- 所有 `codexErrorKind` 產品呼叫已查：只有 `localizeNativeNotice` 使用，新增 stream 不觸發選模型或執行路由。
- 定向 **29/29**：實際 error 形狀、raw 不變、結構化碼與文字優先、未知／非 Codex 不誤判、willRetry、partial 工具成果、failed／受阻、沒有 K 重送／換模／自動復活目標。
- UI build 成功；原有 bundle 大小警告仍保留，本輪不做無關拆包。
- 建置後假資料 UI **桌面 1440×900／手機遠端 393×852** 通過：單則中文錯誤、原始詳情与 request ID、保留 partial 訊息與未完成／受阻、手機仍已連線且沒有誤導重新登入／重連、原生重試文案不同、無水平溢出／POST。截圖及 result 在工作樹 `.runtime/stream-error-ui-probe`。
- 第一次 UI probe 失敗：誤要求 busy=false／無子代理時的手機底部存在「工作失敗」。既有手機設計隱藏此狀態，故只修 probe 的手機預期（改驗未完成文案／受阻目標），不修改無關產品。原失敗 `ui-probe.log` 保留，成功在 `ui-probe-second.log`。

- 真正 Opus 5.5 最終程式碼複查：官方 Claude.ai Pro／CLI 2.1.294，實際 `claude-opus-5-5`，session `0619ff9a-8fe5-4bf3-b803-fdd68d33a970`，code 0／success／is_error false，12 次唯讀工具；讀實際 diff、localizer、controller、main／native UI 呼叫。**無 blocker，沒有過度工程化，現有防護足夠，不加備援或額外狀態。**全套結果尚待主代理讀回，沒有把代理結論當測試完成。
- Opus 記錄兩項既有鄰近限制，本輪不擴張：活動保存／worker 查詢又失敗時，既有 controller 可能以另一錯誤覆蓋主提示，stream raw仍在turnError但主詳情因不相同而隱藏；wrapper 若有未觀察到的前置空白則維持英文。兩者不是此次截圖的已證實原因，未新增防禦來處理。

- 完整序列測試 **1107/1107**，fail／cancelled／skipped 均 0，`serial-tests.log`，161.48 秒。主代理已獨立讀回退出碼 0、全套結果、actual diff 與手機建置截圖；不是由 Opus 代替測試驗收。
- 本輪完成的是**已實作且本地／建置後假資料驗證的候選**。正式服務故障未被宣稱修復，也沒有真實模型回合重試驗證（避免重播工作）。

## 候選停等

本輪是候選呈現修復，不是服務故障修復或正式更新。正式程式指標讀回仍 `1a45a73440a5f948c5cec625de02340863b7c67d`，K 未被本輪停止／重啟。等本人回來允許，核對工作停止並與前批一併升級；程序還原只涵蓋程式，不還原／重播對話資料。


## 08:52／08:53 兩張新截圖的唯讀追查

本人再問「繼續工作又出問題，到底是 K 還是 Codex」，本段只診斷，不新增產品修正或執行回合，也不部署。

- **我殺了學院玩家**：最新原生回合於臺灣 **08:11:04** failed；原生 SQLite／JSONL 保存完整 `Error running remote compact task: stream disconnected before completion: ...`，與截圖 request ID（569402d0 開頭）相符。這次發生在原生遠端上下文壓縮；同一 ID 原生日誌 HTTP 200 OK。並有原生 `responses_retry` 的多次警告，不能歸因為 K 沒有自行重送。
- **拳王轉生**：最新原生回合於臺灣 **08:13:48** failed；原生保存 `stream disconnected before completion: ...`，與截圖 request ID（57d7fe1e 開頭）相符，同一 ID 原生日誌 HTTP 200 OK。
- 兩筆皆 `codexErrorInfo='other'`、`additionalDetails=null`。可確認工作停在 Codex 原生／OpenAI 請求路徑，不是 K 只把成功回合畫成失敗；更內部服務原因仍未知。不能以两间失败宣稱全站故障、过载、Luna或額度不足，也不以 HTTP 200 當工作完成。
- **K 層仍有另外問題**：英文長提示／兩個提示與子代理待確認不能混成服務故障。正式仍 1a45a734；前批中文與子代理讀法候選尚未部署。現有提示去重只比完整原文，remote compact 前綴與內文不是同一字串；未取得第二則詳情 request ID，不冒稱已證實是同一次錯誤重複，而是呈現需另外核對。
- 新的 remote compact 前綴不在上一候選 localizer 的已辨識範圍，**尚未修正**；不能把先前的中文修正宣稱覆蓋本次全部形狀。此輪未實作／複查這個補修。
- **子代理31待確認**：唯讀查該父對話歷史收集的 42 個原生子代理，42 個 latest turn 全為 completed，42 個 session_meta 父來源均一致。這能確認歷史有已完成工作，不能把「待確認31」當作31個確實執行中。沒有取得當時 K 的31列逐筆快照／錯誤回傳，不宣稱31列已逐筆定位或正式修復；既有尚未部署的 latest-summary 候選仍待正式讀回。

私有證據 `D:\K-harness\.runtime\stream-error-audit-20261010-0853`：native-audit.json、兩父對話事件、compact-log-summary.json、boxing-child-summary.json。只摘錄原生錯誤／狀態／種類，不複製小說內容／登入資料。本輪沒有對正式 host 呼叫任何方法、修改目標、切換模型、停止／重送／壓縮／更新 K。


## 本人授權後的原生與K對照診斷（2026-10-10）

本人詢問如何查明根因，確認「追 request ID、獨立假資料、同原生版本對照、不重播小說、不操作正式 K」後回覆「做」。本段記錄實際診斷，不是故障修復或正式驗收。

### 已確認的失敗層級

主代理獨立以 SQLite URI `mode=ro` 核對兩個原生 turn、request ID、HTTP 紀錄及 `codex_core::responses_retry`，與限定 Luna 唯讀稽核交叉比對：

- 我殺了學院玩家：turn `01a12324-6e58-72a0-b16d-b5382a3ea74c` 原生 failed，沒有 final agent item。最後 request `569402d0-b02a-4bf3-865a-43e888429270` 對應 HTTP 200，但原生遠端壓縮未完成。日誌明確記錄 `remote compaction v2 stream failed`，由原生核心進行 `1/2`、`2/2` 延遲重試後失敗；不是 K 應自行重送而未重送。
- 拳王轉生：turn `01a12324-a831-7df0-9930-8b90cc47b616` 原生 failed，沒有 final agent item。最後 request `57d7fe1e-2b9e-4615-ac5e-4191380cf5b8` 同樣 HTTP 200；最後一組原生 sampling 重試 `1/5` 到 `5/5` 後仍失敗。周邊存在壓縮痕跡，不足以證明這筆最後失敗也是壓縮造成。
- 檢查目標時間窗 stream／websocket 日誌，沒有保留可辨識的 `response.failed`／`response.completed` 協定事件。**這是記錄不足，不是「確定沒有上游失敗事件」或「必定只有網路斷線」的證據。** Generic `other`／request ID 無法進一步判定 OpenAI 內部錯誤、傳輸或特定長脈絡觸發因素；也沒有足夠證據指向過載、額度、Luna 或全站故障。

### 真實訂閱限定假資料對照

使用正式已安裝的 Codex **0.161.0**、同一 K 專用 `CODEX_HOME`／既有 ChatGPT 訂閱、`gpt-6.1-sol`／medium、read-only、新建假資料工作區。沒有 API Key 或付費 API fallback，不讀取／複製登入檔。

| 路徑 | 一般回覆 | 手動壓縮 | 壓縮後接續 |
| --- | --- | --- | --- |
| 直接原生 app-server，獨立 stdio JSON-RPC，不經 K transport／controller | completed | completed | completed，驗證碼／160 筆相符 |
| 正式 K 已安裝的 controller＋host＋專案限定 gateway | completed | completed | completed，驗證碼／160 筆相符 |

- 原生測試 thread `01a12366-137c-73d3-a583-f6dd529f4abf`，臺灣 09:20:54–09:21:08；K 測試 thread `01a12368-74c8-71a2-b0b6-bc5639771f94`，09:23:30–09:23:43。
- 兩路首則均 **17,780 字元**，接續 49 字元，實際送出的 input SHA 相同；一般回覆為 `AB_INITIAL_OK`，壓縮後各自取回 `STREAM_AB_20261010`／160。
- 主代理獨立讀回原生 history：**六個 turn 全 completed／error null**，兩個壓縮均有 contextCompaction completed 及 turn completed；沒有觀察到工具呼叫或 error event。四次 turn/start、兩次 thread/compact/start，全部只針對兩個新測試 thread。
- 本機診斷程序已結束、自己的測試 host 已關閉；未停止正式 K、原對話或原子代理，沒有目標恢復、小說重送、換模、升級、push 或網路／全域設定變更。

### 對照限制與診斷程式自身失敗

- 測試是新假資料／單一人工壓縮，不是原小說多小時、大量工具／子代理、自動壓縮的完整重現。K 主接入使用正式程式，但跨模型 bridge 派工刻意拒絕；沒有測試原31列或完整 UI。兩路在先後不同時間執行，不等於故障當時的同時對照。
- 首次診斷腳本在原生三階段通過後，誤假定 K 目錄查詢用 hostFactory 一定帶 onEvent，於 K 尚未開始模型回合前退出。這是**本次診斷腳本的錯誤**，不是 K／Codex 產品失敗；保留原失敗。修正為可選 callback 後，只執行原先未執行的 K 路徑，沒有重送原生三階段或原工作。
- 兩路相同 CODEX_HOME 且各自經官方 account/read 確認 ChatGPT 訂閱；首次脚本的原生帳號 fingerprint 尚未寫檔即遇到上述失敗，所以只記錄**同家目錄／官方訂閱核對**，不冒稱留有兩路 historical account fingerprint 完整比對。
- 現在六階段成功只能證明這次基本路徑可用，不能證明原故障已修復、K 在所有長任務中無影響、服務端／網路唯一根因已查明。

### 結論與停止狀態

目前已定位到 **Codex 原生請求／遠端壓縮的真實失敗**，排除「只是 K 將成功畫成失敗」。本次新假資料沒有重現；**唯一底層根因仍未確認**。不能依錯誤名稱再加 K 自動重送／換模或改網路、升級核心。若要確定上游內部原因，需要供應商以兩個 request ID 查服務端紀錄；本輪沒有對外送訊或上傳。

K 英文呈現、疑似重複提示及子代理待確認仍是另外的候選問題，前文未修／未逐筆核對限制不因本次測試改變。本輪未修改產品程式；正式版本讀回仍 `1a45a73440a5f948c5cec625de02340863b7c67d`。前批候選繼續停等本人回來一起更新。

私有證據：`D:\K-harness\.runtime\stream-ab-diagnosis-20261010` 下 `evidence.json`、`audit.md`、`independent-readback.json`、`live-result.json`、`live-independent-verification.json`、兩支限定診斷腳本；`live-start.json`／`k-live-start.json` 保留開始標記禁止再重跑。沒有提交原始小說、帳號、金鑰或授權 header。只提交本工程紀錄與索引。
