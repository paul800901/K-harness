# K HARNESS：R3 集中複查（2026-10-01）

## 結論與範圍

本輪由 Astra 接替原定 Claude 事後複查。**原生審查真正完成，找到一項新安裝缺陷；已獨立重現、完成一行補修，完整測試 509/509 通過。** 正式套用狀態見文末，不把測試通過等同部署。

- 起點：R3-1 前的 R2＋Sol 6.1，`f8fbb7917022800e01bf7d32c2ca3e66d33de8cc`。
- 終點：`k-r3-git-20261001`，`60672fc85f85c4b434c7298a897d7cec1c2f10e0`。
- 精確差異：225 檔，其中刪除 96 檔、新增／保留修改 129 檔。包含 R3-1 通知、取消／重連、官方目錄與退出；R3-2 舊架構移除；語音、右鍵、子代理自動選擇與精簡；Git 安裝／更新／退版。
- 維護樹：`C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`。當時 HEAD `0778c7e` 比終點僅多兩份文件更新；審查以兩個明確 commit 為準。既有 `browser-extension/extension-protocol.cjs` 換行狀態保留，未納入補修。
- `D:\K-harness` 根目錄的舊實驗程式未整批覆寫或合併；共享知識仍只留實驗。
- Luna/high 僅分擔明確唯讀的前端／留存後端／刪除引用與基準測試；Astra 自行回查相關 diff、重現缺陷、修改、重跑測試與驗收。原生 reviewer 不是這些子代理的替代稱呼。

## 第一次真實 Codex 原生審查

不是假 host 測試，也不是一般聊天冒充 `/review`。沿用正式 K 的 `openCodexHost`、K 專用 `trusted-providers/codex/codex.exe` 與原有 `CODEX_HOME`，實際呼叫 app-server `review/start`。帳號原生讀回為 `chatgpt`；未搬登入、未使用 API key、未改計費或既有模型設定。

| 項目 | 實際結果 |
|---|---|
| 時間 | 臺灣時間 10:20:21–10:23:06，約 165 秒 |
| thread | `01a0f543-40e9-7433-948e-c7708bee3f32` |
| turn | `01a0f543-43a0-7eb1-a8fa-b580c88edc2b` |
| 模型／推理 | 沒有指定或改寫；原生回傳 `gpt-6.1-sol`，reasoningEffort 為 null，不自行推定程度 |
| 權限 | 新的獨立唯讀審查 thread；on-request 原生核准保留，未啟用工人或瀏覽器 |
| 請求 | `target.type=custom`，指明兩個精確 commit；`delivery=inline` |
| 完成證據 | `enteredReviewMode` 1 次、`exitedReviewMode` 1 次、最終 `agentMessage`；`turn/completed` 為 completed，程序退出碼 0 |
| 實際活動 | 16 個命令項目，退出碼皆 0；使用 Git diff/show 與來源查讀；沒有核准請求 |
| 發現 | 1 項 P1：未設定瀏覽器助手的新安裝無法開普通文字對話 |

官方協定參照：[Codex App Server — Review](https://learn.chatgpt.com/docs/app-server#review)。協定文件說明 custom／commit／baseBranch／uncommittedChanges 與 inline／detached；本輪只實測上述 custom＋inline，不把文件能力全部列為已驗。

### 原生實際輸出（原文，不改寫）

```text
The reviewed end version breaks default conversation creation on fresh installations without browser configuration. This is a statically identifiable execution-path defect, not an unverified hardware or live-provider behavior.

Review comment:

- [P1] Allow conversations to open without a configured browser gateway — C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness\src\owner-browser-registry.mjs:8-8
  On a fresh Git installation before `Setup-K-Browser.ps1` runs, `loadKBrowserAssistant()` returns `undefined`, which is passed through `createElectronWorkbench()` into this registry. Removing the default gateway leaves `session().config()` calling an undefined `gatewayFactory` at line 33 for the default Codex `workspace-write` and Claude `claude-manual` modes. Consequently, ordinary text conversations fail to open with `gatewayFactory is not a function`, although browser setup is documented as a separate installation step. Return a disabled browser configuration when no gateway is supplied, without restoring the removed legacy browser fallback or changing provider permissions.
```

原始協定事件及請求／回應：`D:\K-harness\.runtime\concentrated-review-20261001\native-review.jsonl`。原文另存同目錄 `native-review-output.txt`，一次性執行腳本為 `native-review.mjs`。

### 它能做什麼，以及沒有做什麼

1. **已證明**會真的開模型審查回合、使用本機命令查閱精確 Git 版本，並提供優先級、檔案位置及具體觸發路徑；本次發現後經獨立測試證實，不只給泛泛建議。
2. **不是自動驗收**：本次沒有跑完整 npm test、沒有驗麥克風或 Windows 10、新機登入，也未修改／部署產品。原生回合會保留自己的原生歷史並使用訂閱額度，不能說零模型用量。
3. **不是逐行覆蓋證明**：完成事件與一項 finding 不保證所有行都看過，也不能把沒報的項目當成全功能無缺陷。Astra／Luna 的聚焦查讀、引用掃描與測試另行完成。
4. K 既有 `/api/native/review` 仍固定「未提交改動＋inline」。本輪為審查歷史版本範圍，使用原生 app-server custom 入口；**沒有新增按鈕／設定，也沒有驗證 K 前端原生審查按鈕的完整操作**。沒有審錯根目錄的舊實驗工作樹。
5. 首次證據腳本 import 少算一層 `.runtime`，在 Node 載入階段即失敗；修正腳本路徑後才建立 host。當時尚未送 `review/start`；本輪實際審查只送一次，沒有重送審查或其他工作。

## 發現與處理

| 項目 | 判定／處理 | 未處理原因或界線 |
|---|---|---|
| P1：未設定助手的新安裝文字聊天室失敗 | 根因是移除舊預設 browser gateway 後，optional factory 為 undefined，卻仍被呼叫。未修版測試 0/1，重現同一 TypeError；`src/owner-browser-registry.mjs:27` 在無 factory 時回傳 null，只有一行產品修改 | 已修；不恢復舊內嵌瀏覽器或假備援，已設定助手的既有路徑不改 |
| 已刪架構的引用／入口 | 逐一對 96 個刪除檔名掃描 end commit 保留程式、scripts、test、套件宣告，核對同名誤命中；未發現入口指向已刪檔。DeepSeek／Pi／Sandboxie 不在套件宣告 | 歷史 docs、來源註記、剔除 API key 的防護，以及既有 `sandboxie-candidate` 資料位置名稱保留；不視為執行分支 |
| 通知與模型清單 | 原生額度訊息去重／中文化只在呈現層；工程提示過濾不刪原始事件。保留官方 hidden 過濾與既有對話綁定，未找到第二個確定缺陷 | 未刻意耗盡兩家額度；未知原生英文格式仍保留原文，不造恢復時間 |
| 語音及右鍵 | 回查 renderer／preload／main 的 onWindowHidden 與 onPageChanged；右鍵依原生 editFlags、原 webContents 編輯方法，未新增 IPC 或剪貼簿權限。未找到可重現的新缺陷 | 本輪不重新錄真麥克風，也不為複查搶前景／操作真剪貼簿；前批假音訊／原生 Menu 證據是歷史證據，不冒充本輪硬體驗收 |
| 子代理 auto／手動及精簡 | 回查 worker-policy、Claude lazyBridge、gateway、Codex agents 設定與測試。auto 必須由主代理具體選 model＋effort；既有手動偏好讀回，不傳假的 auto 給供應商 | 沒有為本次重跑所有模型組合派工；本輪原生 reviewer 禁止再委派。未增加失敗換模／重送 |
| Git 安裝／更新／退版 | 逐行回查 Setup／Update、manage-install、install-runtime、瀏覽器設定入口、launcher 根目錄與 Node／Whisper 路徑。配對舊 launcher／入口、停止前置檢查、失敗回復及個人資料不交換均保留 | 不重新下載／安裝套件、不更新 CLI、不寫 Chrome 註冊；中文新路徑與首次安裝歷史證據仍以原紀錄為準 |
| 過度防禦／精簡 | 回查共用 atomicWrite、初始化取消、原生模型／effort、requestId 綁定與背景程序清理；本批已合併的重複政策驗證與假 Luna/high 備援不恢復。沒有再找到具實證、值得刪掉的額外防護 | 不為行數硬刪 G 級邊界、原生核准、關閉未確認狀態、只重試同一 rename 的 Windows 存檔防護；本次 factory 缺省是合法情況，不是想像風險 |

### 未處理的測試探測器限制

- `test/fixtures/context-menu-app.cjs` 是人工互動 probe：會顯示／聚焦測試視窗，讀取及覆寫系統剪貼簿後嘗試還原；不在 `npm test` 內。本輪沒有執行，不把它當背景安全的自動測試。
- `test/fixtures/launcher-force-probe.cs` 的 `before` 分支刻意保留拒絕關閉的程序樹，不能當自動清理的測試；本輪未執行。
- `test/voice-composer-ui-probe.mjs` 沒有固定候選根目錄與 Whisper 路徑，依賴呼叫者環境；不能單靠它證明某一版的語音接線。未改這些一次性 probe，以免擴張本次產品補修；硬體與人工互動仍列未驗，不新增檢查架構。

逐行查讀範圍包含上列留存 src／frontend／shared／launcher／scripts 的新增與保留改動，以及新增與保留的測試改動；已刪程式只查接線／回歸，不逐行審刪除內容。Astra 自行回查子代理所報的核心 diff，不把子代理報告直接當成正式完成。

## 測試與實際行為

| 驗證 | 結果 |
|---|---|
| 修改前完整基準 | **508/508，0 fail**；共享維護樹的一次執行，日誌完成時間早於本輪兩項修改；不宣稱獨立凍結 tag 安裝 |
| 原生 P1 重現 | **0/1，1 fail**，`TypeError: gatewayFactory is not a function`，原失敗日誌保留 |
| 補修後相關回歸 | **99/99**：registry、browser MCP、Codex desktop、Claude controller；已設定助手、租約互斥、唯讀關閉與失敗關閉仍通過 |
| 補修後完整維護樹 | **509/509，0 fail／0 skip**，32.95 秒；新增一個無 browser setup 回歸，測兩家預設權限及不建立 profile／輸出子目錄 |
| 套用前候選完整測試 | **509/509，0 fail／0 skip**，34.81 秒；直接在將套用的 runtime 副本執行，沿用既有相依與介面產物 |
| 正式檔案回歸 | **8/8** registry 測試；含無助手設定及原有租約／取消／關閉路徑 |
| 真正原生雙核心開啟 | 全新假工作區沒有助手設定；正式 K 專用 Codex／Claude CLI 各成功開至 ready，browserEnabled=false、訊息為空，關閉完成。**2/2**；沿用原生預設模型，沒有送模型工作回合，沒有改既有對話設定 |

本輪證據目錄：`D:\K-harness\.runtime\concentrated-review-20261001`。日誌包含 `baseline-tests.log`、`no-browser-before.log`、`no-browser-after.log`、`final-tests.log`；真核心開啟證據為 `no-browser-native-open.json`／`.log`，一次性腳本為 `no-browser-native-open.mjs`。只用新建假資料，不讀其他專案的真錄音或憑證。

## 正式套用與還原

- 補修程式來源已本機提交：`c043911`，產品只改 registry 一行；另加一個回歸測試。未 push，也未移動遠端 `k-r3-git-20261001` 標記。
- 使用者於本輪回覆「已離開並停止 K」；再次查核 47831 無 listener，沒有正式 K 自有 Electron／supervisor／provider 程序。不以不可靠的背景畫面讀回代替此證據。
- 背景視窗工具曾只讀取得空的 K accessibility，接著回傳非 K 前景畫面；立即停止該讀回路徑，未切前景、未點按其他軟體，不把該畫面當成 K 驗收。
- **正式套用及讀回完成**：臺灣時間 10:44:30，既有 `activateRuntime` 交易由 `60672fc85f85c4b434c7298a897d7cec1c2f10e0` 更新至 `c0439113e31cd83c58e03d568a8ce3f61418b1c6`；10:45:36 最終讀回成功。交易只交換程式 runtime，不交換 vault、原生登入 home、對話及瀏覽器資料位置。
- 完整上一版（包括舊測試暫存）保留於 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1790822670562`。舊 registry 與 launcher 雜湊讀回一致，settings／launcher／入口快照在同處；可依既有 `Update-K.ps1 -Rollback` 流程退版，須先停止 K。本輪沒有為驗證而真的退版。
- 候選複製第一次因 `.runtime` 舊測試的失效連結回傳 robocopy 9；診斷再拷回傳 8，獨立讀檔驗證重現 ENOENT，因此兩個結果都沒有用於部署。另建乾淨候選，**只排除內層 `.runtime` 測試暫存**，robocopy 1（成功），14,886 檔、0 failed；舊原始目錄完整保留。沒有刪除、套件安裝或改權限。
- 候選完整測試會改寫其 `scripts/k-browser-native-host.diagnostic.json`；套用前從原正式版還原這個診斷檔，不帶測試內容上線。之後逐檔比對 **14,883 個未修改檔案內容完全一致**，另外三個既有檔的差異是產品修正、回歸測試與 development-log，新加入本複查文件；四個補修／文件檔均與維護來源一致。
- 正式 registry SHA-256 `28c7a91bc73f2cb2f73cfbb92a56cc70f5db47d0ed3583ed54a66650c3894da1`；回歸測試 `e0346e55148b4a54d0ec699f054565f052a55b7a7a2927d912be86c8ffe351df`，均與來源一致。launcher／Start 入口／UI index 未變；Node 與既有 Whisper 路徑未變。沒有前端改動，沿用既有 build，沒有額外 build 或下載。
- 用原 `Start-K-Desktop.ps1` 重開；正式 Electron PID 41344 的視窗標題為「K 執行中樞」，只在 127.0.0.1:47831 監聽。`/health` 回傳 deployment=native、workspace 為既有 vault/private-state。3 個 HTTP UI 資產皆 200，內容雜湊與磁碟一致；未帶 session 的 `/` 與 `/api/state` 仍 403，沒有繞過原生／桌面核准。
- 正式讀回不是畫面逐項操作驗收：本輪未重新操作實體麥克風、真剪貼簿、全新電腦或 Windows 10；原生 review 的前端按鈕未端到端驗證。這些限制保留，不以 health 宣稱全部人工互動通過。
- 部署及讀回證據在 `deployment.json`、`deployment-command.log`、`before-deploy-processes.json`、`formal-processes.json`、`formal-health.json`、`formal-readback.json`、`prepared-tests.log`、`formal-registry-tests.log`；一次性 `deploy-review.mjs` 與 `readback-review.mjs` 保留。不新增永久驗證／部署機制。
- 本輪沒有大改動或需使用者另行裁決的架構取捨；不因此推進其他 R3 未完成項。

## 後續 Git 發布（同日 10:53）

前文「未 push」為集中複查完成當時的狀態。使用者後續明確授權發布：已將 c043911 與複查文件推到既有 GitHub，新增 `k-r3-git-20261001b`（commit `bb06b937e36350d425e05e0bd388688786db63c2`），保留舊 tag。再次完整 **509/509**、遠端與乾淨 clone 讀回完成；本輪未重啟或改動正式程式。東區新機安裝請用新標記，硬體與該台登入仍待實測。見 [發布紀錄](r3-git-release-b-20261001.md)。
