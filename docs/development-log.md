# K 最新工程交接索引

使用者要求：每項變更記錄專案內，Opus 可直接複查，不需要使用者轉貼聊天。

## 2026-09-30
- [R3-1 補修：原生額度通知只顯示一次、Claude 正體中文](native-notice-dedup-20260930.md)：移除 Claude 自製 rejected 通知；原生恢復時間以臺灣用語呈現、底層原文不改。Codex 相同原生錯誤不再包裝重複。定向 63/63、完整 **649/649**、假資料建置 UI 一列 51px 通過；沒有模型工作，正式 R2 16/16 讀回不變。候選標記 `R3-1-candidate-20260930-notices`，**未部署，待 Opus 審查**。
- [R3-1 候選完成，待 Opus 審查](r3-1-20260930.md)：官方雙核心模型目錄、連線中取消、正常退出失敗後預設「否」的強制出口、移除 worker run_tests、六處共用原子寫入及小修。完整 **644/644**、建置 UI 與真假程序退出通過；真 Claude 2.1.280 目錄可讀，未送模型工作。產品淨減 24 行、含測試淨減 68 行；中途失敗與未驗正式行為均列交接。四個決定已先寫 AGENTS，標記 `R3-1-candidate-20260930`。**未部署／重啟正式 K，未把未審 Pi 來源合併主工作樹，共享知識不碰。**
- [14:39 R2／GPT-6.1 Sol 正式套用與讀回](r2-sol61-release-20260930.md#1439-部署命令誤判定位修正與正式讀回)：**16 檔正式更新、K 專用 CLI 0.159.0、原入口重開與 health／HTTP 資產／實際模型選單讀回通過。** 部署卡住已定位為同一複雜命令內本機啟動與 health URL 被 Codex heuristic 誤認成啟動網址；分別交由原工具檢查後正常完成，未改安全設定。R1 留底及資料保留，共享知識未上線；未另送模型回合、未 push。
- [13:07 部署拒絕的歷史診斷](r2-sol61-release-20260930.md#1307-重送與只讀診斷仍未部署)：當時正式 325/325 檔不變且未部署；後續已查明並完成正式更新，以本節最新項為準。
- [R2 試用升級與 GPT-6.1 Sol：部署前驗證](r2-sol61-release-20260930.md)：原生 0.159 在 K 訂閱下的新 Sol 單次真回合／重開歷史通過；兩處選單取代舊 Sol、舊對話不暗換、共享知識仍排除。定向 22/22、完整 640/640、建置 UI 六項及 R1 程式＋新 CLI 讀回通過。已存 Git `R2-candidate-20260930-sol61`；正式狀態見上方 14:39 紀錄。
- [Opus 複審 R2 存檔競態小修](opus-review-r2-savefix-20260930.md)：**通過，程式面可進入使用者試用**；獨立 637/637。該複審時正式 runtime 仍為 R1，本次更新另見上項紀錄。
- [R2 存檔競態小修（第 6 節）](r2-archive-compat-no-shared-knowledge-20260930.md#6-opus-複審後補修windows-短暫讀取衝突2026-09-30)：真正 150 對話清單＋連續存檔已重現未修版 EPERM；只在 main-sessions 對同一個 rename 加最多 20 次、排定等待共 775ms 的暫時錯誤重試，失敗仍報錯、不重送 AI 工作。兩個投影測試改等實際替換完成，另修正全套抓出的假佇列測試資料錯置。定向 77/77、對話控制 15/15，最後完整 **637/637**；中途 636/637 與舊測試穩定重現均留證。標記 `R2-candidate-20260930-savefix`；正式 321 檔仍與 R1 留底相同。**僅候選、未部署／試用／重啟／push，共享知識仍排除。**
- [Opus 複審 R2 候選 20260930](opus-rereview-r2-20260930.md)：封存刪除相容、共享知識排除、631/631 獨立重跑皆通過。「偶發存檔未完成」根因確認：Windows 上改名覆蓋時若目標檔正被讀取必然 EPERM（暫存檔實驗 1752/2000）；R1 清單紀錄從不改名，B1 固定檔名把此競態帶進對話清單（持續清單讀取下 0.5%）。有上限短暫重試在清單情境下降為 0/1000，但對不停輪詢同一檔無效（ui-message-timing 測試即此寫法）。建議試用前在 main-sessions 補重試並修該測試。未改程式、未部署。
- [R2 複審修正：封存刪除相容與排除共享知識](r2-archive-compat-no-shared-knowledge-20260930.md)：固定檔名改為 R1／R2 刪除器都認得的 `-current.json`，三項缺陷先重現再通過；真正 R1／R2 刪除各三案例共 6/6，四份假資料確認進入 Windows 資源回收筒。依使用者決定，共享知識移出 R2 正式升級候選、原實驗來源與資料保留。最後完整 631/631；中途測試失敗及 D 槽偶發保存未完成另列，不宣稱該風險已修好。新版 `R2-candidate-20260930` **待 Opus 複審，未試用／部署／重啟正式 K，未 push 或呼叫模型工作**。

## 2026-09-29
- [Opus 審查 R2 第一批](opus-review-r2-batch1-20260929.md)：**有條件通過，B1 需修後再試用**。A1／A3／A4／B2 與通知測試改寫通過，獨立重跑 644/644。B1 新檔名 `${threadId}.json` 不被刪除封存程式認得：假資料重現 R2 封存後刪不掉，且「舊封存＋新取消封存」會誤刪；退回 R1 亦同。建議改名 `${threadId}-current.json` 並補端到端測試。另列 Windows 改名 EPERM 風險、R2 試用會一併帶上共享知識須使用者決定。未改程式、未部署。
- [R1 留底與 R2 首批候選](r1-r2-release-20260929.md)：R1 原始碼及正式程式分開留底；R2 已處理環境繼承、無用 Chrome 探測、錯誤原因、通知測試與對話存檔讀寫。完整 644/644、真正部署版 R1 與 R2 假資料交替讀寫通過；正式 321 檔與備份相同。**僅本地候選，待 Opus 審查；未 push／部署／重啟，不是整份盤點結案。** 其餘項目與未決取捨已列入交接。
- [重構前盤點：過度防禦與寫過頭](code-audit-overdefense-20260929.md)：Opus 在正式 K 內只讀盤點＋基準測試，未改程式、未部署。5 項已造成實際影響（AI 命令環境缺 Windows 變數、Flash `run_tests` 永遠無法執行、外部 Chrome 每次連線跑無用 PowerShell 探測、工具錯誤原因被固定句子取代、測試固定毫秒等待不穩），另列效能、卡死陷阱、脆弱耦合、舊架構殘留與建議重構順序。基準 638 項 636 通過、2 項平行負載下時序失敗（單跑通過）。git 最後提交仍為 09-19，重構前需先建立基準提交。

## 2026-09-28
- [共享知識長文三項修復與雙核心驗收](shared-knowledge-longform-fix-20260928.md)：Luna 實作、Astra 獨立返工與讀回；取消固定四筆保存及長文整份排除、補讀舊原文、缺少舊關聯不造假衝突。真 Claude／Codex 新保存各 6 條；舊四條目在正常首答／禁工具隔離／真 Jev 開啟均 6/6，更正及新程序重開通過。保留 1,500 估算 token 預算，定向 18/18、凍結版全套 638/638。最後四次真 Jev HTTP 200，但未見覆蓋增益；一處 Claude 引用 UUID 誤抄另列限制，中途失敗完整保留。**僅來源候選合成驗收；未 push、部署、重啟正式 K 或開啟日常 Jev，不保證任意長文。**
- [共享知識長文實測：未通過完整召回](shared-knowledge-longform-test-20260928.md)：21,527 字元／6 項定案，來源 Claude 能複述 6 項，但只有 4 條目；新 Claude／Codex 在 Jev 關／開均只回答 4/6。原文仍存，缺多主題擷取／自動來源展開；更正撤銷重開可讀，但無舊索引被誤標未解衝突。14 真 native、7 真 Jev；**本輪只測試與記錄，未修產品／未部署，R1 長文可靠性未通過。**
  原始失敗證據保留；後續修復與最新驗收以上項為準。
- [同專案共享知識與 Jev R1](shared-knowledge-jev-r1-20260928.md)：Luna 實作、Astra 真模型抓出 echo 重存／更正缺陷後修補；雙向跨核心首答、更正與重開通過。使用者補存 key 後，13:20 補驗 5 次真 Jev（全數 HTTP 200、260–406 ms）與 4 回合真雙核心，含 pair／再次更正／新程序跨核心讀回。補驗定向 14/14，前輪全套 634/634；未見 Jev 額外收益，仍預設關閉，金鑰 txt 尚未接入正式啟動。**來源候選雙核心與 Jev 合成 live 通過，未 push／部署／改正式 K。**

## 固定方向
[原生薄接頭與共用介面](native-adapter-direction-20260924.md)，亦列入根目錄 AGENTS.md。
[介面視覺方向：紙、墨、黃銅](visual-direction-20260925.md)：使用者 2026-09-25 確認；之後的介面修改依此規格，元件只用變數。
[個人專用、AI 操作優先](../AGENTS.md#個人專用ai-操作優先2026-09-26-使用者確認)：不為 AI 技術能力額外設計無實際人類需求的控制介面；保留必要的人類決定、接手與停止。

## 2026-09-27
- [17:15 正式 K 內 Opus 複驗（16:55 部署版）](browser-data-background-20260927.md#1715-正式-k-內-opus-55-複驗1655-部署版同對話-2f6afd1c)：正式 5 檔雜湊與收據一致。一般／無痕的 data 開新分頁、輸入／點擊、`browser_reload`（percent／base64／HTTP 共 7 次）、背景分頁 3/3、截圖 24/24、假登入雙向隔離**實際通過**。**未修好**：被擋的 reload 之後，工具回覆末尾附帶的分頁清單標題仍是空白（`browser_tabs list` 已正確）。**前景**：沙箱內讀不到 PID；遊戲或聊天視窗在前景時 0 次被搶，但 09:04:50–09:05:03Z 有一段未能歸因的 Chrome 類視窗切換。**退出未驗證**：Opus 沒有觸發入口，待本人按「離開並停止 K」後補測（[退出紀錄](explicit-exit-20260927.md#1715-正式-k-內-opus-55-複驗同對話-2f6afd1c)）。
- [同頁 reload、即時標題與截圖說明修正](browser-data-background-20260927.md#0758-三項缺口修正同頁重新載入即時標題截圖路徑說明)：来源版使用正式專用 Chrome 一般/無痕驗證，reload 6/6、current 標題 4/4、截圖 12/12；170 次前景抽樣 0 次 Chrome。正式 K 仍執行，未強制停止或覆蓋；已準備停機後備份套用的兩檔。**尚未正式部署，不把來源版通過當作正式生效。**
- [K 內 Opus 5.5 新對話複驗 0.1.2](browser-data-background-20260927.md#0712-k-內-opus-55-新對話複驗擴充-012k_browser-工具)：一般／無痕各跑一遍，percent／base64 data 開新分頁、輸入／點擊／讀回、背景分頁 A 3/3、切換分頁、HTTP 重新載入全部通過；**截圖 26/26、0 次逾時**；假登入雙向互相看不到。**data 頁無法重新載入**：`location.reload()` 被 Chrome 擋下（Not allowed to navigate top frame to data URL），F5 按鍵無效，工具集也沒有重新載入工具。OS 前景未驗，需本人回報。未改程式。
- [正式最小化截圖修正通過](browser-data-background-20260927.md#0659-正式chrome最小化截圖修正驗證通過)：本人重開後旗標讀回生效，主代理用正式runtime/native/profile走MCP，一般／無痕×HTTP／data共12/12截圖與計數通過（60–1431ms）；154次前景抽樣0次K Chrome，兩視窗仍最小化。無額外擴充／K後端更新，Opus可接續模型端複驗。
- [正式最小化Chrome截圖追查](browser-data-background-20260927.md#0652-正式截圖失敗重現與候選尚未驗收)：已重現截圖停住，僅補K手動入口CDPScreenshotNewSurface候選；待本人重開專用Chrome後驗證，不宣稱修好。
- [0.1.2 正式 Opus 複驗](browser-data-background-20260927.md#0643-正式-k-內-opus-複驗012本人手動開-k-專用一般無痕視窗後)：本人開專用視窗後兩模式連線成功；data（percent／base64）、背景分頁輸入／點擊全通。**截圖 6/6 逾時（一般／無痕、data／HTTP 皆然）**，根因未查；不搶前景待本人回報。未改程式。
- [正式原生連線失敗追查](browser-data-background-20260927.md#0638-正式未連線回報診斷已補根因尚未確認)：06:38只備份更新host安全診斷，14/14測試通過；正式descriptor不存在，檢查時專用Chrome未開，尚待實際啟動讀回，不宣稱根因或修復完成。
- [data 網址與背景操作修復](browser-data-background-20260927.md)：06:19已備份套用23檔、擴充0.1.2與限定HKCU原生連接，正式K重啟隔離讀回通過。65/65定向回歸、Native Messaging一般／無痕與data四案例全通；移除自動開窗／原生聚焦。本人須重新載入擴充並先開所需模式視窗；正式Opus與headed不搶焦點仍待複驗。
- [正式 K 內 Opus 一般／無痕實測](k-browser-assistant-20260927.md#0409-正式-k-內-opus-一般無痕實測本聊天室)：取消自動暫停後，Opus 於正式 K 用本機假網站完成兩模式連線、導航、讀頁、輸入、點擊、新分頁、截圖；一般看不到無痕假登入，切換後分頁保留。限制：data: 網址被拒、背景分頁需先切回前景。未改程式；真實網站登入、下載／上傳仍待驗收。
- [移除 Chrome 自動人工暫停](browser-no-auto-pause-20260927.md)：依本人最新決定，移除 observer、command gate、下一則訊息解鎖與 UI 告示；保留明確停止與隔離。48/48 定向回歸、UI 建置通過；03:49 備份更新、03:59 正式重啟讀回完成。完整 loader 補測未完成，K 內 Opus／玩遊戲並行待本人驗收。
- [Chrome 白窗／接線修復讀回](k-browser-assistant-20260927.md#0336-停止恢復與-chrome-首啟修正)：修正 Electron 啟動 Chrome 時首啟提示擋住 URL 的已重現路徑；03:36 備份更新，正式 bridge＋真 Chrome 一般／無痕均連上 localhost 假頁。03:39 正式 K 重啟讀回完成；K 內 Opus 完整驗收仍待本人重測，舊現場唯一根因不做過度認定。
- [K 停止卡住修復](shutdown-repair-20260927.md)：移除閒置 uncertain 單獨阻擋，保留實際工作／核准保護；40/40 定向回歸。03:30 備份更新正式檔，正式啟動→正常關閉 confirmed:true、port 關閉與 8 box 空讀回通過；舊现场具體阻擋欄位未知。
- [擴充載入失敗修復](k-browser-assistant-20260927.md)：移出誤留正式套件內的底線開頭測試資料夾，證據保留；補以真正 installed 目錄實測載入及一般／無痕自動連線通過。
- [取消瀏覽器重複允許](k-browser-assistant-20260927.md)：**02:53 擴充0.1.1已備份套用固定位置**；一般／無痕命令列自動連線、無允許點擊假頁驗證通過。Chrome需一次重新載入擴充，正式Opus回合待重測。
- [非必要常駐告示精簡](notice-trim-20260927.md)：移除連網免責、子代理準備旁白及重複權限說明，保留必要核准與錯誤；26/26 定向回歸、獨立 Electron 假資料 UI 通過。**01:51 已備份套用 9 檔並重開，正式隔離健康與新版資產讀回通過**。
- [K 瀏覽器助手](k-browser-assistant-20260927.md)：使用者選定外部 Chrome 與 K 品牌擴充，要求在 K 新 Astra 對話實測一般／無痕。擴充固定安裝於 installed/k-browser-assistant；一般／無痕假頁、固定位置拒寫及全套569項回歸通過。**02:26 備份更新21檔並重開，正式隔離健康、27個工具及新版資產讀回通過；正式Astra回合與真登入待本人驗收**。
- [最小化還原黑畫面](native-browser-minimize-restore-20260927.md)：原生假頁候選重現 view 還原後未重新呈現，補既有 refresh 通道；同頁、輸入、假登入與控制權保留，14 項候選檢查及 4 項定點測試通過。**僅本地候選，未部署**；既有隱藏頁 resize preflight 與 bounds 警告另列限制。
- [瀏覽器成熟產品與開源接線研究](browser-reference-research-20260927.md)：查核 Claude Chrome 擴充、Codex 雙路徑、VS Code MIT WebContentsView 原始碼、Playwright／Chrome DevTools MCP。既有 K gateway 接完整 Chrome 假頁與控制權切換通過；**Google 真登入、內嵌呈現與正式隔離未驗，不更換正式瀏覽器**。
- [縮放分頁截圖畫布修復](browser-screenshot-zoom-canvas-fix-20260927.md)：修正 zoom 下擷取範圍及捲動座標，CSS 輸出精確 1280×800；背景、重新載入、縮放點擊、逐張四角連拍、PNG/JPEG/WebP 通過，最終凍結 **552/552**。**00:43 備份更新正式 1 個模組，保持關閉供本人重測**；中間像素誤差與漏驗捲動裁錯的失敗證據保留，不宣稱真網站間歇逾時已根治。

## 2026-09-26
- [Claude 連線狀態與瀏覽器尺寸讀回](connection-browser-fix-20260926.md)：設定重啟不再誤報 offline／吞串流；resize 等實際畫面並讀回、逾時明確失敗及還原。最終循序 **552/552**、三頁各三尺寸／截圖及 5 秒失敗路徑通過，**23:55 備份部署 2 檔、保持正式關閉待本人驗收**。同一路徑原版亦可截圖成功，故不宣稱間歇截圖問題已根治；測試選頁誤判與失敗紀錄完整保留。
- [註解收合與 K 圖示](annotation-dismiss-icon-20260926.md)：新增留言不展開清單、外點／Escape 收合保稿、清空重置，原生視窗使用既有 ICO；50 項定向、12 項候選 UI。23:18 已備份更新 10 檔，23:20 正式啟動、使用者截圖確認 K 圖示；正式註解完整操作未代驗。23:22 另發現 Claude 原生在工作但 K 投影斷線，正在分開診斷，不重送。
- [簡潔引用與選填留言](annotation-popover-20260926.md)：重用已安裝 assistant-ui 公開浮框、不新增套件；反白附近加入聊天、一行選填留言、數量標記及一般 Enter／箭頭送出。凍結版 **549/549 全套、12/12 原生假對話 UI**；**22:49 與前批四個後端／原生檔合併部署，22:50 使用者原捷徑開啟、22:51 正式 UI 讀回**。12 檔與備份指紋一致，隔離健康、原對話、正式 JS 和實際浮動入口已驗；沒有新增模型回合或開麥克風。完整備份／還原與啟動 policy 拒絕亦留錄。
- [Opus 複查後三項收尾](opus-review-followup-20260926.md)：異常關閉可重試、可信主介面權限收窄，另修 X 隱藏後取消聽寫。當時 **544/544**、原生 fake-media **11/11**；KCandidate1 在整個 K 工作區開放下，trusted-runtime 新建／覆寫假檔皆 **EPERM**。**22:49 已合併部署、正式讀回完成**；保留前輪無法安全停止的歷史、失敗、剪貼簿假資料副作用與精確驗證範圍，不把候選假音訊當真麥克風驗收。
- [Opus 5.5 本機聽寫獨立複查](opus-review-local-voice-20260926.md)：使用者授權 Astra 代操作正式 K，既有 Opus 5.5 回合已完成，結論**有條件通過**。提出辨識異常退出可能卡住 K 關閉、可信主介面權限加固，以及整個專案開放時 trusted-runtime 寫入拒絕仍待實測。保留完整原回覆、證據限制及一次唯讀終端搜尋的執行偏差；本輪沒有修程式／改權限／再部署。
- [本機離線聽寫修復與正式更新](native-voice-fix-20260926.md)：535/535 全套、8 項原生 UI 檢查、真離線 Whisper 合成語音／靜音及部署後 helper 推論通過；保留草稿、波形、停止、取消、箭頭送出及切室歸屬，補 Windows 啟動入口不分大小寫。19:28 備份更新 12 個正式檔案；前次工具拒絕後使用者再次授權，**20:18 原入口正式啟動成功、真實視窗／隔離服務／新版介面 hash 均讀回，K 保持開啟**。未收真麥克風、未讀舊錄音／逐字稿／登入資料、未更改隔離權限。首次回歸及 UI probe 失敗紀錄均保留。
- [原生視窗語音錯誤診斷](native-voice-diagnosis-20260926.md)：獨立 Electron 44.4.5／fake audio 重現 Web Speech `network` 錯誤；保留不支援提示、Win+H 及 SAPI 方案未採用的原因。使用者後續允許借用現成本機 ASR 及更新正式 K，最新實作與部署狀態以上列修復文件為準。
- [K 專案工作區的秘密檔隔離實測](workspace-secret-isolation-20260926.md)：在 `KCandidate1` 實際有效 `D:\K-harness\*` 開放規則下，先核對盒內 PID，再只開啟／關閉讀取 handle；一般假檔成功，真正 `.env.local` 與正式受保護 vault 內假檔均 `EPERM`，秘密內容讀取 **0 bytes**。原工作程序與政策前後一致，未停止工作、修改權限、更新或重啟正式 K；不宣稱全套功能測試或任意憑證路徑已驗。
- [原生瀏覽器正式更新與啟動修復](native-browser-release-20260926.md)：修正 Electron 直接 CJS 入口的 `require.main` 誤判及初始化前退出問題，**18:20 正式系統匣啟動、隔離健康狀態及真實原生視窗均讀回成功**，K 保持開啟。新增入口行為回歸，定向 13/13；前輪 513 項不冒充本次全套。17:24 備份／工具拒絕、18:12 使用者啟動失敗與候選測試缺口全部保留；不改登入資料，既有工作區動態規則與核心保護另有正式讀回。
- [真正嵌入瀏覽器候選](native-browser-candidate-20260926.md)：Electron 真實網頁取代人類截圖面板；原生輸入、彈窗假登入延續、官方 MCP 同頁、兩家真模型接續與隔離假資料均有證據。最終 14 項真 UI 驗證及 513 項全套回歸的精確版本／失敗歷史見內文；正式狀態以上項為準。
- [Electron / Sandboxie 假資料隔離檢驗](../scripts/electron-isolation-20260926.md)：KCandidate8 fake candidate 對 fake Electron／relay 的記憶體與 handle 權限、vault 拒讀、工作區讀寫及 47831 人類入口均有最終通過讀回；DuplicateHandle source `0` 的失敗不作獨立證據。僅限本輪假資料，不代表正式 K／所有路徑已驗收。
- [輸入框寬度、高度與模型簡稱](composer-layout-fix-20260926.md)：保留窄窗防溢出規則，將訊息欄與輸入卡片可見寬度同限 720px、收矮空輸入框，只縮短輸入框模型按鈕並保留完整提示。循序完整測試兩輪皆 487/487，正式隔離版已更新並重啟；1920/1000px 的首頁與既有對話各有截圖及讀回。首輪並行測試 2 項失敗原因未釐清、1000px 成果面板原有覆蓋行為均如實記錄。
- [工作區封存與真正資料夾選取](workspace-selection-fix-20260926.md)：修正封存後仍停在舊對話、隔離版 picker 回傳契約及啟動復活已封存工作區；中文工作區 A/B/A 真隔離讀寫與保護邊界通過，487/487 測試；04:19 正式重啟、首頁與 picker 程序讀回完成，原生視窗手動選取尚未代操作。
- **正式隔離版已於 03:12 上線**：[整批收尾與唯一複查入口](closeout-20260926.md)。使用者選擇新私人工作區／新聊天室，舊資料原處保留；雙模型真實檔案／瀏覽器接手、AI 尺寸與縮放、模型下載、原生子代理、多段引用、正式 47831 邊界與實際 Chrome 畫面均留證。最後全套 **472/472**（03:25 最終重啟、有回合歷史及兩家登入讀回；包含空白對話精確錯誤提示）。帳號連接器保留，真麥克風、Claude 此次未提供的 TodoWrite、任意舊工作區與其他網站登入不假稱已驗。以下為各階段歷史紀錄。
- [Claude host 關閉失敗保留重試句柄](claude-host-teardown-retry-20260926.md)：修正 close／stop／workspace 切換／設定重啟與 open 清理的 host 先清空問題；失敗保留句柄與 uncertain，close/stop retry regression；focused **45/45**。未啟動模型或占用 Sandboxie，live shutdown/UI 由主代理驗收。
- [整批收尾與正式更新總表](closeout-20260926.md)：本輪唯一最新交接入口；已正式切換，完整狀態、失敗過程與未驗證範圍依總表，不以早期文件當最新阻擋清單。
- [系統匣啟動器相容入口](launcher-entry-20260926.md)：根目錄 `Start-K-Desktop.ps1` 現只委派 `local-launcher/dist/K桌面啟動器.exe`；缺少 EXE 即 fail-closed，`-NoBrowser` 舊式直接啟後端明確拒絕。保留原入口至 closeout backup；來源測試 2/2。未啟動程序、未編譯／部署或做 live 驗收。
- [複查後更正與連接器長期保留](isolated-model-ui-acceptance-20260926.md)：使用者已決定長期保留官方帳號連接器，不採預先停用；決定同步至 `AGENTS.md`。補明 Codex `exec` 工具協調路徑已跑過、一般 shell／完整隔離仍未驗收；接手測試由 Astra 操作介面而非使用者本人，過去截圖與核准事件未匯存，不補造證據。更正 `browser_resize` 已列出但尚未驗證整合，縮放／寬高貼合待實作。本次僅文件修正與讀回，未改程式、未新增測試或操作外部帳號，未部署／重啟。
- [Opus 複查：隔離候選雙模型 UI 驗收](opus-review-isolated-model-ui-20260926.md)：紀錄大致正確；重跑循序全套 **431/431**，證據、修正與「正式未動」都核對一致。待處理：兩家 CLI 內建的帳號連接器（Codex 的 Figma 工具、正式 K 中 Claude 的 Google Drive／Claude Docs）不經過 K 的隔離，需要使用者決定；Codex 的瀏覽器呼叫經由內建 `exec`，原生執行路徑已部分跑過；右側截圖、人工輸入和核准的證據沒有保存；`browser_resize` 已開放但未驗證。本輪只複查，沒有部署或登入。
- 個人設計原則確認：將使用者本輪方向寫入 `AGENTS.md`「個人專用、AI 操作優先」，瀏覽器尺寸／縮放交由 AI 調整，右側自動符合面板，不新增人用進階設定。此次僅修改專案規則及本索引，已讀回核對；未修改程式、未執行功能測試、未重啟或部署。AI 調整瀏覽器尺寸／縮放仍是待實作方向，不宣稱已完成。
- [本人登入後雙模型 UI 驗收](isolated-model-ui-acceptance-20260926.md)：兩家 pro 訂閱已確認，重啟候選仍保留登入；真實 Claude／Codex 各三回合，右側同頁、人工輸入、接手鎖拒絕、交回讀值通過。修正乾淨 Codex home 的停用 MCP 缺 transport 導致 thread/start 失敗，同根因 Luna 接線一起修。正確循序全套 **431/431**；只更新 47971 候選，正式未動。Codex 原生 Windows 沙箱仍 notConfigured，未初始化；一般命令與正式部署尚未驗收，不可登入其他網站。

## 2026-09-25
- [Claude 登入連結與人工授權碼交接](claude-login-handoff-fix-20260925.md)：修正新官方 claude.com 被舊清單丟棄，保留跨盒剪貼簿隔離，改從 K 複製官方手動入口並將授權碼直接交回原 CLI。針對性 **14/14**、循序全套 **431/431**；候選 UI 複製讀回與假錯誤碼拒絕通過。只更新 47971，正式未動；候選已確認 Codex pro，Claude 待本人完成。
- [獨立隔離候選與原生執行接線](isolated-desktop-candidate-20260925.md)：Claude／Codex／Luna／Pi 執行器、可信端瀏覽器與程序內人工接手；真實假資料 **6 組、427/427 回歸通過**，MCP fixture 缺 runner、內部 state 被當 workspace 已修。主代理抓到 UI probe 白畫面驗收不足，補已解碼像素／最終截圖核對後，右側假頁與人工接手通過，非真正模型回合。已開獨立候選等待本人登入兩家官方訂閱，確認個人非商業；**非正式部署、不可登入其他網站**。
- [附件漏存與輕量檔名標籤](attachment-label-fix-20260925.md)：修正 Claude 已傳圖卻未存 K 附件 metadata；改為「PNG＋截短檔名／滑鼠完整名稱」，不做縮圖或放大。**401/401、附件 UI 與 9 類導航回歸通過**；確認三室閒置後，22:26 正常重啟正式 K，精確補回原單則附件，原視窗／API live 讀回完成，沒有重送或新增模型回合。
- [Sandboxie 執行接線與 WFP 假資料驗證](sandboxie-runtime-integration-20260925.md)：真實 runner 5 組通過（雙工作停止隔離、假檔拒絕、兩家官方 CLI 空 home 檢查），人類假網路入口核心阻擋／AI 假入口可用；完稿後循序全套 **401/401**，先前並行失敗／中止證據保留。修正相容性自動彈窗並更正「X 可取消」的初始說明；未套模板。**僅隔離候選，正式全代理／可信部署尚未接完；未登入、未啟用瀏覽器**。臨時驅動／服務已官方解除登記，多餘程式／盒／安裝檔已確認移入回收筒。
- [Opus 第三輪：正式畫面](opus-review-visual-direction-20260925.md)：正式配色和 17px／110% 版面確認正常。`--app` 標題列沒有變色：取樣和工作列同為 Windows 輔色，而正式頁面已有 theme-color，判斷 `--app` 視窗不會套用。建議跟著 PWA 候選一起驗證，不改 Windows 全域設定。真實「需要確認」狀態同步仍待測。
- [紙、墨、黃銅介面正式切換](visual-formal-switch-20260925.md)：使用者明確授權後，22:03 部署兩輪 Opus 複查通過的同一候選，**正式 HTTP 與原使用者視窗 live 讀回完成**；17px／110% 設定保留，後端未重啟、舊版可回復。真實待核准狀態同步／Windows 最外層標題列仍待實測，徽章 PWA 未合併。
- [Opus 第二輪：視覺四項修正](opus-review-visual-direction-20260925.md)：四項都已確認完成，沒有新的阻擋項；已看截圖並抽查程式，重跑樣式／外觀測試 8/8。觀察：沒有手動調過寬度時，切換成果／瀏覽器分頁會讓面板一寬一窄。正式切換後仍需確認真實狀態同步與 `--app` 標題列顏色。
- [視覺複查後四項修正](visual-review-fixes-20260925.md)：停用送出鈕改淺、截圖狀態一致、成果面板預設 420px 並保留瀏覽器寬版／手動寬度、新成果改按每室已見檔名。**366/366、19 類互動、9 類導航、54 張矩陣＋1 張代表截圖通過**。Opus 已接受前一版整體視覺；本輪小修僅隔離驗證，未正式切換，真實對話同步／Windows 標題列仍待實測。
- [Opus 複查：紙、墨、黃銅視覺實作](opus-review-visual-direction-20260925.md)：符合規格，沒有阻擋項；已看截圖並抽查程式，重跑樣式／外觀測試 8/8。建議：停用中的送出鈕改淺、假資料的側欄與標題列狀態改成一致、沒有記憶寬度時右側面板預設約 420px、新成果改用名稱判斷。正式切換與 `--app` 標題列顏色仍待驗證。
- [紙、墨、黃銅：產品視覺實作](visual-direction-implementation-20260925.md)：保留完整字級／縮放及偏好，不做字級遷移。27 組等值比對、54 張新 UI 矩陣、12 類互動／9 類並行導航通過；最終預設／循序全套皆 366/366。早一輪 365/366 的既有 Claude 等待時間不穩定亦保留紀錄。**本機實作驗證完成、Opus 複查無阻擋項、未正式部署**；後續小修見上項，不合併另案 PWA。
- [Sandboxie Plus 隔離假資料實測](sandboxie-isolation-pilot-20260925.md)：官方簽章／hash 核對、按需驅動／服務安裝後，**同 SID 假記憶體讀取拒絕、指定假 cookie／token 拒絕、workspace／Node／Git 可用**。直接 stdio 失敗的反證保留；單一 named pipe 轉接 10 項通過，假 cookie 仍拒絕。服務／驅動已官方解除安裝，安裝檔／可攜程式／假盒已確認移入回收筒；原 ACL 不變。**只完成候選試點，未接正式代理、未啟用瀏覽器或真實登入**。
- [工作列完成數字：隔離候選](taskbar-badge-candidate-20260925.md)：使用者同意另做可安裝 PWA 候選；每室未讀完成數、turnId 已看確認與持久化、focus／visibility 接線。Astra 獨立 5/5、假 UI、真正候選 HTTP 路由、可安裝性檢查通過。**未安裝／未切正式，Windows 工作列數字未驗證**；無常駐更新服務，清理偏差已記錄並停止。
- [視覺第 0 階段：靜態樣稿與截圖](visual-direction-stage-0-20260925.md)：單檔離線樣稿、正黑體／思源黑體、16／17／18px、五張 1920×1000 截圖及實際字形讀回。樣稿完成；**後續使用者已取消字級選擇關卡，保留產品全部字級與偏好**。當時隔離建置成功；循序全套 363/363，預設並行兩輪各 362/363，固定等待相關失敗保留。
- [官方 Codex 沙箱隔離實測](codex-sandbox-isolation-result-20260925.md)：精確版本來源與追加授權核對後已完成，**9/10，整體未通過**；假 cookie／token 檔案拒絕正確，但實際讀到假人類程序 36 bytes，雙方 logon SID 相同。ACL 差異僅新 workspace，官方 helper 例行重套無語意差異，帳號／setup marker 不變、假程序已退出。未讀真憑證、未啟用正式瀏覽器。原[前置檢查](codex-sandbox-preflight-20260925.md)保留歷史，不再當作尚未執行。
- [K 介面視覺規格：紙、墨、黃銅](visual-direction-20260925.md)：標誌配色、Segoe UI／微軟正黑體及四階段驗收。原始 16px／18px 遷移方案已由後續使用者要求覆蓋，保留全部設定。實作與正式狀態見上方產品視覺紀錄。
- [聊天室並行與工作中切換](concurrent-conversations-20260925.md)：每室獨立原生連線／佇列，側欄不再被單一主代理 busy 鎖住；停止、核准、附件、草稿皆綁來源對話，並補晚到送出回覆的草稿保留。**363/363**，建置後隔離 UI 通過；前端已重建、正式後端未重啟，真正模型雙聊天室驗收待安全重啟後進行。
- [登入隔離試點：可信端 MCP 與 Windows 反證](browser-isolation-pilot-20260925.md)：owner gateway 同頁接手／重連／取消通過，**344/344** 回歸；已授權建立 `KAgentSandbox`、只改新假資料目錄 ACL，測完停用。**OS 試點 9/10、整體未通過**：檔案保護成功，但取得人類程序 VM_READ handle。desktop cookie 發放、可信部署與全代理低權接線仍待處理；新 gateway 未正式接線，正式瀏覽器仍關閉。
- [下載備份去重與新批次保留上限](browser-download-retention-20260925.md)：完整組去重、已淘汰原文不重建、新版最多 5 批；無日期舊版批次不自動刪除。**340/340**，Edge／Chromium 各 8 次、MCP 3 次假資料驗證通過。原生清除同步與登入隔離未完成；正式仍關閉。
- [下載紀錄相容性修補與正常關閉](browser-download-history-fix-20260925.md)：上游 issue 與假 profile 對照鎖定下載紀錄恢復；否決只處理完成紀錄，改為原生三表離線搬存備份。Edge／Chromium 各 4 次程序啟動，假 cookie／LS／IDB、下載及取消／接手通過；Astra 獨立再驗 Edge 與 MCP。**334/334**，正式仍關閉、登入隔離另案未完成。
- [Codex 取消後原對話重連](browser-reconnect-fix-20260925.md)：原生實測同 host resume 不更換 MCP，新的專屬 host 可恢復同對話瀏覽器；不送模型回合。
- [取消與登入隔離接續](browser-cancel-followup-20260925.md)：取消安全關閉＋右側等寬分頁面板；321 測試通過、隔離 UI 驗收。真實登入隔離另案確認，正式維持關閉。

- [Opus 第二輪：取消修正與寬幅面板](opus-review-browser-live-view-20260925.md)：321/321；取消改為先安全關閉再釋放，確認正確。待確認 Codex 重開對話是否真的重建 MCP；token/cookie 隔離仍未解決，面板僅警告。

- [Opus 第三輪：工具列與下載](opus-review-browser-live-view-20260925.md)：325/325；路徑、檔名、取回端點確認正確。建議補：下載檔寫入 Mark of the Web（Zone.Identifier）與危險類型警告、保留裝置名稱、大小上限。模型下令下載未驗證。

- [Opus 第四輪：下載安全、Codex 重連、持續登入方案](opus-review-browser-live-view-20260925.md)：326/326；來源標記雙路徑、保留名稱、64 MiB、重建 host 重連均確認。待查：假 exe 下載失敗導致整個瀏覽器不可用。登入方案「AI 以低權限身分執行」方向同意，實作前需列出日常代價。

- [Opus 第五輪：游標跳尾、下載崩潰](opus-review-browser-live-view-20260925.md)：327/327；游標修正確認，輸入法組字待使用者確認。崩潰分層正確；重用 profile 即崩潰會擋住持續登入，建議先定位 profile 內觸發狀態（只清該項保留登入）。

- [Opus 第六輪：重用 profile 下載崩潰修正](opus-review-browser-live-view-20260925.md)：334/334；三表同交易搬存、EOF 正常關閉、假登入延續確認。建議：備份表依 guid 去重並設保留上限（隱私：保留已清除的下載網址）。

- [Opus 第七輪：備份去重與保留上限](opus-review-browser-live-view-20260925.md)：340/340；完整組去重、seen 防重建、交易內淘汰確認；無新阻擋項。舊批次清理與清除同步留待人工清除功能。

- [Opus 複查：登入隔離試點與聊天室並行](opus-review-isolation-concurrency-20260925.md)：363/363。同意隔離判定失敗，並補充共用 logon SID 會暴露人類所有程序，不能部分上線；建議下一輪先評估現成 `codex sandbox` runner（需授權）。並行架構確認，建議閒置聊天室自動回收。揭露 Opus 誤觸一次 `codex sandbox windows` 執行（失敗，無程式執行）。

## 2026-09-24
- [瀏覽器同頁顯示與人工接手](browser-live-view-20260924.md)：右側＋可關閉分頁、真實獨立 Edge 畫面、多頁、接手/交回；隔離 UI 已輸入並讀回假資料。正式未啟用，真正模型同頁接續留待 Opus 複查。
- [第三輪複查接續修正](browser-review-followup-20260924.md)：讀回三份原生證據；补 Auto/略過提示的瀏覽器風險文字，修正假檔 Windows 路徑比對，保留 Opus tool_result 記錄。右側瀏覽器與人工接手仍未完成。
- [第二階段核准驗收交接](browser-approval-round2-handoff-20260924.md)：修正可重跑原生探測入口，允許必要 schema discovery、每次單一模式、預設 dry run；交由 Opus 跑剩餘三模式，正式仍關閉。
- [Playwright MCP 啟用前修正與驗收](browser-security-fix-20260924.md)：唯讀／計畫模式停用、固定每對話檔案範圍、假金鑰 upload/drop 拒絕、移除 unsafe code、補安裝授權。正式仍關閉。
- [原生瀏覽器核准探測](browser-native-approval-probe-20260924.md)：四個隔離原生回合；僅 Codex auto-review 真正提出工具並被原生拒絕，其餘三種未到核准階段，不算通過。
- [人類工作台面板精簡](human-panel-20260924.md)：成果優先、子代理次要；核准/提問移至輸入框上方，技術頁籤退出日常介面。隔離 UI 驗收，不代表正式已重新整理。
- [瀏覽器協作方案查證](browser-collaboration-assessment-20260924.md)：Microsoft Playwright MCP 優先，不改模型計費；原生控制、右側內嵌、人工接手分別驗證。
- [Playwright MCP 安裝與原生接線](browser-mcp-integration-20260924.md)：固定 0.0.82，專案限定且預設關閉；Claude/Codex 配置回歸與無帳號 tools/list 驗證。尚未完成真實模型操作、右側畫面與人工接手。
- [設定/封存/追加訊息顯示](settings-archives-message-visibility-20260924.md)：283 測試通過；介面建置。封存刪除需正式後端重啟，未刪真實對話。
- [瀏覽器聽寫](browser-dictation-20260924.md)：先前限定驗證；不能據此宣稱每台電腦實際辨識成功。
- [原生通知與 Codex 呈現](native-events-20260924.md)：已實作與測試；正式後端未重啟。
- [Claude 可觀察性](claude-visibility-20260924.md)：已實作與測試；原生能力缺口依文件明示。
- [原生搜尋/審查](native-actions-20260924.md)：已實作與測試；原生能力缺口依文件明示。
- [共用介面與複製回饋](native-ui-validation-20260924.md)：隔離 UI 驗證、官方只讀 readiness/search 通過；正式後端仍待重啟。

- [Opus 複查：原生通知／可見性／搜尋審查](opus-review-native-20260924.md)：Claude 上下文用量在正式環境缺少 `--include-partial-messages`，待修；子代理歸屬仍未實測。
- [Opus 複查修正：Claude 額度狀態](opus-review-rate-status-fix-20260924.md)：正常 allowed/組織未啟用額外用量不再視為警告；非 allowed 通知依狀態轉換去重；本機測試通過，正式後端未重啟。

- [Opus 複查：Playwright MCP](opus-review-browser-mcp-20260924.md)：啟用前必修 3 點（唯讀/計畫模式仍載入、檔案根目錄含 `.env.local`、繞過 Codex 網路沙箱）；安裝授權需補紀錄。
- [瀏覽器權限接線修正](browser-permission-fix-20260924.md)：controllers 依供應商與有效模式載入 MCP；Codex 權限切換重開同原生 thread；composer 呈現實際 browser/network state 與網路揭露。64/64 controller 回歸通過；未正式啟用或重啟，原生核准行為未實測。
- [原生瀏覽器核准探測](browser-native-approval-probe-20260924.md)：四模式各一隔離短回合；Codex auto-review 拒絕假 `.env.local` 上傳，其他三模式未實際形成工具呼叫，未能判定核准語意；roots 未觀察。

- [Opus 第三輪：瀏覽器原生核准三模式實測](opus-review-browser-mcp-20260924.md)：Codex 要求核准、Claude 手動均實際呼叫並跳原生核准，由 K 回覆拒絕；Claude Auto 不經 K，由原生分類器拒絕上傳。三者皆未到檔案 guard。探測腳本補記 tool_result。正式仍關閉、未重啟。

- [Opus 複查：右側瀏覽器與人工接手](opus-review-browser-live-view-20260925.md)：319/319；Claude、Codex 各一次隔離實測「讀假頁→人工接手修改→接手中 AI 工具被 K 互斥拒絕→交回→模型讀回」全部通過。待修：取消時 AI 計數可能卡住；`live.json` token 與 cookie 在模型可讀位置（真實登入前必處理）。React 面板端到端、多頁對應未驗證。正式仍關閉、未重啟。

## 複查規則
程式/測試/正式服務讀回高於這份索引。未寫 live 驗收即不代表正式可用。不可拿本機建置代替正式重啟，也不自動重送任何舊工作。

## 人類面板與瀏覽器接線本輪驗收
- [Codex 空白 thread 讀回提示](codex-empty-thread-readback-20260926.md)：原生 `thread not loaded: <threadId>` 僅對精確 thread ID 顯示未讀回提示，保留 K 清單與原資料，不重送或自動重建；其他原生錯誤照常回報。假 host regression 驗證錯誤分流、無 `thread/start`/`thread/resume` 與 metadata 不變；未操作正式服務。
- 主代理獨立重跑 307/307，0 失敗；紀錄 `.runtime/human-panel-final-tests.log`。UI build 成功，既有 bundle size 警告仍在。
- 47843 隔離 UI：成果/子代理切換、核准在輸入框上方、核准後消失不切面板、子代理摘要展開、中文計畫步驟、1440x900 配置已讀回。測試頁與服務已關閉。
- 正式 47831 未重啟，沒有操作正式聊天室、登入或重送訊息。正式 appRoot 沒有啟用 browser-mcp.json。
- 本輪是「介面實作並隔離驗證 + 瀏覽器 MCP 基礎接線」，不是完整 Computer Use 交付；右側瀏覽器同畫面及人工接手仍待實作/驗收。

## 本輪最終讀回
- 主代理完整 npm test：296/296，0 失敗（.runtime/archive-ui-20260924/native-final-tests.log）。
- UI build 成功；既有大型 bundle 警告保留。
- 正式服務未重啟；本輪沒有送出真實模型審查、修改全域設定或改計費來源。

## Opus 後續複查修正
- [Claude 串流與正式啟動旗標](opus-review-stream-fix-20260924.md)：真實 K host/controller 隔離回合驗證 25 次增量、最終 1 則、上下文實值；正式後端未重啟。
- [額度通知修正](opus-review-rate-status-fix-20260924.md)：正常狀態不通知、異常狀態去重，用量詳情固定說明；原生實值經隔離 UI 讀回。
- 此次複查修正最終全套測試：300/300，UI 建置成功。未部署正式後端。

- [工作中附件與暫時狀態橫幅](busy-attachment-status-fix-20260924.md)：修正忙碌時附件入口及 requesting 橫幅堆疊；301 項回歸、隔離 UI 附件入列驗收。正式後端未重啟；前端重新整理即可套用顯示與附件入口修正。

## 2026-09-25：瀏覽器工具列與下載
- [browser-toolbar-downloads-20260925.md](browser-toolbar-downloads-20260925.md)：網址、上一頁／下一頁／重新載入、下載清單與安全保存；325 測試、真實 Edge 本機右側 UI 驗收。正式關閉與登入隔離限制不變。
- [browser-reconnect-fix-20260925.md](browser-reconnect-fix-20260925.md)：補齊 Codex 取消後重建專用 host／恢復原對話的最終驗證狀態，不重送歷史回合。

## 2026-09-25：下載安全與持續登入評估
- [下載安全補強](browser-download-security-20260925.md)：326/326；Claude／Codex 模型實際下載及兩份保存檔的 Windows 來源標記通過；HTTP 另存副本標記仍有限制，UI 假 exe 失敗待查。
- [持續登入與隔離方案](browser-persistent-login-plan-20260925.md)：保留現有 UI／Playwright，採成熟 OS 邊界的候選與驗收條件；未建立帳號、改權限或啟用正式瀏覽器。

## 2026-09-25：下載崩潰根因分層與隔離代價
- [下載崩潰調查](browser-download-crash-investigation-20260925.md)：327/327；K 外官方 download.path 亦重現原生 0xC0000005。授權安裝的 Chromium 首次成功、重用 profile 仍崩潰，未換正式預設。
- [持續登入使用代價](browser-persistent-login-plan-20260925.md)：補登入、跨身分啟動、工作區權限、工具及還原前提；未修改 Windows 帳號／ACL。

## 2026-09-25：主聊天框貼上後游標跳尾
- [主聊天輸入修正](composer-caret-fix-20260925.md)：修前實際重現段首插字後游標 52；修後為 1，中段插字與選字替換正確。父層草稿更新延至輸入同步後；327/327、UI build 通過。原生 Windows 輸入法候選窗未自動化驗證，正式後端未重啟。

## 2026-09-26：隔離版正式啟動器候選
- [隔離版 K owner supervisor 與托盤接線](isolated-launcher-supervisor-20260926.md)：新增固定候選路徑的 private stdio supervisor，使用新 `vault/private-state`、既有私人 workspace/profile/provider homes 與 Sandboxie pool；托盤只透過驗證過的記憶體 bootstrap URL 開啟，沒有一般 host fallback。50/50 focused tests、C# 候選編譯成功；候選 binary 未執行，正式服務未重啟，尚待主代理檢查 policy readback、同步 trusted runtime 與真實候選/正式驗收。





## 2026-09-27 明確退出修正正式套用
[退出不再被忙碌狀態阻擋](explicit-exit-20260927.md)：移除重複確認及 idle 前置檢查，28/28，正式 runtime 真實正常退出成功，備份部署並重開讀回 isolated。

## 2026-09-27 17:45 補修驗證（待套用）
[瀏覽器附帶標題與輸出路徑](browser-data-background-20260927.md)、[設定停止後殘留桌面修正](explicit-exit-20260927.md)：84/84；雙模式 12 張截圖與前景 PID 抽樣；busy 真實 Electron 假控制器正常退出。正式舊殼仍待正常結束。

退出驗證更正：Opus 回報等待指令被拒絕，正式工具執行中退出尚未驗證；見 explicit-exit-20260927.md 最後更正，不能以 UI busy 代替實際工具執行證據。

- 2026-09-27 本輪正式剩餘瀏覽器修正套用及實測：見 [browser-data-background](browser-data-background-20260927.md) 末段，12/12 截圖及 187 次前景抽樣。實際工作中退出失敗及 Sandboxie 預期斷線競態修正、34/34 回歸見 [explicit-exit](explicit-exit-20260927.md) 末段；最後 socket 修正待部署，勿標成全部完成。
- 2026-09-27 18:01：經本次明確授權結束殘留 K，正式套用 sandboxie-process 預期斷線修正；35/35、正式正常退出及正式模組假 busy 設定頁退出成功，原入口重啟 health=isolated。未新增模型回合；完整備份、收據、驗證限制見 [explicit-exit](explicit-exit-20260927.md) 最後一節。

- 2026-09-28：依使用者最新要求切換原生 Claude／Codex 權限、移除 K 額外 Sandboxie。實作、128 項回歸、原位置 ffmpeg 與部署狀態見 [native-core-permissions-20260928](native-core-permissions-20260928.md)。
- 2026-09-28 02:22 正式完成：K health=native；Codex 原生 workspaceWrite 實際呼叫原位置 ffmpeg 成功、Claude 既有登入 inspection 通過、128/128、正式正常退出與重啟通過。不再套 K Sandboxie；證據／還原與首次原生啟動等待限制見 [native-core-permissions-20260928](native-core-permissions-20260928.md)。
