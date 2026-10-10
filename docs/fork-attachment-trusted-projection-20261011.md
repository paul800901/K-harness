# 分支附件可信投影修正候選（2026-10-11）

## 授權、來源與目前狀態

本人本輪指定 Astra 找問題及判斷修法、真正 GPT-6.1 Sol 執行工程；Sol 程式碼仍須真正官方 Opus 5.5 最後複查。這份紀錄取代前份第二意見文件「歸屬缺口尚未實作」的當時狀態，但不是正式部署完成。

本批只修分支附件繼承與同根因的呈現／歸屬；不宣稱長任務記憶偏移或全部歷史 BUG／更新／未修項已解決。本人後續要求的歷史逐項稽核由主代理另行處理，不併入本批工程或擴張操作。

工作樹：`C:\Users\Paulus\.codex\worktrees\room-lock-fix-20261010\K-harness`，起點 `2b42d94af72a949bf12e36217178c6ec6395b57f`。本批兩窄修固定程式／測試 SHA **`0b345a08a1032ee1f22cfccfc5143e2e8bb21465`**；正式仍 `be1d976f2d70453fb033cd870dc283bd906a4c1b`。未修改 `D:\K-harness` 的產品來源、未部署／正式停止／重啟／push／更新東區，未恢復或重播小說及舊模型工作；既有 untracked `node_modules-root-link` 保留。

證據根目錄：`D:\K-harness\.runtime\fork-complete-fix-20261010`。

## 根因與最小修法裁決

Astra 確認 copied-turn 只是分支界線，不表示自由文字 `K_ATTACHMENT_CONTEXT` 曾合法呈現為 K 附件。除了無關房 owner，child 新 turn 手寫合法祖父附件標記也會在再分支時被錯誤接受，故只做祖先 owner allowlist 仍不完整。

- `src/desktop-controller.mjs`：先依**來源房語意**投影使用者訊息，來源自己的新訊息仍嚴格查自身 owner；繼承訊息只接 K 已驗證的引用。投影後才依選定 native turn 截斷並交給新 fork／AI continuation，不把被拒絕的 marker 升格。
- `src/main-sessions.mjs`：沿既有 K metadata 增 `inheritedAttachments`，以 native user item ID 錨定附件 ID、原 owner、workspace、path。`null` 欄位是舊版尚未建立；已驗證 `{}`／空 array 不回退文字授權；逐項 `null` 表示來源未知。普通 metadata 保存保留引用，不新增服務、資料庫、簽章或通用 mapping framework。
- 舊分支按需以保存的 K parent／fork boundary 與原生 `forkedFromId` 核對來源，K local ID 與 native ID 按父紀錄 `codexSession.nativeThreadId` 對照；從来源房正確投影取 native user item ID 交集。新房 snapshot 不依賴父 K 紀錄继续存在；舊 alias 證據消失只標該筆未知，不猜 owner，自己的合法附件仍可用。未知項在下一次 open 可按需再確認，避免一次 source read 失敗永久鎖死；不自動重試原生工作，也不重查已知 snapshot。
- `src/session-workspace.mjs`：`inheritedAttachment` 只讀可信 reference 的既定 owner／workspace／path，再查磁碟 record／原檔，不再從 user marker 路徑讀 owner 自我驗證。預覽／下載／討論繼續共用合法卡片；send／steer 的自身歸屬限制不變。
- 被拒絕／無法驗證／無法讀取的 marker 保留原生原文與原檔引用，不再以格式正確為由裁掉。合法已讀附件仍顯示原有簡潔文字和卡片；未知只提示，不阻擋整房開啟。Claude 已有結構化 cards，沒有套 Codex 文字 marker 或新增 flush API。

## 真正 Gemini 方案查核及取捨

第一個官方 Flash High 查核 `gemini-flash-trusted-projection` 反覆猜不存在的 packet 檔名，最後原生 code 0 但沒有有效 final；Astra 指示停止本人查核程序時，PID 已先自然結束，沒有發 stop 或碰正式程序。保留 raw、result 與 `ended.json`，不當已完成審查。

Astra 另裁定新 work ID 改為短 prompt、純文字方案批評，不重播前次工具工作。`gemini-flash-projection-text` 官方 init 真 `gemini-3.8-flash-high`、code 0／completed、工具0；本次 preflight 官方訂閱、model／usage 成功，不換帳號、API 或環境。Flash 認為能堵反例且無架構膨脹，但三項建議分別會放寬祖父附件 send／新增 UI、要求刪父 stub 而忽略 child snapshot、限制目前 workspace 而破壞原引用，均未採納。這是限定第二意見，不代替 Opus 最後程式複查。

## 已完成驗證

- 兩個正式反例：修正前 **10 項中8 pass／2 fail**，均在 fork 後錯誤多出 card。`sol-ownership-red/both-counterexamples-red-fixed-test.log`。原文保留、首次及 fresh controller 卡片／預覽／下載拒絕均已納回歸，不以隱藏文字過測試。
- `test/fork-attachments.test.mjs` 現 **17/17**：新增 K/native alias 舊投影重建／孫房、已驗證空 snapshot／刪父後再 fork、unknown source／錯 native lineage／own card仍可用、AI continuation、未讀原文保留與來源恢復；祖父及 child 附件、跨工作區、onHistory connecting 預覽、取消恢復、send/steer 拒絕均保留。
- Astra 首輪發現 temporary UNKNOWN 鎖死；單獨隔離副本只撤回 null-entry 再確認條件後，新測試確定 red，第二次 open 仍不能載入；現來源暫時失敗一次、下次恢復、第三次 known snapshot 不再讀 source，green。`sol-transient-unknown-red/red.log`、`sol-ownership-red/unknown-reopen-green.log`。
- `test/main-sessions.test.mjs` 增 legacy absence／verified empty／逐筆 unknown 普通 metadata 保存讀回；`test/desktop.test.mjs` 依本人最新原文保留要求，修改舊「缺附件仍裁掉 marker」斷言，不改無關產品碼。
- 首輪 default-concurrency 全套1181項有4 fail：一個上述舊契約，另 browser-native-profiles 一項及 native-wakeup 兩項短時序在全套負載下失敗。完整原log保留；browser 独立3/3、wakeup独立18/18。未改這些無關產品碼；避免負載互擾，以 `--test-concurrency=1` 跑全部最新測試，**1184/1184 零失敗**。`sol-ownership-red/full-tests-green-initial.log`、`browser-profiles-isolated.log`、`wakeup-isolated.log`、`full-tests-green-serial.log`。
- UI build 成功、`git diff --check` 通過。既有大bundle警告保留，不順手重構。
- 新真正 Codex 假資料鏈 `sol-native-codex/result.json`：官方 GPT-6.1 Sol／medium／read-only，5新回合、2 native forks，child 初建／新附件／重開、grandchild 初建／重開共5個HTTP階段，文字及PNG預覽下載200／hash一致，分支點後及外房ID拒絕；父 native turns、假檔、全部附件檔案／metadata不變。沒有原房重播。
- 原前次已完成3假房的真正 native read-only legacy 投影 `sol-native-legacy-readonly-fixed/result.json`：只複製 K 工程fixture，舊child／grandchild各恢復3附件，error null、預覽下载hash相同、原fake records／檔案不變；0模型回合，沒有resume/start/interrupt。首版 guard漏 `hooks/list` 在讀歷史前失敗，修正新fixture後通過；`sol-native-legacy-readonly/error.json` 保留，不當產品根因。
- Astra 要求追加真正 Pick Me Up · 分支 post-fix 只讀讀回；`sol-real-branch-readonly/result.json` 通過。只複製明列 parent `01a11caf-223c-7963-87fe-4628b6553927`／child `01a125b1-b38d-7ea3-b90f-8936cc3cdc1a` 的 K metadata 至工程fixture，native exact兩房 thread/read、onHistory 截止；新版按parent metadata重建，error null，只恢復native歷史實際引用的第一張 `a099...`，未引用第二張 `d75b...` 拒絕。parent／child metadata、兩附件原bytes與record hash前後不變，0模型回合，不保存小說原文、不resume/start/stop。

## 尚未完成

截至本節記錄時臺灣00:43，官方 Opus 前次限額明示01:00恢復，因此沒有提前重試。

1. 全新 fake workspace／ID 的真正 Claude完整原生不變性鏈，沿已準備 `native-claude-drained-ready/run.mjs`：result後以既有close排乾，實存parent-before，再做新分支與檔案／metadata hash。舊3已完成回合不重播。
2. 真正官方 Claude.ai／firstParty／`claude-opus-5-5` 最後完整來源差異及實測證據複查。Gemini不替代此門檻。
3. Astra 獨立 diff／測試／证據驗收後固定程式SHA。本子任務仍不部署／push／正式 stop/restart；正式上線依主代理現行授權另行處理。

## 01:00 後候選收尾補記

前節保留當時 pending，不抹除歷史。官方限額恢復後，全新 `native-claude-drained-ready/result.json` 已 passed：真正 `claude-opus-5-5`，3個新 completed 回合、2個原生分支、5個 HTTP 預覽／下載階段。既有 close 排乾後保存父 projection；父 projection、全部新假附件原 bytes 與 records 前後不變，未操作原房。新 parent／child／grandchild ID 全記於 result，舊回合未重播。

Astra 另授權另一真正 Sol 補精確 remote compact 英文前綴提示，產品僅 `frontend/native-notices.mjs` 兩行；此修與本附件修正合併一次候選／Opus末審，仍是兩個窄範圍。審計與未解狀態見 `incident-repair-audit-20261011.md`。合併後沿 package 既有範圍 `node --test --test-concurrency=1 test/*.test.mjs`，**1185/1185 零失敗**；`sol-ownership-red/combined-full-tests-explicit-green.log`。

首次合併測試入口誤漏 `test/*.test.mjs`，Node 自動掃入非test fixture：Electron fixture無app、launcher-reject假supervisor常駐。核對本人 test root PID46248及完整命令／4程序自有子樹後停止，讀回全部已結束；當時排序只到 fixtures，未跑後面的 native probe。錯誤log `combined-full-tests-green-serial.log`、`wrong-test-inventory-stop.json` 保留；殘留 `test/fixtures/descendant.pid` 保留且不提交。這不是產品失敗，不碰正式K／原模型程序、不以錯誤入口結果取代完整1185證據。

真正官方 Opus 5.5 對兩個窄差異及全部相關證據最後複查仍待執行；新程式SHA、Astra最終驗收與部署未完成。長任務偏移、上游stream及正常close根因沒有因此解決。

## 真正 Opus 首輪阻擋及補修

`sol-opus-final` 官方 preflight Claude.ai／firstParty／pro，CLI2.1.294；原生實際 assistant model `claude-opus-5-5`，code0／success、12個唯讀Read／Grep等呼叫。**呼叫成功不等於審查通過**：`review.md` 首輪有一個 blocking。跨供應商的新Codex房只有 parentThreadId、沒有native forkThroughTurnId，本批legacy重建曾把全房own訊息誤當copied UNKNOWN，自己的合法附件重開失效。

Astra同意窄修：只有存在且能在native歷史定位的forkThrough界線才使用inherited snapshot／補查；刪index<0全房fallback，無boundary自己的訊息維持strict owner，外房marker及原文呈現契約不變。不新增branchType、mapping或解除原有worker交接界線失讀拒open。兩個新增測試按真cross-provider建立次序（先新房，再補parent metadata），以及曾保存unknown／foreign snapshot但無native boundary：修前 **19項17pass／2fail，own card undefined**，修後附件19＋main12共 **31/31**；own預覽下載／重開／再native fork全可用，foreign仍拒絕。首版test錯序／不符合既有worker gate也保留，不冒稱有效red；以 `opus-cross-provider-red-corrected.log` 與 `opus-cross-provider-green.log` 為準。

Opus非blocking提出刪own path比對／省無附件item keys；Astra裁定本輪不做無實證精簡，未採納。remote compact兩行呈現不阻擋。

Claude新假鏈的1×1 PNG被原生assistant synthetic訊息標明無法處理並移除；因此此鏈只證明 **K的Claude卡片、預覽、下載、歸屬與projection不變性**，不證明Claude模型收到或理解圖片。原始synthetic及真model事件均保留，不把HTTP成功誤報模型看圖。

补修後仍須最終全套及真正Opus增量無blocking；第一審不作放行、原假鏈未重播、正式K未變。

## 最終候選驗證完成（不等於正式部署）

补修後最終明列serial全回歸 **1187/1187**，`sol-ownership-red/final-full-tests-explicit-green.log`；Astra亦獨立讀4行補修及兩新測試、親跑附件／main31/31。新工作ID `sol-opus-final-followup` 官方 Claude.ai／firstParty／pro，實際 `claude-opus-5-5`、code0／success、8次限定唯讀，`review.md` 明確判定**首審blocking已修好，兩窄修沒有剩餘blocking**。保留首審、兩輪raw／result／read scope與完整來源快照；最終9個程式／測試檔hash和末審packet相同，`reviewed-source-readback.json`。

固定 `0b345a08a1032ee1f22cfccfc5143e2e8bb21465` 只包含3個附件src檔、native-notices及5個對應test／UI probe，共9檔；其後文件收尾另commit，不混入兩個untracked項。新doc／索引共4檔。本子任務完成到**候選實作、合成／原生／唯讀驗證、真正Opus無blocking與固定程式SHA**，交Astra最終驗收；正式部署、啟停、push、原小說續行／本人實房操作均未執行。長任務偏移、上游stream與正常close根因仍UNKNOWN，歷史稽核不以本次候選結果全部升級。

Astra 最後直接讀兩輪review／result及1187 log，逐檔重核9個末審packet檔與當前hash相同，確認正式runtime仍be1d976；加上獨立focused31／notices30，已裁定**兩窄修候選獨立驗收通過、未部署**。不再擴測或補非blocking建議。
