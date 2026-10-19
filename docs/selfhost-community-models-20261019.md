# 自架社群模型主代理接入（2026-10-19）

## 範圍與狀態

本人要求：下載社群明確標示 uncensored／abliterated（或次選低拒答）的 Qwen 27B、Qwen 35B-A3B 與同級非 Qwen 模型，接成 K 的自架主代理；不是工人，不加小說白名單或特殊工具禁用。執行者為真正 Claude Opus 5.5、effort high（Claude Code 2.1.301、claude.ai 訂閱、apiProvider firstParty，身分核對檔在桌面比較資料夾），由父代理（GPT 主代理）分派、獨立驗收與正式收尾。

**目前狀態：四個 GGUF 均下載完成，主代理獨立核對大小與完整 SHA256 相符；程式已合回 main、正式程式與私有接線設定已套用。K 依本人已關閉狀態保持關閉，未進行啟動後的 live 介面讀回。模型實測由本人親自進行，本批沒有任何模型推論驗收。** 本人中途覆寫「下載完、接線完後要親自測試；先別跑模型」，父代理已停止執行中的直接測試並卸載模型、停止 LM Studio 服務；被停止的嘗試不作驗收（見〈已停止的嘗試〉）。

## 最小接法與差異

沿用 [Gemma 主代理](gemma-main-agents-20261016.md) 的同一條鏈路：K 聊天室 → Codex 0.163 原生核心（各自無訂閱憑證的 home）→ `src/gemma-responses.mjs` 工具格式轉換 → LM Studio 本機 `:1234/v1`（或雲端 SSH 本機轉送）。沒有新增代理迴圈、框架、備援、自動載入模型或雲端控制。

- `src/gemma-main.mjs`：K 私有狀態 `.runtime/gemma-main.json` 新增可選 `selfHosted` 清單。每筆需 `id`（小寫英數與 `.-_`）、`label`、`location`（`local`／`cloud`）、`model`（端點的模型 ID），可選 `baseUrl`（預設依地點 `:1234`／`:18080`）與 `contextWindow`（預設 32768）。每筆得到穩定 K ID `selfhost-<id>/<model>`、獨立 home `.runtime/selfhost-<id>-home`、自己的格式轉換連線與原生模型目錄；顯示名稱為「實際名稱 · 本機／雲端」，不冒用 Gemma 或 GPT。既有 `gemma-local`／`gemma-cloud` 的 ID、home、預設值與歷史完全不變。設定錯誤時與舊行為相同：只保留兩個 Gemma 列為不可用，其他三家不受影響。原生 provider 名稱由 "Gemma" 改為 "K self-hosted"（provider ID 仍為 `k_gemma`，舊對話不受影響）。完整 K ID 限 256 字，對齊聊天室保存的模型長度上限。
- `shared/model-provider.mjs`：`gemmaConnection()` 也辨識 `selfhost-<id>/`，回傳的連線鍵與 `slot` 相同；內部 provider 仍為 `gemma`（Codex 核心、無訂閱），因此工人／討論清單排除、主代理路由、分支與 accountType `self-hosted` 都沿用既有邏輯，不做 rename／migration。`src/unified-controller.mjs` 的 controller map 以 slot 為鍵，每個模型各自一個 controller，同端點不同模型不共用 controller、home 或轉換連線；跨連線換模型照舊拒絕並要求新對話或明確交接。
- 前端：提供者分頁與來源標籤由「Gemma」改為「自架」；自架模型選單分組加 Qwen／Mistral（比對改為名稱後不接字母，讓 `Qwen3.8` 能歸組），其他提供者分組結果不變。錯誤訊息改為「自架模型」用語。
- `src/worker-policy.mjs`：送給模型的工人指引改寫成 self-hosted 用語，避免對 Qwen／Mistral 主代理說它是 Gemma；路由內容不變。
- `AGENTS.md`：第三、五節的 Gemma 例外最小擴充為本人授權的自架社群模型主代理，明訂不放寬其他 API 計費或權限規則。

程式 commit：`ad3a922`（主功能）、`10bb983`（複查修正：移除清單 16 筆與名稱 120 字的任意上限；改檢查完整 K ID ≤256）。

## 模型與下載驗證

父代理以一次性 Python 批次（`k-local-model-download-20261019.py`，固定 revision、公開 HF、只下 GGUF、不執行模型卡程式）下載到 LM Studio 既有儲存根 `D:\Qwen3.5-9B Abliterated\models`（舊目錄名不搬）。清單、模型卡與狀態在桌面 `本機無審查模型比較-20261019\模型下載與驗證.json`。皆 Q4_K_M，合計約 69.1GB。

| 模型 | revision | 大小（bytes） | SHA256 | 最終下載驗收狀態 |
| --- | --- | --- | --- | --- |
| windowsxp811203/Qwen3.8-27B-Abliterated-GGUF `Qwen3.8-27B-Abliterated-Q4_K_M.gguf` | `efb07ba…` | 16810715008 | `a57423a5…0e412` | 下載完成；主代理獨立核對大小／SHA256 相符；實際鍵 `qwen3.8-27b-abliterated` |
| wangzhang/Qwen3.6-35B-A3B-abliterated-GGUF `Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf` | `8709e4d…` | 21166757728 | `b1995222…44abb` | 下載完成；主代理獨立核對大小／SHA256 相符；實際鍵 `qwen3.6-35b-a3b-abliterated` |
| bartowski/cognitivecomputations_Dolphin-Mistral-24B-Venice-Edition-GGUF（原模型 dphn/Dolphin-Mistral-24B-Venice-Edition，以 uncensored 為訓練目標） | `708d0be…` | 14333909376 | `2740d59c…27392` | 下載完成；主代理獨立核對大小／SHA256 相符；實際鍵 `cognitivecomputations_dolphin-mistral-24b-venice-edition` |
| wangzhang/gemma-4-26B-A4B-it-abliterix-GGUF `gemma4-26b-a4b-abliterix-Q4_K_M.gguf` | `20fd410…` | 16796015008 | `d1fd7777…9b832` | 下載完成；主代理獨立核對大小／SHA256 相符；實際鍵 `gemma-4-26b-a4b-it-abliterix` |

模型卡的拒答／能力數字是作者自報，不是本人翻譯驗收；「無審查」名稱也不保證任何輸入都不拒答。四個檔案均由下載腳本逐塊計算 SHA256，主代理再獨立讀檔重算相符，並以 `lms ls --json` 讀回實際模型鍵；桌面 `主代理下載驗收.json`、`本機模型目錄.json` 保存讀回。

## 正式 K 私有接線設定（已套用）

正式私有狀態根目錄是 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\private-state`。原本 `.runtime\gemma-main.json` 不存在（兩個 Gemma 用程式預設），本次只新建此檔並讀回，不改其他設定、訂閱、憑證、權限或舊聊天室：

`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\private-state\.runtime\gemma-main.json`

已套用內容亦保存於桌面 `本機無審查模型比較-20261019\K正式私有設定-gemma-main.json-待主代理套用.json`：

```json
{
  "selfHosted": [
    {"id": "qwen3.8-27b-abliterated", "label": "Qwen3.8 27B Abliterated Q4_K_M", "location": "local", "model": "qwen3.8-27b-abliterated", "contextWindow": 32768},
    {"id": "qwen3.6-35b-a3b-abliterated", "label": "Qwen3.6 35B-A3B Abliterated Q4_K_M", "location": "local", "model": "qwen3.6-35b-a3b-abliterated", "contextWindow": 32768},
    {"id": "dolphin-mistral-24b-venice", "label": "Dolphin Mistral 24B Venice Edition Q4_K_M", "location": "local", "model": "cognitivecomputations_dolphin-mistral-24b-venice-edition", "contextWindow": 32768},
    {"id": "gemma4-26b-a4b-abliterix", "label": "Gemma 4 26B-A4B Abliterix Q4_K_M", "location": "local", "model": "gemma-4-26b-a4b-it-abliterix", "contextWindow": 32768}
  ]
}
```

- 四個 `model` 均由 `lms ls --json` 讀回；Gemma 實際鍵與先前依檔名推定不同，已修正為 `gemma-4-26b-a4b-it-abliterix`。不符時 K 只會把該模型列為「端點未提供模型」，不會改用其他模型。`id` 一旦用於聊天室就不要改（改了舊聊天室找不到連線）；移除某筆後，該模型的舊聊天室同樣無法開啟，但歷史仍保留在其 home。
- 以 mock 端點載入此檔確認：6 條連線（2 個 Gemma＋4 個自架）各自 ID 與 home，名稱為實際模型 · 本機。
- 設定在 K 下次完整重開時讀取；正式部署需先部署本分支程式，否則舊程式會忽略 `selfHosted`。

### 本人使用方式

1. 目前僅 LM Studio 本機服務已開啟供模型清單讀回，沒有載入模型。本人測試時在 LM Studio 一次只載入一個模型，**context 至少與設定的 `contextWindow`（32768）相同**，並開啟本機服務（:1234）。RTX 4060 8GB 只能部分卸載到 GPU，其餘在系統記憶體，速度會明顯慢於全 GPU；不要宣稱全 GPU。若靠 LM Studio 的 JIT 自動載入，可能用較小的預設 context，Codex 原生指令與工具定義會超出而失敗。
2. K 新對話 → 提供者「自架」→ 選模型。端點未列出該模型時選單會顯示不可用及原因。
3. 每個模型的聊天室各自保存原生歷史；換模型請開新對話或明確交接，不會偷偷延續或改導向。
4. 雲端高精度：租機與 SSH 轉送由本人管理；再加一筆 `location: "cloud"`（預設 `:18080`）並填實際模型 ID。K 不自動租機、付款或建立轉送。

## 驗證

- 單元與路由（mock）：`test/gemma-main.test.mjs` 新增自架清單：穩定 ID／home／slot、實際名稱不含 Gemma、同端點不同模型各自轉換連線與目錄、`nativeModel` 互不相通、不列入工人、錯誤設定（重複 id、未知地點、非法 id、公網 https、缺名稱、ID 超長）都退回既有兩個 Gemma 不可用。`test/unified-controller.test.mjs`：同端點自架模型得到獨立 controller、新對話不帶 threadId、跨連線 selectModel 被拒。
- 完整 `npm test`：主功能後 **1749/1749**；複查修正後再跑 **1749/1749**，0 skipped。
- `npm run build:ui` 通過（僅既有大 chunk 提示）。`npm run test:ui`：主功能後 47/48，失敗的是 `voice-composer-ui-probe`（工作樹缺正式本機 Whisper 路徑，上一批 Gemma 也同樣）；只對測試程序指定既有 Python／模型路徑重跑 **1/1 通過**，未改正式設定。複查修正 `10bb983` 後重新 `build:ui`，並在測試程序指定既有 Whisper 路徑與專案 Chromium（`D:\K-harness\.runtime\playwright-browsers`）跑全套 **48/48 通過**。模型選單 UI 測試新增：「自架」分頁、不再有「Gemma」分頁、Qwen 自架模型以實際名稱出現在 Qwen 群組。
- 測試紀錄在本工作樹 `.runtime/tests/selfhost-native/`（Git 排除）：`npm-test-1.log`、`npm-test-2.log`、`build-ui*.log`、`test-ui*.log`。

## 已停止的嘗試（不作驗收）

本人覆寫前，執行者曾以 `lms load qwen3.8-27b-abliterated -c 8192 --parallel 1`（自動部分卸載，載入後 GPU 7169／8188MiB）啟動 LM Studio 服務並跑直接協定／翻譯測試腳本：

1. 第一次：測試腳本的 Node fetch 在非串流翻譯請求 300 秒內沒收到回應標頭而自行中止（用戶端逾時，不是模型錯誤）；沒有模型輸出檔。
2. 改用無逾時 HTTP 後第二次：父代理依本人覆寫停止程序、卸載模型並停止 LM Studio 服務；只留下輸入請求檔，沒有模型輸出。

兩次都不作驗收，也不重跑。桌面該模型 `翻譯測試` 資料夾附「已停止-不作驗收.txt」。共同翻譯輸入（自造安全的日／韓／英短段落與人物術語表、固定取樣設定）保留在 `翻譯測試共同輸入`，供本人自行測試時使用；直接測試與 K 原生往返腳本 `direct-probe.mjs`、`k-native.mjs` 留在上述測試目錄，未執行完成。

## 未驗證／待本人實測

- 四個模型推論速度、Responses 文字／函式呼叫／工具結果／多輪、串流工具事件：**全部未完成驗證**；曾載入 Qwen 27B 的中止嘗試見上，不作本批模型驗收。
- K 原生真正工具往返（寫檔核准、讀檔、取消、重開）：**未驗證**；上一批只在 Gemma 12B 驗證過同一鏈路，不能代表這四個模型的工具能力或協定相容性（例如 Qwen 思考輸出、Mistral 工具格式）。不支援時應如實標示，不加 fallback 或另造代理迴圈。
- 翻譯品質與拒答行為：由本人親自看，執行者不讀、不評。
- 雲端高精度：未租機、未驗證。
- 程式複查：真正 Opus 5.5（high）負責實作及複查，修正上述兩項；GPT 主代理另獨立閱讀完整功能 diff、修正與測試證據，重跑接線／路由測試 **22/22**。不宣稱另有一位 Opus 盲審。

## 部署狀態

- 正式程式版本：`1a9a44f054d10714af12da6f8a871723ad0c0aef`（程式 commit `10bb983b409b8cebda8223e1bc83759fea2fd393`，其後為文件 commit）。`.local/runtime.json` 已讀回；退版為 `releases/before-1792387053965`，不含對話還原。
- 第一次候選完整測試 1748/1749，既有 `browser-owner-gateway` 取消測試等候狀態逾時；未改任何測試／程式或放寬期限。原候選單項 **7/7**，原候選完整複驗 **1749/1749** 後，才以既有 `activateRuntime` 套用同一候選，沒有重送任何使用者工作。此一次未重現的測試逾時不能宣稱已修復瀏覽器根因。
- 主代理核對正式候選與已驗收版本的重要來源檔相符；正式 `loadGemmaConnections` 以正式設定讀回實際本機 `/v1/models`，四個新模型均列出且 ID 正確（僅清單、不推論）。既有 Gemma 本機可連，雲端未連；沒有租機、登入或費用變更。
- `lms ps` 最終讀回：沒有任何模型載入；只保留本機清單服務。K 依本人已關閉狀態保持關閉，不為驗收搶前景。正式程式／設定讀回不等於 live UI 或實際模型推論成功。
- 證據：`.runtime/archive/selfhost-community-20261019/activation.json`、`candidate-npm-test-recheck.log`、`model-connections-readback.json`。桌面資料夾另有大小／SHA256 與完整本機模型目錄讀回。
- Git 遠端狀態以主代理最後 `ls-remote` 實際讀回為準，不把本機提交當成已 push。
