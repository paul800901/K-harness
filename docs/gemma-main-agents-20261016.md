# Gemma 本機／雲端主代理接入（2026-10-16）

## 範圍與狀態

本人要求：既有 K 操作不變，新增本機量化版與雲端高精度版 Gemma 4 主代理；不作工人、不另設小說專用限制。翻譯品質已由本人驗證，本次只驗接線。**本輪停在部署之前：不租機、不付款、不更新／重啟正式 K、不 push。**

實作與本批部署前驗收完成：本機原生工具往返、核准停止及原對話重開有真實證據；合併主線後完整回歸 1728/1728、真瀏覽器 UI 48/48，第三輪真正 Opus 5.5 複查無阻擋問題。雲端實機仍未驗證，正式 K 未更新。

## 最小接法與差異

```text
K 同一套聊天室／工作區／核准／成果
  → Codex 0.163.0 原生核心（各自的 Gemma home）
  → Gemma Responses 工具格式轉換
  → 本機 LM Studio :1234 / 雲端 SSH 本機轉送 :18080
  → Gemma 推論
```

格式轉換沒有工具執行、代理迴圈、歷史搬移、自動重送、備援、模型去重或任務判斷；全部工具執行及權限仍由原生核心負責。

- `src/gemma-main.mjs`：兩個非秘密連線設定、端點模型存在性讀回、實際模型 ID、獨立 home、原生模型目錄。訂閱登入檢查只對明確 self-host 分支略過；不拿 GPT 目錄成功與否當 Gemma 可用條件。
- `src/gemma-responses.mjs`：**實測才新增**。原生請求含 `custom` apply_patch 和 `namespace` 工具；LM Studio 沒將這些類型送給模型，只有一般函式可見。轉為 function 工具後，再把回傳轉回原生 custom／namespace；保留 call ID、原始工具結果與重播歷史。自由格式參數先完整緩衝再拆封；若模型 JSON 錯誤，將原文交原生工具回報解析錯誤，不斷線冒充網路故障。不支援的請求格式回 400、未送推論。內部連線只綁 loopback，使用一次啟動的記憶體 token、Host／Origin 檢查及既有 body-limit helper；token 不轉送模型服務。
- `src/desktop-controller.mjs`、`src/unified-controller.mjs`、`src/isolated-desktop.mjs`：重用既有 controller，不建立第二套代理。一般回合及工人／目標通知回合都去除 K 顯示用前綴；`review_model` 同樣使用實際 Gemma ID。原生核准、停止、工作區、成果、歷史與接續保留。端點離線時仍可開既有歷史，不自動改模型或重播工作。
- `shared/model-provider.mjs`、`src/main-sessions.mjs`、`src/native-actions.mjs`、`src/conversation-controller.mjs` 與前端：Gemma 為獨立主代理提供者，但沿 Codex-core 功能。兩條連線不可在原對話暗換；跨本機／雲端以新對話明確交接。沒有登入按鈕、假的 effort／Fast 或 GPT 訂閱標籤；離線雲端顯示原因。
- `src/worker-policy.mjs`、`src/luna-gateway.mjs`：Gemma 若選用 K 工人，沿原訂閱 bridge，不將 GPT 模型送至 Gemma 端點。一般 GPT／Claude／Gemini 派工路線不變；不把 Gemma 加進工人或討論參與者目錄。沒有用此修改強迫小說工作派工。
- `test/scratch.mjs`：另筆 `55ed3cd`，因現行全域規則要求 Windows 清理走資源回收筒。失敗保留、不退回永久刪除；不是正式 K 功能修改。

原生目錄是已安裝 0.163.0 合約，不假冒 GPT。`apply_patch_tool_type` 在這版只有 `freeform`；嘗試 `function` 被原生解析器拒絕，不能照較舊建議宣稱支援。未複製 GPT 品牌／程式代理角色提示；專案 AGENTS、原生工具 schema／patch grammar 與 K 既有指令仍傳入。新 home 缺 config 才依現行 AGENTS 建立 `[windows] sandbox="unelevated"`，已有設定不覆寫，不以啟動旗標強制改 sandbox。

## 設定與雲端邊界

設定檔在 K 私有狀態根目錄的 `.runtime/gemma-main.json`；可不建立，預設如下。**不是原始碼根目錄的公開設定，也不是金鑰檔。**

```json
{
  "local": {"baseUrl":"http://127.0.0.1:1234/v1","model":"gemma-4-12b-it-qat","contextWindow":32768},
  "cloud": {"baseUrl":"http://127.0.0.1:18080/v1","model":"gemma-4-12b-qat-bf16","contextWindow":32768}
}
```

K 模型 ID 為 `gemma-local/<模型原始 ID>`／`gemma-cloud/<模型原始 ID>`。各 home 位於同一私有狀態根目錄的 `.runtime/gemma-local-home`／`.runtime/gemma-cloud-home`。只傳原始模型 ID 給推論服務；模型名稱可以含 repository namespace。設定改動下次重開 K 才讀取，不對既有對話靜默重定向到另一個模型。

雲端端點仍是本機 loopback，預期由本人 SSH 轉送到租用機器。未開放公網推論、未安裝套件、未下載 Gemma 權重、未移動訂閱憑證、未設定 OpenAI API key。高精度權重與 vLLM 候選見早先準備文件；仍須租機後確認實際載入的 dtype、VRAM、Responses／工具往返、速度、費用及長文本表現。選單名稱不是 BF16 實機證明。

## 真實驗證與限制

使用原已載入 `gemma-4-12b-it-qat`，LM Studio Q4_0，context 32768；未重載或換模型，未傳小說／病歷等實際資料。

1. 直接 Responses 單句回覆成功；僅作連通基礎，不當代理驗收。
2. 未轉換工具時，原生 catalog／thread 可開，但模型看不到 custom／namespace 工具。保存原始請求確認，不靠猜測。
3. 有轉換後，寫檔核准確實出現在 K；取消同一回合後未建立該檔，沒有重送。
4. 真實 `createDesktopController`＋原生核心＋Gemma 完成 `integration-result-v4.txt`，磁碟讀回 `K_GEMMA_NATIVE_OK`，回合 completed／最終 K_READY。
5. 關閉後以同一 native thread 重開，歷史保留；真實 `conversation_context` MCP 完成、`exec_command`（PowerShell `login:false`）讀檔成功，最終文字與檔案相符。
6. 加上內部 token 後，再以原生同對話送出新純文字核對，回合 `01a144f4-547b-7b10-abd4-65758fbb0a6d` completed，精確回覆 `AUTH_READY`；沒有呼叫工具。

**模型行為限制如實保留**：寫檔回合先產生兩個無效 patch，模型自行修正後又重複一次同內容寫入；MCP 讀取也曾重複。不同 call ID 與逐次推論請求證明是模型再次決策，不是 K／轉換器重播；未為此添加去重、限制器或特殊政策。第一次 `login:true` shell 測試長時間未完成，已中止且檔案未產生；後續 `login:false` 真讀檔成功。這是接入與基本工作流程驗證，不保證 Gemma 的複雜代理能力或一次工具指令完全正確，也不推翻本人既有翻譯品質結果。

雲端離線／ID 不符／錯誤／兩連線分離以合成 endpoint、mock 與邏輯測試確認；**尚無租用 GPU 上的雲端 live 驗證**。Gemma 呼叫其他訂閱工人的路由／交付／停止以 fake bridge 回歸，沒有用實際訂閱工人成功冒充 Gemma 推論成功；本次工程的 Luna 修正與 Opus 複查另計。

原生自動審核（auto-review）的實際審查模型、長上下文壓縮、目標恢復、`/review` 與分支尚未對 Gemma 做 live 驗證；不能把沿用原生介面宣稱為全部進階能力已認證。未因猜測限制或隱藏既有工具；這些項目不屬本次已證實的翻譯基本流程。

證據保留於本任務工作樹 `.runtime/tests/gemma-native/`：`native-request.json`、`translated-requests.jsonl`、`k-live-events.jsonl`、`k-live-result.json`、`k-live-continuation-result.json`、`k-live-auth-result.json`、`review-result.txt`、`review-2-result.txt`、`review-3-result.txt` 及各輪 identity／events。測試 home 不含訂閱憑證。首次原生空 home 啟動曾自動同步官方 plugin marketplace，伴隨長路徑失敗；後續自架 home 停用原生 OpenAI marketplace／apps 啟動同步，K MCP 與工作區工具保留，既有三家設定不變。該測試副作用未當成使用者要求安裝，也未寫進正式 home；沒有將測試資料推送公開倉庫。

## 測試與複查收尾

- 合併最新 main `defef1009aa68812e01452bf7eb66fb959dd9c29` 後，最終完整回歸 `node --test --test-concurrency=4 test/*.test.mjs` **1728/1728 通過，0 skipped**（140.8 秒）。這是與 `npm test` 相同的全套測試檔，限制檔案間並行以避免本機時間型測試互相干擾。
- `npm run build:ui` 通過；只有既有大 chunk 提示。`npm run test:ui` **48/48 通過**，包括 Gemma 選單、既有 GPT／Claude／Gemini、對話、核准相關畫面及真 Whisper 語音 probe。測試程序使用既有 Python／Whisper 模型及 Chromium，不更動正式路徑設定。紀錄：`final-node-tests.log`、`final-ui-build.log`、`final-ui-probes.log`。
- 首輪全套 1709/1711；兩個既有非 Gemma 非同步時間測試失敗，171 項相關測試單獨循序通過。限制測試並行為 4 後，同批完整 **1716/1716** 通過（不是略過失敗項）。合併最新 main 後另跑完整回歸。
- UI 首次工作樹缺既有 Chromium 路徑，未安裝瀏覽器，改用已有目錄。46/48：Gemma 空 effort 選單已修正並實測；語音 probe 缺正式本機設定中的 Python／模型路徑，僅測試程序指定既有兩路徑後，真本機 Whisper probe **1/1 通過**，未改正式環境或音訊資料。
- 真正 Opus 5.5 首輪（Claude Code2.1.301、claude.ai、apiKeySource none、session `dbc33be6-1242-4ac9-aea4-bddf85f0d982`）提出 3 P1／5 P2；主代理依現況採納模型 ID、工人路由、協定、review_model、討論目錄、離線歷史與 UI 問題。sandbox 依現行規則改為僅新 config 預設，不沿用舊文件改現有權限；「function apply_patch」不被已裝版本接受，改處理實際協定差異。清理依現行回收規則另筆提交。
- 第二輪 Opus（session `f669b037-d688-463b-b636-a51feb7226ea`）發現 1 P1／2 P2，已修正：bridge Codex 工人增加來源標記，避免被當成本機原生子代理而丟失結果／阻止停止；確定性格式錯誤交回工具或 400，不斷線誤導原生重試；prepare 失敗／關閉清掉快取，未準備不得繞過轉換直接送上游。定向測試 69/69，格式／連線測試 8/8；主代理已獨立檢查 diff。
- 第三輪真正 Opus 5.5（session `25068e99-e608-4b5e-a0de-94305ee05668`，init 與 assistant model 均 `claude-opus-5-5`、apiKeySource none）確認上述 P1／P2 全數關閉，**no blocking findings**。保留的進階未測事項已列出，不把未測當成功，也不據此加無證據限制。
- 程式固定版本 **`f414de32521af0eec9452705bac176b48a3cbc1f`**；主功能 `dbb4d69`、回收清理 `55ed3cd`、主線合併 `b131a08`。本文件與現行規則另筆文件提交；合回 main，保留測試證據工作樹，不部署、不 push。

正式 `.local/runtime.json` 原版本 `0d14cbd14c3f5c841dda32db254665685ac0d5e6` 未改。本輪不啟動更新器、不動正式 K、不租機、不 push。測試與 source 完成不等於已部署或雲端上線。

## 後續正式部署（2026-10-16 23:15）

本人已授權與其他聊天室成果整合部署，本文件先前的暫停點為歷史紀錄。南區現已套用 `46ec46040d3ee0df1a4fc82cfd5f21a6591800a3`，正式 health 200／native，首次 push 與遠端讀回成功。完整驗證、真正 Opus 5.5 複查與正式接線讀回見 [三聊天室整合部署](integrated-deploy-20261016.md)。既有未驗證邊界保留；雲端 Gemma 尚未租機，東區未更新。
