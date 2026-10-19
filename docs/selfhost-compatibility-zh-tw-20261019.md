# 自架本機模型載入相容性與中文錯誤呈現（2026-10-19）

## 狀態

驗證完成、待正式套用。程式固定版本 `ecdde11b04b853073512e6ddf44e5c11d88ee911`，基底 main `d1720bad9140a11551cf7fa79e01045970109f94`。部署結果另記文末；不能把候選驗證當成正式成功。

實作分四輪，都由真正 Opus 5.5（claude-opus-5-5，high）完成；主代理獨立讀取 diff、執行測試與驗證。實作者沒有命令工具，所有測試由主代理執行並記錄。

- 第一輪：主代理獨立檢查 diff，聚焦測試 59/59 通過。
- 第二輪：依主代理的實測證據與意見修正；最終驗證見文末。
- 第三輪：小修與最後只讀複查。
- 第四輪：修正既有長訊息收合問題。主代理再跑完整 1787/1787、全部 UI 49/49 通過，包含原本失敗的可達性斷言。

**沒有任何語言模型載入或推論。** 下文的「400 實測」是主代理用正式安裝的 Codex 0.163.0，對 loopback 模擬 HTTP 400 所做的 mock-native 測試，不是 LLM 推論，也不是 LM Studio 實測。既有語音回歸僅使用本機 Whisper 轉錄合成句子。

## 現場與根因

本人 20:01 在 K 向 Dolphin Mistral 24B Venice Edition Q4_K_M 送出「你好 你中文如何?」，未成功。

1. **載入被拒**：LM Studio 原生日誌 `main.log` 20:01:31.770 記錄 loadModel 明確拒絕：`Engine configuration files and CWD are currently supported only by vLLM.`。K 每次載入都加上 `--no-engine-config-file`（另外還加了 `--no-speculative-draft-mtp`）。這兩個選項只在本機 `lms load --help` 裡出現過，沒有證據適用 GGUF。事後讀回，Dolphin 的 `loaded_instances=[]`。
2. **真因被丟掉**：載入失敗時沒有保留 CLI 的 stdout、stderr 和結束碼。
3. **無效重連**：所有準備失敗都回 HTTP 503。Codex 原生核心會重試 5xx，每次重試都撞到「狀態不明」，最後畫面只剩「模型狀態不明」。
4. **權限說明不實**：自架模型落進 GPT 的說明，其中包含不實的「K 的外部隔離限制仍保留」。GPT 的同一句也一樣不實。

## 原生 400 實測證據（mock-native，非 LLM）

主代理的腳本與結果放在被 git 忽略的 `.runtime/archive/selfhost-compat-20261019/`：

- 腳本：`native-400-probe.mjs`
- 讀回：`native-400-readback.json`

測試條件：正式安裝的 Codex 0.163.0、獨立無憑證的暫存 home、loopback 回 HTTP 400；沒有載入、推論、外網或付費。

結果：

- `calls=1`、`willRetryEvents=0`，回合 `turn.failed`。**Codex 沒有重試 400。**
- `error.message` 就是完整的 JSON body：`{"error":{"message":"本機模型載入失敗；未送出推論。","code":"k_selfhost_load_failed","diagnostic":{...}}}`
- **`codexErrorInfo` 是 `other`，不是第一輪假設的 `badRequest`。** 第一輪文件寫 400 會被 K 的錯誤分類當成硬限制，這說法不成立，已更正。
- 前端的中文顯示確認成功。

這項證據帶出另一個風險：K 自己的拒絕被歸成 `other`，就可能喚醒 K 的目標接續核對，重新觸發載入，或接續一個結果不明的工作。第二輪已修正，見下文。

## 修改

- `src/local-model-runtime.mjs`
  - 載入參數只保留 GGUF 適用的部分：模型識別碼、`--port 1234`、`--identifier`、`--context-length`、`--parallel 1`、`--yes`。移除 `--no-engine-config-file`（已證實不相容）和 `--no-speculative-draft-mtp`（只有 help 證據，讀回也無法核對），兩者都回到原生預設。
  - 失敗附上代碼：`k_selfhost_busy`、`k_selfhost_load_failed`、`k_selfhost_state_unknown`、`k_selfhost_prepare_failed`。CLI 的指令、結束碼、signal、stdout、stderr 原文放在 `diagnostic`，各保留最後 8000 字元。
  - 狀態未知時保留第一次的原因與診斷，不清除、不重試。
  - 人用訊息改成臺灣用語：背景服務、模型執行個體、上下文長度、語言模型、模型識別碼。模型專名、ID、命令與原始診斷都不翻譯。
- `src/gemma-responses.mjs`
  - 準備失敗回一次 400，內容是 `{error:{message, code, diagnostic}}`。
  - 不含中文的原生例外（例如逾時）改用固定中文作為主要訊息，原文放進 diagnostic。
  - 「Gemma 請求／協定」字樣改成「自架模型」，因為同一條路徑也服務 Dolphin、Qwen 等模型。
- `shared/selfhost-error.mjs`（新增）：只做整體 JSON 解析，對象是錯誤的 message 或 additionalDetails，不再用第一輪的通用括號掃描器。第一輪另外支援「英文前後綴包住 JSON」，那是自己假設的格式，實測沒有出現，所以刪除。這個函式有兩個實際使用者：介面通知和目標接續分類。
- `src/native-error-class.mjs`：K 的四種準備類拒絕（準備失敗、載入失敗、狀態不明、忙碌）一律歸為 `hard`，即使原生給的是 `other`，因此不會喚醒目標接續核對。只認 K 確切帶代碼的 body；其他供應商與其他 400 的分類不變，也不用英文關鍵字推測。
- `frontend/native-notices.mjs`
  - 自架錯誤的主要通知顯示 K 的中文訊息。
  - 其他有原始紀錄的自架原生錯誤，只顯示有證據的內容：「自架模型這一輪失敗，未完成；原始錯誤保留在詳細內容」。串流中斷另外提醒先核對已保存的成果。
  - 不宣稱沒有原生重試或重送，因為 K 這一層看不到。
- `frontend/main.jsx`：主錯誤提示只要改寫了原文，又沒有原生紀錄可展開，就提供「查看原始內容」顯示原文；原本的原生紀錄展開照舊。
- `frontend/permission-picker.jsx`、`frontend/dialogs.jsx`
  - GPT 與自架共用的「完整存取權」說明及確認畫面，改為「略過 Codex 權限提示與命令沙箱；K 沒有另外的隔離層」。
  - 自架的「代我核准」標明：沿用 Codex 原生自動審查，自架模型下尚未驗證；確認畫面也說明 K 不會替本人改成其他權限模式。
  - 只改文字。權限模式、送給原生核心的設定、舊對話權限與確認流程都沒有改。
- `frontend/model-picker.jsx`：選「自架」時，模型列下方加一句「選取不會載入模型；本機模型在送出工作後才由 K 在背景載入」。第一輪改的 `src/gemma-main.mjs` 說明只在模型不可用時才會顯示，沒有可觀察的效果；保留但不算數。
- `src/work-activity.mjs`、`src/desktop-controller.mjs`、`frontend/work-status.mjs`
  - 自架回合開始後、模型第一次輸出前，維持既有的 `starting` 階段，顯示「正在準備自架模型或等待回覆」。有模型輸出後，照舊顯示「執行中」。
  - GPT 等其他回合不變。沒有新增狀態通道，也不宣稱「正在載入」或「已載入」。

## 採用契約

| 情況 | runtime | 橋接回覆 | 目標接續核對 | 之後 |
|---|---|---|---|---|
| 忙碌 | `k_selfhost_busy`，不排隊 | 400 | 不喚醒 | 本人自行再送 |
| 載入前檢查或服務啟動失敗 | 無載入副作用 | 400 `k_selfhost_prepare_failed` | 不喚醒 | 修正後由本人再送 |
| CLI 以結束碼回報載入失敗 | 保留原生診斷，**仍視為狀態未知** | 400 `k_selfhost_load_failed` | 不喚醒 | 暫停載入與推論，直到 K 重新啟動 |
| 載入、卸載、讀回或推論結果不明 | 保留原因與診斷 | 400 `k_selfhost_state_unknown` | 不喚醒 | 同上；不重試、不重送、不清除未知狀態 |

即使 CLI 有結束碼也不解除未知，沿用前一批 Opus 的決定：一次讀回缺席不能證明引擎不會晚到。K 重新啟動後，如果那時真有執行個體，會被當成外部執行個體擋下，不會被覆蓋或卸載。Codex 原生的重試迴圈沒有修改。

## 測試

第一輪聚焦 59/59 由主代理執行並通過。第二、三輪最終聚焦 75/75、完整 1787/1787 通過，涵蓋下列項目：

- `test/native-error-class.test.mjs`
  - 用實測 payload 驗證四種準備類代碼都歸為 `hard`，包括放在 additionalDetails 的情況。
  - 上游失敗代碼、非 K 的 400、只出現 K 字樣的英文文字，仍歸為 `other`。
- `test/native-notices.test.mjs`
  - 改用實測 payload；刪除自己假設的英文包裝案例。
  - 驗證中文概述不提重試或重送，非原生紀錄的文字不改寫，其他供應商不變。
- `test/work-activity.test.mjs`：自架回合開始後是準備中的說法，有輸出後是「執行中」；GPT 階段不變。
- `test/selfhost-permission-copy.test.mjs`
  - 整個權限選單不再出現「外部隔離」；自架的代我核准標明尚未驗證。
  - 原生設定 `auto_review`、`on-request`、`never`、`dangerFullAccess` 都不變。
- `test/local-model-runtime.test.mjs`、`test/gemma-responses.test.mjs`：配合用語更新斷言。
- 新增真正瀏覽器的 **`test/selfhost-ui-probe.mjs`**（已建置的介面，加上假 API 與假快照；不連正式 K、LM Studio 或模型）。它檢查：
  - 新對話的自架說明只在自架分頁出現。
  - GPT 與自架的權限選單文字，以及自架「代我核准」確認畫面；按取消後仍是預設的「要求核准」。
  - 自架聊天室用實測 payload 顯示單一中文失敗通知，原生紀錄可以展開，且與原始資料完全一致。
  - 沒有原生紀錄時，可以展開原文。
  - 忙碌但還沒有模型輸出時，顯示「正在準備自架模型或等待回覆」，不含「已載入」「正在載入」「執行中」。
  - 沒有任何 POST，畫面沒有水平溢出。

以上本批測試全部用 mock，不載入語言模型、不推論；使用既有測試暫存機制，截圖保存在本輪忽略的工程證據目錄。整套既有 UI 測試另包含 Whisper 合成語音轉錄，與本批語言模型無關。

## 限制與尚未確認

- **沒有精確的載入進度顯示**：自架連線是同模型各聊天室共用的物件，載入請求對應不到是哪個聊天室，要做就得新增並行的狀態通道。目前只顯示「正在準備自架模型或等待回覆」，不分辨載入中、已載入或模型仍在處理提示。
- **自架模型下的 auto_review**：能否運作、由哪個模型審查，都沒有證據。只標示尚未驗證，保留原生設定，不降級、不升級、不 fallback。
- **GGUF 載入是否接受 `--parallel 1`**，以及移除 MTP 參數後的效能與記憶體，都沒有實測，要等本人親自試模型。
- 400 實測只涵蓋 Codex 0.163.0。核心更新後，如果錯誤格式改變，前端會退回顯示原文或中文概述，原生紀錄仍可展開；目標接續分類則會失去 K 代碼的辨識，需要重新核對。

## 第三輪小修與最後只讀複查（Opus 5.5，未執行命令）

- `test/selfhost-permission-copy.test.mjs`：原本的正則先比對到確認標題「啟用完整存取權？」，造成測試失敗。現在只在確認段落（`<p>`）內比對，並加上段落必須以「此對話將略過 Codex 權限提示與命令沙箱」開頭的斷言；「K 沒有另外的隔離層」與自架 auto_review 尚未驗證的檢查都保留。
- `frontend/model-picker.jsx`：模型清單讀取中的文案從「正在載入模型…」改為「正在讀取模型清單…」，避免被誤認為正在載入權重。
- `frontend/main.jsx`：原生錯誤詳細內容下方的人用說明改成「未回報的請求識別碼與建議等待時間維持未知。」；原始事件與展開的 JSON 不變。
- 最後只讀複查本批程式 diff，結論是沒有需要修改的阻擋問題：
  - **根因修正**：載入參數只移除兩個沒有 GGUF 證據的選項（其中一個已證實被拒），其餘照舊，讀回核對照舊。
  - **原生權限**：權限模式與原生設定沒有改，只改文字；舊對話權限不動，提高權限仍須確認。
  - **未知不重播**：未知狀態只在 K 重新啟動時解除；不重試、不重送；K 的拒絕不喚醒目標接續；推論中取消照舊卸載並讀回。
  - **介面文字**：沒有外部隔離承諾；沒有宣稱正在載入、已載入、推論完成或自動審查已驗證。
  - **已接受的資料不足限制**：原生錯誤沒有紀錄、只剩純文字時維持原文，不新增猜測式分類。
- 當時測試交主代理執行；最終結果見文末。主代理對 `test/selfhost-ui-probe.mjs` 做小調整（「查看原始內容」改用 waitFor 等待），本輪沿用，沒有更動。

## 第四輪：完整 UI 回歸的長訊息收合阻擋（Opus 5.5，未執行命令）

### 主代理提供的證據

- 完整 UI 第二輪結果是 48/49，唯一失敗是既有的 `test/long-user-text-ui-probe.mjs`：手機 390 寬，長訊息收合後，「展開全文」按鈕跑到可視區外。
- 直接執行這支 probe 會通過；經 `scripts/run-ui-probes.mjs` 的 spawnSync 執行就能重現。
- 主代理用不改產品的偵錯副本量測幾何位置：收合後立即與 200ms 後完全相同，按鈕 top=-1251.89、viewport top=96.39，確實無法到達，不是測試等得不夠久。

### 判斷

- **本批之前就存在**：`docs/k-audit-followups-20261014.md` 與 `docs/k-noncodex-cleanup-20261016.md` 都記錄過同一斷言在整輪時偶發失敗、單獨重跑通過，當時根因沒有查明。本批沒有修改 `chat-messages.jsx`、對話捲動或相關樣式；這支 probe 的聊天室是 GPT／Claude／Gemini，沒有錯誤提示，本批改的自架文字與錯誤呈現都不會出現。
- **有直接證據的部分**：`UserMessageText` 在收合的 layout effect 裡把按鈕捲回可見範圍，焦點斷言也通過，表示這段有執行。但量到的位置離可視區上方約 1300px，表示有別的程式在這之後又捲動了 viewport。
- **推論，尚未證實**：最可能是 assistant-ui `ThreadPrimitive.Viewport` 的內容觀察器，在同一次收合之後執行「跟隨到底部」。這支 probe 的狀態是「工作中」，viewport 內的工作狀態列（`main.jsx` 的 `WorkStatus footer`）每秒更新一次文字，所以會不會觸發，取決於這次更新與 probe 動作的先後，跟整輪跑和單獨跑結果不同的現象相符。依賴套件原始碼受本輪工具權限限制無法讀取，所以這不能算已確認的根因。

### 最小修正

`frontend/chat-messages.jsx` 的 `UserMessageText`：

- 保留原本收合時的焦點與立即捲回。
- 另外在收合的同一個 effect 裡建立一個 ResizeObserver，觀察文字容器，只通知一次就中斷連線，並在通知時再把按鈕捲回可見範圍。
- 依 ResizeObserver 規範，同一個畫面中的通知按觀察器建立先後送出；這個觀察器在點擊時才建立，所以排在 viewport 既有的觀察器之後。微任務形式的 MutationObserver 也比它早執行。
- 沒有固定延遲、沒有重試、沒有新的狀態或人用設定；可達性斷言沒有放寬或刪除，probe 也沒有改。

### 主代理驗證結果

- 主代理讀取已安裝 assistant-ui 的 `useThreadViewportAutoScroll.js` 與 `useOnResizeContent.js`：內容的 MutationObserver／ResizeObserver 在高度改變時可依跟隨狀態捲到底部；觀察器由穩定的 managed ref 掛載，不是每次 render 重建。收合本身改變屬性與高度即可觸發，不需要假設每秒工作狀態更新才會發生。
- 經 spawnSync 的長文字與自架兩支 probe 2/2 通過；隨後完整 UI 49/49 通過。原可達性斷言與 probe 均未修改，沒有用固定等待掩蓋失敗。
- 最後完整 `npm test` 再跑 1787/1787 通過。未增加新依賴、持續觀察器、框架或人用設定。

## 主代理獨立驗證

- 聚焦 75/75、完整 `npm test` 1787/1787 通過，沒有略過項目。UI 建置通過，只有原有 chunk 大小提示。
- 正式安裝的 Codex 0.163.0 再跑 loopback 模擬 400：一次請求、零重試、回合 failed、中文呈現正確；最終 `recoveryErrorClass` 讀回 `hard`，不喚醒目標自動接續。沒有呼叫真實模型推論端點。
- 新自架 UI probe 通過；主代理目視核對權限選單、失敗摘要與準備中狀態截圖，無水平溢出，零 POST，沒有變更本人權限、載入或重播工作。主代理修正 probe 等待 React 換畫面的時序，沒有修改產品行為；Opus 第三輪已看到並沿用這項調整。
- 首次完整 UI 為 47/49，第二次 48/49，最終 49/49。前兩次失敗紀錄保留：長文字收合確實被 viewport 後續捲動蓋過，第四輪修正；語音測試因工作樹沒有預設的語音環境而逾時，重跑只在測試程序環境指定本機既有 Whisper Python／模型路徑，不安裝、下載或修改正式語音設定。
- `git diff --check` 通過；22 個變更／新增檔案的秘密樣式檢查沒有發現疑似秘密。模型專名、識別碼與展開的原始協定診斷保留原文；只有沒有對應原生紀錄的未知純文字錯誤仍維持原文，不用猜測式翻譯冒充已分類。
- 真正 Opus 的四輪 system/init 都是 `claude-opus-5-5`，同一原生 session `78e54e0d-269d-4b23-aa6f-872586f8f202`，四輪正常完成。第四輪最終複查無其他阻擋意見；不是自查或其他模型代替。主代理補查依賴實作並接受最小修正。證據為工作樹 `.runtime/archive/selfhost-compat-20261019/` 的 `opus*-events.json`、`opus*-result.json`、`focused-accepted.log`、`full-test-accepted.log`、`all-ui-final.log`、`native-400-readback.json` 與 UI 截圖／結果。

本人已再次確認「已離開並停止 K」。模型實測由本人親自進行，AI 不先載入、推論或重送失敗工作。原生自動審查與實際 32K 記憶體仍未驗收，未把 mock 通過升級為模型可用保證。
