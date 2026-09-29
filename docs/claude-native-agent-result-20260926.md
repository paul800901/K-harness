# Claude 原生子代理完成狀態 metadata

日期：2026-09-26。狀態：本機 controller 修正及測試通過；未重啟候選／正式服務，未跑真實模型回合。

## 結論與官方依據

- 本機安裝的官方 Claude Code CLI 為 `2.1.280`；`claude --help` 只讀確認其支援 `--output-format stream-json`。
- 該 CLI 隨附的官方 `sdk-tools.d.ts` 定義 Agent tool 的 `AgentOutput`，其 `status` 區分 `completed` 與 `async_launched`，另含 `agentId`、`content` 等欄位。
- Anthropic 的 Claude Agent SDK streaming 文件說明 SDK 以完整 user/assistant 訊息流傳送，而非只有 API raw delta；子代理文件說明 Agent tool 結果回到 parent tool result。官方 TypeScript SDK changelog 在 0.3.207 記錄 Agent structured result 的公開型別與 emitted object 相符，0.3.275 記錄 deferred tool result 在 resumed turn 曾把 `tool_use_result` 發成內部 key `toolUseResult` 的 casing 修正。因此 product event 讀取兩種 spelling，但只有完整 metadata status 是結案依據。
- 來源：
  - [Anthropic streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
  - [Anthropic SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
  - [Official TypeScript SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)

## 實作

- `src/claude-controller.mjs`：只在同一 user event 含恰好一個 Agent/Task `tool_result`，且頂層 `tool_use_result` 或 `toolUseResult` 明確帶 `status: "completed"` 時，將相同 `tool_use_id` 對應的 Claude worker 設為 settled/completed。
- 一般工具結果文字、缺 metadata、未知 status、`async_launched`、或同一 event 多個 tool result，一律保留 unresolved；不從手寫回覆或存檔 transcript 推測完成。
- worker settled 後忽略遲到子代理事件，避免已結案項目被復活。
- `test/claude-controller.test.mjs` 增補完成 metadata、async_launch、歧義多工具結果及遲到事件測試。

## 驗證與界線

- `node --test test/claude-controller.test.mjs`：43/43 通過。
- 未讀認證／profile 資料，未執行真實模型，未在候選 host 加 probe，未重啟候選或正式服務。產品 live event 尚待主代理於既有候選重啟後驗收；此次只根據 CLI help、官方 SDK 型別／文件及 fixture 測試做窄修。
