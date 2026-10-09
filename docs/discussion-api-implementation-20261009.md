# 討論專用 API 參與者（2026-10-09）

## 本人定案與授權
- API 模型只加入平行比較、交叉審查、多人討論；不加入一般主模型或子代理／工人。原生三家訂閱、登入、模型與派工不變。
- 參與者可自主列檔、搜尋、讀取本次工作區原始資料，不只依賴主持摘要；唯讀，不改檔、不執行指令、不派工。不是全磁碟權限，排除憑證、內部執行狀態與連結／接合點。
- 本人理解並接受討論材料送到選定 API，不增加反覆資料外送確認。金鑰仍不能當作材料外送或發布。
- 設定保留自行填 API Key 的入口。本人明確要求必要驗證與真正 Opus 複查後直接更新關閉的 K，並推送公開 Git；不更新東區、不恢復／重播工作。
- 本次不讀用舊 API 金鑰、不建立真實 API 連線、不產生 API 費用；真實 Key 由本人後續自行填寫。
- 本人追加要求三種討論中的訂閱與 API 模型加強網頁搜尋；先查現有原生能力與開源接法，不只靠舊知識或主持摘要。

## 最小完整接線
- `frontend/discussion-controls.jsx`：原生訂閱分組與 API 連線分組；組合識別避免同名模型碰撞，API 目錄不進入主模型／工人目錄。
- `frontend/discussion-api-settings.jsx`、CSS、`frontend/main.jsx`：設定中新增連線名稱、Base URL、密碼式 Key、自填模型 ID／顯示名稱，以及明確點按查詢官方模型。可先保存連線再查目錄，不編造模型；遠端不提供 Key 管理。
- `src/discussion-api-connections.mjs`、`scripts/discussion-api-credentials.ps1`：非秘密設定放現有私人 state `.local`；金鑰只放該 state 路徑命名的 Windows 憑證管理員，經 helper stdin 傳入、不回傳前端、不列命令列或 Git。不枚舉其他憑證。網址變更須重填該服務 Key，不自動把原 Key 送往新服務。
- `src/discussion-api.mjs`：OpenAI 相容 Chat Completions 串流與工具呼叫；每位參與者有獨立訊息歷史，保留供應商工具回合必要的 reasoning_content，不呈現原始推理。無固定讀取次數、無自動重送、換模或付費路徑 fallback。錯誤只呈現安全狀態，不回顯原始供應商錯誤本文。
- `src/discussion-read-tools.mjs`：只提供 `list_files`、`search_files`、`read_file`，相對路徑、UTF-8 原文與行號；PDF／DOCX 用既有相依擷取文字，非 OCR／圖片／版面。資料本身不擴張工具權限。
- `src/discussion-web-tools.mjs`：API 參與者另有 `web_search`、`read_webpage`，固定接官方 Exa 匿名 MCP；無搜尋 Key、安裝、瀏覽器登入、agent_run、自動重送或轉付費。搜尋附查證目標，讀頁可調抽取範圍，結果保留來源與查詢時間並說明供應商摘要／快取／篇幅限制。
- `shared/discussion.mjs`、`src/discussion-native.mjs`：共用搜尋指引，遇目前資訊／不確定事實先查、重點讀原始頁、查反面證據及日期，回答附直接來源並分查證／推論／未知。Codex 討論明確用 live search；Claude 保留原生 WebSearch／WebFetch；Gemini 修正原生網頁暫存正文被 K 的全域讀檔 deny 擋住的缺口，改用空的討論 cwd，明確允許本次 brain 暫存目錄，原工作區在 cwd 外依原生 Ask／headless 拒絕，寫檔／指令／MCP 拒絕不變。
- `src/conversation-controller.mjs`、`src/isolated-desktop.mjs`、`src/desktop-server.mjs`、`src/remote-access.mjs`：接既有 discussion session seam、主持與停止流程，API 設定走既有桌面認證／明確操作；討論中不變更連線，遠端可選已設定的 API 參與者。

## 協定與限制
- 目前支援 DeepSeek 與自訂 OpenAI 相容 **Chat Completions + streaming + function tools**。不是 Anthropic/Gemini 原生 API 接頭；只有可用工具呼叫協定的模型才可自主讀取。
- 模型 ID 取本人輸入或 `/models` 實際回傳；名稱、effort／context metadata 依實際目錄，不以口語例子編造型號。不回傳 metadata 時不自造推理選项。設定完成不代表已驗證服務或 Key 有效。
- API 討論不是把原生核心換成 API；主持與既有 native 討論不因此取得新讀檔能力。圖片影音維持原有討論限制。
- 上下文／輸出限制依供應商；截斷、異常 EOF、限流／認證失敗明確失敗，保留 partial，不自動續送。
- 金鑰保管限目前 Windows 使用者及 K state 命名空間；這不是對同一 Windows 使用者的 OS 隔離承諾。
- Exa 匿名入口免費但限流，不保證服務長期不變、無限額度或完整／即時抽取；失敗須說未取得證據。原生搜尋品質、網頁可讀性與供應商限制也不由 K 保證。不硬性要求穩定的純邏輯問題搜尋，不以提示詞宣稱搜尋能力已提升。

## 原生與開源調查、實際證據
- [Codex 官方設定](https://developers.openai.com/codex/config-basic)：cached 與 live 分開；本批原生候選實際出現 webSearch 與 openPage，而非只有回答宣稱。
- [Claude 原生工具](https://code.claude.com/docs/en/tools-reference)：搜尋找來源，WebFetch 讀正文。本批真正 Opus 實際呼叫兩者。
- [Antigravity CLI](https://www.antigravity.google/docs/cli/features/)：本批 CLI 1.3.1、實際目錄的 Flash 3.8 low 出現 search_web、read_url_content、view_file。初次探測缺少目錄 variant，零模型回合即被拒絕；映射實際目錄後才測能力，不改模型 fallback。該次正文讀取被 K deny 拒絕，保留失敗證據，Ask 與 Allow 的優先序也不能做例外，保留兩次失敗；空 cwd 修後新原生回合成功 search_web／read_url_content／view_file，零工具錯誤。另用假原工作區檔案證實 headless 拒絕（該回合無最終文字，未冒充成功）。此網站部分原生抓取只有 HTML shell，模型明示用搜尋索引核對；工具接通不是完整正文／即時性的保證。
- [OpenCode 搜尋接線](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/websearch.ts)、[Exa 官方開源 MCP](https://github.com/exa-labs/exa-mcp-server)：採相同固定 hosted 入口，不照搬其供應商抽選／自動備援。2026-10-09 讀實際 tools/list：搜尋為 query + objective，讀頁為 urls + maxCharacters；不是照舊文件猜參數。
- [Exa 官方權限／費用說明](https://exa.ai/docs/get-started/exa-mcp#authentication)：匿名免費限流；OAuth／Key／agent_run 是另一條路，本批未接。已直接用候選 K 的 reader 實測公開官方搜尋及正文，兩者成功、無 Key、未呼叫模型 API。
- [Brave 官方 MCP](https://github.com/brave/brave-search-mcp-server)、[Tavily 官方 MCP](https://github.com/tavily-ai/tavily-mcp) 需另外搜尋 Key；[SearXNG MCP](https://github.com/ihor-sokoliuk/mcp-searxng) 需既有自架搜尋實例。不為本次安裝／維護服務或增加付費設定；先前詢問兩者偏好已被不需它們的官方匿名入口取代。

## 驗證與正式狀態
- 假資料：本機 HTTP 假 API 實際收取 Chat Completions，要求讀原文，再收到工具原文與行號；追加問題保留必要 reasoning_content。
- 隔離測試涵蓋秘密不入設定／回傳、目錄／metadata、名稱修改、active mutation、同名 API／native 路由、超範圍／秘密／junction／Windows ADS／裝置路徑拒絕、工具分片、未知寫工具拒絕、停止中斷、錯誤與截斷不重播。
- 真 Windows **假 Key** 的保存、精確讀回、移除及不存在讀回已通過；未操作任何原有真實 Key。
- 完整回歸、UI、真正 Opus 複查、固定來源建置及正式更新／Git 精確讀回將在收尾追加；未取得證據前不宣稱完成。私人執行證據留本機 `.runtime/discussion-api-implementation-20261009`，不發布。

## 官方協定依據
- [DeepSeek 模型目錄](https://api-docs.deepseek.com/api/list-models/)
- [DeepSeek tool calls](https://api-docs.deepseek.com/guides/tool_calls/)
- [DeepSeek thinking/tool reasoning 保留規則](https://api-docs.deepseek.com/guides/thinking_mode/)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
