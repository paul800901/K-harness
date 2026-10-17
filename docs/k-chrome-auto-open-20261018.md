# K 自行開啟 K 專用 Chrome、停止後自動重連（2026-10-18）

## 本人決定（原話）

- 維持 K 這一套瀏覽器（Claude、GPT 共用），讓 K 自己開 Chrome：「那乾脆就維持現狀,維持A的這一套,然後我覺得啦,讓你們去開啟Chrome,我覺得這個是我可以接受的,雖然說它可能偶爾會突然跳出來,但是你們就盡你們的可能,讓它維持在後台這樣,維持在縮小狀態就行了,沒有偶爾跳出來沒有關係,我覺得沒有必要為了這一件這種事情,其實大部分的時候,我也不至於到時候會影響到什麼東西啦,沒有那種致命危險,所以不要為了這種事情浪費掉你們自己開Chrome,然後去解決事情,然後把事情做好的能力。」
- 停止或 Chrome 重開後的重連：選「自動重連（建議）」（AI 下次用瀏覽器時自己接上新連線，被中斷的動作不自動重做）。
- 無痕模式也要全自動：「會啊 無痕模式很重要啊因為我們的建觀要查一些比如說建觀在那個無痕模式下地圖的排名跟那個Google搜尋的排名這些都是很重要的東西」（「建觀」為語音聽寫，指見觀）。
- 停止鈕實測：「不用湊這個了,這意義不大。」（本人以傳訊息「停止」讓 AI 停下，訊息停手已實際確認；停止鈕路徑由自動測試與 Sol 驗收涵蓋。）

背景：本人問為何 Codex App 能直接開 Chrome。查證：OpenAI 官方文件寫明 Chrome 控制只在 ChatGPT 桌面 App，Codex CLI／其他入口不支援（[官方 Browser 文件](https://developers.openai.com/codex/app/browser)、[openai/codex#26820](https://github.com/openai/codex/issues/26820)、[#22164](https://github.com/openai/codex/issues/22164)），K 接的是 Codex 核心，接不到；Claude Code 的 Claude in Chrome 也要 Chrome 先開著（[官方文件](https://code.claude.com/docs/en/chrome)）。所以 GPT 要操作網頁只能用 K 這套，本人選擇維持一套。原本「Chrome 沒開時不強行開窗」來自 2026-09-27 一次抽樣曾抓到新視窗在前景（[browser-data-background-20260927.md](browser-data-background-20260927.md)）；「停止後要重新開啟對話」是 2026-09-25 舊架構（瀏覽器跟著 MCP 程序）的技術限制，不是本人定的規則。

## 實測（真 K 專用 Chrome，100ms／20ms 前景抽樣）

| 開法 | 結果 |
|---|---|
| WScript.Shell 以「縮小、不啟用」(7) 開 | 3/3 跳到最前面且沒縮小；Chrome 不理會啟動顯示設定 |
| `--no-startup-window` | Chrome 沒有視窗就自己結束，助手連不上 |
| 一出現就 `ShowWindow` 縮小 | 縮得太早：Chrome 會再放大，或焦點留在縮小的 Chrome；第一輪還把 Profile 2 的還原位置記成 (-486,0)-(30,185)，本人點開時卡在左上角拉不出來（已手動移回 (200,60)-(1700,1000)） |
| 視窗出現後等 150ms，送 `WM_SYSCOMMAND SC_MINIMIZE`（等於按縮小鈕） | 5/5：閃約 0.19 秒即縮到工作列，焦點回到原視窗，還原位置不再被改壞 |
| 同上，本人在 K 視窗時 | 焦點被 Windows 交給 Z 順序下一個視窗（DeepSeek Harness 被叫到前面） |
| 同上＋縮小後把焦點交還開 Chrome 前的視窗 | 2/2：K → Chrome 約 0.2 秒 → 回到 K，沒有其他程式被叫出 |

腳本與結果保留在 `.runtime/archive/k-chrome-auto-open-20261018/`。

## 修改

- 新增 `scripts/start-k-chrome-minimized.ps1`：以 K 專用 `--user-data-dir` 開 Chrome，一律開一般視窗（瀏覽器助手兩種模式的連線頁都開在一般視窗）；記下 Chrome 出現前的前景視窗（排除 Chrome 自己的視窗）；視窗出現 150ms 後送縮小命令，100ms 後若前景不是原視窗就交還焦點。Chrome 立刻結束或 15 秒沒出現視窗時回報失敗。腳本跑完就結束，Chrome 不留在 K 的程序樹（K 強制結束時不會連帶關掉 Chrome）。
- 新增 `src/k-chrome-launcher.mjs` 的 `startKChrome`：Chrome 執行中會一直開著 `lockfile`，所以以「能否開啟 lockfile」判斷：開不了（EBUSY 等）表示在執行，只等助手連上、不再開；不存在或能開（當機、停電留下的殘檔）就以 `powershell.exe -NoProfile -NonInteractive -File` 執行上面的腳本（`windowsHide`）。多個聊天室同時要求時共用同一次開啟。已被停止的請求不開 Chrome；等待中被停止就立即放手，別的聊天室需要的那次開啟照常進行。之後每 0.5 秒查一次連線，20 秒內沒連上就回報。開啟失敗或沒連上都如實回報，不重試、不換其他瀏覽器。
- `src/k-browser-assistant.mjs`：把 `startExternalBrowser` 接給瀏覽器閘道。
- `src/external-browser-gateway.mjs`：
  - `browser_session` 發現沒有任何已連線的設定檔時，呼叫 `startExternalBrowser` 後再選；選不到維持原本的「無後備」錯誤。
  - 停止或 Chrome 關閉造成的斷線（`recoveryRequired`）不再要求重新開啟對話：明確再選一次時關掉舊連線、建立新連線，只做就緒檢查，不重送任何先前操作。仍有操作在跑（busy／in-flight）時照舊拒絕切換。
  - `browser_session`／`browser_profiles` 的工具說明補上「沒開會自己縮小開」「斷線後再選一次即可重連、不重做」。
- 文字：右側狀態改為「瀏覽器連線已中止；AI 下次使用瀏覽器時會重新連線，先前操作不會自動重送。」；拒絕操作時提示模型呼叫 `browser_session` 重連；`chrome-native-connection.mjs` 拿掉「K 不會自動跳出／不會搶前景」等已不成立的說法。
- K 瀏覽器助手擴充（`de6ef29`，版本 0.1.3 → 0.1.4）：`background.ts` 在沒有該模式視窗時，以 `chrome.windows.create({incognito, url:'about:blank', state:'minimized'})` 自己開一個縮小的視窗，用它的空白分頁當工作分頁（原本直接拒絕並要本人開視窗，K 要等 90 秒逾時才知道）；`nativeConnection.ts` 在沒有一般視窗時，把連線頁開在自己的縮小一般視窗（一般請求時該視窗成為工作視窗；無痕請求時連線完成、連線頁關閉後該視窗隨之關閉）。開窗被 Chrome 拒絕時（例如停用無痕）回報中文說明。
- `AGENTS.md` 第九節改為新規則。
- 未改：開啟的是 K 專用 Chrome 最近使用的設定檔（Profile 2）；AI 指定其他設定檔時仍回報。擴充遇到其他錯誤時仍只在連線頁顯示、不回報給 K（K 等 90 秒逾時），本批只消除最常見的「缺少該模式視窗」。聊天室重開時的舊恢復流程（`desktop-controller`、`conversation-controller` 的 `recoveryRequired` 重建 host）保留，屬第 7 項 Codex 主控範圍。`Open-K-Browser.ps1`（本人手動開、要看得到視窗）與新腳本（AI 用、立即縮小）行為不同，不合併。

## 驗證

- 新測試：`test/k-chrome-launcher.test.mjs`（以另一程式獨佔 lockfile 模擬執行中的 Chrome：不重開只等待、等不到回報；殘留 lockfile 照常開；兩個聊天室共用一次開啟；一律開一般視窗、腳本參數；開啟失敗不重試；已停止的請求不開；等待中被停止立即放手而別房的開啟照常；取消停止等待）；`test/external-browser-gateway.test.mjs` 補「斷線後再選建立新連線、只跑就緒檢查不重做」「仍有操作在跑時不換連線」「沒連線時只開一次並選到連上的設定檔」「開啟失敗如實回報、不選任何模式」；原「斷線回報需重新開啟」測試改為新行為。兩項停止測試在修正前的程式上都卡到逾時。
- 真機端對端（`run-start.mjs` 直接呼叫 `startKChrome`＋真 `listChromeProfiles`）：一般、無痕各 1 次與交還焦點後 2 次，約 1.9 秒助手連上；Chrome 已開著時不重開。之後以分支的真瀏覽器閘道（`gateway-e2e.mjs`，接本人 K 專用 Chrome 與擴充）：Chrome 關著時 `browser_session regular` 2,148ms 選好（閃約 0.19 秒、焦點回原視窗），`browser_navigate example.com` 成功；接著 `browser_session incognito` 90,026ms 逾時（擴充改版前的既有限制，促成 `de6ef29`）。
- 擴充改版的真瀏覽器驗證（`ext-incognito-probe.mjs`，拋棄式 Chromium 1246 設定檔載入新建置的擴充、開無痕權限，只有一個已縮小的一般視窗，不碰本人 K 專用 Chrome）：AI 要無痕時擴充自開縮小的無痕視窗，`browser_session incognito` 206–216ms 選好、`browser_navigate` 成功，3/3；每次約 77 筆 20ms 前景抽樣，測試 Chromium 0 次在前景。`nativeConnection` 的「沒有一般視窗」路徑走真原生 host，只有單元測試，部署後再實測。
- 完整 `npm test`：最終 1747/1747（含 Fable 第二審後補的測試，建置介面後）。介面原始碼未改，未跑 `test:ui`。

## 複查與部署

- GPT-6.1 Sol 驗收（`5d0a6b0`）：「不同意」，P2 必修——已被停止的請求仍會開 Chrome，等待共用開啟時被停止也不放手（它在隔離槽重現）。其餘通過：重連只建立新連線、只跑就緒檢查，不重做；共用開啟沒有競態；PowerShell 5.1 解析與 `Add-Type` 通過；拋棄式 Chrome 實測縮小與焦點交還成功、正常關閉後 lockfile 移除；隔離槽 `npm test` 1740/1740。殘餘風險：本人若剛好在約 250ms 內切到別的視窗，可能被拉回原視窗（屬已接受的短暫干擾）。已修（`453e9ad`）。
- Fable 5.1 唯讀第二審（`5d0a6b0`）：無 P1。採納：P2 殘留 lockfile 會讓 K 永遠不開 Chrome（改為以能否開啟判斷，`8a2138d`）；P2 冷啟動只開無痕視窗時另一模式被擴充拒絕——查證後更嚴重：連線頁一律開在一般視窗，只有無痕視窗時兩種模式都連不上，改為一律開一般視窗（`8a2138d`），擴充自開缺少模式視窗另待決定；P3 腳本一律回成功（改為 Chrome 立刻結束或沒出現視窗時回報失敗）；P3 `$previous` 可能抓到 Chrome 自己的視窗（排除）；P3 `chrome-extension-context.mjs` 舊說法（更新）；P3 `children.get(key) === existing` 在佇列序列化下恆真（刪除）。不採納：手動開啟腳本與新腳本合併（行為不同）。P3「`await starting` 期間取消不生效」已由 `453e9ad` 修正。P3「本人在非 K 視窗時焦點交還可能失敗」：前幾輪本人在日常 Chrome 時，焦點都由系統正確交還，未需交還步驟；列為殘餘風險。
- Sol 複驗 `8a2138d`：上次的取消缺口已解決、取消後開啟失敗無未處理 rejection、lockfile 正常／殘留／獨佔判斷通過、隔離槽 1743/1743；但仍「不同意」，P2：lockfile 檢查期間被停止（且沒有別的聊天室在等）仍會開 Chrome（經 MCP 閘道重現）；另建議逾時訊息別宣稱 Chrome 已開啟（權限錯誤時會失真）。已修（`d7b4ddb`）：共用開啟在 lockfile 檢查後確認仍有未停止的請求才開；逾時訊息改為「瀏覽器助手沒有在 N 秒內連上；請確認 K 專用 Chrome 已開啟並啟用擴充」。新測試在 `8a2138d` 上啟動 1 次而失敗。
- Sol 最終驗收（`d7b4ddb`，含擴充 `de6ef29`）：「同意」合回 main。原重現程式 `8a2138d` 啟動 1 次、新版 0 次，另驗「仍有存活請求」「全部停止後再請求」「停止後另一請求加入」皆通過；擴充改動合理、建置版本 0.1.4、無過度工程化；`Setup-K-Browser.ps1` 確實備份既有擴充與設定、複製正式 runtime 建置的擴充、重套同一 HKCU native host 登記並讀回，與部署說明一致；「允許無痕」仍需在擴充頁已啟用（本人 K 專用 Chrome 先前已允許，descriptor 讀回 incognitoAllowed）。隔離槽 build:ui、擴充建置成功，`npm test` 1744/1744。未跑 test:ui、未重做真 Chrome 實測。
- 主代理 `npm test` 1744/1744（`d7b4ddb`）。
- Fable 5.1 唯讀第二審（擴充 `de6ef29`）：無 P1。查證無問題：無痕不建分頁群組、一般模式建群組已帶 windowId，新視窗唯一分頁當工作分頁不會被搬走；連線結束只解除群組、留下的縮小視窗下次同模式會重用、不會累積；本人關掉該視窗會斷線、下次自動重連；連線頁放新縮小視窗不影響其他連線；權限檢查在建窗前。採納：P2 部署後實測要涵蓋 `nativeConnection` 新路徑（見下方實測清單）；P2 `background.ts` 一般模式自開視窗在 K 流程幾乎不可達（連線頁一定在一般視窗），列為已知未在真 Chrome 驗證；P3 開窗被拒時 Chrome 英文例外改為中文說明；P3 補三個錯誤分支測試（建窗被拒、建窗無分頁、原生連線建窗被拒不回傳 Chrome 錯誤）；P3 文件與註解改正：一般請求時連線頁的縮小視窗會成為工作視窗，只有無痕請求時隨連線頁關閉；P3 `browser-extension/README.md` 拿掉早已不存在的「允許並開啟新分頁」按鈕與「候選、未安裝」說法。不採納：P3 建窗成功但後續失敗留下一個空白縮小視窗（下次同模式重用、不累積）。這些修改在 Sol 最終驗收之後，限於錯誤訊息文字、測試與文件，未再送 Sol；最終 `npm test` 1747/1747。
- 部署後實測清單（在 K 裡由 AI 執行）：1. 關掉 K 專用 Chrome，叫 AI 用一般模式開網頁（K 縮小開 Chrome）；2. 接著用無痕模式（擴充縮小開無痕視窗）；3. 只留無痕視窗、關掉一般視窗，再分別要一般與無痕（走 `nativeConnection` 自開連線頁視窗）；4. 確認擴充版本 0.1.4、右側狀態與焦點沒有被搶。
- 已合回 main 並 push（遠端讀回 `c993e95`）：程式 `5d0a6b0`、`453e9ad`、`8a2138d`、`de6ef29`、`d7b4ddb`、`3ba604e`；紀錄 `536ebb9`、`84f2bd4`、`8da0be9`、`c993e95`。要部署的固定程式版本：`3ba604e2d99c9e9a4088977623383967f33ee255`。
- 部署（擴充有變更）：K 外 `Update-K.ps1` 之後，執行 `scripts/Setup-K-Browser.ps1`（以正式 trusted-runtime 建置的擴充更新 `installed/k-browser-assistant`，先備份；重套同一 K native host 登記），再讓 K 專用 Chrome 載入 0.1.4（關閉 K 專用 Chrome 後重開，或在擴充頁按重新載入），並讀回擴充版本。
- 部署：待合回 main 後由本人在 K 外更新（同前，交給 Codex App 的 Sol 執行）。更新後可實測：關掉 K 專用 Chrome，再叫 AI 用瀏覽器。
