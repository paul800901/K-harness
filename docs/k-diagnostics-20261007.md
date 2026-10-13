# 南區 K 三項工單診斷（2026-10-07）

狀態：診斷／安全重現；**未修正式程式、未部署、未重啟、未停止其他工作、未 push**。檢查自臺北時間 18:59 起。最終收尾時間與 Opus 複查見末節。

## 1. 結論與界線

| 工單 | 已證實 | 尚未證實 |
|---|---|---|
| Codex 日誌 | 警告是原生 `warning` 通知；首次失敗後可一直顯示；正式 K 丟棄 stderr。原生 flush 錯誤分類另走記憶體 feedback ring，不是直接寫 stderr | 當時失敗的分類、時間、PID、SQLite extended code／底層原因；不能判定 busy、WAL、權限或 Defender |
| 三個 Chrome 設定檔 | 三個 native host 共用單一描述檔；最後 ready 者覆寫。舊 host 的 token/pid 防護有效；目前 host 離線時，即使另一 host 活著，新連線仍判離線 | PID 與本人三個帳戶的可靠對應、三者逐一讀頁、重連真實驗收；未關閉／重載真人視窗 |
| 聊天連結 | 正式 Electron 只放行 GPT／Claude 登入網址，公開 HTTP/S 被擋；右鍵事件已有 linkURL，但自訂選單完全沒處理它 | OS 預設瀏覽器真正開頁／修正版正式生效；本輪沒有部署 |

Google Ads 授權成功是使用者提供的已完成前提，本輪未讀 AdsControl 秘密檔、重做 OAuth 或更改廣告。

## 2. 正式來源與現況證據

`R = D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee`

- 正式程式：`R\trusted-runtime`；正式 Electron PID **22700**，K 專用 Codex app-server 皆以它為父程序。
- 程式版本：`.local\runtime.json` 於 18:59、19:06 讀回 **e068ffa4dcc7d0da57e73d72a98111e925975fe4**。
- 根工作樹 HEAD：**56bb038fa7c7c60cca26a18f650d655f4a060972**，不是正式版本。既有 dirty/untracked 清單保留於診斷證據目錄。
- 六個關鍵正式檔（codex-host、desktop-controller、electron-workbench、native host、chrome-native-connection、frontend main）的 Git blob 均與 e068ffa 對應檔相同；不是只根據版本標籤推斷。
- 實際 HKCU native messaging 註冊指向 `R\vault\k-browser-native-host\com.k_harness.browser_assistant.json`，批次入口執行同目錄 `host.mjs`，設定指向 `R\vault\k-browser-native-host.json`。**真正註冊的 host.mjs 與正式 scripts/k-browser-native-host.mjs 的 blob 完全相同**：`2c3ed2c867fc769ade7bc1627ddb4977d6127d8e`。
- K 專用 CODEX_HOME：`R\agent-home\.codex`；Chrome user-data-dir：`R\vault\k-chrome-profile`。這個根目錄下面有 Default、Profile 1、Profile 2，不是只能有一個 Chrome 子設定檔。
- 程式退回位置仍為 `R\releases\before-1791332162068`。只是讀取既有值，未執行退版。

完整去敏感讀回：`D:\K-harness\.runtime\k-diagnostics-20261007\runtime-metadata.json`、`live-readback.json`、`browser-metadata.json`。

## 3. Codex 本機診斷日誌

### 3.1 原生警告與 K 顯示生命週期

官方 `rust-v0.160.1` 的 [log_write_warning.rs](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/app-server/src/log_write_warning.rs) 定義與截图相同的警告，產生 `ServerNotification::Warning`、`thread_id=None`。`has_failure` 第一次失敗後永久置位，每個 reporter 至多嘗試通知一次；後續成功不代表撤回警告。

正式 `src\desktop-controller.mjs:165–169` 在 thread filter 前接收全域 warning；`:111–117` 放入目前 controller 的 notices（最多 100 則、含 K 接收時間）。普通 warning 沒有成功回合後自動 resolved 的分支。`frontend\native-ui.jsx:12–18` 的 X 只記前端 dismissed；不是修改資料庫，也不是原生恢復證據。`desktop-controller.mjs:636,770` 新建／重新載入對話時會清空 notices；`main-sessions.mjs` 沒有把 notices 當 durable 聊天紀錄保存。

本輪使用**正式 controller／filter、假 host**重現：全域 warning 接收成功；成功回合後仍可見；重新開啟假對話後 notices=0。這證明截圖警告**可以是較早的事件殘留**；沒有讀取該正式 renderer 的 authenticated notices 實例，不能斷言截圖那一則的實際接收時間或來源 PID。

### 3.2 stderr 不足以解釋這次原因

正式 `src\codex-host.mjs:17` 的 `child.stderr.resume()` 只有排空，沒有保存或轉送；因此 K 確實缺一般原生 stderr 診斷。

但官方 [log_db.rs 的 flush](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/state/src/log_db.rs) 將 SQLite flush 失敗分類後交給 reporter；[feedback/src/lib.rs](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/feedback/src/lib.rs) 的 `report_failure` **避開 tracing，直接寫 feedback 記憶體 ring**。那份診斷包含時間、低基數錯誤分類、批次 entries 數，並非完整 SQLite exception。所以：

1. 丟 stderr 是診斷缺口，不是 SQLite 寫入失敗根因。
2. **依核對的原生程式碼，這條 flush-failure reporter 路徑不送 stderr**，單純保存它拿不到這條路徑的分類；其他 tracing 錯誤仍可能提供同時段旁證。
3. 在已檢查的公開協定中，feedback 路徑是上傳，不是單純本地 ring 讀取。本輪沒有呼叫它，沒有 /feedback，也沒有整個程序記憶體 dump。

官方來源標籤與本地複本存在證據目錄；不是把上游其他版本 issue 的猜測套到本機。公開原始碼核對不等於重新編譯核對本機二進位。官方標籤解參照 commit 為 `d27764b82f7118f674371e6d6e76271d9d606edb`。

Opus 提出初始化來源缺口後，主代理補讀 `app-server/src/lib.rs:633–646,706–737`：此入口直接以 `LogWriteWarningReporter` 啟動 log layer，沒有先用另一個 stderr reporter 再替換的分支；`set_failure_reporter` 的存在不能證明本入口使用它。`core/src/otel_init.rs:105–110` 僅在 provider 有 metrics client 時安裝 process-wide SQLite telemetry；分類也可能走該 OTEL metric 的 error tag，但不是現成的本地錯誤檔，本輪沒有改 exporter／啟接收服務或擷取對外 telemetry。feedback ring 只有 4 MiB，與其他診斷共用，可能被覆蓋；程序存活也不保證舊分類仍在。

這個 warning 對應非空 log batch 的 `insert_logs` 回報 Err；單純 queue 滿只記 dropped metric，不走此 warning。至少一次日誌寫入作業回報失敗可成立；未取得 begin／insert／prune／commit 的具體失敗點，不推斷每筆實體落盤結果或聊天資料遺失。

### 3.3 程序／版本／SQLite 位置（19:05–19:06）

| 群組 | PID | 實際 HOME／版本 |
|---|---|---|
| K app-server | 24476、15656、22648、31108，父 PID 22700 | 選定環境變數實際讀回 CODEX_HOME=`R\agent-home\.codex`；四個皆同一個專案內 Codex **0.160.1** 執行檔 |
| 外部 Codex App | 23172 app-server、23756 exec-server；1856 app-server | HOME 推導／顯式 CODEX_HOME=`C:\Users\Paulus\.codex`；App 內建 Codex **0.160.1** |
| 外部 plugin app-server | 27044 | CODEX_HOME=`C:\Users\Paulus\.codex`；plugin 內建 Codex **0.160.1** |

本輪只選取 CODEX_HOME／USERPROFILE／HOME／SQLite override／logging 相關環境值，未輸出整份環境。所讀家目錄與相關專案設定未見 sqlite_home override；命令列也未指定它。K logs 裡的 `process_uuid=pid:…` 證實上述四個 K PID 最近一小時都曾寫同一 logs DB；外部 App 是另一個 HOME，**沒有它寫 K DB 的證據**。

K binary SHA256=`9E7C59C05CC1CE5677B1F94E835B2AC038CA3BE14504E78D558EACDB0EA3F55D`；外部 App／plugin binary 同為 `3B8F6E33CAA75F232558A3CF76FF9B87BB5EF6DBCF4996372F24E55C78B1B916`。三者版本文字相同，但檔案 hash 不同，不宣稱完全同一 build。K state 中舊 cli_version 是**歷史 thread metadata**，不是仍在跑舊版的證據。

未把四個 K app-server 全叫做工人：controller 會為主對話、模型／用量／登入查詢建 host，Claude 的 GPT bridge 也會建 host；Codex 原生子代理可在同一 app-server 內運作。未取得每個 live controller↔PID 映射，主代理／工人／暫時讀取器的逐一角色仍未知。當時（警告觸發瞬間）的程序環境也沒有快照可追溯。

### 3.4 資料影響：三種資料分別查驗

唯讀 SQLite URI `mode=ro`＋query_only；沒有 immutable 忽略 WAL、checkpoint、repair、重建或刪檔。

- logs_2.sqlite 約 **70,656,000 bytes**；quick_check=ok。兩次讀回 max(id) **910045 → 910052**，表示目前繼續寫入。既存 WARN／ERROR 共 985 筆的限量錯誤特徵搜尋沒有命中 DB busy/locked/full/readonly/io 或 flush-failed；**不能排除失敗，因為該 flush 診斷不走 SQLite 自己**，且有 retention。
- state_5.sqlite quick_check=ok，130 個 thread 的 rollout 參照 **130/130 存在**；thread_history_1.sqlite quick_check=ok，342 個 turn。沒有據此聲稱每筆聊天內容語意完整、過去完全沒丟訊息。
- goals_1.sqlite quick_check=ok；active=2、paused=4，讀回最新 updated_at 有進展。未讀 objective 或更動 goal。日誌警告本身不證明目標失敗，也不證明所有歷史目標都完整。
- 全部六個現有 DB quick_check=ok，journal_mode=wal；WAL／SHM 存在是正常現象，**不是鎖定證據**。可讀不等於寫權限／瞬間鎖定從未失敗。
- 未向真實 DB 故意持有 write lock、改 ACL 或製造 fail。當前多 writer 是事實；busy/locked、SQLite 5 秒 busy timeout、pool_timeout（取連線逾時，不等於 SQLite busy）、checkpoint／background reclamation 競爭、權限、I/O、native bug 都仍是未證實候選，不能先改 timeout、分 DB 或關防護。上游 writable pool max_connections=5 且 logs 啟用 background reclamation，只能說機制存在，沒有當時爭鎖證據。

### 3.5 最小後續處理（尚未實作）

首先補的是**可分類的診斷，不是 database repair**：

1. 保留既有 warning，額外記 K 接收時間、host PID、native version、HOME／SQLite path與 warning kind；每次 host 至多一則、總數／檔案大小有上限。只存這一類固定訊息，不錄整個 JSON-RPC／提示詞。
2. 若保存 stderr，應先在記憶體解析並採**白名單欄位**（時間、固定 DB 分類、PID、batch count／duration；不存原始行、URI query、Authorization 或完整錯誤）。限制例如每 host 64 筆、8 KiB，來源不符合則丟棄。持續排空 stderr，不能停止讀取造成程序阻塞。
3. **可靠取得 flush 分類的入口仍缺**：優先詢問官方是否提供本地 failure-only snapshot。若沒有，需另行決定一項極小原生擴充：只把 reporter 的分類、時間與 entries 送入本地診斷，不暴露 ring／提示詞、不上傳、不建立新常駐服務。此屬上游核心改動候選，不是本輪授權或已完成事項。
4. 隔離假 DB 驗證分類與清理界線（busy／readonly 等），再驗證對日志/history/goals 分開的影響；無實際 error code 前不修 SQLite 行為。不讓通知消失充當恢復驗收。

## 4. 三個 Chrome 子設定檔

### 4.1 正式接線與真實讀回

19:11 三個 native host 仍是 **35616→50225、31932→54693、32960→55686**（PID→localhost listening port），全部使用相同 config，父鏈為各自 cmd→同一 K Chrome PID **31772**。Chrome root 的 --user-data-dir 正確；沒有 --profile-directory 可用來分辨這三個 extension instance。

三個設定檔 Secure Preferences 的**指定擴充 metadata**都指向 `D:\K-harness\installed\k-browser-assistant`；該 unpacked manifest 為 **0.1.2**、ID `jhbfglfjhiebacbkjnohgmpgcppadblm`。未輸出其他 preference、email、cookies、密碼或帳戶 token；檔內 state/version 未提供時保留 null，不當作「未安裝」。三個 live native 程序與 listening socket 是額外活躍證據，不等於三者都完成讀頁。

單例 descriptor 指向 PID **32960**／port **55686**；ready descriptor **沒有 connected 欄位**，並不是 connected=true，讀回 null 也不能當離線。shared diagnostic **18:49:32.844 臺北** 的 stage=ready、errorCode=null；這是最後一次寫診斷者的紀錄，沒有證明另外兩個都 ready。

本輪經**原正式 native＋extension＋context 路徑**建立自己的背景測試分頁，沒有改用外部 CDP、日常 Chrome 或 Computer Use。讀回指定公開測試 URL、`Example Domain` title、readyState=complete、非空本文與 HTML；managedPageCount=1。測試完只關本輪建立的分頁／session，不關使用者視窗或重載擴充。

保留四次 probe 原始結果：初始斷言錯誤地假定 example.com 仍有 h1／本文包含 Example Domain；現行頁面已是多語段落，所以 assertion／selector 失敗。最後實際本文讀回排除該斷言，**是測試預期錯誤，不是讀頁故障**；`live-browser-readback-assessment.json` 明列裁決，不把失敗檔改寫成成功。此公開站點不應作長期測試服務，後續用自己的非敏感 data／本機 fixture。

### 4.2 為何會互相影響：安全假資料重現

正式 `scripts\k-browser-native-host.mjs:151–160,232–234` 的 ready 無條件 temp+rename 寫同一 descriptor；`src\chrome-native-connection.mjs` 每次開 connect page 只讀這一份。正式 `src\k-browser-assistant.mjs` 寫死同一 descriptorPath，browser_session schema 只有 regular／incognito。

對正式 native module 建三個假 stream host（獨立 fixture descriptor、假 Chrome parent、loopback socket；同 Node PID但不同 token，**不是三個真人設定檔**），結果：

1. A→B→C ready：新請求只到 C，A/B 沒收到。
2. 舊 B 關閉：token＋pid 條件不符，C descriptor 保持，C 仍能接請求。**並非任一 host 斷線都會弄壞其他 host。**
3. 目前 C 關閉，A 還活著：descriptor=connected:false；K 新連線回報已離線，不會發現 A。
4. 新 host ready：再次覆寫單例，後续新開連線改到它。

收據 counts=`[0,0,2,1]`，標籤為 A、B、C、A-reconnected 的 fake native request 次數。同 PID fixture 實測的是 token 不同分支；沒有實測 PID 不同／重用分支，該部分只由條件原始碼確認，不冒稱真人多程序重連驗收。

token/pid 檢查與寫回之間是兩個操作，存在理論競爭窗；**未重現這個 race，也沒有它造成本次離線的證據**。逐 host descriptor 可直接消除共用槽，不需新增鎖管理架構。

已建立的 extension relay 與 native handoff 是不同階段：native host 主要開 connect page；改 descriptor 不會自動把既有 session 換帳戶。不能推導「最後啟動者立刻搶走所有正在跑的瀏覽器操作」。重連之後的新 session 歸屬則會受單例改寫影響。

installed extension 的 onDisconnect 只清 `_port`，沒有立即自動重連；constructor／onStartup 才呼叫 reconnect。任一 profile 的 worker 再次啟動，都可能重新寫單例，不必有人手動切換；離線狀態可由某個 host 再 ready 解除，但不保證是原來那個 profile。這是 source 路徑，不是本輪真人重連實测。

另有獨立前置條件：目標 profile 需有 normal window；incognito 還需擴充的無痕授權。native caller 區分 descriptor 不存在、connected:false、資料無效、socket 失敗、timeout、extension ok:false 的訊息。歷史「離線」缺精確當次文字，不能一律歸為 shared-descriptor 問題。Preference 只有 Default 明確讀到 incognito=true；另外兩個缺此欄位，**不能把缺值當作本輪已驗證其實際無痕權限**。

### 4.3 分頁範圍與帳戶歸屬

installed background 的 ConnectedTabGroup／RelayConnection 只暴露已 attach／group 的 tab targets；`chrome-extension-context.mjs` 以該 relay 接 Playwright context。因此 browser_tabs 是**該工作 session 管理的分頁**，不是 profile 的全部分頁，也不是三個 profile 全部。

目前最多只能說新連線走 **32960 的 extension instance**；沒有 profile ID、Default/Profile 1/Profile 2、帳戶 email 的可核驗映射。三個都出自同一 Chrome root；**PID≠帳戶身分**，不能靠啟動順序或單一測試頁猜誰是誰。

本輪沒有未授權重載擴充來輪換 descriptor，也沒有從程序記憶體取另外兩個 token、枚舉私頁或繞過單例另接控制管道。故**三個設定檔逐一連線／讀頁／目標歸屬的完整驗收未完成**；現行協定缺所需識別與選擇，不是缺裝 Chrome 本體。

若本人在場，可先保留一個無敏感測試分頁，請本人確認它落在哪個 profile 視窗，低成本建立當前 singleton 的一次性映射；本輪未以此要求真人操作，測試分頁已清理。這不能取代長期穩定 ID，也不能自行驗證另外兩個。

### 4.4 最小完整修正與必要驗收（未實作）

- 延用現有 native host／extension／gateway，不新增設定面板、輪詢、備援或另一個控制通道。
- Extension 每個 Chrome profile 保有一個本地穩定識別 ID，native hello 附這個 ID；host 以**各自 descriptor**登記該 ID／PID／endpoint／mode 能力。token 仍只供 owner 使用，extension ID、Chrome root parent、loopback/token、防路徑逃逸保護不放寬。
- 現有 browser_session 增可辨識／指定 profile 的參數與回傳；多 profile 時沒有明確目標就不要靜默挑最後啟動者。既有 session 綁定已選 ID，不因另一個重連而換人。
- profile ID 只是連線身分，**不等於 Google 登入 email**。一次非敏感 sentinel 映射 Default/Profile 1/Profile 2，必要的帳戶標示依本人確認或本人授權頁面讀回；不靠 cookie／密碼推測，不新增全域帳戶架構。
- 先 fake 三 host 覆寫／斷線／重連與權限回歸；再給三 profile 各自不同 data-page sentinel，從既有 K 工具明確選取並讀回 ID＋sentinel。重連真人驗證待本人允許時才重載那一個擴充，不關人類視窗；另一個 session 必須保持連接且不換目標。

## 5. Markdown 超連結與右鍵

### 5.1 正式故障直接重現

正式 frontend `main.jsx:60–61` 已把 HTTP/S Markdown 轉成 `<a target="_blank">`；不是圖片、單純底線文字或未渲染 Markdown。

正式 `src\electron-workbench.mjs:6–12,106` 的 `setWindowOpenHandler` 只把官方 Claude/Codex login whitelist 傳給 shell.openExternal，其餘一律 deny。`will-navigate`／redirect 仍擋外部 origin；這保護聊天不被導走，但不能替代外部開頁。

同檔 `:79–85` 自訂 context-menu 只看 isEditable／selectionText／editFlags，**忽略 linkURL**；無選取文字的連結沒有任何選單，有選字時只複製文字，從來不提供複製 href。

使用**真正 hidden Electron＋正式 dist-ui＋正式 workbench module**、假服務／攔截 OS opener與非互動 Menu observer，以一般公開 URL 測試：

- anchor 正確保有 query＋fragment、target=_blank。
- 左鍵真實座標事件後 opener 收到 **0** 次，聊天 origin 未改變。
- 依 Opus 意見加強 fixture 觀測後，正式 window-open handler **實際收到完全相同 URL，回傳 action=deny**；不是只憑 opener=0 排除事件根本沒送到的可能。
- 右鍵原生 context-menu 事件帶正確 linkURL，但 Menu template **0** 次。
- fixture window 全程 hidden，沒有 OS 開頁、沒有舊 OAuth、沒有登入與正式 K UI 操作。

這是**正式檔的故障重現**，不是正式真人視窗原地操作驗收；完整證據 `links-probe-result.json`。一次 probe 初始化寫法錯誤已修正於診斷腳本，沒有改產品；之後重現成功。

### 5.2 既有候選與正式部署狀態

同聊天室先前已建立連結候選：工作樹 `D:\K-harness\.runtime\chat-links-20261007\source`，產品 commit **c7bb4cedf390fa0e0d9a828b8138b5f4458f3856**，文件收尾 **590be09**；prepared=`R\prepare-chat-links-c7bb4ce`。

先前候選放行 HTTP/S 外開，已做 targeted 8/8、source／clean candidate 951/951、hidden Electron opener 5/5及真正 Opus 5.5 複查，但**沒有部署／push**。正式本輪仍是 e068ffa 的舊 whitelist module，blob 非候選 `f1f7436c118444d9ba2479b8ab6db1c5b41079c3`。先前候選也**沒有修右鍵複製連結**，不能拿它宣稱本次兩個連結問題都已修。

### 5.3 最小修正（未在正式版實作）

1. 採既有候選的 HTTP/S `shell.openExternal` 接線，完整保留 URL；仍 deny file／任意 OS scheme、保持聊天 navigation fence。無需官方登入網站白名單、新 IPC或提示面板。
2. 既有 context-menu 加一項「複製連結網址」：檢查 linkURL 是 HTTP/S，再由主程序 `electron.clipboard.writeText(linkURL)`；保留文字選取／編輯選單，不增加 clipboard-read 權限或全域 browser 特權。
3. 回歸：公開 HTTP/S 與 query/fragment、右鍵 copy 精確值、文字／編輯選單、無 href／不合法 scheme、正常 clipboard-write 權限、chat 不被導走；hidden fixture 先驗，後續授權部署後才真實 OS 預設 browser＋formal readback。依現行規則完成真正 Opus 5.5 修碼審核；診斷複查不替代修碼驗收。

## 6. 證據與收尾

證據目錄：`D:\K-harness\.runtime\k-diagnostics-20261007`。

- runtime-metadata／live-readback／browser-metadata：程序、版本、非秘密設定與 DB schema／統計。
- native-probe-result：正式 native module 三假 host，4 項 lifecycle 行為符合上述結果。
- notice-probe-result：原生 warning 的 K 保留／重開清除重現。
- links-probe-result：真正 hidden Electron 正式 UI，左／右鍵兩問題重現。
- live-browser-first／second／third／result ＋ readback-assessment：保留測試斷言失敗及後續實際頁面證據，不把它們混成三 profile 驗收。
- existing-targeted-tests：既有 native host／connection／extension／notice regression **27/27**。在先前獨立工作樹執行，非新的完整部署驗收。
- upstream .rs：官方 rust-v0.160.1 公開來源；未下載／更新 provider binary 或相依。

未完成：當時 SQLite error分類／根因、K live notice 的時間與 controller/PID 對應、三 profile 身分與逐一 readback、真人重連、右鍵修碼、所有正式修正／部署與 OS 開頁驗收。

### 真正 Opus 5.5 診斷第二意見與取捨

- 使用既有官方 Claude 訂閱（firstParty／claude.ai，Claude Code **2.1.292**），只讀去敏感 packet，禁 MCP、Chrome、寫檔、命令與部署。實際回傳 model **claude-opus-5-5**，session **d8a82509-f483-4c76-847d-5ece4c54a7a5**；19:17:06 啟動，19:19:44 完成。沒有 fallback 或 API key 路徑。
- Opus 明確結論：**無法推出歷史 SQLite 根因**；現有證據不支持 busy／鎖定等任一具體原因。它確認兩項接線問題、單例／relay區別及讀頁斷言誤判的方向。
- 已採納：stderr 路徑改為更精確的否定；補查初始化 reporter／telemetry 去向；補 pool_timeout／reclamation 候選但不當根因；標示 ring 覆蓋；標示同 PID fixture 限制與 counts；補 worker 重啟／normal-window 條件；補 left-click handler 的直接觀測與 checks 清單。行號已校正。
- 不直接採納的過度推斷：metadata 的 incognito 缺值不是 live 權限驗收；離線也可能由另一個 profile ready 改寫，不能說只能等原 profile 重啟。Opus 的「至少一批完全沒寫進 SQLite」改採更嚴格的「一次寫入作業回報失敗」，未取得具體 transaction 失敗点前不臆測落盤量。
- 完整原文：`D:\K-harness\.runtime\k-diagnostics-20261007\opus-review\opus-review.md`；身份／時間收據：同目錄 `opus-start.json`、`opus-result.json`。這是**診斷**複查，不是產品修碼審核／部署通行證。

收尾於 **2026-10-07 19:25:09 臺北時間**再次讀回：正式仍 e068ffa、Electron PID 22700 存活、三 native PID 不變；六項正式 source blob 未變。D 槽剩餘 **365.7 GiB**。九個既有 tracked dirty 檔中，八個 hash 原封不動；development-log 原內容 hash 也保持，只追加本次索引。原 untracked 清單保留；本輪只新增此報告、索引及 ignored `.runtime` 診斷／假資料證據，沒有 staging、commit、部署或 push。這些讀回不是 SQLite 歷史原因已找到或三 profile 已驗收的宣稱。
