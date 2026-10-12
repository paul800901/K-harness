# 空白新聊天室指定主模型與推理程度（2026-10-12）

## 需求與正式缺口

本人貼出 K「我殺了學院玩家」截圖：要求換過去的新聊天室主代理使用 GPT-5.6 Luna high，原代理回覆建房工具沒有模型參數而未建立。獨立核對正式 `2a18509` 的 `src/luna-gateway.mjs`，`conversation_create` 確實僅接受 `nextInstruction`，`prepareContinuation` 只傳來源 model／effort。這是空白建房工具未完整接上模型選擇，不是429、額度或使用者操作問題。

本輪只補候選，正式 K 正在開啟，不停止／重啟／部署，不操作原翻譯房、不改其主模型。截圖中希望新房使用的模型不代表授權這個工程對話代替本人移交真實工作。既有上下文／帳號／訂閱／權限／未知工作不重播界線保留。

## 最小契約

- 只為真正空白 `conversation_create` 提供 optional `model`／`effort`；原房設定不改。未指定才繼承原房；換模型但沒給 effort 時使用目標模型原生預設，不錯帶來源不相容的 effort。
- 依本機訂閱原生目錄驗證，不硬寫模型清單、不靜默換型號或供應商。既有歷史分支 `conversation_continue` 不在本批擴張。
- 受理回傳明示目標選擇；相同請求不重複建立，改參數不能冒充原收據已接受。最後原生建房與首次交接必須真的使用指定模型／推理程度，重開須保留。
- 原房收尾、429、暫停／停止／新意圖取消、來源與工人核對、未知結果不得重建重送等既有保護不變。沒有新增人用設定、模型監工或框架。

## 已完成查核

- 以固定官方 Codex 核心、ChatGPT 訂閱獨立查 `model/list`，0個thread／0個turn；本機原生清單確實提供 `gpt-5.6-luna`，支援 high（預設 medium）。來源 `gpt-6.1-sol` 預設 low、亦提供其他推理程度。證據：本 worktree `.runtime/fresh-chat-selection-20261012/native-catalog.json`。這是可選目錄證據，不是模型回合驗收。
- 已記正式 `.local/runtime.json` 與三個產品檔hash，供候選完成後核對未部署；不以正式工作中自然變動的對話資料做靜止假設。

## 狀態

候選實作、自動化回歸及真正原生假房驗收已完成，尚未部署。完整證據與未驗證限制見下節，不能將候選結果當成正式已可使用。

## 完成實作與獨立驗收

- Sol 實作僅修改三個產品檔：`src/luna-gateway.mjs` 擴充 fresh 工具 schema／說明；`src/desktop-controller.mjs` 從來源官方目錄解析明確目標；`src/conversation-controller.mjs` 固定受理選擇並只套新房。未加人用控制、供應商轉接、額外重試或失敗換模。本人未指定時才繼承；不同模型未指定 effort 使用其原生預設／省略。
- 新增 `test/fresh-target-model.test.mjs`，另擴充 gateway schema 測試。RED 26 項中14項失敗原件保留；focused 107/107；完整 `node --test --test-concurrency=4 test/*.test.mjs` 1513/1513，0失敗／取消／略過。涵蓋指定／繼承／原生預設／null、非法或hidden模型、不支援effort／服務等級、同回合參數衝突、停止／新訊息取消、受理後目錄移除不fallback、來源失敗後既有交接路徑。Astra 獨立讀完整產品diff、新測試、日誌及freeze hash，確認測後來源未變。
- Astra 用本機固定官方 Codex 核心與原 ChatGPT 訂閱，實際經完整 MCP→兩控制器→原生建房跑一次新假資料鏈，未使用自稱模型作為證據。2026-10-12T09:29:32Z 通過：來源 `gpt-6.1-sol`／medium；原生新房回傳及第一回合參數均為 `gpt-5.6-luna`／high。Luna 實讀只存在假交接檔的唯一標記；原房保存設定未變，新房僅1回合、0壓縮、沒有舊房標記，關閉重開仍保留 Luna／high，沒有額外模型回合。共2次thread/start＋2次turn/start，原翻譯房操作0，假檔hash不變，測試owner正常關閉。
- 真原生來源thread：`01a12f71-99ec-7c21-9078-4f8e57308653`；新房thread：`01a12f71-e369-7410-96ad-8ecbfd97de80`。證據 `.runtime/fresh-chat-selection-20261012/native/{calls.jsonl,native-start-results.jsonl,result.json,close.json}`；探針拒絕原房ID與第三次建房，不重播探針。
- 真正 Opus 5.5 訂閱只讀複查已單次嘗試；2026-10-12T09:29:31Z 原生回報 HTTP429 `usage_limit_reached`／weekly limit，0工具、0模型用量，僅synthetic錯誤，**沒有完成Opus複查**。依本人「真不夠這次複查那就算了」的明確豁免，由Astra獨立驗收；沒有換模型、帳號或API計費。原件在 `.runtime/fresh-chat-selection-20261012/opus-r1/`。

## 本批完成邊界

**候選已修復並通過自動化與真正原生假房驗收，尚未部署。**正式仍為 `2a185098b643d7bea919f6c0d0791405fb1ea1a6`；工程前後版本設定與三個正式產品檔SHA256逐項相同（`formal-before.json`／`formal-after.json`）。未停止／重啟正式K、未送出真翻譯房交接、未改原房模型或設定、未push／更新東區／設定排程。

沒有改UI資產，本批未另跑UI建置；尚未驗收安裝後的正式人類操作。此修正只解決新空白聊天室無法指定主模型／推理程度，不宣稱上游429或容量問題不再發生，不擴成跨供應商新房或歷史分支改模。

## 本人授權後正式更新與獨立讀回（2026-10-12）

- 本人明確回覆「可以更了」，取代前段候選停等。Astra 先核對正式K自有程序及47831／5199監聽皆為0；保留兩個既有Chrome native host，不強制結束任何工作。
- 單次套用固定程式 `4595e96011f3e0da7a686aa8cc56a5285ded5929`。Git archive封裝692來源檔，既有獨立相依原樣複用且package manifests相同，沒有安裝／升級相依或原生核心。介面、Chrome擴充與啟動器三項建置通過；封裝focused **425/425**，沿用前節固定來源完整 **1513/1513** 與真正Sol→Luna5.6/high假房驗收。
- 套用前及安裝後692檔均與固定Git bytes逐項核對零差異。舊 `2a185098b643d7bea919f6c0d0791405fb1ea1a6` 程式與入口保存於 `D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1791799425692`；已核對舊版本設定、三變更產品及兩入口hash。這是程式退版，不是對話備份或資料還原。
- 正式owner實際啟動：health200、未授權state403、實際送出的JS/CSS與安裝檔一致。Astra檢視1440×960／390×844正式介面截圖及30房側欄；無頁面錯誤、0 POST、未選取任何原翻譯房、未送出模型回合。這是正式服務與桌面／手機尺寸瀏覽器讀回，不宣稱實體手機USB或Windows捷徑像素驗收。
- 78個原對話metadata的完整清單與hash、5個資料位置／清單不變；核心選擇、Codex設定、專案／Google設定以及語音／Node位置保留。Gemini帳號檔僅目前帳號3個正常查詢時間（auth.checkedAt、quota.checkedAt、lastQueryAt）更新，逐欄核對，未切換帳號或改額度／計費。
- 正式讀回後正常關閉本輪自有owner，再次確認程序與監聽均為0。日常K維持關閉，未恢復／重送翻譯工作、未改原房模型、未push／更新東區／排程；本人可用原捷徑開啟新版。
- 本輪證據集中於 `D:/K-harness/.runtime/fresh-model-selection-deploy-20261012`：validation、activation、installed-source、formal-readback、post-readback-preservation、launcher-rollback-readback及stopped-after-readback。**本批已正式更新並完成上述讀回**；Opus仍依前節真額度不足與本人豁免處理，不冒稱已完成複查。真正目標模型選擇已由前節同一固定產品的原生假房驗證；原翻譯房實際交接未代替本人執行。
