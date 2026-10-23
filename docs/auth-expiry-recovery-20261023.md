# 登入失效時 K 無法自行恢復：Claude／GPT 修正（2026-10-23，尚未部署）

## 問題

2026-10-23 約 19:24，Claude 聊天室失敗，顯示 `Failed to authenticate: OAuth session expired and could not be refreshed`。設定頁卻仍顯示「Claude 已連線／已確認 Claude.ai max 訂閱」，「登入 Claude 訂閱」按鈕停用，本人無法在 K 內重新登入，最後靠 K 外的 Codex 另行啟動官方登入才恢復。同時有兩項既有規則沒有落實：人用錯誤沒有轉成臺灣正體中文；同一錯誤同時出現在頂端警示與對話內。

本人要求：不要只叫本人重新登入，要找出 K 為什麼讓本人無法自行恢復；之後要能在 K 內自己恢復，不再靠外面的 Codex。討論中再要求：「K 如果授權失效……它就可以直接喚醒 Chrome，我自己平常的 Chrome 都有登錄啊，然後我自己手機拿起來，馬上就可以進行這個一個登錄……不管是 Cloud 還是 Codex，Gemini 都可以，這種方式是最好的。」Gemini 部分本人隨後表示「當初好像有設計好……已經是沒有問題了」，所以 Gemini 不改。

## 查證

- 失敗回合：使用者訊息 19:24:48.606 送出，350 毫秒後原生核心回一則 `model: "<synthetic>"`、`error: "authentication_failed"` 的助理訊息，接著是同文字、`is_error: true` 的 result。沒有模型呼叫或工具執行。原訊息與 8 個附件都保存在投影中。
- 19:26 以 K 專用 `CLAUDE_CONFIG_DIR` 執行原生 `auth status`：`loggedIn: false`。`.credentials.json` 的修改時間是 19:28:53，即本人經暫時恢復流程重新登入（只看時間，未讀內容）。20:07 核對：已登入 Claude.ai max。本人 20:06 已在原聊天室自行接續，本次未重送任何工作。
- 登入檢查與實際執行用同一個 `claude.exe`、同一個 `CLAUDE_CONFIG_DIR`；登入位置一致，不是根因。
- 用真的 `claude.exe` 2.1.309 在空的暫存登入位置跑 `-p --output-format stream-json`，輸出與事件相同：synthetic 助理訊息帶 `error: "authentication_failed"`（文字 `Not logged in · Please run /login`），再加同文字的失敗 result。
- 原生 Claude 會監看 `.credentials.json` 修改時間並重讀，且有 `.oauth_refresh.lock` 防止多程序同時換權杖；所以「多個程序互搶換權杖」的推測可能性低（已向本人更正）。這次換權杖失敗的真正原因（Anthropic 端）仍未知。

### 根因（Claude）

1. `src/claude-host.mjs` 的 `inspectClaude` 把成功結果快取 5 分鐘；回合登入失敗後沒有作廢。
2. 設定頁「刷新狀態」沒有要求略過快取，所以失效後的幾分鐘內怎麼刷新都拿到舊的「已連線」。
3. `frontend/account-connections.jsx` 以這份舊結果判定已驗證，因此停用登入按鈕。
4. 重複通知：synthetic 助理訊息進了對話，同文字的 result 又設成 `state.error` 進頂端警示。

### 三家比較

| | 狀態檢查 | 失效後 | 在 K 內重新登入 |
|---|---|---|---|
| Claude | 原生 `auth status`，但有 5 分鐘成功快取 | 舊結果顯示已連線 | 被停用（本次修正） |
| GPT／Codex | 每次新開 app-server 問 `account/read {refreshToken:false}` | 原生只看登入檔是否存在；權杖無法更新時錯誤是 `Your access token could not be refreshed ... Please log out and sign in again.`，登入檔仍在 → 顯示已連線，且 `codex-login.start()` 見 available 直接返回 | 同類問題（本次修正） |
| Gemini | 實際查官方 `/usage`；派工前超過 60 秒即重查 | 正確顯示未登入 | 可用「新增 Gemini 帳號」以同一帳號重登；本人決定不改 |

不採用 `account/read {refreshToken:true}`：主動換新會讓其他執行中的 Codex 程序手上的舊 refresh token 失效，反而可能製造同類失敗。

## 修正

### 第一批（Flash 實作，Opus 逐行複查，`b158277`）

- `src/claude-login.mjs`：`status({refresh})`，refresh 時先作廢檢查快取。
- `src/desktop-server.mjs`：`GET /api/claude/auth?refresh=1` 傳入 refresh。
- `src/claude-controller.mjs`：assistant 訊息 `error === 'authentication_failed'` 時作廢檢查快取；synthetic 訊息帶 `error` 時標記 `nativeError`（原文保留在紀錄）。
- `frontend/native-notices.mjs`、`frontend/app-common.jsx`：`nativeError` 訊息在對話內以中文呈現；兩句原生 Claude 登入失效原文也翻成同一段中文。
- `frontend/main.jsx`：對話內已有相同原文的 `nativeError` 訊息時，不再顯示同文字的頂端警示。
- `frontend/account-connections.jsx`：只有按「刷新狀態」時帶 `refresh=1`。

### 第二批（Opus 實作，`7f40d45`；Flash 第二次派工因 Gemini 帳號問題未開始，見下方）

- 新 `src/auth-expiry.mjs`：程序層級的登入失效標記與通知（與檢查快取同一層級）；`shared/codex-auth-error.mjs` 判斷 GPT 登入失效：`codexErrorInfo === 'unauthorized'`、任一 `httpStatusCode === 401`，或原生確切文字 `Your access token could not be refreshed` 開頭。
- `src/claude-controller.mjs`：非 replay 的 `authentication_failed` 通報 `claude`。
- `src/desktop-controller.mjs`：主聊天室回合以 GPT 登入失效結束時通報 `codex`；自架模型（`selfHosted`）排除。
- `src/codex-login.mjs`：有失效標記且登入檔仍在時，狀態回「GPT 登入已失效（原生核心無法更新登入權杖），請重新登入 GPT 訂閱。」、不算已驗證，登入按鈕可按；官方登入成功才清除。
- `src/desktop-server.mjs`：收到通報即啟動官方登入。Claude 的官方 CLI 會自己用預設瀏覽器開 loopback 登入（實測確認，完成後自動回傳、不用貼授權碼）；Codex 只回網址，K 以 `rundll32 url.dll,FileProtocolHandler`（與 Claude CLI 相同的開啟方式、引數陣列、不經 shell）只開通過 `officialCodexLoginUrl` 驗證的網址。已在等待的登入沿用、不重開頁面。
- `frontend/native-notices.mjs`：GPT 登入失效翻成中文；兩家文字說明「K 會嘗試在預設瀏覽器開啟官方登入頁」，沒出現時到設定按登入。

原本向本人提過在錯誤訊息旁加「重新登入」按鈕；改為自動開登入頁後不需要，未加人用按鈕。

### Sol 複查（`fd67fcd`）

GPT-6.1 Sol 只讀複查，回報 1 高、2 中、2 低：

| 項目 | 處理 |
|---|---|
| 高：`Your access token could not be refreshed` 搭配 `codexErrorInfo: other` 時，既有目標核對仍判為一般失敗，可能送出 `k_native_goal_recovery` | 採納：`recoveryErrorClass` 遇登入失效回 `hard`，不自動接續 |
| 中：其他聊天室較早開始的正常回合會清掉新的 GPT 失效標記 | 採納：只在官方登入成功時清除 |
| 中：開頁失敗仍記成已開，之後不再開；介面說「已開啟」不一定屬實 | 採納：開成功才記錄；文字改「會嘗試」 |
| 低：退訂後仍在等待的回呼可能開頁 | 採納：開頁前再查 `closing` |
| 低：同一程序多個 desktop 共用通知；啟動失敗留下訂閱 | 不改：正式 K 只有一個 desktop，只影響測試；記錄於此 |

Sol 也確認：Codex 子代理、背景房與自架排除正確；`rundll32` 無引數注入；三處 `unauthorized` 測試改為預期 `auth` 屬合理（原意是「明確代碼優先」），並依建議補上 stream wrapper 搭配 `unauthorized` 的正向斷言與目標核對案例。Claude 的失效標記沒有讀取者，屬無害多餘狀態。

### 測試調整

`test/native-notices.test.mjs` 原本有三處斷言 `unauthorized` 不被改寫；現在 `unauthorized` 有自己的登入失效說明，改為預期 `auth`，並從兩個「明確代碼不套用串流說明」的迴圈移除 `unauthorized`（其餘代碼不變），另加正向測試。

## 驗證

- 完整 `npm test`：1847/1847（Sol 修正後）。Flash 環境曾報 `claude-host` 1 項失敗，是其執行環境找不到全域 `claude.exe`；主線與本分支在一般環境都通過。
- `npm run build:ui` 後 `npm run test:ui`：Sol 修正後 50/50（語音探針依舊例帶入正式 Whisper 路徑、指定專案 Chromium）。中間兩次各 49/50（`remote-reopen`、`voice-room-switch` 各在 0.5 秒失敗、單獨跑通過），查到當時另一工作樹的整套介面探針同時在跑（21:46 起），互搶測試資源；等它結束後重跑 50/50。
- 格式：本次改到、且主線原本符合 Prettier 的檔案都已格式化；主線原本就不符合的檔案只保留本次差異。

### 實機驗收（2026-10-23 21:17–21:37）

用分支程式另開測試 K（埠 47911，獨立狀態、獨立 `CLAUDE_CONFIG_DIR`／`CODEX_HOME`、Antigravity 指向不存在的路徑以免在正式機啟動 agy），真的 `claude.exe` 2.1.309、`codex.exe` 0.164.0，本人親自登入。

| 步驟 | 結果 |
|---|---|
| Claude 首次登入 | 按「登入 Claude 訂閱」，官方 CLI 自動在本人 Chrome 開登入頁，完成後自動回傳；狀態「已確認 Claude.ai max 訂閱」 |
| Claude 使用 | Haiku 聊天室回覆 `OK` |
| Claude 失效 | 官方 `claude auth logout` 登出測試位置後在同房送出 → 原生 `Not logged in`、`authentication_failed`；K 自動啟動官方登入（未按任何按鈕），本人 Chrome 跳出登入頁 |
| 畫面 | 對話內一次、中文；頂端警示 0；設定頁「Claude 未連線」、等待官方登入 |
| Claude 恢復 | 本人登入後狀態回已連線；**同一聊天室不重開**直接送出 → `OK`；未自動重送 |
| GPT 登入與使用 | 官方網址由與 K 相同的方式開到本人 Chrome，登入 ChatGPT Plus；Sol 聊天室回覆 `OK` |
| GPT 失效 | 官方 `codex logout` 只刪本機登入檔，執行中程序記憶體內的權杖仍有效，照常回覆 `OK`，**無法產生真的 401**。改由測試腳本發出 K 內部失效通知（只模擬「收到失效錯誤」這一步），之後 K 自動啟動官方登入並在本人 Chrome 開 OpenAI 登入頁，本人登入成功，狀態回已連線，原 GPT 聊天室重開後回覆 `OK` |
| GPT「登入檔還在但已失效」 | 已登入狀態下再發通知 → 設定頁顯示「GPT 登入已失效（原生核心無法更新登入權杖）…」、登入按鈕可按；取消登入後標記仍保留 |

驗收中發現的測試腳本問題（不是 K）：測試 K 重開時腳本重複寫入 `[windows]` 到測試用 `config.toml`，Codex 判定設定無效，畫面一度顯示「無法讀取 Codex 登入狀態」；修正腳本後正常。最後一次測試登入在本人完成前已被取消，本人頁面顯示 `ERR_CONNECTION_REFUSED`，屬預期。

結束後兩個測試登入位置都以官方指令登出，測試資料夾移入資源回收筒。截圖與腳本（`run-test-k.mjs`、`drive.mjs`、`probe-codex.mjs`）存於 `.runtime/archive/auth-expiry-acceptance-20261023/`。

## 規則更新

`AGENTS.md` 第三節新增：Claude／GPT 登入失效時，K 自動以預設瀏覽器開官方登入頁（只開網址，不讀或控制日常 Chrome），不重送；設定頁刷新須重查。第七節「Claude 通知以正體中文」改為「人用錯誤以臺灣正體中文呈現（原文留後台）」。為維持 24,000 bytes 上限，移出四段歷史註記（原文如下，非現行規則）：

- 「GitHub `paul800901/K-harness` 自 2026-10-09 公開」→「已公開」
- 新對話預設最高權限括號內「本人 10-22 決定，」
- 「（10-06 的 Luna→Sol 容量接續已撤銷）」
- 「DeepSeek／Pi 路徑已移除，」與「Esc 停手屬日後的 Computer Use。」

## 另外發現：Gemini 帳號同步被拒（已另案修正，見 [gemini-identity-agy146-20261023.md](gemini-identity-agy146-20261023.md)）

第二批派 Flash 時，K 在派工前的帳號核對失敗：「憑證身分缺失或不唯一，拒絕操作」。工作沒有開始、工作樹沒有變更、未重送。12:53（UTC，臺灣 20:53）五個帳號實查都成功，但全部標記 `requiresActivation`，表示憑證助手讀不出**目前 Antigravity 登入**的身分（`id_token` 缺少或無法解析），於是拒絕把它覆寫成要用的帳號。推測是 agy 在換新權杖時改寫了登入紀錄而沒有保留 `id_token`；要證實需檢查登入紀錄欄位結構，涉及讀憑證，未做。根因後經查證是 agy 1.4.6 不再保存 `id_token`；以「新增 Gemini 帳號」重新登入無法恢復（已更正先前建議）。

## 審核與部署狀態

- 第一批 Flash 程式：Opus 5.5（主代理）逐行複查。第二批與 Sol 修正：Opus 5.5 實作，Sol 只讀複查並逐項處理。
- 未部署、未合回 main、未 push。另一聊天室（API 連線當子代理，分支 `claude/api-worker-20261023`）留言：本人要求兩批合併後只複查一次、只部署一次；本分支保留待合併，是否照辦由本人決定。
- 東區未更新。
