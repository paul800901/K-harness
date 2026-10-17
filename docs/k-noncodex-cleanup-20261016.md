# K 非 Codex 部分整理（2026-10-16 起）

[GPT 遺留程式整理](gpt-legacy-cleanup-20261015.md) 第 5 項。Opus 與 Astra（`gpt-6-astra`，xhigh）各自只讀盤點後比對，兩邊同意的做法才動手。Codex 主控（`desktop-controller` 拆分、臨時程序讀模型目錄）屬第 7 項，本批不碰。

## 盤點結論（兩邊比對後）

1. 工人狀態判斷：結束狀態清單 6 份（後端 5、前端 1）；`workers()` 回傳形狀相容寫法 5 處。各處判斷不完全等價：畫面、完成通知只看「是否已結束」，閒置釋放、刪除、換工作區要看「是否可能還活著」（`running + settled:true` 這類矛盾紀錄仍要擋）；`failed + settled:false` 是「失敗但停止未確認」，不算結束。所以只共用詞表與兩個判斷，不合成一個布林。
2. 瀏覽器與本機工具伺服器：Bearer 比對 3 份、外層 gateway 以 HTTP 轉送到同程序的內層 gateway。分兩批：先共用驗證函式、拓樸不變；再把內層 HTTP 改成直接呼叫，須接回斷線即取消、串流讀完才釋放等行為，另批驗收並實測。
3. `isolated-desktop`：同一個「只允許已登記工作區」檢查包在聊天室路由層與 provider 層各一次。路由層的選擇本來就交給 provider 層，可拿掉；路由層的「移動」預檢要留（它在載入未開啟的聊天室之前就擋下非法目的地）。
4. 讀原始碼字串的測試：逐功能換成行為測試，跟各批重構一起做；樣式守門等合理的靜態規則保留。
5. 前端 `App`（`main.jsx` 約 1,740 行）：先拆設定視窗，再拆右側呈現；跨聊天室的非同步防護（`navigationId`、`previewRequest`、來源 threadId、逐房操作鎖）不合併。

另列待本人決定：切換供應商的阻擋條件是 `settled:false` 或 `running／starting／pending`，`unresolved` 本身不在其中；`unresolved` 搭配 `settled:false` 仍會擋，差別只在 `settled` 不是 `false` 的紀錄。分支與移動工作區的同類判斷則有列 `unresolved`。補上會改變行為（這類舊工單可能擋住切換），未在本批處理。
10-17 更正：本人指出聊天室本來就綁定供應商、不能切換。查證：這段只在打開聊天室時決定啟動哪一家引擎，而 `conversation-controller` 每次打開都建立新的空白引擎（同一聊天室重開也是同一家），碰不到工人；此項取消，不改。

## 第一批：工人狀態共用、移除重複的工作區包裝

### 修改
- 新增 `src/worker-status.mjs`：`workerEnded`（`settled:true` 優先；`settled:false` 一律不算結束；結束狀態含讀取相容的 `canceled`）與 `workerMayBeLive`（`settled:false`、`running/starting/pending/unresolved`、或未證明結束）。
- `src/completion-attention.mjs`、`src/conversation-controller.mjs`（工人摘要、工人明細、閒置釋放前後兩次檢查）改用共用判斷；閒置釋放在瀏覽器檢查前後各讀一次工人的設計保留。
- `frontend/work-status.mjs` 的 `workerEnded` 改用共用判斷，另保留 UI 摘要狀態 `ended`（只在畫面認列，不擴張後端釋放條件）。
- 刪除 5 處 `Array.isArray(result) ? result : result?.workers` 相容寫法：三家 controller 與所有測試假件的 `workers()` 都回傳陣列。
- `src/isolated-desktop.mjs`：拆成 `restrictMove`（只包移動）與 `restrictWorkspace`（選擇＋移動）；聊天室路由層只套 `restrictMove`，provider 層照舊套 `restrictWorkspace`。
- 測試：新增 `test/worker-status.test.mjs`（兩種取消拼字、`failed + settled:false`、未知狀態、`running + settled:true`、UI 的 `ended`）；`test/isolated-desktop.test.mjs` 補「直接選 state 目錄被拒」。

### 驗證
- 基準（同一工作樹、未建置 UI）：`npm test` 1705 項，2 項失敗，皆因工作樹沒有 `dist-ui`。
- 修改後：受影響的 6 個測試檔 92 項全過；`npm run build:ui` 後 `npm test` 1707 項全過（多的 2 項是新測試）；`npm run test:ui` 48/48 通過（工作樹的 `node_modules`、`.runtime/playwright-browsers` 以 junction 指向主樹，只讀使用）。

### 複查與部署
- Astra 複查「同意」（提交 `2941297`）：逐處核對與原條件等價，另以 128 組狀態、2,688 次比較對照基準原判斷式零差異；三家 `workers()` 回傳契約支持直接刪除相容寫法（原盤點建議的 helper 不需要）；選擇、新建／重開、內部接續都經 provider 層登記檢查，移動預檢仍在載入聊天室之前。它在自己的 scratch 副本另跑 3 項邊界測試（state 目錄 junction 別名、三家保存對話的未登記工作區、未載入聊天室的非法移動目的地）全過；這些測試未加入本 repo。
- 採納的文件補正：切換供應商與 `unresolved` 的說法收窄（見上）；補 `development-log.md` 索引。
- 部署：本批與第 5 項後續批次一起，待 K 完全停止後在 K 外執行 `Update-K.ps1`，由本人安排；合回 main 不等於正式 K 已更新。
- 已合回 main 並 push：`2941297`（程式）、`9ee63a3`（紀錄）。

## 第二批：三個本機 MCP gateway 共用 HTTP 前門（拓樸不變）

### 修改
- 新增 `src/mcp-http-guard.mjs`：`admitMcpRequest`（來源必須是 loopback、Host 必須是本 gateway、Origin 若有必須同源、Bearer 以 `timingSafeEqual` 比對、只收 `POST /mcp`；不符就回 403／401／404／405 並回 `false`）、`readLimitedBody`（1 MiB 上限）、`bearerMatches`。
- `src/browser-owner-gateway.mjs`、`src/external-browser-gateway.mjs`、`src/luna-gateway.mjs` 改用它，刪除三份 Bearer 比對、兩份 body 讀取迴圈與三段逐字相同的前門檢查。
- 統一後的兩處小差異（無測試依賴）：Luna gateway 通過 403 之後的回應預設帶 `Cache-Control: no-store`（SDK 串流回應仍會覆寫成自己的設定，403／503 沒有）；瀏覽器 gateway 的 401 也帶 `WWW-Authenticate: Bearer`。
- 各 gateway 的關閉中 503、請求 ID、取消、串流與錯誤回應都留在原處，未合併；外層轉送內層的 HTTP 拓樸不變（第三批才處理）。
- 新增 `test/mcp-http-guard.test.mjs`：loopback／IPv4-mapped／外部位址、錯 Host、外來 Origin、錯或缺 Bearer、錯路徑、非 POST、尚未 listen 時 Host 未定、body 上限。

### 驗證
- 實作中一度把 browser-owner-gateway 後面轉送用的 `body` 變數省掉，既有 `browser-owner-gateway` 測試立刻以 400 失敗抓出，已改回。
- 受影響 7 個測試檔 52 項全過；`npm test` 1710 項全過（多的 3 項是新測試）。介面未改，不需 UI 建置與 UI 測試。

### 複查與部署
- Astra 複查「同意」（提交 `d20503f`）：順序仍是 503 → 位址／Host／Origin 403 → Bearer 401 → 路徑 404 → 方法 405，全部通過才讀 body；排除上述 header 差異，新舊版 16,200 組條件比較一致。兩個瀏覽器 gateway 的取消仍掛在 `res.close`，body 未讀完就斷線時三個 gateway 新舊版都不進後續處理。它在自己的 scratch 另跑 6 項邊界測試（錯誤優先序、未讀完 body 即拒絕、實際 1 MiB 邊界、讀取中斷、初始化時序）全過，未加入本 repo。
- 採納的收窄：新測試名稱改為「尚未知道 host 時，帶 Host 的請求被拒」（缺 Host 又缺 Origin 的請求在 listen 前新舊版都會通過，但 host 在接受連線前就已設定，實測 listening 當下連線為 403，屬不可達狀態）；`no-store` 的適用範圍如上。
- 部署同第一批，由本人安排。

## 部署狀態

- 第一、二批已隨他房的正式更新上線：南區 `.local/runtime.json` 於 10-17 為 `c815753`，之後再更新到 `a81475f`；兩者都包含 `2941297`、`d20503f`（以 `git merge-base --is-ancestor` 核對）。本批沒有另外部署。

## 10-17 本人決定（原話）

- 前端拆分：「做」。
- 瀏覽器兩層合一：「這是小事 你額度夠是100美金的」、「這塊模仿CODEX APP或是CLAUDE CODE或是其他開源不就好了?」。
- 瀏覽器需求：「我所知道的瀏覽器控制,就只是AI直接控制Crop,然後是在背景控制的,所以它不會影響到我做其他事情……我觀察它在做什麼,我做別的事,就是把瀏覽器縮小,我也可以做我自己的事。這才是我最需要的功能,而Computer Use,直接介入電腦,然後前端,然後控制我的滑鼠,那又是另外的功能,其實這兩個功能最好都有……只有Crop也是暫時是沒有問題……我並沒有要那麼複雜,我其實控制瀏覽器的,控制Crop的功能,只要像Codex App或是Cloud Code這樣就行。」（「Crop」為語音聽寫，指 Chrome。）
- 據此，瀏覽器整理以「AI 在背景控制 K Chrome、不搶滑鼠」為準；舊的人類接手／交還機制（內嵌瀏覽器時代留下，目前畫面沒有任何入口，只有測試與驗證腳本呼叫）在兩層合一時移除，不重做。Computer Use 列為之後的新功能，不在本項。本人隨後補充：「這個好像是computer use的功能。因為computer use是AI接手整個電腦。那我按ESC才會跳出讓AI不要再去控制電腦。所以我說的這個應該是computer use的功能,而不是控制Chrome的功能。」因此 Chrome 控制不另加 Esc 停手；Esc 停手屬於日後 Computer Use 的需求。本人再確認：「控制Chrome好像不需要什麼我接手還是AI接手之類的,全程AI接手就行啊,因為它是在背景控制,所以人是可以在控制別的東西的,所以如果我想要叫AI停,或是換我接手,那我直接在那個聊天室直接跟AI搶不就好了。」設計定案：Chrome 全程由 AI 在背景控制；要 AI 停手，用聊天室的停止鍵或直接傳訊息，停止會經 MCP 標準取消送到瀏覽器動作；人要自己用 Chrome 隨時可以直接操作，不設人類接手模式。

## 第三批：設定視窗拆出 `main.jsx`

### 修改
- 新增 `frontend/settings-dialog.jsx`：設定視窗原樣搬出（帳號連接、核心更新、介面外觀、討論 API、可讀性、已封存、附件說明、停止後端／遠端登出）。
- `frontend/main.jsx`：改用 `<SettingsDialog>`；開啟額度、封存管理、遠端登出、停止後端這些會離開視窗或改變 App 狀態的動作，仍在 App 內以 callback 傳入。移除只剩設定視窗使用的 4 個 import 與 3 個圖示（`main.jsx` 2,640 → 約 2,553 行）。
- 不改畫面文字、按鈕、順序或行為。

### 驗證
- `npm run build:ui` 成功；`npm test` 1739 項全過。`npm run test:ui` 47/48：`long-user-text-ui-probe`（長訊息收合後焦點位置）在整輪中失敗一次，單獨重跑 2 次皆通過；該 probe 不開設定視窗，判斷為整輪負載下的時序偶發，與本批無關，列為待觀察。會實際打開設定視窗的 probe（core-updates、gemini-accounts、discussion-api-settings、mobile-remote、modal-focus、completion-attention 等）全過。

### 複查與部署
- GPT-6.1 Sol 驗收「同意」（提交 `36cc5f1`）：人工比對並把新元件的 props／callback 代回原 JSX 做結構比對，文字、順序、className、aria、條件分支一致；封存先清空訊息、遠端登出後導頁、停止後端後關閉並標記離線都保留；沒有遺失或多餘的 import。它在自己的工作槽建置候選版與拆分前的 `9bc0d74`，6 支會開設定視窗的 probe 全過；`long-user-text-ui-probe` 候選版與拆分前各重跑 5 次全過，同意「偶發、無本批回歸證據」，但整輪負載是原因尚未證實。
- 部署：與後續批次一起，由本人在 K 外更新。

## 第四批：瀏覽器兩層合一、移除人類接手

依上方 10-17 本人決定：Chrome 全程由 AI 在背景控制，要停用聊天室，人要用 Chrome 直接操作，不設接手模式。

### 修改
- 兩層合一：模型連的外層 `external-browser-gateway`（loopback HTTP＋Bearer）原本再用 HTTP 轉送給同一程序內的子 gateway，子 gateway 自己又開一個 loopback listener、token 與 `live.json`。現在 `createBrowserOwnerGateway` 只回傳 `{request, getState, close}`，外層直接呼叫 `request(message, signal)`，交給 SDK 的 `WebStandardStreamableHTTPServerTransport.handleRequest`；第二個 listener、token、`live.json` 都不再存在。
- 移除人類接手：`browser-live-session` 刪掉 human／ai 模式、人類點擊鍵入、`/frame` 截圖、`/download`、`onControlChange`、分頁標題與瀏覽紀錄（約 440 → 230 行）；保留下載落地（UUID 資料夾、Zone.Identifier）、`reloadPageAtIndex`、`openDataPage`、AI 呼叫計數與 fail-closed。這些都是內嵌瀏覽器時代留下的，畫面早已沒有入口。
- `desktop-server` 只留 `/api/browser/state`（右側面板顯示一般／無痕、「AI 正在操作 Chrome」與錯誤），刪除 frame／download／action 路由與遠端白名單的 download；`owner-browser-registry` 只接受 `/state`。刪除 `src/browser-live-proxy.mjs`、`shared/browser-downloads.mjs`。
- 換工作區與閒置釋放：原本要「瀏覽器在 AI 模式且閒置」，改為「瀏覽器閒置」；錯誤文字「瀏覽器接手」改為「瀏覽器操作」。
- 模型看到的工具說明：拿掉 resize／evaluate／tabs 描述裡「右側檢視」「K 面板分頁」的補述；拒絕原因改為 `browser session is unavailable.`。
- 分頁標題修補（用面板記錄的標題改寫 `browser_tabs` 清單）的資料來源已隨面板移除，變成不做事的程式，連同兩項假件測試刪除；模型看到 Playwright MCP 原生的分頁標題。未使用的 `BROWSER_LIVE_VIEWPORT` 匯出一併刪除。
- 測試：browser-live-session、browser-owner-gateway（真 Edge）、external-browser-gateway 等改寫；只測人類接手、截圖、下載路由與標題修補的測試移除；`scripts/verify-k-browser-assistant.mjs` 拿掉接手步驟。

### 取消（Fable、Sol 都指出的退化，已修）
- 舊拓樸裡，模型取消時外層中止 HTTP 請求，內層串流隨即結束。合一後第一版只把 MCP 取消通知交給 SDK；被取消的呼叫不會有回應，SDK 串流不結束，外層要等 120 秒工具逾時才放開「忙碌」，期間也不能切換一般／無痕。
- 修正：子 gateway 在中止時只送一次 `notifications/cancelled`，並立即讓回傳的資料流以錯誤結束，外層隨即釋放。SDK 在 `handleRequest` 回傳前就已把訊息交給伺服器，所以回傳後才掛的取消一定找得到那個呼叫。
- Sol 另外實測出：`browser_session` 啟動中被取消（或逾時、斷線）時，外層排程佇列被卡住，之後連 `ping` 都不回。原因相同，同一修正解決。
- 新增端對端測試（真 Edge）：經外層送取消後，原請求立刻結束、忙碌在 10 秒內放開並標示需重新連線；`browser_session` 啟動中被取消後，下一個 `ping` 在 10 秒內回應、沒有選定任何模式。把子 gateway 換回修正前版本時，這兩項與子 gateway 的中止測試都卡到逾時；修正後通過。
- 取消後的既有設計不變：Playwright 工具可能不理會取消，所以 K 關閉整個瀏覽器連線後才放開；之後要重新開啟對話才再連線，先前操作不會重送。

### 重複請求 ID（Sol 指出的退化，已修）
- 外層收到「同一 ID 仍在執行」的重複請求時回 409，但它的收尾仍把該 ID 從佔用清單移除，第三次同 ID 就會被放行、與原請求同時執行（Sol 實測新版 200／409／200，父版 200／409／409）。父版是靠舊的內層 HTTP gateway 自己的 ID 檢查擋住；合一後只剩外層。
- 修正：只有實際登記該 ID 的請求能在結束時釋放它（`3d88c93`）。測試補「進行中連送兩次同 ID 都回 409、原請求正常完成且不再忙碌、結束後 ID 可再用」；在修正前程式上第二次回 200 而失敗。

### 驗證
- 受影響的瀏覽器測試檔全過；`3d88c93` 上 `npm run build:ui` 成功、`npm test` 1732 項全過。
- `npm run test:ui` 第一輪 46/48：`discussion-ui-probe`（討論結束後下一輪回到一般對話）與 `notice-lifecycle-ui-probe` 失敗。查得當時 Sol 在隔離槽同時跑整套 UI probe（UI probe 用固定連接埠、不能並行，`notice-lifecycle` 固定 5194 埠）；等 Sol 那輪結束後單獨重跑兩支皆通過，兩支都不碰瀏覽器程式，判斷為兩套同時執行互相干擾。
- 確認沒有其他 probe 在跑之後單獨整輪：47/48，`mobile-remote-ui-probe` 失敗一次（整輪只留第一行 `The expression evaluated to a falsy value`，看不到是哪個斷言）。隨後單獨跑 1 次、連跑 6 次，7/7 通過。該 probe 的聊天室沒有啟用瀏覽器，本批改的閒置／移動前瀏覽器檢查只在啟用瀏覽器時執行，遠端白名單只少了已刪除的 download 路由；判斷為偶發、與本批無關，未改測試，列為待觀察（同 `long-user-text-ui-probe`、Sol 首輪的 `model-picker`，整輪偶發的根因都尚未確定）。

### 複查與部署
- Fable 5.1 唯讀第二審（`7a04aa8`）：P2 取消退化（上述）；P3 取消通知可能送兩次、標題修補失效、`BROWSER_LIVE_VIEWPORT` 未使用、缺 409 與「取消中」測試。全部採納，修在 `30e6ef6`（rebase 到 `14dc1fc` 後；原 `7a04aa8` 變為 `12ed059`）。
- GPT-6.1 Sol 驗收（`7a04aa8`）：「不同意」合併，兩項 P1——取消不結束回應串流（含啟動中取消卡住佇列）、重複 ID 覆寫執行中的請求；並指出原取消測試拿掉了「回應要結束」的斷言、重複 ID 測試被刪，所以整輪測試沒抓到。它在隔離工作槽跑 `7a04aa8`：`npm test` 1731／1731、`test:ui` 48／48，並與父版對照重現兩項問題；也核對 scripts、手機／遠端入口、三家控制器沒有使用被刪介面的呼叫，工具過濾、檔案路徑限制、下載位置、UUID 資料夾、Zone 標記、`run_code_unsafe` 拒絕都還在。兩項都採納，修在 `30e6ef6`、`3d88c93`。
- Sol 複驗（`3d88c93`）：「同意」合回 main。用上次的重現腳本重跑：取消後回應結束、busy 解除；啟動中取消／逾時／斷線後下一個 ping 都完成；同 ID 三連送 200／409／409，與父版 `14dc1fc` 一致。補查：正常讀完後再 abort 不誤取消；消費端取消加 abort 只送一次取消通知；`initialize`、`tools/list` 被中止不會誤關瀏覽器；內部暖啟動 ID 會正確取消；串流讀取錯誤會傳回呼叫端。`ended`、`registered` 都必要，刪掉身分比對與標題修補合理，沒有要再加的防護。SDK 取消後在 `_requestToStreamMapping` 留 1 筆，隨該 gateway 存活、不卡串流或佇列，不為此操作 SDK 私有欄位。它的隔離槽：`npm run build:ui` 通過、`npm test` 1732／1732；`test:ui` 首輪 45／48（兩支啟動時固定埠被佔用，與我這邊同時跑有關；一支 `model-picker` 手機尺寸未找到主模型選單，候選版與 `14dc1fc` 單跑都通過 6 種尺寸 102 項檢查，根因未確定），第二輪完整 48／48。未驗：正式 K、實際 Chrome 擴充與三家原生停止入口整條路徑、永久不返回的啟動／關閉、長期記憶體壓力。報告在 `D:\scratch\general\jobs\20261017-091803_d42ab1c6\logs\sol-browser-reacceptance.md`。
- 已合回 main 並 push（遠端讀回 `a9e6a7c`）：`12ed059`、`30e6ef6`、`3d88c93`（程式）、`a9e6a7c`（紀錄）。
- 部署：與第三批一起，由本人在 K 外更新；合回 main 不等於正式 K 已更新。更新後請本人實測一次：叫 AI 用瀏覽器做事，中途按停止，確認停下且右側不再顯示「AI 正在操作 Chrome」。
