# Codex 暫停目標的 AI／人工恢復（2026-10-05）

## 需求與根因

使用者的真實 native 紀錄顯示：18:33:15 的 `k_gemini.goal_edit` 已改同一目標文字，原生狀態保持 `paused`。這符合純儲存語意，但 AI 未獲提供恢復工具；人用「繼續目標」又被一般回合的 busy 禁用。因此一般回合可以工作，原生目標卻尚未恢復，不是文字更新失敗或單純畫面未刷新。使用者要求「修好」。

明確效果：使用者交代繼續既有暫停目標，AI 能直接操作同一目標，不需再按確認；本人仍可直接按繼續。只有修改文字不會恢復；不建立新目標、不重送任務、不修改權限／預算／用量，不以 Gemini 工人供應商決定主目標。

## 最小修正

- `src/luna-gateway.mjs`：既有每聊天室認證 gateway 增加可選 `goal_resume`，strict 空參數；只 Codex 主控制器掛載。模型不得傳入 thread、objective、budget 或假的 confirmed。工具說明明訂需使用者明確恢復指示，純文字編輯不是恢復。
- `src/desktop-controller.mjs`：與 edit 共用原生 metadata 的目前主 thread／turn 檢查。`resumeOnly` 先 get 既有目標；paused 僅送 `thread/goal/set {status:'active'}`，已 active 僅讀回；缺目標、complete、blocked、usageLimited、budgetLimited 不重建或突破限制。沿用既有 RPC 鎖／停止 epoch，不增加排程器或同意狀態。停止已取消且尚未送出修改的舊讀取，不再回寫 goalError，避免成功停止被誤判為 uncertain；已送出的不明結果仍保留。入口指引明訂「一般回合正在處理」不等於「目標進行中」，須依原生讀回。
- `frontend/goal-dialog.jsx`：只有 Codex 暫停目標的「繼續目標」可在一般回合忙碌時操作，走 resumeOnly。待 RPC 時仍鎖定；「更新並執行」仍須閒置。原有本人解除 blocked／limit 的操作不擴張到 AI 或忙碌回合；Claude／Gemini 的原生流程不改。
- `test/desktop-native-events.test.mjs`、`test/luna-gateway.test.mjs`：追加 metadata 歸屬、非零用量保留、已有 active 冪等、缺目標與其他狀態拒絕、參數限制及讀／寫等待時停止優先測試。

## 驗證

- 最終來源完整 **809/809**、定向 **27/27**，`npm run build:ui` 通過；既有 UI bundle 大小提醒未另作無關拆分。補修後第一次全套有一個未改動的 input-queue FIFO 測試超過既有 2 秒等待（808/809）；保留失敗紀錄，該檔獨立重跑 20/20、相同程式完整重跑 809/809，沒有調大逾時或改佇列來掩蓋。此間歇測試逾時原因未進一步確定。
- 真正 Codex **0.160.0**，K 專用訂閱、`gpt-6-luna`／high／read-only，新建純假資料目標：paused → 一般回合由 AI 呼叫 `goal_resume` → active → 原生自動下一回合 → complete。兩回合依序、不重疊；K 只發一次 `turn/start`、零次 `turn/steer`；createdAt、objective、tokenBudget 不變、無第二核准或瀏覽器操作。原生測試從零用量開始並累計至 1,360 tokens，非零用量恢復保留另由單元測試覆蓋。
- 假 UI／真 headless Chrome：工作中 paused 可按繼續並更新為「進行中」；goalPending 鎖定；限制狀態 busy 不放行；純儲存仍保留狀態與預算；AI／人工文字衝突拒絕覆寫；800／1100／1920 寬度與另外兩核心邊界回歸通過，無頁面錯誤。
- 首次 native 探針在建立模型回合前，因診斷 wrapper 對沒有 onEvent 的檢查 host 呼叫了 `o.onEvent` 而退出；修正探針使用 optional callback 後以上實測通過。不是產品錯誤，未重播未知工作。
- 證據只留本機 ignored `.runtime/goal-resume-20261005/`：`native-resume-validation.json`、`ui/result.json`、`ui/goal-resumed.png`、`all-tests*.txt`、`stop-race-before.txt`、`focused-final.txt`。真實使用者翻譯目標沒有被工程操作、恢復或重送；帳號與登入不動。

## 複查與發布狀態

- 真正 `claude-opus-5-5`／官方 K 專用 Claude 2.1.289／claude.ai firstParty 訂閱讀回確認。首查 session `818ede7c-63dc-4a5d-a1a5-e7d859db047f` 找到停止交錯時誤報 goalError 的 P2；先以 get 回來、interrupt 尚未回的交錯測試重現，再採一行條件補修，覆蓋純編輯與恢復兩路徑。最早的重現測試 fixture 把 close 的第二次 get 也攔住造成等待，已修成只攔第一次，僅結束該假測試自有程序，不碰正式 K。
- 補查 session `625e26cd-b89c-43dc-95c4-f0e381351fd6`，核對最新程式、回歸測試與原封轉送參數的 server／conversation controller，結論無 P1/P2，可固定候選。原始紀錄在 `opus-final/`、`opus-recheck/`。沒有採用另一套 scheduler、CAS、語意授權 parser 或確認欄位。
- 模型是否理解使用者「繼續」由原生 AI 依工具說明、入口指引與本人訊息判斷，不以 K 關鍵字掃描代替；本輪驗證明確恢復指示，未宣稱所有措辭均會正確理解。真實使用者翻譯任務沒有被拿來測試。
- 正式 K 仍開著，47831 有監聽，尚未停止、替換或推送；目前南區程式仍為 `7754c3863afaaf1a5e833d0c4be81f641e316295`。東區、既有標記不動。固定本機版本後，只有確認正式工作停止才依現行 SOP 部署與私人 GitHub 發布。

- 本批程式固定版本：`2042076c07a3526690a91dd9b95207d04275e2b5`；仍只在本機開發 worktree，未部署／推送。固定版本後的文件收尾不代表程式又變更或已正式生效。
