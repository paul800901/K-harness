# Codex 長原文分頁讀取與截斷補讀

日期：2026-10-27。狀態：程式、完整測試與 Opus 5.5 複查完成；南區已部署讀回（見文末部署結果）。

## 問題與使用者底線

原生工具的單次 `exec_command` 輸出與 `functions.exec` 批次輸出各有上限。既有合成重現證明兩層都會保留頭尾並刪除中段；命令仍可 exit 0。首輪既有紀錄的 14 個回傳中有 7 個截斷，代理沒有補齊必讀範圍就判讀。K 的畫面尾端顯示裁切沒有被證實會造成這條原生工具路徑的缺段。

本人要求：第一次讀取使用者交付及任務必讀資料時保留原文，不為省額度先摘要、刪段或挑重點；盡可能不主動提前壓縮對話。長資料可分段，必須完整接續；成果品質、細節與返工成本優先。已有來源由 AI 補查，不讓本人反覆重述。

官方 [Codex 提示指南](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide#tool-response-truncation) 描述頭尾保留的截斷方式；[設定參考](https://learn.chatgpt.com/docs/config-file/config-reference) 將 `tool_output_token_limit` 定義為個別工具輸出存入歷史的容量。這些不是同一個開關；本次沒有修改原生二進位、模型視窗、壓縮門檻或 home 設定。

## 修改

- `scripts/read-text-page.mjs`：透過原生 shell 執行的唯讀 UTF-8 分頁器，沒有新增 MCP 讀檔通道或權限。JSON 連同跳脫及換行每頁最多 6000 UTF-8 bytes；保留原文 BOM、CRLF、Unicode、否定與欄位，單行長 JSON 也可分頁。分頁只改交付大小，不做語意摘要。
- 每頁含 `version`（原始 bytes 的 SHA-256）、`totalBytes`、`startByte`、`endByte`、`nextOffset`、`text`。接續必須提供前頁版本，版本改變、讀取期間修改、無效 UTF-8、錯誤 offset 均明示失敗，不交付替代字元或混合版本。讀到檔尾僅表示該頁抵達結尾，不另回傳「已完整讀取」旗標。
- `src/codex-reading.mjs`：固定讀取指引要求核對範圍、內外層容量、截斷補讀，以及有副作用的命令不得為補輸出重跑。使用分頁器時內外層額度至少 10000，一頁一個外層回傳，直接交付 `text(result.output)` 原文；不能只印檢查摘要，也不能把所有頁再次合併超額。
- `src/desktop-controller.mjs`、`src/luna-bridge.mjs`、`src/discussion-native.mjs`：沿公開 `developerInstructions` 入口送到 Codex 主房、K 派出的 GPT 工人與 Codex 討論參與者。保留原本權限、模型選擇及共同記憶；本批範圍是 GPT，未加入 Claude、Gemini 或同樣採 Codex 核心的自架主房。
- `test/codex-reading.test.mjs` 與既有三組入口測試：核對真正 CLI、長中文與單行 JSON 的逐 byte 還原、跳脫字元容量、版本變動與錯誤，以及實際送出的原生參數。

## 可保證與不可保證的範圍

分頁器可核對它交付的原文 bytes、版本與範圍，且有序串接的全部 `text` 等於原來源。它仍須經原生 shell、外層回傳及歷史保存；沒有攔截所有原生工具、強迫模型呼叫分頁器或強制阻止模型漏判。固定指引是降低誤用的措施，不能稱為模型一定遵守的硬性閘門。

6000 bytes 是交付封包上限，不是全文讀取上限，也不是以摘要節省額度。10000 的內外層額度依本機目前工具契約安排餘量；更低的使用者設定或未來核心變更仍需核對實際回傳。工具輸出分頁和原生上下文壓縮分開驗收；不宣稱關閉原生壓縮。發生原生壓縮後，需要具體細節時回查來源。

既有主房在更新 K 後沿原生 resume 接收新指引；已在執行的回合與工人不注入、不停止、不重播。Codex 原生子代理的繼承受原生核心控制，本次不把主房參數測試當成所有子代理形式均已實測。PDF、圖片及非 UTF-8 資料仍沿原本適用工具，不能把本分頁器當成等價讀取。

每頁讀取同一完整檔案並核對雜湊，持續追加的活動 JSONL 可能無法在同版本下讀完；這時明示版本變更，不混接，也不自動複製私人原文。應依既有來源工具的可接續協定或穩定的已授權來源讀取。

## 驗證與審核

- 初輪針對測試 89/89、完整 2013/2013 通過，但沒有覆蓋正式 Electron 路徑與瀏覽器載入；不能以此替代後續問題修正後的驗收。
- 修正後針對測試：90/90 通過，包含 7 個分頁／指引測試與主房、工人、討論既有測試。新增父 Node 路徑與單引號處理，Windows PowerShell 及 PowerShell 7 從字碼頁 950 設回 UTF-8 後，直接回傳及 JSON 管線解析均與原文一致。
- `npm run build:ui` 通過，用於完整測試所需的靜態產物；本批沒有介面修改。
- 原生工具實際傳送：透過本主房 `exec_command → functions.exec → 模型回傳` 交付 9830 bytes 的合成中文原文，兩頁範圍為 `[0,5730)` 與 `[5730,9830)`。再獨立解析原生 `custom_tool_call_output`，逐 byte 串接與原文完全一致、無截斷標記、中段否定條件保留，最後 `nextOffset=null`。收據 `native-page-receipt.json`。這確認本回合實際交付；不當成所有模型的理解品質或長期壓縮之後仍保留全文的證明。
- 修正後完整 `npm test`：2014/2014 通過（87.2 秒），`full-tests-reviewed.log`。
- 修正後 `npm run test:ui` 初跑 1/53：工作樹沒有找到已安裝的 Chromium，52 項在開啟瀏覽器前失敗。確認主工作樹既有 `.runtime/playwright-browsers` 後，僅以本次測試程序的 `PLAYWRIGHT_BROWSERS_PATH` 指向它重跑；沒有安裝或更新套件。有效重跑 **53/53 通過**，`ui-tests-browsers.log`。

## Opus 5.5 意見與處理

第一輪真正 Opus 5.5（high）指出三項必修，主代理逐項核對成立並處理：

1. `worker-policy.mjs` 同時被前端使用，新增 Node-only import 會讓建置雖成功、瀏覽器實際載入卻失敗。已移除該共用模組改動，指引只在後端 `desktop-controller.mjs` 組裝；補跑建置及完整介面探針。
2. Electron 主程序的 `process.execPath` 不是 Node。已沿既有 `K_ISOLATED_PARENT_NODE_EXECUTABLE` 選取父 Node，僅一般 Node 執行環境使用原生 execPath；新增獨立程序測試。
3. PowerShell 變數／管線接收原生 stdout 可能依字碼頁 950 導致靜默失真。指引命令先設本次程序的 UTF-8 並要求原樣回傳；確需管線解析也先設 UTF-8。新增兩個 PowerShell 版本的原文一致測試；不改系統字碼頁。

採納建議，明記自架主房未納入與活動 JSONL 版本限制。每頁 6000 bytes 維持：目前先保留對序列化、token 與原生上限的餘量，不以未實測的大頁取代完整性驗收。工程索引已補。

第二輪真正 Opus 5.5 確認三項必修均已關閉、沒有新的程式必修，程式可結案；留下的驗收條件為有效 UI 探針、完整測試收據及暫存區核對。主代理其後完成 2014/2014、53/53 及重新暫存的核對，`worker-policy.mjs` 對基準淨差異為 0，三項條件皆完成。複核全文保留於本機 `opus-review-2.md`；上述最後測試由主代理執行，不冒稱審查者親自重跑。

原始測試紀錄與合成驗收收據位於本機 `.runtime/archive/codex-output-truncation-20261027/`；私人原生對話及業務原文不上 Git，也不做真實病例重播。

## 發布與回復

程式 commit：`2188312404c56619bd0d62cb15df2e5e95d72047`；工程文件另行提交，均以 `cebce33d00e9d55d63cc7ea6e72a06d2d3813021` 為基準。驗收後合回 main，以既有 `.local/update-ready.json` 指向程式版本；在 K 裡不停止或更新自己。正式部署與讀回尚未完成，依專案發布順序待套用讀回後再 push；東區未更新。不能把來源已驗收當成正式執行中的 K 已生效。

合回前 main 新增圓桌焦點框批 `564a567`／`81ee467`，已保留並統合為 `9013efdb15d6e59e66cbd9bee9162026f87932a2`；唯一衝突是工程索引新增項目，兩筆皆保留。本批 9 個程式／測試檔對 `2188312` 差異為 0，Opus 所審內容未改。統合版重新建置、完整 `npm test` **2014/2014**（85.9 秒），相關圓桌及模型選單 UI **2/2**，收據 `build-ui-integrated.log`、`full-tests-integrated.log`、`ui-tests-integrated.log`。本批先前的完整 UI **53/53** 與統合後針對補驗分別記錄，不混稱統合後又跑了整套 UI。更新標記以統合版本為準，不覆蓋圓桌批成果。來源差異秘密樣式掃描及 diff 檢查通過，私人收據未納入 Git。

退版沿既有程式版本回復；本批沒有新增使用者資料庫、永久讀取副本、排程、服務或設定，沒有對話資料回復步驟。

## 部署結果

2026-10-27 22:27（臺灣時間）本人按「更新」，Codex 長原文分頁讀取與圓桌焦點框兩批統合部署 `9013efdb15d6e59e66cbd9bee9162026f87932a2`（自 `18b0fe3`）：更新器完整 2,014／2,014；11 個程式檔與正式 runtime 逐檔相同，`dist-ui` 已含圓桌 4px 內距；退版保留 `releases/before-1793111234587`。東區未更新。
