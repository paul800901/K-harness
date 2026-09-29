# Opus 審查：R2 第一批候選（2026-09-29）

> 審查者：Claude Opus 5.5（正式 K 內）。對象：`R1-source-20260929`（9d22642）→ `R2-candidate-20260929`（51b61b1，分支 `codex/r2-simplification`），交接見 [r1-r2-release-20260929.md](r1-r2-release-20260929.md)。
> 本輪只讀審查＋假資料重現＋測試重跑；未修改 R1／R2 程式、未部署、未重啟 K、未提交 git。

## 結論：有條件通過——B1 有一個必修缺陷，修好前不要試用

| 項目 | 判定 | 說明 |
|---|---|---|
| A1 環境變數完整繼承 | 通過 | 改動最小且方向正確。訂閱保護仍有三道：claude-host `sanitizedEnv`（ANTHROPIC_／CLAUDE_CODE_／AWS_ 等全刪）、`inspectClaude` 要求 claude.ai＋firstParty、Codex `account/read` 必須是 chatgpt。新刪除的 5 個鍵對 Claude 是重複保護，無害。 |
| A3 外部 Chrome 不再探測 | 通過 | `!launchContext` 條件正確：外部 Chrome 與內嵌 Electron 都自帶 context，只有舊「Playwright 自啟 Edge」仍檢查。 |
| A4 保留錯誤原因 | 通過（小建議） | 見下方第 5 點。 |
| A5 通知測試改條件等待 | 通過 | 正向斷言改成等待條件，負向（不重送）斷言保留，沒有弱化。 |
| B1 每對話單一紀錄檔 | **不通過，需修** | 見第 1 點：刪除封存對話在 R2（及退回 R1 後）失效。 |
| B2 只讀單一投影 | 通過 | 邏輯等價，`persisted(null)` 行為與原本一致。 |

## 發現

### 1.【必修】B1 改了檔名格式，但「刪除封存對話」仍只找舊格式

`src/archive-delete.mjs` L41 只收 `${threadId}-*.json`（舊 append-only 格式）；B1 新檔名是 `${threadId}.json`，不含 `-`。archive-delete 的測試是手寫舊格式檔案，所以 644 項全過卻沒測到。

假資料重現（`.runtime/audit-20260929/r2-archive-delete-repro.mjs`，對 R2 checkout 執行，只用暫存目錄）：

| 情境 | 結果 |
|---|---|
| 1. 只在 R2 存過、已封存 | 刪除失敗「K 對話紀錄不存在」；清單仍顯示已封存 |
| 2. 舊紀錄未封存、在 R2 封存 | 刪除失敗「只能刪除已封存的 K 對話」；清單顯示已封存 |
| 3. 舊紀錄已封存、在 R2 取消封存 | **刪除回報成功**：舊檔被移走，但新檔仍在、清單顯示「未封存」——「只能刪已封存」的保護是用過期的舊紀錄判斷的；若同時有 Claude 投影／待送佇列，也會一起被移進回收筒 |

使用者實際會碰到的是 1、2（在 R2 封存後刪不掉）；3 需要過期的介面或直接呼叫 API 才會觸發，但它是破壞性操作的保護漏洞。退回 R1 後同樣如此：R1 的 archive-delete 也只認舊格式。

**建議修法（最小、同時相容 R1）**：把固定檔名改成保留 `${threadId}-` 前綴，例如 `${threadId}-current.json`。如此 R1 與 R2 的 archive-delete 都會收進它，並以同一套「最新紀錄」規則判斷是否封存，archive-delete 不必改；R2 `listMainSessions` 的 `startsWith(\`${threadId}-\`)` 篩選也已涵蓋。已在暫存副本模擬這一行改名（`.runtime/audit-20260929/fix-sim/`，未動 R2）：原 archive-delete 不改，情境 1、2 正確刪除，情境 3 正確拒絕「只能刪除已封存的 K 對話」。正式 R1 的 archive-delete 與 R2 相同（已比對），因此退回 R1 也適用。補三個端到端測試：用 `saveMainSession` 建立紀錄 → 封存 → `deleteArchived`（只有新檔、舊未封存＋新封存、舊封存＋新取消封存），並在 R1／R2 交替測試中加入「R2 封存後由 R1 刪除」。

### 2.【建議，試用前或下一批】Windows 改名 EPERM 在最熱的存檔路徑

交接文件提到「數次原子 rename 的 EPERM（原因未定）」。紀錄（C 槽 worktree 的 batch-0）顯示失敗點是既有的「暫存檔改名覆蓋既有檔」：claude-controller `saveRecord`、input-queue、shared-knowledge。這是 Windows 上常見的暫時鎖定（防毒、索引或檔案監看程式開著目的檔）。B1 讓每次對話存檔多一次同類改名。

影響：claude-controller 的 `enqueuePersist` 失敗後會記住 `persistError`，同一個聊天室之後的 `open()`（停止後重新連線）、切換權限重啟、建立分支、切換工作區都會先 `flushPersist()` 而拋錯——一次暫時鎖定可能讓該聊天室卡住，直到下一次存檔成功（切到別的聊天室不受影響，因為那是新的控制器）。D 槽兩次完整測試（Astra 與本審查）都沒出現，正式資料在 D 槽，風險較低但不是零。

建議：把 6 份以上各自手寫的「暫存＋改名」合併成一個共用寫入函式，對 EPERM／EACCES／EBUSY 做短時間、有上限的重試（檔案層級的暫時鎖定處理，不是重送工作），同時完成盤點 F7 的合併。

### 3.【試用前需使用者決定】R2 試用會一起帶上共享知識

正式 R1 與 R2 原始碼的差異，除了 R2 修改的 9 個檔，還有 claude-controller／claude-host／desktop-controller 的共享知識整合與 `shared-knowledge.mjs` 本身（已核對）。直接用 R2 原始碼試用＝同時啟用共享知識。二選一：
- 知情地一起試（等於也在試共享知識）；或
- 只把 R2 的修正移植到正式 R1 的對應檔案上試用，變因比較單純。

附帶：A1 之後，使用者層級的環境變數會進入正式 K。共享知識的外部 Jev 呼叫由 `K_JEV_ENABLED`／`TYPESAFE_API_KEY` 控制；目前使用者與系統層級都沒有這兩個名稱（只查名稱、未讀值），所以不會自動啟用，但日後若設了就會生效。

### 4.【註記】A1 帶進來的其他變數

- 使用者層級有 Codex App 設的 `CODEX_SCRATCH_ROOT`、`CODEX_SCRATCH_POLICY_VERSION`，現在也會傳給 K 啟動的 Codex；預期無害，試用時留意即可。
- 若日後設定 `NODE_OPTIONS`，會進入 K 的 Electron 主程序；目前未設定。可比照 `ELECTRON_RUN_AS_NODE` 一併剔除，非必要。

### 5.【小】A4 錯誤字串

`luna-gateway`、`mcp.mjs`、`worker.mjs` 直接用 `error.message`；若丟出的不是 Error 物件會顯示 `undefined`。可改 `String(error?.message ?? error)`。mcp-stdio 現在會把啟動錯誤原文印到 stderr，檢查過可能的錯誤來源（路徑、參數、模型 ID），不含金鑰值；風險低。

## 本輪驗證

- 差異逐行審查：`git diff R1-source-20260929 R2-candidate-20260929 -- src test`（9 個產品檔、7 個測試檔）。
- 完整測試獨立重跑：R2 同內容副本 `.runtime/r2-validation-20260929`（src／test／shared／frontend 與 R2 checkout 一致）**644/644 通過**；紀錄 `.runtime/audit-20260929/r2-review-tests.log`。
- 假資料重現第 1 點三種情境（輸出如上）。
- 正式 runtime 與 R1 備份逐目錄比對：src、shared、frontend、dist-ui、web 全部相同——確認未部署。
- 環境變數只列名稱、不讀值。

## 給 Astra 的下一步

1. 修第 1 點並補測試（含 R1 交替刪除情境），重跑完整測試。
2. 第 2 點可與盤點 F7 一起做，或至少在試用說明列為已知風險。
3. 第 3 點請使用者決定試用內容後再準備部署。
4. 修好後交回複審；本批其餘部分不需重做。
