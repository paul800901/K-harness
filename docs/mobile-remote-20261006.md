# K 手機遠端控制層：候選實作與驗證（2026-10-06）

## 結論與範圍

**已套用南區正式 K，程式版本 `c8127f92822161661439606232822a74c4b8cc46`；正常重開、私人 HTTPS 登入、既有17間聊天室及 SSE 讀回通過，程式已推 GitHub 並精確核對。** 來源／乾淨候選各865/865，手機整合真正 Opus 複查問題已補修並通過補查。原私人網址及個人金鑰沿用，未開 Funnel。先前 Samsung Chrome 假資料登入、送出、串流與完成已驗；本次正式部署後 Samsung 再登入、主畫面獨立啟動及完整離家實機驗收仍待本人操作。直接操作手機的工具呼叫先前被 policy 拒絕，不再重試或改入口繞過。最新部署見第 11 節；前段紀錄保留各自階段邊界。

工程工作樹：`C:\Users\Paulus\.codex\worktrees\k-mobile-remote\K-harness`，初始基底 `d88d1481dba2b834191473f4bf86942ff67eff39`；本輪已整合新版正式程式 `4201a285d48ee32a57313e4d73afafa4a3d74191` 及其文件收尾 `07f057661bc688437fa1a171af75301ed9a4987e`。驗證產物保留於 `.runtime/mobile-remote/`、`.runtime/mobile-connect/`（Git 排除）；固定程式 c8127f9 與本次文件收尾 commit 分開，不因文件較新宣稱已重新部署。

## 1. 先確認 current，不把 cwd 或歷史文件當正式真值

- 起始 `D:\K-harness` 是舊 `main/56bb038` 且有既有未提交修改，未覆蓋。
- `.local/runtime.json` 指向正式版本 `d88d148`；執行中 supervisor／Electron 所在 runtime 為 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\trusted-runtime`。此路徑的 sandboxie 名稱是歷史名稱，不代表現在仍以 Sandboxie 執行。
- 讀取目前入口、Electron owner、desktop-server、React、state-stream、conversation/unified controllers、README 與適用 AGENTS。正式 `src/frontend/shared`、套件及 Vite 設定對 Git `d88d148` 的文字內容（僅正規化換行）一致。
- 另一來源工作樹 `modal-focus-fix/K-harness` 已到 `76e8fa2`，含尚未部署的其他變更；本候選沒有混入。本次使用其既有 node_modules junction，不安裝或升級相依。
- 目前正式官方核心檔：Codex 0.160.0、Claude 2.1.289、Antigravity 1.2.17。依 selected-cores 指定路徑讀回，不以旧 README 版本推論。

## 2. 原本已有什麼／真正阻擋

已確認既有 React 使用相對 `/api/...`；HTTP 控制、SSE snapshot/patch/message append、背景 conversation controllers、三原生 unified controller 都已存在。沒有新建第二套 session、adapter、資料庫、Agent gateway 或 WebSocket。

直接阻擋只有：

1. 正確的 local-only 入口（127.0.0.1、精確 Host/Origin、k_session、60 秒一次性 bootstrap）不能直接當手機入口。
2. 原三欄、桌面輸入與面板行為不適合窄螢幕／鍵盤。
3. Android 暫停／重新連線必須讀 current snapshot，不能把未知送出結果重播。

採一個額外 **loopback-only listener**，共用原 request handler 與同一 controller。未放寬 local listener。外部連線規劃用 Tailscale Serve 的私人 HTTPS，不使用 Funnel；官方 Serve 與 Funnel 的私人／公開差異見 [Tailscale 文件](https://tailscale.com/docs/features/tailscale-serve)。

## 3. 修改點與機制

| 檔案 | 本批差異 |
|---|---|
| `src/desktop-server.mjs` | 同一 handler/controller 增加可選 remote listener、登入／登出、路由限制與 SSE 撤銷；現有 local bootstrap 不變；remote 設定錯誤／port 被占用只停 remote，不阻止桌面啟動 |
| `src/remote-access.mjs` | 精確 Serve origin／本人 login、隨機存取金鑰雜湊、獨立 cookie、撤銷與限定 API；不是原生供應商登入或多使用者帳號系統 |
| `scripts/configure-remote.mjs` | 明確指定 state root 的本機設定、rotate／revoke；不安裝或設定 Tailscale、不啟動 K |
| `frontend/main.jsx` | 共用 UI 加窄螢幕 drawer／成果頁、前景讀回、mobile Back、連線狀態；unknown-result 不重送；遠端隱藏 OS 登入／更新／關機及本機聽寫 |
| `frontend/state-connection.mjs` | 每條 SSE 必須先收 snapshot；丟棄舊 stream callback；remote 背景化關閉唯讀 stream，桌面保持背景 stream；online／前景只重新讀取 |
| `frontend/mobile.css` | 單欄、safe-area、visualViewport 高度、44px 觸控目標、長文捲動／code block 橫捲、輸入區與 modal 尺寸 |
| `frontend/model-picker.jsx` | 遠端不顯示 OS 帳號設定；保留三原生模型清單及 Claude 已登入訂閱檢查（僅必要旗標） |
| `frontend/index.html`、`frontend/public/manifest.webmanifest`、`frontend/public/icons/*` | 主畫面／standalone manifest、既有 K 標誌 192／512 icon、Android viewport；沒有 service worker 或離線內容快取 |
| `test/remote-access.test.mjs`、`test/state-connection.test.mjs`、`test/remote-login.test.mjs` | 身分／cookie／原生邊界／撤銷、唯讀恢復及登入失敗呈現／貼上空白處理測試 |
| `test/mobile-remote-ui-probe.mjs`、`test/mobile-native-probe.mjs` | 明確另行執行的 HTTPS 瀏覽器／原生訂閱假資料 probe，不放入自動模型呼叫迴圈 |
| 本文件、`README.md`、`docs/development-log.md` | 候選與正式狀態、證據與未完成事項 |

manifest 不需要為安裝而新增空 service worker：[Chrome 官方說明](https://developer.chrome.com/blog/update-install-criteria)指出 Android Chrome 108 起選單安裝不再要求帶 fetch handler 的 service worker。本機 manifest／icon 已讀回，但不據此宣稱 Samsung 已安裝成功。

## 4. 對話、權限與瀏覽器邊界

- **shared active projection 保留。** 手機開 B，桌面也顯示 B；符合本人離桌接手用途。不做 per-client projection。
- send／answer／stop／附件等命令仍帶明確 threadId，交給現有 controller；不是依送達當下 active 猜目標。原 model/provider/workspace/accessMode/native session／核准語意不改。
- 遠端可以沿用已有的專案／聊天室管理 API，包括改名、封存、移動及既有確認刪除流程；沒有新增任意檔案存取 API。OS picker／帳號登入／核心更新／shutdown／Chrome 手動控制由 server 拒絕。
- BrowserPanel 原本就只讀電腦外部 Chrome 狀態；此版本沒有 `browser/frame` 請求，沒有 Windows 畫面串流、CAPTCHA 或登入遠端接手。
- 窄螢幕 Enter 插入換行，按送出才送；手機使用 Android 鍵盤本身的注音／語音輸入。K 桌面本機聽寫不對 remote 開放。
- 手機 Back 在 drawer／成果頁／本批 modal 開啟時返回聊天；modal 覆蓋 drawer 時 Back 一次關閉整組浮層，不另建複雜 navigation stack。

## 5. 遠端安全入口（尚未在正式 K 啟用）

預設無 `.local/remote-access.json` 就沒有 remote listener。啟用時：

1. remote 也只 bind 127.0.0.1。只接受設定的完整 `https://<machine>.<tailnet>.ts.net[:port]` Host；Origin 若存在須完全相同，所有 POST 強制 Origin + X-K-Request。
2. 必須有精確 `Tailscale-User-Login`，拒絕 Funnel header。官方 Serve 會移除外來偽造身分 headers；[官方原始碼](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go)也保留原始 Host。這是文件／程式核對，**不是此機實測 Serve**。
3. 本人 tailnet login 仍須另有 K 隨機 256-bit 金鑰；設定只存 SHA-256 雜湊。登入後發獨立 `__Host-k_remote`，Secure／HttpOnly／SameSite=Strict／Path=/，七天到期，server 記憶體 session。原生登入憑證不傳手機。
4. local k_session 與 remote cookie 不能互用。bootstrap、health、OS 帳號與管理 routes 不對 remote 開放。
5. logout 撤銷該 cookie；rotate 使舊 key/cookie 全失效；revoke 停全部 remote 授權。新請求立即拒絕，既有 SSE 最遲下一個 20 秒心跳結束。撤銷不停止電腦原生工作。
6. K 重啟後 session 不保留，須重新輸入同一 key；key 不在 URL／localStorage，沒有配對資料庫。外部連結的首次導航因 Strict cookie 可能先顯示登入頁。
7. local OS 程序仍屬既有可信邊界；不能把此設計宣稱為防惡意本機程序的 OS 隔離。各人裝置仍應由 tailnet ACL／裝置撤銷管理；K key 是額外能力，而不是「任何 tailnet 成員永久全權」。

### 接入步驟（後續已取得完成接入授權，登入仍由本人操作）

Windows／Samsung 已由本人登入同一私人 tailnet，HTTPS 已啟用；獨立假資料候選先使用 8443→54832，正式 K 的以下設定仍未執行：

```powershell
node scripts/configure-remote.mjs --root '<候選 state root 絕對路徑>' --origin 'https://<本人裝置>.<tailnet>.ts.net' --login '<本人 Tailscale Login>' --port 47832
# 本機只顯示一次新 K key；不要貼到 chat／Git，勿使用原生帳號密碼。
# K 候選下次完整啟動後，再由 Tailscale Serve 私人代理該 loopback port。
tailscale serve --bg http://127.0.0.1:47832
```

確切 Serve 用法以已安裝版 [官方 CLI 文件](https://tailscale.com/docs/reference/tailscale-cli/serve)核對；不使用 `tailscale funnel`。若有既有 Serve 設定先讀回，不覆蓋其他服務。撤銷範例：

```powershell
node scripts/configure-remote.mjs --root '<相同 state root>' --revoke
# 重建 key 必須明確 --rotate，並重新提供 origin／login／port。
```

設定 root 是 K 資料的 state root，不是安裝根目錄或程式目錄。正式 state root 已由 launcher 核對為 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\private-state`；後續讀回確認該處沒有 remote-access.json。第一階段只完成候選，後续使用者已授權完成接入，但仍須真實驗收、確認工作停止及保留退版，不能強制中斷工作。

## 6. 驗證證據與失敗紀錄

### HTTP／React 瀏覽器

- 使用真實 desktop-server、HTTPS reverse proxy、Playwright 控制既有 Chrome headless，Samsung UA、412×915、touch／DPR2；不是 Samsung 硬體或實際 Tailscale。自簽證書及 `ignoreHTTPSErrors` **僅測試 context**，不加入信任庫、不用於產品。
- 三供應商假 controller 各既有／新聊天室共六間；desktop bootstrap 開啟第二頁同步跟隨。手機正常三次 send（含一則既有待送）加一次回應遺失 send、桌面另一次 send，串流、Stop、核准／拒絕／提問、附件上傳／下載、artifact 下載皆經真實 HTTP／SSE。
- 關掉手機 page 時假工作仍 busy；server 完成後重開讀到原 thread 的新狀態，send 計數沒有增加。離線／上線同樣不增加；沒有自動 resend。
- 開著成果面板時 status／snapshot 更新不關閉；Back 關閉 drawer/modal。360×440 模擬鍵盤高度輸入框仍可見；長回覆50段及長 code 橫捲，page 無水平溢位。無 pageerror。截圖人工讀圖檢查。
- 初次 probe 的 offline 偵測未通過（SSE 連線未立即報錯），已接 browser offline 關閉唯讀 stream，後續完整 probe 通過。保留初次 failure 與後續紀錄，不將失敗藏掉。
- 初次完整測試 843/845：兩項本批 CSS token/字體規則失敗，改用既有設計 tokens 後修復。第二次 845/846：既有 `ui-message-timing` 的 40ms 等待未等到檔案寫入；該檔未修改，定向重驗通過（含 mobile/style 共11/11）。第三次完整回歸 848/848 通過；後續真瀏覽器 unknown-result 補測發現下述 transport 重試，修正後再次執行完整回歸，見下方最終數字。

### 已觀察到的 transport 重複：必要的最小修正

在新補測中，proxy 先讓 controller 接到 send，接著在任何 response header 前斷 socket。未修正版 Chromium 實際向 backend 送了兩次相同 POST，第二次進入既有待送佇列；不是 K reconnect 邏輯呼叫 send。這使「前端沒有 retry」不足以保證未知結果不重播。

[Chromium 官方 ShouldResendRequest 原始碼](https://chromium.googlesource.com/chromium/src/+/f0d01d5c/net/http/http_network_transaction.cc)顯示 reused connection 且還未收到 response headers 會重送。依此實測新增 **remote 每次 human POST 的 X-K-Command 請求 ID**；server 在已驗證的 cookie session 中只記 ID Set，第二次相同 ID 回409／unknown-result，不再呼叫 controller、不快取結果、不自動查詢／重播。Set 隨 session 到期／登出／server重啟失效；重啟後舊 cookie 也無法授權，因此不需要 durable ledger／第二資料庫。本機介面不改成強制此 header。

修正後同一 HTTPS 斷回應測試：兩次 transport attempt 保持相同 ID，但 controller 只有一次 send；手機顯示「操作結果未確認」、保留草稿。重新載入讀到已接收的原訊息且 send 計數不增加。這是實測失敗所需的防重，不是 speculative hardening。UI probe 初次失敗記錄保留於 ui-run-final.txt／ui-failure.json，通過紀錄為 ui-run-dedupe-final.txt。

### 真原生 session（不是 fake provider）

使用現有官方訂閱執行檔與 K 專用登入環境、不讀／複製 token、不改計費；新建隔離假 workspace／K 記錄，不接正式聊天室。每家只有兩個簡短文字回合、無工具／目標／子代理。

| 核心 | 新建→送出→desktop 同 thread 讀回→controller/server 全關閉→原 thread resume→讀回前回合隨機標記 |
|---|---|
| Codex / GPT-6 Luna low，read-only | 通過；`01a10fe9-8b43-7171-907f-544816e2eff4`；原生 thread/start 一次、thread/resume 同 ID，turn/start 兩次 |
| Claude Opus 5.5 low，claude-plan | 通過；`claude-06d28594-a5af-4c25-843b-b79adeef5c0a`；相同原生 sessionId，resume false→true |
| Antigravity / Gemini | 本輪真原生流程未跑；正式 Electron 下仍有 agy 程序，不能確認憑證身分查詢／切換已停，未停止或接管它們。三核心 UI 假資料測試不算第三家原生驗收 |

### 安全／複查及最終狀態

- 最終 `npm run build:ui` 成功；`npm test` **848/848 通過**（34.34秒，`full-tests-accepted.txt`）。Build 保留既有大型 chunk 提示，未為此順手重構。
- 真 HTTP 拒絕無／錯身分、無／錯 cookie、跨 Origin、remote/local cookie 互用、禁用 routes；缺請求 ID 回400、相同 ID send／answer 重送回409且 controller 次數不增加。local POST 不要求新 header。
- rotate 舊 key/cookie 失效、新 key 成功；logout 失效；已開 SSE 在 revoke 後約20秒關閉；remote設定損壞／port被占用仍可 local bootstrap/state。Claude auth 假敏感欄位未透出。
- 本機 configure script 已於新假 state root 實跑 create／拒絕未指定rotate的覆寫／invalid保留原設定／rotate／revoke，設定只存hash，沒有列印金鑰到工程證據（`configure-result.json`）。
- 真正官方 Claude Opus 5.5 只讀複查三輪（非模擬、自稱或改供應商）：首查 `4e303dfb-4bc3-471e-9c11-82d373f42602`，指出成果面板自行關閉及desktop hidden SSE；已修並重驗。補查 `906b74ec-5f0e-4ad5-b00a-03e5582f6129`，指出 backdrop 關閉未同步狀態及文案，已修。最後 `e8fc2e7a-f547-476a-af92-1abe622d973c`，聚焦新 transport 防重及剩餘改點，未發現 P1/P2；沒有把這輪說成重新執行全測試或正式部署核准。主代理另行讀 diff、848項測試、UI／原生證據並驗收候選範圍。
- 第一階段收尾唯讀核對：正式版本仍 `d88d148`，108份相關程式／設定與基底內容一致，supervisor 27728／Electron 26616仍是原程序；`formal-source-readback.json` 留證。當時 remote config 檢查對象是安裝根目錄，不能作為正式 state root 的證據；第 8 節已更正並另查實際 state root。第一階段未操作正式 K 工作或憑證、未安裝／清理／push／部署。

證據：`.runtime/mobile-remote/ui-result.json`、`ui-run-dedupe-final.txt`、`mobile-*.png`、`desktop-regression.png`、`native-result.json`、`native-run.txt`、`full-tests-*.txt`、`opus-review/`、`opus-followup/`、`opus-final/`。測試憑證／key、原生診斷與帳號環境不加入 Git。

## 7. 尚未完成，不能升級為已驗收

- 真 Tailscale Serve／HTTPS／Host+identity headers 已由電腦端實際通過；Samsung Chrome 真實登入、送出一次「背景測試」、串流及第40段「測試完成」畫面均已取得，同一 user message 只有一次。手機已顯示完成狀態；僅憑截圖不能確定實際背景停留時間或 Doze。未另外修改 tailnet ACL，也未測另一個未授權 tailnet 身分；既有無 K cookie／錯 key／跨 Origin 拒絕已通過實際代理。
- Samsung Chrome／Samsung Internet 真實安裝到主畫面、獨立啟動、注音／語音鍵盤、Android navigation/safe-area、實際 file picker／download、Doze／鎖屏與 Wi-Fi→5G 未驗證。viewport 縮小與網路 offline 模擬不能替代這些。
- Gemini 真實同 session 接續待在不干擾正式帳號操作的時段補驗。
- 未測實際 Electron launcher 整套正式更新，未改正式 runtime；desktop 瀏覽器、本機 bootstrap、安全與原生 controller 已驗，不冒稱正式 K 已讀回新功能。
- 大型手機影片上傳仍沿用原 base64／記憶體路徑，本輪只驗小附件，沒有加新容量限制或傳輸框架。

刻意不做：K Cloud、relay、自建 NAT、QR／多使用者帳號、push／Android 背景服務、WebSocket、service worker／離線工作佇列、手機 terminal／editor／Git、遠端桌面、手機本地原生核心、專案全量同步、per-client active、失敗換模／自動重送。沒有新增人用的技術設定頁。

## 8. 本人追加授權與實機接入進度

使用者明確表示「我已連結手機，我全權授權你做好這件事」，並重申僅供個人使用。後續澄清「連結」是 USB 插上電腦並開啟 USB 偵錯，不是 Windows 手機連結，也不是已建立遠端私人網路。沒有新增 K 會員、Google/Apple 登入或多使用者平台；Tailscale 登入是建立本人裝置私人網路，不把原生模型帳號搬到手機。

- **Windows Tailscale 已安裝，未登入。** 官方 stable MSI 1.102.4 AMD64，官方 SHA-256 及 Authenticode Tailscale Inc. 簽章均核對，安裝 exit 0；程式版本读回 1.102.4。安裝包含其必要 Windows 服務／網路元件；沒有重開機。`status --json` 為 `NeedsLogin`，沒有啟用 Serve 或 Funnel。嘗試啟動登入的工具呼叫被 policy 拒絕、未執行；沒有改用別的入口繞過，已請本人從 Tailscale 開啟 Log in。證據在 `.runtime/mobile-connect/installer-verification.json`、`installation-result.json`、`tailscale-install.log`。
- **USB 尚未接通 ADB。** Windows 有正常的 SAMSUNG Mobile USB Composite Device 與 Modem，但沒有 Android ADB 裝置。既有 SDK ADB 36.0.0 清單為空；[官方修正紀錄](https://developer.android.com/tools/releases/platform-tools)列有 36.0.2 的 Samsung 偵測修正，因此另下載官方 37.0.1 到候選 `.runtime/mobile-connect/android-tools/`，不覆寫既有 SDK。只替換本輪新啟動且無裝置的暫時 ADB daemon，再查清單仍為空。此結果不證明手機沒開偵錯，也不證明線材／驅動故障；待本人解鎖、確認 USB 偵錯及允許此電腦，沒有自行關閉手機安全保護或安裝驅動。
- **正式 K 仍有工作。** 以 Computer Use 唯讀查看正式 K 視窗，當前聊天室顯示執行中、近期原生活動，另有待確認子代理；未切換對話、未停止或重啟。不能為接入或 Gemini 測試接管未知工作，也不將正式程式替換為候選。
- **state root 校正。** 實際 launcher 把 `vault/private-state` 傳給 startDesktop；已讀回此目錄存在且 `.local/remote-access.json` 不存在。未寫入正式設定。安裝 root 的同名檢查不再被當作正式 state root 證據。

目前需要本人的步驟只有裝置授權／官方登入；不能宣稱 Samsung 已接通、已安裝 K PWA、已完成 Wi-Fi／行動網路切換或已部署。

### 後續本人完成電腦登入與 USB 授權

本人提供 Tailscale Login successful 與 Windows connected 畫面，並確認 USB 偵錯已開。重新讀回：Windows `BackendState=Running`、本機 online；ADB 37.0.1 已列出 `SM_S9470`、狀態 `device`，Android 16，Windows Android ADB Interface 正常。這取代上一階段「NeedsLogin／ADB 清單為空」，但不等於手機私人網路已連線。

手機已有 Chrome 與 Samsung Internet，尚無 Tailscale 套件；已透過 USB 開啟官方 Google Play 的 `com.tailscale.ipn` 頁面，請本人安裝、登入與處理 Android VPN 同意。選官方建議的 Play 版本以保留正常更新，不另側載 APK 或修改安全設定。

正式 Serve 設定讀回為空。準備獨立假資料候選，僅 `127.0.0.1:54832`，預計 Tailscale HTTPS 8443；沒有正式聊天室、原生核心呼叫或資料接入。`tailscale serve --bg --https=8443 http://127.0.0.1:54832` 回覆 tailnet 尚未啟用 Serve，要求本人網頁同意 HTTPS。官方說明提醒同意頁可能預選 Funnel，因此必須只啟用私人 Serve／HTTPS、不要開啟 Funnel。沒有執行 Funnel，也沒有略過 HTTPS 憑證驗證。

為避免留下等待中的設定操作，已核對並停止本轮自建的假資料 node 程序及尚未完成的 Serve CLI 等待程序；確認 54832 listener 消失、Serve 設定仍為空。不停止 Tailscale 系統服務或正式 K。手機登入、HTTPS 同意完成後再啟動測試；不是已完成 Samsung PWA 驗收。假資料腳本與設定留於 `.runtime/mobile-connect/`，不入 Git。

### 本人完成手機登入，明確委託電腦 HTTPS 設定

使用者回覆手機已弄好，並針對私人 HTTPS／取消 Funnel 的指定步驟要求「這部分你控制電腦用吧」。實際讀回 Windows Running、手機 Android peer online、ADB device；正式版本仍為 d88d148。透過目前本人已登入的 Chrome 設定檔開啟官方 Serve 同意頁，先取消預設勾選的 Funnel，核對按鈕變為單純 Enable HTTPS，再啟用。頁面回覆 **Tailscale Serve is ready to use**，截圖 `.runtime/mobile-connect/tailscale-https-ready.png`。已向本人說明公開憑證紀錄包含裝置網域名稱；這不是公開 K 服務。

重開假資料候選（本輪 PID 16136，`127.0.0.1:54832`）。隨後將 Serve 啟動、狀態查詢、手機測試頁開啟及 USB Chrome 除錯轉送放在同一工具呼叫；該呼叫整體被 policy 拒絕，**沒有執行**，不可猜測是哪個子命令被拒絕或宣稱其他子命令已完成。後續只讀查詢仍是空 Serve 設定。未改用其他入口繞過拒絕；告知本人這是工具限制，不是缺少其授權。假資料候選暫留待接入，不接正式工作；尚未驗證 Samsung UI、真 Serve identity headers 或手機 PWA。

### 本人啟動代理後的真實私人網路驗證

本人提供 PowerShell 成功畫面。讀回 Serve 設定只有 HTTPS 8443，代理 `http://127.0.0.1:54832`，沒有 AllowFunnel／公開路由；node listener 仍只在 127.0.0.1，手機 peer online。`https://paulus.tail47adf4.ts.net:8443/` 使用正常公信 TLS 驗證回 200／K 登入頁，沒有自簽或忽略 HTTPS 錯誤。

由電腦經真正 Serve（不是假 proxy）驗證九項：無 cookie 的 state 403、錯 key 403、客戶端偽造 Tailscale-User-Login 被 Serve 取代、正確 key 200、登入後讀回 fake-room-1、跨 Origin POST 403、原生帳號 route 403、logout 200、舊 cookie 403。cookie 的 Secure／HttpOnly／SameSite=Strict 亦檢查。證據 `.runtime/mobile-connect/real-serve-security.json` 不含 key/cookie。電腦 Chrome 以同一真 HTTPS 登入候選成功，顯示「電腦 K 已連線」及假資料聊天室；畫面 `.runtime/mobile-connect/real-serve-k-connected.png`，不冒稱為 Samsung 畫面。

在本人手動啟用代理後，另嘗試僅開啟手機 Chrome 的 K 網址（不含 USB 除錯轉送）；工具再次明確 policy 拒絕、未執行。後續不再重試手機操作或用替代入口繞過，改請本人直接在手机 Chrome 開啟私人網址並提供畫面。這不是手機／K 出錯的證據，而是工程工具能力的限制；原生帳號及正式 K 不變。

### Samsung 已到登入頁，但登入失敗：訊息與貼上流程補修

本人提供 Samsung Chrome 實機畫面：私人網址已顯示 K 登入頁，送出金鑰後呈現舊版「無法連接或授權」通用錯誤。這證明手機至少已能開啟私人入口，但**不是已進入聊天室／PWA 驗收**。再次核對手機與電腦的 Tailscale UserID 相同、目前 key 雜湊與候選設定一致、PC 經真 Serve 登入成功。尚未取得當次手機 POST 的精確拒絕原因，不宣稱使用者貼錯或原失敗已修好。

已確認的直接缺陷是前端丟棄 server 的具體拒絕原因，把金鑰不符、身分／同源拒絕與網路中斷都寫成同一句話；另外先前交付整份 JSON 讓本人挑選 key，易多貼引號。最小補修只在 `src/remote-access.mjs`：翻譯既有固定錯誤字串；真正 fetch 失敗仍標示未確認結果；貼上時只去前後空白，保留 key 內容與引號拒絕；關閉手機輸入自動大寫／拼字修正並標明只貼金鑰本身。不新增帳號、QR、重試／備援，也不放寬任何 server 驗證。

候選原 key 與 state root 保持不變，提供 Git 排除的一行 key-only 本機檔；未在聊天／測試報告列出秘密。只讀核對假資料 controller 全部不忙、零 user send 後，僅重啟自己的假資料 node，未碰正式 K／Tailscale 服務。測試端加暫時性的 status／固定拒絕原因／Android UA 布林紀錄；不記請求 body、key、cookie，非產品永久 logger。終端 stdin 的 snapshot 呼叫被工具 policy 拒絕，未重試該終端输入；controller 狀態由原有已授權 HTTP 讀回。

驗證：定向 6/6、完整 **850/850**（34.44秒）；真正 Opus 5.5 聚焦複查 session `a825b642-6b4c-4c7a-abff-77dbb6e1c663`，無 P1/P2，已採納將電腦遠端設定變更納入錯誤文案的小修，最後文案後定向 2/2。真正 Tailscale HTTPS 的電腦 Chrome：故意帶引號回明確「金鑰不正確」；同一正確 key 前後多貼空白仍可登入。這是 PC 實測，不冒稱手機重試成功。證據：`.runtime/mobile-connect/login-fix-tests.txt`、`full-tests-login-fix.txt`、`opus-login/`、`phone-login-results.jsonl`、`login-fix-pc-success.png`。目前新診斷紀錄只有 PC 測試，待本人重新整理並重試一次；正式版本仍 d88d148。

### Samsung 真實登入與第一則串流（後續讀回）

本人提供 `37880.jpg`：Samsung Chrome 已進入 `fake-room-1` 假資料聊天室，畫面顯示「電腦 K 已連線」。測試端 `phone-login-results.jsonl` 在 2026-10-06 08:15:12.850 UTC 記錄 Android login status 200；08:16:02 UTC 的 `phone-state-after-login.json` 確認該房間 ready、零 user messages。這取代前段「待手機重試」狀態；先前失敗的精確原因仍未取得，不反推一定是使用者貼錯金鑰。

已請本人送出「背景測試」、回手機主畫面約30秒再切回。後續實機截圖 `Screenshot_20261006_161607_Chrome.jpg` 顯示串流第26至31段及停止按鈕，證明實機送出及串流已通；截圖本身沒有證明已離開／恢復或完成。08:17:57 UTC 經真正私人 HTTPS 唯讀查詢：同一 `fake-room-1` 為 completed、busy=false；user message `user-1`「背景測試」僅一筆（08:16:24.257 UTC），assistant 已到第40段且含「測試完成」，queued/questions 均0；三間假房皆 idle。證據 `.runtime/mobile-connect/phone-state-after-stream.json`。未代送或重播手機工作。

截圖的「尚無核心活動回報」來自本次假 controller 未供應原生活動紀錄，不能解讀為真實模型失敗；此測試沒有呼叫原生模型。仍待本人切回後看到完成結果，才能確認這次實機背景恢復。登入、串流及電腦完成不等於 PWA／行動網路／鎖屏、三原生核心或正式部署全部驗收。

後續本人提供 `Screenshot_20261006_161816_Chrome.jpg`：同一 Samsung Chrome 聊天室已顯示第40段及「測試完成。正式 K 工作未被操作。」；黃色工作中提示消失、停止按鈕恢復為空草稿的停用送出按鈕，長 code 區域有獨立橫向捲軸，未撐寬整頁。這補足手機完成畫面的實機證據，不再是只有 server 完成；截圖不獨立證明背景停留30秒、鎖屏或 Doze。已請本人保持 Tailscale 開啟、關閉 Wi-Fi 改用行動網路送出「行動網路測試」，結果待回報；沒有代送測試訊息。本次只更新工程紀錄，正式 runtime.json 讀回仍為 d88d148，未部署／重啟。

### 「行動網路測試」到達與完成讀回

使用者起初把測試字句送到工程對話；08:28:38 UTC 讀回假聊天室仍只有「背景測試」，因此請本人改到 K 頁面送出，未代送或自動重試。本人後續詢問「現在呢」時，08:32:12 UTC 真 HTTPS 讀回確認同一 `fake-room-1` 新增且僅有一筆 `user-2`「行動網路測試」（08:29:07.886 UTC／臺灣16:29:07）；對應 assistant 回覆含「測試完成」，status=completed、busy=false、queue=0。先前「背景測試」仍僅一筆，無新增房間。證據 `.runtime/mobile-connect/phone-state-after-cellular-request.json`。可確認這次請求已到達且完成、未見重複；伺服器讀回不獨立證明手機 Wi-Fi 已關閉，行動網路情境仍以本人當時實際網路設定為前提，不能將此紀錄當成 Doze／鎖屏驗收。正式 K 未動。

## 9. 繼續驗證與固定候選

本人要求「繼續」。正式 K 的唯讀 accessibility 讀回仍顯示小說翻譯處理中、最近原生活動5秒前及1個子代理待確認；沒有切換 OS 前景或代按停止。本人答覆「等等，我正在關」，因此保留正式工作，等其正常關閉；不能因當下沒有 agy 程序就宣稱帳號已可安全另測或正式 K 已停止。

- 重新完整回歸 **850/850**（34.87秒）及 UI build 通過，既有大型 bundle 提示保留；證據 `full-tests-pre-release.txt`、`build-pre-release.txt`。
- 原生 probe 加入明確選擇 `K_NATIVE_PROBE_PROVIDERS=gemini` 的路徑，預設仍只 Codex／Claude；只使用已選定的官方 Gemini 核心、新假資料 root、read-only 和兩個簡短回合，不接受帳號管理器、不讀／搬／切換憑證、不重送舊測試或換模型。
- 真正 Opus 首查 `bb4e4d0d-109f-418f-aecc-7fa0dc91b9c8` 指出測試可能誤過：持久化原生 ID 未必反映第二輪 CLI 回傳，以及 marker 可能被工具讀檔。已直接記錄真 CLI 事件流的 conversation ID，要求兩輪回傳同一 ID，並要求兩輪工具紀錄均為0；未修改產品 controller。
- 真正 Opus 補查 `dcc991cf-133f-4c6a-bb32-8ff88723cb83` 無 P1/P2。主代理核對測試沒有傳 accounts、原生 chunk 仍送原 parser、第二輪 prompt 沒有 marker。複查未執行實測；Gemini 必須在正式 K 停止後才跑。證據 `.runtime/mobile-connect/opus-native-gemini*/`。
- 以上是候選準備，不是 Gemini 實測通過、正式接入完成或 GitHub 發布。主畫面安裝、實際鍵盤／檔案選取等仍照第7節保留驗收邊界。

### 依本人要求準備完成後暫停

本人最新要求：「你這邊準備好就先停，等那邊更新完我再來開你這更新」。這取代接續套用的安排：本輪不再執行 Gemini 原生測試、正式停止／重開／部署或 push，等本人再次要求繼續。

- 手機程式候選已固定 **`4522f2472919484cf85fb43b7eac5e436b86426d`**，分支 `codex/mobile-remote-20261006`；以正式 d88d148 為基底，不含另一批尚在更新的變更。
- 由該 commit 的 Git archive 建立乾淨準備目錄 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\prepare-mobile-4522f24-20261006`。實體複製本機既有相依（不是 junction、未 npm install／升級），UI／擴充／啟動器建置通過；乾淨候選完整 **850/850**（35.93秒）。證據 `.runtime/mobile-connect/prepared-release.json`、`prepare-dependencies.txt`、`clean-*.txt`。`activated=false`。
- 暫停前只讀確認三個假房間全部 idle、無待確認，保存測試狀態；核對 PID 32120 的 node 腳本及 loopback 54832 所屬後停止本輪假資料服務，確認 listener 已關。未停止正式 K、未改 Tailscale Serve／服務或本人登入。手機測試網址此時暫無後端，不應把暫停後的連線錯誤當成產品回歸。證據 `phone-state-before-pause.json`、`pause-result.json`。
- **恢復時必先核對另一邊更新後的正式 commit 與差異，再整合本批手機改動並重驗。不得直接拿這份舊基底準備目錄覆蓋新版正式 K。** 再完成 Gemini 同原生 session 實測與剩餘實機驗收，才可依本人恢復授權安排正式接入。
- 此段是文件收尾；不因文件 commit 較新而宣稱程式已重建或部署。沒有變更原工作樹、推送、搬取原生憑證或操作正式翻譯目標。

## 9. 本人關閉後恢復：整合新版，最後複查待完成

使用者明確回覆「已經關了 修」。先核對正式 47831 已無 listener、K supervisor／Electron 已停止；正式版本已由另一批更新為 `4201a285d48ee32a57313e4d73afafa4a3d74191`。112 個正式來源／套件檔與該版本一致（文字僅正規化換行），證據 `.runtime/mobile-connect/formal-new-base-readback.json`。未操作既有翻譯目標或未確認工人。

### 整合與驗證

- 在本手機 worktree 合併 `07f057661bc688437fa1a171af75301ed9a4987e`（程式同 4201a28，額外只有文件）。手動處理 `frontend/main.jsx` 與工程索引衝突，保留新版受阻目標恢复、Codex 推理／Fast 選單、子代理明細、待命活動及安全關閉恢復；沒有以舊候選覆蓋新功能。原 `D:\K-harness` 未提交修改不動。
- 整合來源完整 **865/865**（34.20 秒）、Vite 建置通過；真 HTTPS 測試代理／React／HTTP／SSE 的完整手機與桌面 probe 通過，仍使用假 controller／假 Tailscale 身分，不冒充正式原生或 Samsung 實機。證據 `.runtime/mobile-connect/merged-tests.txt`、`merged-build.txt`、`merged-ui-run.txt`、`.runtime/mobile-remote/ui-result.json`。
- 追加新版 Codex 選單的手機衝突回歸：360×440 鍵盤等效視窗內可打開、完整顯示、選擇推理程度並關閉；Fast 維持標準，沒有送出工作；手機沒有電腦聽寫按鈕，桌面仍有。實際截圖 `mobile-codex-reasoning.png` 已目視。這不是 Samsung 真鍵盤／原生加速回合驗收；原生 Fast 語意沿用新版既有測試。

### Gemini 真原生接續

- 第一次限定唯讀測試在原生 eligibility 階段回官方 **UNAVAILABLE 503**，尚無 native session ID／模型 init，程序已結束。保存 `.runtime/mobile-remote/native-gemini-attempt1-failure.json` 及 `native-gemini-attempt1-run.txt`；不把啟動期間暫時的登入狀態判成需要重新登入。
- 核對正式及測試服務已停止、無殘留 agy 後，另建一個假資料測試根目錄，不重播未知工作；第二次兩個短回合成功。未換帳號、模型、權限或計費。使用正式已選定 Antigravity 1.2.17、`gemini-3.8-flash-low`、既有原生登入，未保存／切換或搬取憑證。
- 首回合產生驗證字串；關閉整個候選 server/controller，重新啟動並開啟同一個 K 對話後，第二回合不提供字串、要求回憶。兩次原生 stdout 都回同一 native conversation ID `4bea14b8-fe87-4fdf-b604-b655f059a3be`，驗證字串相同；兩回合工具計數均為 0。結果 `.runtime/mobile-remote/native-gemini-result.json`、`native-gemini-attempt2-run.txt`。Codex／Claude 同歷史驗證屬前段舊基底實測，這次沒有重跑。

### 尚未完成與停止位置

- 真正 Opus 5.5 的新版整合複查 session `a34b7ffc-25cf-4dbe-a516-2452caf6dda0` 回額度限制，顯示臺灣時間 **18:40** 恢復；證據 `.runtime/mobile-connect/opus-merged/`。這次沒有完成審查，不以舊基底多輪已通過或 Astra 自查替代；未換模型／帳號／API 路徑。
- 已詢問本人要保留候選等 Opus 可用，或明確允許本次 Astra 驗證先部署。截至本次紀錄尚無答覆，依既有 SOP 保留候選，不把未回答當成豁免；不設定自動排程、不承諾自行醒來。
- **本批仍未建立正式遠端設定、替换正式 runtime、重啟 K 或 push。** 正式版本仍 4201a28，測試服務關閉。舊 `prepare-mobile-4522f24-20261006` 只保留，不可部署；新版複查通過／本人明確變更條件後，才固定新 commit、建立新的乾淨部署包、再次核對停止狀態及執行正式讀回。

## 10. 額度恢復後的複查與修正

本人於臺灣 18:47 明確要求「47分了 做吧」，恢復正常複查與部署流程，並非豁免審查。

- 真正 Opus 5.5 session `aebf6107-dc4f-45cb-b3c6-ccf75366d268`：發現一項 P2，手機舊 CSS 隱藏 `.worker-activity`，合併新版後連同跨聊天室子代理明細入口一起隱藏。採納最小修正：保留入口、文字省略、手機 popup 固定於視窗內、同時涵蓋 681–700px；保留全部跨聊天室資料與既有安全邊界。
- 主代理實際目視後，再修標頭文字受擠與工具鈕獨占一列：子代理按鈕可縮並顯示省略號，工作狀態排下一列。未新增輪詢、路由、原生回合或管理設定。`frontend/mobile.css` 為唯一追加產品檔；`test/mobile-remote-ui-probe.mjs` 增加跨聊天室／久未回報／360×440 popup bounds／關閉實測。
- 真正 Opus 整合補查 session `e65d7c58-0ebd-4485-a2c2-edf4dfa2b279` 無 P1/P2；最後三條標頭 CSS 的聚焦複查 session `9ebcc8d9-83a8-4f40-8d93-1c60c41f38a0` 亦無 P1/P2。主代理核對 WorkStatus 直接子元素、空狀態不渲染，以及截圖後接受。官方訂閱、真 `claude-opus-5-5`；未換帳號、模型或 API 計費。
- 完整 HTTPS 手機／桌面 probe 通過並目視 `mobile-chat.png`、`mobile-worker-status.png`。首次最終全測 863/865：兩個既有測試在固定等待 40ms 後提前讀非同步狀態；未修改相關產品或測試，95/95 定向及全套重跑 **865/865**（48.78 秒）通過。保留兩次紀錄，不隱藏第一次失敗；證據 `final-tests.txt`、`final-targeted-rerun.txt`、`final-tests-rerun.txt`。
- 非阻擋限制保留：子代理小彈窗不攔 Android 返回鍵（可用關閉鈕或外點）；原生加速勾選框受手機觸控高度影響；Fast 待套用長標籤、極窄／放大顯示的裁切風險未完整實機驗證。沒有為此新增 overlay 狀態傳遞架構；正式原生核准與未知工作不重播不變。
- 複查證據 `.runtime/mobile-connect/opus-merged-after-reset/`、`opus-merged-followup/`、`opus-mobile-layout-final/`。第一次最終 CSS 複查腳本字串替換造成 JavaScript syntax error，未啟動原生程序，修正工程腳本後才執行；非產品失敗或模型重播。
- 下一步由本 commit 建立新乾淨候選，建置／完整測試後，核對正式仍為 4201a28 且全停，保留上一版程式／啟動器，才套用與讀回；不部署舊準備包、不修改既有對話／目標／模型登入。

## 11. 正式套用與私人入口讀回

- 正式程式固定 **`c8127f92822161661439606232822a74c4b8cc46`**。以 Git ZIP／Expand-Archive 建立新的 `prepare-mobile-final-c8127f9`；package-lock 與原正式一致，實體複製既有 node_modules，未安裝或升級相依。UI／擴充／Windows 啟動器建置通過，281 個程式／測試来源與固定 Git object 正規化後零差異。
- 乾淨候選第一次完整測試：codex-flash 假資料 test 子程序持續不結束，254 秒後核對父子 PID／命令只停止該 test 子程序，結果864通過／1個檔案失敗；不停止正式 K 或其他工程程序。該檔單独12/12（0.55秒），全套限制4個測試程序並行／單測60秒上限後 **865/865**（46.92秒）；不跳過測試、不改產品或相關 test。首次不結束的精確根因尚未定位，保留 `prepared-tests-final.log`、`clean-codex-flash-rerun.txt`、`clean-tests-bounded-rerun.txt`，不聲稱已修掉測試時序問題。
- 套用前再次核對正式仍4201a28、47831未監聽、K自有程序已停止。`activateRuntime` 只交換程式／啟動器；**34096個保護檔案在交換前後雜湊完全相同，五個Gemini帳號身分及目前帳號不變**。還原位置 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791284533674`，內含4201a28程式與原啟動器；不是對話資料還原。
- 在既有 state root `vault/private-state/.local/remote-access.json` 建立正式個人入口設定，只存原個人金鑰雜湊，不搬取供應商憑證、不換金鑰。初次因 `.local` 尚不存在而 ENOENT、未寫入；建立這個必要目錄後以 `wx` 建立並讀回。原 Tailscale Serve 沒有更改，仍是私人HTTPS8443 → loopback54832，無Funnel／公開路由。
- 由正常 `D:\K-harness\Start-K-Desktop.ps1` 啟動。正式 Electron PID43992／視窗 Responding=true；47831與54832皆僅監聽127.0.0.1。77個正式程式／產物雜湊一致，三個UI資產HTTP200且內容相同，health=native；原本未授權本機首頁／state仍403。
- 2026-10-06T11:04:28Z，使用正常公信TLS、不略過驗證，經真Serve完成 **13項**讀回：未登入／錯金鑰拒絕、正確登入／正式工作台／state／sessions成功、跨來源／電腦目錄route拒絕、偽造identity被Serve取代、遠端cookie不能當本機authority、SSE snapshot一致、登出及撤銷成功。正式17間聊天室包含三家，沒有fake-room；**零工作送出、零目標操作、零換帳號**。
- 電腦Chrome經同一真私人網址實際登入成功，讀到既有工作區／聊天室；未開啟或重送真實翻譯／CaseAgent工作。畫面 `formal-private-browser.png` 顯示「電腦 K 已連線」。這是電腦瀏覽器讀回，不冒稱本次Samsung實機已重新登入；手機需重新整理原網址、以原金鑰再登入。
- 正常啟動後原生額度查詢使Gemini帳號紀錄／CLI log／SQLite暫存及一個既有crash紀錄出現變動或消失；五帳號身分與目前帳號雜湊仍相同，其餘既有保護檔無變更。未手動刪除原生檔案。啟動後保護檔首次讀回遇瞬時消失的db-shm，僅在啟動後核對中明列這類SQLite暫存消失，不放寬交換前後的精確比對。HTTP驗證腳本首次將未收完整的SSE片段當JSON，修正只解析完整事件後13項通過；產品SSE沒有改動。
- 程式已推到既有 `origin/main`，遠端精確讀回同c8127f9；沒有force push／搬動既有tag，原D槽未提交工作樹不動。發佈前核對本個人金鑰未出現在diff、未提交.local／.runtime／憑證檔。本頁與README的純文件收尾另外提交，不重啟正式K；東區未更新。
- 部署證據共用位置 `D:\K-harness\.runtime\mobile-remote-deploy-20261006`；完整複查／畫面／測試保留本工程工作樹 `.runtime/mobile-connect/`。上節非阻擋限制與尚未完成的實機項目仍有效，不把本機正式可讀回擴稱所有手機操作都已驗收。


## 12. 長對話首次同步與斷線提示補修（候選，未套用）

本節保留候選階段紀錄；後續正式套用與不同斷線事件見第13、14節。

### 問題與查證
- 本人 21:18／21:23 手機截圖：先登入失效，重新輸入金鑰後可進工作台，但尚無對話快照時仍顯示「後端斷線」。不能把登入補修當成手機問題已解決。
- 正式仍是 c8127f9；桌面 47831 與手機 54832 同由 Electron PID37316 提供，該次程序於臺灣 21:14:48 啟動。遠端 session 存記憶體，重啟後需重新登入；沒有另開第二個正式後端。
- Tailscale 狀態曾回手機 offline／last seen 約 20:30，但直接 ping 同一手機有 43 ms 回應。因此已撤回「offline 標記足以證明手機斷網」的推論，未停用／重設 Tailscale。
- 經正式私人 HTTPS，新診斷登入可讀 state 與 SSE。23 秒連續串流收到 6 個事件／心跳，未自行結束；沒有送出訊息、停止、換帳號或操作翻譯目標。第一版诊断脚本逐次重掃累加大字串而逾時，換成串流邊界掃描後成功；不是產品串流失敗證據。
- 真瀏覽器的分頁限定 1 Mbps 測試：舊 UI 顯示斷線時仍持續收到 SSE 資料；移除限速即顯示已連線。限速已還原。這直接證明首次下載被誤標為後端斷線，並重現大歷史同步瓶頸；不等於取得 Android 本機網路紀錄，不能宣稱每次手機中斷都已定位。
- 21:32:41 同一正式 state 的記憶體量測：629 訊息、5122 工具；完整事件 **36,493,356 bytes**，候選遠端摘要事件 **1,636,177 bytes**，減少 **95.5%**。只記筆數／容量與狀態，未另保存真實對話、工具內容或秘密。證據 `.runtime/mobile-connect/slim-state-measurement.json`。

### 最小修正與保留邊界
- `shared/remote-state.mjs`：只對遠端 SSE 的 snapshot／patch 摘除工具 output、details、patchChanges 及回合差異正文；保留全部訊息、目標、核准、工人、工具 ID／狀態／歸屬。桌面 SSE 與核心完整狀態不變。
- `src/desktop-server.mjs`／`src/remote-access.mjs`：同一個 state stream 基線，廣播時依入口選完整或摘要事件；新增兩個唯讀紀錄 route，必須通過既有私人身分與 K session，精確符合目前 threadId／record ID。不讀別的聊天室、不重開核心、不讀任意路徑、不重送工作。
- `frontend/remote-record.jsx`、`main.jsx`、`native-ui.jsx`：手機在既有工具／差異細節展開時，才讀該筆完整且未截斷的紀錄。收合／切換取消未完成讀取；明示內容是展開當下紀錄，收合再展開讀新結果。沒有額外歷史庫、持久快取、背景輪詢或技術管理頁；桌面呈現不變。
- `state-connection.mjs`／`work-status.jsx`：首次同步與已斷線分開呈現；取得完整快照前仍禁止操作，不因 HTTP 連上就宣稱工作狀態已確認。SSE 失敗後只用既有小型 GET sessions 區分已失效登入，過期診斷結果不得覆蓋新快照。不自動導頁、存金鑰或重送指令。
- `mobile.css`：重新登入按鈕改整列，修正截圖中擠成直排。提示先複製草稿再手動登入；原生權限、雙重入口隔離、金鑰輪換／撤銷與 POST 請求去重不變。

### 驗證與審查
- 定向 **9/9**；全套 **870/870**（46.41 秒）；Vite 建置通過。狀態投影覆蓋新增／文字追加／欄位變更／排序／移除／切換聊天室；紀錄 route 覆蓋未登入、錯房間、缺紀錄與完整內容讀回。證據 `slim-targeted-tests.txt`、`slim-full-tests.txt`、`slim-build.txt`。
- 真 HTTPS 代理＋React＋HTTP/SSE、假 Tailscale 身分與假核心 UI probe：5000 筆肥大工具紀錄，1 Mbps 限速含登入與前端載入首次 **15.032 秒**、最後建置再跑 **14.569 秒**接通；初始顯示同步而非斷線；工具 output、patch、回合 diff 皆精確讀回。另含原六聊天室、送出、停止、核准／拒絕、提問、佇列、附件、斷網重連、未知回應不重送及登入過期保稿／手動登入流程。不是 Android 實機驗收。證據 `.runtime/mobile-remote/ui-result.json`、畫面、`slim-ui-run.txt` 與 `slim-ui-final-run.txt`。測試改用 54842／54843，未占用正式埠；主代理目視最後登入失效畫面，兩處工作狀態皆明確標示登入失效，草稿保留、登入鈕不再擠成直排。
- 初版「只區分登入失效」真正 Opus 5.5 複查無 P1/P2；保留 502 期間仍可能須手動重連、離線時舊登入提示暫留等 P3。已採納拿掉「原金鑰」的文字，以免輪換後誤導。
- 完整串流／按需讀取整合補查：真正 `claude-opus-5-5` session `f6a81369-3d37-44ca-9d0c-32a26c268448`，官方訂閱唯讀，**無 P1/P2**。認可同一狀態基準、完整 patch 語意、精確房間／紀錄讀取、取消舊請求及登入檢查競態；接受每次串流失敗查一次唯讀 sessions 的 P3 成本，不加新快取／重试管理。證據 `.runtime/mobile-connect/opus-mobile-slim/`。
- Opus 指出審查包缺少 `frontend/work-status.mjs`、`shared/conversation-groups.mjs`，其包外 Grep 被拒，未假稱已查全庫。主代理已補讀兩檔，並搜尋完整 frontend/shared 的 output／details／patchChanges 使用處：工作／子代理狀態靠 status、activity、workerDetails；訊息分組靠 messages／groupId／turnId，皆不依賴移出的工具本文。其他命中為已改按需讀取的工具／差異 UI、未裁減的 worker output 與 question details，以及既有 state-stream 合併器；未發現遺漏的 UI 消費者。

### 正式狀態與下一步
- 本節修正尚在工程候選，**未替換／重啟正式 K，未部署、未 push**。本人回報再次斷線後，22:16:29 正式 HTTPS 唯讀回查 200／390 ms：同一 Electron PID37316 提供兩個入口，真實翻譯 busy、goal active，原生最近活動 2 秒前，另 1 個子代理狀態待確認。未送出、停止或重送工作；只登出本次診斷 session，未撤銷手機登入。
- 整合 Opus 複查與最後建置／UI 讀回已完成，固定本批程式；待正式工作確實停止，按既有 SOP 保留退版、乾淨候選重驗、套用及手機實機重新連線驗收。東區不動。正式未更新前仍可能重現舊同步問題，不以候選通過宣稱手機已修好。

## 13. 長對話同步修正版正式套用

- 固定程式 **`3a9cccd192611a2397c82b731d6c8f9fee67cc62`**。真正 Opus 5.5 整合複查及主代理消費者核對見第12節；從 Git archive 建立新乾淨候選，284個來源檔與固定版本相同，lockfile一致，實體複製既有相依，沒有安裝或升級。UI／擴充／Windows啟動器建置通過，乾淨候選完整 **870/870，47.884秒**。
- 本人先說「處理好 我停了」，再明確允許「只結束這次 K 並更新」。當時原生目標已暫停，但一筆舊工人未確認，正常關閉失敗。執行前身分核對發現原啟動器已退出，工程腳本因此**沒有執行 taskkill**；啟動器自己的紀錄顯示22:29:39已強制結束其自有supervisor。再次確認K自有程序及兩個listener皆零後才套用；未將歷史工單改成成功、未重播。
- 22:31交換程式，**36,930個受保護檔交換前後完全相同，五個Gemini帳號身分與目前選擇不變**。可退前版c8127f9的位置：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791297063579`。這是程式／啟動器退版，不是對話資料備份還原。
- 從既有啟動器重開；桌面47831與手機54832仍是同一正式Electron的loopback入口，不是另一個工程後端。78個正式程式／產物雜湊與候選一致，三個前端資產HTTP200且內容相同；未授權本機首頁／state仍403。正常啟動後保護檔核對只有原生Gemini CLI log改變，未搬憑證、切帳號、改語音或計費。
- 真私人HTTPS完整 **15項** 驗證通過：登入及拒絕、同源與入口隔離、Serve取代偽造身分、SSE、精確工具正文讀回、錯房間拒絕、診斷session登出／撤銷。17間既有聊天室、三供應商保留。原長對話650訊息／5219工具，完整快照 **37,466,337 bytes → 手機摘要1,646,705 bytes**；工具正文仍能逐筆完整讀回。
- 真正式瀏覽器、分頁限定1Mbps／80ms：同步期間顯示「正在同步電腦 K」，完成後「電腦 K 已連線」；原翻譯目標仍paused、busy=false、零送出／目標操作／帳號切換。觀測上界35.624秒包含工具呼叫間隔，不宣稱精確連線benchmark。一次工具層等待先被3秒evaluate限制中止，保留紀錄，之後在限速仍啟用時讀回成功，最後還原測試網路與viewport。412px畫面無整頁橫向溢出；此階段是電腦瀏覽器，不冒稱Samsung實機。
- 程式已推既有origin/main且精確SHA讀回一致；未force push／移動tag，原D槽未提交變更不動，東區未更新。本節文件收尾不重建／重部署程式。
- 工程證據：本工作樹 `.runtime/mobile-reconnect/` 的 `prepared-final.json`、`reviewed-source-readback.json`、`prepared-*-final.log`、`activation.json`、`protection-*.json`、`formal-readback.json`、`formal-remote-readback.json`、`formal-browser-slow-readback.json`、`formal-mobile-connected.png`。部署共用目錄：`D:\K-harness\.runtime\mobile-reconnect-deploy-20261006`。

## 14. 程序退出與連線持續性追查

本節與已修復的大歷史同步瓶頸分開，不把任何斷線一概歸因於手機、金鑰或已知舊問題。

- 23:27本人回報斷線後：兩個listener及K啟動器／後端皆不在，私人入口回502，正式版本仍3a9cccd。啟動器沒有22:31啟動後的退出紀錄，Windows沒有對應的Application1000／1001或新Crashpad證據；**該次退出原因未知**。從正常啟動腳本重開後，23:31真HTTPS15項與原paused長對話讀回成功。
- 23:32再次檢查，同批啟動器及後端消失，仍沒有退出紀錄。不可將23:31可讀回當作已穩定。23:33改由桌面應用啟動方式開同一個K啟動器；同一版正式程式，不換後端、不增自動重啟服務。
- 23:36 Windows唯讀查詢確認：工程命令所在Job有`KILL_ON_JOB_CLOSE`（flags10240），當時正式K不屬於該命令Job。Windows的Job可以在最後handle關閉時連帶結束程序，見[Microsoft官方說明](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。這支持「工程啟動方式可能牽連程序生命週期」的推論，**沒有取得前兩次退出當下的Job／kill紀錄，不能宣稱已確證因果**。首次查詢用錯buffer長度回error24，改正結構大小後成功；僅唯讀，未更改Job、安全設定或系統服務。
- 23:36正式HTTPS再次15項通過，原目標paused、busy=false；手機Tailscale可達。本人另親自確認「已連線，原對話正常顯示」。這補足本版手機基本載入證據，不等於長時／鎖屏／Doze或所有手機操作驗收。
- 持續5分鐘的唯讀連線測試被維護停機中止：23:38:49尚回200，23:38:59串流結束、入口不再可用。啟動器有完整的「confirmed close／exit 0／stopped by owner supervisor」紀錄。本人隨後明確確認「有選離開並停止 K」，並說明另一個工程對話正在更新，**本次原因已確認為本人配合更新正常停機，不是產品崩潰或手機網路故障**。保留原始失敗樣本，但不將維護停機當作產品回歸，也不宣稱5分鐘測試通過。
- 只對工程瀏覽器分頁施加離線的測試曾顯示正確的斷線／未知提示；因同時碰到正式K停止，該輪尚不能作為成功恢復證據。手機網路、Tailscale設定及原生工作未由工程測試變更。
- 本人說明更新後，本工程保持K停止，不重啟、不部署、不搶推送；測試分頁離線模擬已還原並關閉。另一工程工作樹已有不同未提交修改，沒有寫入或合併它；只讀確認對方已查到正式3a9cccd。後續由更新方先整合現用手機版本，再驗證、正式套用；新版啟動後方可接續手機持續性測試。前兩次無紀錄退出仍不因此被反推為同一原因。

## 15. 合併版手機正式驗收（2026-10-07 收尾）

- 正式程式維持 `a0890874b3f6e2eb9aa3ef62a92ee3a630397d90`；長工作更新已合併本工程 `3a9cccd` 手機修正，部署過程見 [長工作正式讀回](long-work-observation-20261006.md#正式套用與遠端讀回)。本節僅補文件，不再部署或重啟。
- **臺灣時間 10/6 23:55:44 至 10/7 00:00:44**，真私人 HTTPS 連續五分鐘驗證：30/30 GET 成功、14 次 SSE 心跳、零非預期斷線，最慢 GET 826 ms。這是限定五分鐘證據，不是永久穩定或鎖屏／Doze 驗收；保留第14節維護停機中斷的舊結果，不覆寫成成功。
- 10/6 23:58:16，正式原對話 15 項讀回全通過：650 則訊息、5,219 筆工具；同一快照完整大小 37,466,335 bytes，遠端摘要 1,646,703 bytes。目標仍 `paused`、`busy=false`，未送工作、恢復目標或換帳號。
- 僅工程測試分頁執行 offline→online，觀察到自動恢復；重連期間 5 GET、0 POST。412 px 畫面寬度同為 412 px，沒有橫向溢出。這是電腦瀏覽器窄畫面／斷網模擬，不冒充 Android 自動化。
- **本人實機確認**：「已連線，原對話正常顯示」，並補充新版重啟後先連線失敗，重新登入、填原金鑰後立即進入。因此準確結果是「重啟後重新登入成功」，不是全程沒有斷線。原生 K 遠端登入紀錄仍是程序內 `Map`，重啟會失效；未修改認證設計。若未重啟卻反覆要求登入，仍須另查，不能用本次結果排除。
- 手機工程於 10/7 00:00 後讀回同一 Electron PID 35024、雙 loopback 47831／54832 仍在。已登出自己的診斷分頁、還原測試網路／視窗，不動本人手機 session；K 保持開啟。第14節 23:27／23:32 無日誌退出的原因仍未知，23:38:59 則已確認為本人維護關閉，兩者不混同。
- 證據已逐項核對：`D:\K-harness\.runtime\mobile-reconnect-deploy-20261006\merged-a089087-acceptance.json`、`merged-a089087-connection-soak-result.json`、`merged-a089087-formal-remote-readback.json`、`merged-a089087-browser-reconnect.json`；手機工程另保留 `merged-a089087-mobile-connected.png`。本人重新登入的說明亦由原工程對話讀回確認。真實對話、私人網址、金鑰、cookie、截圖與 `.runtime` 不提交 Git。
