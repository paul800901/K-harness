# Claude 原生可見性 — 2026-09-24

## 原生來源與處理

- `src/claude-host.mjs` 將 Claude Code 官方 `stream-json` 訊息原樣交給 controller；不另行猜測或改造原生事件欄位。
- 隔離原生探測證據位於 `.runtime/ui-parity-20260924/native/claude-probe.json`：可讀到 `system/status` 事件、assistant 文字與 `thinking` 內容區塊，以及 `result.usage` / `result.modelUsage`（包含 input、cache read/create、output token 與 context window）。
- `state.notices` 將已觀察的 `system/status=requesting` 映射成短通知。隔離探測亦實際收到 `rate_limit_event`：`status=allowed`、`rateLimitType=five_hour`、`overageStatus=rejected`、`overageDisabledReason=org_level_disabled`。因此只在這組已觀察條件下顯示警告「目前請求仍獲允許；額外用量因組織層級設定遭拒」，不誤報為目前請求已被限流。通知附原生 uuid（若無則本地 ID）、目前 user-turn UUID、等級、kind 與時間；不複製任意原生 payload。
- `state.progress.tokenUsage.last` 只取原生 `stream_event.message_start.usage` 最新一次請求的 input + cache read + cache creation token，明確標記 `measurement=latest-native-request-input` 及來源；不含 output，也不是一整回合多次 API 呼叫的加總。`modelContextWindow` 取原生 result.modelUsage 的 contextWindow。缺少原生數值時保留未知，不估算百分比或 session 累計值。
- `state.usage.claude` 仍代表官方訂閱額度查詢，與 context token usage 分開。

## 差異與明確不支援

- Claude `thinking` 內容區塊可能包含隱藏推理，不呈現、不持久化至 UI reasoning，也不讀取其字串。此次原生探測未證明另有可公開呈現的 summary；因此 `state.reasoning` 為空，`capabilities.reasoningSummary=false`。
- 探測串流與 result 未提供可用原生 turn diff 資料；`capabilities.turnDiffs=false`。不從工具輸出或檔案清單推導 diff。
- Claude 不提供此共用 UI 所需的 fileSearch/review Codex API 路由；`capabilities.fileSearch=false`、`capabilities.review=false`，`state.turnDiffs=[]`，以上均不觸發 Codex API。
- 原生 `modelUsage` 可能加總本次 turn 內多次 API 呼叫，不能當成 latest context。其也不提供 session 累計 token 數；不建立 `total`，也不由額度 utilization 推估 context 使用率。

## 驗證

- `node --test test/claude-controller.test.mjs`：31/31 通過。
- 新回歸測試覆蓋 status/rate-limit 警告結構、latest message_start 請求 usage（排除 output 與結果回合加總）、未知累計用量不補值、Claude API 能力旗標，以及含 private thinking 字串不會出現在 state。
- 本次未送出真實模型回合，未重新啟動或部署服務；以既有隔離原生探測作來源證據，另以離線 controller 測試驗證轉換。

## 尚未驗證

- `system/status` 除 `requesting` 外的狀態分支，以及不同於探測所見 allowed + org-level overage rejected 的 rate-limit 狀態，未由此次探測驗證；未為其添加對應文案。
- 尚未觀察到可公開展示的原生 summary 或原生 turn diff，因此兩者維持明示不支援；如未來原生協定新增相關事件，需先取得實際 payload 證據再實作。
- 前端如何呈現 latest-native-request-input 與缺少 `total` 的 Claude tokenUsage 由共用 UI 處理；不得把其標成整回合 token 合計，也不得把缺值顯示成真實的累計 0。
