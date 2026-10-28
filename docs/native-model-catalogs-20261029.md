# 三核心主代理與子代理模型完整開放（2026-10-29）

## 需求與查明結果

本人要求 Gemini 核心能用的模型都放到主代理與子代理，並順便核對 Codex、Claude 是否全開放。以 `8905d44` 為基底；正式 K 程式基線是 `2e02f42efd08cae8008528ada08eae3980544125`。沒有下載或切換核心。

2026-10-29 02:22（臺灣時間）用本機選定核心的原生目錄查詢，沒有送出推論回合：

| 核心 | 現用核心版本 | 原生可見模型 | 修正前 K | 候選主代理／子代理 |
|---|---|---|---|---|
| Codex | 0.165.0 | 8 | 完整 | 8／8 |
| Claude Code | 2.1.312 | 原始 13 列，別名去重 12 | 完整，含 Fable | 12／12 |
| Antigravity | 1.4.9 | 6 個原生 ID，推理變體合為 4 組 | 只接 Gemini Flash 一組 | 4／4 |

Codex 8 款：GPT-6.1 Sol、GPT-6 Astra、GPT-6.1 Terra、GPT-6 Sol、GPT-6 Luna、GPT-5.6 Sol、GPT-5.6 Terra、GPT-5.6 Luna。兩款 Luna 提供 low／medium／high／xhigh／max，其餘另有 ultra。主代理取完整分頁 `model/list`，排除原生 hidden；子代理保留全部 8 款，未新增型號白名單。

Claude 12 款：Opus 5.5、Fable 5.1、Sonnet 5.5、Haiku 5.5、Haiku 4.5（dated ID）、Sonnet 5、Opus 5、Fable 5、Opus 4.8、Opus 4.7、Opus 4.6、Sonnet 4.6。原生別名解析、hidden 與逐型號 efforts 完整保留；Haiku 4.5 無 effort，兩款 4.6 無 xhigh。這次沒有改 Claude 的既有計費設定或原生 Fable 行為。

Antigravity 本次實際提供：

| 原生模型 ID | K 保存與派工 ID | 推理程度 |
|---|---|---|
| `gemini-3.8-flash-high/medium/low` | `gemini-3.8-flash` | high／medium／low |
| `claude-sonnet-4-6` | `antigravity:claude-sonnet-4-6` | 原生預設（null） |
| `claude-opus-4-6-thinking` | `antigravity:claude-opus-4-6-thinking` | 原生預設（null） |
| `gpt-oss-120b-medium` | `antigravity:gpt-oss-120b` | medium |

原生目錄現時沒有列 Gemini 3.7／3.6 Flash 或 3.1 Pro，所以不補成可用；日後原生重新提供就會出現。目錄可見不等於逐款推論或全部媒體能力已實測。

## 修改與邊界

- `shared/antigravity-models.mjs`：共用原生目錄 ID 解析與核心前綴。保留全部模型家族，忽略非模型狀態行。既有 Gemini ID 不變，其餘加 `antigravity:`，避免同名 Claude 走 Claude Code 或 GPT-OSS 走 Codex。
- `shared/model-provider.mjs`、`src/gemini-login.mjs`、`src/gemini-controller.mjs`：主代理完整保留 agy 目錄；逐原生變體保留 effort 對照。選單顯示「Antigravity」來源，不推定 Thinking 等於某個 effort。
- `src/gemini-worker.mjs`：子代理剝除核心前綴後，以原生 ID 精確核對 `agy models` 再執行；原型號或 effort 不在目錄時拒絕，沒有換模。提示改稱 Antigravity 核心子代理。
- `src/worker-policy.mjs`、`src/luna-bridge.mjs`、`src/luna-gateway.mjs`：三個主核心的 K 子代理目錄與派工入口接納新 ID；不把 Antigravity 的 Claude/GPT 寫入 Codex 原生子代理預設。
- `src/main-sessions.mjs`、`frontend/chat-messages.jsx`：保存與重開仍屬 Gemini 核心及 Antigravity 訂閱；發言來源標示使用同一核心判定。
- 測試：新增目錄／撞名與桌機手機選單探針，擴充主代理保存重開、子代理原生參數、MCP 入口及 bridge 路由回歸。

沿既有 Antigravity 權限、帳號綁定、額度與排程政策；沒有新增權限模式、帳號、登入流程、計費路線、重試或備援。新非 Gemini 家族只宣告文字能力，未把其他 Gemini 已驗證的媒體支援套上去。共同核心判定也供既有討論使用，這次沒有改討論控制流程。

## 驗證與複查

實查與測試收據保留於 `.runtime/archive/native-model-catalogs-20261029/`，不提交私人收據。`native-catalogs.json` 保存原生目錄、版本及正規化結果；Claude 原生 13 列可見去重後與 K 12 款完全相同；Codex、Claude 只讀目錄程序均確認關閉。

第一次定向測試 172／173；新增測試誤把公開 session 投影當作含 accountType 的原始 header，已改讀真實保存 header。第一次完整測試 2,021／2,023：建置與測試並行造成品牌測試在尚無 built index 時執行；新增重開測試未提供既有入口要求的 model，已修正測試。沒有為這些測試修改產品行為。修正後相關 39／39 通過。

第一次新增選單探針誤期待「模型預設」會明傳 effort；既有介面刻意省略，由後端套原生預設。改由探針明選 medium 再驗提交，桌機／手機通過；沒有因此更改產品預設。看過手機實際截圖後，把新增模型的顯示版本改為 4.6、GPT-OSS 120B，保留完整來源標示。

第一次全套 UI 的新增探針因上述預設 effort 期待錯誤失敗，其餘 54 項全過（`ui-tests.txt`）；修正後桌機、手機定向通過，且主代理看過兩尺寸定稿截圖。修正後完整測試 `full-tests-final.txt` 為 **2,023／2,023**，當時尚未包含下述最後一項別名拒絕測試。

真正 Opus 5.5 第一輪（high，session `3d93bb43-c78f-4b74-8e13-2b3405545dde`）完整複查後，結論為沒有阻擋合併問題，但須等現行程式全測與 build 通過。四項低度意見處理如下：

| 意見 | 處理與取捨 |
|---|---|
| tab 限定造成相容性退步 | 恢復原本任意空白切割；保留狀態行排除，回歸含 tab 與空格格式 |
| 名稱的版本點與 GPT-OSS 大小寫 | 已在前輪閱讀期間窄修並看過定稿截圖；保留現有依 ID 產生名稱，不新增第二套 label metadata |
| 非媒體模型也收到媒體能力提示 | 已驗證的 media 名單集中於 shared，主代理宣告與子代理提示共用；非名單模型不附媒體能力提示 |
| 直接派工可使用非正規 `antigravity:gemini-*` 別名 | 執行器要求正規 ID，於查目錄／推論前拒絕；新增回歸 |

另撤回沒有本次原生證據的 ultra effort 分組；未來未知後綴仍當作完整原生模型 ID 保留，沒有猜測 effort。沒有為重複前綴比對、既有不可達 fallback 新增抽象。舊版程式不能開啟新 `antigravity:` 型號的房間，退版時仍保留資料，但需要新版才能使用；沒有資料遷移或自動改型號。

真正 Opus 5.5 第二輪（high，session `89747906-55db-46f4-89d9-fca9390fe098`）確認四項處理都成立、改法精簡，結論「可以合併，沒有會擋住合併的問題」。主代理獨立核對程式與測試後接受。兩個可選意見不擴修：維持既有 exported 提示 helper 的 `media=true` 預設以相容既有呼叫，實際 worker 唯一入口已明傳依目錄能力判定的值；別名直接派工可留下失敗紀錄，但執行器在查目錄及推論前明確拒絕，不為消掉紀錄再加入口重複檢查。未來非數字 B 結尾 GPT-OSS 名稱的連字號純外觀問題留待有實際型號時再調整。

最後小差異測試 **106／106**（`review-fixes-tests.txt`）通過。定稿先完成 `npm run build:ui`，再執行完整 `npm test` **2,024／2,024**（`full-tests-reviewed.txt`，0 fail／cancel／skip）。建置僅保留既有 chunk 大小警告。全套 `npm run test:ui` 的 55 項已跑完，原有 **54 項通過**；新增探針失敗的測試假設已修正。最後重建後以既有 `npm run test:ui -- …` 跑新增 Antigravity、Gemini 媒體、兩個主代理選單及子代理選單共 **5／5** 通過（`ui-tests-reviewed.txt`）。因此 55 項均有通過結果，並非 55 項同一輪全過；不為已修正的測試假設重跑無關長時間語音探針。

兩個複查 session 的原生 assistant model 欄位均獨立讀回為 `claude-opus-5-5`（`opus-native-models.json`），不是以工單要求的 model 欄位代替實際模型。原生目錄查詢、合成執行器、桌機／手機瀏覽器與 Opus 複查各自記錄，不相互冒充；尚未逐款送出新增模型的真推論回合，未做本人 Android 真機驗收。

## 發布狀態

程式版本 **`2300e14`** 已驗收，程式與本工程文件分開提交；本批交付為合回 main 的待更新版本，既有 `.local/update-ready.json` 指向完整程式 SHA。正式 K 仍執行於 `2e02f42efd08cae8008528ada08eae3980544125`，不能由本房自行停止或更新；本人按側欄「更新」後才會套用。

原始碼提交前檢查差異無秘密；公開 push 依專案發布順序，等按鈕部署與正式讀回後再做，這次尚未 push。正式部署、逐檔讀回與遠端 SHA 核對仍待按鈕完成後收尾；東區未更新。
