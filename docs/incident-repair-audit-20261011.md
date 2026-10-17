# 本串事故與修復驗收審計（2026-10-11）

## 範圍、結論與來源

本人要求把前面接連遇到的 BUG、更新及未修項全部核對，並整合「追查插話後最終回覆消失」「交接 K 模型容量錯誤」兩房成果。本文件只審本串十類事故，不擴成 K 全部歷史 backlog。Astra 判斷／獨立核對，真正 GPT-6.1 Sol 執行唯讀審計、此文件及第 2 項中文呈現最小補修；Sol 程式碼仍待真正 Opus 5.5 最後複查。

**不是全部修好。** 已知 K 呈現、切房鎖、歷史工人查詢、人用分支啟動／可見性，以及兩個 peer 成果已有正式部署證據；原生串流根因、原長任務正常關閉失敗、極長任務語意／品質偏移不能判為已解。分支附件完整鏈與這次 remote-compaction 中文提示補修仍是候選，不能以回歸總數替代正式驗收。

- 正確工程工作樹：`C:\Users\Paulus\.codex\worktrees\room-lock-fix-20261010\K-harness`，本批起點 `2b42d94af72a949bf12e36217178c6ec6395b57f`。`D:\K-harness` 根工作樹產品來源較舊，不作現行產品基線。
- 本次實讀 `D:\K-harness\.local\runtime.json`：正式版本仍 **`be1d976f2d70453fb033cd870dc283bd906a4c1b`**。
- 正式安裝根：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\trusted-runtime`。此名稱不表示現行仍走 Sandboxie；原生權限邊界按現行規則。
- 六個相關正式檔的實際 `git hash-object --no-filters` 均等於 be1d976 的 Git blob：`frontend/main.jsx`、`frontend/native-notices.mjs`、`src/native-workers.mjs`、`src/desktop-controller.mjs`、`src/compaction-hook.mjs`、`src/input-queue.mjs`。這證明下列已部署實作目前仍在安裝樹，不冒充本輪重新操作真小說的 live 驗收。
- Git ancestry 已核對：`9430c455`、`335c4fc`、整合 `5762d489`、`a29e834`、`433e7f2`、`a454a8b`、`1b3749e` 均包含於現行 be1d976。不是只拿舊文件或 README 宣稱已更新。
- 分支附件可信投影正在同工作樹收尾，尚未固定新程式 SHA／部署；其最新狀態見 `fork-attachment-trusted-projection-20261011.md`。本文件不替另一工單預報最終 Opus／Claude／正式結果。

## 十類逐項矩陣

「已正式部署且讀回」是既有正式 receipt 加本次安裝來源核對；「候選」是本地實作／限定驗證，不是正式成功。沒有恢復／重送原小說、開啟真模型回合、啟停正式服務、改帳號／權限／計費、push 或更新東區。

| 症狀 | 已知根因／未知 | 實作 commit／主要檔案 | 候選／原生／正式證據 | 現況 | 必須保留的未完成事項 |
|---|---|---|---|---|---|
| 1. 極長翻譯反覆壓縮後，舊暫停要求復活／記憶偏移 | 至少一次真 goal 被誤暫停；replacement history 仍含後來「繼續」。未證實壓縮刪除／重排指令，直接因果未知 | `a454a8b`：conversation-context、compaction-hook、codex-host、gateway、desktop-controller | 候選完整 controller 8 次 compact，另有 null／hook 信任補驗；正式安裝新假房 1 次 compact、兩個合成回合，舊暫停不復活與術語正確 | **Codex 輔助已正式部署且讀回；極長實務症狀未驗收治癒** | 自然長負載、反覆工具／工人及上百次壓縮未驗；無誤停／品質改善率。Claude／Gemini 沒有同等接入；有限原文回讀仍可能 partial／UNKNOWN |
| 2. 三房 stream disconnected before completion／工作失敗 | 精確 request 對應原生 failed，包含 remote compact；HTTP 200 不等於串流完整。內部服務／傳輸／特定長脈絡原因 **UNKNOWN** | `ada77b4` 只修一般中文呈現，隨 `433e7f2` 部署；本輪 `frontend/native-notices.mjs` 補精確 remote compact wrapper，未固定新 SHA | 原生 JSONL／SQLite 5 筆精確匹配；直接原生與正式 K 基本假資料各回覆→compact→接續成功，未重現長任務故障；本輪 exact wrapper red→green、桌面／手機 built UI | **一般呈現已正式部署；remote compact 中文補修僅候選；底層故障未解** | 真正 Opus 最後複查、整合固定／正式讀回仍待。若追內部原因須供應商 request ID 資料，不能增加 K 自動重送／換模或把短測當根因修復 |
| 3. Pick Me Up「此聊天室正在更新」後回跳 | idle probe 先鎖房才等必要讀取；晚到讀取／非導航操作競態；明確 reopen 後 queue.closed 未清是同批回歸 | `a29e834`：conversation-controller、input-queue；隨 `433e7f2` 整合 | 舊版精確 red，actual adapters＋fake host 不離線送出／不重播；真 K controller＋假 provider 雙尺寸 UI；reopen 後兩個新明確 input 各送一次 | **已正式部署且讀回，現行來源包含** | 截圖當時精確持鎖者未有 trace；可重現候選路徑不是唯一歷史根因。原小說長負載未重跑 |
| 4. 正常「離開並停止 K」失敗／殘留背景 | 兩次 normal close confirmed:false；當時哪一個資源 close 失敗未知。已確認 launcher 鏈丟掉詳細錯誤，但不是歷史失敗資源定位 | **未有原故障根因修正 commit**；診斷缺口見下節，這次不改 launcher | 本人確認「是」後，既有 force 結束自有 supervisor PID28584 程序樹，47831 無監聽後才更新。測試 owner 或後來本人正常關閉成功不能代替原故障修復 | **原卡住已解除；根因未解／診斷尚不足** | 後續最小調查沿既有關閉通道保留可安全讀出的失敗階段／錯誤，不造監測服務、不預設 force；不能等待再發卻仍只保存 false |
| 5. 原生本機檔案 Markdown 連結被吞 | K URL filter／SafeLink 成果限定；圖片元件與 CSP 另擋圖片，不是原生沒保存檔案 | `1b3749e`：native-content、native-message-file、frontend、message-file API 等 | 六組 provider 投影 built UI、九種連結預覽／下載 bytes 相同；正式安装重跑相同六組；正式 owner 雙尺寸／assets 讀回 | **已正式部署且讀回，現行來源包含** | 不是三家真模型全部能力等價；大檔仍整檔讀入記憶體。HTML／危險 OS 協定不任意執行；原網址圖片會發出對外請求 |
| 6. 歷史子代理均結束，卻累積 218／234 待確認／模型待確認 | 全量 fanout 使原生 request queue 過載／逾時，查不到即 unresolved；前批 latest summary 單修不足 | `8400e99` 後由 `1b3749e` 補最多 12 並行；native-workers、frontend | 同 Pick 父房 461：舊 fanout 202 unresolved／error；修後及正式來源只讀均 460 completed、1 failed、0 unsettled／error | **已正式部署且原生真狀態讀回，現行來源包含** | 當時 218／234 逐列 snapshot 未保存，不能冒稱一一對應；保留唯一 failed／真正未知，不重派或把未知當完成 |
| 7. 人用分支 startup timed out，切房後側欄消失 | 缺正常 MCP 的來源 host 先 fork，再 same-host resume 無法重新起 MCP；user 分支標記太晚保存，失败後被主房可見性規則隱藏，不是刪除 | `be1d976`：desktop-controller、main-sessions、unified-controller | 真新假房 fork→ready→一次接續→close→同 ID reopen；真失敗分支 metadata／繼承邊界只讀；正式雙尺寸側欄可見同 ID | **限定啟動／可見性已正式部署且讀回** | 沒重送真小說；假房 goal=null，不冒稱 goal／budget 全繼承。當時附件完整鏈已知缺口留待後續，因此整個分支功能未完整驗收 |
| 8. 分支「部分附件無法重新載入」 | 本房嚴格歸屬不承認合法繼承；初候選又把界線內自由文字 marker、磁碟 owner 自我驗證當來源證據，父拒絕／子接受 | `83051b4` 初候選；`2b42d94` 存檔回歸；新 trusted projection 尚未 commit：desktop-controller、main-sessions、session-workspace | 正式舊來源 10 項 red；新兩反例 red→green、17 附件回歸；真 Codex 五階段 HTTP 鏈；legacy 舊假房、真 Pick 新投影只讀 passed，原 bytes／records／metadata 不變 | **候選已實作／部分真原生驗證；未正式完成** | 新 Claude close-drained 完整不變性鏈、真 Opus 最後完整差異／證據複查、Astra驗收、固定 SHA、確認停止／部署／正式讀回及本人實房確認 |
| 9. peer：插話後較早最終回覆消失 | Claude projection＋原生 JSONL 有原文／completedAt；UI 每組只挑最後 conclusion，前則被 return null，不是收訊或寫檔遺失 | `9430c455`：frontend/main.jsx；隨 `5762d489` 正式整合 | 真既有 group 只讀顯示、controller 保存重開／雙 result、六種 UI；真 Claude sentinel 只取得單 result，不假稱重新原生重現雙 result；正式 projection hash 不變 | **已正式部署且讀回，現行 ancestry／來源包含；不是只留文件** | GPT／Gemini 真插話原生未另驗；legacy 沒完成時間不冒稱完成。pinned-header舊 probe baseline 失敗未修，未擴成本項 |
| 10. peer：模型容量錯誤／Gemini 額度解析 | 原生 serverOverloaded 與 quota 不同；K 容量自動接續被本人撤銷；ack可能覆寫已失敗狀態。reset無效曾丟合法百分比 | `335c4fc`、peer固定 `4825d0c`，正式整合 `5762d489`：controller、quota parsing、notices | 真 failed 與 completed command 只讀；窄回歸／built UI、真正 Opus 整合及補看；正式 owner／assets receipt；現行 ancestry／controller符合 | **K 撤 fallback、忠實呈現／百分比解耦已正式部署且讀回** | 不代表 OpenAI 容量已修；native blocked→後來paused精確 transition未取得；當時Gemini缺欄raw未保存，源頭原因未知 |

## 已知的範圍與端到端驗收漏項

1. AI 換房候選時已測出既有人用分支 MCP 就緒失敗，卻只修 AI 工具入口。`chat-ai-continuation-20261010.md:23–24,36` 保留失敗；`manual-fork-startup-visibility-20261010.md:8` 明確說前批不能稱「全部修好」。人用缺口後來才隨 be1d976 正式修復。
2. 人用分支修復時，附件重開識別被列作非阻擋。`manual-fork-startup-visibility-20261010.md:38`；`fork-inherited-attachments-20261010.md:13–15` 承認沒有把歷史卡片→預覽→下載→重開→孫分支→搬工作區→討論上下文作完整使用鏈。**文件留下延後事項，不等於本人已同意把原分支需求拆掉；不能用局部啟動成功推論整個分支完成。**
3. 附件候選先有 1174 全過，獨立反例仍能把父房拒絕的 marker 升格子房合法卡片；又發現合法祖先 owner marker也不能單靠 ancestor allowlist。兩種正式 red及可信投影補修才是相關證據，總測試數不能抵銷反例。
4. 一般串流中文提示部署後，`codex-stream-error-20261010.md:65` 明列 remote compact前綴尚未補。現行正式 `frontend/native-notices.mjs:27` 確實仍只匹配開頭 `stream disconnected before completion:`。這次補的是已觀察文案形狀，不是服務故障修復。
5. 本次沒有讀完整原聊天室逐字回覆，不能替未讀到的「完整修好」原句作逐字判定；上面兩次已知直接缺口漏驗、候選仍有反例及上游未知的界線有正式文件／實作／後續故障證據。狀態回報應以本矩陣窄範圍取代泛稱「全部修復」。

## 正常關閉診斷缺口：已知與未知分開

Astra提出後，Sol本次也直接讀回 source：

- `src/isolated-launcher.mjs:93–94` 的兩個 catch 只 emit `confirmed:false`，沒有保存捕捉到的 error。
- `src/electron-isolated-main.cjs:72` 的 close catch 只 `reply(id,false)`。
- `src/desktop-server.mjs` 既有 `closeResources` 原本提供失敗原因，關閉 API 可回 503；`src/conversation-controller.mjs:388` 會以 `AggregateError` 保留各房 close 失败。

所以已有下層失敗資料可在 launcher鏈遺失，足以解釋為何當時只留下 false而不能定位；**不是已證明那次哪個房間／bridge／terminal close 壞掉，也不是 shutdown已修復。** 這輪不改 launcher，不把附件／文案候選擴成關閉重構。後續最小工作是沿既有鏈保留安全可讀的錯誤與階段，再核對真正停止；不增常駐監測、固定重試、無条件 force或工作重送。

## 本輪 remote compact 中文補修與驗證

限定產品兩行：既有 stream 的字面辨識接受精確 `Error running remote compact task: stream disconnected before completion:` wrapper；stream呈現依此已知形狀顯示「Codex 原生壓縮在完成前中斷；本輪未完成。接續前先核對已保存成果，K 不會自動重送。」保留結构化 capacity／quota優先、其他具体錯誤碼不被generic文字覆蓋、provider分界、原始 error／request ID、willRetry與既有去重。沒有改controller／goal／原生重試／權限／網路。

- `test/native-notices.test.mjs` 加一項，含 generic／缺code／結構化stream、capacity／quota優先、其他specific碼、其他provider、未知wrapper形狀、不相等displayedError、raw不變及willRetry仍顯原生重試。
- red先跑工程未修來源：11項10 pass／1 fail，`null !== 'stream'`。第一baseline說明誤稱checkout與正式位元組相同，實際只有CRLF差異；原紀錄保留後，用**精確正式原碼複本**＋同新測試重跑，仍10 pass／1 fail。複本與正式blob均為 `0d9580baa8e9e81f8cfbcf5fb213cbbaf9a6dd55`，不拿換行差異當產品故障。
- green聚焦 native-notices＋capacity回歸 **30/30**，UI build code0；既有large bundle警告保留、不順手重構。
- 既有 `test/stream-error-ui-probe.mjs` 追加remote compact樣本，保留一般stream：兩樣本×桌面1440／手機393，共 **4/4**。單一中文提示、部分進度保留、展開JSON精確等於turnError含fake request ID、willRetry改回原生重試、手機已連線、零水平overflow／pageerror／POST。全是假snapshot／headless獨立UI；沒有正式服務或模型工作。Sol已視查remote compact手機摘要與桌面原始詳情截圖。
- 全部合併候選完整回歸與真正Opus末審由附件工單統一收尾；本文件不把先前1184項當包含本新增測試的最終結果。尚未固定SHA／部署／push。

本輪證據：`C:\Users\Paulus\.codex\worktrees\room-lock-fix-20261010\K-harness\.runtime\remote-compaction-notice-20261011` 的 red-source-baseline、初始metadata、red／formal-red／focused-green／build-ui／built-ui／diff-check logs；UI JSON／截圖在同工作樹 `.runtime\stream-error-ui-probe`。

## 具名歷史正式及候選 receipt

- `D:\K-harness\.runtime\k-integrated-update-20261010\formal-readback.json`、`restart-readback.json`：433e7f2、22房、雙尺寸、零POST，未開真小說。`integrated-update-20261010.md:29–49` 明列 force解除卡住與正常close／stream未知。
- `D:\K-harness\.runtime\compaction-assist-deploy-20261010\native-v2-result.json`：正式a454a8b、新假房、compact=1、原房未操作。
- `D:\K-harness\.runtime\native-presentation-deploy-20261010\native-worker-formal.json`：本次重算461列、460completed／1failed／0unsettled／0errors；其scope明示無resume／start／interrupt。
- `D:\K-harness\.runtime\manual-fork-deploy-20261010\activation.json`、`installed-source.json`、`formal-readback.json`：be1d976、660來源零差異、25房、零POST、未開小說。
- `D:\K-harness\.runtime\sidebar-capacity-build-20261009\deployment-activation.json`、`formal-readback.json`：5762d489、20房、incidentProjectionUnchanged=true。這是兩peer已正式整合而非只文件結论的證據。
- `D:\K-harness\.runtime\fork-complete-fix-20261010\sol-native-codex\result.json`：passed、5新turn／2fork、parentTurns／附件bytes與records不變。
- 同根 `sol-native-legacy-readonly-fixed\result.json`：passed、modelTurns=0、productionTouched=false；`sol-real-branch-readonly\result.json`：passed、原父子metadata／兩附件不變、nativeResumeOrTurn=false、originalWorkReplayed=false。只恢復原生歷史真正引用的一張，不擅補另一張。

## 完成判準與停止邊界

1. 附件：合法來源、孫分支、重開、搬工作區／alias／父K紀錄缺席、取消歸屬、preview／完整下載／討論context通過；父房拒絕的自由文字不能在子房升格；暫時UNKNOWN可在下次明確open按需確認。新Claude完整不變性、真正Opus最後審查、Astra獨立驗收不可省。
2. 中文補修：現已取得精確正式red與聚焦green／雙尺寸UI，尚須進合併packet、完整回歸、真正Opus末審；修提示不意味着原生服務根因已解。
3. 正式更新：依本人當輪授權核對工作完全停止、固定新SHA／來源及相同依赖、保留程式／啟動器可退版本，部署後做安裝來源／owner assets／實際使用鏈讀回；程式退版不是對話資料快照，不恢復／重播原工作。實房確認由本人操作，不偷渡native resume作只讀驗收。
4. 長任務偏移／stream／正常關閉另保留UNKNOWN。只有相稱實務行為與根因證據才能升級，不能由後來一次正常關閉、基本假資料成功或測試總數推論治癒。
5. 本輪僅完成本文件與remote compact呈現候選，不改development-log（由唯一收尾者加索引），不部署／push／更新東區，不擴加新framework／gate／設定。

## 合併候選收尾補記（01:00 後）

以上矩陣與當時 pending 保留；本節僅更新兩個候選窄修進度。附件全新真正 Claude `claude-opus-5-5` close-drained 鏈已通過3新回合／2fork／5個HTTP階段，父projection與全部新假附件bytes／records不變、原房未操作。合併 remote compact 提示後，package既有明列範圍的完整serial回歸 **1185/1185** 通過；證據在附件工單 `sol-ownership-red/combined-full-tests-explicit-green.log`。正式仍be1d976，沒有部署／push／服務操作；真正Opus整合末審、固定SHA及Astra最後验收仍待完成。首次全測入口誤掃非test fixtures及自有程序停止證據另完整保留於附件紀錄，不當產品測試結論。

本節不升級長任務偏移、上游串流服務或正常關閉根因的 UNKNOWN；提示中文化也不表示上游故障已修。

## 最終候選補記（保留上述歷史狀態）

真正Opus首審抓到跨供應商新Codex房只有parent沒有native fork boundary卻把own附件當UNKNOWN，未把code0當審查通過；兩新正式red後窄修helper，只在可定位native界線時認inherited，own strict與外房拒絕／原文保留維持。最終附件／main31/31、完整explicit serial **1187/1187**。新工作ID `sol-opus-final-followup/review.md` 真正官方 `claude-opus-5-5` 明確首審blocking已修、两窄修無剩餘blocking；首審證據完整保留。Astra獨立檢查補修及實跑31/31。

兩窄修程式／測試固定 SHA **`0b345a08a1032ee1f22cfccfc5143e2e8bb21465`**，文件另commit。附件／remote compact提示達候選驗證完成，不是正式完成：仍未部署／啟停／push／操作小說；正式仍be1d976，須Astra最終驗收及後續正式授權／實際讀回。本矩陣第8項的新Claude／Opus／固定SHA pending由本尾節更新；部署及本人實房確認仍pending。Claude1px圖片遭原生移除，只證K卡片／預覽下載／歸屬／projection不變，不聲稱模型看到圖片。長任務、原生stream與正常close的UNKNOWN不變。

Astra 末段已直接核對兩輪review／result、1187log及9檔hash，獨立驗收兩窄修候選通過。這項更新只解除本批候選審查pending，不解除部署／本人實房確認及三項UNKNOWN。
