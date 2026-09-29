# R2 複審修正：封存刪除相容與排除共享知識（2026-09-30）

## 結論與範圍

**候選修正及本地驗證完成，待 Opus 複審；未試用、未部署、未重啟正式 K。**

- 回應 [Opus 第一批審查](opus-review-r2-batch1-20260929.md)的 B1 必修缺陷。前次只驗證清單讀寫相容，漏驗刪除端的檔名前綴契約，這是 Astra 本批修改的缺陷，不是 Chrome 或使用者操作問題。
- 使用者本輪明確決定：共享知識測試結果不滿意，只留實驗，正式版不要上。因此新版 R2 候選排除這項功能，不再把「是否一起上線」留作未決問題。
- 單一寫入者：Astra。本輪沒有呼叫 Claude／Codex／DeepSeek 模型工作，也沒有推送 Git。

## 1. 封存刪除的最小修正

`src/main-sessions.mjs` 的固定檔名由 `${threadId}.json` 改為 `${threadId}-current.json`，保留 R1／R2 的刪除器既有 `${threadId}-` 前綴契約。仍是一個對話一個新檔，沿用原子寫入及最新紀錄判定；**沒有修改刪除器、放寬已封存限制或更換回收機制**。

新增 `test/archive-delete.test.mjs` 三個整合案例，由真正 `saveMainSession` 產生最新紀錄，再呼叫 `deleteArchived`，包含 Claude 投影、待送佇列及另一個不應受影響的對話：

| 情境 | 修正前 | 修正後 |
|---|---|---|
| 僅 R2 新紀錄，已封存 | 找不到紀錄 | 正確刪除本對話紀錄、投影及佇列 |
| 舊未封存，R2 封存 | 錯用舊紀錄而拒絕 | 正確依新狀態刪除 |
| 舊已封存，R2 取消封存 | 誤刪 | 正確拒絕，所有原檔逐位元不變 |

`test/main-sessions.test.mjs` 同步檢查 `one-current.json`；30 次同對話並行保存仍只產生一個新檔。首次 R2 從未部署，舊的裸 `${threadId}.json` 只存在先前假資料測試；未新增正式資料遷移，也未清理那些測試證據。舊 `R2-candidate-20260929` 有已知缺陷，不可拿去試用。

## 2. 真正 R1／R2 刪除交替驗證

在 `D:\K-harness\.runtime\r2-validation-20260929\.runtime\r2\archive-native-20260930` 新建六個假資料目錄。直接載入現用正式 R1 的 `main-sessions.mjs`／`archive-delete.mjs`，配合 R2 寫入器；R2 刪除及退回 R1 刪除各測上述三種情境，**6/6 通過**。

此輪用的是未注入替身的 Windows 回收函式：4 份已封存假資料確實進入系統資源回收筒，另以 Shell 回收筒讀回原資料夾、還原清單與全部 14 個假檔，確認可還原；2 份取消封存資料保持原位，其他對話均未動。正式對話、登入、Chrome 資料未讀寫。

證據均在 `D:\K-harness\.runtime\r2-validation-20260929\.runtime\r2`：
- `archive-r1-compat-20260930.mjs`：一次性實測腳本，可供閱讀；重新執行會另建假資料並移入回收筒，不需為複審重複執行。
- `archive-native-compat-20260930.log`、`archive-native-results-20260930.json`：六案例結果。
- `archive-recycle-readback-20260930.json`：四個回收項目及可還原讀回。

## 3. 共享知識只留原實驗版

候選的 `src/claude-host.mjs`、`src/desktop-controller.mjs` 取自已保存的現用 R1，逐檔相同。`src/claude-controller.mjs` 也以該 R1 為底，只重新套用已審查的 B2「按對話 ID 讀投影」。

移出候選的檔案：`src/shared-knowledge.mjs`、`test/shared-knowledge.test.mjs`、`test/shared-knowledge-controller.test.mjs`。移出檔案走資源回收筒並核對可還原，未刪除實驗資料。不是只把功能設為 disabled：候選不再匯入該模組、不注入知識指令／背景、不自動擷取結論，也不會因 Jev 環境變數而啟用。

原試驗原始碼仍保留於 `D:\K-harness` 開發主目錄，並可由 `R2-candidate-20260929`／`R1-source-20260929` 的 Git 版本取得；**主目錄是實驗開發來源，不可直接整包部署**。供本次正式升級的來源是 `codex/r2-simplification` 的新版候選。

新增 `test/native-no-shared-knowledge.test.mjs` 的 Codex／Claude 兩個假 host 回合：確認送入原生核心的使用者文字不被加料、沒有共享知識指令、原生回覆不被共享知識解析器改寫、完成後沒有產生共享知識資料夾。沿用原生核心本來的記憶與權限，不阻止使用者依原生能力交代記錄。

對照現用 R1，候選頂層產品模組只有下列九個不同，全部是本批修正：
`browser-live-session.mjs`、`claude-controller.mjs`、`electron-isolated-launcher.mjs`、`isolated-launcher.mjs`、`luna-gateway.mjs`、`main-sessions.mjs`、`mcp-stdio.mjs`、`mcp.mjs`、`worker.mjs`。沒有新增共享知識模組。

## 4. 測試：通過與失敗均保留

以下紀錄都在上述 `.runtime/r2`：

1. `archive-regression-before-20260930.log`：新增三案例在修正前 **3/3 失敗**，其餘六個刪除測試通過。
2. `archive-regression-after-20260930.log`：修正後刪除＋metadata 定向 **17/17 通過**。
3. `archive-full-tests-20260930.log`：仍包含共享知識的中間版本完整 **645/647**。兩個失敗是 Claude 投影及訊息時間投影在固定 30／40ms 後尚未完成寫入；沒有算成通過。
4. 將該兩個正向測試改成等待實際檔案內容成立，原斷言保留，未新增產品重試。`no-knowledge-targeted-20260930.log` 為 **72/73**：訊息時間投影等待 5 秒仍未完成，目錄保留最後一份 `.tmp`。這次不能只用「等太短」解釋，也不能把後續通過當成 Windows 暫時鎖檔已解決；具體失敗代碼未被該測試記錄。
5. 最終候選完整 `no-knowledge-full-20260930.log`：**631/631 通過，47.9 秒，無跳過**。數量為原 644＋封存回歸 3－共享知識實驗測試 18＋排除實驗功能測試 2；不是為求通過刪掉其他失敗測試。

已知限制：偶發存檔未完成（含前次 Windows rename 失敗）仍待下一批查明；目前不加檔案重試、不大改共用寫入。不能再把它描述為「只在 C 槽有風險」：本輪 D 槽定向測試也出現保存未完成與 `.tmp` 殘留，但尚未確認是否同一根因。此次未取得正式環境同類故障，也未驗證整機試用、真模型回合。

Opus 對 A4 非 Error 物件字串化、NODE_OPTIONS 的小建議未併入；避免擴張本次必修與共享知識排除範圍。

## 5. 複審入口與正式界線

- 分支：`codex/r2-simplification`；新版標記：`R2-candidate-20260930`。舊版標記保持原樣。
- 查看本輪：`git -C D:\K-harness diff R2-candidate-20260929 R2-candidate-20260930 -- src test AGENTS.md docs`。
- checkout：`C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`；驗證副本：`D:\K-harness\.runtime\r2-validation-20260929`。
- 原始 [Opus 審查](opus-review-r2-batch1-20260929.md)保持內容不變。本文件是修正回覆，不冒稱 Opus 已複審通過。
- 複審重點：固定檔名與 R1 刪除相容、取消封存時不移動任何資料、正式候選沒有共享知識接線，以及上述未消除的存檔風險。
- **尚未正式套用。** 複審與使用者試用未完成前，不把來源複製進正式 runtime，不更換登入／對話資料，不順手啟用其他未驗功能。

收尾讀回：候選與實際跑測試的驗證副本共 170 個 `src`／`test` 檔案逐份比對（只正規化 CRLF）相同，移出的三個實驗檔兩邊皆不存在。正式 R1 與原備份重新核對：trusted-runtime 300 檔、launcher 1 檔、擴充 20 檔，321 檔全部相同；證據 `D:\K-harness\.runtime\r2-validation-20260929\.runtime\r2\formal-r1-readback-20260930.json`。本輪只將規則與交接文件同步至原工作目錄，產品變更留在 R2 分支。
