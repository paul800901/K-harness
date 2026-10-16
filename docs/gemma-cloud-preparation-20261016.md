# Gemma 雲端主代理：接入方案確認與準備

日期：2026-10-16。狀態：**方案與準備完成；尚未實作 K 接線、租機或部署。**

## 結論

優先沿用 K 已有的 **Codex app-server 代理核心**，推論改由雲端 **vLLM + Gemma 4 12B QAT BF16** 提供。Codex 在此只負責本機工具、核准、歷史與接續，不代表使用 GPT 推論或 OpenAI API 計費。現有 GPT／Claude／Gemini 對話及訂閱路線保持不變。

這是有官方協定、模型權重與上游版本來源支持的實作路線，不是已完成的端到端驗證。不能直接在 K 模型選單加一個名字就稱接通。

```text
K 原有聊天室介面
  → 本機 Codex app-server（Gemma 專用、無訂閱憑證的執行設定）
  → Responses API／加密 SSH 轉送
  → 雲端 vLLM
  → Gemma 4 12B QAT 的 BF16 權重

檔案工具與專案歷史：留在本機
推論資料：必要的指令、上下文、原文與工具結果會送到雲端
```

不需要使用 LM Studio 聊天介面，也不需要新增 OpenCode／Pi／另一套代理框架或自行寫模型工具迴圈。LM Studio 僅作為本次已存在模型的唯讀盤點來源，不是選定的雲端執行依賴。

## 本人已確定的需求與本輪授權

- Gemma 是可以直接選用的主代理，不是工人或討論席位。
- 只做小說翻譯、潤色；沿用專案規則，不為此建立跨專案派工、白名單平台或新的權限模式。
- 翻譯潤色品質已由本人確認，不重開選模或文學品質評測。本次要改善本機速度與低位元量化限制。
- 用法沿用 K 的對話、檔案成果、核准與工作接續。這不等於承諾所有 GPT 專屬能力都適用於 Gemma。
- 本輪只確認方案、來源與準備步驟。未安裝套件、下載權重、建立雲端資源、付款、讀取憑證、執行模型回合、改正式 K 或 push。
- 專案規則約束不等於 OS 隔離。保持原生權限；不因用途是翻譯就默認完整存取。

## 一、已核對的現況

### 本機模型

唯讀讀取已開啟的 LM Studio `GET /api/v1/models`：

| 項目 | 本次讀回 |
| --- | --- |
| 模型 key | `gemma-4-12b-it-qat` |
| 顯示名稱 | Gemma 4 12B Instruct QAT |
| 量化 | Q4_0，4-bit |
| 模型大小 | 6,975,879,296 bytes |
| 載入上下文 | 32,768 |
| 同時處理數 | 1 |
| reasoning | 支援 on／off，預設 on；不等同 GPT effort |

未改模型、載入設定或提示詞，未拿小說原文做測試。`GET /slots` 回傳不支援端點，故本次沒有據此宣稱模型閒置，也沒有提交推論以免干擾既有工作。LM CLI 列出的已選用引擎為 `llama.cpp-win-x86_64-nvidia-cuda12-avx2@2.59.0`；選用紀錄不代替該實例實際載入引擎的證明。

### K 原始碼與原生核心

- 調查基準：`228ce08e10d7b0a2b2c4a1396c9424f81cf6fddd`。開始時 main 乾淨、比 origin/main 超前兩筆；未發布這兩筆別的工作。
- K 的 `selected-cores.json` 指向 **Codex 0.163.0**；沿其路徑執行 `--version` 同樣回報 0.163.0。原始預設位置另有 0.159.0，不能拿舊預設檔代表現行選用版本。
- `src/codex-host.mjs` 已用原生 app-server，支援啟動設定覆寫；不是只能執行 GPT 的自製代理迴圈。
- `shared/model-provider.mjs` 目前把非 Claude／Gemini 名稱歸入 Codex，不能據此將 Gemma 誤標為 GPT。
- `src/desktop-controller.mjs` 的 `models()` 與 `open()` 都檢查 ChatGPT 訂閱；選模又核對官方帳號目錄。自架模型要有明確獨立分支，不能把這些既有保護全域移除。
- 同一 controller 還強制建立 Flash／Claude 工人 gateway 與相關提示，Gemma 的小說單代理路線不應因此依賴三家登入或暗中呼叫付費工人。
- `src/discussion-api.mjs` 是唯讀討論路線，不挪用、不擴權成主代理。

## 二、推論協定與權重已確認到哪裡

### 原生核心接法

OpenAI 官方文件提供自訂 `model_provider`／`base_url`；現行 `wire_api` 使用 **Responses**。vLLM 官方另有 Codex 整合說明。因此不是在 K 內新增 Chat Completions → Responses 的轉接服務。

本次核對 vLLM **v0.31.0**（官方 release 發布於 2026-10-05），並讀取該 tag 而非只看 main：

- 模型 registry 有 `Gemma4UnifiedForConditionalGeneration`，對應這個 12B 權重的架構。
- Responses serving 有非 Harmony 模型路徑與工具解析器，不是只能服務 gpt-oss。
- `gemma4` 工具解析器有登記。
- 上游 `test_gemma4_responses_adjust_request.py` 包含 Gemma／Responses 串流工具呼叫格式的回歸案例。

**上游有程式與測試，不等於本機已跑過這些測試，也不等於 Codex 0.163.0 + 此模型端到端已通過。** 租機前仍要完成 K 接線；租機後再驗實際載入與原生工具往返。不得拿其他 Gemma 大小的成功結果代替 12B。

### 高精度權重

優先保留目前的 **QAT 模型家系**，不默默改成另一個 fine-tune、一般 IT checkpoint 或更大的 31B：

- repository：`google/gemma-4-12B-it-qat-q4_0-unquantized`
- 本次官方 metadata revision：`b6ed86275a6a5735884e208bfed95b445a684ca2`
- `config.json`：`Gemma4UnifiedForConditionalGeneration`、`gemma4_unified`、`dtype=bfloat16`，沒有 `quantization_config`。
- safetensors metadata：11,959,730,224 個 BF16 參數。
- 本次 API 回報 `gated=false`；目前取得公開 metadata 不需要登入。將來若下載規則改變，才由本人處理必要授權。

名稱中的 `q4_0-unquantized` 是官方 QAT 檢查點命名，並不是要在雲端繼續執行 Q4。它是 QAT 訓練流程提供的高精度權重；**不是把本機 Q4 檔案轉存成 BF16**，也不能宣稱移除了 QAT 訓練的影響。

僅讀取遠端 metadata／config，未下載權重。尚未核對本機 GGUF 的原始 revision，因此目前確認到同一官方 QAT 家系，不主張位元級同源。

## 三、K 的最小修改範圍（尚未實作）

| 位置 | 必要修改 | 必須保留 |
| --- | --- | --- |
| `src/isolated-desktop.mjs`／原生 host 建立點 | 為明確選用的 Gemma 聊天室建立自架模型設定；使用 K 私有區內獨立、無訂閱憑證的原生 home | 既有三家 home、帳號、核心選用與對話不變；不複製 auth/config |
| `src/desktop-controller.mjs` | 在現有 controller 注入最小的後端差異：模型目錄、登入條件、原生 provider 設定及是否接工人 | 不複製整個 controller；GPT 訂閱檢查照常；Gemma 不進付費 fallback |
| `src/main-models.mjs`／模型選單資料 | 以設定的精確模型及端點實際 `/v1/models` 讀回建立可選項；接線時核對原生模型 metadata 格式 | 不把它塞入 GPT 官方清單，不編造 effort／Fast／工具能力 |
| `src/main-sessions.mjs`／`shared/model-provider.mjs` | 保存並讀回原生核心與推論後端的區別，讓重開時仍回同一 Gemma 路線 | 既有無新欄位紀錄沿用原義；不可將既有 GPT thread 改接 Gemma |
| 現有聊天室與模型選單 | 顯示「Gemma 4 12B QAT BF16／自架雲端」，沿用原有成果與核准呈現 | 不新增另一個翻譯介面或 GPU 租賃控制台 |
| 對應測試及專案規則 | 新增自架小說主代理的明確例外與必要 regression | 不放寬一般 API 計費／憑證禁令，不修改其他專案規則 |

不新增 provider framework、API proxy、跨專案協作、重播佇列或自動換供應商。單一自架後端的設定足夠，不為未知第二種用途預先抽象。

### 能力顯示與資料邊界

- 新對話預設沿用「要求核准」與原生工作區寫入，依小說專案現行規則執行。Gemma 仍是主代理，不以「翻譯工具」取代對話。
- 不默認啟用「代我核准」、Fast、GPT effort 或派工；只有原生路徑實證支援、且本人選用的能力才呈現。
- 不提供跨供應商原生歷史搬移；已有譯稿、詞彙表與進度可在同一小說工作區讀取。
- 雲端只處理推論，本機執行讀寫檔案。這仍會把必要原文、上下文及工具回傳送到雲端，不稱完全離線或零資料外送。
- 確切小說工作區沿用本人在 K 選定的資料夾；本輪不猜路徑、不掃小說資料、不修改其 AGENTS.md。

## 四、雲端配置草案（不得直接視為可部署收據）

初始規格：一張 **48GB NVIDIA GPU**、單路請求、32K 上下文、BF16 權重與未另行量化的 KV cache。Google 載入估算約 26.7GB，上下文及執行額外占用要另算；未宣稱已證明 48GB 在此配置不會 OOM。

候選 A40 優先控制租金；L40S 是較高租金的效能比較候選。2026-10-16 官網列價分別為 US$0.59／h、US$1.09／h；實際建立時重讀費率與供應。不能以理論規格承諾翻譯耗時或每月省多少錢。

### 工程啟動參數草案

以下只供後續實作，不是要求本人執行。先固定 vLLM 0.31.0 的可取得映像／相依，核對 NVIDIA 驅動、映像 digest、完整 SSH 與持久模型目錄；本輪未下載或安裝。

```bash
vllm serve google/gemma-4-12B-it-qat-q4_0-unquantized \
  --revision b6ed86275a6a5735884e208bfed95b445a684ca2 \
  --served-model-name gemma-4-12b-qat-bf16 \
  --dtype bfloat16 \
  --max-model-len 32768 \
  --max-num-seqs 1 \
  --gpu-memory-utilization 0.90 \
  --enable-auto-tool-choice \
  --tool-call-parser gemma4 \
  --reasoning-parser gemma4 \
  --host 127.0.0.1 \
  --port 8000
```

不加低位元 quantization、不用 CPU offload 假裝全 GPU、不加另一個 draft 模型。先沿來源 tokenizer／chat template；遇到實際不相容時保留原錯誤，不先改模板或套通用轉接器。正式啟動前還需核對該版本各參數及快取設定的實際讀回。

### 安全連線與 Codex 設定形狀

首選完整 SSH 的本機轉送：本機 `127.0.0.1:18080` → Pod `127.0.0.1:8000`。18080 是候選本機埠，啟用時先查占用。只對外提供經金鑰驗證的 SSH，不公開未驗證的模型埠；不關閉 SSH 主機金鑰驗證。

Runpod 的一般 SSH 代理和完整 TCP SSH 不相同。租用前確認 public IP／映射 TCP SSH、容器內 sshd 與轉送能力；不能只看到「可 SSH」就認定可轉送。不要在不支援時自行改成公開 API。

下列 TOML 只示意 **Gemma 專用執行設定**，不是覆寫現有 K 或全域 Codex 設定的指示：

```toml
model = "gemma-4-12b-qat-bf16"
model_provider = "k_gemma_cloud"
model_context_window = 32768
check_for_update_on_startup = false

[model_providers.k_gemma_cloud]
name = "Gemma cloud via SSH"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
```

本機 loopback HTTP 只在已驗證 SSH 加密通道內使用，不把它換成裸露的雲端 HTTP。這條路線不需 OpenAI API key，也不需把 Runpod 管理金鑰交給模型。SSH 私鑰留本機安全位置，雲端只登記公鑰；首次設定與存放位置另行確認，不讀用其他專案金鑰。

## 五、後續次序與本人需要做的事

1. **先做隔離實作，尚不租機**：核對本機 0.163.0 的實際協定／模型 metadata，將上述有限差異接入候選 K，保留現有三家行為。若原生核心不相容，先回報，不換框架或增加轉接層。
2. **確認雲端安裝與費用範圍**：列出確切 GPU、單價、磁碟、映像、模型權重與租用時數。儲值、租機、下載安裝與設定 SSH 都不是本文件已執行的事項。
3. **本人操作**：註冊／登入、驗證碼、付款；確認預算及私鑰存放方式，將指定公鑰登記到雲端帳號。完整秘密不貼聊天。
4. **短租後驗接線，不重做選模**：讀回 BF16／全 GPU／32K／單路；完成 Responses 文字、工具呼叫／工具回傳、多輪、停止與重開接續。用人工測試資料驗檔案寫入與核准，真實小說工作仍遵守專案規則。
5. **最後才更新正式 K**：依既有完整測試、介面測試（若有改）、真正 Opus 複查及正式閒置確認流程；本人再用既有工作方式操作。

費用與資料：關閉 K 不等於雲端停止計費；GPU 停止後儲存仍可能收費。租用前確認所選磁碟是否可 stop／重新掛載、停止後 GPU 是否可能無供應。模型可重建，小說原檔與成果保留本機；不拿帳戶歸零或自動刪除當安全停機。停機與刪除分開授權，不自動 terminate。

## 六、驗證、取捨與未完成

本輪實際完成：

- K 規則、Git 狀態、主模型路由、訂閱檢查、工人耦合與保存欄位的原始碼檢查。
- 現行選用 Codex 的版本／命令能力讀回，既有 LM 模型 metadata 讀回。
- 官方高精度模型 metadata、固定 revision 的 config、vLLM 固定 tag 的架構／Responses／工具解析來源核對。
- 接線修改位置、來源依據、非秘密設定草案、租機前後次序與驗收清單落檔。
- 文件讀回確認僅兩份 Markdown 變更、工程索引目標存在；已通過允許既有 CRLF 行尾的 Git 差異空白檢查。

未做：任何本機／雲端推論、原生 app-server 自架回合、雲端載入與效能實測、K 程式實作、正式操作。上游文件／測試不替代這些實測。

本輪只修改本文件與工程索引，沒有可執行程式差異，因此不跑 `npm test`／UI 建置，也沒有程式 Opus 複查意見。後續程式需真正 Opus 5.5 審核，重點仍是避免多餘架構與保持原生權限。

取捨：不採「另外做一套代理」；不採現有唯讀討論 API 擴權；不改現有 GPT 登入與模型清單；不加 API 轉接 proxy；不先租機等 K 開發；不以普通 API 回答成功當主代理全功能已通。

## 來源（本次讀取）

- [OpenAI：自訂模型供應者](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers)
- [OpenAI：設定欄位](https://learn.chatgpt.com/docs/config-file/config-reference)
- [OpenAI：app-server](https://learn.chatgpt.com/docs/app-server)
- [vLLM 0.31.0：Codex 接入說明](https://github.com/vllm-project/vllm/blob/v0.31.0/docs/serving/integrations/codex.md)
- [vLLM 0.31.0：模型 registry](https://github.com/vllm-project/vllm/blob/v0.31.0/vllm/model_executor/models/registry.py)
- [vLLM 0.31.0：Responses serving](https://github.com/vllm-project/vllm/blob/v0.31.0/vllm/entrypoints/openai/responses/serving.py)
- [vLLM 0.31.0：Gemma Responses 工具回歸案例](https://github.com/vllm-project/vllm/blob/v0.31.0/tests/tool_use/test_gemma4_responses_adjust_request.py)
- [Google：12B QAT 未量化檢查點](https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-unquantized)
- [Google：固定 revision 的 config](https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-unquantized/blob/b6ed86275a6a5735884e208bfed95b445a684ca2/config.json)
- [Google：Gemma 記憶體規劃](https://ai.google.dev/gemma/docs/core)
- [Runpod：價格](https://www.runpod.io/pricing)
- [Runpod：完整 SSH 條件](https://docs.runpod.io/pods/configuration/use-ssh)
- [Runpod：計費與資料風險](https://docs.runpod.io/accounts-billing/billing)
