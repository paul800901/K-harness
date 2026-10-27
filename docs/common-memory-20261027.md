# 三核心共同記憶：私人正本與每回合接線

2026-10-27。基底 `40efd50`，Opus 5.5 試做，Astra xhigh 補修通知刷新與原生正本指標；真正 Opus 5.5 已複查 GPT 補丁，沒有剩餘必修，Astra 最後採納。程式版本 `c40ed70071ca42883f87fc156bf27975da23a029`，已合回 main 並備好既有更新按鈕；尚未部署，原生讀回依下列邊界接續。

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
| Claude | 主房一般送出、立即送入與工人完成通知；K 的 Claude 工人（leaf 與巢狀）；Claude 討論參與者 | 回合 content 最前面一個 `<k_common_memory>` 文字區塊 | 內容版本、host 或壓縮次數改變才再附；送出確認後才記為已送。`/goal`、`/compact` 保持原生控制命令；通知保留事件正文與 UUID 語意。 |
| Gemini | 主房每回合 `prepare()`；Flash 工人實際 runHome；Gemini 討論每次 ask | 另一個短 always-on 規則 `k-common-memory.md`，以原生 `@[K 共同記憶](路徑)` 引用正本 | agy 每回合是獨立 print 程序；規則每回合重寫。不放在長規則檔尾端，正文不複製。 |

- 讀不到（不存在、非檔案、UTF-8 無效、root 無效）時，三核心都收到同一句明示：共同偏好此刻未知，不得以對話中較早的版本或舊版內建分工代替；回合照常送出，不新增彈窗。
- Codex 的附加上下文單項約 1,000 token（以 4 bytes／token 估，約 4,000 bytes），超過會被原生中段截斷。正本超過時，K 不送被截的正文，改送「依賴偏好前先唯讀讀取正本全文」與路徑。Claude 與 Gemini 沒有這個單項上限，照送完整正文或引用。
- 原生續行與子代理另保留短正本指標，不複製正文：GPT 放既有 developer instructions（K GPT 工人保留工作區有效設定後追加）；Claude 放既有 append-system-prompt，允許原生 Agent 的主房另用原生 `--append-subagent-system-prompt`。壓縮後模型可依指標讀全文，下一個 K 回合仍按上表刷新。共同提示明確取代過時固定模型分工，保留原生權限、專案授權／資料邊界／完成與審查門檻。

## 原始碼依據（Codex 0.164.0，tag `rust-v0.164.0`）

- `codex-rs/core/src/state/additional_context.rs`：`AdditionalContextStore.merge` 只輸出值有變的 key，最後 `self.values = values`。
- `codex-rs/context-fragments/src/additional_context.rs`：application 產生 developer 角色 `<key>value</key>`，`MAX_ADDITIONAL_CONTEXT_VALUE_TOKENS = 1_000`，`truncate_middle_with_token_budget`。
- `codex-rs/utils/string/src/truncate.rs`：`APPROX_BYTES_PER_TOKEN = 4`。
- `codex-rs/core/src/compact.rs`：壓縮後的歷史以初始上下文、摘要與保留的使用者訊息重建，未見附加上下文片段，因此壓縮後重送一次。
- `app-server/src/request_processors/turn_processor.rs`：`toolOutput` 或 user input 均經同一 `TurnInputRequest.with_additional_context`，`turnTrigger` 同時保留。
- `core/src/agent/control/spawn.rs` 的 full-history 過濾保留共同 developer 片段；`agent/child_config.rs` 的 fresh child 繼承 developer instructions。明確的自訂 role 或 multi_agent_v2 子代理指示可覆寫，K 不改這些原生設定。
- `core/src/compact_remote_v2.rs` 的保留取決於 `retain_client_developer_messages`（原生預設 false）及保留預算；local 與 remote 安裝壓縮歷史都重建 initial context。不能把「下一個 K 回合重附」當成內部續行已附正文。
- Claude [官方子代理文件](https://code.claude.com/docs/en/sub-agents#write-subagent-files) 說明非 fork 子代理的獨立 prompt 及 `--append-subagent-system-prompt`；選定 2.1.310 執行檔內確有此旗標定義。fork 沿用主房 prompt。

## 驗證

- `npm test`：1,979／1,979 通過（新工作樹先 `npm ci`、`npm run build:ui`；未改介面，未重跑 UI 探針）。
- 新增 `test/common-memory.test.mjs` 與各入口測試：讀取／修改／刪除／非檔案／無效 UTF-8／無效 root、不自動建檔、Codex 位元組上限與完整指引、Claude 去重與壓縮後重送、Gemini 短規則與缺檔明示、GPT 主房一般／立即送入／未變／修改＋壓縮／刪除後通知回合（`toolOutput` 與空 `input` 保持）、K 的 GPT／Claude／Flash 工人、三核心討論。測試只用合成私人 root。
- Astra 修補後入口與邊界測試 248／248、完整 `npm test` 1,981／1,981 通過；隔離的原生 Codex 0.164.0 `debug prompt-input` 實際產出 developer 正本指標，沒有模型推理。這不代替 additionalContext、壓縮及子代理完整端到端驗證。
- 真正 Opus 5.5 獨立複查 `97f4105..20b8e9a`，未發現具體阻擋，沒有另改程式；重跑相關入口加討論測試 254／254 通過。保留 `config/read` 逾時的保守未知判斷，不為無害空行或既有 safe-mode 邊界新增分支。Astra 已依證據採納，可以準備更新。
- 主代理讀回三份實際報告與原始測試紀錄，檢查本批公開差異未見憑證模式、私人真實路徑或共同正文。這不是整個儲存庫歷史的秘密審查。Gemini 與 Opus 均已有本人最新決定的通知回執。

## 未驗證（待受控原生驗證）

- Codex additionalContext、原生子代理及壓縮的行為已有對應版本原始碼依據；尚未實跑完整模型回合、子代理或壓縮。自訂 role／multi_agent_v2 覆寫是明確例外。
- agy 1.4.7 對 runHome／討論 home 的 `@[…]` 引用是否每個 print 程序重讀（2026-10-21 1.4.3 有 HOME 外引用成功的實測）。
- Claude 模型對回合內標記區塊、原生 Agent 短指標的實際遵循；不把旗標存在當成已執行原生 Agent。
- Gemini 原生子代理的繼承及 always-on 總預算尚未查明；短 wrapper 避開單一長檔尾端，不能因此保證總預算不裁切。共同提示要求原生派工交接帶正本路徑，仍待受控讀回。
- CaseAgent AGENTS 的 agy 原生 24,000 bytes 截斷不屬本次已解決項目；正式工作仍須按專案正本讀完整入口及所選 SOP，不得以截斷版作授權或完成判斷。沒有縮減或複製臨床規則。

## 部署後讀回

- 部署後在三家各開一房送一句，讀回原生紀錄是否出現 `k_common_memory`／短規則；修改正本後下一回合是否反映、未改時不重複。
- 本批 source 已完成審查並合回 main；`.local/update-ready.json` 已指向上述程式版本，讓本人在 K 全部閒置後按既有「更新」。讀回正式 runtime 仍為 `04d0b96`，尚未部署或 push。K 內不停止或部署自身；實際部署、原生讀回及遠端 push 狀態另記，不以準備好更新冒充已部署。
