# Codex 目標：本人操作的原生意圖記錄補接

## 狀態及範圍

候選修正，source commit `e3f2ecd263b1dfd854ea10acdbb31a86b54ae713`，Astra 獨立驗收及索引已完成，**尚未部署**。本項不是服務端 remote compact 失敗根因修復，不新增恢復、重試、換模、timer 或 wakeup 策略。下方保留各階段當時的失敗與待驗證狀態，以最後整合讀回為準。

固定 Codex 0.161.0 公開協定對 goal set/clear 提供 `origin:user/automatic`。既有 K 的人類操作與 AI 操作都省略來源，狀態雖成功改變，卻沒有本人 `UserGoalUpdate` 授權歷史。原生 goal runtime 不以 origin 阻擋 Active；既有明確繼續入口可用，無需先手動 compact。

## 最小差異

- `src/desktop-controller.mjs` 只有三處：lexical goal 第二參數預設 automatic；mutation RPC 傳 origin（refresh/get 不傳）；public goal wrapper 固定 user。
- 人類 public set/edit/resume/clear 傳 user；模型 gateway 保留既有 current-main-thread/turn 校驗，走 lexical automatic。body.origin 不被採用。原生只在 set 含 objective 或 status 時寫 UserGoalUpdate；僅改 tokenBudget 雖帶 user，也不建立此意圖項。
- active resume 保持 read-only no-op；停止、內部 pause、close 原封不動，不偽標人類授權；既有預算／狀態、同 thread／epoch 防護不變。
- `test/goal-provenance.test.mjs` 新增 10 項回歸。
- `test/desktop-native-events.test.mjs` 只更新既有兩 case 的 wire origin 期望；AI resume case 的舊 mock 把 RPC params 當 goal 回傳，故只排除新 origin metadata，避免把它誤當原生 goal 欄位。保留其原狀態／用量 assertions；不改 native-wakeup。

## 證據與驗證

證據目錄：`D:/K-harness/.runtime/native-coordination-repair-20261011/compact`。

- 新 10 項 red：4 pass/6 fail；修改後 10/10 green。`goal-provenance-red.log`、`goal-provenance-green.log`。
- 舊 focused 初次 69/71；兩失敗為新來源欄位與舊 mock 合併，完整失敗保留 `provenance-focused.log`。必要 mock／期望修正後與新測試合計 **81/81 通過**，見 `provenance-focused-green.log`。
- 原固定 binary 零模型對照：同樣 paused set/edit/clear，省略 origin user.goal=0；user origin=3。`native-provenance.json`。
- 本次真正產品 K public goal → 固定 native core 的原封不動 mutation wire：paused set/edit/clear 全部 user，3 個 user.goal 持久化；localhost endpoint requests=0、native turn/started=0、turn/start/compact/resume/fork=0。`k-native-provenance.mjs`、`k-native-provenance.json`。
- 該接線實測新空 HOME／假 workspace，沒有原房或登入複製。因 K.open 正常要求訂閱與 MCP 就緒，僅假 bootstrap catalog/account/MCP；**不是正式登入或 production 初始化驗收**。goal mutation params 未變動而交真 core；provider 無 auth、只指 localhost 拒絕端點。
- 自有測試 PID 45168、25848 均 native close code=0/signal=null，事後精確 CIM 查兩 PID 無結果；未停止其他程序。K models 預查的自有臨時 host 亦已關閉。
- binary SHA256 `a0f89acca07a511734cac7fddee26b2106fab68918717bc90df16104a0760a30`；原生版本 0.161.0。

raw canonical rollout 可讀 user.goal；未有模型 turn 時 thread/read/items/list 不投影這些隱藏項。進入後續模型歷史及 Guardian retained context 的機制見官方固定源碼與官方測試，本輪未發模型驗證回合。不把內部注入 context 的 auto-compact-* ID 當成真正壓縮事件。

## 官方來源與責任界線

固定 commit `979011409de0a60b52f179721948e65531d26144`：

- [goal protocol](https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)：844–873、900–904，set/clear origin。
- [goal processor](https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144/codex-rs/app-server/src/request_processors/thread_goal_processor.rs)：199–209、302–305，只 user provenance 記意圖。
- [goal runtime](https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144/codex-rs/ext/goal/src/runtime.rs)：225–242、425–487，明確 Active 沿原生同 thread continuation，不需先 compact。

K 只補原生 provenance 欄位，不重造執行／壓縮核心。服務端 compact 內因仍 UNKNOWN；缺 origin 不可被宣稱成 blocked 不能恢復的根因。

## 真正 Opus 增量複查

官方 Claude Code 2.1.294；preflight 為 claude.ai／firstParty／Pro；實際回覆 model=`claude-opus-5-5`，session `07b576e8-e08a-45b0-bded-53685bee974e`，exit 0，結論無 blocking。僅 10 次 Glob/Read，無寫入工具；未送 raw env/config、小說或原房，未重審 frozen timer。詳證據 `compact/opus-incremental/`，三個產品／測試檔審前後 hashes 一致。

非阻擋建議已就必要界線讀回：固定 processor 的 origin 僅於 199、303 行比較 Some(User)，未傳給 goal service 的狀態資料；automatic 與省略均不建立 user authorization，runtime effects 相同，未新增第三次 raw probe。src 全部直接 `.goal(` 呼叫除另一核心 Claude 外只有 conversation 的 refresh；其餘是人類路由 forwarding，AI 維持 lexical。已補 tokenBudget-only 的原生記錄限制及正體字。第一個舊 case mock 未影響本任務的既有合併保留，不為一致化擴改。

Opus 通過不等於已部署；仍待 Astra 獨立驗收，未 commit、push、部署或恢復正式目標。

## 末審後的全套測試契約補正

Astra 整合全套測試初次為 **1251 tests、1249 pass／2 fail**，完整 `root-integrated-tests.log` 由 Astra 保留：`test/codex-capacity-fallback.test.mjs:58` 的同一 loop 對 serverOverloaded、other 各觸發一次失敗，既有人類明確 resume wire expected 尚未包含 `origin:user`。只在這一個 expected object 補該一欄，不改 no-retry／不換模／原生 error／成果保留等策略斷言，產品 source 保持凍結。

該檔與 10 項 goal provenance 回歸合計 **29/29 通過**，見 `compact/post-review-wire-expected-green.log`。這個 test-only 期望補正晚於上述 Opus 審查，**不宣稱 Opus 已讀過此追加差異**；依 Astra 裁決不為單欄期望再次喚模型。完整 suite 的重新驗收與 commit 由 Astra 執行，本記錄不冒稱全套已重跑或已部署。

## Astra 最後整合驗收與正式狀態

- Astra 獨立檢查三處產品 diff、新增 10 項測試、既有 wire 期望、真正原生 paused set/edit/clear probe 及 Opus 原始模型／工具／結果投影。controller SHA256 仍為送審的 `93c4ec09a20a0993c4c547bf6d4338e9a25232db15bdde09bc93d3a33907b0e4`，末審後產品碼未變。
- 完整 `node --test --test-concurrency=4 test/*.test.mjs`：**1251/1251、0 skipped、exit 0**，61.472 秒；證據 `D:/K-harness/.runtime/native-coordination-repair-20261011/root-integrated-bounded-tests.log`。UI build exit 0，證據 `root-integrated-ui-build.log`；既有超過 500 kB chunk 提醒仍保留，未為本任務擴大打包重構。
- 這次完整通過使用固定 4 檔並行，不宣稱預設高並行版本也重新通過。先前三次完整失敗 log 全保留；後兩次的非同步觀察修正、input-queue 尚未證明的負載原因與未改範圍，見 [自主核實候選的最後驗收](native-terminal-autonomous-reconciliation-20261011.md#astra-最後整合驗收與失敗保留)。沒有移除任何測試或延長原 input-queue 的 2 秒期限。
- source `e3f2ecd263b1dfd854ea10acdbb31a86b54ae713` 為上述產品 3 處與必要 test-only 差異；包含前批自主核實候選 `3b91482f45e23d7a1ceaa43eb0fdd41931e66348`。末審之後追加的測試期望／非同步觀察校正由 Astra 獨立檢查，不冒稱 Opus 看過。
- 最後只讀正式版本仍為 `e1712d117d3c7f2d4f1df7ffd0b2beb94ffa15e1`，K 桌面及原生 host 仍存在；沒有停止、部署、重啟、恢復書房、push 或更新東區。候選驗證不等於正式驗收，也不證明極長任務記憶偏移已治癒。
