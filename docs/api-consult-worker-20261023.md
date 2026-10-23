# API 模型當唯讀諮詢子代理（2026-10-23）

## 本人決定

2026-10-23 本人在 Claude 聊天室明確要求：子代理直接開放可選討論用 API 連線的模型（DeepSeek 等）。
用途是本人要求時，請主代理去詢問該模型、取得不同訓練背景的看法（例：比特幣投資試驗的策略想法），不是分擔一般工作。
「AI 自動選擇」時 API 模型一律排最後；三家主代理只在本人明確要求諮詢該模型時才派。
此決定取代「討論專用 API 不進子代理／工人」的限制；仍不進主模型選單。

## 規格

1. 工人型號：API 模型以 `api:<connectionId>/<model>` 作為工人 model（connectionId 是既有 32 位十六進位連線 ID，model 為連線清單中的原樣 ID）。effort 依連線模型的 `efforts`，沒有時為 null。
2. 執行：沿用 `openDiscussionApiSession` 的唯讀工具迴圈（列檔、搜尋、讀檔、Exa 搜尋／讀頁），以工人專用系統提示呼叫一次 `ask(task)`，回答作為工人 output。不能改檔、執行指令或派工；outputFiles 為空並註明唯讀。沒有重送、換模或備援。
3. 派工入口：`luna_start`（Claude／Gemini 主代理）與 `gemini_start`（Codex 與自架主代理）都接受 `api:` 型號；生命週期、取消、完成事件送回原對話、K 重啟後 executionUnowned 與 Gemini／Claude 程序型工人一致。
4. 選單：子代理選單 GPT／Claude／Gemini 之後加「API」組放最後；主模型選單不出現 API 模型。
5. 選模指引：工單可派清單中 API 模型列最後並標示連線名稱與 API 計費；指引寫明只在本人明確要求諮詢時使用，不作 AI 自動選擇的一般選項或失敗備援。
6. 不新增按鈕、確認彈窗或費用提示；API Key 仍由既有 Windows 憑證讀取。

## 實作（2026-10-23）

- 實作：Gemini Flash 兩次派工都在開始前因「憑證身分缺失或不唯一」失敗，沒有任何寫檔（工作樹讀回確認）。本人指示 Gemini 登入修復進行中先不派 Gemini，改由 Claude Sonnet 5.5（high）依同一規格實作。
- 新增 `src/api-worker.mjs`：解析 `api:<連線ID>/<模型>`，執行前對照連線清單檢查模型與推理程度，以工人專用唯讀角色提示開一次 `openDiscussionApiSession` 並只問一次；取消會中止 HTTP 串流。
- `src/discussion-api.mjs`：新增選用參數 `instructions`，討論預設提示不變。
- `src/luna-bridge.mjs`、`src/luna-gateway.mjs`：`api:` 走程序型工人路線，Codex／自架主房的 `gemini_start` 也接受；`accountId`／`handoffFrom` 拒絕；K 重啟後未完成的 api 工單與 gemini／claude 相同標 executionUnowned、不重播。
- `src/unified-controller.mjs`、`src/conversation-controller.mjs`、`src/isolated-desktop.mjs`：`/api/models` 另給 `apiModels` 欄位；主模型 `models` 不含 API，只有子代理目錄合併。連線設定讀不到時只少 API 列並加警告。
- `src/worker-policy.mjs`：API 列可派、可手動保存；AI 自動選擇的候選不含 API；可派清單把 API 排最後並標「API 計費」；新增「只在本人明確要求諮詢時才選」的指示，`MODEL_ROLE_GUIDANCE` 加一條。
- `frontend/model-picker.jsx`：子代理選單最後多「API」群組。
- `src/desktop-controller.mjs`、`src/worker-watch.mjs`：Codex 主房完成送回與安靜通知包含 api。

## 驗證

- 完整 `npm test` 1848/1848（Opus 在工作樹重跑，含規則檔大小測試）。
- `npm run build:ui` 成功、`npm run test:ui` 50/50（Sonnet 執行；以 `PLAYWRIGHT_BROWSERS_PATH` 指向主工作樹既有 Chromium，只讀）。
- 新增 `test/api-worker.test.mjs` 13 項、`test/luna-gateway.test.mjs` 1 項、UI 探測加 API 群組斷言。
- 沒有呼叫真實付費 API；三家主房到完成送回只有程式閱讀與既有通用路徑，未另做整合實測。

## 複查

- Opus 5.5 已讀全部程式差異：改動集中、沒有新增按鈕／設定／備援；規則檔超過 24000 bytes（以 CRLF 計）由 Opus 縮短新條文修正。
- 待：與登入修復分支（`claude/auth-expiry-20261023`）合併後交 Sol 複查一次，再交 Codex 部署。

## 部署狀態

未部署、未 push。
