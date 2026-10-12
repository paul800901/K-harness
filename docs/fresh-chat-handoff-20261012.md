# 真正空白新聊天室與 AI 交接（2026-10-12）

## 需求、直接原因與界線

本人要 AI 可呼叫、與 Codex App 建立新聊天室相同用途的工具：在同專案開全新原生對話，只帶最新明確交接後接續，不能用帶舊歷史的分支冒充。既有 `conversation_continue` 實際執行 `thread/fork`，故換 ID 後仍保留壓縮，並非顯示次數沒有清除。

本人本轮已確認 K 關閉，授權驗收後直接更新；Claude 若確實額度不足，本次可免其複查。未授權操作原翻譯房，本批只用新假資料房做實測；不 push、不更新東區、不換帳號／模型／計費、不停原工作。

## 最小完整實作

- 新增 Codex 主代理 AI 工具 `k_gemini.conversation_create`：固定 fresh，用 `thread/start` 而非 fork。第一則是明確交接，不傳舊 turns／摘要／壓縮／工具紀錄／附件成果清單。原生仍正常讀工作區規則，既有檔案仍留原處供按需查閱。
- 保留 `conversation_continue` 的原生歷史分支；兩工具說明明確區分，減輕舊上下文與累積壓縮使用 create。不新增人用按鈕／設定／服務。
- 共用現有一次受理、來源正常結束後建立、一次送出流程。來源真人回合與主代理身份校驗、未結束工人／終端、目標 active／顯式預算、本人新指令／停止／關閉優先的保護不變。同回合換模式明確報衝突，不把先前 fork 收據當 fresh 成功。
- 同 workspace／model／effort／service tier／權限／worker policy。新房 title 以「新對話」開頭，不標「分支自」；模型可讀交接檔後只做剩餘工作，未知副作用不得重播。
- 新 native ID 一取得，先保存獨立房清單及既有接續收據，再等待 MCP／就緒／送訊息。部分建立失敗保留已知 ID；未知結果不自動重建／重送。首個程式交接不是新的真人換房授權。
- K 不轉移、建立或恢復原生目標，不轉移／重設原目標用量／預算；本人本次明確要求新目標時才由模型依原生工具規則處理，不從舊摘要推斷授權。
- 目前接入 **Codex 主代理**；Claude／Gemini 主代理未接此工具，不能宣稱三家等價。此功能不是保證極長任務記憶永不偏移，也不是修復上游 stream／compact 錯誤。

檔案：`src/luna-gateway.mjs`、`src/conversation-controller.mjs`、`src/desktop-controller.mjs`；三個相應測試。`unified-controller` 已原樣傳遞選項，無須新包裝。

## 驗證與原始證據

證據根：`D:\K-harness\.runtime\fresh-chat-handoff-20261012`。

- Sol focused 241/241；追加 fresh-specific guards 後本批 36/36。`focused-sol.log`、`focused-sol-final.log`、`sol-implementation.md`。包含 fresh MCP 固定模式、相互衝突、相同模式冪等、取消／未知不重送、其他房選取不被搶走；真 adapter mock 檢查 source 不讀／不 fork、持久化早於 MCP、送出前後 hasSubmitted、MCP／取消已知 ID 保留。
- Astra 真正官方 Codex **0.161.0 / GPT-6.1 Sol medium / read-only / ChatGPT 訂閱**。API 環境變數清除、只准本次 fake workspace 及新增 ID；其他供應商派工停用。完整 `native/run.mjs`、`start.json`、`result.json` 留存。
- 原房 `01a12ea2-2448-7eb1-b1e4-39e57a843174` 先產生假歷史，真正 manual compact 後為 1 次；真人新輪要求空白換房，模型實際呼叫 `conversation_create`，正常結束後建立新房 `01a12ea2-9b92-78c0-8db5-5823a0d986b3`。
- 兩房共 **2 次 thread/start、0 次 thread/fork**；新房只有 **1 個交接回合、0 次壓縮、無來源 turn ID 或舊歷史標記**。新房實際用原生 command 讀 fake handoff.txt，回覆僅存在檔內的測試標記，並非只做假訊息接續。
- 設定一致、child goal=null、假交接檔 hash 不變；兩次關閉／重開後仍是同一房、相同 title、1 個人類訊息，沒有新模型回合。原翻譯房未讀／未開／未寫／未送出工作。
- 真 built UI 對上述 reopened fake native room 的 1440×960／390×844 讀回成功，無「分支自」及舊歷史；桌面顯示 0 次壓縮。`native/fresh-ui-1440.png`、`fresh-ui-390.png`，Astra 實際看圖；無 page error、無工作寫入。手機是瀏覽器尺寸驗證，不宣稱 USB 手機實機。

- Astra 最終整合全測 **1422/1422、0 failed/cancelled/skipped**（4 並行，約 75 秒），UI build 與 diff check 通過。`full-suite.log`、`ui-build.log`；產品／測試 frozen hashes 與 Opus 所讀產品來源逐 bytes 一致，見 `astra-candidate-acceptance.json`。

## 真正 Opus 5.5 複查與 Astra 裁定

此次 Claude 尚能完成，**沒有使用免複查例外**。官方 Claude Code 2.1.294、claude.ai Pro／firstParty、`claude-opus-5-5`，session `7a3335d2-5e79-4d0c-bc23-c236b9398943`，11 次 Read／Glob／Grep，code=0／success。只讀、無 Bash／MCP／Chrome／寫入，不使用 API fallback。`opus/review.md`、`result.json`、`raw.jsonl` 保留。

結論沒有阻擋上線問題。Opus 指出的 fresh adapter 測試缺口，是初審封包未帶入新 `chat-fresh-native.test.mjs`；Astra 已独立閱讀該檔、核對 focused 及上方真實原生結果。未採用其「清掉預算目標後換房」說法作為操作建議，不能靠換房繞過原有限制。明確拒收仍保守顯示 uncertain、UI 無回原房超連結、極窄崩潰時 origin.initialTurnId 未寫入可能阻止往後再次換房，屬既有／非阻擋觀察，不據此擴張本輪架構或宣稱已修。

## 正式狀態

候選完成整合全測、上述原生／UI 與 Opus 複查後，依本人「修完直接改好，我關 K 了」授權正式更新，結果如下。

### 正式更新與 Astra 獨立讀回（2026-10-12）

- 固定產品版本 **`5a2558633bdb040af2c8a26265f1fcfb2e5ad569`**。Astra 核對 K 自有程序與 47831／5199 listener 均為 0 後，單次呼叫既有 installer activation；沒有強制結束、沒有重送 activation。正式 `.local/runtime.json` 與 installed runtime 已讀回相同版本。
- 前版程式可退回：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791784429349`。這是程式退版，不宣稱是使用者資料快照。
- 封裝三項 build 成功、focused **291/291**；Astra 再核對準備版及安裝後 **687/687 Git 來源 bytes 一致**。沿用獨立複製的既有 dependencies，package／lock 三方一致，未安裝或更新套件／原生核心；本次沒有回復任何生成來源換行。
- 真正式 owner 啟動、health 200、未授權 state 403；實際送出的 JS／CSS 與安裝檔 hash 一致。1440×960／390×844 介面讀回及 Astra 看圖完成，側欄讀回 **27 房**；未選取既有房、busy=false、**0 POST／0 page error／0 新工作**。此為正式服務與瀏覽器雙尺寸，不冒稱手機 USB 實機或使用者捷徑點擊驗收。
- **75 個既有 main-session metadata 的完整清單及 hashes 未變**；五個穩定資料目錄位置與第一層清單未變。selected cores、Codex config、projects、google-ops 四項設定 hash 不變。
- 正常啟動查詢更新 Gemini 額度 cache 的四個欄位：帳號 0 的 auth.checkedAt、quota.checkedAt、lastQueryAt，以及 five_hour.resetsAt（1791800915→1791802548）。Astra 逐欄讀回；帳號身分／登入狀態、每週剩餘 78%、五小時剩餘 100% 及其餘欄位均未變。這不是換帳號或移轉登入，不把動態查詢 cache 宣稱完全不變，也不倒寫舊 cache。
- 測試 browser／正式 owner 正常關閉；最後再次確認 K 自有程序與上述 listeners 均為 0，沒有 force stop。既有兩個瀏覽器 native host 保留、不碰。**原翻譯房未開啟、未恢復、未重播工作，K 維持關閉，使用者可用原捷徑開啟。**
- 證據位於 `D:\K-harness\.runtime\fresh-chat-handoff-20261012\deployment`：`activation.json`、`preserved.json`、`validation.json`、`installed-source.json`、`formal-readback.json`、兩張 `formal-ui-*.png`、`post-readback-preservation.json`、`stopped-after-readback.json`。完整回歸 1422/1422 與 genuine Opus 複查證據見上文。

未 push、未更新東區。此正式功能限 Codex 主代理的真正新房交接；既有歷史分支保留。沒有將上游斷流／壓縮、所有長任務記憶問題、真 Gemini 跨帳號輪換或歷史正常關閉內因宣稱為本次已解決。
