# 三核心共同記憶：私人正本與每回合接線

2026-10-27。分支 `feat/common-memory`（基底 `40efd50`），Opus 5.5 試做，待本輪 GPT-6 Astra xhigh 收尾找 bug；未合併、未部署。

## 本人裁決（摘要）

- 各核心原生記憶各自保留；跨核心共同偏好只有一份私人正本，專案規則留在專案正本。
- 專案不寫死誰當主腦、誰執行；模型分工偏好由 K 集中維護，當輪本人指定優先，必要授權與審查要求不因此取消。
- 分工正文是本人私人資料，不進公開 repo、測試 fixture 或程式常數；日常修改不需改碼、編譯或重啟。

## 做法

- 正本：`<state root>/agent-home/shared/common-memory.md`（正式機為 `vault/private-state/agent-home/shared/common-memory.md`，在 `.runtime` 內、不進 Git）。`src/common-memory.mjs` 在每個模型回合邊界同步讀取；不快取、不監看、不自動建檔，也沒有備援正文。
- `MODEL_ROLE_GUIDANCE` 改為 `MODEL_PROTOCOL_GUIDANCE`：只留協定與限制（不向使用者重述、手動選擇優先、等待不輪詢、派工層數、交接方式、審查不可冒充、Gemini 帳號規則、API 諮詢模型、不暗換模型／帳號／計費）。原常數中指名模型的分工偏好整段移到私人正本，沒有並存或讀檔失敗時的舊文。`luna_start` 工具說明中寫死的分工同步移除。
- 每核心只走一條路徑：

| 核心 | 入口 | 通路 | 去重與刷新 |
|---|---|---|---|
| GPT | 主房 turn/start（一般、通知、目標核對）與 turn/steer；K 的 GPT 工人；GPT 討論參與者 | `additionalContext.k_common_memory`，kind `application` | Codex 0.164.0 在 session 內記住上次的 map，同 key 值未變不再注入、變了才以 developer 訊息重送；每次送出的 map 會整個取代，所以 K 的每個 turn/start／steer 都附同一份。壓縮後在值裡加壓縮次數，讓原生重送一次。 |
| Claude | 主房一般送出與立即送入；K 的 Claude 工人（leaf 與巢狀）；Claude 討論參與者 | 回合 content 最前面一個 `<k_common_memory>` 文字區塊 | 內容版本、host 或壓縮次數改變才再附；送出確認後才記為已送。`/goal`、`/compact`、工人完成通知不加。 |
| Gemini | 主房每回合 `prepare()`；Flash 工人實際 runHome；Gemini 討論每次 ask | 另一個短 always-on 規則 `k-common-memory.md`，以原生 `@[K 共同記憶](路徑)` 引用正本 | agy 每回合是獨立 print 程序；規則每回合重寫。不放在長規則檔尾端，正文不複製。 |

- 讀不到（不存在、非檔案、UTF-8 無效、root 無效）時，三核心都收到同一句明示：共同偏好此刻未知，不得以對話中較早的版本或舊版內建分工代替；回合照常送出，不新增彈窗。
- Codex 的附加上下文單項約 1,000 token（以 4 bytes／token 估，約 4,000 bytes），超過會被原生中段截斷。正本超過時，K 不送被截的正文，改送「依賴偏好前先唯讀讀取正本全文」與路徑。Claude 與 Gemini 沒有這個單項上限，照送完整正文或引用。

## 原始碼依據（Codex 0.164.0，tag `rust-v0.164.0`）

- `codex-rs/core/src/state/additional_context.rs`：`AdditionalContextStore.merge` 只輸出值有變的 key，最後 `self.values = values`。
- `codex-rs/context-fragments/src/additional_context.rs`：application 產生 developer 角色 `<key>value</key>`，`MAX_ADDITIONAL_CONTEXT_VALUE_TOKENS = 1_000`，`truncate_middle_with_token_budget`。
- `codex-rs/utils/string/src/truncate.rs`：`APPROX_BYTES_PER_TOKEN = 4`。
- `codex-rs/core/src/compact.rs`：壓縮後的歷史以初始上下文、摘要與保留的使用者訊息重建，未見附加上下文片段，因此壓縮後重送一次。

## 驗證

- `npm test`：1,979／1,979 通過（新工作樹先 `npm ci`、`npm run build:ui`；未改介面，未重跑 UI 探針）。
- 新增 `test/common-memory.test.mjs` 與各入口測試：讀取／修改／刪除／非檔案／無效 UTF-8／無效 root、不自動建檔、Codex 位元組上限與完整指引、Claude 去重與壓縮後重送、Gemini 短規則與缺檔明示、GPT 主房一般／立即送入／未變／修改＋壓縮／刪除後通知回合（`toolOutput` 與空 `input` 保持）、K 的 GPT／Claude／Flash 工人、三核心討論。測試只用合成私人 root。

## 未驗證（待受控原生驗證）

- 真實 Codex 0.164.0 對 application 附加上下文的實際 prompt 位置、遠端壓縮是否保留、原生子代理（spawn／fork）是否繼承。
- agy 1.4.7 對 runHome／討論 home 的 `@[…]` 引用是否每個 print 程序重讀（2026-10-21 1.4.3 有 HOME 外引用成功的實測）。
- Claude 模型對回合內標記區塊的實際遵循；Claude 原生 Agent 子代理不經 K，未附共同記憶。

## 部署後讀回

- 部署後在三家各開一房送一句，讀回原生紀錄是否出現 `k_common_memory`／短規則；修改正本後下一回合是否反映、未改時不重複。
- 未寫 `.local/update-ready.json`；合併、部署與 push 由驗收後的流程決定。
