# 人用分支啟動逾時／側欄消失修正（2026-10-10）

## 現況與根因

使用者在正式 K 1b3749e 從 Pick Me Up 的結論按「分支交接」，畫面顯示 `K worker startup timed out; no turn started.`，切到其他聊天室後新分支從側欄消失。本輪不停止其他聊天室、不重建或重送小說工作。

- 原生分支 `01a125b1-b38d-7ea3-b90f-8936cc3cdc1a` 已建立；原生 rollout 檔與 K main-session 均存在，未封存。唯讀 metadata 為 notLoaded，最新複製回合 `01a12561-f57f-7741-b880-b16334a178df` completed，沒有新增接續回合。證據 `D:\K-harness\.runtime\manual-fork-fix-20261010\affected-native-readonly.json`。
- 舊人用路徑先對來源 host 執行缺少正常 K MCP 的 fork，再以同 host resume 補設定。已載入原生 fork 不會重啟新 MCP，K 等不到 k_gemini ready。先前 `docs/chat-ai-continuation-20261010.md` 已記錄此既有人用缺口；當時只修 AI 工具換房，沒有修人用分支，不能說前批「全部修好」。
- 舊 adapter 已存 parentThreadId，但只有 unified fork 全部成功後才寫 branchType=user。啟動失敗時跳過該步，`isVisibleMainSession` 隱藏有 parent 且非 user 的紀錄。分支不是被刪除。
- 複製的原房工人歷史不屬於新房；不能因父子 parent 不符把幾百個歷史項目重新算成新房待確認，更不能放寬 native-workers 的原生所有權檢查或停止外房工人。

## 最小候選修改

- `src/desktop-controller.mjs`：人用 fork 走正常 open 的完整配置後直接 native fork；不對已載入新房 resume。保存指定 completed 分支點、同模型／effort／worker policy／已選原生權限；不製造高權限確認。背景命令仍執行則拒絕，不終止命令。
- native fork 回傳後立即保存人用分支的 user 標記、標題、native ID 與 `forkThroughTurnId`，不等 MCP 就緒。readiness 失敗仍回報已知新房 ID；結果未知不編 ID、不重試。
- forkThroughTurnId 是已有 copied-history 邊界，不是新記憶系統。重開只從新房保存的原生 turns 判斷繼承項目，不依赖 forkedFromId 或額外讀長篇父歷史。歷史工具仍展示、自己後來派的工人正常查核；不移交 live worker／terminal ownership。
- `src/main-sessions.mjs`：讀寫並保留該單一邊界欄位。
- `src/unified-controller.mjs`：區分「已建房、接續尚未送出」與已送出但結果未確認。不自動送下一次。
- 不改 AI continuation 的既有側欄可見性。沒有新服務、依賴、retry/fallback、權限模式、模型路由或全域設定。
- `test/manual-fork.test.mjs` 新增 7 項；另兩個既有 fixture 修正為真原生語意：fork 返回時已 loaded；stored completed 分支點存在。既有 identity／權限 assertions 保留。

## 實際恢復失敗分支入口

已限定修改上方唯一真分支的本機 metadata：title、branchType；再依原生唯讀最新回合補 forkThroughTurnId。其他欄位保持不變，修改前 JSON 保留於 `affected-branch-metadata-before.json`／`affected-branch-boundary-before.json`。沒有 native resume/start/fork/interrupt，也沒有送任何接續指令。

`sidebar-recovery-readback.json` 已用正式 installed listMainSessions 與正式側欄規則讀回：同一 ID、未封存、user、可見，名稱 Pick Me Up · 分支。這是正式 metadata/規則讀回，不宣稱已目視使用者當前視窗刷新。正式舊程式若再保存該分支，尚不支援邊界欄位；本輪部署讀回需再次核對該精確紀錄。

## 驗證與失敗保留

證據根目錄 `D:\K-harness\.runtime\manual-fork-fix-20261010`。

- 第一輪真正 Codex 0.161.0、GPT-6.1 Sol medium、read-only、同 K 訂閱的新增假資料：從較早 completed 結論 fork 一次，k_gemini starting→ready，接續一次 completed，正確回覆 FORK_DONE_TEST_20261010；較晚父回合排除。父歷史／目標／假檔不变，原小說不操作。`result.json`。
- 最新候選再跑新增假資料並關閉後重開同新房：ready、原 native ID、原兩則假內容與接續正確保留；没有第二次 fork/接續。`native-final/result.json`。本測試沒有實際子代理；工人繼承／自己派工／重開由合成回歸覆蓋，不宣稱真書長負載已驗收。
- 首次默认併發全測保留 `full-test.log`：兩個 fixture 假資料不符新實際 fork 語意，另既有 native-wakeup 的固定 40ms 等待在高併發下未及完成。未修改 wakeup 測試；獨立相關 39/39 通過。修正 fixture 後，以測試檔併發 4 的最新全測 **1161/1161，零失敗**，`full-test-accepted.log`。
- 真正 Opus 5.5 第一輪（官方 Claude.ai Pro／firstParty，Claude Code 2.1.294，Read/Glob/Grep only）session 9c33d720-3e23-415d-872d-13e553397299，11 次讀取。指出 forkedFromId 證據／父歷史耦合、AI 可見性范围、父背景命令與錯誤文案；本輪逐項最小修正。第二輪官方真正 Opus 5.5 session `1d22c56b-3e5c-4fd5-9e93-8b28577b2a48`、15 次讀取，code 0/success，結論沒有阻擋問題；沒有重跑測試，主代理自行驗證。`opus-final/result.json`／`review.md`。

- 真失敗分支追加唯讀 `affected-branch-inheritance-readonly.json`：151 個 turns 均在已補的分支界線內，461 個繼承工人 ID、零本房派工；抽查工人原生 parent 為 Pick Me Up 原房。沒有 resume/start/fork/interrupt。這直接核對目前真書分支的繼承邊界，但不是實際接續小說。
- 第二輪非阻擋意見保留：目標／預算繼承與人用分支的額外檢查尚非本輪驗收；native 假資料 goal 為 null，未擴增目標語意。建房前錯誤／取消後需重開原房的狀態體驗、既有附件重開識別限制留待實際需要，未宣稱全部修好。

## 部署狀態與限制

**候選已實作並完成上述原生假資料／回歸驗證；第二輪真正 Opus 5.5 複查完成，沒有阻擋問題。正式程式仍為 1b3749e，未部署、停止或重啟現用 K。** 只有失敗分支 metadata 入口恢復已實際執行。

沒有恢復／重送原小說、push、更新東區、讀或搬其他專案／供應商憑證。部署仍須核對現用 K 工作結束與完全關閉，保留程式退版並做正式讀回。不能用這次短假資料宣稱上游串流、上百次壓縮或全部未知問題已修。
