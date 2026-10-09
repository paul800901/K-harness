# 側欄狀態、旧聊天室切換與穩定排序修正（2026-10-09）

## 範圍與目前狀態

使用者確認三項介面需求後授權實作，並明確表示 K 已完全關閉，可配合另一個「交接 K 模型容量錯誤」聊天室一起更新。這邊為唯一部署者；另一邊固定候選 `4825d0c81f3b4e413b4f93e08c937305b9f37f8a` 尚未經本輪真 Opus 複查，只能先整合為 NOT READY。既有插話後最終回覆修正 `9430c4551425397a6c40bd681b2aff3e9080cc57` 亦隨整批驗收。

目前是本機實作／假資料驗證，尚未正式套用、重啟或 push。真正 Opus 5.5 設計討論已完成，見 [研究](sidebar-ux-research-20261009.md)；新增程式的真正 Opus 複查須等官方額度於臺灣 06:30 恢復，不換模型或計費路徑。後續實際整合、複查、固定版本、部署與讀回追加本文件。

## 根因與最小修改

1. **只靠相近顏色**：原先工作中／有新回覆均為 6px 實心圓。`frontend/project-sidebar.jsx`／`sidebar.css` 改為 14px 缺口環（工作中）、靜態訊息形狀（有新回覆）、警告形狀加「待確認」。尊重減少動畫設定；已讀仍顯日期。不改 completion-attention 成功條件，不用綠勾宣稱整項任務驗收。
2. **冷開啟期間舊畫面被鎖住**：`frontend/main.jsx` 即時選取目標，未取得歷史前用靜態占位，不再把舊內容當成新聊天室。三家 `open` 在取得歷史後回呼，只呈現唯讀歷史；原生連線、權限、目標及工人讀回仍照原順序完成，才開放送出／分支。`shared/conversation-preview.mjs` 是短小的呈現投影，清掉舊聊天室的待確認、工人、佇列、成果及能力，不是執行 owner。
3. **舊開啟蓋回新選擇**：`conversation-controller.mjs` 的請求序號僅管畫面選擇。新點擊立即換投影，讓已接下的原生開啟先結束並保留 owner，之後只開最後選擇；不因換画面中止可能已恢復的原生工作，不重送。明確取消仍沿用 AbortSignal；取消等待中的最新選擇亦清除預覽。
4. **檔案保存被當最近活動**：`main-sessions.mjs` 新增 `sortAt`。舊紀錄首次保存沿用原檔案時間作相容排序錨點，並非聲稱那是實際發言時間。開啟、改名、釘選及設定保存不推進；原生接受新訊息／插話及完成回覆才推進。`saveMainSessionActivity` 沿用同一房間保存佇列、在佇列內讀最新 metadata，避免完成通知覆寫較新改名／權限。`project-groups.mjs` 依此排序並保留手動／釘選規則。
5. **傳送確認等候仍鎖側欄／草稿**：導航不使用全域 action 鎖；後端仍保留各房間／切換操作的原生限制。傳送確認期間可切房、可寫草稿；送出仍有原有鎖，唯讀預覽仍不可輸入。不增加自動重試或核准。

顯示／選擇與原生執行歸屬分開，前端樂觀選擇亦與權威 SSE snapshot／patch 分開，避免 patch 基準被假畫面破壞。沒有新資料庫、常駐預熱、歷史全集快取、設定頁或原生核心重作。底層冷連線時間未宣稱減少；本批改善可感知回應，並窄化單聊天室索引讀取。

## 修改檔案

- 呈現／導航：`frontend/main.jsx`、`project-sidebar.jsx`、`sidebar.css`、`style.css`、`project-groups.mjs`；`shared/conversation-preview.mjs`。
- 原生接殼／排序：`src/conversation-controller.mjs`、`unified-controller.mjs`、`desktop-controller.mjs`、`claude-controller.mjs`、`gemini-controller.mjs`、`main-sessions.mjs`。
- 回歸：`test/sidebar-ux.test.mjs`、`sidebar-ux-ui-probe.mjs`、三家 controller tests、`conversation-controller.test.mjs`、`conversation-navigation-ui.test.mjs`／UI probe。
- 既有導航探針原本還用舊 SSE 裸 state／JSON 附件，已更新成 snapshot 契約、raw stream 假附件及等待實際草稿復原；不是放寬產品判定。

## 本機證據及失敗

證據：`C:\Users\Paulus\.codex\worktrees\steer-final-display\K-harness\.runtime\sidebar-ux-20261009` 及同層測試 logs；研究／真 Opus 討論另在 `D:\K-harness\.runtime\sidebar-status-research-20261009`。

- 初版定向 64/64、三家原生 fixture 185/185；新增快速點選、舊失敗不蓋新目標、取消、已接下工作不因畫面切換停止、唯讀投影、排序與保存競態。
- 建置後 UI：三主題×1920／390 共 6/6。真 SSE patch，延遲 B 歷史／連線，歷史先可閱讀、連線前送出／分支禁用、繼續點 C，B 晚完成不蓋 C；減少動畫仍不同形狀、順序不變、0 模型工作呼叫。
- 既有導航 built UI：A 工作／待核准時切 B，B 送出／停止只帶 B ID；A 草稿／假附件回來；A 遲到成功、失敗及新草稿均保留正確歸屬。
- 第一輪完整預設並行 1075/1075 通過。追加取消測試後另一輪預設並行 1076 有三個失敗（容量接續時序、native failed、20ms partial 保存讀回）；原 log 保留 `sidebar-full-tests-parallel-failed.txt`，不得隱去。單獨 partial fixture 6/6，低並行完整結果待下方收尾。容量自動接續測試會隨另一邊移除此路徑而改為不重送驗證。
- Vite 大 bundle 警告保留；沒有为此另拆包或安裝相依。

未驗證：此次假資料 UI 不代替本人桌面／手機實機體驗；各家實際冷連線耗時分解未量測，不聲稱 Codex／Claude 閉源桌面內部實作；不把公開協定存在当已接全部能力。

## 整合候選（仍 NOT READY）

- 本批提交 `1877a4d`，另一本批的 `4825d0c` 在此重放為 `335c4fc832f3e26508c56c5c43cc88fbb4fb6ba4`。衝突僅為 main.jsx 同一長行：保留新的導航／唯讀 header，併入另一邊原生錯誤詳細；style 與索引兩方均保留。AGENTS／README／Gemini 與工人終態修正皆保留。
- 追加清除預覽的 turnError，避免繼承別房的原生錯誤詳情。整合定向 51/51 通過；真 Opus 複查未開始。另一方確認不再另行呼叫 Opus，由本方 06:30 後一次完整審查，也須讀真 Gemini 額度原文，不把當時缺原始 stdout 的未知升級為已知。
- 一次低並行測試 1078/1078 通過，但其執行期間與本機整合作業重疊，因此不作固定版本全測證明。待來源不變的完整重跑與固定候選證據。

## 固定版本與真 Opus 收尾（2026-10-09）

以下取代上文各階段 NOT READY／待複查的當時狀態。

- 固定程式 `5762d48913ca185e68dad1709197ccfe47c7dc67`，包含 peer `4825d0c` 的完整候選、既有插話顯示修正、側欄／冷開啟／排序與最新選擇回執。root 開發區既有 dirty 修改未被 reset 或整批複製。
- 固定 Git archive 建置 UI／擴充／C# 啟動器；611 個 tracked 檔案逐位元讀回一致，build generator 唯一換行差異恢復原 archive bytes。使用既有 lockfile 的本機已安裝相依實體複本，不安裝套件、不部署 outgoing runtime junction。
- 真 Opus 5.5 整合：官方 Pro、Claude Code 2.1.294、actual `claude-opus-5-5`，session `7fb88545-f443-47fe-b3dc-0df1c5fba779`。首輪 25 個只讀工具；唯一 P2 是原生已接受插話後，新增的排序時間保存失敗不應讓 API 失敗、恢復草稿並誘發再次送出。Astra 將此可選保存改為非阻擋，保留原診斷；原生接受前必要存檔、收訊不明規則均不動。兩家各新增失敗注入：仍接受、原生不重送、錯誤可見；Claude 收訊回執和之後保存恢復亦通過。
- 同真 Opus session 再讀窄差異與完整 quota-zero／Gemini accounts，下游 null reset 不永久抑制，7 個工具，明確「通過，沒有阻擋級問題」。Astra 自行核對 diff、失敗測試、原報告、模型／訂閱及固定候選證據，不把代理回報單獨當驗收。
- 修正定向154/154；最終固定低並行完整 **1077/1077**。建置後側欄三主題×桌面／手機6/6，真 SSE patch、歷史先讀、晚回執不覆蓋、readonly與取消；導航9用例、額度2尺寸、插話三家×2尺寸6/6＋真既有遺失回覆投影顯示／reload，全部通過。後者沒有修改保存原文，也未重新送出原業務工作。
- 保留限制：冷連線總耗時未量測；三家2-final為 deterministic／built UI，真 native sentinel 僅取得1-final，不冒稱新2-final真模型重現。正式 owner 的零工作讀回亦不代替人親自操作 Electron／手機。Opus 指出的 fake Claude preview fixture 缺原生 accessMode 造成待套用文案，非產品阻擋項，未擴張改碼。先前 pinned-header baseline 失敗未修。
- Gemini 週0／reset未知可以顯示官方成功百分比，不會推算已恢復或抑制到永久；但目前帳號既有交接判定要求未來 reset，null 不因此啟動交接，由原生忠實回報。此現有行為未改為新的帳號／重試政策，另一帳號缺可靠窗口仍保守拒絕。第二帳號缺原始 stdout 的原因保留未知。
- 06:30:16 官方仍拒絕（`38622774-3b9c-444e-8c8d-3bb3a57f8c6d`，0 input/tool）；等5分鐘後才單次新工程複查，未改本機 quota cache、換模或 API 路徑。原失敗及原生過期 reset 欄位完整保留，不能宣稱首試成功。
- 證據集中 `D:\K-harness\.runtime\sidebar-capacity-build-20261009`：`clean-full-test.log`、`fixed-source-readback.json`、各 UI receipts、`review-after-reset`／`review-followup` 原始 JSONL 和結論。只給 Opus 工程封包／假資料截圖，不傳既有業務回覆內容。

## 正式套用／讀回與停止

- 臺灣06:49正式activate為 `5762d48913ca185e68dad1709197ccfe47c7dc67`，base仍是原正式f5e9e266，沒有覆蓋另一方新部署；兩邊單一部署者。上一版程式／啟動器在 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791499740190`，對話資料不回退。
- 替換前後 **97233** 個既有狀態／profiles／原生核心設定檔hash相同；非version／previous設定逐項不變，對話、登入、語音及工具位置保留。first preflight只讀hash過量並行EMFILE發生在activate之前，正式未動；保留失敗紀錄後同項讀回改32批次，沒有改產品或新增常駐驗證系統。
- 臺灣06:50實際正式owner啟動，原生health200；未授權首頁／state403；新正式JS/CSS served bytes與disk SHA256相符。真正本機狀態配合authenticated built UI首頁：20聊天室，unreadable0，sortAt有效，0 POST／0 pageerror，未選取或resume任何聊天室、busy false，既有遺失回覆projection hash仍相同。
- 正常close owner後驗證47831不可連線，**K維持關閉**。不恢復暫停工作、不重做StoreOps、小說或派工。此次是正式服務／built UI讀回，不宣稱本人Electron窗口與手機實機操作已驗收。
- 本地`runtime.json`version及退版位置讀回完成；東區未更新。GitHub未push／tag：合併父版本含2026-10-08明确no push批次，本轮明說一起更新本機，不以一般SOP默認撤回。遠端main實查仍`f0d32ef263e71bced827d264bbaaa71f1f8132b1`；不是正式本機SHA。文件收尾提交另列，不混稱重部署程式。

## 2026-10-09 12:41 Pick Me Up 再次回報：診斷，未追加產品變更

- 本人回報 Pick Me Up 曾瞬間跳頂，暫記不清是點開前後或送出前後；只注意到此聊天室。不能以此宣稱所有房間退化，也不能以假資料通過否定現場回報。
- 當時正式仍5762d48、K正在工作。只讀核對該房 K index sortAt=2026-10-09T04:33:36.528Z（臺灣12:33:36），與同房新 user UI timing createdAt完全一致；native對應task_started=04:33:36.560Z、同房有新user指令。這是新訊息活動推進的證據，不是重播歷史／點開寫mtime的證據；不把缺失的點擊時點猜成已知。
- 原生coldopen／legacy錨點／metadata／manual/pin定向4/4。另以正式source及正式dist-ui，隔離fake state與fake native transport，跑真HTTP/API、真SSE、真持久檔與built DOM，依序觀察：初始末位、cold唯讀歷史、連線ready、切走再選回、reload，Pick排序位置及sortAt均不變且native turn/start=0；明確送出假新訊息後才升首位，turn/start=1；假完成回報後仍首位，無額外送出。不是只mock sidebar列表。0 pageerror。無真模型呼叫、無正式profile／業務寫入、未關閉或重啟K。
- 未重現「僅點開就移位」，但本人原瞬間的確切時點仍未知。現行recent需求是新訊息／回覆會重新排序；若本人希望發言後仍保持固定位置，那是另一項排序取捨，未擅自改成固定或寫本人localStorage。
- 本次僅診斷與記錄，無產品diff／部署／push／tag。證據 D:\K-harness\.runtime\sidebar-sort-followup-20261009\result.json、ui-probe.mjs；兩次fixture locator失敗（hidden textarea、送出按鈕實際名）完整保留，修測試selector後通過，沒有改產品／放寬判定。
