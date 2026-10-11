# 原生子代理終態自主核實與必要調度候選（2026-10-11）

## 最新狀態

本輪新需求是「K自己調度接續」，不是只隱藏過期警告。前一UI-only候選1a4732e／文件2fb2c7c沒有這個完整調度效果；本候選以2fb2c7c為工程基底，僅controller＋既有native-wakeup test窄修。已通過相稱159/159與真正官方原生新假父子鏈（Sol低／Luna低、3個模型回合）；真正Opus5.5最後程式末審無blocking，Astra獨立驗收，產品碼固定不變。**候選未部署；正式其他房仍工作，沒有停止／重啟／resume原房。** 不改failed／paused／blocked父回合自動復活，不碰goal新接線。

## 確定缺口與兩層red

原controller在一次owned terminal event後、workers精確核實之前先delete nativeTerminals；paginated最後summary暫空或RPC暫失讀，之後即使同owner／child／turn／status已核實，只有UI resolved，K必要通知不再排隊。診斷red8項6pass／2fail。

第一部分保留pending後，手叫workers可核實（91/91），但正常UI不定時讀workers、core status event不保证另到。第二red只一次terminal，後續無event／無手动workers、原生已可讀，read count4→4／delivery0，證明仍漏自主調度。沒有拿manualread surrogate當完成。

## 最小完整實作

- 既有nativeTerminals只留本epoch已arm且實際觀察的未核實終態；exact核實成功且移到原flashQueue才消耗。UNKNOWN不冒稱completionPending／running，notice原引用／精準去重／raw保存沿前批。
- controller增加單timer／delay／running三個runtime scalar，串接非破壞核實；1→2→4→8→16→30秒，之後最多30秒間隔、無任意次數截止。沒有general scheduler、表、持久queue、新服務或人用設定。
- 每輪只checkNativeWorkers exact pending child IDs，不每輪扫數百歷史／Flash。探針同owner／turn／status確實settled後才一次正常workers，沿原latestread／呈現／queue／receipt／delivery。普通read搶先或entry已被取代時舊probe不能再派送；探針本身不重疊。
- 只收到可信live new turn/started才supersede舊pending。不同persisted turnId可能是較舊回合，不因此delete；保持UNKNOWN，稍後expectedturn穩定可自主恢復。
- pause／stop／換房／epoch／close清timer與pending；host.closed也清。失效中的read返回要核對host/main/view/epoch、entry物件身份；不能跨房送通知。
- 所有模型送出仍原一次機制：busy／turn／submission／goalPending不搶原生工作，status completed才交付；既有delivery-attempted receipt及transport unknown不重送；protocol明拒且nativegoal搶先才原有重排。0子重派、無原工作retry。

## 真正Opus設計討論

官方Claude2.1.294／Pro／claude.ai firstParty actual claude-opus-5-5，session a6c7d65e-897c-4098-8e66-c65fe895102c，1Glob＋3Read／無寫入。推薦pending-only單timer、只讀探針成功後走原workers與一次通知。Astra明確拒絕「latest不同ID就刪」的persist落後誤判，實作與測試依此修正，不照模型建議猜新回合。

此設計討論不是程式末審。core active wait由原生負責，K不重造wait；不能由K receipt推出core絕未先處理。core已自行驗收後又有K核對回合是既有通知同樣的未知邊界，不新增自由文字判決／ack框架、不宣稱core/K絕無雙驗收。退避30秒也不是服務仍UNKNOWN時能保證30秒恢復。

## 紅綠與相稱回歸

- 原8項6pass2fail／自主單event1項red；tracked25項22pass3fail，failure全保留。
- 原native-wakeup18項＋20新case，相稱7檔159/159、0skip／exit0；Astra另外獨立51/51及完整suite1240/1240（root-full-tests.log）。末審後再依Astra要求只加1項UNKNOWN→pause→resume，最終wakeup39/39；產品未再改，沒有宣稱追加後全套1241已重跑。
- 無後續event／manualworkers，missing／throw／older-turn→expectedturn精確後自主通知一次；1/2/4/8/16/30/30秒不限次數且UNKNOWN不稱running。
- pause/stop/newturn/reopen/close/hostloss取消；205歷史fixture只查pending；正常read搶先／inflightprobe不双通知；failedparent不送、attempted uncertain不重送。
- fixture曾因mockclock只flush microtask但實際metadata IO未完成過早assert，及uncertain直接close被既有guard拒絕；保留全部fail/TAP，按既有測試先stop自有fake才正常close，不改產品繞過。掛住的自有Node test父子PID核對後才清收；沒有正式／模型程序操作。

## 真正原生假鏈：不是只有synthetic IPC

使用既有官方Codex0.161.0／ChatGPT訂閱，新假workspace/controller；主gpt-6.1-sol low、唯一child gpt-6-luna low（模型／effort由exact child rollout turn_context再次核對）。母房`01a129d4-7d5e-70b1-88ec-26eea8d2816b`、子房`01a129d4-9d2f-7d61-b868-a41707fd4612`。

| 臺灣時間 | 實際事件 |
|---|---|
|15:19:25.314|第一parent回合completed，PARENT_IDLE|
|15:19:37.748|唯一child回合completed，晚12.434秒；只讀summary mask4.5秒開始|
|15:19:38.762／40.777|1秒／3秒自主探針，2輪×2RPC；summary仍UNKNOWN|
|15:19:44.792|7秒第三輪自主探針×2RPC，exact核實|
|15:19:44.795|正常workers再2RPC更新／排隊；不是每輪全量讀|
|15:19:44.832|單次k_native_subagent_terminal送parent，距terminal7.084秒|
|15:19:55.740前|第二parent回合completed，原生讀本次child final並精確回覆合成marker／任務未交付|
|15:19:57.712|await controller.close正常完成|

3輪探針合計6RPC，加成功後正常workers2RPC，共8個此調度階段自主只讀RPC。初始事件／完成後例行讀回另列於reads.jsonl；不混作探針輪數。controller對child turn/start為0，child只有1原生回合；父只有原始派工＋一次核對回合，0重派／原房操作。summary masking只改wrapper收到的read回傳，不改原生磁碟或工作。這是限定fault injection E2E，不等於現場必然曾空summary4.5秒，亦未操作原小說房。

證據根`D:\K-harness\.runtime\native-coordination-repair-20261011\terminal`：report.md、red/green logs、native-autonomous/{result,close,child-model-readback}.json與精簡event/read時間；沒有把gateway headers/developerInstructions/原小說或raw tool output送模型。

## 收尾界線

本批真正Opus最終source review／Astra驗收已完成，固定候選SHA與文件索引；不部署，讓出controller作者權後也不自行碰human goal接線。此次observable是真正自主核實及必要一次通知，不是忽略警告；仍不保證主模型內容判斷品質、upstream generic compact內因或failed主回合自主復活。

## 真正最後程式審查與限制核對

官方claude-opus-5-5／firstParty／Pro／Claude2.1.294，session `53e0bcb4-1a2a-4394-a63f-f86b78abb49a`，1Glob＋3Read、無寫入；末審明確「沒有blocking」，不是runner exit0代替。Astra獨立讀preflight/raw/result與source bytes一致。

Opus packet缺pause-handler片段，提出有條件提醒：實際controller299及636確實paused→clearNativeResults；close正常路徑亦經closeFlashGateway→closeFlashBridge→clearNativeResults，不是只靠epoch。物件身份核對在probe決定觸發workers之前，不在workers消耗處；更正模型簡稱，保留原review不改。Astra追加精確UNKNOWN→pause→resume→ready regression（timer及普通read皆0acceptance），39/39。此追加僅test在末審之後，`review-readback.json`明列末審test-prefix與最後test不同hash；產品SHA與送審版完全相同，不冒稱新test曾被Opus讀過。

其餘非blocking：新pending可能等已排的最多30秒timer；永久UNKNOWN保留每30秒只讀；既有receipt寫入前重複event窗口非本次新增，不擴一般框架。Opus是靜態審查，沒有親跑模型／測試。

## 使用者方向澄清與 Codex App 比較

2026-10-11 本人澄清：要求薄接殼，是避免 K 太厚而妨礙原生工作；不是因擔心重送製造問題，更不是要求 K 出錯後放著。本人以 Codex App 能正常處理同類長工作作為驗收基準。主代理先前把 10/9 原始要求「照原生的做什麼就做什麼」概括成「你指定原生最終失敗後不自動接續」，沒有交代原容量／Luna→Sol 取捨前因，已在聊天更正；不得拿這個摘要當作不修漏接或調度的理由。

本候選解決已觀察終態未被核實／交付的 K 缺口；原生回合已最終 failed 後另開核對／接續模型回合，不在此候選中，已另外向本人確認。未把本人提問當同意，也未恢復任何真實書房。新增的本人 goal 意圖記錄修正另見 [native-goal-provenance-20261011.md](native-goal-provenance-20261011.md)，不把兩者當成原生 compact 內因已修。

本機只讀比較：K core 0.161.0，Codex App active／bundled core 0.162.0-alpha.17.2。exact 官方 tags 限定比對發現 remote compact request/retry 函式逐字相同、cap 都為 2，goal runtime 只有返回型別 pattern 差異；新版壓縮後 context 組裝及條件式 incremental-tools prompt 有變更，與本次事故因果仍 UNKNOWN。`prefer_mxc` 已由官方 feature／config/backend callsite 證實是 Windows sandbox backend 偏好，不是記憶／壓縮傳輸開關，未照抄旗標或升級核心。

限定證據：`D:/K-harness/.runtime/native-coordination-repair-20261011/comparison/{report,prefer-mxc-note}.md` 及固定 tag source receipts。未讀 App 私人歷史／設定／登入；不把使用者的實測線索誇稱成 App 永不出錯，也不把 upstream generic error 當作 K 可以不處理協調的理由。

## 固定候選與作者交接

source commit `3b91482f45e23d7a1ceaa43eb0fdd41931e66348` 僅controller＋native-wakeup test；文件索引另docs-only commit。controller作者權已讓出給Astra下一段調度，不自行碰human goal origin。isolated-close-readback.json確認兩次Opus自有PID均已退出、自有evidence程序0；原生host正常close見native-autonomous/close.json，沒有停止或探查正式host。原兩untracked及新增他人goal-provenance.test.mjs未納本commit、不清理。

## 整合負載下的測試觀察校正（末審後，僅 test）

Astra 整合全套實跑 1251 項、1250 通過／1 失敗：第一個 idle native refusal/completed 測試只固定等 40ms，在平行負載下 receipt／通知尚未完成便觀察到 0。原始 `D:/K-harness/.runtime/native-coordination-repair-20261011/root-integrated-tests-green.log` 雖檔名含 green，實際是失敗紀錄，完整保留。只把該 case 第一次成功通知的等待改為既有 bounded observable `waitRecheck`；once、ID、模型／權限、禁止重派 assertions 全保留，未改產品或其他固定等待。追加發生在 Opus 末審之後，不宣稱已送審；單檔再跑 39/39、0 skip，證據 `terminal/full-load-observable-wait-green.log`。整合全套待 Astra 重驗，尚未 commit／部署。

## Astra 最後整合驗收與失敗保留

後續預設並行完整執行的 `root-integrated-final-tests.log` 為 **1251 項、1248 pass／3 fail**，不是完成證據，原檔保留：

1. `native-wakeup` missing terminal 案已讀回 settled，但通知需經 queueMicrotask、持久化 receipt、markSubmitted 才送出；固定 40ms 不是這條完成邊界。僅把 missing/throw loop 的首次成功通知改等既有 bounded delivery predicate，settled 斷言仍在等待之前，once／禁止重派不變。
2. `luna-bridge` quiet test 的 onChange 原本接任意 inspection，可能在 start 尚未完成時先收到舊 quiet；之後 commandExecution 新活動使它正常失效。精確控制 thread/start 等待首次 quiet 的複本成功 red→green：舊版本接 starting／null tool 而讀到 undefined；只把接收條件限定 commandExecution 且 inspection 與 activity 同時間，原後續 running／不重啟斷言通過。產品與 30ms 測試時鐘不改。
3. `input-queue` 的 2 秒 predicate 等待逾時。該檔未修改，獨立及固定 4 並行完整測試皆通過；歷史失敗是否僅 I/O 負載仍 UNKNOWN，不冒稱已找到或修掉唯一根因，也沒有任意放大期限。

三檔修改前、修改後均各 97/97；真正 quiet red／green 及完整原失敗見證據根下 `terminal/async-observation/`、`terminal/three-async-baseline.log`。該目錄另有 receipt 延遲診斷在 preload 因 ESM URL 失敗、未進入測試，保留但不採為產品重現證據。Astra 獨立讀 code diff、quiet red／green；末審後只改測試，沒有再次改動產品或宣稱 Opus 已審這些後加測試。

Astra 最後在固定資源並行下執行完整 suite：`node --test --test-concurrency=4 test/*.test.mjs`，**1251/1251、0 skipped、exit 0**，61.472 秒，證據 `root-integrated-bounded-tests.log`。UI build 同樣 exit 0；未更改 package 的預設 test 指令，不把此通過寫成預設高並行也已全部修復。

整合 source commit `e3f2ecd263b1dfd854ea10acdbb31a86b54ae713` 含本段 test-only 差異及獨立的原生 goal provenance 三處補接，見 [本人意圖記錄候選](native-goal-provenance-20261011.md)。正式 runtime 仍是 `e1712d117d3c7f2d4f1df7ffd0b2beb94ffa15e1`，K 程序仍開著；未部署、停止、恢復／重送原房或 push。failed-parent 新模型核對／接續決定仍待本人答覆，未把最新同意驗收標準擴成這項實作或正式操作。
