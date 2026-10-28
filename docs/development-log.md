# K 工程索引- 2026-10-28：[舊 Claude 聊天室看不到新派工模型（南區已部署）](claude-prompt-snapshot-20261028.md)：不是漏加 6.1 Terra；Claude Code 原生系統提示快照預設開啟，舊房續接沿用建立當天的派工清單、協定與工作區說明。Claude host 改傳 `--system-prompt-snapshot off`，真實 CLI 實測續接改用新內容（含舊房）。完整 2,014／2,014；真正 Opus 5.5 複查可合併，最低版本意見未採納並註明東區須 ≥2.1.285。程式 `8859fff`，10-28 21:40 由本人按鈕部署，更新器 2,014／2,014、正式檔案與執行中程序參數讀回通過；push 讀回 `6efe305`；東區未更新。



AI 查過去的修正、部署與決定從這裡開始。每份文件一行，依主題分組、新的在上。2026-10-14 改版前的逐條詳細摘要見 [工程索引歷史全文](development-log-history-20261014.md)。

## 目前狀態

- 2026-10-29：[三核心主代理與子代理模型完整開放（南區已部署）](native-model-catalogs-20261029.md)：本機原生目錄核對 Codex 8 款、Claude 12 款皆已全列；Antigravity 原本只接 Gemini Flash，補上其原生提供的 Sonnet 4.6、Opus 4.6 Thinking、GPT-OSS 120B，主代理與子代理共用正確核心路由。真正 Opus 5.5 兩輪複查通過，完整 2,024/2,024；55 項 UI 均有通過結果（54 全套同輪、相關 5 項定稿補驗），未逐款真推論。03:24 本人按鈕部署 `2300e14`，更新器 2,024/2,024；19 檔 Git 正規化 blob、介面資源與 health 讀回通過，退版三份；已推送並核對遠端 SHA，東區未更新。

- 2026-10-29：[工作區上下移動與電腦、手機同步（南區已部署）](workspace-manual-order-20261029.md)：工作區選單補上上移／下移，沿既有私人偏好與 SSE 共用順序；保留釘選優先、空工作區、新工作區尾加及既有對話順序。真正 Opus 5.5 兩輪複查完成，異常空路徑問題已修；最終完整 2,017/2,017、UI 同輪 54/54，電腦／手機雙向同步、重整、服務重開實測通過，非 Android 真機。中途既有時序測試一次失敗及串行補驗詳見正文。01:43 本人按鈕部署 `2e02f42`，更新器 2,017/2,017；正式八檔、前端產物、health 讀回通過，退版三份；push 讀回 `f87baa8`，本節純文件收尾另提交推送，東區未更新。

- 2026-10-28：[聊天室常駐模型與推理程度（南區已部署）](composer-model-effort-20261028.md)：既有 Claude 輸入列補上推理強度，手機模型與強度分行，長強度換行保留全文；沿用現有按鈕與設定，不改核心。完整 2,014／2,014、最終建置 UI 同輪 54／54；真正 Opus 5.5 兩輪複查，窄螢幕長文字問題已實測修正。02:57 由本人按鈕部署 `3c22535`，更新器 2,014／2,014、正式三檔與建置產物讀回通過、退版三份；push 讀回 `7445afb`，本節純文件收尾另提交推送；東區未更新。

- 2026-10-27：[Codex 長原文分頁讀取與截斷補讀（南區已部署）](codex-lossless-reading-20261027.md)：初次必要原文不為省額度先摘要或刪段；沿原生 shell 權限分頁，保留版本及連續範圍，接入主房、K GPT 工人與 Codex 討論入口。真正 Opus 5.5 兩輪複查，三項必修已關閉；針對 90/90、完整 2014/2014、UI 53/53 通過，本房原生回傳 9830 bytes 逐 byte 還原一致。程式 `2188312` 與圓桌焦點批統合為 `9013efd`，整合後完整 2014/2014、相關 UI 2/2；10-27 22:27 由本人按鈕部署 `9013efd`，更新器 2,014／2,014、11 個程式檔讀回通過；東區未更新。指引不等於所有原生工具已強制防漏。

- 2026-10-27：[圓桌面板焦點框被切斷（南區已部署）](roundtable-focus-ring-20261027.md)：本人指出右上角討論場次選單的棕色焦點框上緣被截斷。全站焦點框畫在元件外 4px，圓桌裁切溢出；面板加 4px 內距，圓桌實測新增焦點框幾何檢查（修改前失敗、修改後通過）。完整 2,007／2,007、UI 同一輪 53／53。程式 `564a567`，併入 `9013efd` 於 10-27 22:27 由本人按鈕部署、讀回通過；東區未更新。

- 2026-10-27：[圓桌面板：按鈕要看得出是按鈕（南區已部署）](roundtable-button-affordance-20261027.md)：本人最在意可按元素平常就要像按鈕。圓桌沿用既有 `.primary`／`.secondary`／`.danger`：開啟圓桌、停止討論、補充給此人、閱讀鈕、發言卡片、整理收合標題、手機參與者切換都有外框；另加靜態狀態色點、座位色條、主持人淡底、「看全文 ›」。Flash 討論設計、Opus 實作與複查、Astra xhigh 抓出 3 處已採納。完整 2,007／2,007、UI 53／53、圓桌與討論實測通過。程式 `18b0fe3`，10-27 21:20 與額度文字批統合由本人按鈕部署，更新器 2,007／2,007、正式檔案讀回通過；東區未更新。

- 2026-10-27：[討論額度受阻的狀態文字（南區已部署）](discussion-quota-wording-20261027.md)：只修前端顯示，明示誰額度用完、官方恢復時間與仍在回覆者；討論流程與原始紀錄不變。真正 Opus 5.5 兩輪複查完成，完整 2,007／2,007、UI 53／53、定稿補驗 6／6、桌機手機額度情境通過。程式 `e37650c`，10-27 21:20 與圓桌按鈕批統合為 `18b0fe3` 由本人按鈕部署、正式讀回通過；東區未更新。

- 2026-10-27：[討論提示、手機排序同步與一次性後端檢查（南區已部署）](backend-audit-20261027.md)：討論無輸出提示只留該場紀錄；手機／電腦共用側欄排序。修正佇列保存失敗、留言保留、排程補送與壞規則、討論主持／交接／停止、歷史工單核對、成果串流與核心退版指標；原生目錄已確認 GPT-6.1 Terra，補三處選單回歸。真正 Opus 5.5 複查完成，固定程式 `ee909e3`，開發及更新器完整各 2,007／2,007，53 項 UI 均有通過結果（52 項同輪、原生檔案假核心對齊後補驗 6／6）。本人 16:58 按鈕部署成功；17:01 正式 48 個變更檔案、前端產物、health 與退版目錄讀回通過，更新標記已消退。Android 真機、真正 Terra 推論與東區未實測，限制及收據見文件。

- 2026-10-27：[三核心共同記憶（南區已部署）](common-memory-20261027.md)：私人正本集中維護偏好，`MODEL_PROTOCOL_GUIDANCE` 只留協定。Opus 試做、Astra 收尾、真正 Opus 複查及 Astra 最後採納完成；程式 `c40ed70` 已由本人按鈕部署，更新器 1,981／1,981、26 檔 runtime 讀回通過。GPT 舊主房實際收到正文，fresh 原生子代理可沿短指標讀源；Gemini／Claude 真工人不另查檔也能回覆正確版本與原文。Gemini 舊房熱讀／總預算／其他原生入口仍待驗證；CaseAgent 24KB 截斷未因此解決。私人原文與原生記錄不上公開 Git，東區未更新。

- 2026-10-27：[多核心記憶界線](codex-native-entry-parity-20261027.md#各原生核心與-k-通用記憶的界線)：本人裁決原生記憶各核心獨立，K 通用記憶／規則另分；單核經驗不自動搬到他核或升格通用，新增核心亦同。只記錄架構邊界，不搬記憶、不改核心或重啟 K。

- 2026-10-27：[GPT 原生入口與分工](codex-native-entry-parity-20261027.md)：查明 Codex 原生規則載入 32 KiB 會截掉 CaseAgent 尾段、三個子代理是可調預設；南區已將專案規則設 64 KiB、補齊兩個既有 skills 連結、並行容量設 64，原生 memories 試用尚不能稱跨房記憶已修好。共用分工保留 GPT 額度做病例討論及必要技術判斷，Flash 執行；等待提示依 active goal 與各入口工具分流，不新增等待器。Astra 查核、Opus 審核修兩項；完整 1966/1966、Opus 最終複核通過，南區已按鈕部署 `04d0b96`，runtime 與來源／前端檔案讀回通過；新核心實際 65 名額確認，排程四筆可讀，東區未更新。 與排程頁統合為一次更新，部署讀回已完成，GitHub 收尾由本輪主代理統一執行。

- 2026-10-26：[排程頁](schedule-page-20261026.md)：本人想像 Codex「已排程」、DSH「自動化任務」那樣獨立看排程。側欄「新對話」下方新增「排程」，主畫面中間列出全部排程（使用中／已暫停／已結束、送進哪個房、下次與接下來三次、上次結果），可開啟聊天室、暫停／恢復、刪除；建立與改時間仍用說的，送達仍綁聊天室；電腦與手機都可用（本人：K 是私人訂製，不是給大家用的產品）。參考 DSH 約 9,700 行的排程頁只取最小部分。排程頁蓋在對話上，草稿、聽寫、閱讀位置與右側面板都保留。Flash 兩輪實作、Opus 逐行複查修 7 處、Sol 審查 6 項＋複核 2 項全部處理；完整 1965/1965、介面 52/52。同時更正：見觀 SEO 的 Windows 排程 10/24 已移除（10/26 實查），不會重複執行。已與 GPT 原生入口修正統合，由本人按鈕部署 `04d0b96`；runtime、實際前端與四筆排程讀回通過，GitHub 統一收尾，東區未更新。

- 2026-10-26：[Claude 聊天室從指定結論原生分支，南區已部署](claude-fork-at-message-20261026.md)：原本 Claude 只能從最新結論分支，是 K 沒接上原生 `--resume-session-at <uuid>`（隱藏參數，print 模式＋`--resume`）。助理訊息記下原生 UUID，較早結論可原生截斷分支；本版之前的舊回覆仍只能從最新結論分支。分支失敗改為恢復原對話畫面。Flash 實作、Opus 複查修改、Sol 必修 2 項已處理。Claude 測試 162/162、介面 51/51；程式 `04193bd`，10-26 15:12 本人按鈕部署、讀回通過；真實截斷分支待本人實測。

- 2026-10-26：[GitHub 儲存庫大整理](github-repo-cleanup-20261026.md)：沿用本機 `gh` 登入，不另做 K 連接器。23 庫盤點後依本人決定：看盤助手停每日報告、關 Pages、封存並移除本機副本；CaseAgent_Solo、參賽、BodyAlign、SpineVision 封存；空殼 single-store-runtime 確認無依賴、保存兩份筆記後刪除；覺醒水晶未完成的客戶端燈號修正提交上傳；帕魯 DPS 舊分支／worktree／stash 收乾淨（未驗證功能留分支）；資源工廠 GPT 未提交工具收入 main、未測多人修改留分支。patient-portal（CaseAgent LINE 工作台部署來源）未動。Sol 只讀驗收可結案，必修 1 項與補漏 1 項已處理。第二輪：KAI 三個周邊庫封存；dsh-official-zh-tw、kai-harness 依本人定為學習用保留，改說明、關 Dependabot 與 KAI Actions，原本只在本機的 KAI 最終版（設為預設分支 `kai-final-20260905`）與 DSH 0.2.1 備份上去（本人同意略過官方 lefthook 檢查）。官方 DSH 桌面版升到 0.2.1-rc.3（繁中客製重建、補「介面自訂」翻譯、回收保護實測可用）。本機 `D:\DSH架構`（只放 DSH，舊版集中到「舊版本」）與 `D:\KAI`（KAI 兩份從 DSH 搬入、周邊移封存）已整理並重寫 README。K 程式未改、不需部署。

- 2026-10-26：[聽寫與批次轉錄共用顯卡：先到先用，後到的聽寫改用 CPU，南區已部署](dictation-gpu-share-20261026.md)：批次逐字稿指定顯卡先跑，聽寫只看剩餘顯存也上顯卡，兩邊在 4060 搶到 100%；另一房的長聽寫被「同時只能一筆」擋下、錄音被丟掉。本人定「先到先用」：兩專案共用 Windows 具名 mutex，後到的聽寫直接 CPU（8 緒），後到的 GPU 批次等鎖；鎖外再以 3 次取樣避開其他持續負載，查詢失敗走 CPU。K 聽寫可同時 3 筆（id 配對預熱），失敗保留錄音並提供「重新辨識」（本人按才送）。Astra 討論、Flash 實作、Opus 複查，Sol 7 項必修＋複核 1 項全部處理；真模型四情境（空閒顯卡／鎖被占／兩筆同時／批次後到）符合設計。完整 1956/1956、介面 51/51、批次 104/104。K 程式 `dec52f8`（含成果欄批），10-26 12:07 由本人按鈕部署、讀回通過；錄音轉文字 `16df134`；東區未更新。

- 2026-10-26：[成果不再自動打開右側面板，南區已部署](results-panel-no-autoopen-20261026.md)：本人表示從未使用成果欄、不要自動打開也不要提示，需要時直接問 AI。電腦版成果檔不再打開面板或切分頁，只有本人按面板按鈕或首次看到 K 瀏覽器分頁時才開；手機不變、面板保留。新檢查在舊程式失敗、新程式通過；完整 1952/1952、介面 51/51（語音切房單獨重跑通過）。Opus 主代理實作與複查。程式 `e949bf1`，10-26 12:07 與聽寫共用顯卡批合併為 `dec52f8` 由本人按鈕部署；東區未更新。

- 2026-10-25：[桌面控制（Computer Use）`k_desktop`，南區已部署](desktop-control-20261025.md)：本人問 K 有沒有 Computer Use；Sol 查證三家原生能力在 Windows 的 K 都用不到（Codex 只在桌面 App、Claude CLI 僅 macOS、Antigravity 只有瀏覽器）。本人決定接開源元件，授權在專案內安裝 Windows-MCP（Python 3.14，`.runtime/desktop-control`）。`k_desktop` 只接三家完整存取權主對話（原生子代理會繼承、K 工人不給），本人在私有狀態登記一次安裝位置；排除指令／檔案／登錄檔／程序／網頁工具、關閉使用統計、固定 stdio。本人要「和 Codex App 一樣」不要接手功能：0.8.8 一啟動就裝全域鍵鼠 hook 且無法關閉，改裝 GitHub 固定 commit `0db91ff` 並用 `--no-control`。Flash 實作、Opus 複查；Sol 三輪抓出 Codex 改權限沿用舊 MCP（改為該 thread 已載入且狀態相反時重建 host、逐 thread 記錄、resume 送出前先記錄）與 ControlStatus 排不掉，均已處理，第三輪「可部署」。K 沒有按 Esc 停止，停手用停止鍵或傳訊息。完整 1952/1952（含瀏覽器批）。10-25 12:54 由本人按鈕部署 `8eab458`（更新器 1952/1952、退版三份），Claude 主對話正式讀回 k_desktop 可用、無鍵鼠 hook；push 讀回 `5e540dc`。GPT／Gemini 主對話實測可用，GPT 連會改變狀態的 Notification 也不需核准；東區未安裝。

- 2026-10-25：[K 瀏覽器助手連線進度與失敗原因回報，南區已部署](browser-connect-telemetry-20261025.md)：無痕連線連續兩次只得到 90 秒逾時，錯誤只留在背景連線頁，本人按擴充「重新載入」才恢復、根因查不回來；本人要求 K 專用瀏覽器像車子一樣到處有感測器。連線頁現在經本機旁路回報每一步與失敗原因，K 立即帶原因失敗或在逾時時指出停在哪一步；原生開頁失敗附固定步驟名；擴充斷線保留關閉原因。回報失敗一律略過、不影響連線。Flash 實作（第一次因模型目錄查詢逾時未啟動），Opus 修旁路缺 `error` listener 可能讓 K 崩潰等 4 處，Sol 抓出連線中途斷線原因遺失 1 項已修並複核可部署；完整 1942/1942。程式 `5f8b7e0`；10-25 12:54 與 desktop-control 同批由本人按鈕部署 `8eab458`，`Setup-K-Browser.ps1` 換上擴充 0.1.5，真 Chrome 一般／無痕連線實測通過；東區未更新。

- 2026-10-25：[長指令心跳被誤認為 Claude 原生子代理（待本人按「更新」）](native-child-heartbeat-20261025.md)：主代理的 Bash 跑超過 2 分鐘時，Claude Code 送出的心跳帶著該 Bash 的 id 當上層，K 把它建成沒有型號、永不結算的「原生子代理」，快覽一直顯示「模型待確認 · 執行中」並擋住分支。現在已知上層只有 Agent／Task／Skill 建立子代理，未知上層的心跳不建。Flash 實作第一版，Sol 抓出 3 項（Agent 首筆心跳漏建、測試未分開、Skill 被擋）全部採納，Opus 修正並以突變驗證測試；Sol 複核可部署。完整 1928/1928。程式 `943c44d`，已寫更新標記；東區未更新。

- 2026-10-24：[聊天室檔案連結左鍵改為「在檔案總管中顯示」，南區已部署](file-link-reveal-20261024.md)：本人在 CaseAgent 點 mp4 連結時跳出空白預覽、標題是百分比編碼，實際需要的是跳到檔案位置拖進 LINE。桌面版左鍵現在開檔案總管並選好檔案，沿用右鍵的原房來源、主 frame、檔案存在檢查，失敗顯示原因不重試；右鍵四項不變；連結提示與訊息檔案預覽標題改顯示中文。網頁版／手機無法叫電腦開檔案總管，左鍵維持預覽。Opus 實作、Astra 收尾修 3 項（失敗無提示、成果檔名誤解碼、圖片 alt），Opus 審過採納；隱藏 Electron 實測左鍵只呼叫一次 showItemInFolder。10-24 18:01 由本人按鈕部署 `3921e9f`（讀回通過）；push 隨 10-25 心跳修正一併處理；東區未更新。

- 2026-10-24：[Claude 主對話的多一層派工，南區已部署](claude-nested-delegation-20261024.md)：本人要的分工是 Fable 只討論（額度少）、Opus 統籌、Sol 後端／抓 bug／搜尋、Flash 雜事與大量實作，不想再手動複製交接檔。Claude 主對話派出的 Claude 工人現在有自己的第二層 `k_luna`（權限同派出者、核准照樣給本人、小工人不能再派），交差或取消時先確認所有小工人停止才算結束，停止未確認可重試、不重播；明細頁列出小工人；GPT／Gemini 主對話不變。Flash 實作、Opus 複查修 6 處、Sol 兩輪 8＋2 項（6 項屬實已修、MCP 可用性改實測、GPT 原生子代理可呼叫 `gemini_start` 的既有缺口另案）；真 Claude Code 工人在三種權限都能 `luna_start`→`luna_wait`；接在定時喚醒之後完整 1917/1917。程式版本 `3a870b7`，10-24 15:59 隨更新按鈕修正 `4873890` 由本人按鈕部署；東區未更新。

- 2026-10-24：[定時喚醒聊天室，南區已部署](room-schedules-20261024.md)：起因是見觀 SEO 的 Windows 排程因資料夾改名失敗、每次閃黑窗；本人要的是像 Codex App 自動化那樣到時間叫醒 AI，K 幾乎不關，錯過時開機後補一次。開源調查（主代理＋Sol）沒有能直接叫醒 K 聊天室的元件；實讀 schedjs 後改採 `croner@10.0.1` 只算時間，K 自己每 30 秒檢查、先存「送出中」再送，重開不重送。AI 工具 `_schedule_add/list/update/remove` 只在主聊天室；到時走一般送出（忙碌排隊、背景開房不切畫面），失敗在該房留協調訊息。Flash 實作、Opus 逐行複查修 8 處、Sol 審查 6＋1 項全部處理並複核；完整 1904/1904。已知限制：Claude 原生子代理會繼承排程工具（同 room_note）。10-24 15:59 隨 `4873890` 由本人按鈕部署；東區未更新。

- 2026-10-24：[K「更新」按鈕，南區已部署](self-update-20261024.md#審核與部署狀態)：本人要求像 Codex App 一樣只有一個按鈕，放在側欄「⚙ 設定」右邊、手機可按。AI 驗收合回 main 後寫 `.local/update-ready.json` 才出現；按下時同一請求檢查全部閒置，忙就一句話不更新；系統匣啟動器正常關閉 K（不強制）後交棒給 `scripts/Self-Update-K.ps1` 跑 `Update-K.ps1` 並重開，只在失敗時提示；手機顯示更新中並自動重連。Flash 起頭後卡在自寫的測試，Opus 接手完成與簡化；GPT-6 Astra 六輪後端抓錯（閒置檢查擴到背景命令、子代理終端、討論與所有進行中的寫入請求；PowerShell 5.1 stderr 誤判；交棒後不再二次關閉；手機只重整一次）後結論「可部署」。完整 1888/1888、介面 51/51、啟動器編譯通過。10-24 上午第一次 K 外部署 `acb5756` 時更新器測試 1887/1888 停止、未套用：Windows PowerShell 無主控台時把進度以 CLIXML 寫入 stderr，失敗原因被誤取；修正為 `26619d6` 並以重現測試證明。09:45–09:47（臺灣時間）由 K 外 Codex 部署 `26619d67816e9f2f63650d28d4f8a9b0e0ad8a77`，更新器 1888/1888、讀回通過、退版三份；push 讀回 `1ba95e3`。下午 13:56 本人第一次從手機按下按鈕：建置與更新器內 1917 項測試都通過，卻在套用前 8 秒被本人從桌面手動點開的 K 擋下（父程序 explorer），未套用，訊息又誤導成「請先離開並停止 K」。修正（Fable，`407b574`）：更新腳本持具名 mutex，期間手動開啟動器只提示「K 更新中」、不開 K；套用時先把仍在執行的舊啟動器 exe 改名移開；失敗訊息改成按鈕用語；手機提示寫明約 2～3 分鐘。Opus 5.5 兩輪複查（第一輪中度問題「exe 被占用」已處理）。本人隨後指出更新期間兩邊都看不到狀況才會去手動開 K，要求像一般更新器有獨立視窗：更新腳本現在開一個工作列視窗「K 更新中」（K 圖示、可縮小、顯示步驟與經過時間、K 回來自動關閉；隱藏啟動的程序要再呼叫一次 ShowWindow 才看得到，以實驗證實），手機提示改為「畫面留著不用動，先離開也可以」，用語依本人改成「…中」「大概要」；Opus 第三輪可部署。完整 1920/1920、介面 51/51、啟動器編譯通過。15:57–15:59（臺灣時間）本人從手機按鈕部署 `4873890`（含定時喚醒與多一層派工兩批）：更新器 1920/1920、電腦出現「K 更新中」視窗、自動重開、手機自動重連，讀回通過、退版三份，按鈕第一次成功的端到端；push 讀回 `662397e`。東區未更新。

- 2026-10-23：[API 模型當唯讀諮詢子代理，南區已部署](api-consult-worker-20261023.md#部署狀態)：本人要求子代理可選討論用 API 連線（DeepSeek 等），自動選擇排最後、只在本人明確要求諮詢時派；唯讀讀檔與搜尋、API 計費、不進主模型。Sonnet 5.5 實作（Flash 因憑證身分錯誤未能開始）。合併已部署的 main 後，Astra 兩輪（工作區外讀檔、連線鎖、省略型號沿用 API、既有「舊網址＋新金鑰」等 4 高 3 中）與 Fable 第二審（3 低）意見均已處理；完整 1869/1869、UI 50/50。2026-10-24 00:04–00:06（臺灣時間）由 K 外 Codex 部署 `7cfacd8e1a7c45de9070607ef5c653de18310abb`，更新器 1869/1869、讀回通過、退版三份；第一次因 Opus 殘留的卡住測試程序停在閒置確認，清除後重跑。Windows 憑證區一個檔案修改時間在部署中變動、來源未查明（K 未執行、測試不寫真實憑證），API 連線設定檔未變；push 讀回 `e98aeb6`。部署後經本人同意以 DeepSeek-V4.1-Flash 實測諮詢，讀工作區檔案並正確回覆、送回原對話；東區未更新。

- 2026-10-23：[Gemini 派工被拒：agy 1.4.6 登入紀錄改格式，南區已部署](gemini-identity-agy146-20261023.md#審核與部署狀態)：1.4.6 不再保存 `id_token`、改存 `id_token_email`，K 憑證助手讀不出目前登入身分，所有需同步登入的 Gemini 送出被拒。經本人同意做唯讀結構檢查（只輸出欄位名稱）確認；`Get-Email` 改為沒有 `id_token` 時使用 `id_token_email`，同一次登入判斷也比對 `id_token_email`。完整 1848/1848；修正後助手對真實目前登入唯讀讀出相符帳號。與登入失效修正一起部署；部署後 Flash 實際派工成功、五帳號同步標記清除。東區未更新。

- 2026-10-23：[登入失效時 K 無法自行恢復：Claude／GPT 修正，南區已部署](auth-expiry-recovery-20261023.md#審核與部署狀態)：Claude 5 分鐘成功快取在失效後未作廢、刷新不重查，導致顯示已連線並停用登入；GPT 原生只看登入檔是否存在，同類問題。修正後主聊天室登入失效時 K 自動以預設瀏覽器開官方登入頁（Claude 由官方 CLI 開、GPT 由 K 開經驗證的網址），刷新真正重查，錯誤只在對話內以中文顯示一次，不重送。Flash 實作第一批、Opus 實作第二批，Sol 複查 1 高 2 中 2 低（採納 4 項）；完整 1847/1847、介面 50/50；測試 K 實機驗收 Claude 全程真實、GPT 除「收到 401」一步外真實。另發現 Gemini 派工被拒，已另案修正（上一條）。Astra 最終複查無高中風險、文字修正 1 項。22:27–22:28（臺灣時間）由 K 外 Codex 部署 `0cf673e33087a4b3d856aeea671e77b28e8eaa0b`，更新器 1848/1848、讀回通過、退版三份且最舊者進回收筒；push 讀回 `0ec488379b4d4c8b362a2e278a017f6f2bc3cbae`。正式環境的真實登入失效待日後遇到時確認；東區未更新。

- 2026-10-23：[聽寫預先載入與顯卡／CPU 動態選擇，南區已部署](dictation-prewarm-20261023.md#部署狀態)：開始錄音即在背景載入辨識模型，講 7 秒後停止的等待由約 4.5～4.9 秒降到約 1.2～1.3 秒；依剩餘顯卡記憶體選 float16／int8／CPU，顯卡滿或出錯改用 CPU。Flash 實作、Opus 複查與修正、Sol 兩輪審查同意結案；開發完整 1834/1834、介面同輪 50/50。13:01:13（臺灣時間）由 K 外 Codex 部署 `2bde716cec3d7e6af47e275460f10ad025dfec03`，更新器 1834/1834、正式讀回通過、退版三份；最舊退版被 Windows 直接永久刪除而未進回收筒（只有舊程式，根因待查）。Opus 接續 push，遠端讀回 `f6deee8485210b38141b4ca685cad52c35b1fecb`；真人聽寫實測待本人，東區未更新。

- 2026-10-23：[提問面板超出畫面無法送出](question-panel-overflow-20261023.md)：桌面提問區上限 55dvh 區內捲動、多選恢復緊湊排版；UI 50/50、完整 1821/1821。南區於臺灣時間 02:15:50 部署 `c2544753ea44d553a8a98e4134dc0c595b7b4525`；更新器成功、重跑完整測試 1821/1821，02:16:16 正式版本與建置 CSS 規則讀回通過，退版保留三份。首次 push 後遠端 `a92d21d7767d91ecfb165585d3699fd227946a73`，部署收尾另作純文件 commit 並再次推送讀回；未啟動 K、未做正式介面互動實測。東區未更新。

- 2026-10-23：[舊開發工作樹清理](worktree-cleanup-20261023.md)：`~\.codex\worktrees` 下 6 個已合併工作樹與 3 個未登記殘留資料夾移入資源回收筒；紀錄引用的證據先收進 `.runtime/archive`（41 份核對一致；Sol 驗收後再補存 7 份同名但內容不同的版本，以及 `tests` 內被紀錄點名的 3 組證據）。兩個已合併分支刪除，備份分支保留。工作樹 `node_modules` 有指向主工作樹與正式 runtime 的 junction，先拆連結再刪，正式 K 的套件數、版本與瀏覽器檔案數經核對相符；主工作樹 `node_modules` 目前為空（疑似 10-22 移除工作樹時跟隨 junction 清除），在主工作樹跑測試前須先 `npm ci`。純本機清理，不需部署。

- 2026-10-22：[新對話預設最高權限，南區已部署](new-room-default-full-access-20261022.md)：依本人授權，新對話 GPT／Gemini 預設完整存取權、Claude 預設略過權限提示，自架維持要求核准；預設即本人確認，後端確認檢查不變。程式 `62b7190b18f5a2970156b274904f532ec5966173` 於臺灣時間 22:56:55 部署；更新器 1821/1821、部署前 UI 同輪 50/50，正式來源及建置預設已讀回，退版保留三份。已 push 並讀回 `321067e304063330a1b66d8968a9a6c72cf169ed`，本次純文件收尾另 commit／push／讀回；本人已在正式 K 開新對話確認沒問題；東區未更新。

- 2026-10-22：[長聽寫背景穩定性，南區已部署](dictation-background-stability-20261022.md#正式部署與獨立讀回2026-10-22)：22:10:33（臺灣時間）套用程式 `312caf2da1a791bb03e57f7cd98c32cfb1e1e6d5`，移除前後端 120 秒總時限；切房／隱藏保留停止只填與送出只送原房一次。真正 Opus 5.5 設計、實作及限範圍補修，Sol 獨立驗收；完整 1821/1821、UI 同輪 50/50，正式 825 檔無實質差異、設定僅 version/previous 變更、三份退版，正式產物合成語音 UI 2/2（含 125 秒延遲）通過。22:15:45 前已 push 並讀回文件 `38c9b99`，後續純文件收尾不再部署。K 保持關閉，真人長口述／實際 X／手機實機與東區仍待本人。

- 2026-10-22：[聊天室協調收件匣與 UI 第二、三批，南區已部署](room-notes-20261022.md#正式部署與讀回2026-10-22)：20:39:09（臺灣時間）套用 `47a0ae6f35e733b28fd50ed0b808f81070b1754d`，更新器 1821/1821、824 來源檔與正式版本一致、退版三份；安裝後 UI 49 項通過，語音因測試漏帶路徑，依正式設定補驗通過（非同輪 50/50）。20:49:32 已 push 並讀回；後續純文件收尾不再部署。K 保持關閉，正式跨房留言與目視／操作待本人；長聽寫偶發遺失另待診斷，東區未更新。

- 2026-10-22：[介面視覺層次](ui-visual-hierarchy-20261022.md#正式部署與讀回)與 [Gemini 同帳號派工修正](gemini-dispatch-idle-20261022.md#審核與部署狀態)，南區 17:32:06（臺灣時間）已部署 `2f46ccc1d0a6ccb6e7a8157ebad559fcc1ab20e5`；更新器完整 1806/1806、正式版本與 816 檔核對一致、退版三份。17:34:35 已 push 並讀回相同 SHA；後續純文件收尾不再部署。K 保持關閉，三主題目視與 Gemini 雙聊天室／切換帳號實測待本人；東區未更新。

- 2026-10-22：[Gemini 完整接入與前批提示精簡，南區已部署](gemini-full-integration-20261021.md#部署狀態)：正式版本 `fb2754150a52c685d5fc412d94a931e173d61c15`，更新器完整 1803/1803；runtime.json 與上一版程式保留均已讀回。K 保持關閉，由本人啟動；東區未更新。

- 2026-10-20：[Dolphin 工具模板、UTF-8 與等待相容性，南區連線修正已部署](dolphin-tool-template-20261020.md#南區正式套用與實際檔案讀回)：程式 e049894、測試同步 b21bfb0、部署 c159d253c645f16590f0242e16d97ba4edf49417；開發及更新器完整 1792/1792，真正 Opus 5.5 多輪複查。正式安裝模組單檔韓文翻譯真讀寫／讀回通過；兩路翻譯仍 0 工具／0 檔，不能稱整體可靠。Dolphin 1.2 已下載但測試未通過、不接 K。其他模型設定不變，原小說停止，K 與模型保持未載入；非 Dolphin 停止時序疑慮已記錄、未確認未修改。

- 2026-10-19：[自架本機模型載入相容性與臺灣繁中呈現，南區已部署](selfhost-compatibility-zh-tw-20261019.md#正式套用與發布)：程式 ecdde11、部署 97ad9c90db462dc48479dca7e1841128d9b26dd9；移除 GGUF 不相容選項，原始診斷保留，準備失敗不再重連或喚醒目標接續。選取／準備／權限說明改成誠實的臺灣繁中，原生權限不變，自架自動審查標未驗證。真正 Opus 5.5 實作與四輪複查、主代理獨立驗證；開發與更新器完整均 1787/1787，全部 UI 49/49。另修既有長文字收合捲動競態，未放寬斷言。正式 808 檔、建置文案、設定與三份退版均讀回；首次 push 遠端 SHA 吻合。K 停止、所有本機模型未載入，實測留本人，其他電腦未更新。

- 2026-10-19：[本機模型由 K 背景載入，南區已部署](selfhost-local-loading-20261019.md#正式套用)：補齊「K 選模型即可工作」，不新增參數介面；程式 d8f76cd、部署 3b475475c29bb350dafa197d34a06e3a7d784fd8，聚焦 38/38、開發與更新器完整均 1778/1778，真正 Opus 5.5 無阻擋。804 個來源核對、三份程式退版、私有載入設定與桌面說明已讀回，首次 push SHA 吻合；K 保持關閉、所有模型未載入，實測留給本人，其他電腦未更新。

- 2026-10-18：[K 自行縮小開 Chrome／停止後重連／擴充補開模式視窗，與 Claude TaskStop 工作狀態修正已在南區部署](k-chrome-auto-open-20261018.md#部署狀態)：固定程式 `e67adc1e2ddf17fedfaa0a25a6d3dd838d9a3c1c`，更新器只執行一次、完整 1748/1748，退版 `before-1792259230876`、共保留三份；擴充 0.1.4 的 15 個新建置檔全部吻合，Chrome 路徑保留，同一 K native host 依設定腳本改接 installed 固定入口。K 正常啟動一次，health 200／native；未開 K 專用 Chrome，瀏覽器正式實測交 K 裡的 Claude，其他電腦未更新。本輪另提交部署文件，程式版本不變。

- 2026-10-17：[K 非 Codex 整理第三、四批已在南區部署](k-noncodex-cleanup-20261016.md#部署狀態)：設定視窗拆出 `main.jsx`、瀏覽器兩層合一並移除人類接手（AI 全程背景控制 K Chrome，停手用聊天室）。固定程式 `3d88c934511e2a0ad88665bd743ebafcabd808e0` 由 K 外更新器套用，更新器完整 1732/1732，health 200／native，退版 `before-1792237842840`；Fable 與 Sol 的意見已處理、Sol 同意。正式設定視窗目視與「用瀏覽器時按停止」實測待本人；其他電腦未更新。

- 2026-10-17：[Gemini 試算表單列寫入已在本機部署、發布](sheets-write-row-20261017.md)：原 `f92a548` 經主代理覆核並 rebase，固定程式 `a81475f345319c22413cb30040db90925fe65c1b` 已由 K 外更新器套用；分支與更新器完整均 1739/1739，health 200／native，私人寫入映射已合併並讀回。真正 Flash 新聊天室只讀原生工具定義，read-only 無 writer 許可；正式試算表零呼叫、零寫入。首次 push 與遠端讀回 `90a0846` 相符，其後僅部署文件收尾，不重啟；其他電腦未更新。

- 2026-10-17：[Codex 點數與重置次數顯示](codex-credits-display-20261017.md)：額度視窗顯示官方剩餘點數、可用重置與到期時間，只顯示不接使用重置；Claude 無官方欄位不接。程式 `c81575357db6997bd68014403c0a10d7c855f5ed`，1736/1736，Sol 複查意見已採納。2026-10-17 東區已部署並讀回（runtime c815753、health native、Windows 聽寫保留、退版 before-1792211163138），本人對照 ChatGPT 確認點數／重置；`01a7ee6` 已 push 並讀回遠端。

- 2026-10-17：[東區更新修復與部署](dongqu-update-handoff-20261017.md)：46ec4604 更新被交接 receipt 並行保存競態擋下；修正為每檔依序保存＋決定性回歸測試，程式 `7271fdefa2d27a005a996e06076c9c12875195d3`，完整 1735/1735、Opus 5.5 子代理複查無阻擋。東區已部署，health native、792 檔核對、Windows 聽寫保留、退版 before-1792179282418；未 push，南區仍 46ec4604。

- **三聊天室整合已正式部署、發布**：南區程式 `46ec46040d3ee0df1a4fc82cfd5f21a6591800a3`，包含本機／雲端 Gemma 主代理、Gemini 試算表唯讀工具、Windows 檔案動作及已驗收整理；另修更新器回收與通知收尾漏喚醒。Claude 137/137、開發與更新器完整 1734/1734、真正 Opus 無阻擋。792 來源檔吻合、退版三份、K 正常啟動一次，health 200／native；正式試算表唯讀 metadata 成功。本機 Gemma 可辨識、雲端尚未租機。首次 push 遠端與本機 `1545edc` 相符，後續僅本輪部署文件，不重啟。兩次原錯誤與修復證據保留。見 [整合紀錄](integrated-deploy-20261016.md)。

- **Gemma 本機／雲端主代理已隨整合部署**：原功能 `f414de3`，沿用 Codex 原生核心；本機寫檔、核准取消、原對話重開、K MCP 與讀檔已有真測，雲端未租機。該批完整 1728/1728、UI 48/48、真正 Opus 無阻擋，整合另跑完整 1734/1734。協定差異僅作工具格式轉換，不另加小說限制。見 [本批紀錄](gemma-main-agents-20261016.md) 與上述正式讀回。

- **Gemini 核心現況**：2026-10-16 讀回 Antigravity 1.4.0 已選用；五帳號的 Gemini 4 Argon 仍由官方模型目錄標為停用。獨立額度查詢的 CLI 識別修正已在南區部署，正式五帳號均已取得最新官方額度，未切換登入。見 [本次查證與修正](gemini-cli-quota-20261016.md)。
- **前一正式版本（南區）**：2026-10-16 16:52 套用 `0d14cbd14c3f5c841dda32db254665685ac0d5e6`（Gemini 獨立額度與原生完成漏通知修正）；開發兩輪及更新器完整測試均 1697/1697，介面建置成功。當時 `.local/runtime.json` 版本吻合，previous 為 `be96457721bcade1249b6ad2b36c89a7e7f7377a`；啟動一次後 health 200／native，五帳號正式額度恢復，退版三份、無 prepare 壓縮檔殘留，首次 push 後遠端 SHA 吻合。見[本批部署讀回](fresh-target-timeout-20261016.md#部署狀態)；現行版本以上述整合部署為準。
- **已驗收並發布**：本人確認 Claude 的 350 檔／前端產物一致性與啟動驗證通過，正式 health 再查 **200／native**；首次 push 後本機 `main`、`origin/main` 與 GitHub 遠端均為 `16b40ac`，其後僅補本文件與[部署收尾](code-split-20261014.md#claude-驗證與-github-發布收尾2026-10-14)，不再部署。本批含[存檔遇防毒占用](atomic-write-lock-20261014.md)、[整理與防再生](runtime-cleanup-20261013.md)、[大檔拆分](code-split-20261014.md)；桌面工具與最舊退版回收的驗證限制保留於紀錄。
- **東區**：等本人到當地再更新；南區部署或 push 不代表東區完成。步驟見 [Git 安裝更新](git-install-update.md)。
- **規則**：根目錄 `AGENTS.md`（現行）；各日決定原文見 [AGENTS 歷史全文](agents-history-20261013.md)。
- **證據位置**：舊紀錄中的 `.runtime/<名稱>` 現在在 `.runtime/archive/<名稱>`，對照見 [.runtime 整理](runtime-cleanup-20261013.md)。

## 維護方式

- 每批工作的細節寫在該批文件；本索引只在對應主題最上方加一行 `- MM-DD [標題](檔名.md)`，不再寫長摘要。
- 正式部署後更新「目前狀態」。同一批的候選與部署寫在同一份文件，不另開一行。

## 主題索引

### 安裝、啟動、更新與發布

- 10-17 [東區更新準備：46ec460 候選、首次外部更新中斷紀錄](dongqu-update-20261017.md)
- 10-16 [三聊天室成果整合、更新器回收與正式部署](integrated-deploy-20261016.md)
- 常設 [K：Git 下載、安裝、更新與退版](git-install-update.md)
- 10-11 [附件可信投影與 remote compact 提示正式安裝](trusted-attachments-deploy-20261011.md)
- 10-11 [原生調度與本人目標意圖正式更新](native-coordination-deploy-20261011.md)
- 10-10 [2026-10-10 三聊天室成果整合更新](integrated-update-20261010.md)
- 10-09 [東區正式套用已驗收版本 1a45a734](dongqu-update-20261009.md)
- 10-09 [公開來源發布與東區取用](public-source-release-20261009.md)
- 10-07 [南區三項 K 修正：已套用、保持關閉](k-fixes-deploy-held-20261007.md)
- 10-03 [南區下載新版、Gemini 啟用與正式讀回](south-main-update-20261003.md)
- 10-03 [Flash 與 Gemini 多帳號：Claude 複查及南區部署](flash-deploy-claude-review-20261003.md)
- 10-03 [東區更新合入 main 與南區取得方式](dongqu-main-publish-20261003.md)
- 10-02 [東區 Windows 10 安裝與內建聽寫](dongqu-install-20261002.md)
- 10-01 [README 歷史留存：2026-10-01 現況整理前](readme-history-before-20261001.md)
- 10-01 [README 現況整理與使用者決定](readme-current-20261001.md)
- 10-01 [K HARNESS：東區用最新版本 Git 發布](r3-git-release-c-20261001.md)
- 10-01 [K HARNESS：新機補修 Git 發布](r3-git-release-b-20261001.md)
- 10-01 [Git 安裝／更新工程紀錄](git-install-update-20261001.md)
- 10-01 [K HARNESS：R3 集中複查](concentrated-review-r3-20261001.md)
- 09-30 [R3 工作單：盤點剩餘項目（2026-09-30，Opus 起草，交 Astra 實作）](r3-workorder-20260930.md)
- 09-30 [R3-2：清理舊架構、可選 GPT 子代理、Sonnet 5.5](r3-2-cleanup-20260930.md)
- 09-30 [R3-1 正式套用與後續複查](r3-1-release-20260930.md)
- 09-30 [R3-1 複查補修：取消重連後不再假裝已連線](r3-1-reconnect-cancel-fix-20260930.md)
- 09-30 [R3-1 候選交接：官方目錄、連線取消、強制退出與原子寫入](r3-1-20260930.md)
- 09-30 [R2 試用升級與 GPT-6.1 Sol](r2-sol61-release-20260930.md)
- 09-30 [R2 複審修正：封存刪除相容與排除共享知識](r2-archive-compat-no-shared-knowledge-20260930.md)
- 09-30 [Opus 複查：R3-2 正式版](opus-review-r3-2-20260930.md)
- 09-30 [Opus 複查：R3-1 正式版](opus-review-r3-1-20260930.md)
- 09-30 [Opus 複審：R2 存檔競態小修](opus-review-r2-savefix-20260930.md)
- 09-30 [Opus 複審：R2 候選 20260930](opus-rereview-r2-20260930.md)
- 09-30 [本機 Claude Code／Codex 更新（2026-09-30 20:44）](local-cli-update-20260930.md)
- 09-29 [R1 留底與 R2 候選](r1-r2-release-20260929.md)
- 09-29 [Opus 審查：R2 第一批候選](opus-review-r2-batch1-20260929.md)
- 09-28 [K 同專案共享知識＋Jev R1 — 2026-09-28](shared-knowledge-jev-r1-20260928.md)
- 09-27 [2026-09-27 K 停止卡住修復](shutdown-repair-20260927.md)
- 09-27 [2026-09-27 明確退出不再被工作狀態阻擋](explicit-exit-20260927.md)
- 09-26 [原生瀏覽器正式更新紀錄](native-browser-release-20260926.md)
- 09-26 [系統匣啟動器相容入口](launcher-entry-20260926.md)
- 09-26 [隔離版 K owner supervisor 與托盤接線](isolated-launcher-supervisor-20260926.md)
- 09-26 [閒置聊天室原生資源回收](idle-room-release-20260926.md)
- 09-26 [整批收尾與正式更新](closeout-20260926.md)
- 09-25 [紙、墨、黃銅介面正式切換](visual-formal-switch-20260925.md)
- 09-24 [已完成 Luna 歷史工作阻止停止：修正與驗證](shutdown-fix-20260924.md)
- 09-24 [正式 47831 補充驗收結果](formal-acceptance-20260924.md)

### 換房、接續、目標恢復與失敗處理

- 10-22 [聊天室協調收件匣：AI 留言到他房、本人下次送出時帶入一次（Sol 三輪覆核通過，南區已部署 47a0ae6、已 push 讀回，正式跨房實測待本人）](room-notes-20261022.md)
- 常設 [K Harness 交接說明（current-handoff）](current-handoff.md)
- 10-13 [工人等待、晚到完成與同目標恢復](worker-wait-goal-recovery-20261013.md)
- 10-13 [更新後四房唯讀追蹤](four-room-followup-20261013.md)
- 10-12 [原工作與成果核對接連失敗：限定診斷](stream-recurrence-diagnosis-20261012.md)
- 10-12 [2026-10-12 原生子代理終態與舊提示核實修正候選](native-terminal-state-fix-20261012.md)
- 10-12 [長任務再次失敗：原生錯誤狀態與 Windows 工作列漏通知](native-recovery-recurrence-20261012.md)
- 10-12 [各聊天室獨立載入與已受理交接收尾](independent-loading-handoff-20261012.md)
- 10-12 [已受理交接被正常收尾誤取消](handoff-settlement-race-20261012.md)
- 10-12 [空白新聊天室指定主模型與推理程度](fresh-chat-model-selection-20261012.md)
- 10-12 [真正空白新聊天室與 AI 交接](fresh-chat-handoff-20261012.md)
- 10-12 [四個翻譯聊天室後續修正與 Flash 等待交接](four-room-followup-fixes-20261012.md)
- 10-12 [Codex 429 單次成果核對與交接修正](codex-429-recovery-20261012.md)
- 10-11 [三項深層根因：分層查證與未解界線](three-root-causes-20261011.md)
- 10-11 [原生子代理警告 stale／重複候選與學院再次失敗查證](native-terminal-notice-reconciliation-20261011.md)
- 10-11 [原生子代理終態自主核實與必要調度候選](native-terminal-autonomous-reconciliation-20261011.md)
- 10-11 [原生主回合失敗後：先核對成果再接續](native-goal-recovery-20261011.md)
- 10-11 [Codex 目標：本人操作的原生意圖記錄補接](native-goal-provenance-20261011.md)
- 10-11 [長任務可重現 K 缺口修補](long-task-repair-20261011.md)
- 10-11 [分支附件可信投影修正候選](fork-attachment-trusted-projection-20261011.md)
- 10-10 [三聊天室連續錯誤：原生紀錄唯讀核對](three-room-stream-errors-20261010.md)
- 10-10 [2026-10-10 聊天室更新鎖／切換回跳修正與原生錯誤補查](room-lock-fix-20261010.md)
- 10-10 [原生失敗與 Pick Me Up 切換回跳：真正 Opus 5.5 調查討論](native-failure-opus-investigation-20261010.md)
- 10-10 [人用分支啟動逾時／側欄消失修正](manual-fork-startup-visibility-20261010.md)
- 10-10 [Gemini 分支附件第二意見與實證反例](gemini-fork-second-opinion-20261010.md)
- 10-10 [分支歷史附件完整修復候選／Opus 主導診斷](fork-inherited-attachments-20261010.md)
- 10-10 [Codex 原生串流失敗：診斷與候選呈現修正](codex-stream-error-20261010.md)
- 10-10 [同專案換聊天室接續：真正 Opus 5.5 討論](chat-continuation-discussion-20261010.md)
- 10-10 [AI 可呼叫同專案新聊天室接續（2026-10-10，候選）](chat-ai-continuation-20261010.md)
- 10-09 [Codex 原生容量處理與 Gemini 額度解析](codex-capacity-error-20261009.md)
- 10-09 [2026-10-09 K 專用 Chrome 離線恢復](browser-native-recovery-20261009.md)
- 10-08 [原生子代理終止後父對話結果驗收候選](native-terminal-wakeup-20261008.md)
- 10-08 [原生 Luna 拒絕／終了後主代理未接手：事件與工程交接](native-subagent-refusal-wakeup-incident-20261008.md)
- 10-07 [舊 Gemini 工單查詢與等待狀態補修](worker-record-recovery-20261007.md)
- 10-07 [原始附件串流上傳與下載](native-attachment-stream-20261007.md)
- 10-06 [長工作：程式觀察、事件等待與必要介入](long-work-observation-20261006.md)
- 10-06 [受阻目標恢復、Codex 原生加速與子代理展開清單](goal-fast-workers-20261006.md)
- 10-06 [Gemini 長工作不得按總時長截斷](gemini-long-work-20261006.md)
- 10-06 [2026-10-06 主代理容量備援與 Gemini 依序交接](capacity-account-handoff-20261006.md)
- 10-05 [三家原生目標模式與人用入口](native-goals-20261005.md)
- 10-05 [Codex 暫停目標的 AI／人工恢復](goal-resume-20261005.md)
- 10-05 [目標直接編輯與三核心分開接入](goal-edit-20261005.md)
- 09-27 [瀏覽器截圖留白問題交接（2026-09-27，給 Astra）](browser-screenshot-zoom-canvas-handoff-20260927.md)
- 09-25 [Claude 官方登入連結與人工授權碼交接修正](claude-login-handoff-fix-20260925.md)
- 09-24 [Opus 複查修正：Claude 正式啟動旗標與串流](opus-review-stream-fix-20260924.md)
- 09-24 [給 Astra 的交接：審查修正、介面摺疊、連續寫入、分支對話、聽寫](opus-handoff-ui-parity-20260924.md)
- 09-24 [給 Claude 的審閱交接：主代理額度、事件通知與附件](claude-efficiency-handoff-20260924.md)
- 09-24 [第二階段核准驗收交接給 Opus](browser-approval-round2-handoff-20260924.md)
- 09-14 [多步工作中斷接續驗收](recovery-validation-20260914.md)

### Gemini 帳號、額度與調度

- 10-22 [Gemini 同帳號派工不再做整機閒置檢查：Sol 已覆核，南區已部署 2f46ccc、已 push 讀回，正式雙聊天室實測待本人](gemini-dispatch-idle-20261022.md)
- 10-16 [更新前交接測試逾時與原生完成通知競態：南區已部署](fresh-target-timeout-20261016.md)
- 10-16 [Gemini 獨立額度的 CLI 識別修正與 Gemini 4 查證：南區已部署](gemini-cli-quota-20261016.md)
- 10-14 [Gemini 非目前帳號背景查詢：不再停在快照，失敗會自動重查，南區已部署](gemini-background-quota-20261014.md)
- 10-13 [帳號觀察／事件等待與聊天效能修正](scheduler-wait-ui-performance-20261013.md)
- 10-13 [Gemini 跨聊天室調度生命週期修正](gemini-scheduler-lifecycle-20261013.md)
- 10-13 [Gemini 獨立額度查詢與等待責任](gemini-independent-quota-20261013.md)
- 10-09 [Gemini 原生 disabled 額度修正](gemini-disabled-quota-20261009.md)
- 10-08 [額度歸零與 Gemini 五帳號：Astra／Opus 5.5／Gemini 討論](quota-zero-three-model-discussion-20261008.md)
- 10-08 [歸零額度抑制與討論發言者辨識](quota-speaker-engineering-20261008.md)
- 10-07 [手機設定與 Gemini 全帳號實查](mobile-settings-quota-20261007.md)
- 10-04 [Gemini 帳號逐一使用指引](gemini-account-policy-20261004.md)
- 10-03 [多帳號子代理接手研究：Gemini 優先](multi-account-subagent-research-20261003.md)
- 10-03 [Gemini 多帳號工人候選](gemini-multi-account-20261003.md)
- 10-03 [Gemini 新增帳號入口與 Opus 複查](gemini-login-flow-20261003.md)
- 10-03 [Gemini 登入狀態與官方額度補修](gemini-account-status-20261003.md)

### 子代理、工人與模型分工

- 10-18 [Claude 停止背景指令後 K 仍顯示子代理工作中](claude-taskstop-settle-20261018.md)
- 10-15 [Gemini 工人成果收據：已審核並合回 main，南區已部署](discussion-skill-gemini-outputs-20261015.md)
- 常設 [K HARNESS Worker MCP：操作者派工與失敗處理指南](operator-guide.md)
- 常設 [限定程式工人](coding-worker.md)
- 10-13 [長交接訊息收合與模型切換提示去重](long-user-text-model-note-20261013.md)
- 10-13 [Fable 系列沿用 Claude Code 原生核心](fable-native-models-20261013.md)
- 10-10 [原生內容呈現／歷史子代理假待確認修正](native-presentation-worker-status-20261010.md)
- 10-09 [本聊天室子代理快覽與 Pick Me Up 待確認誤列](worker-quick-status-fix-20261009.md)
- 10-08 [子代理上方快覽／右側詳細：使用者釐清與真 Opus 討論](worker-quick-details-discussion-20261008.md)
- 10-08 [子代理快覽、動態原生模型與 Claude 工人整批工程](worker-native-models-engineering-20261008.md)
- 10-08 [子代理模型選單與高階第二意見：真 Opus 討論](worker-model-selection-discussion-20261008.md)
- 10-08 [多模型討論工程](multi-model-discussion-engineering-20261008.md)
- 10-08 [多模型討論：三種模式與 AI 調度需求定案](multi-model-discussion-design-20261008.md)
- 10-08 [三核心／模型更新核對與本聊天室子代理視窗](core-model-worker-status-20261008.md)
- 10-07 [子代理協調全流程稽核與舊工單收尾](worker-coordination-reconciliation-20261007.md)
- 10-07 [Gemini 工人反覆開黑窗：診斷與派工行為規則候選](gemini-worker-console-20261007.md)
- 10-06 [主代理待命、子代理活動與關閉失敗恢復](worker-wait-20261006.md)
- 10-04 [全 K 子代理執行數、簡化交接通知與 Gemini 登入誤判](worker-count-20261004.md)
- 10-04 [Sol 作為日常技術主腦](sol-technical-lead-20261004.md)
- 10-04 [修正後補查原文](console-flash-opus-review-20261004.md)
- 10-04 [黑窗修復與三核心手動更新](console-flash-investigation-20261004.md)
- 10-03 [子代理權限與檔案核准修正](subagent-approval-20261003.md)
- 10-03 [個人模型分工：AI 內部指引與子代理選單](model-role-guidance-20261003.md)
- 10-03 [GPT／Claude 一起派 Flash](gpt-flash-20261003.md)
- 10-03 [Antigravity worker：階段 0 調查／階段 1 實作 — 2026-10-03](antigravity-worker-20261003.md)
- 10-01 [子代理政策精簡與延遲包裝接線](worker-policy-cleanup-20261001.md)
- 10-01 [子代理預設由 AI 自動選擇](worker-auto-selection-20261001.md)
- 09-30 [模型選單精簡與正式套用](model-picker-compact-20260930.md)
- 09-26 [Opus 複查：隔離候選雙模型 UI 驗收](opus-review-isolated-model-ui-20260926.md)
- 09-26 [隔離候選：本人登入後的雙模型 UI 驗收](isolated-model-ui-acceptance-20260926.md)
- 09-15 [多專案與主代理換模驗收](desktop-projects-model-switch-20260915.md)
- 09-14 [模型選擇與派工修正](model-routing-20260914.md)

### 三家原生核心接入

- 10-21 [Gemini 完整接入：沙盒指令、k_luna 派工、原生子代理、共用學習規則與 AGENTS.md 精簡](gemini-full-integration-20261021.md)

- 10-21 [Gemini 主聊天室提示精簡、agy 1.4.3 串流實測與持續程序候選設計](gemini-main-fit-20261021.md)

- 10-20 [Dolphin 工具模板、工具結果往返與首回合等待診斷](dolphin-tool-template-20261020.md)

- 10-19 [自架社群模型主代理（Qwen／Mistral／Gemma abliterated）下載完成、接線已部署；K 保持關閉、模型待本人實測](selfhost-community-models-20261019.md)
- 10-14 [Gemini 核心更新與 Gemini 4 可用性](gemini4-core-20261014.md)
- 10-12 [原生合法 Unicode 被錯切，造成聊天室載入逾時](native-jsonl-framing-20261012.md)
- 10-09 [原生只傳圖片實測](image-only-native-probe-20261009.md)
- 10-08 [三原生核心附件交付修正候選](attachment-native-compat-20261008.md)
- 10-07 [Gemini 與聊天室／Chrome／Codex 修正合併驗證](gemini-k-fixes-integration-20261007.md)
- 10-07 [Gemini 指令輸出消失與延遲執行：PATHEXT 修正](gemini-command-pathext-20261007.md)
- 10-04 [Gemini 搜尋、讀網頁與 Flash 瀏覽器接入](gemini-web-browser-20261004.md)
- 10-04 [Gemini 核心啟動失敗：更新、額度與聊天室](gemini-enoent-20261004.md)
- 10-04 [Gemini 多模態與專案工具](gemini-capabilities-20261004.md)
- 10-04 [agy 再次失聯根因與設定固定標題列](agy-recurrence-settings-20261004.md)
- 10-03 [設定內訂閱登入與官方頁面開啟修復](subscription-settings-login-20261003.md)
- 10-03 [Gemini 第三原生核心](gemini-third-core-20261003.md)
- 10-03 [Gemini 後續開發與帳號邊界](gemini-followup-20261003.md)
- 10-01 [Codex 自動子代理真實補驗](codex-auto-native-verification-20261001.md)
- 09-30 [共享記憶替代方案：上游更新、公開方案與隔離試跑](shared-memory-alternatives-research-20260930.md)
- 09-30 [原生額度通知：去除重複、Claude 正體中文呈現](native-notice-dedup-20260930.md)
- 09-30 [Codex 桌面沙箱設定停止：2026-09-30 唯讀診斷](codex-desktop-sandbox-diagnosis-20260930.md)
- 09-30 [Basic Memory 原生核心實測：部分完成，未通過雙核心驗收](basic-memory-native-pilot-20260930.md)
- 09-28 [K 原生核心權限切換 — 2026-09-28](native-core-permissions-20260928.md)
- 09-27 [原生瀏覽器最小化後恢復黑畫面](native-browser-minimize-restore-20260927.md)
- 09-26 [原生 K 本機離線聽寫修復](native-voice-fix-20260926.md)
- 09-26 [原生視窗語音錯誤：診斷與尚未採用的修法](native-voice-diagnosis-20260926.md)
- 09-26 [真正嵌入瀏覽器候選](native-browser-candidate-20260926.md)
- 09-26 [Codex 空白 thread 讀回提示](codex-empty-thread-readback-20260926.md)
- 09-26 [Claude 原生子代理與計畫進度呈現](claude-native-progress-20260926.md)
- 09-26 [Claude 原生子代理完成狀態 metadata](claude-native-agent-result-20260926.md)
- 09-26 [Claude host 關閉失敗保留重試句柄](claude-host-teardown-retry-20260926.md)
- 09-25 [現有 Codex 沙箱試驗：前置範圍檢查](codex-sandbox-preflight-20260925.md)
- 09-25 [官方 Codex Windows 沙箱：登入隔離實測結果](codex-sandbox-isolation-result-20260925.md)
- 09-24 [Opus 複查：原生通知／可見性／搜尋審查](opus-review-native-20260924.md)
- 09-24 [共用原生介面與複製回饋驗收](native-ui-validation-20260924.md)
- 09-24 [Codex 原生通知與沙箱就緒狀態](native-events-20260924.md)
- 09-24 [K 原生接入方向](native-adapter-direction-20260924.md)
- 09-24 [原生 Codex 審查與工作區檔案搜尋](native-actions-20260924.md)
- 09-24 [Claude 原生可見性 — 2026-09-24](claude-visibility-20260924.md)
- 09-24 [原生瀏覽器 MCP 核准探測](browser-native-approval-probe-20260924.md)
- 09-23 [雙訂閱整合：2026-09-23](dual-subscriptions-20260923.md)

### 瀏覽器與連接器

- 10-18 [K 自行縮小開啟 K 專用 Chrome、停止或 Chrome 重開後自動重連](k-chrome-auto-open-20261018.md)
- 09-27 [K 瀏覽器助手](k-browser-assistant-20260927.md)
- 09-27 [縮放分頁截圖畫布修復](browser-screenshot-zoom-canvas-fix-20260927.md)
- 09-27 [瀏覽器接線研究：Claude Code、Codex、VS Code 與開源方案](browser-reference-research-20260927.md)
- 09-27 [2026-09-27 移除 Chrome 人工活動自動暫停](browser-no-auto-pause-20260927.md)
- 09-27 [外部 Chrome：data 網址、背景操作與不搶焦點](browser-data-background-20260927.md)
- 09-26 [正式 K 隔離接入與瀏覽器可行性評估](production-browser-rollout-assessment-20260926.md)
- 09-26 [Claude 設定重啟狀態與瀏覽器尺寸完成讀回](connection-browser-fix-20260926.md)
- 09-26 [Browser frame / viewport 驗證](browser-frame-validation-20260926.md)
- 09-25 [Opus 複查：右側瀏覽器畫面與人工接手](opus-review-browser-live-view-20260925.md)
- 09-25 [瀏覽器工具列與下載](browser-toolbar-downloads-20260925.md)
- 09-25 [Codex 取消後原對話重連](browser-reconnect-fix-20260925.md)
- 09-25 [持續登入與安全邊界：評估及驗收標準](browser-persistent-login-plan-20260925.md)
- 09-25 [瀏覽器登入隔離試點：可信端工具入口與 Windows 反證](browser-isolation-pilot-20260925.md)
- 09-25 [瀏覽器下載安全補強與登入隔離交接](browser-download-security-20260925.md)
- 09-25 [下載紀錄備份：去重與新批次保留上限](browser-download-retention-20260925.md)
- 09-25 [重用瀏覽器資料後的下載崩潰：隔離修正與複查交接](browser-download-history-fix-20260925.md)
- 09-25 [單筆下載與 Edge 程序崩潰調查](browser-download-crash-investigation-20260925.md)
- 09-25 [瀏覽器取消與登入隔離審查接續](browser-cancel-followup-20260925.md)
- 09-24 [Opus 複查：Playwright MCP 接線](opus-review-browser-mcp-20260924.md)
- 09-24 [Playwright MCP 啟用前修正](browser-security-fix-20260924.md)
- 09-24 [第三輪複查接續修正](browser-review-followup-20260924.md)
- 09-24 [瀏覽器權限接線修正](browser-permission-fix-20260924.md)
- 09-24 [專案限定 Playwright MCP 接線](browser-mcp-integration-20260924.md)
- 09-24 [瀏覽器同頁顯示與人工接手](browser-live-view-20260924.md)
- 09-24 [K 內建聽寫接入](browser-dictation-20260924.md)
- 09-24 [瀏覽器協作接入評估](browser-collaboration-assessment-20260924.md)

### 附件、手機與語音

- 10-23 [聽寫預先載入與顯卡／CPU 動態選擇，南區已部署](dictation-prewarm-20261023.md)
- 10-22 [長聽寫背景穩定性：取消固定 120 秒、切房／切視窗保留兩種意圖（未部署）](dictation-background-stability-20261022.md)
- 10-09 [K 附件-only 修正與延後上線](attachment-only-fix-20261009.md)
- 10-08 [手機選檔返回後附件上傳被擋：候選修復](mobile-attachment-picker-20261008.md)
- 10-07 [手機重開誤顯示配對頁補修](mobile-reopen-20261007.md)
- 10-07 [2026-10-07 手機聽寫與隱藏功能盤點](mobile-dictation-20261007.md)
- 10-07 [手機主畫面入口、記住登入與介面整修](mobile-app-ui-20261007.md)
- 10-07 [選單裁切與原始附件串流補修](menu-attachments-20261007.md)
- 10-07 [聽寫轉錄中切換聊天室](dictation-room-switch-20261007.md)
- 10-06 [K 手機遠端控制層：候選實作與驗證](mobile-remote-20261006.md)
- 10-05 [附件顯示、份數及執行中補件修正](attachment-input-20261005.md)
- 10-01 [工程通知退至後台、原生語音接線修復與 R3-2 回查](voice-notices-cleanup-regression-20261001.md)
- 10-01 [個人本機聽寫：移除重複同意](voice-no-consent-20261001.md)
- 10-01 [Opus 複查：語音接線修復與工程通知退至後台](opus-review-voice-notices-20261001.md)
- 09-26 [Opus 5.5 原生 K 聽寫修復複查](opus-review-local-voice-20260926.md)
- 09-25 [附件漏存修正與輕量檔名標籤](attachment-label-fix-20260925.md)
- 09-24 [工作中附件與暫時狀態橫幅修正](busy-attachment-status-fix-20260924.md)

### 討論功能

- 10-15 [討論 v2：廣泛唯讀、現有主代理主持與圓桌；held-only 停止補修，南區已部署，三家原生權限實測](discussion-roundtable-permissions-20261015.md)
- 10-14 [討論 API HTTP 400：錯誤可辨識；推定為工具結果過長（3 萬檔工作區列檔約 436 萬字），超長結果改為不送出並提示縮小範圍，南區已部署](discussion-api-400-20261014.md)

- 10-14 [討論 API：GLM（Z.ai）、Kimi 預設選項，南區已部署](discussion-api-presets-20261014.md)
- 10-10 [極長任務、舊指令誤生效與原生壓縮：Astra／Opus 5.5 討論](long-context-discussion-20261010.md)
- 10-09 [討論專用 API 參與者](discussion-api-implementation-20261009.md)
- 10-09 [API 模型只作討論參與者：設計討論](discussion-api-design-20261009.md)
- 10-08 [討論發言者辨識：桌面與手機設計討論](discussion-speaker-design-20261008.md)

### 權限與隔離

- 09-26 [已登錄 K 專案工作區的秘密檔隔離實測](workspace-secret-isolation-20260926.md)
- 09-26 [Codex externalSandbox 單次假資料驗證](external-sandbox-probe-20260926.md)
- 09-26 [ExternalSandbox 外部驗證收尾](external-live-validation-20260926.md)
- 09-25 [Sandboxie 程序接線與核心網路假資料驗證](sandboxie-runtime-integration-20260925.md)
- 09-25 [Sandboxie Plus 隔離候選與假資料試驗](sandboxie-isolation-pilot-20260925.md)
- 09-25 [Opus 複查：登入隔離試點、聊天室並行](opus-review-isolation-concurrency-20260925.md)
- 09-25 [獨立隔離候選：原生接線、可信瀏覽器與訂閱登入](isolated-desktop-candidate-20260925.md)
- 09-15 [桌面主代理直接工作驗收](main-direct-work-20260915.md)
- 09-15 [桌面權限選單與真實驗收](desktop-permissions-20260915.md)

### 介面

- 10-22 [側欄顯示「等待子代理」沙漏](sidebar-waiting-workers-20261022.md)（南區已部署 47a0ae6、已 push 讀回，安裝後側欄 UI probe 通過，正式派工目視待本人）
- 10-22 [介面視覺層次修正：文字／邊框／選取階梯、設定分章、側欄分類標頭、回覆模型標籤](ui-visual-hierarchy-20261022.md)（Sol 覆核通過，南區已部署 2f46ccc、已 push 讀回，三主題目視待本人）；第二批章節標題已隨 47a0ae6 部署、push 讀回，目視待本人
- 10-24 [檔案連結左鍵改為在檔案總管中顯示](file-link-reveal-20261024.md)（待部署）
- 10-16 [原生檔案連結預覽與桌面右鍵選單（待部署，依本人要求停在重啟前）](native-file-actions-20261016.md)

- 10-16 [圓桌窄側欄與討論後回一般對話](roundtable-layout-next-turn-20261016.md)（南區已部署）
- 10-16 [側欄手動排序跨完整重啟保存](sidebar-order-persistence-20261016.md)（南區已部署）
- 常設 [專案側欄來源](third-party-workspace.md)
- 10-13 [D:\K-harness 原始碼工作區對齊](workspace-alignment-20261013.md)
- 10-09 [使用者訊息一鍵複製](user-message-copy-20261009.md)
- 10-09 [工作中插話後，較早的完成回覆被隱藏](steer-final-display-20261009.md)
- 10-09 [側欄狀態、舊聊天室切換與查看跳序：診斷及方案](sidebar-ux-research-20261009.md)
- 10-09 [側欄狀態、旧聊天室切換與穩定排序修正](sidebar-ux-fix-20261009.md)
- 10-09 [2026-10-09 排序規則、名稱與可見性嚴格核對](sidebar-sort-audit-20261009.md)
- 10-09 [2026-10-09 側欄預設手動排序（候選）](sidebar-manual-default-20261009.md)
- 10-09 [2026-10-09 Claude Code 真討論與高關注開源側欄設計比較](sidebar-design-comparison-20261009.md)
- 10-07 [新對話原生加速入口](new-dialog-fast-20261007.md)
- 10-07 [聊天室超連結修復](chat-links-20261007.md)
- 10-06 [長處理細節的收合入口與捲動](process-details-20261006.md)
- 10-05 [工作活動新鮮度與部分未知的子代理計數](work-activity-20261005.md)
- 10-05 [待送／插隊訊息編輯](queue-edit-20261005.md)
- 10-05 [原生警告呈現、關閉狀態與長時間格式](notice-lifecycle-duration-20261005.md)
- 10-05 [建立聊天室即保留](empty-room-retention-20261005.md)
- 10-04 [聊天室移至另一工作區](workspace-move-20261004.md)
- 10-04 [Windows 工作列：完成但未查看的聊天室](taskbar-attention-20261004.md)
- 10-04 [對話視窗焦點框與拖曳選字](modal-focus-selection-20261004.md)
- 10-03 [額度頁分組與 Gemini 緊湊列表](usage-layout-20261003.md)
- 10-03 [東區工作列品牌修正](taskbar-branding-20261003.md)
- 10-01 [K 原生右鍵編輯選單與介面接線回查](context-menu-20261001.md)
- 09-27 [非必要常駐告示精簡](notice-trim-20260927.md)
- 09-26 [工作區封存與原生資料夾選取](workspace-selection-fix-20260926.md)
- 09-26 [封存目前工作區後回首頁](workspace-archive-home-20260926.md)
- 09-26 [助理回覆引用與逐段註解](response-annotations-20260926.md)
- 09-26 [輸入框寬度、高度與模型簡稱](composer-layout-fix-20260926.md)
- 09-26 [簡潔引用與選填留言](annotation-popover-20260926.md)
- 09-26 [註解浮框收合與原生 K 圖示](annotation-dismiss-icon-20260926.md)
- 09-25 [視覺複查後四項修正](visual-review-fixes-20260925.md)
- 09-25 [視覺第 0 階段：靜態樣稿與截圖](visual-direction-stage-0-20260925.md)
- 09-25 [紙、墨、黃銅：產品視覺實作與隔離驗證](visual-direction-implementation-20260925.md)
- 09-25 [K 介面視覺規格：紙、墨、黃銅](visual-direction-20260925.md)
- 09-25 [工作列完成數字：隔離候選與驗收邊界](taskbar-badge-candidate-20260925.md)
- 09-25 [Opus 複查：紙、墨、黃銅視覺實作](opus-review-visual-direction-20260925.md)
- 09-25 [聊天室並行工作與切換修正](concurrent-conversations-20260925.md)
- 09-25 [主聊天框貼上後游標跳尾修正](composer-caret-fix-20260925.md)
- 09-24 [UI parity 安全範圍補充](ui-parity-security-20260924.md)
- 09-24 [K UI parity 實作與 Opus 複查交接](ui-parity-implementation-20260924.md)
- 09-24 [給 Opus：輸入介面、聽寫與五項複查修正](ui-final-review-20260924.md)
- 09-24 [設定、封存管理與追加訊息顯示 — 2026-09-24](settings-archives-message-visibility-20260924.md)
- 09-24 [人類介面精簡 - 2026-09-24](human-panel-20260924.md)
- 09-15 [側欄、封存與 Windows 資料夾選擇](sidebar-navigation-20260915.md)
- 09-15 [專案管理與封存入口](project-menu-20260915.md)
- 09-15 [對話切換與浮動選單驗收](desktop-switch-and-menus-20260915.md)
- 09-14 [用量、外觀與工作區交付](desktop-usage-workspaces-20260914.md)

### Google 營運

- 10-17 [Gemini 試算表單列寫入](sheets-write-row-20261017.md)：本人核准分頁／識別欄、依表頭寫入、appendCells、原始值讀回驗收；已部署 `a81475f`，兩輪完整 1739/1739、health native、私人設定及真正 Flash 工具定義讀回；正式試算表未寫入。
- 10-16 [Gemini 工作區 Google 試算表唯讀接線](gemini-sheets-read-20261016.md)：沿用既有授權工具、限定試算表與唯讀 MCP；修正 no-output 原因判讀，原生查詢與部署狀態見紀錄。

- 10-04 [Google 商家營運 API 接入](google-ops-connect-20261004.md)
- 10-04 [K 內 Gemini 的 Google Ops 盤點核對](google-ops-audit-20261004.md)

### 研究與調查

- 10-16 [Gemma 雲端小說主代理：Codex 原生核心＋12B QAT BF16 接入方案與準備（未租機、未實作）](gemma-cloud-preparation-20261016.md)
- 10-10 [K 輔助原生壓縮：協定實測與最小候選](compaction-assist-probe-20261010.md)
- 10-10 [K 輔助原生壓縮：產品候選](compaction-assist-candidate-20261010.md)
- 10-10 [極長任務記憶：全球論文、開源實作、DSH 與 K 適用性研究](agent-memory-research-20261010.md)
- 10-07 [南區 K 三項工單診斷](k-diagnostics-20261007.md)
- 10-06 [Agensh 與目前 K：研究、真核心假資料試驗及產品判斷](agensh-research-20261006.md)
- 10-05 [聊天室原生壓縮次數](compaction-count-20261005.md)
- 09-28 [K 共享知識長文實測 — 2026-09-28](shared-knowledge-longform-test-20260928.md)
- 09-28 [K 共享知識 R1 長文缺陷修復 — 2026-09-28](shared-knowledge-longform-fix-20260928.md)
- 09-26 [隔離候選一般命令、Claude→Luna 與連接器最小驗收準備](candidate-work-probe-20260926.md)
- 09-14 [K HARNESS 實用性初判](practical-assessment-20260914.md)

### 複查、稽核與整理

- 10-16 [K 非 Codex 部分整理：工人狀態判斷共用、MCP 前門共用、設定視窗拆出 main.jsx、瀏覽器兩層合一並移除人類接手](k-noncodex-cleanup-20261016.md)
- 10-15 [GPT 遺留程式整理：跨專案排查順序、與 Astra 共同盤點、取消臨床排除](gpt-legacy-cleanup-20261015.md)
- 10-15 [10-14 檢查剩餘事項收尾：畫面積壓寬限、討論 API 累積上限、更新暫存清理、Gemini 核心讀回，南區已部署](remaining-fixes-20261015.md)
- 10-14 [K 全面檢查：時序修正 20 項、南區已部署並完成正式讀回](k-audit-20261014.md)
- 10-14 [K 全面檢查後續：剩餘七項處理、南區已部署；後續 Claude 子代理停止可重新確認，南區已部署](k-audit-followups-20261014.md)
- 10-14 [介面實測整修：46 個全數可跑、新增 npm run test:ui](ui-probes-20261014.md)
- 10-14 [移除 150% 介面縮放（舊設定自動改為 125%），南區已部署](remove-scale-150-20261014.md)
- 10-14 [多模型討論改由主模型依本人指示發起（設定像技能注入、任務書由主模型撰寫）；Gemini 全部實查顯示進度；API 回答分段，南區已部署](discussion-brief-20261014.md)
- 10-14 [程式碼排版：拆開擠成一行的寫法](code-format-20261014.md)
- 10-14 [大檔拆分：前端與 desktop-controller](code-split-20261014.md)
- 10-14 [存檔遇防毒占用時誤判失敗](atomic-write-lock-20261014.md)
- 10-13 [.runtime 與本機工作區整理](runtime-cleanup-20261013.md)
- 10-13 [AGENTS.md 歷史決定全文（2026-10-13 歸檔）](agents-history-20261013.md)
- 10-13 [AGENTS.md 整理為現行規則](agents-consolidation-20261013.md)
- 10-11 [本串事故與修復驗收審計](incident-repair-audit-20261011.md)
- 10-07 [南區 K 三項修正候選：已本地驗證，等待一起更新](k-fixes-candidate-20261007.md)
- 10-05 [原生檔案差異與背景完成驗收及部署](dsh-lessons-candidate-20261005.md)
- 10-03 [東區複查補修：測試來源固定與共用 Codex 登入網址](review-followup-20261003.md)
- 10-03 [Gemini／Flash／四帳號與額度頁：Opus 集中回查](opus-batch-review-20261003.md)
- 09-29 [K 程式碼盤點：過度防禦與寫過頭](code-audit-overdefense-20260929.md)
- 09-26 [Opus 複查後三項收尾](opus-review-followup-20260926.md)
- 09-24 [Opus 複查修正：Claude 額度狀態](opus-review-rate-status-fix-20260924.md)
- 09-24 [給 Opus 5.5：通知生命週期修正回饋](opus-review-fixes-20260924.md)
- 09-14 [K 桌面預覽版](desktop-preview-20260914.md)

### 9 月初期驗收

- 09-14 [K 工作流實測判定](workflow-verdict-20260914.md)
- 09-14 [多步混合工作與跨程序接手驗收](mixed-workflow-validation-20260914.md)
- 09-14 [K 主代理中止與工人狀態回復](main-stop-validation-20260914.md)
- 09-14 [主控重開與殘留成果查詢](main-reopen-validation-20260914.md)
- 09-14 [K 內主代理接入與驗收](main-host-validation-20260914.md)
- 09-14 [按需歷史檢索驗收](history-validation-20260914.md)
- 09-14 [K HARNESS 桌面工作介面交付](desktop-workflow-20260914.md)
- 09-14 [App 程式派工接線狀態](app-coding-integration-20260914.md)
