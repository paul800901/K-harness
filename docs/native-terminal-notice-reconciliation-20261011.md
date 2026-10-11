# 原生子代理警告 stale／重複候選與學院再次失敗查證（2026-10-11）

## 最新狀態／不能混稱正式完成

正式版本仍 `e1712d117d3c7f2d4f1df7ffd0b2beb94ffa15e1`，工程基底 `764edc62a87e3d4fc9a149aba7db93033cdd987b`。**本輪正式其他房正在工作，不部署／停止／重啟，未操作原房。** 子代理 notice 的窄候選已實作並通過零模型 fake 回歸與實際 builtUI 雙尺寸；真正 Opus5.5 新鮮限定末審已完成、無blocking，Astra亦獨立验收候選；正式未部署。原房 live 事件是否逐條就是此bug，與本候選 fake 呈現驗證分開。

階段分開：最初診斷是0模型／未改產品；Astra批准後才有2產品＋2既有test候選；Opus複查是一次真正模型審查，不是原小說／fixture模型工作。不能把前段「未實作」當目前狀態，也不能把候選當正式已修。

## 一、確定的 K notice 缺口與最小候選

同owner/child/turn/status終態事件先到、最後回合短暫空summary或RPC失敗，controller先消耗nativeTerminals、發無worker引用notice。稍後workers已精確settled、header正確顯示0未結束，歷史notice不resolve。同一terminal重複event又生新的random notice ID，疊同文。不同worker真正未確認不應全局去重，其他turn已結束不等於原terminal已核實。

只改 `src/desktop-controller.mjs`、`frontend/native-notices.mjs`：fallback既有notice加 `nativeTerminal:{threadId,turnId,status}`，既有notices exact triple去重；最新owned read已通過host/thread/viewEpoch、read generation且requestEpoch一致，同turn/status確實settled才resolved。UI只hide這種已resolved native-terminal worker-attention，raw保留。無引用舊notice不可猜，仍UNKNOWN。

Astra另指出初次resolve放在可送模型guard內，paused／stopRequested仍會留下stale。正式red兩case先失敗，再移到state.workers純呈現更新區；**模型delivery原guard、nativeTerminals消耗、flashQueue／flashNotifications不改**。這不是pause解除、接續／補送模型通知、retry／重播。沒有新queue／狀態表／module／human設定。

測試只增於既有 `test/desktop-native-events.test.mjs`、`test/native-notices.test.mjs`。

- red原7項4pass／3fail（空summary stale、RPC stale、相同terminal重複）；同probe7/7green。
- paused／stopRequested另2/2 red→2/2green，0turn/start。
- tracked focused44/44；native-workers/wakeup/controller/flash/completion相稱139/139，0skip／exit0。Astra另外獨立57/57。
- 精確來源／turn／status、different child／turn、true UNKNOWN、stale matching read均有控制；completed/failed/interrupted→cancelled本來正確，不因此改status mapping。
- 當次view notice未resolve不是永久磁碟記錄，reopen本來會清執行期notice；正常歷史不armed新terminal，也不自行送工作。
- 真current controller fake snapshots、實際新bundle桌面1440／手機393：不同2child未知各1條、duplicate不新增；exactsettled後0visible／2raw resolved。主failed error、raw詳情、partial原文字保留，0POST/pageerror/overflow。僅隔離preview5243，正常close；不是正式原房live全字段驗收。

證據根：`D:\K-harness\.runtime\academy-recurrence-20261011\notices`；report.md、紅綠logs、ui-result.json／四張圖。原red result.json含runtime fake gateway Authorization／developerInstructions，**未送Opus、未刪改歷史／不重印**；模型packet只有精簡diff/test／必要來源／summary，沒有raw calls或headers。

## 二、學院：新的 native compact 失敗，不是舊 error 殘影

只讀報告：`D:\K-harness\.runtime\academy-recurrence-20261011\stream\report.md`。

臺灣12:54:25新主turn開始，13:02:32 failed。先有官方high-demand sampling retry1/5–5/5，原生自行HTTP fallback，之後generic service error；13:02:24 ContextLimit/MidTurn remote compact，retry1/2與2/2後terminal generic error。最後request `4f4fcfe1-f030-4c71-9521-156591bf6646`，另兩compact retry request `9e7c12e6-1e62-41a2-9a89-d3a846a53dd1`、`5404acfa-631b-4d29-9463-77193e0d39a3`。task_complete有非null error，不能當成功；沒有成功compacted第35次，既存成功仍34。

原生0.161.0精確exe/source讀回，PID30200失敗後仍有其他活動，沒有本次exit-before-drain證據；正式K排空與主錯誤保留修正已存在，截圖主錯誤仍為native compact，不是secondary蓋掉復發。這次未到成功壓縮替換後補context phase；完整hook invocation trace缺失，不能用負面grep證明絕無invocation。

high-demand前兆有證據，最後generic compact的供應商內因／完整wire／實際request context長度仍UNKNOWN；HTTP200不是成功、ContextLimit不是已證context_length_exceeded，disconnected字樣不是已證使用者網路斷線。K snapshot raw精確交付另缺授權state API，不拿native history代替。無模型fallback／新增retry／原房resume。

## 三、其他翻譯房：固定快照，不是四房全停

只讀報告：`D:\K-harness\.runtime\academy-recurrence-20261011\rooms\report.md`，臺灣14:38:01–08固定盤點；只9個exact IDs與24h rollout控制事件／metadata，不讀小說正文／完整工具output。

- **4未封存＋5封存**。學院最後主回合確實failed、未見之後主回合恢復；拳王、鐵血現分支、Pick新分支有成功主turn及原生下一turn续行，不能因學院failed對另外三房處置。
- Pick14:25 websocket compact retry、14:31同turn成功compacted、14:37:28同turn正常完成並下一turnstarted；與學院high-demand/generic terminal compact失敗分開，不能把兩者都當永久停。
- 拳王14:37:45正常完成後下一turn；鐵血現分支14:34:15完成後下一turn，14:38仍有活動。這不是全文翻譯品質／全部章節完整性驗收。
- 五封存父房／舊分支的paused/blocked／歷史failed保存，不等於新分支停止。native spawn edge open是關係記錄，不等於live worker數。
- retained logs每active房恰1000筆且只最近約半小時，24h terminal另掃完整rollout；未見不升為完全排除。鐵血讀期間自然追加，明記非跨房同一原子快照。
- 鐵血0336 translation工人昨日content-safety failed/settled，與Codex容量／compact不同；原failed保留，但已有落地156工作段候選經雙審、正式裁定與全文讀回補救。只讀補充 `D:\K-harness\.runtime\academy-recurrence-20261011\rooms\ch0336-recovery.md` 核對現存正式檔hash吻合裁定，不再列為現存未解章。style completed本身不當驗收證明，也不擴推整本品質／上游安全過濾已修；沒有重播或修改原生狀態。

本輪未取cookie／憑證，沒有授權 `/api/state`，K即時state.error/turnError/running精確欄位保留UNKNOWN。原生與畫面分類相符不等於已核實每條notice live ID。其他翻譯房的自然進度只對上述時間點成立，不是自動持續監控。

## 真正 Opus 末審／Astra 驗收

新work/session `d948f607-2bc4-4a9c-bc08-aa2bc7036e44`，官方Claude Code2.1.294、claude.ai／firstParty、Pro訂閱，actual `claude-opus-5-5`；臺灣14:43:01–14:43:57。raw實核1Glob＋3Read，無Write／Shell／MCP／子代理，不建立plan。末審明確「無blocking」，不是只採runner code0。4項非blocking（通知上限、跨epoch精確讀回、未補送模型的呈現取捨、fake證據範圍）保留、不擴功能；模型的靜態審查不等於親跑測試或原房live驗收。

`opus-review/{review.md,result.json,raw.jsonl,source-hashes.json}` 及 `review-readback.json` 留證；四個source/test目前SHA256逐一與送審版相同。Astra已獨立讀raw／diff／來源hash、57項測試及雙尺寸圖片，接受無blocking候選。

## 收尾界線

候選真正Opus與Astra末驗已完成，僅工程文件／索引／固定commit，不部署或停止正在工作的正式K。上游深層內因、原房每條warning是否stale、翻譯品質及0336已驗收補救各依自己的證據，不能用本候選局部UI綠回歸全解。沒有新套件／環境／帳號／全域設定、push／東區更新。

## 固定候選／隔離程序收尾

source commit `1a4732e3e4853c1f1784dcfd120da9cd6028ad46`，只4個已審source/test；文件與索引另以docs-only commit保留。臺灣14:48:16限定自有evidence程序／5243 preview／OpusPID22740讀回皆已退出、0listener；`isolated-close-readback.json`、`review-readback.json` 留證。沒有停止、重啟或探查正式host，也未開原房；正式仍e1712d1。此任務在候選已驗收／未部署停止，不再擴測或新模型。
