# 受阻目標恢復、Codex 原生加速與子代理展開清單

## 使用者要求與邊界

- 既有 Codex 目標被標成 `blocked` 後，使用者已明確說繼續，AI／本人應可恢復同一目標。純編輯文字不代表恢復；保留原目標識別、預算與用量，不重建、不重播。
- 只有 GPT／Codex 模型顯示原生加速功能，依原生模型目錄支援，不寫死速度倍數。放在既有推理程度選單內，先開選單再明確切換；預設標準，每個聊天室各自保存，推理程度不變。
- 頂端子代理計數可展開看逐筆狀態，參考 DSH 的可發現性與展開方式。K 只呈現現有原生／gateway 證據，不移植 DSH 核心、不猜測工作是否卡死，不因此停止、重送或切換真實工作。
- 本批工程驗證只操作新建假資料。正式翻譯目標、工單、帳號、登入、權限與計費均不操作。正式套用仍以完整測試、真正 Opus 複查、K 已停止／閒置及可退版為前提。

## 根因與原生證據

### 目標

`goal_edit` 已能成功修改目標文字；原始失敗在 `goal_resume` 僅接受 `paused`，拒絕 `blocked`。前端也在主回合忙碌時鎖住受阻目標的繼續按鈕。修正為暫停／受阻皆可 status-only 恢復；active 僅讀回，complete、usageLimited、budgetLimited 與未知仍拒絕此恢復入口。

### 加速

K 專用 Codex 0.160.0 的 `model/list` 已提供 `serviceTiers`，其中 Fast 原生 ID 為 `priority`。`default` 明確表示標準，不能以 null 假定停用（null 可繼承設定）。不是提高／降低推理程度，也不改走 API 計費。

真實協定探針發現：

1. 新空對話尚未建立 rollout，直接 `thread/resume` 會回 `no rollout found`。
2. 已載入的既有對話再呼叫 `thread/resume` 指定 priority，原生仍讀回 default；不能拿它冒充即時切換成功。

因此不為切速發假訊息、重啟主代理或中斷工作。選單保存「下次送出」選擇，回合以原生持續性的 `turn/start.serviceTier` 套用；新開／重新載入對話則由 thread/start 或 thread/resume 設定。另保留目前核心實際 tier，待套用時清楚標示，忙碌顯示實際值；回合送出逾時而未確認時顯示核心速度待確認。已執行工作的自動目標續行不因尚未送出的選擇而假稱已切速。

### 子代理

頂端原有計數是所有仍持有控制器的聊天室，舊工作面板明細卻只對應選取中的聊天室。新入口以相同全域來源呈現逐工單狀態，仍把已確認與待確認分開，不把缺少活動時間當成無工作。

DSH 只讀參考：本機 `DSH架構/DeepSeekHarness-0.2.1-alpha.1-local` 的 session hierarchy。K 不新增 DSH 式子代理原生歷史切換／派工控制，僅補使用者實際需要的查看入口。

## 驗證與複查

- 真 Codex 受阻目標：新建假工作區，明確恢復後自動續行至 complete；同一目標、預算與用量保留，僅一個外部 turn/start，第二回合由原生目標續行。未操作正式目標。
- 原生 tier 探針：上述兩項限制皆實際重現，沒有因失敗自動重送工作。
- 真 Codex Fast：新建假工作區、Luna low／read-only，選 priority 後只送一個短回合；同 host 原生讀回 priority。改選 Standard 後保留目前 effective priority，關閉測試控制器並重新開啟同一測試對話，原生讀回 default；effort 維持 low。這驗證接線，不代表實測效能倍數。
- 前端假資料：加速選單與容量接手各 3 種視窗／縮放／主題通過；涵蓋開選單不啟用、明確開關、推理草稿不變、忙碌時實際 tier、重新載入保留、Claude／Gemini 隱藏、忙碌中恢復 blocked。首次探針的 selector／非同步 checkbox 判斷失敗已調整，並非正式操作失敗。
- 子代理清單：4 種視窗含 390px 通過，來源聊天室分組、已結束摺疊、未知原因、Escape／外點關閉與不溢位；清單操作不呼叫真實工作 API。主代理已檢視桌面／窄視窗截圖。
- 最終完整 `npm test`：853/853 通過；`npm run build:ui` 通過（保留既有大型 bundle 警告）。首次全測發現新清單關閉按鈕未用共用字級，已改用共用 scale 後重跑通過。
- 真正 Opus 5.5：官方 Claude Code 2.1.289／Claude.ai 訂閱兩輪只讀複查，回傳模型皆 `claude-opus-5-5`。首輪兩個 P2 已修，補查無 P1／P2，可接受。複查未操作正式資料或冒稱執行本輪測試。

### Opus 意見、取捨與主代理驗收

1. `turn/started` 可能是原生目標搶先續行，不能因 K 正在送出請求就將 tier 標成生效。移除該推斷，只有成功 `turn/start` ACK 才套用；明確拒絕保留原值、傳輸失敗改為 unknown。兩條競態／逾時回歸已補，真實 Fast 短回合亦再次通過。主代理另讀 `src/codex-host.mjs` 確認 protocol rejection 才帶 `protocolMessage`；timeout／關閉錯誤均不帶，符合複查提出的核對點。
2. 前端 SSE 斷線時，未結束的清單列同步變成「狀態待確認」；細節保留「上次原生狀態」，已結束結果不變。UI 探針已驗證。
3. 實際重現再次點擊推理選單按鈕會重新打開，改用原生 `popoverTarget`；再次點擊、Escape、外點關閉均通過。切換工作區清除舊 tier；unknown 不冒充已確認的待套用差異。
4. 手動換不同模型時回到 Standard，避免把高用量默默帶給另一個模型；同模型偏好保留。已授權的容量接手仍在目標模型支援時沿用 Fast。starting／pending 不算「執行中」沿用原語意；沒有增加新的狀態輪詢、重送或額度自動化。
5. 限制：未把 Fast 當效能倍數驗收；未在正式小說、真實帳號交接上操作。原生 fork tier 依現有協定傳 Standard，這次未另做真實 fork 回合。子代理清單僅呈現仍持有的控制器既有資料，不新增歷史查詢或 DSH 原生子對話開啟能力。

證據保留在工程工作樹 `.runtime/goal-fast-20261006/`：`native-blocked-resume-validation.json`、`native-fast-validation-first.json`、`native-fast-validation.json`、`native-existing-tier-set-probe.json`、`full-tests-final.txt`、`ui/result.json`、`opus-review/`、`opus-review-followup/`。容量呈現與子代理清單沿用既有探針輸出目錄 `.runtime/capacity-fallback-ui-probe/`、`.runtime/worker-count-20261004/ui/`，時間戳為本批重跑，不是舊驗證冒充。

## 修改檔案

- `src/desktop-controller.mjs`、`src/luna-gateway.mjs`、`frontend/goal-dialog.jsx`：status-only 的受阻恢復與說明。
- `src/main-models.mjs`、`src/main-sessions.mjs`、`src/unified-controller.mjs`、`frontend/reasoning-picker.jsx`／`.css`、`frontend/main.jsx`：原生 Fast 目錄、偏好與實際值、Codex 限定介面。
- `src/conversation-controller.mjs`、`src/native-workers.mjs`、`frontend/worker-activity-popover.jsx`／`.css`、`frontend/main.jsx`：共用全域來源與逐工人狀態。僅回傳必要摘要，不傳整段工人提示。
- 對應後端回歸與 `test/goal-fast-ui-probe.mjs`、`test/capacity-fallback-ui-probe.mjs`、`test/worker-count-ui-probe.mjs`；`README.md`、`AGENTS.md`、開發索引記錄候選界線。

## 發布

使用者在套用詢問明確選擇「先保留修正，暫不套用」。因此本批完成來源／真實假資料驗證與複查後僅保留本機 Git 版本，尚未製作正式安裝候選、部署、重啟正式 K 或 push。正式程式仍為先前的 `d88d148`，東區不動。沒有操作正式目標、切換真實帳號或重送工單。

使用者另授權工作因 Codex 額度耗盡受阻時可使用一張重置券；本批沒有遇到該情況，未使用券。服務容量錯誤或連線錯誤不視為額度耗盡。


## 後續合併發布（2026-10-06）

使用者後續明確要求修好後更新，並補充先前未上的細節收合要一起上，取代上節的暫存限制。本批已包含於固定正式程式 `4201a285d48ee32a57313e4d73afafa4a3d74191`，南區正常重開及正式讀回完成，GitHub main 已核對該程式 SHA；東區不動。退版位置、保護資料與合併驗證見 [等待／活動與部署紀錄](worker-wait-20261006.md)。
