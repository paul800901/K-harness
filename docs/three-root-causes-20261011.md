# 三項深層根因：分層查證與未解界線（2026-10-11）

## 總結與授權

本輪在本人確認 K 已關、要求「新版先裝，再查根因」後進行。附件可信投影及 remote compact 中文呈現已正式安裝：runtime `92a11c4337ed4a4c8d6c19b1ee77c5efd3f6ce25`，產品來源 `0b345a08a1032ee1f22cfccfc5143e2e8bb21465`；部署文件 commit `f0bfabae988b844bb7c386b1cb2310527c048148`。**以下完成的是因果收窄，不是把三個深因全修完。** 安裝界線與讀回見 [部署紀錄](trusted-attachments-deploy-20261011.md)，歷史十類狀態見 [逐項稽核](incident-repair-audit-20261011.md)。

Astra 判斷／獨立驗收，真正 GPT-6.1 Sol 執行 shutdown 假鏈並唯一整合文件，其餘兩份來源由各明確範圍的 Sol 唯讀查證。沒有改產品、再次部署、安裝套件、改帳號／設定、push／東區更新、讀小說正文檔、resume/start/stop 原房、重送原工作或恢復目標。日常 K 保持關閉。Evidence 根 `D:\K-harness\.runtime\three-root-causes-20261011`；完整報告分 `shutdown/report.md`、`memory/report.md`、`stream/report.md`，不把完整 audit／原始小說送複查。

|問題|已證實／足夠支持|仍未知／不能升級|
|---|---|---|
|正常關閉失敗|旧全量 child 查詢可使回覆丟失、30s request未完而15s owner RPC先回false；同假環境現行12 bounded green；現場兩次高度吻合|歷史各次一對一close correlation及binary父樹缺失，不能說唯一根因或所有關閉已修|
|長任務舊pause復活|後來continue仍保存，模型把歷史pause當最新，真正原生update_goal paused；不是UI假停|完整模型input／opaque compact不明，不能歸因壓縮唯一，也未治癒長任務偏移|
|原生服務串流失敗|native failed確實存在；固定官方161 error signature強支持上游error資訊，不是K畫錯completed|wire/error code／失敗request大小／歷史生命週期缺失；不能說全站、額度、長context或fanout唯一根因|

## 1. 關閉：現場強關聯＋可復現機制

### 現場

精確臺灣2026-10-10 14:20:30–14:24:35，只讀 K logs_2.sqlite 的 `pid:26368:667e6fb3-a36f-4733-88ba-bddc4513436a`：14:21:05恰80、14:24:06恰85次 `dropping overload response ... outbound queue is full`，全部同process transport layer；thread/read首request1166529。launcher14:21:20／14:24:21未確認關閉，各距burst15秒；14:21:35拒絕force、14:24:28本人確認結束owned supervisor PID28584。

processor384／outgoing448為精確26368；另一process29948是18／10，兩process總402／458。差異是scope，不是資料清除。主DB size/mtime前後不變。沒有保存close-command發送timestamp／causal request binding／錯誤cause；限定既有receipts未找出26368→28584歷史親子，未擴大掃描。

deployment-start.before.version登記事發前formal為1a45a734；取該固定來源作歷史對照，但無現場process→exe/build鏈，不寫事故一定執行此binary，也不拿事後433e7f當事故版本。

### 舊／新close鏈假host

`shutdown/fake-close-chain-v5.mjs` 用真desktop/controller/conversation/server、codex-host stdio30s request timer、Electron launcher15s RPC與protocol；**Codex child和Electron子程序／IPC是假，無真tray UI或完整原生關閉驗收**。461個completed fake children，合法inline turns，兼供paginated summary；注入容量128／延遲5ms，超額不回覆。128只是合成容量，非測得原生queue大小。

- 舊1a45 `Promise.all(ids)`：333 drop／333 unresolved，worker查詢鏈30015.7ms，launcher15016.1ms先回closed:false。
- 現行92a12 bounded：同時峰值12、0 drop，461全settled；worker1102.8ms、close1104.3ms confirmed:true。
- 0模型turn/start、steer、interrupt；fake transports與自有ephemeral server結束後正常關閉。計時workerQueryMs自首child request至app.close settled，含後續owner收尾，不是純函式CPU時間。
- v1/v2初始化錯誤、v3 hook缺漏與v4 inline不足全部保留；v5已補合法inline，作最後機制證據。不重跑未知副作用工作。

另外已保存18:58真原生只讀舊fanout30010ms／202 unresolved，18:59新版322ms／0 unresolved（460completed、1failed）；是不同時窗佐證，不是14:21現場同RPC回放，本輪不再打原生查詢。

**裁決：現行限流已处理被證明的機制，不新增retry、忽略未知children、改超時或新shutdown架構。** 仍有診斷缺口：resource cause／AggregateError先存在，Electron owner catch→ok:false→generic RPC failure→protocol closed:false逐層丟失；timeout、resource rejection、disconnect難分，C#自己的15s等待也可能競速。若下一段需可定位，最小方向是在既有訊息／log保留安全白名單stage／code／耗時／分類，不輸出任意錯誤全文或秘密、不新建服務。這只改善診斷，不補回歷史，也不修任意其他close故障；本輪未實作。

## 2. 記憶：真正誤停的近因，不等於壓縮因果

臺灣2026-10-09鐵血原thread：18:37:50本人暫停更新→18:51:12本人繼續→22:09:59compact45→22:10:14模型宣告暫停更新→22:10:16才讀舊交接/get_goal（active）→22:11:38模型原生 `tools.update_goal({status:'paused'})`／get_goal（paused）→22:26:25本人糾正→22:26:35原生goal_resume/readback active。繼續到糾正之間沒有新的非internal本人pause。

compact43–45每份29项：舊pause在index22、continue在index27都保留，encrypted compaction在index28不可解密。可反駁「compact把較新繼續從可見replacement刪光」，不能因此排除opaque／模型注意力或實際完整input作用。舊交接在第一個錯誤宣告後才讀，不可當初始起因。模型承認誤解歷史只作佐證。

補讀同一rollout行24371–25449的局部基準率：compact43後get_goal24377→24380讀回active，之後gemini_start／inspect completed並有完成→自動續行；compact44後24956→24959亦active、繼續派工完成及自動續行，兩窗均沒有觀察到同樣pause，compact45後才發生上述誤停。這只能說兩個局部窗口對照，不是全部75次或壓縮因果。純已有rollout唯讀、沒有host／模型回合，核心findings hash不變。baseline-readback.json SHA-256 `67230c25861f9909a0bf656a039146918bf0b3eb8dc2c537f176c055a7dcd87d`；追加後memory/report.md `dcd6e1ba4b4e41e914ff7b348882f7e9fc489ea1c2613c9f30b2ac01837a0dcb`。此補讀在唯一Opus複查之後，由Astra獨立讀回，不另開第二輪。
現行同步context hook沒有另一套記憶核心。真原生readonly items5×40＝200最近項，selected/rendered2 userMessage一致、partial=true，沒看到internal/worker冒充本人；此次未送goal/get、UNKNOWN，非整條hook實房驗收。固定源碼hash及native selection receipts已保留。有限snapshot／續讀guidance未硬攔原生goal tool，不能說上百次壓縮或偏移已治癒；沒有因未重現假說而新增分類器。

## 3. 串流：上游error資訊推論與無法追回的內因

兩次最後native turn均failed、final_agent_item_id=null，保存generic服務文案／request ID，並非completed被K畫成失敗：remote compaction v2 `569402d0-b02a-4bf3-865a-43e888429270` 2026-10-10 00:11:04UTC；sampling `57d7fe1e-2b9e-4615-ac5e-4191380cf5b8` 00:13:48UTC。同ID HTTP200，compact2/2、sampling5/5 retries後failed。

固定官方 `rust-v0.161.0` commit `979011409de0a60b52f179721948e65531d26144` 對照：SSE response.failed未知code可Retryable原樣error.message；純EOF／idle等有不同固定文案，已有parsed response error時EOF優先保留它。WS兩個特殊wrapped error也可Retryable，其他入口亦存在。多類底層error合流Stream，protocol `Other`粒度不足。完整服務文案+requestID強支持上游error資訊曾被解析，但無wire不能指定必然response.failed或exactcode。HTTP200不支持同request HTTP500／429，不排除200串流後failed。

兩目標metadata0.161.0不是歷史PID binary閉合鏈。現行logs覆蓋不到目標時間，既有receipt也沒有完整wire/context/transport/process_uuid。失敗request可能沿用舊成功usage，沒有actual input bytes；億級累積tokens不能當單次context。同窗13 completed／3 failed反駁全部必失敗，無matching context/並行分母或OSwindow mapping，不排除shared resource或K生命週期間接影響。下午app-server queue與早晨model stream不同層／時窗，不混為一因。

尚未執行的本機mock建議（固定binary＋合成HTTP200 response.failed vs EOF／idle）只會驗parser signature，不查出歷史服務內因。短A/B已成功，無理由再重播相同短測或無目的長壓測。可供本人考慮只帶requestID/UTC的官方查詢，未外送；若新故障自然出現只保必要白名單metadata，不能開全量TRACE抓小說payload。任何新真模型／測試／設定改動另裁決，本輪無產品修改。

## 4. 真正 Opus 5.5 小型只讀複查

新work ID、fresh session、不--resume。官方Claude Code2.1.294／claude.ai／firstParty／Pro、限定claude-opus-5-5，Read/Glob/Grep、plan/safe/restricted、空MCP、noChrome、無Shell。只三份精簡報告及必要close/worker/context片段，未送原小說、完整audit、憑證或原始工具結果。

已完成唯一一次，fresh session `c348e958-4ed1-472d-b0e7-b9240ed43009`，實際assistant模型皆 `claude-opus-5-5`，code0／result success；6次工具（1 Glob、5 Read）都只在小packet，無Shell／MCP。`opus-diagnostic-review/result.json`、`review.md`、`raw.jsonl` 保留原結果，不改寫審查歷史。

採納的主要判斷：shutdown是高度吻合且足以單獨造成的機制，但未證現場一對一／唯一根因；12bounded對該機制無需再修，額外保原因是可選診斷。模型原生誤pause近因已證，但壓縮只時間鄰近候選、hook未治癒。串流本機signature不足追回歷史服務內因，不用無目的重測。

**Sol讀回發現並不採納的兩句：**
- Opus稱「固定binary mock A/B已驗過」；packet及原stream報告明寫那是未執行的建議。本輪只做固定版本源碼對照，之前短A/B是真模型短假資料回合，不是mock failed/EOF binary mapping試驗。此句是模型讀錯，不能登記成已完成。
- Opus稱「pure EOF和idle已被排除」；僅能限定其純本地固定分支不會單獨生成所保存的完整服務文案/requestID。EOF仍可與先前已解析response error同時存在，其他transport／生命週期影響亦缺完整wire，不能全面排除。

Opus建議補看known code（context length／quota）分流及compact43/44基準率，是只讀建議而非已做或必要產品修補；Astra另獨立讀固定responses_error.rs:43–93，context_length_exceeded→ContextWindowExceeded、quota類→QuotaExceeded，unknown／missing code→Retryable；這只限定該parser路徑，現場exact code／wire未知。本輪不增加回合、壓測或再次審核，也不以retry次數強排服務內部長度／額度因素。code0只代表官方呼叫成功，結論依證據採否，不把模型意見當完成。

## 收尾狀態

本輪寫入仅新報告／共享索引與部署母數校準：**73個 main-session檔案 hash不變，正式UI列25房**。不是25個metadata檔案；修正文件不重跑部署。源碼11相關檔engineering／installed換行正規化全部相同，runtime仍92a，47831／5199查得0listener；不再次部署、不推送、不清除既有untracked。

仍未完成：歷史close唯一一對一因果、極長任務誤停深因／長期治癒、上游服務內部失敗條件；真tray新版本正常關閉端到端不以本次fake替代。新增安全shutdown診斷、完整hook／compact假資料對照、官方requestID外送或新串流binary mock都只是另需裁決的方向，沒有授權便不執行。
