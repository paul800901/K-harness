# Codex 手動分支後原聊天室無法接回（2026-10-30）

## 問題與根因

本人從 GPT-6.1 Terra 房的已完成回覆建立 Astra 分支，接著切回原房時遇到 `Codex request thread/resume failed (code -32600).`。原房保存的最後一則回覆及 `task_complete` 都存在，歷史 JSONL 無壞行；分支亦建立並開始工作。未重送正式工作、未操作原房或刪改其紀錄。

K 的手動分支會沿用 `desktop-controller` 及同一個 app-server 執行 `thread/fork`，把控制器目前身分改成子房。`conversation-controller.reindex` 隨後移除原房的控制器索引；但同一原生 app-server 還持有原房的 writer lock。切回原房時，聊天室總管建立另一個控制器及 app-server 去 `thread/resume`，與原 writer 衝突。

以本機 Codex **0.165.0**、隔離測試 home、合成歷史實測，不讀取或複製登入、不呼叫模型推論：同一 host 建原房及分支，另一 host 接回原房時原生精確回覆 `thread <id> already has an active writer`、代碼 `-32600`。關閉原 holder 後，原房與分支都能分別由獨立 host 接回。原事件的 protocolMessage 未保存，故不冒稱取得當時完整錯誤；本次已重現同一路徑與同一代碼的具體故障機制。

## 修正

- `src/desktop-controller.mjs`：手動分支確認來源工作已結束後，在建立分支前釋放來源 app-server，再於新的 app-server 呼叫原生 `thread/fork`。保留原生歷史、分支點、附件、模型及權限設定；不把分支重新 resume 或重送。
- 釋放前檢查來源原生目標及背景命令；目標更新中、active 目標或仍有命令（含已完成原生工人的背景命令）時拒絕分支，不替本人暫停、終止或重播。
- 不新增共享連線池、writer lock 管理器、輪詢、重試或人用設定。已有多房控制器仍各管一個房間；原房下次開啟照原路徑接回。
- `test/conversation-native-regression.test.mjs`：假原生 host 實際追蹤 writer 歸屬，驗證 Terra → Astra 分支工作中切回原房、兩房各自送出、停止分支不影響原房及不重送。
- `test/manual-fork.test.mjs`：active 目標與已完成工人背景命令的拒絕保護；既有建立結果未知、MCP readiness 失敗保留子房、權限及繼承工人測試持續適用。
- `test/desktop.test.mjs`、`test/fork-attachments.test.mjs`、`test/codex-empty-room.test.mjs`、`test/desktop-permission-modes.test.mjs`：對齊來源 host 已釋放及原生載入清單的測試模型。

## 驗證與收據

收據集中保存於主工作樹 `.runtime/archive/codex-manual-fork-owner-20261030/`；開發工作樹同名位置保留原始執行紀錄。

- `native-probe.mjs`、`native-probe-result.json`：真正原生核心重現 active writer 拒絕；釋放後原房與子房獨立接回。另實測修正版的精確順序：來源 host 已關閉，新 host 從保存歷史 fork 子房，子房仍載入時第三個 host 接回原房成功。0 次模型推論；測試資料經 `test/scratch.mjs` 建立與清除。
- `mutation.log`：用未修改的原程式跑新增整合測試，切回原房時重現 `thread/resume failed (code -32600)`；隨後恢復修正版。
- 第一輪針對測試唯一失敗是新工作樹尚無 `dist-ui/index.html`，HTTP 測試讀不到頁面；已補 `npm run build:ui`，未修改產品來繞過測試。
- 介面建置成功；只有既有 bundle 大小警告。
- 第一輪完整 `npm test`：2,036/2,038，兩個舊測試未提供 `thread/loaded/list`；只補假 host 的原生清單回覆。
- 複查前完整 `npm test`：**2,038/2,038**（85.1 秒），0 fail、0 cancelled、0 skipped；採納下述目標更新保護後另跑完整驗證。
- 第一輪 UI probe 因新工作樹未連到既有 Playwright 瀏覽器而無法啟動；已連到專案既有 `.runtime/playwright-browsers`，未安裝或升級套件，重新跑整套。
- 採納 `goalPending` 後完整測試第一輪 2,038/2,039：既有 `browser-live-session` 下載測試在檔案已出現、Windows `Zone.Identifier` 尚未寫完時先讀，得到 ENOENT。相關產品與測試均未修改；單獨重驗 6/6 通過。等待 UI 結束後再驗完整測試，避免並行負載；不隱去這次失敗。
- 最終驗收：`full-tests-acceptance.log` **2,039/2,039**（85.6 秒），0 fail、0 cancelled、0 skipped；`ui-tests-final.log` **55/55**，含正常執行 125 秒等待情境的語音切房測試。未縮短或跳過測試。

## 複查及更新狀態

- 主代理：程式流程、writer 歸屬、失敗與權限保護已查；完整測試通過。
- 真正 Opus 5.5（high）唯讀複查，工單 `codex-manual-fork-owner-review-20261030-01` 已完成：**無必修，可合併**。確認最小修法、未知結果不重送、原權限檢查及背景工作保護；另自行跑 91 項相關測試全過，並獨立驗證新 host fork 不持有來源 writer、另一 host 可接回來源，而子房由分支 host 持有。
- 複查兩項非必修建議均採納：更新文件與原生順序實測收據（主代理已同步完成）；`fork()` 入口加 `state.goalPending`，目標更新中連原生查詢也不送，新增對應測試。後者為審核者明確建議的一行保護，主代理核對修改及重跑完整測試。
- 程式版本 **`0d157293cb23b49ce69b095413288dff445e2542`**。驗收通過，以合回 main、寫 `.local/update-ready.json` 交付，由本人按「更新」。本房不停止或部署正在執行的 K；正式版本仍為 `2b97b135b0ee7bd31171aa187262032413cd19db`。依既有發布順序，部署與正式讀回後再收尾 push；本批未 push。
- 既有出錯房的活連線不在開發過程中強制修復。按鈕更新正常關閉並重開 K 後會釋放舊程序鎖；正式更新後兩房的實際重開由本人確認。
- 東區未更新。
