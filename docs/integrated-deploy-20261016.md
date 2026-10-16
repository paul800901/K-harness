# 三聊天室成果整合與正式更新（2026-10-16）

## 範圍與授權

本人要求查明 Codex App 的 K 專案另兩個聊天室是否有未部署成果，一併部署，並表示 K 沒有工作、可關閉。這取代各批先前「停在部署之前」的限制；不授權租雲端 GPU、變更計費、複製憑證或重播原工作。

已讀回「這是怎麼回事的錯誤」、「部署並發布 K 驗收版本」最近完成回合，兩房均閒置；不是只依手機截圖推斷。這次由本聊天室單一執行部署，不叫其他聊天室再次部署。

## 已合併成果

| 成果 | 程式提交 | 既有驗收 |
| --- | --- | --- |
| 本機／雲端 Gemma 主代理 | `dbb4d69`、`f414de3` | 原生本機寫檔、讀檔、MCP、核准取消、重開；完整 1728、UI 48；三輪真正 Opus 5.5，最後無阻擋 |
| Gemini 正式試算表唯讀工具 | `e95b30a` | 完整 1713、原生權限 8；真正 Gemini 查詢與獨立計算相符；Opus 無必修 |
| Windows 檔案連結與原生右鍵 | `c3897d5` | 完整 1705、UI 48、隱藏 Electron 選單驗證；Opus 無必修 |
| 已驗收的非 Codex 整理前兩批 | `2941297`、`d20503f` | 工人狀態共用、移除重複工作區包裝、MCP HTTP 前門共用；各批完整測試與 Astra 等價檢查 |

四列都已在本機 main `1a5ea16`；不存在需要從另一房複製回來的未提交功能。沒有實作整理計畫中的後續 HTTP 拓樸／前端拆分，也沒有改 DSH、KAI 或其他專案。

詳情分別見 [Gemma](gemma-main-agents-20261016.md)、[試算表](gemini-sheets-read-20261016.md)、[檔案連結](native-file-actions-20261016.md)、[已驗收整理](k-noncodex-cleanup-20261016.md)。各文件原停止狀態是當時紀錄，本次部署狀態以本文為準。

## 更新器必要修正

準備部署時發現更新器仍永久刪除本輪 ZIP 與超過保留數量的舊程式退版，違反本人現行回收筒規則，因此先修兩個實際清理入口，不另造發布平台。

- `scripts/recycle-path.mjs`：兩處共用的 Windows 回收操作。核對完整路徑與父目錄範圍、拒絕 root／junction／symlink；呼叫 `Microsoft.VisualBasic.FileIO.FileSystem` 的 `SendToRecycleBin`，再確認原路徑消失及 Shell 回收筒出現同來源目錄與原名稱的新項目。沒有 Windows 永久刪除備援或自動重試。
- `scripts/manage-install.mjs`：只回收本輪 ZIP；回收失敗或讀回不明保留警告，不破壞已解壓的候選。
- `scripts/install-runtime.mjs`：保留最新三份程式退版，超出的走回收筒；單項及整體清理失敗均明示「保留或狀態待確認」，不把已套用成功的更新報成 activation 失敗。
- `test/install-runtime.test.mjs`：真實 Windows 目錄及 `.zip` fixture 回收／讀回，更新器 fixture 帶入 helper。9/9 通過；主代理另檢查 diff，補回整體 `readdir` 錯誤的非致命處理及誠實警告。

本次 Windows 正式更新不變動非 Windows 的既有清理行為。測試資料不含帳號／使用者資料；不宣稱回收是對話備份。

## 停止與整合驗證

- 22:22:40 在 K 設定頁正常停止後端；啟動器紀錄為 `isolated supervisor confirmed close`、exit 0。47831 不再監聽，原生模型程序已結束。
- 系統匣啟動器仍占用自己的待更新 EXE。本人後續明確要求「強制結束他」，因此只對讀回路徑完全吻合、沒有子程序的原啟動器 PID 62584 執行強制結束；沒有強制結束後端工作或其他程式。其後 PID 不存在、47831 未監聽、EXE 獨占開啟檢查成功。
- 本次整合 `npm run build:ui` 成功；`npm test` **1729/1729 通過，零失敗／取消／略過，76.0 秒**。沿正常預設並行，未改測試等待條件或略過失敗項。
- 前端自上一輪完整 48/48 介面驗收後未改動；本輪新增的是更新器修正，UI 48 的證據沿用同一整合來源，未冒稱再次跑過 UI。

## 複查、固定版本與部署讀回

- 真正 Claude Code Opus 5.5 複查：首輪 session `f7a59600-bc8a-4719-a625-9d814035b472`；收尾 `a28c5ffa-e320-4935-b87a-c33266bf2b43`。兩輪 init 與 assistant model 均 `claude-opus-5-5`、apiKeySource `none`、success，沒有寫檔或執行命令。確認兩批既有整理無整合退步，一次性更新器補丁方式無具體阻擋。
- 採納非互動 Windows session 可能不走回收筒的 P2：在任何刪除前檢查 `[Environment]::UserInteractive`，不符就停止該項清理。實際桌面 session 為 true；修正後真實目錄及 ZIP 回收測試重新 **9/9 通過**。
- 依實際 C／D volume GUID 唯讀檢查回收筒：`NukeOnDelete=0`；上限各 49,699／81,920 MiB，既有三份退版最大 639,709,600 bytes，遠低於單項上限。沒有修改登錄或回收筒設定。這是本機本次證據，不保證所有 Windows 設定；仍保留回收後讀回。
- 未採納將檔名比對放寬成忽略副檔名：本機 ZIP 真測已通過，放寬可能錯認其他同名項目；最終 Opus 同意，無 P1／P2 阻擋。
- 固定程式版本：`a58973cd7e1f31464883df5f58e4ddced6d1be77`。文件另筆提交，不用浮動 main 當部署目標。
- 正式 `Update-K.ps1` 會優先使用舊 installed updater，故本次需在 K 已停止後備存原兩個 updater 程式檔，再補入已驗收的三個 script；不動 home／憑證／對話。其後仍執行原 `Update-K.ps1`，不改入口或另建部署器。原版退版將包含這三個更新器補丁，版本標示仍代表原主程式，不能稱完全逐檔原樣快照。

### 首次正式更新：套用前停止

- 已備存原 `manage-install.mjs`、`install-runtime.mjs`，補入三個已驗收更新器 script，逐檔 SHA-256 與本機 main 相符；備存與讀回在 `updater-original/`、`updater-bootstrap.json`。只修改更新器程式，尚未宣稱正式主程式更新。
- 原 `Update-K.ps1 -Ref a58973cd7e1f31464883df5f58e4ddced6d1be77` 僅執行一次。候選建置成功，更新器完整測試 **1728/1729**，1 項失敗、0 取消／略過，75.2 秒，因此在 activation 之前停止。
- 原始失敗：`test/claude-controller.test.mjs:2803` 的 `Claude Gemini ready does not bypass clear`，在第 2838 行清除目標時收到 `請先停止目前工作，再設定或清除目標。`；更新器回 `cmd.exe 執行失敗 (1)；候選保留，未自動重試。`。原始完整紀錄為 `update.log`，沒有覆寫或刪除。
- 唯讀核對：該測試結果事件後只固定等待 40 ms，控制器此時會非同步讀回原生目標並等待存檔，`goalPending` 尚未解除時正確拒絕清除。這是目前找到的時序嫌疑；尚未以修正或重跑確認，不把推論當作排除產品問題。
- 失敗後正式 `.local/runtime.json` 仍為 `0d14cbd14c3f5c841dda32db254665685ac0d5e6`、previous 未變、47831 未監聽、正式試算表綁定仍不存在。候選 `prepare-1792161324050` 保留；沒有套用主程式、退版、重試、重開 K、重播工作或 push。
- 已向本人詢問是否修正確認後再執行一次部署。未取得新答覆前停止正式更新；雲端未租機。

### 本人授權接續：修正測試時序

- 本人明確回覆「繼續」，授權查明修正、完整驗證後再部署一次；不是在未獲同意時重跑原更新。
- 已用相同假資料重現：暫時把 fake native goal read 延遲 120 ms，原測試固定等待 40 ms 後讀回 `busy:false, goalPending:true, status:failed`，精確重現同一清除錯誤。改為等待 `goalPending` 結束後，相同 120 ms 延遲測試 **1/1 通過**，讀回 `goalPending:false`。診斷延遲與輸出均已移除，未進入正式測試或產品。
- 最小修改僅 `test/claude-controller.test.mjs`：結果事件後重用既有有期限的 `waitFor`，等待目標讀回與存檔完成。八個 action 的原斷言保留；不放寬產品保護、不加重試、沒有測試略過。原生 `goalCommand` 在事件同步階段就設 pending，存檔完成才清除，所以不是等待尚未出現的假訊號。
- 定向完整 Claude controller **132/132** 通過；正常預設並行 `npm test` 全套 **1729/1729** 通過、0 失敗／取消／略過，75.0 秒。產品與前端未再改動，沿用前一輪 UI 48/48 及建置證據。
- 真正 Opus 5.5 複查 session `dbbd5f0e-ff08-42fd-8549-d34d063a9e20`，init／assistant 都是 `claude-opus-5-5`、apiKeySource `none`、success。確認根因、等待條件會真正生效、八項斷言未削弱、沒有產品問題被隱藏，無阻擋；只讀未代跑測試。
- 新固定程式／測試版本 **`be7ffb321d61f2c8e2e4830c6a061dd65f948e84`**；正式更新結果待下節讀回。原失敗、延遲重現、修正後延遲驗證、完整回歸與 Opus 證據皆保留，沒有覆寫首次紀錄。

### 第二次正式更新：另一項前置測試失敗

- 在正式 K 仍停止、main 乾淨、三個 installed updater script 與 main 位元組相同的前提下，依新授權執行 `Update-K.ps1 -Ref be7ffb321d61f2c8e2e4830c6a061dd65f948e84` 一次。候選建置成功；完整測試 **1728/1729**、0 取消／略過，74.3 秒，仍在 activation 前停止。
- 前次 `does not bypass clear` 已通過；本次失敗是 `Claude completed Gemini ready preflight native-takeover preserves original results`，`test/claude-controller.test.mjs:2974` 等待接手回合完成後的原結果交付，15 秒內未觀察到預期呼叫。原錯誤為 `Expected asynchronous controller result was not observed.`，完整紀錄 `update-authorized-2.log`；不把兩次失敗混為同一問題。
- 唯讀追查：此測試在通知準備存檔期間插入原生接手；可能存在原生完成事件早於通知準備 finally 收尾，當時排程被 `notifying` 擋下而未再安排的競態。尚未確定性重現／修正，不宣稱只是測試時間不足，也不加長等待或跳過斷言。
- 22:51 讀回正式版本仍為 `0d14cbd14c3f5c841dda32db254665685ac0d5e6`、previous 未變、47831 無監聽。新候選 `prepare-1792162188836` 和原候選皆保留；未套用、退版、再重試、重開或 push。
- 已向本人詢問是否授權繼續逐項處理部署暴露的問題並完整驗證到部署完成；未以「測試偶發」為由跳過更新器檢查。

### 本人授權持續修復：通知收尾遺失喚醒

- 本人接著明確要求「繼續和 Opus 5.5 一起修到好，不要停」。因此在相同整合範圍內，後續查明問題、修正、完整測試與再次部署沿本次授權持續執行，不再每遇測試失敗就要求新確認；仍不跳過測試、不重播本人工作、不變更權限／計費或自動租機。這取代前述單次嘗試的停止限制。
- 已用雙重存檔閘門確定性重現：第一段暫停在 delivery-attempted，插入原生接手；第二段暫停在撤回未送出標記／還原結果佇列，於此時送入原生完成事件。修正前 15 秒內原結果仍無法交付，1/1 失敗（race-repro.log）；不是把偶發測試改成較寬等待。
- 真正 Opus 5.5 診斷 session `1a5e3a77-9d0d-4e47-a0e1-49b6a7aec2d7` 與主代理獨立追查一致：完成事件排程碰到 notifying=true 而退出，finally 清除該旗標後卻只處理已送完或不同交接收據，遺漏「同一未送出通知、原生工作已完成」的喚醒。
- 最小產品修正僅 `src/claude-controller.mjs`：finally 入口記住是否因原生工作仍忙而撤回未送出通知；保存原結果後，若同一 host／thread 已完成，沿既有排程補一次喚醒。沒有新增持久狀態、一般重試、計時器或原生結果計數器；不確定送出與準備失敗不進入此路徑。保留原有停止、本人新意圖、權限、額度與目標條件。
- `test/claude-controller.test.mjs` 新增五項可控時序回歸：原生接手、本人新訊息、停止、準備失敗、不確定送出。確認原結果只交付一次、本人新訊息後只送一般結果通知、停止不被喚醒、準備失敗與不確定送出不自動重試；後者 delivery-attempted 標記仍保存。測試閘門使用既有有期限的 waitFor。初次新增測試收尾忘記還原失敗的 bridge.list fixture，造成 close 測試失敗；只還原測試替身後，Claude 全檔 **137/137 通過**，原失敗紀錄保留。
- 預設並行完整回歸 **1734/1734 通過**、0 失敗／取消／略過，75.0 秒。
- 真正 Opus 5.5 最終複查 session `019daeea-4b94-4f34-967b-02542d0d9713`，init／assistant 均 `claude-opus-5-5`、apiKeySource `none`、success。確認局部 busy 快照比一般 pending-wake 或計數器更小，足以處理已重現問題，無 P1／P2 阻擋。主代理另獨立確認 catch 先清 busy、不確定送出有 sendAttempted、停止清佇列與同 host／thread 條件。
- 採納唯一測試補強意見：先等通知本身完成收尾，再送第二個原生完成事件，讓非同步排程走完後確認沒有重送；不在事件同步當下就斷言次數。Opus 提及的既有失敗結果提示延後、非 busy 原因的其他解除事件及準備失敗時既有狀態處理不擴張到本輪，未當作本輪已修復項目。正式部署仍待最終回歸與讀回，不把測試成功當成部署成功。
- 採納後最終 Claude **137/137**、完整 **1734/1734** 再次通過、0 失敗／取消／略過，完整 75.0 秒；格式檢查與 diff 檢查通過。固定程式版本 **`46ec46040d3ee0df1a4fc82cfd5f21a6591800a3`**，文件另筆提交；接續由原 Update-K 進行候選建置、全套測試與正式套用，不跳過任何階段。

### 第三次正式更新：已套用與 live 讀回

- 23:09 在 main 乾淨、完整目標 SHA 已合入、47831 無監聽及正式程序已結束的前提下，執行原 `Update-K.ps1 -Ref 46ec46040d3ee0df1a4fc82cfd5f21a6591800a3`。原候選建置、介面／擴充／啟動器建置及更新器完整 **1734/1734** 測試通過、0 失敗／取消／略過，75.0 秒，隨後正常 activation，exit 0；紀錄 `update-continued-3.log`。沒有略過全套檢查或重播使用者工作。
- 正式 `.local/runtime.json` 已讀回上述程式版本；previous 為 `releases/before-1792163481463`，最新三份程式退版保留。既有帳號、對話／profile、工作區、瀏覽器輸出目錄仍在原位置；Node／語音 Python／模型路徑未更換。兩次失敗候選及原錯誤都保留，未作無關清理。
- 正式 792 個 Git 來源檔已核對：791 檔與該 commit 經 Git checkout filter 的位元組完全相符；建置重產的 `browser-extension/extension-protocol.cjs` 與原始 Git blob 完全相符。第一版讀回腳本忽略本機 core.autocrlf=true，誤將 CRLF 差異報成失敗；改按實際 Git filter 核對後只剩該建置檔的 LF，另對原始 blob 精確比對通過。沒有改寫正式檔案來迎合讀回，也沒有忽略未知差異。最終 `activation-readback-final.json`：792 檔、0 未解差異。
- 原已核准的 Google Sheets 唯讀綁定已一次建立於正式私有設定（原檔不存在、使用排他新增），讀回內容相符；只有指定工作區可用，其他工作區仍無綁定。由正式接頭列出兩個唯讀工具，實際 metadata 查詢成功，讀回 10 個分頁；沒有讀資料列、重播收入查詢、改表或複製 OAuth。
- 直接載入正式 Gemma 接頭讀回兩個主模型：本機 Gemma available=true；雲端高精度 Gemma available=false，明示須先啟動租用機器與 SSH 轉送。此步是正式接線／模型目錄讀回，不冒充新做一次推論；本機原生基本流程證據沿用本批先前實測，雲端仍未租用／未實機驗證。
- 正常啟動 K 一次。外層觀察腳本首次誤用 Start-Process 後未設定的 LASTEXITCODE，沒有據此重新啟動；改做唯讀檢查，23:14:57 正式 `/health` **HTTP 200、deployment=native**，版本仍吻合。證據 `startup-health.json`；正式 K 已運行。
- 公開來源檢查涵蓋原遠端至本批的全部 16 個提交、43 個路徑與 1,996 行新增內容，沒有實際 Key／Token／私有表 ID 或私有資料路徑進入提交。23:15 首次 push 成功，遠端 main 與本機均為 **`1545edcb3a39725ff0249e0b9704a0c73f1f2831`**（含程式與部署前紀錄）；後續本節及各功能文件僅補部署結果，再提交發布，不重啟 K。

本機證據：本任務工作樹 `.runtime/archive/integrated-deploy-20261016/`，包含整合測試、真正 Opus 的 packet／identity／events／result、更新與讀回紀錄，不提交公開 Git。

## 保留的驗證邊界

- 雲端 Gemma 尚未租機或實機推論；選單及接線完成不等於雲端上線。原生進階代理能力未測項沿 Gemma 文件，不重新宣稱全部認證。
- Windows「開啟方式」真實 OS modal 的人類互動尚未驗收，保留既有 Electron callback 與 Win32 fixture 證據。
- 試算表只套用原已核准工作區／試算表的唯讀綁定；正式接線讀回不重播收入查詢、不改表、不讀或複製 OAuth。
- 只更新南區；東區需本人到當地再更新與讀回。
