# 個人模型分工：AI 內部指引與子代理選單（2026-10-03）

## 2026-10-04 更新：已部署南區並推上 GitHub

使用者明確要求「部署、推上 GitHub」，本次已完成；以下時間均為臺灣時間。

- **正式程式版本：`5b83aa61e9988ffc480ff25c5e88003b8eb443c1`。** 00:14 套用、00:15 原入口重開；視窗「K 執行中樞」、正式 executable、native health、三個實際供應的介面資產讀回皆通過，未授權 state 請求仍為 403。
- 套用前核對無 K 自有程序及 47831 監聽；原版 `df9bc7f` 已保留於 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791044043994`，可依既有流程退程式。四個帳號、目前原帳號、對話資料、語音位置及 Codex 設定保持不變；不是資料備份。
- 乾淨 Git 候選完整測試 **647/647**，fail／cancelled／skipped 0（35,486 ms）；介面、擴充與啟動器建置通過，沿用一致 lockfile 的既有相依，未安裝／升級環境。套用前驗證候選 443 個 Git 檔案一致，原生訊息本機設定保持不變。
- 候選假資料真瀏覽器的子代理排序／選取回歸通過。正式介面再讀回 **auto → gemini-3.8-flash → gpt-6.1-sol → gpt-6-luna**，沒有多餘提示；GPT 名稱沿用官方顯示 `GPT-6.1-Sol`／`GPT-6-Luna`。額度頁 Claude → GPT → Gemini、四個帳號及目前帳號均不變。檢查期間沒有工作或帳號操作 POST，未建立正式新對話。
- **真實 Gemini 規則讀入已補驗通過**：透過本批 controller、官方 `gemini-3.8-flash-low`、獨立假工作區／唯讀權限做一回合，答案正確回傳 `normalWorker: Gemini 3.8 Flash`、`solCodeReviewer: Opus 5.5`、`articleDecision: false`。測試問題未提供前兩個答案；無工具呼叫，沒有讀其他檔案、切換／保存憑證或 API 計費。這是接線驗收，不是模型品質評比，亦不代表真 Sol → Opus 工作流程已另驗收。
- 00:15 已將程式推到已確認為 private 的 `origin/main`：由 `0ae4be1` 快轉至 `5b83aa6`，遠端 SHA 讀回相符；沒有 force push、刪／移舊標記或搬本機資料。其後工程文件提交會同樣推到 main；程式碼不變，部署版本仍為上列 SHA。
- **東區未更新**，下次當地依 `origin/main` 安裝／更新；登入與語音設定仍留在各自電腦。前四項遺留問題沒有因本次部署而修復，仍見整批回查紀錄。

部署證據在 `D:\K-harness\.runtime\model-role-deploy-20261004`：`gemini-native-rules.json`、`preparation.json`、`full-tests.log`、`candidate-worker-ui.json`、`pre-activate-processes.json`、`activation.json`、`live-ui-readback.json`、`normal-start-readback.json`、`served-readback.json`、`github-code-readback.json`；文件推送後另留 `github-final-readback.json`。

## 2026-10-03 開發階段紀錄（當時尚未部署）

已寫入維護來源的三家主代理接線，不只存文件；已通過本機回歸與假資料介面操作。**本批尚未部署正式 K，未 push／打 tag，東區不動。** 正式版本讀回仍為 `df9bc7f339c4a82557c3cec50cdd9e3c97e221ee`，四帳號、對話及登入均未更動。

維護來源是 `C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`（`codex/r3-2`），不是根目錄的舊實驗程式。根目錄只同步本批工程文件，不整批覆蓋其既有改動。

## 使用者定案

| 模型 | 本人的分工偏好 |
| --- | --- |
| GPT-6 Astra | 後端、架構、複雜工程與技術判斷 |
| Opus 5.5 | 通才、平常的大腦；複查 GPT 程式的正確性及過度工程化 |
| Gemini 3.8 Flash | 低成本、快速的優先工人；文章閱讀、理解、撰寫、審美及 Google 商家相關工作；也可主導簡單任務與提出大方向 |
| GPT-6.1 Sol | 平常的輔助大腦；寫碼後必須由真正 Opus 5.5 審核 |
| GPT-6 Luna | 除本人指定外，只在小任務特別要求嚴格遵守規則時使用，不再當一般預設工人 |

- 文章通常先交 Gemini，Opus 5.5 最後提供第二意見與盲點；不是 Opus 說了算，是否採納依理由、證據與文章效果，由使用者決定。
- Opus 複查 GPT 程式要找不必要架構、重複檢查、無用備援、多餘狀態／設定；採最小完整解，保留必要原生權限、核准與未知工作不重播。
- Sol 程式碼的真正 Opus 5.5 審核不能由自查、測試或別的模型冒充。缺少可用管道時，在工程交接紀錄保留待審及交接內容，不另外提醒使用者，不擅自建新派工管道。
- 不需要 Gemini 主代理自動派 GPT／Claude；使用者會另開聊天室複查成果。這不是待補功能。
- 這是個人偏好，不是能力排名、硬性路由或自動評估系統。本人當輪指定、已保存的手動模型／推理設定優先；不可用時不暗換模型，不改登入、計費或權限，不重播未知工作。
- **只給 AI 知道，不增加人用分工／審核提醒、彈窗、按鈕、設定或確認流程，也不主動重述這套分工。** 真正登入、核准、工作失敗仍照既有方式處理。
- 子代理選單順序為 **AI 自動選擇 → Gemini 3.8 Flash → GPT-6.1 Sol → GPT-6 Luna**。只排列原生目錄與已接通入口允許的選項，不為湊四項而假造可用模型；既有手動選擇不變。

## 最小實作

- `src/worker-policy.mjs`：一份共用 `MODEL_ROLE_GUIDANCE` 文字；Codex 沿原有 `developer_instructions` → `developerInstructions` 接入，原生 start／resume 共用既有流程。
- `src/claude-host.mjs`：共用文字接原有 `--append-system-prompt`；同步移除過時的 Sol／Luna 平等選工人說明。
- `src/luna-gateway.mjs`：更新現有工具描述，明示 Flash 優先及 Sol 寫碼需要 Opus 真審；不動工具 schema、權限與派工執行。
- `src/gemini-controller.mjs`：在既有每對話 K 專用 HOME 下，寫入 `.gemini/config/rules/k-model-roles.md`，採原生 `trigger: always_on`；不覆蓋使用者的 GEMINI.md、不改真正 Windows HOME、不新建另一套 profile、不修改使用者文字。
- Gemini 的接法依 [官方 Rules 文件](https://www.antigravity.google/docs/rules/)：CLI 可讀取該 rules 目錄及 always_on 規則。最初曾用 `-p` 前綴，複查後改為原生規則入口，避免把分工每輪塞進使用者聊天歷史及命令列長度；**本批尚未用真實 Gemini 回合證明其已讀入**，不把檔案測試當原生模型驗收。
- `frontend/model-picker.jsx`：只排序過濾後的子代理目錄；保留原本選取值與推理程度；刪除一般派工說明及不需要的 Gemini 反向派工提示。真正目錄不可用的錯誤仍保留。

沒有新增分類器、審核系統、自動換模、工人品質評估或產品按鈕。Flash 子代理由主代理交代範圍，本批不另給工人加一套完整的選模規則。

## 驗證

- 最初定向 **36/36**、加上 Codex 真正送出欄位後 **47/47** 通過。
- 最終完整 `npm test`：**647/647** 通過，fail／cancelled／skipped／todo 均為 0，33,262 ms。包含原有權限、登入／帳號、停止、未知工作不重送等回歸，不是 647 次真實模型測試。
- Codex 假 host 收到的 `thread/start.developerInstructions` 包含共用指引；Claude 假 CLI 核對 `--append-system-prompt`；Gemini 假 CLI 所使用 HOME 中的規則檔與內容讀回一致，重開原生對話仍有規則，`-p` 及介面保存文字維持原文。
- `test/gpt-flash-ui-probe.mjs` 真瀏覽器／假 API 操作通過：亂序目錄下 GPT 與 Claude 都呈現指定四項順序／標籤；預設 auto 不變；既有 Sol/high 保留；選 Flash/medium 送出不變；沒有 gateway 時不顯示 Flash；沒有多餘派工／反向派工提示。
- UI 建置通過；既有大型 bundle 提示仍在，未為本批拆包。`git diff --check` 通過（僅原有換行提示）。
- 未做模型選擇品質評估，符合使用者不為 AI 自動選擇另做調校／品質驗收的決定。正式介面、真 Gemini 規則載入、真 Sol → Opus 工作流程尚未因本批重新實測。

本機證據在維護來源 `.runtime/model-role-guidance-20261003/`：`targeted-tests.log`、`targeted-final.log`、`full-release.log`、`worker-ui.log`、`ui-build-final.log`，以及 Opus 實際串流與最終回覆。

## 真正 Opus 5.5 複查與處理

使用既有官方 Claude Code 2.1.285／Claude 訂閱，模型回傳確認 `claude-opus-5-5`；只讀本批資料包，不開 shell／寫入工具、不改權限、不使用 API 計費。原始 session 為 `9e86b4b7-fa0d-4907-9323-2b04d18d028a`。

- 初查沒有程式阻斷問題；指出 README 仍把 Gemini 反向派工列成尚未接入，已改為使用者選定不需要。
- 初查對 Gemini `-p` 前綴的建議不是原生能力實測；Astra 查官方文件後改用原生規則，Opus 補看確認接線，亦明確保留「未真 agy 驗證」限制。
- 採納補看對「不要提醒」與「標待審」的語意疑慮：待審放工程交接紀錄，不新增對人提醒。
- 使用者後來追加的選單順序與移除提示另請 Opus 定點補看；原文附於本文件末尾，不把前次看過冒充本次全部都看過。

## 檔案、部署與未處理

修改：`AGENTS.md`、`README.md`、本紀錄、`docs/development-log.md`；前述 5 個程式檔；`test/worker-policy.test.mjs`、`test/claude-host.test.mjs`、`test/codex-flash.test.mjs`、`test/gemini-controller.test.mjs`、`test/luna-gateway.test.mjs`、`test/gpt-flash-ui-probe.mjs`。

- 本批保留在本機 Git 版本，沒有更新運行中的正式 K、push、標記版本或更動東區。
- 先前四項 Gemini／Flash 遺留問題見 [整批 Opus 回查](opus-batch-review-20261003.md)，本批沒有順便補修，也不宣稱已解決。
- 維護來源原有 `browser-extension/extension-protocol.cjs` 換行差異不納入提交。根目錄其餘既有改動不動。
- 後續部署仍需確認 K 工作已停止、依既有流程保留程式還原版本並正式讀回；程式退版不還原對話／帳號資料。本批不提前將候選說成正式生效。


## 附錄：Opus 實際回覆原文

下列保留各次回覆；初查包含後來已更換的 Gemini 前綴設計與未查證假設，以前文最終實作及限制為準。Opus 的「未發現問題」不是三家模型或正式 K 都已完成真實驗收。

### 第一次：指引接線

# Opus 5.5 只讀複查：模型分工指引小改

**結論：沒有必須修的阻斷問題。** 三條接線都對到同一個共用常數。我沒有找到任何地方誤稱有「Opus 跨派管道」，也沒有新增路由或審查機制。只有 1 處文件語意和你的定案衝突，建議用一行修掉；另外 2 點可選。

## 三條接線（只看程式碼，沒有執行）

1. **Codex**：`MODEL_ROLE_GUIDANCE` 定義在 `current/src/worker-policy.mjs:9`，在 `:51` 被放進 `instructions` 的第一段，再於 `:63` 併入 `developer_instructions`。手動、自動、Flash 三種模式都會帶到。
   - 自動模式的舊說明（`:55`）只寫「依任務選」，已經沒有「依難度平等挑 Sol／Luna」，所以不衝突。
2. **Claude**：`HOST_INSTRUCTIONS` 在 `claude-host.mjs:17` 把指引放在最前面，`:293` 沿用原本的 `--append-system-prompt`，沒有新增參數。
3. **Gemini**：`gemini-controller.mjs:140` 把指引加在 `-p` 提示前面；附件仍附加在後面。依 diff 的測試，存回介面的使用者訊息還是原文。
4. **MCP 描述**：`luna-gateway.mjs` 已移除「Flash 只適合機械性工作、難題交 Sol」，改成「Flash 是優先的一般工人」。自動模式的選擇說明也已改成 Flash 優先、Sol 是輔助大腦、Luna 只做規則要求極高的小任務。

## 語意與是否誤稱
- **Opus 審核管道**：常數 `:17`、MCP 描述、README、AGENTS 都寫「沒有管道就標示待審、交接給使用者的 Opus 聊天室，不自行新增派工」。`:10` 還寫明「角色不代表已有跨供應商派工能力」，沒有冒稱。
  - Codex 只有 Flash 專用入口，Gemini 也沒有派工入口，所以兩邊都會落到「待審交接」。
  - Claude 主對話預設是 `claude-opus-5-5`（`:12`），由它複查 Sol 的結果算是真審。
- **手動設定與「Flash 優先」**：常數 `:10` 寫明已保存的手動設定優先；Claude 和 MCP 的「優先 Flash」也限定在 AI 自動模式。兩者不衝突。
- **文章分工**：寫的是「Opus 不是裁判、由使用者決定」，符合你的定案。
- **有無變成架構**：只有一個字串常數，接到三個原有入口。沒有分類器、審核關卡、新設定或權限改動。

## 需要修的（1 處，僅文件）
- **`current/README.md:24` 結尾**仍寫「Gemini 主代理的跨供應商派工尚未接入」。這和你定的「不把反向派工列成缺口」以及同檔 `:22` 衝突，因為「尚未接入」讀起來像待辦。
  - **最小修法**：把這句改成「Gemini 主代理不派 GPT／Claude（選定用法，見上）」，或直接刪掉。

## 可選（不修也沒關係）
- **Gemini 每輪都重送指引**：繼續對話時，約 1k 字的指引每一輪都會再加一次，會累積在原生歷史裡，多耗 token 和額度。
  - 因為 agy 沒有系統提示可用，每輪加是最穩的做法；我建議維持現狀。只有在額度吃緊時，才考慮改成「只在第一輪加」；代價是改版前已存在的舊對話會拿不到指引。
- **`AGENTS.md:8` 的舊描述**寫「不固定 Astra／Sol 的用途」。這是講產品不寫死模型路由，和新段落的「個人偏好」不算衝突，但字面上像矛盾。可以在新段落補一句「僅為偏好，與第 8 行不衝突」，也可以不動。
- **測試**：`worker-policy.test.mjs` 對常數本身做了 14 個比對，有點像拿常數驗自己。不算過度工程化，可留。

## 實際閱讀範圍
- `changes.diff` 全文（228 行）
- `current/src/worker-policy.mjs` 全文（65 行）
- 用 Grep 定點看過：
  - `current/src/claude-host.mjs`：第 12–20、79、83、278、290–296 行
  - `current/src/gemini-controller.mjs`：第 10、140、141、145 行
  - `current/README.md` 和 `current/AGENTS.md` 中提到跨供應商、反向派工、model-role-guidance 的幾行
- 讀 diff 時看到第 1 行很長的 `HOST_INSTRUCTIONS` 和 MCP 描述的完整新舊內容。

## 未驗證
- 測試檔與 `luna-gateway.mjs` 只看了 diff 的部分；README、AGENTS 也只看了上面那幾行，不是全文。
- `workerPolicyConfig` 的呼叫端不在資料包裡，所以沒有確認 `developer_instructions` 真的送到 Codex 的 `developerInstructions`。
- `docs/model-role-guidance-20261003.md` 不在資料包裡，沒有確認它存在，也沒看內容。
- 沒有執行任何測試；你提到的 36/36 和完整回歸都不是我跑的。
- 沒有看 agy 的說明或實際執行時的行為，沒有確認模型真的會照指引做，也沒有查登入或其他目錄。

### 第二次：原生規則與不要提示

# 最後補看：README 舊句、內部指引、agy 規則檔、Codex 接線

**結論：本批沒有引入實質問題，不需要再修改才能合入。** 只有一處字句可能被模型讀成兩種意思，可修可不修，見文末。

## 1. README 舊句：已採納，沒問題
- `changes.diff:37` 已改成「Gemini 主代理不派 GPT／Claude，成果由你另開聊天室複查」。
- 和 `:35`、AGENTS 新段第 19 行、共用指引一致，不再寫成待辦或缺口。

## 2. 指引只供 AI 內部使用：沒問題
- 共用指引開頭（diff `:115`）寫明不向使用者重述，也不新增提醒、彈窗或確認流程。
- AGENTS 第 11 行、README `:35`「也不另做提醒或確認流程」都和它一致。
- 這批沒有新增任何介面、設定或審核關卡。
- 「未審就不冒稱完成」仍保留在 `:123`，以及 luna_start 的描述裡。

## 3. agy 規則檔：接法正確，但 agy 是否真的讀取未經實測
程式碼核對結果：
- `gemini-controller.mjs:46`：`home()` 是 `agent-home/gemini/main/<threadId>`，也就是每個對話各自的目錄。
- `:79`：`prepare()` 把規則檔寫到這個目錄下的 `.gemini/config/rules/k-model-roles.md`，內容開頭是 `trigger: always_on` 的 YAML 標頭。
- `:170`：agy 用 `geminiEnvironment(env, home())` 啟動，所以規則檔所在的目錄就是 agy 實際拿到的 HOME。依測試，HOME 和 USERPROFILE 相同，且都在隔離目錄裡。
- `:141`：`-p` 已恢復成只送使用者原文。
- 規則檔寫在隔離目錄，不會碰到真正的 Windows HOME 或你的 GEMINI.md。每次 open 或 send 都會覆寫同一個檔，內容固定，所以重寫沒有副作用。
- 我認同這比改 `-p` 前綴好：指引不會每輪重複寫進對話歷史，也不會佔用 Windows 命令列長度。

**沒有驗證的部分：**
- 我沒有打開那份官方 Rules 文件，路徑和 `trigger` 格式是依你轉述。
- 新測試只用假的 CLI 確認檔案寫到正確位置，無法證明真的 agy 會在 `-p` 無介面模式下載入這份規則。
- 如果 agy 沒讀，Gemini 主對話會沒有指引，而且不會出錯。前一版用 `-p` 前綴至少保證送得到。所以在把 docs 標成「正式生效」之前，建議用真的 agy 讀回一次確認。這只是一次性的驗收，不是新功能。

## 4. Codex 接線：已核對，正確
- `desktop-controller.mjs:564`：`workerPolicyConfig` 會接在原本的 `developer_instructions` 後面。
- `:569`：結果放進 `developerInstructions`。
- `:573/580/582`：resume、unarchive 後的 resume、start 三條路徑都用同一份設定。
- diff `:174` 的測試確實讀取 `thread/start` 的 `developerInstructions` 並檢查裡面有共用指引。

## 可選，不修也沒關係
共用指引第一行（`:115`）說「不向使用者主動重述、不新增審核提醒」，`:123` 又說「明確標示『待 Opus 5.5 審核』」。模型可能把後者當成每輪都要提醒。

最小修法：把 `:123` 的「明確標示」改成「在該次交付結果中標一次」。如果你覺得現在的意思已經清楚，可以不改。

## 實際讀過的範圍
- `changes.diff` 第 1–220 行。第 221 行以後只看到 hunk 標頭，那是 worker-policy 測試，index 和上一輪相同，所以沒有重讀。
- `current/src/gemini-controller.mjs` 第 40–149 行，另外用 Grep 查了 `:170`。
- `current/src/desktop-controller.mjs` 用 Grep 看了 `:8–12`、`:430–432`、`:562–583`。

## 沒有驗證的事項
- 沒有跑任何測試；你說的 47/47 和完整回歸都不是我跑的。
- 沒有用真的 agy 確認規則檔會被載入，也沒讀官方文件。
- 沒確認 `atomicWrite` 會不會自動建立 `rules/` 目錄。測試能讀到檔案，應該是會，但我沒有看 `atomicWrite` 的原始碼。
- 沒看 Flash 子代理（gateway 那邊）用的是哪個 HOME，所以不確定子代理會不會也讀到這份規則。
- `thread/fork`（`:431`）本來就沒帶 `developerInstructions`，不是這批引入的。分出來的對話會不會沿用原對話的指引，我沒有確認。
- `docs/model-role-guidance-20261003.md` 不在資料包裡，沒看。

### 第三次：使用者追加選單順序

**結論：這次追加沒有引入實質問題，也沒有過度工程化，不需要再改。**

## model-picker.jsx（diff `:42–80`）
- **排序**：只在原本的可用性與 gateway 過濾之後加一個 `.sort`，排序依據是一行 `workerOrder` 常數（`:50`），不是新機制。
  - `filter` 會產生新陣列，所以排序不會動到傳進來的 `models`。
  - 過濾後剩下的項目一定在 `workerOrder` 裡，不會出現 `indexOf` 回傳 -1 的情況。
  - 「AI 自動選擇」是寫死在最前面的選項，所以永遠排第一。
- **沒有動到保存與送出**：`setWorkerPolicy`、`workerEfforts`、`invalidWorker` 都沒改，送出按鈕的條件也不變。
  - 已保存但目錄暫不可用的模型，仍會顯示「（目錄暫不可用）」。
  - Flash 目錄不可用時的錯誤提示仍保留。這是阻擋送出的真錯誤，不算多餘提示。
- **刪除的提示**：
  - 子代理說明（自動與手動兩種）已刪。
  - 「AI 自動選擇」後面的「依任務難度」已拿掉，也避免和新的分工說法衝突。
  - Gemini 那行反向派工未接入的提示改成 `null`。
  - 三處都符合「不給本人多餘提示」。

## gpt-flash-ui-probe.mjs（diff `:243–289`）
假目錄故意亂序放入 Luna、Sol、Flash、Opus，涵蓋的檢查有：
- GPT 與 Claude 主代理下的選項順序與名稱
- 預設選中「AI 自動選擇」
- 沒有提示文字（`.step-hint` 數量為 0）
- Flash 送出時推理程度為 medium
- gateway 關閉時 Flash 不出現
- 已保存的 Sol／high 保持選中
- Gemini 主代理下沒有子代理區塊，也沒有舊提示

涵蓋範圍適當，沒有多餘斷言。第 279 行多一個空格縮排，只是格式問題，不影響功能。

## worker-policy.mjs 與 AGENTS（diff `:161–163`、AGENTS `:11`、`:19`）
- 沒有 Opus 審查管道時，現在改成「在工程交接紀錄標示待審、保留交接內容、不額外提醒使用者、不宣稱已審」。我前次指出的矛盾已經解決。
- 名稱已改為 GPT-6 Luna。前次讀過的 worker-policy 測試裡，比對 `Luna：除非…` 和 `待 Opus 5.5 審核` 的兩條，用的是子字串比對，新文字仍會符合。不過我只是憑前次讀過的內容判斷，沒有實際跑測試。
- AGENTS 新增的排序規則（`:11`）和實作一致。

## 實際讀過的範圍
`changes.diff` 只讀了三段：
- 第 1–80 行：AGENTS、README、model-picker
- 第 145–176 行：worker-policy
- 第 243–289 行：UI probe

其他檔案這次沒有讀。

## 沒有驗證的事項
- 沒有跑測試、UI probe 或建置；你說的「通過」都不是我跑的。
- 選單上顯示的名稱取自原生目錄的 `displayName`。測試用的是假名稱，實際目錄裡的名稱我沒有確認。
- `model-picker.jsx` 的 import 區和 probe 用來等待的 `aria-label="主代理模型"` 元素，我都沒有讀原檔確認。前者從舊程式已在使用 `WORKER_MODELS` 推斷應該已經 import。
- 其他入口沿用前次讀過的版本，這次沒有重讀。
