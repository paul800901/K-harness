# Claude 主對話的多一層派工（2026-10-24）

狀態：設計已定，實作中。分支 `feat/claude-nested-delegation`。

## 本人需求

本人原話（10-24）：Fable 系列討論特別強，但額度特別少，「他跟我討論就差不多了」；統籌是 Opus 5.5，Sol 適合後端、找 bug、搜尋，「所有的雜事所有的功能最花額度的東西就是由 Flash 去做」，「這樣用起來效果是最好的最快最完美幾乎不用返工」。「需要多重派工的只有你們 Claude 系列」「GPT 系列派一個就夠了」。原本用「Fable 寫交接檔 → 本人開 Opus 聊天室貼上」的方法，「每次都要複製真的太煩了，既然有辦法做好，為什麼我們不做好呢」。

目標鏈：**Fable 主對話 → Opus 工人（統籌）→ Sol／Flash 小工人**。Fable 交出去後就待命，只收一次精簡結果。

## 現況（10-24 盤點）

- 所有 K 工人都不能再派工：Claude 工人 `mcpConfig:{mcpServers:{}}`＋`--strict-mcp-config`＋`--disallowedTools Agent,Task,...`＋系統提示「Do not delegate」（`src/claude-worker.mjs`、`src/claude-host.mjs` worker 分支）；Codex 工人 `agents:{enabled:false}`（`src/luna-bridge.mjs` thread/start）；Gemini 工人不帶 gateway。
- 追蹤是平的：每個主對話一個 bridge，紀錄只有 `parentId`（主對話 threadId）。
- 工人核准經 bridge 的 `onRequest` 送到本人畫面。
- Claude 工人是一次性程序，收不到完成通知；要等小工人只能在自己的回合裡用 `luna_wait`（每次最多 60 秒、事件驅動）。
- Codex 原生 `agents.max_depth` 預設 1（[官方文件](https://developers.openai.com/codex/multi-agent)），K 現況等同原生預設。

## 設計（最小完整解）

範圍：**只有 Claude 主對話派出的 Claude 工人**可以再派一層。GPT 主對話、Gemini 主對話、Codex／Gemini／API 工人全部不變。小工人一律不能再派（第二層 bridge 不再開放巢狀）。

1. **開關在主對話端。** `claude-controller.mjs` 建 bridge 時傳入一個 `nested` 工廠（只有 Claude 主對話傳）。`luna-bridge.mjs` 只在 `provider === 'claude'` 且有 `nested` 時，於 `worker.run` 前呼叫它，取得 `{mcpConfig, close, list}`。
2. **小工人用獨立的 bridge＋gateway。** `nested` 工廠以 `bridgeFactory` 建第二層 bridge：
   - `parentId`：由上層 `parentId` 與工人 `requestId` 組成、符合 `safeId` 的唯一值（紀錄存在自己的資料夾，不與主對話的工單混在一起、不撞 requestId）。
   - `accessMode`：等於上層工人的 `accessMode`（權限只會相同或更小，不會放大）。
   - `workerPolicy`：沿用主對話的設定。
   - `onRequest`：沿用主對話的 `codexApproval`，小工人的核准一樣跳到本人畫面，並帶上「由哪個工人派出」。
   - 不傳 `nested`：第二層不能再派。
   - 再以 `gatewayFactory` 為它建一個 `k_luna` gateway（不給聊天室收件匣、目標、context 等主對話專用工具）。
3. **Claude 工人拿到 gateway。** `claude-worker.mjs` 的 `run` 接受選填 `mcpConfig`；有給時：
   - `mcpConfig` 換成第二層 gateway（仍 `--strict-mcp-config`，只有這一個 MCP）。
   - 權限回呼對 `mcp__k_luna__*` 直接允許（K 自己的派工工具，權限由第二層 bridge 控管）；原生 `Agent`／`Task` 仍然拒絕。
   - 工人提示與系統提示改為：可用 `k_luna` 派一層小工人、必須明確給 model 與 effort、小工人不能再派、交差前必須用 `luna_wait` 等到所有小工人 settled 並自己檢查成果、不重播未知工作；並附上主對話同一份選模指引（`MODEL_ROLE_GUIDANCE`）。
   - 沒給 `mcpConfig` 時行為與現在完全相同。
4. **交差與停止整串。** Claude 工人回合結束（完成、失敗或取消）後、紀錄 settled 之前，`luna-bridge.mjs` 呼叫第二層的 `close()`：取消並確認所有未結束的小工人，再關 gateway。小工人停止無法確認時，上層工人紀錄不得標為 settled（沿用現有「停止未確認」語意：`unresolved`、不重播）。主對話 `luna_cancel` 上層工人或關閉 bridge 時，同樣會走到這一步。
5. **誰派了誰。** 第二層 bridge 的 `onChange` 回報到上層工人紀錄的 `subWorkers` 陣列（每筆：`requestId`、`provider`、`model`、`effort`、`status`、`settled`、`startedAt`、`endedAt`，不放派工全文），上層紀錄跟著 persist／changed。子代理明細頁在該工人下方列出小工人；上方快覽照舊只列本聊天室直屬、仍在執行的工人。小工人的完成事件不送進 Fable 主對話（由 Opus 工人自己等與驗收），只有上層工人完成才送一次。
6. **Gemini 帳號規則不變。** 第二層 bridge 用同一個共用排程器（不同帳號不並行、不暗換帳號）。
7. **選模指引更新。** `worker-policy.mjs` 的 `MODEL_ROLE_GUIDANCE` 與 `luna-gateway.mjs` 的 auto 說明：把「Claude 派出的 Sol 子代理目前不能再派 Flash」改成實際現況——Claude 主對話派出的 Claude 工人可再派一層（Fable 討論 → Opus 統籌 → Sol／Flash），其他工人仍不能再派；並寫入本人 10-24 分工（Fable 只討論、額度少不耗在等待；Opus 統籌；Sol 後端／抓 bug／搜尋；Flash 雜事與大量實作）。

## 不做

- 不開第三層、不做層數設定或人用按鈕。
- 不把 Claude 原生 Agent 打開（原生子代理會繼承權限與 MCP，控管不到）。
- 不改 GPT／Gemini 主對話、Codex／Gemini 工人。
- 不讓小工人完成事件喚醒 Fable。

## 待查（另列，不擴大本批）

- 盤點時發現：GPT 主對話的 Codex 原生子代理可能繼承 `k_gemini`，而 `gemini_start` 沒有呼叫者檢查（`docs/opus-batch-review-20261003.md:163` 已列為未測）。交 Sol 收尾時一併實查，確認後另案處理。

## 驗證計畫

- 單元測試：`test/claude-worker.test.mjs`、`test/claude-worker-bridge.test.mjs`、`test/luna-bridge.test.mjs`、`test/claude-controller.test.mjs`、`test/worker-policy.test.mjs` 補：
  - 沒有 `nested` 時參數與現在逐項相同（仍是空 MCP、仍拒絕再委派）。
  - 有 `nested` 時只多出第二層 `k_luna`，`mcp__k_luna__*` 允許，`Agent`／`Task` 仍拒。
  - 第二層 bridge 的 `accessMode` 等於上層工人；第二層不能再派。
  - 上層工人結束／取消時第二層 `close()` 被呼叫；close 失敗時上層紀錄 `unresolved`、不 settled。
  - `subWorkers` 正確更新；小工人完成不觸發主對話送達。
  - 非 Claude 工人、GPT 主對話、Gemini 主對話不受影響。
- 完整 `npm test`；改介面先 `npm run build:ui` 再 `npm run test:ui`。
- 實測：測試用 Claude 主對話派 Claude 工人，再派一個 Flash 小工人做小事，確認明細頁、停止整串與完成只送一次。

## 實作與複查紀錄

### Flash 實作（`nested-deleg-impl-20261024a`，gemini-3.8-flash high）

照規格改了 `src/claude-controller.mjs`、`src/luna-bridge.mjs`、`src/claude-worker.mjs`、`src/claude-host.mjs`、`src/luna-gateway.mjs`、`src/worker-policy.mjs`、`frontend/work-status.jsx`、`frontend/main.jsx` 與 6 個測試檔。Flash 回報 `--tools` 只管內建工具，MCP 工具另以 `mcp__<server>__<tool>` 註冊，不受影響（未實測，留給實測確認）。

### Opus 複查與修正（同一 commit `6c68476`）

1. **工人會誤以為會收到完成通知**：小工人 gateway 沿用主對話的 `luna_start` 說明「K 會自動把完成送回本對話」，Opus 工人可能不等小工人就交差、導致小工人被整串取消。改為 `createLunaGateway({nestedWorker:true})` 時說明「K 不送完成事件給你，交差前用 `luna_wait` 等到 settled」。補 `test/luna-gateway.test.mjs` 一項。
2. **工人不知道可派的模型與 effort**：原本只塞了 `MODEL_ROLE_GUIDANCE`（且系統提示與任務內容各塞一次）。改為 `nested` 回傳主對話既有的 `workerInstructions`（本台官方可派模型清單），經 `workspaceInstructions` 附在工人系統提示；任務內容不再重複指引。
3. **核准閘門改動超出範圍**：Flash 把 `opening/closing/stopping` 擋法擴大到所有核准種類。還原成原本只對 `k/claude/requestApproval` 生效，改用參數指定預期 `parentId`；小工人核准另檢查主聊天室仍是原 thread。
4. **正常交差時小工人核准卡片殘留**：第二層 `close()` 結束時清掉該工人派出的小工人核准；`close()` 只呼叫 gateway 的 close（它先關 bridge、確認全部小工人停止，再關 HTTP），不重複關 bridge。補 controller 測試斷言。
5. **明細頁狀態顯示英文**：改用 `frontend/work-status.mjs` 既有 `statusLabel`（匯出），未知狀態顯示「狀態未確認」。
6. 移除 `nested` 回傳中沒人使用的 `list`、`nested()` 不再收用不到的 `parentId`。

### 測試

- 相關 7 個測試檔 233/233；完整 `npm test` **1896/1896**。
- `npm run build:ui` 成功；`npm run test:ui`（`PLAYWRIGHT_BROWSERS_PATH` 指向主工作樹 `.runtime/playwright-browsers`，工作樹沒有這份瀏覽器）**50/51**：`mobile-remote-ui-probe.mjs` 整批時失敗、單獨重跑通過（`{"passed":true,"rooms":6,"sendCount":3}`）；Flash 那次是 `voice-composer-ui-probe.mjs` 整批失敗。兩支都與本批無關、單獨可過，判定為整批執行時的偶發。小工人清單沒有專屬介面探針，留給實測。

### Sol 收尾抓 bug（`nested-deleg-sol-review-20261024a`，gpt-6.1-sol high，只讀）與處理（commit `c7b23d8`）

Sol 回報 8 項，Opus 逐項對程式核對：

1. **[high，屬實，已修] 父工人提早顯示 settled**：工人結果先套進紀錄、之後才等第二層關閉，期間 inspect／list 與主聊天室停止流程會把它當已結束而跳過。改為 `closeNested()` 完成後才套用工人結果。補「關閉第二層期間 inspect 仍是 settled=false」測試。
2. **[high，屬實，已修] 第二層停止未確認後失去重試入口**：改把未確認的第二層連同工人自己的原結果存在 `nestedCleanups`；之後 `luna_cancel` 或 bridge close 只重試第二層停止，確認後才恢復工人原結果，失敗仍拋錯、保持 unresolved，不重送任務。`cancel()` 改為先中止執行中的工人、再查是否需要重試；`processGone` 放棄歸屬那一支改為只在本次沒有執行中 handle 時走（維持原本的互斥）。補「第一次關閉失敗、取消重試後恢復 completed」測試。
3. **[medium，屬實，已修] 建立 gateway 途中失敗會漏關第二層 bridge**：工廠內失敗時先關已建立的 bridge，關閉也失敗時以 `settled:false` 拋出；bridge 的 start catch 不再吞掉關閉錯誤，未確認就標 unresolved。
4. **[medium，屬實，已修] 重啟後小工人快照仍顯示執行中**：讀回未結束的上層紀錄時，未 settled 的小工人快照改標 `unresolved`（畫面顯示「狀態未確認」），不重建第二層、不重播。補測試。
5. **[medium，屬實，已修] subParentId 截斷可能撞名**：長度超過 128 時改用完整 parent＋requestId 的 sha256 前 40 碼。補測試。
6. **[medium，屬實，已修] 統籌工人收到互相矛盾的等待指示**（主對話用的指引寫「完成會自動送回、可結束回合」「scheduling.waiting 就結束回合」「原生 Agent 可用」）：工人系統提示最後加一段明確覆寫：收不到完成事件、不可為等待結束回合、原生 Agent 不可用、waiting 時用 `luna_wait` 帶 waitId、所有小工人 settled 並檢查後才交差。
7. **[medium，unverified → 已實測通過] plan／限制工具模式下 MCP 是否可用**：見下方實測。
8. **[medium，既有缺口，本批不修] GPT 主對話的 Codex 原生子代理可能可呼叫 `gemini_start`**：Sol 確認主 thread 掛 `k_gemini`、原生 agents 開啟、`gemini_start` 沒有呼叫者檢查；原生子代理是否實際繼承 MCP，repo 內無證據。建議修法：`start` 接收原生 `_meta`，沿用既有 `assertMainGoalCaller` 的 thread／turn 驗證。與本批無關，另案處理。

另以 `prettier` 統一本批修改檔案的格式（原版本全部符合，本批有 6 檔不符）。完整 `npm test` **1899/1899**。

### 實測：真的 Claude Code 工人能否使用第二層派工工具

在 K 外的暫存資料夾用工作樹的 `createClaudeWorker` 啟動真的 Claude Code（`claude-haiku-4-5-20251001`），接上真的 `createLunaGateway({nestedWorker:true})`，小工人端用只記錄呼叫的假 bridge（不派真的 Flash、不碰正式 K）。任務：呼叫一次 `luna_start`、再 `luna_wait`、回答 DONE。

| 工人權限 | 結果 | gateway 收到的呼叫 | 跳出本人核准 |
| --- | --- | --- | --- |
| workspace-write（claude-manual，`--tools` 限內建工具） | completed / DONE | start probe-1 gemini-3.8-flash → wait probe-1 | 無 |
| read-only（claude-plan） | completed / DONE | 同上 | 無 |
| danger-full-access（bypass） | completed / DONE | 同上 | 無 |

結論：`--tools` 只限內建工具，第二層 `k_luna` 在三種權限都可用；`mcp__k_luna__*` 由工人權限回呼直接允許，不打擾本人。

## 進度

- [x] Flash 實作
- [x] Opus 複查
- [x] Sol 收尾抓 bug（含上面待查項）
- [ ] Sol 複核修正
- [ ] 完整測試與實測
- [ ] 部署、push 與讀回
