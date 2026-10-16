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

本機證據：本任務工作樹 `.runtime/archive/integrated-deploy-20261016/`，包含整合測試、真正 Opus 的 packet／identity／events／result、更新與讀回紀錄，不提交公開 Git。

## 保留的驗證邊界

- 雲端 Gemma 尚未租機或實機推論；選單及接線完成不等於雲端上線。原生進階代理能力未測項沿 Gemma 文件，不重新宣稱全部認證。
- Windows「開啟方式」真實 OS modal 的人類互動尚未驗收，保留既有 Electron callback 與 Win32 fixture 證據。
- 試算表只套用原已核准工作區／試算表的唯讀綁定；正式接線讀回不重播收入查詢、不改表、不讀或複製 OAuth。
- 只更新南區；東區需本人到當地再更新與讀回。
