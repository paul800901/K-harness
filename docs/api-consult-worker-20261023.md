# API 模型當唯讀諮詢子代理（2026-10-23，南區已部署）

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
- 本人決定登入修復先單獨部署（`0cf673e`，2026-10-23 22:27），本批之後再部署；部署交由 K 外的 VS Code Claude 執行（Codex 額度已用完）。

### 合併 main 與 Astra 複查（Opus 接手，2026-10-23）

- 更正：先前在登入修復聊天室說本分支「已接上新 main、測試 1848 項全過」是判讀錯誤；本分支當時接在 `3fceed6`，那 1848 是本分支自身的測試數。直接部署會退回已部署的登入修復與 Gemini 修正。
- 合併 `main`（`dadf528`）為 `5c55728`：只有 `docs/development-log.md` 衝突（兩邊條目都保留）；`AGENTS.md` 自動合併後以 CRLF 計 24,011 bytes，超過上限。本條規則改寫為「只讀聊天室工作區；本人明確要求諮詢且指定型號才派，不作自動選擇、預設或備援」，並刪除第九節「（平行比較、交叉審查、多人討論）」與「現行有效，」兩段說明文字，CRLF 23,981 bytes。合併後完整測試 1862/1862。
- GPT-6 Astra（xhigh）只讀複查，3 高 1 中：

| 項目 | 處理（`d916866`，Opus） |
|---|---|
| 高：API 工人沿用討論讀檔，可用絕對路徑讀工作區外檔案並送往外部 API（已以模擬重現） | `createDiscussionReader` 加 `confined`，解析後路徑必須在聊天室工作區內；API 工人強制開啟，討論參與者維持原本廣泛唯讀 |
| 高：分支未含已部署基準 | 已合併（上一項） |
| 高：連線變更保護只看討論，API 工人執行中改連線可能形成「舊網址＋新金鑰」 | `discussion-api-connections` 新增 `lease()`：工人執行期間禁止修改，修改中不能開始工人；`api-worker` 的 `run()` 取得並在 finally 歸還 |
| 中：保存 API 選擇後，省略 model 會沿用 API 模型產生費用 | `luna-bridge.start` 省略型號且預設為 API 時拒絕；`worker-policy`／`luna-gateway` 指引改稱「API 諮詢模型」，非一般預設 |

- 連線忙碌訊息改為「討論正在使用 API 連線或 API 子代理執行中；請等結束後再修改。」，保留既有測試斷言。修正中途曾因既有測試的假連線缺少 `lease()` 使完整測試卡住超過 10 分鐘，補上後恢復。
- 修正後完整測試 1866/1866（新增：工作區外讀取被拒而討論不受影響、工人持有期間不能改連線與修改中不能開始、成功與失敗都歸還、省略型號不沿用 API；既有「手動 API 預設」測試改為驗證新指引），`npm run build:ui` 後 `npm run test:ui` 50/50。
- Claude Fable 5.1（high）獨立第二審（Codex 額度用完，改由 Fable）：結論可部署。四項修正確認完整；以暫存目錄實測 13 種路徑（大小寫、8.3 短檔名、UNC 管理共用、`\\?\` 前綴、junction、`..`、磁碟機相對路徑等）全部擋在工作區外，`list_files` 遞迴與 `search_files` 都經同一檢查；lease 在所有失敗與取消路徑都會釋放；沒有任何會在本人未要求時派出 `api:` 工人的自動路徑；測試未被削弱、無過度工程化。三項低風險：

| 項目 | 處理（`98f155d`） |
|---|---|
| 讀不到內容，但可由錯誤訊息差異探測工作區外路徑是否存在 | 採納：限制模式下先以字面路徑判斷，工作區外一律回同一錯誤（realpath 後檢查保留） |
| 明確給型號但省略 effort 會沿用已保存的 effort | 採納：API 工人也必須明確給 effort（無推理設定傳 null） |
| 長時間推理只在輸出文字時記活動，可能多發一則「久無活動」通知 | 不改：只是通知，不會停止或重送 |

- 修正後完整測試 1867/1867（新增：不存在的外部路徑也回同一錯誤、省略 effort 被拒）；本次只改後端，介面沿用前一輪 50/50。
- 本人表示 Codex 有點數可繼續用，後端最後抓錯仍交 GPT。GPT-6 Astra（xhigh）部署前最後一輪（`c3bb584`）：確認 confined、lease、省略 model／effort 被拒與合併完整；另找到 1 項既有高風險與 2 項本分支中風險，全部採納（`7cfacd8`）：

| 項目 | 處理 |
|---|---|
| 高（既有，非本分支引入）：更換網址時先存新金鑰、後存設定；設定寫入失敗會形成「舊網址＋新金鑰」 | 換金鑰前先把該連線存成不可用（`keyConfigured: false`），金鑰與設定都存好才恢復；`credentials()`、`discover()` 拒絕未完成的連線 |
| 中：要求明確傳 effort，但 API 指引沒告訴主代理已保存的 effort | `worker-policy`、`luna-gateway` 的 API 指引補上已保存的 effort |
| 中：串流中途失敗會遺失已收到的部分回答 | 失敗時把部分回答放進 `error.workerResult`，仍標失敗、不重送 |

- 修正後完整測試 1869/1869（新增：金鑰存不成時連線維持不可用且不送舊網址、失敗保留部分回答、指引含已保存 effort）。後端修正，介面未變，沿用 `d916866` 的 50/50。

## 部署狀態

- 分支快轉合回 `main`（`e98aeb6`），由 K 外的 Codex 部署。
- **第一次嘗試（2026-10-23 23:59，臺灣時間）停在閒置確認**：仍有 22:48 起的 `npm test`／`node --test`／`api-worker` 測試程序。查證為 Opus 在工作樹跑完整測試時，`api-worker` 測試因假連線缺 `lease()` 卡住，Opus 停掉外層指令但子程序殘留；核對命令列與啟動時間後由 Opus 結束這 5 個測試程序（不是 K、沒有工作在進行）。Codex 依規則停下、未做任何變更。證據：`.runtime/archive/deployment-7cfacd8e1a7c45de9070607ef5c653de18310abb/deployment-report.md`。
- **第二次（2026-10-24 00:04:51–00:06:33）**：`Update-K.ps1 -Ref 7cfacd8e1a7c45de9070607ef5c653de18310abb`，結束碼 0，更新器測試 **1869/1869**。讀回全部通過：API 工人、`lease`、工作區讀取限制、`keyConfigured: false`、明確 effort；前次登入修正、`id_token_email` 與 UTF-8 BOM 保留；建置介面含 API 群組；帳號、對話、工作區、瀏覽器輸出、API 連線設定檔、遠端設定與工作階段、語音路徑未變。退版三份：`before-1792731673637`、`before-1792765732003`、`before-1792771586476`（previous），最舊者進資源回收筒。
- **Codex 停在 push 前**：Windows 憑證儲存區（LocalMicrosoftCredentials）31 個檔案中 1 個的修改時間在 00:05:18 變動（更新器執行期間）。依限定只比對存在與時間、未讀內容，無法證明 K 的 API 金鑰未動。Opus 查證：K 部署時未執行；測試都用假的憑證儲存，不寫 Windows 憑證；更新器會先 `git fetch origin --tags`，但事後重做 fetch 與帶登入的 push 都沒有再改到該檔，**來源仍未查明**。API 連線設定檔（DeepSeek、GLM 兩個連線，皆標示已設定金鑰）自 10-22 後未變。
- push 與本機金鑰狀態無關，秘密掃描無命中，Opus 於 2026-10-24 push，遠端 `refs/heads/main` 讀回 **`e98aeb65549298914fe728f46e356596c447dbfd`**。
- 證據：`.runtime/archive/deployment-7cfacd8e1a7c45de9070607ef5c653de18310abb/run-20261024/`（不進 Git）。
- 未做：真實 API 諮詢的端到端實測（同時可確認金鑰可用），待本人同意（會產生少量 API 費用）。東區未更新。
