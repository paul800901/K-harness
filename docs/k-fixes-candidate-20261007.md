# 南區 K 三項修正候選：已本地驗證，等待一起更新

## 結論與授權

- 使用者 2026-10-07 明確要求實際修碼，納入先前未上線的修正；完成後先停，因正式 K 正在執行工作。本輪**不部署、不重啟、不停止其他工作、不 push**。
- 狀態：**候選實作＋本地回歸＋真正 Opus 5.5 複查完成，已固定程式版本；尚未正式部署／三真帳戶驗收。**
- 連結及單例 profile 接線已修。Codex 只補必要診斷和工程通知呈現；歷史 SQLite 故障分類／根因仍未知，不宣稱 SQLite 已修復。
- 沒有修改資料庫、WAL/SHM、權限、防護、provider 核心、帳戶登入、Chrome 資料、Google Ads OAuth 或廣告。沒有安裝套件、移轉憑證、使用替代 Chrome 控制管道。

## 版本、來源與讀回

- 正式根 R：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee`。
- 正式程式：`R\trusted-runtime`；Codex HOME：`R\agent-home\.codex`；原生助手與 Chrome：`R\vault`。
- 正式仍 **e068ffa4dcc7d0da57e73d72a98111e925975fe4**，installed 擴充仍 **0.1.2**。
- 候選來源：`D:\K-harness\.runtime\chat-links-20261007\source`；分支 **codex/k-diagnostic-fixes-20261007**。
- **程式 commit：c8942217303cb5f03471994ec4b91b8fddb1d14e**。文件收尾另 commit，不把文件 HEAD 當成正式已更新。
- 沿用原候選 **c7bb4cedf390fa0e0d9a828b8138b5f4458f3856** HTTP/S 左鍵開頁修正，沒有再次部署舊 `prepare-chat-links-c7bb4ce`。新批涵蓋左鍵、右鍵及其餘兩項；之後應用新整批 commit，不單独上舊候選。
- 與正式 source 比對，沿用候選的其餘程式和正式一致；舊候選另外已有文件差異，不把文件差異說成未上線的新功能。主工作樹 HEAD 仍 **56bb038fa7c7c60cca26a18f650d655f4a060972**，不是正式來源，也沒有將主樹既有 dirty 檔混入候選。
- **2026-10-07T19:54:50.8077708+08:00**：九項正式 source blob、實際註冊的 vault `host.mjs` 均與正式 e068ffa 一致；Electron PID **22700** 仍自 16:28:37 執行，native **35616／31932／32960** 同一啟動時間，未由本輪重啟。
- 八個主樹既有 dirty 檔 hash 與診斷前相同；development-log 只追加本批索引，原內容 byte prefix 保留。其他既有未提交／untracked 內容不清理、不 staging。

## 一、Markdown 超連結

### 已證實根因

正式 `src/electron-workbench.mjs` 原 window-open handler 只放行兩家登入網址，將一般網站 deny；context-menu 沒讀 linkURL，所以右鍵沒有複製連結。

### 修正

- 保留前次候選：一般 HTTP/S 交給系統預設瀏覽器；不要求 K 額外網站 allowlist。完整 URL 的 query／fragment 不截斷、不重組。
- 既有 context-menu 加「複製連結網址」，使用 Electron main `clipboard.writeText`；只接受 HTTP/S。
- 保留文字選取／可編輯欄位既有選單、聊天 will-navigate／redirect fence、非網頁 OS protocol 拒絕。沒有新 IPC、clipboard-read 權限或面板。
- 修改：`src/electron-workbench.mjs`；前次 `test/electron-workbench-permissions.test.mjs`；本批 `test/chat-links-electron-probe.cjs`。

### 證據／界線

- 既有 handler unit **7/7**；完整回歸亦涵蓋。
- 真正隱藏 Electron＋候選 built UI，座標左／右鍵測試成功。一般公開網址、localhost 假網址完整送 opener，copy-link 寫完整 href；file／custom scheme 不提供連結複製；原文字選單保留，聊天沒有導航。
- shell opener 被測試攔截，**沒有開 OS 瀏覽器或搶前景**。最終 probe 不使用舊 OAuth 或重新授權。
- 證據：`D:\K-harness\.runtime\k-fixes-20261007\electron-final\result.json`。正式 OS 開頁、正式右鍵驗收待一起部署後。

## 二、N 個 Chrome 設定檔

### 已證實根因與原行為

三個 native host 共用一個描述檔，最後 ready 決定後續 openConnectPage 對象；當該 host 斷線，其他仍在線 host 不會被發現。舊 token/PID 防護會保護「舊 close 不把新 slot 標成離線」，但不解決多 profile 選擇。既有 relay 不會因 slot 改寫立刻換帳戶。

### 最小完整修正

- 擴充候選 **0.1.3**，同一 extension ID/key不變。只新增必要 **storage** 權限，在各 Chrome subprofile 的 **storage.local（不是 sync）** 保存隨機 32hex `kProfileId`。不保存 Google email／cookie／密碼或搬登入。
- 每 worker 啟動一次 `profileHello`；native host 維持原 origin、K user-data-root ancestry、loopback、bearer、connect URL 防護。
- 描述檔變成 `k-browser-native-link.json.<profileId>.json`，每 ID 一個 slot；config／registry 路徑格式不需要改。version 2 有 profileId 與登記時的 mode capability。
- 斷線**不再寫 slot**；`browser_profiles` 按需以 authenticated status 查各 slot，判別目前 native 是否在線，不需要常駐輪詢／登記服務／備援。
- `browser_session` 可指定 profileId，回傳選定 ID。初次有多個在線 profile 不猜最後啟動者；只有唯一在線時允許省略。已選定後省略 ID仍保留原目標，另一設定檔新增／重連不自動改派。
- 子 gateway 依 mode＋profileId 分開；context 開啟時截取指定 native instance 的 descriptor，既有工作不因 descriptor 變動換人。busy／人工接手／recoveryRequired 保護不放寬；失敗選擇沒有上一目標 fallback，也不重送未知操作。
- native hello timeout／寫檔失敗會關 own channel，stdin.destroy，程序退出；失敗 identity promise不永久快取，只允許既有手動／startup再次嘗試，沒有自動重試迴圈。
- 新增第四、第五設定檔用同一版助手，各自登記新 ID；**沒有寫死三個**，不用重新安裝 Chrome。Chrome 設定檔並非 Google 帳戶：同一設定檔可多帳戶，帳戶工作仍要驗證網站當前身分。
- tabs 還是助手 attach／分頁群組管理範圍，**不是該 profile 全部分頁**；沒有因此枚舉私人頁面。
- 改檔：`browser-extension/source/nativeConnection.ts`、`browser-extension/manifest.json`、`scripts/k-browser-native-host.mjs`、`src/chrome-native-connection.mjs`、`src/k-browser-assistant.mjs`、`src/external-browser-gateway.mjs`；相應 native／extension／gateway tests。

### 驗證與未驗收

- 四個假 profile 真正 loopback/native frame routing：指定 A/B/C/D只送各自 host；舊 A關閉不覆蓋新 A；C離線而 B/D還在線，不回退去B/D。清單沒有 token／endpoint／PID 洩漏。
- 四個 gateway 假 sentinel：指定誰、gateway結果與launch profileId就是誰；新增 E不改 D中的工作；未知target或失敗選擇不留隱式fallback，路徑 traversal拒絕。
- hello延遲→old close→fresh sameID→release old，舊 writer不覆蓋 fresh；真正 node fixture 即使父端 pipe仍開，hello timeout也退出 code0。只停止本輪假程序，不碰正式 native。
- Chrome API fixture證明不同 profile不同 ID、重建worker同 ID、incognito capability、不搶focus／首次不開窗；storage失敗後明確重新連線可恢復。
- **未重載／逐一讀三個真 profile，未辨識 email與profileId對應，未驗證正式三帳戶讀頁或真人重連。** 不把假 sentinel或單一舊分頁讀回當作三真帳戶驗收。
- 身分假設：ID是可信擴充在K user-data-root內自行聲明，parent check不驗Google帳戶。不要複製整個profile目錄（那會複製ID，也違反本任務不搬登入邊界）。incognito capability是hello時的資訊，實際open仍由擴充檢查權限。
- 每profile固定slot避免歷史instance檔無限增加；stale slot保留，但auth status判離線。write-check與rename間極小窗口仍可能留stale slot，不能宣稱有跨程序原子owner lock。

## 三、Codex 診斷與工程通知

### 原因／未知

- 原 `child.stderr.resume()` 排空但不保存是診斷缺口，**不是 SQLite 根因**。
- 官方 0.160.1 flush reporter把error分類送feedback memory ring，**不經stderr**。因此本批不能追回當時分類，亦沒有修改官方核心／資料庫行為。原診斷報告保留：`D:\K-harness\docs\k-diagnostics-20261007.md`。

### 修正

- `src/codex-host.mjs` 接上必要失敗-only本機紀錄；`src/codex-host-diagnostics.mjs` 限量保存收到特定 app-server warning 的 receiveAt／PID／executable／CODEX_HOME及固定kind。
- 保存於 `<CODEX_HOME>\k-diagnostics\codex-host.jsonl`；**只適用提供明確 CODEX_HOME 的host**。K原生 spawn目前以專用home接入；env缺失不猜外部home、不改全域。
- stderr維持 drain，最多緩衝 2048字元一行；只存白名單固定分類，**無原文、提示詞、SQL、token／授權資料／RPC**。evidenceSource區分 `stderr_text_match`和`app_server_warning`；stderr文字命中是旁證，**不能自動歸因為logs DB flush分類**。
- 每host <=64筆／8KiB；stderr最多4KiB且留一slot與另一半預算給唯一native warning，重複warning只記一次。單檔總量<=256KiB，同owner process各host共用serial writer，UUID暫存名不撞。
- 資料路徑拒絕redirect/symlink，檔拒絕hardlink／不安全檔及過大既有檔，讀寫限量；任何diagnostic失敗不影響native host／onEvent，不用SQLite保存這份證據。
- nativeVersion／sqliteHome／sqliteHomeSource／nativeFlushClassification均誠實 `unknown`，不從路徑猜版本或把CODEX_HOME當必然sqlite_home。後續故障需核對該PID實際 binary／config／env。
- `frontend/native-notices.mjs` 只將**完整精確已知logs-warning**視為工程訊息而不常駐使用者banner；原notice仍保留，不標resolved，不改其餘未知warning、history失敗、登入、核准或quota。畫面消失不是資料庫已恢復。
- tests覆蓋fragment、去敏、write failure不中止事件、同process2hosts不丟紀錄、caps、stderr洪流後warning仍記錄。

### 仍未知／影響

- 歷史 SQLite write operation 曾回報失敗；至今無直接證據證明busy、WAL、權限、版本差異、Defender等任一原因。不要盲改timeout／資料庫或跑feedback。
- 此原生warning針對診斷logs；不等於聊天歷史或goal DB故障。本輪不修改任何DB；先前read-only quick_check／rollout核對正常也不證明歷史從未失敗。
- 256KiB有界紀錄會淘汰舊事件，診斷IO失敗可能沒有紀錄；不同OS owner process同時RMW同一HOME仍可能lostupdate（本輪未建立mutex系統）。最後超長／未換行stderr不保存；memory ring依舊不是本機可讀入口。
- 本批是**補診斷缺口，非SQLite故障根因修復**。後續若復發依此安全metadata核對，可靠取得native error分類仍需官方local-only入口或另行核准最小instrumentation；禁止把完整feedback ring寫工程報告。

## 測試與真正 Opus 審核

- extension及UI以既有相依成功建置，未安裝套件／改環境；build有既有Vite輸出目錄／chunk-size提示，沒有因此改動建置架構。relay編譯檔內容hash未變，不列成新功能。
- 第一輪full **958/959**：未修改的install-runtime fake prepared→trusted-runtime rename出EPERM。保留失敗紀錄，不當成正式K／SQLite根因。該case獨立重跑 **6/6**；第二輪full **959/959**。
- 審核補修後最終full **963/963**，fail／skip／cancel=0，34.112秒；來源即固定程式commit，沒有改formal或偷換測試成標記pass。
- Hidden Electron左／右鍵probe成功；native真fixture程序timeout退出成功；三正式Chrome驗收沒有冒充完成。
- 真正官方Claude訂閱，Claude Code **2.1.292**，實際model **claude-opus-5-5**。未用API key／供應商或模型fallback。
- 第一輪session **00c4b6f5-9d70-4886-96b0-f9df3cd41f4a**，19:44:47起；提出B1（stderr預算吞warning）、I1（stop後stdin使host活著）、I2（late publication）、I3（快取失敗identity promise）。全部採納最小修正及回歸。
- 第二輪session **847a0a47-49a6-4908-aaac-85bd76efd247**，19:50:55～19:52:03；確認四項source問題已修、**無新的blocker／必修問題，無過度設計**。審核當下final full仍在跑，現已讀回963/963。
- 不採非阻擋的直接unlink temp建議：使用者要求檔案清理須可還原，本輪不加永久清理。取消publication/rename失敗可能留受保護暫存檔，不影響profile列表；不為理論卡住IO新增timeout／lock／背景輪詢。額外非阻擋測試建議留審核原文，不擴張為另一套驗證系統。
- 第一、二輪原文及身份收據：`D:\K-harness\.runtime\k-fixes-20261007\opus-review`、`...\opus-review-followup`；只有限定去敏packet，不讀private prompts／Chrome登入或其他專案。
- 相稱的本地證據：`D:\K-harness\.runtime\k-fixes-20261007\evidence`、`electron-final\result.json`、`final-readback.json`。失敗紀錄保留，不刪或覆蓋成成功。

## 下次一起更新：必須對齊的部署單位（尚未操作）

1. 等使用者交代可更新，確認K無執行中工作。不能以既有SOP自動部署權限越過本輪「先停」；不強制結束工作。
2. 按固定 **c8942217303cb5f03471994ec4b91b8fddb1d14e** 準備完整runtime，保留程式／啟動器可退回版本。它不是聊天／帳號資料備份，不還原或搬資料。
3. **runtime、實際註冊的 vault host.mjs、新0.1.3 installed擴充要一起對齊**。只換trusted-runtime不會更新當前獨立複製的native host。本輪沒有重新註冊、改config、取代host或installed擴充；generic Setup-K-Browser不是本機現有vault註冊的直接同義更新，不能盲跑而改掉實際路徑。
4. 只更新程式／擴充檔；原同一extension ID保留storage與登入。三profile需載入新版，必要的Chrome權限由本人確認。不關使用者視窗，不複製profile／cookies／密碼，也不回日常Chrome。
5. 正式readback確認fixed SHA、actual registeredhost source和extension version；K工具 `browser_profiles`→逐ID `browser_session`→各profile無敏感sentinel/公開讀頁，確認「選誰、讀到誰」。需要真人識別或重連時安排本人，不擅自close/reload正在工作的profile。
6. 正式左鍵OS開頁與右鍵精確href、原文字／編輯選單、chat不導航；Codex只有限量diagnostic實際讀回，不刻意鎖正式DB製造故障、不假裝歷史根因已找到。
7. 本輪**不push，不更新東區**；後續仍以當輪授權與安全讀回為準。

## 收尾

已完成候選程式修正、完整本地回歸、兩輪真正Opus複查與固定Git版本。**在這裡停下，保留正式K繼續工作。** 當時SQLite原因、三真profile及正式OS外開的驗收是明確未完成事項，不以此文件當作全部已正式解決。
