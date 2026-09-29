# Claude 原生子代理與計畫進度呈現（2026-09-26）

後續真實候選 Agent 回合與正式狀態統一見[整批收尾](closeout-20260926.md)。本文件底部「未執行」指初次實作階段；實際模型未提供 TodoWrite，不以測試替身聲稱原生計畫已跑過。

## 本輪變更

- Claude host 在既有 stream-json 參數中加入 `--forward-subagent-text`。原有 host 僅能接收預設轉送的子代理工具呼叫／結果；沒有此旗標時，Claude 不會轉送子代理文字內容。
- Controller 依原生 `parent_tool_use_id` 將子代理訊息寫入 `state.workers`（`provider: "claude-native"`、`requestId` 為原生父工具 ID、`task`、`prompt`、`output`、`status`）。子代理文字和提示不加入主對話 `state.messages`；thinking blocks 不轉送到介面。
- `TodoWrite` 使用已確認的 `todos[{content,status,activeForm}]` 輸入，把完整有效待辦映射到既有 `state.progress.plan`，並沿用既有計畫 UI。
- `ExitPlanMode` 仍透過 Claude 原生 permission host 的既有 pending approval 流程；核准卡片顯示 Claude Code 提供的 `plan`，並保留原始輸入與 plan 路徑在可展開操作內容中。若原生計畫未提供，只提示使用者並展示已有的 TodoWrite 清單；不讀取 planFilePath、不自動核准，也不新增人用技術面板。

## 原生契約查證

- 目前本機官方 `@anthropic-ai/claude-code` CLI 是 2.1.280。套件附帶的 `sdk-tools.d.ts` 定義 `TodoWriteInput.todos` 為 `content: string`、`status: "pending" | "in_progress" | "completed"`、`activeForm: string`；`ExitPlanModeOutput` 定義 `plan: string | null`、`isAgent: boolean` 與可選 `filePath`。這些欄位依實際 CLI 套件型別核對，沒有臆造 TodoWrite schema。
- Anthropic 官方 [Claude Code CLI headless 文件](https://code.claude.com/docs/en/headless) 說明 stream-json 的子代理訊息是 `assistant`／`user` 訊息，`parent_tool_use_id` 指向產生它的 Agent/Skill 工具呼叫；只有設定 `--forward-subagent-text` 或其環境變數，才轉送子代理文字與 thinking，需求版本為 2.1.211+。正式 host 最低版本已要求 2.1.280，因此以 CLI 旗標啟用。
- Anthropic 官方 [Hooks reference](https://code.claude.com/docs/en/hooks) 的 ExitPlanMode 欄位說明：Claude 先把計畫寫入檔案，hook input 在交付前會注入 `plan` 和 `planFilePath`；approval 卡片因此只讀 callback input 中實際提供的 plan，不自行猜路徑或讀檔。
- 同一 CLI 套件的 `sdk-tools.d.ts` 將 Agent 結果分成 `status: "completed"`（同步結果）與 `status: "async_launched"`（含 `agentId`、`outputFile` 等背景啟動資料）。官方 TypeScript SDK 的 `SDKUserMessage` 允許 `tool_use_result` metadata；Anthropic SDK changelog 記錄 Agent structured result 公開型別與 emitted object 相符，也記錄 resumed deferred result 的 `tool_use_result`／`toolUseResult` casing 修正。Controller 現只在單一 Agent/Task tool result 與明確 `status: "completed"` metadata 同時吻合時完成對應 worker；metadata 缺失、async_launched、未知狀態或同訊息多工具結果仍是 unresolved。依據：[streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)、[subagents](https://code.claude.com/docs/en/agent-sdk/subagents)、[official TypeScript SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)。未以普通 tool result、手寫回覆或存檔 transcript 推測完成。

## 驗證

- 增加 controller 測試：子代理事件歸屬與不混入主結論、明確 completed metadata、async_launched／多工具歧義保留 unresolved、late child 不復活、TodoWrite 正常／無效 schema、ExitPlanMode 計畫顯示及拒絕路徑。
- host 假 CLI 測試會拒絕缺少 `--forward-subagent-text` 的啟動參數。
- 未結束的 native worker 只在 host 已確認關閉後轉成 `status: "interrupted", settled: true`；單發 interrupt request 不會先宣稱 worker 停止。尚無確定背景事件完成時，不偽報 completed。
- `node --test test/claude-controller.test.mjs`：43/43 通過；本次補 metadata 與 ambiguity case。先前文件所列 controller/boundaries/host test 59/59 為前一輪結果，不能當成本次重跑。

## 限制與未完成

- 尚未在真實已登入候選模型回合中觸發 Agent/Task、TodoWrite、ExitPlanMode；需由主代理依本輪授權統一執行真實候選驗收。
- 本地單元測試不證明正式服務已重啟或已部署；本輪未登入、呼叫模型、重啟任何 host，也未執行正式操作。
