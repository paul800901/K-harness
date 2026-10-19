# 本機模型由 K 背景載入（2026-10-19）

## 需求與狀態

本人要求：在 K 選模型、送出工作即可，不另開 LM Studio 手動載入或調整資源，不新增技術參數介面。「先別跑模型、本人親自測試」仍有效。

本批實作中；驗證、真正 Opus 5.5 複查與正式套用結果完成時補記。不進行任何真實模型載入或推論，不把 mock 通過稱為翻譯、工具能力或效能驗收。

## 根因與最小接法

舊 `contextWindow` 只建立 Codex 原生模型目錄，沒有對推論引擎套用載入參數；實際 JIT 預設可能仍是 4K。上一批的接線不包含載入管理。本批用已安裝的原生 `lms` CLI 與 LM Studio 本機 API 補齊，不新增代理核心、常駐服務、框架、設定視窗或雲端控制。

- K 私有 `.runtime/gemma-main.json` 新增 `localRuntime.executable`，由 AI 一次接到本機已安裝的 `lms.exe`；未啟用的既有設定保持原接法。只管理 local 的 :1234；雲端 SSH／其他端點不自動啟動、載入或付費。
- 模型清單查詢原生目錄（服務離線時 lms ls 可能喚起原生背景引擎，但不載入模型），建立／重開聊天室只準備 home 與工具格式轉換；都不載入模型。第一次實際推論前才在背景啟動必要引擎與 localhost 服務、載入指定模型。
- 使用各連線的 `contextWindow`（目前均 32768）、`parallel=1`、GPU 原生 Auto，載入 CLI 明確指定 --port 1234，避免原生探索指向其他端點；停用自訂 engine-config 與 Draft MTP。CPU 執行緒、Flash Attention、KV Cache 保留原生設定，不偽稱逐項強制覆寫或已找到本機最佳值。沒有重新量化權重。
- 載入後讀回確切模型 key、instance ID 及實際 context／parallel，符合後才送推論；請求指定該 instance，避免 JIT 載入另一份。K 穩定模型 ID、home、歷史、權限與訂閱路線不變。
- 本機連線共用一個推論占用；正在載入／推論時不被其他請求卸載，不偷偷排隊或重送。切到另一模型工作時，只卸載本輪 K 確定自行載入且閒置的 instance；外部或舊執行留下的未知 instance 不接管、不強制結束。
- 每次推論都核對，不只在首次開聊天室做一次；切回舊聊天室會先準備正確模型。不設 K 自訂載入總時長上限；載入前的停止立即生效；載入命令已送出後，等待該次原生結果及讀回，不殺 CLI、不重送，且已停止的工作不再送推論。推論停止訊號沿原生傳遞；推論中由橋接端取消時，明確卸載本次唯一自行載入的 instance 並讀回消失，才釋放占用，不能只把 HTTP abort 當作引擎已停止。載入／卸載或非取消的已送推論結果未知時，停止後續操作，不以重試或換模型冒充恢復。
- 正常閒置關閉 K 時，釋放本輪自行載入的模型，避免下次重開被當成未知外部占用；不擅自停止共用 LM Studio 服務或未知／進行中工作。崩潰或未知執行留下的模型仍需查明，不假造已停止。

## 原生依據

- [lms load](https://lmstudio.ai/docs/cli/local-models/load)：context、instance identifier、GPU Auto；本機 `load --help` 另確認 parallel、no-engine-config-file、no-speculative-draft-mtp。
- 本機 `daemon --help`／`server start --help` 確認啟動與 localhost 綁定參數；只查 help 不會載入模型。已安裝 CLI commit dcefd5a 的 createClient 原始碼確認 --port；本機 app-install-location 登記原生 `--run-as-service`，不需新增啟動模式或安裝 llmster。冷啟動未實際執行，本輪不聲稱已驗收無焦點閃現。
- [原生模型目錄](https://lmstudio.ai/docs/developer/rest/list)：`models[].key`、`loaded_instances[].id`、`loaded_instances[].config.context_length/parallel`；已只讀核對本機 metadata，所有 loaded_instances 為空。
- [原生卸載](https://lmstudio.ai/docs/developer/rest/unload)：只送確切 instance_id，不使用 unload-all。

## 檔案與驗證

- `src/local-model-runtime.mjs`：原生目錄、背景啟動、載入／讀回、閒置切換及推論占用。
- `src/gemma-main.mjs`：私有啟用設定、共用 runtime、真實目錄與模型參數。
- `src/gemma-responses.mjs`：實際 Responses 前取得模型，綁定聊天室模型、指定 instance、終結後釋放；工具轉換與核准不變。
- 對應 `test/local-model-runtime.test.mjs`、`test/gemma-main.test.mjs`、`test/gemma-responses.test.mjs`；載入／卸載／推論全用 mock。
- `AGENTS.md`、前批接入文件及工程索引同步使用方式。

## 使用方式

開 K → 新對話選「自架」與模型 → 送出工作。初次需等待載入，相同模型可重用。換模型用新對話或明確交接，不轉送舊歷史。日常不用操作 LM Studio；外部模型占用、未知執行或引擎故障仍需查明。

## 複查與部署

第一輪真正 Opus 5.5（claude-opus-5-5，high；system/init 型號核對）提出停止時永久占用、關閉時過早快取／錯誤中斷清理兩項問題。已修正：

- 不採「abort 就算 settled」建議：HTTP 中止不能證明原生引擎已停；改成只對本橋接端取消的唯一自身推論，卸載確切 instance 並讀回，錯誤仍保留未知、不重試。
- 去除 close 的提前返回快取；忙碌時略過不阻止之後閒置連線清理。服務已關／外部占用等清理失敗不阻止 K 其餘關閉流程。
- 去除同一份目錄的重複外部識別檢查（卸載後新讀回仍核對）；文件明示正常閒置卸載，無額外常駐清理。
- 另核對已裝 CLI 原始碼，將載入端點釘定 1234；無新依賴或設定介面。

目前聚焦 mock 36/36；第一輪完整 1772/1772。第二輪真正 Opus 5.5 無阻擋缺陷；其非阻擋意見再採納兩項：關閉時允許外部另有模型但仍只清自身、同名被替換仍不清；載入途中停止則等原生載入及讀回完成而不送推論。明確失敗先讀回就解除未知的建議未採，單次缺席不證明引擎不會晚到，維持未知不重播。最終完整測試與部署讀回待補記。只讀原生 metadata 已確認五個本機選項可辨識，全部未載入。K 保持關閉；未執行真實模型推論，雲端未租用、未啟動。
