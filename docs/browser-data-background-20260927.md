# 外部 Chrome：data 網址、背景操作與不搶焦點

## 本輪要求與狀態

- 使用者要求修復 `data:` 網址不能開、背景分頁點擊／截圖逾時，修完交由正式 K 內 Opus 複驗。
- 使用者 04:13 前已正常停止 K，本輪不動日常 Chrome、登入資料或帳號。
- 最新明確限制：瀏覽器工作不得搶 OS 前景視窗或鍵鼠焦點，不以 Computer Use 模擬操作或強制切回前景解決。
- **06:19 已保留備份套用正式檔案，並正常重新啟動 K；隔離 health 與未授權入口 403 讀回通過。** 下列本機假資料結果不等於正式 K／Opus 驗收；Chrome 必須重新載入 0.1.2 擴充，正式雙模式／不奪前景仍待 Opus 複驗。

## 已確認根因與修改

### data URL

獨立 Chromium 對照：直接 CDP `page.goto(data:)` 成功；擴充 debugger `Page.navigate(data:)` 回 `ERR_ABORTED`，`chrome.tabs.update` 也未導航。`chrome.tabs.create({url:data})` 能建立真正的 data 文件。

- `src/chrome-extension-context.mjs`：透過現有 relay 的 `Target.createTarget` 新開 data 頁，不用 `setContent`、HTTP 代替頁或降低 Chrome 安全設定。
- `src/browser-live-session.mjs`、`src/browser-mcp-stdio.mjs`：`browser_navigate(data:)` 開新頁後選為 AI 目標，回覆明確說明「新分頁、原分頁不變」。一般 HTTP 與非擴充上下文維持原行為；保留取消與權限 gate。
- 另發現擴充事件先於非同步 `Page.getFrameTree` 回覆抵達，Playwright 尚未裝好 Runtime listener 而遺失主執行環境；導致開得出頁，但 evaluate／填字無法完成。現依 session 延後 `Runtime.enable`，直到 frame tree 回覆已送出，不新增重試。

### 背景頁與焦點

- 真實 headed Chromium、直接啟動（不用另一個 Playwright driver 自動替所有頁啟用 focus）已重現 `visibility:hidden` 下點擊／截圖 5 秒逾時。
- `browser-extension/src/relay/browserModel.ts`：僅已附加的 K 頁啟用 `Emulation.setFocusEmulationEnabled`，讓頁面在背景繼續處理繪製與輸入；AI 選頁所用的 `Page.bringToFront` 改為同頁邏輯 focus，不切原生前景。
- `browser-extension/source/background.ts`：移除自動連線的原生聚焦及新視窗建立。只在本人已開啟、模式相符的 K 專用視窗內新增 inactive 分頁；沒有對應視窗即明確報錯。
- `browser-extension/source/relayConnection.ts`：AI 新分頁 `active:false`。
- `browser-extension/source/connectedTabGroup.ts`：首次 group 指定原分頁的 windowId。否則 Chrome 會把 unfocused 新視窗的唯一頁移到目前前景視窗，原新視窗消失，下一次 create 回「No window with id」。這是取消聚焦後實際重現並修正的相鄰根因。
- Chrome 命令列開網址不能保證不搶前景，已移除該自動啟動 fallback；改為擴充原生訊息背景入口，已用獨立假設定檔完成實際註冊／接通；正式設定於 06:19 套用。Chrome 未開時明確報錯，不強行開窗。

### 原生訊息背景入口（新增授權，06:19 正式註冊）

- 2026-09-27 使用者回覆「允許，限 K 瀏覽器助手」：只註冊目前 Windows 使用者的 `com.k_harness.browser_assistant`，不新增服務／開機啟動，不改日常 Chrome 登入。
- `src/chrome-native-connection.mjs` 只讀 owner vault descriptor，用隨機 bearer 送出一次背景開連線頁命令；失敗不重送、不回退命令列。
- `browser-extension/source/nativeConnection.ts` 只接受自己的 connect.html 與 loopback nonce relay，建立 inactive tab／unfocused window。服務 worker 啟動連 native host 一次；斷線不自動重試循環。
- 原生 host 核對精確祖先程序的專用 profile，拒絕日常 Chrome；僅接收固定背景連線命令。host 的生命週期依附 Chrome 原生通道，不是獨立常駐服務。
- 註冊工具 `scripts/register-k-browser-native-host.ps1` 備份單一 HKCU key，`scripts/restore-k-browser-native-registration.ps1` 可還原註冊；所有檔案保留。

## 驗證

- `test/browser-data-navigation.test.mjs`：data 轉選、一般網址原樣轉送、native null、錯誤釋放、人控拒絕、取消 resolve/reject 與 failClosed 不同完成時序。
- `test/chrome-extension-context.test.mjs`：Runtime 初始化順序，不互鎖其他 session。
- `test/extension-relay-focus.test.mjs`：附加順序與邏輯選頁不呼叫原生 activation。
- `scripts/verify-browser-data-navigation.mjs`：獨立設定檔，一般／無痕 × percent／base64 data HTML；真正網址與 opaque origin、輸入、點擊、讀值、截圖、重新載入及原頁保留。
- 首次完成證據 `.runtime/browser-data-navigation/1790455214119/result.json`，4 組通過，已目視一般 percent PNG 的中文輸入與按鈕結果。後續仍在補正式凍結讀回。
- 重跑 `.runtime/browser-data-navigation/1790455499380/result.json`：一般／無痕各 percent／base64 共 4 組通過，含實際 `self.origin === 'null'` 斷言。
- 真 hidden 背景 repro：`.runtime/k-browser-background-focus-probe/direct-1790455165251/result.json`。點擊候選成功且 active tab 不變；該輪截圖仍逾時，**不能算截圖修好**。
- 後續 `.runtime/k-browser-background-focus-probe/direct-1790455986678/result.json` 與 captureBeyondViewport 候選 `direct-1790456172515/result.json` 均前三次成功、第四次 Page.captureScreenshot 無回覆；不是 Runtime／getLayoutMetrics 延遲。候選尚不能採納。
- 最小成功候選：僅在截圖前 `chrome.tabs.update(已附加的目標,{active:true})`，不做 `windows.update` 或原生 `Page.bringToFront`。K 自己視窗內的分頁選取與 OS 前景是不同層級；既有 user invariant 是不奪 OS 前景／鍵鼠，而非禁止 K 視窗內選頁。`source/relayConnection.ts` 已採此修正，不開放一般化 tabs.update 指令。
- 候選實測各 10 次：regular `direct-1790457128493`、incognito `direct-1790457747826`、regular 不加 occluded-window flag `direct-1790457867181`，均截圖／click 計數成功，capture 約 54–86ms。每輪先讓 distractor active，目標原本 inactive。OS 前景 PID 不屬於測試 Chrome 程序樹，不需要使用者停用其他軟體。
- Chrome API 的 `window.focused` 與 OS 前景讀回不完全等價，bootstrap `state:minimized` 也可能回 `normal`；因此不以這兩個值代替 OS HWND/PID 驗收。記錄它們但不當成搶焦點結論。
- 真 Native Messaging 註冊／父程序檢查／MCP 一般模式假頁已通：`.runtime/browser-native-connection/20260927-051712/probe-evidence/result.json`，OS 100ms 抽樣 60 筆，0 筆測試 Chrome 前景。主代理目視 PNG 正確。
- 最終路徑收斂：`053215` 真 Native Messaging 一般模式通過、無痕首張截圖仍逾時，100ms 採樣曾 1 次命中第二輪 Chrome root PID。不能把 `focused:false` 宣稱為絕對不奪前景，因此產品不再自動 `windows.create`；改在本人已開的相同模式視窗內新增 inactive 工作頁。沒有對應視窗明確報錯，不 fallback，不新增逐次 Allow／人類活動暫停。
- `nativeConnection.ts` 的連線頁一律放既有 regular 視窗的 inactive tab，避免建立再關閉單頁 selector 視窗。實际工作頁依使用者選定 regular／incognito；不混登入狀態。首次使用無痕須本人先開該模式的 K 專用視窗。
- 本人手動入口：根目錄 `開啟K一般瀏覽器.cmd`、`開啟K無痕瀏覽器.cmd`。只指定現有 K 專用 profile；產品不自動呼叫，不新增登入啟動或服務。入口本輪未自動執行，避免搶使用者前景。
- 舊 helper 產品直通 regular 10/10 (`direct-1790458065682`)；incognito `direct-1790458168325` 第 1 輪讀到自有 Chrome 前景即停止，沒有把它記為通過。舊 helper selector 是唯一分頁，成功連線後關該窗可能影響焦點，但未精確證明該瞬間因果。
- 上項 fixture cleanup 原誤期望刪除 descriptor；主代理獨立讀回 `cleanup-independent-readback.json` 確認 host 已退出、descriptor 正確標 `connected:false` 且無 token/endpoint。正式設計保留檔案，不永久刪除。此測試器錯誤已修，舊失敗標記未洗掉。
- 目前 native opener／擴充 native handoff／data／context／focus／loader scoped unit tests 共 23/23 通過；不等於實際 Chrome 原生 host 或正式驗收。
- 中間失敗證據保留於 `.runtime/browser-data-navigation/` 各次 result／trace；不清掉失敗以美化結果。

## Opus 複驗清單（正式套用後才執行）

0. 由本人先開啟 K 專用的一般與無痕視窗，重新載入新版擴充並允許無痕；K 不自動開窗，不逐次要求 Allow。
1. 一般／無痕各呼叫 `browser_navigate` 開 percent 與 base64 的假 data HTML，驗證新分頁、原頁保留、填字／點擊／讀回／截圖／重新載入。
2. 背景頁 A 放輸入與計數按鈕，另頁 B 為 Chrome 真正顯示頁；AI 仍選 A，連續點擊／截圖，不能手動切 A 掩蓋問題。
3. 使用者在其他軟體操作時，K 不得奪取前景／鍵鼠焦點；另驗一般與無痕連線、AI 新分頁、AI 選頁。
4. 不做真實登入、上傳或下載；這些不是本輪授權的測試資料。
5. 記錄失敗原始文字與模式／步驟，不能以本機腳本成功代替正式模型回合。

## 來源

- Chromium `PageHandler::Navigate` 對 extension initiator 的 renderer-initiated 限制：<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/protocol/page_handler.cc>
- CDP focus emulation：<https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled>
- 本機上游 `node_modules/playwright-core/lib/coreBundle.js`：`noDefaults` 會跳過預設 focus emulation；初始化先 frame tree、後安裝 Runtime listener；SDK `selectTab` 原呼叫 `bringToFront`。
- Chrome service worker lifecycle（profile startup 事件及 native port 存活規則）：<https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle>

## 05:39 補測狀態（正式仍未部署）

- 定向回歸 63/63 通過：`.runtime/browser-native-connection/scoped-final-regression.txt`。
- `20260927-053619`：最終既有視窗路徑、Native Messaging、一般／無痕 HTTP 假頁輸入、點擊、讀回、截圖均通過。此輪為 headless，不能代替 headed 正式不搶焦點驗收。
- `20260927-053731`：加入 data 四組回歸後，首組等候新頁事件逾時；尚在修復，未將上一輪 HTTP 成功擴張為全功能通過。
- 隔離實測：`.runtime/isolation-pilot/native-access-fixture-1790458763788/result.json`。既有 KCandidate3 對新建 vault 假檔讀、寫均被拒；原內容未變，新建工作區假檔可寫，結束後 box idle。沒有改 ACL、既有 Sandboxie 規則或讀取真正秘密。

## 最終修正、驗證與正式套用

- 最終 data 根因：新頁 target 已有 data URL，但 debugger 附加過早，實際初始文件／frame tree 尚未就緒，Playwright 收不到完整初始頁面事件。僅選頁、調整命令順序或以 TargetInfo 補 URL 均未完整通過；這些無效候選沒有留在正式程式。
- 最小修正位於 `browser-extension/source/relayConnection.ts`：data 新頁建立前先安裝一次性的 Chrome loading 完成監聽；建立後只選取已存在 K 專用視窗內該頁，確認同 tab、精確 URL 且 complete，才交由控制工具附加。結束即移除監聽；不重載、不重送、不假造頁面資料、不聚焦 OS 視窗。一般新頁維持 inactive。
- `.runtime/browser-native-connection/20260927-061500/probe-evidence/result.json`：完整 Native Messaging → context → MCP；一般／無痕 HTTP 假頁均通，percent／base64 data 共四案例均通。逐例精確 URL、opaque origin、原頁保留、輸入、點擊、讀回、截圖、reload。主代理目視無痕 base64 PNG 的 DATA_OK 輸入與按鈕結果正確。
- 最終定向回歸 **65/65**；擴充 build 通過。前景採樣172筆、測試 Chrome 0筆，但此整合輪為 headless，不冒稱正式 headed 驗收。先前真 headed 背景截圖候選的10連拍證據另列上文。
- **06:19 部署23檔**：5個runtime模組、extension protocol、15個擴充檔案、原生host及其設定。逐檔核對新檔與備份雜湊；固定擴充位置未搬移，版本0.1.2。
- 備份：`.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/vault/browser-native-backup-20260927-061914`。收據 `.runtime/browser-native-connection/deployment-result.json`。部署最後輸出在 Windows PowerShell 5 因預設編碼讀manifest失敗；檔案已完成套用，未重跑部署。主代理以UTF-8獨立核对23檔與註冊後產生收據。
- HKCU 僅 `Software/Google/Chrome/NativeMessagingHosts/com.k_harness.browser_assistant` 指向正式 vault 內host；不新增服務、開機啟動或更改日常Chrome登入。初始原註冊不存在的備份在 `.runtime/browser-native-connection/20260927-050235/registry-backup/registration-before.json`；需完全移除此輪註冊時用該備份與 `scripts/restore-k-browser-native-registration.ps1`，不要用中途fixture註冊備份。
- 正常啟動器06:19:43回報ready，實際health deployment=isolated、未授權root403；`.runtime/browser-native-connection/formal-readback.json`。這只確認正式K啟動與隔離邊界，不代表正式Chrome擴充已重新載入。
- **待本人一次性操作**：在K專用Chrome重新載入K瀏覽器助手0.1.2，確認允許無痕。本人先開啟要用的一般／無痕視窗，可用根目錄兩個手動入口；K不會自動開窗。不需要每次工作按允許，也沒有滑鼠／鍵盤活動暫停。
- **待Opus正式複驗**：依上方清單執行；尤其使用者操作其他程式期間不得搶OS前景。沒有向K內Opus自動發訊的已接通介面，本轮未宣稱已派送或由Opus驗收。真實登入／上傳／下載未測。

## 06:38 正式未連線回報：診斷已補，根因尚未確認

- Opus回報正式0.1.2仍缺descriptor，推測5秒parent check逾時；這是未證實假說，不能由測試profile成功推論正式profile成功。
- 本輪讀回正式HKCU host註冊、bat、config與host模組載入均正確；正式descriptor不存在。只查專用profile匹配程序，未讀日常Chrome分頁／登入資料：當時沒有含k-chrome-profile的Chrome程序。已請本人手動開啟專用Chrome並保持開啟；不自動彈窗。
- `scripts/k-browser-native-host.mjs`新增host旁 `k-browser-native-host.diagnostic.json`，只有版本、ISO時間、階段、錯誤代碼、經過毫秒；不含URL、token或命令列。區分parent_timeout、parent_mismatch、parent_check_failed及descriptor_write_failed，保留5000ms與原有profile核對，不放寬隔離。
- 用真正execFile子程序核對timeout錯誤形狀為killed=true / signal=SIGTERM / code=null；NO_MATCH非零exit以stdout辨識，不把所有錯誤誤報逾時。
- 定向14/14通過，收據 `.runtime/browser-native-connection/diagnostic-deployment.json`；確認host未執行後只備份更新正式host.mjs，未更動K後端／Chrome。備份 `vault/native-diagnostic-backup-20260927-063857`。
- **尚未修復確認**：需要正式Chrome下次呼叫host的實際診斷結果。未將沒有目前程序推論為使用者先前操作錯誤；未自行增加timeout、重啟日常Chrome或假稱正式連線通過。

## 06:43 正式 K 內 Opus 複驗（0.1.2，本人手動開 K 專用一般＋無痕視窗後）
連線：本人用根目錄 .cmd 開 K 專用 Chrome 一般／無痕視窗後，browser_session 一般、無痕均成功（此前 06:26–06:32 四次「尚未連上瀏覽器助手」發生在未開專用 Chrome／開錯日常 Chrome 時）。
- **通過**：一般 percent data 與 base64 data、無痕 percent data 均開在新背景分頁（回覆「原分頁不變」）；輸入、點擊、讀回全部成功。背景分頁連續點擊：一般 3/3、無痕 2/2，計數讀回正確。browser_tabs select 成功。無痕本機 HTTP 假頁（127.0.0.1:47999）導航成功。
- **失敗**：browser_take_screenshot 全部 5 秒逾時，共 6 次：一般 data 背景頁 3 次、一般 base64 經 tabs select 後 1 次、無痕 data 1 次、無痕 HTTP 假頁 1 次。原始錯誤皆為 `TimeoutError: browserBackend.callTool: Timeout 5000ms exceeded. ... taking page screenshot / waiting for fonts to load... / fonts loaded`。與網址種類無關；04:09 舊版（當時選頁會 bringToFront）截圖曾成功。本文件「截圖前 tabs.update active」修正在正式路徑上未見效果，根因未查。
- 未測：OS 前景是否被搶（Opus 無法觀察使用者畫面，需本人回報）、reload、假登入隔離（本輪未重做）。
- 本輪未改程式；假網站已停止。

## 06:52 正式截圖失敗重現與候選（尚未驗收）

- 主代理以正式Native Messaging入口、既有K專用profile／擴充，新建localhost假頁重現；不讀原分頁、不登入，不啟動或前置Chrome。輸入、點擊、Runtime讀回都快，relay `Page.captureScreenshot`請求未完成。讀取專用Chrome主視窗的IsIconic為true（已最小化），沒有查日常Chrome視窗標題。
- 證據 `.runtime/formal-screenshot-repair/1790462898437/trace.json` 與deadline.json；候選metrics `1790462931988`、captureBeyondViewport `1790462967350`均未解；fromSurface:false `1790462918779/result.json`被Chrome明確拒絕Only screenshots from surface are allowed。三候選只在本機probe傳入，不在正式產品保留。
- 首次probe缺bounded cleanup，只停止精確本輪helper PID33868，未停止Chrome；後續probe25秒deadline落盤退出。留下的新增假頁未擅自清理，原有使用者／Opus頁面未改。
- 正式native host的06:40:56診斷ready、elapsed1385ms，這次並非5秒父程序核對逾時。仍不能推論所有歷史失敗同一原因。
- 本機Playwright coreBundle.js35597確實預設帶 `--enable-features=CDPScreenshotNewSurface`，K手動入口原本沒有。Chromium對該功能描述為避開等待未present影格的停頓；因此先只加此一截圖功能候選，不放寬安全、不加renderer/occlusion等其他旗標、不延長逾時。
- 06:52只更新根目錄兩個手動cmd，未執行它們；收據 `.runtime/formal-screenshot-repair/launcher-change.json`，可還原備份 `launcher-backup-20260927-065213`。需本人完整關閉K專用Chrome再由cmd重開；舊process singleton不會套用新啟動參數。日常Chrome、K後端與登入資料不變。
- **狀態：候選已準備，等待本人重開專用Chrome，尚未修復確認。** 下一輪主代理須核對新PID旗標，於最小化狀態驗證一般／無痕多張、動態計數像素內容及OS前景；不能只以單張或headless成功宣稱通過。
- 版本釐清：先前文件Chrome153不可直接沿用，本輪本機Chrome安裝目錄現為154.0.8037.58；未據版本差异推斷根因。
- 官方來源：[Playwright啟動開關](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts)、[Chromium功能定義](https://chromium.googlesource.com/chromium/src/+/refs/tags/140.0.7287.0/content/common/features.cc)。目前官方main可能變更，實際採用的是專案已安裝Playwright的switch證據。

## 06:59 正式Chrome最小化截圖修正驗證通過

- 本人回覆「已重開」。主代理讀回專用Chrome新PID33420已帶 `--enable-features=CDPScreenshotNewSurface`；不是只改檔案就宣稱生效。只改兩個K專用人工啟動cmd，擴充仍0.1.2，不需要另行重載或更新K後端。
- 先前正式最小化截圖Page.captureScreenshot長時間無回覆；同一正式路徑重開採用新surface後截圖恢復。根因收斂為舊截圖路徑等待最小化視窗未呈現的畫面；不靠切OS前景、Computer Use、延長5秒或關閉安全機制解決。
- 主代理使用 **正式trusted-runtime模組＋正式Native Messaging＋正式installed擴充＋本人已開啟的正式Chrome profile**，新建假頁走完整MCP工具；不是headless或另一測試Chrome。一般／無痕 × HTTP／data四組各連拍3張，**12/12成功**，耗時60–1431ms。每張之前只點一次按鈕，等待預期DOM結果，計數各组1→2→3皆正確；沒有重送點擊。
- 真圖目視：`regular-http-3.png`、`incognito-data-3.png`均見Count3，非空白或舊畫面。證據：`.runtime/formal-screenshot-repair/formal-1790463498234/result.json`及12張PNG。
- 該轮100ms OS HWND/PID抽樣154筆，**K Chrome前景0筆**，最大採樣間隔133ms。測後兩個屬於專用Chrome的可見Windows視窗皆IsIconic=true，未讀視窗標題；`window-readback.json`。這是有限採樣證據，不宣稱可排除任意小於採樣間隔的瞬間；本輪產品沒有呼叫OS聚焦／還原視窗。
- 初輪一般2張成功但probe假HTTP server關閉等待keepalive，deadline退出；其capture證據保留，未用作完整驗收。後續無痕6張成功；其中立即讀DOM曾有一次舊值，最終MCP驗證改成等待該次預期DOM結果，12次全過，沒有重送。最終fixture正常exit0，關閉自己新建分頁與假網站，保留本人及Opus原有頁面，沒停止正式Chrome／K。
- 手動入口邊界2/2檢查：專用profile與單一surface旗標，沒有no-sandbox或disable-web-security。原備份與收據見06:52段落。
- **完成範圍：正式Chrome截圖路徑已實測修復，且本輪未見搶前景。** K內Opus可依同清單再跑模型端複驗；不冒稱本輪是Opus執行，也不擴成真實登入／下載／上傳驗收。

## 後續：舊Opus對話已中止連線

- 本人轉述原Opus對話兩模式均回「瀏覽器連線已中止」。現行external-browser-gateway在recoveryRequired時拒絕模式切換；browser-live-session以closed/disconnected判定，不自動重送。
- 本輪本人完整重開K專用Chrome本身就會中斷先前對話連線；僅此錯誤不足以認定工程測試取代或切斷該連線。實際觸發時刻未讀回，不把推測當成根因。
- 截圖12/12與前景採樣證據不受此舊對話狀態改變；K內模型複驗須新對話建立新連線。目前未修改重連邏輯，也沒有自動重送先前操作。

## 07:12 K 內 Opus 5.5 新對話複驗（擴充 0.1.2，k_browser 工具）

範圍：新對話 `2f6afd1c` 只用 `k_browser` MCP 工具，依上方「Opus 複驗清單」一般／無痕各跑一遍。假資料只有本機 `127.0.0.1:48123`（`.runtime/opus-reverify-20260927/fake-server.mjs`，測完已停止）與兩個自製 data HTML；沒有開真實網站、沒有登入、上傳或下載。本輪沒有修改程式。

| 項目 | 一般 | 無痕 |
|---|---|---|
| percent data：開新分頁、原分頁不變 | 通過 | 通過 |
| base64 data：開新分頁、原分頁不變 | 通過 | 通過 |
| data 頁輸入中文／點擊／讀回（`origin === 'null'`） | 通過（兩種 data 各計數 1→3） | 通過（同左） |
| data 頁截圖 | 6/6（percent 3、base64 3） | 6/6 |
| 背景分頁 A 輸入／點擊／截圖（每輪先截 B 使 B 成為顯示頁，再選 A） | 3/3，計數 1→2→3 | 3/3，計數 1→2→3 |
| 本機 HTTP 頁重新載入 | 通過（`navigation.type=reload`，輸入與計數歸零） | 通過（同左） |
| **data 頁重新載入** | **未能執行**（見下） | **未能執行**（同左） |
| 切換分頁（`browser_tabs select`） | 通過（A／B 來回 6 次、回 data 分頁讀回原值） | 通過 |
| 假登入隔離 | 一般登入 `regular-fake` 後，無痕讀到 cookie／localStorage 皆 `NONE`；無痕登入 `incognito-fake` 後，一般重新讀取仍只有 `regular-fake` | 雙向互相看不到 |

- 截圖共 **26/26 成功、0 次逾時**（data 12、背景 A 6、切換用 B 6、一般 reload 後 1、一般 whoami 1），與 06:43 那輪 6/6 逾時相比已改善。目視 `regular-pct-3`、`regular-A-2`、`incognito-A-3`、`incognito-b64-3`：中文輸入字與 Count 值都跟當下 DOM 讀回一致，沒有空白或舊畫面。
- **data 頁重新載入限制**：工具集沒有重新載入工具。用 `browser_press_key F5` 沒有效果（合成按鍵不會觸發瀏覽器快捷鍵）；用 `browser_evaluate` 執行 `location.reload()` 時，Chrome 在兩個模式都回主控台錯誤 `Not allowed to navigate top frame to data URL`，頁面保持原狀（輸入與計數都在，`navigation.type` 仍為 `navigate`）。這是 Chrome 擋下頁面自己發起的 data 導航。前面「本機腳本 reload 通過」走的是另一條路徑，不能代表模型端工具可用。如需模型端 data reload，要另外提供瀏覽器端發起的重新載入（例如 CDP `Page.reload`），本輪未實作。
- 附帶觀察：data 分頁經歷被擋的 reload 後，`browser_tabs` 清單的標題變成空白，但頁面內 `document.title` 仍正確，只是清單顯示問題。`browser_take_screenshot` 的相對檔名實際存到 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/browser-output/2f6afd1c-…/external-<mode>/`，不是工具說明寫的工作區根目錄。
- 背景證明的限制：因 K 對已附加頁面啟用 focus emulation，A 頁在頁內讀到的仍是 `visibilityState=visible`、`hasFocus=true`，所以無法從頁面本身證明 A 當下是 Chrome 的背景分頁。本輪只能確認操作順序（B 截圖後才選 A，選頁只換 AI 目標，不切 Chrome 分頁），不能用頁內讀值補強。
- **未驗**：OS 前景／鍵鼠焦點是否被搶。Opus 看不到使用者畫面，本輪也沒有做 HWND 抽樣，需要本人回報。一般與無痕重新連線也沒有另外測。
- 收尾：只關閉本輪新開的分頁（一般 5 個、無痕 6 個），兩個模式都留下原本的 `about:blank`。中途有一次切換無痕被自動模式分類器暫時擋下，隨後的關分頁指令落在一般模式，因為索引不存在全部回「Tab not found」，沒有誤關任何分頁；重試切換後才完成。
- 證據：截圖 23 張在上述 browser-output 的 `external-regular`／`external-incognito`，前 3 張一般 percent 在其下 `.runtime/opus-reverify-20260927/`；主控台紀錄 `console-2026-09-26T23-12-08-256Z.log`（一般）與 `console-2026-09-26T23-19-26-326Z.log`（無痕）。

## 07:58 三項缺口修正：同頁重新載入、即時標題、截圖路徑說明

使用者要求「修到好 我要去睡了」。本輪只處理上述三項；不改擴充、不新增登入/允許步驟、不自動暫停、不重送舊工作、不開真實網站。

### 實作與根因

- `src/browser-mcp-stdio.mjs`：提供模型可見的 `browser_reload`。已安裝的 MCP 0.0.82 將原有 reload 標成 skillOnly，沒有列入模型工具。K 先向原 MCP 查詢實際 current 分頁，再對該頁使用 Playwright `page.reload()`；不是 F5 或頁面內 `location.reload()`，不建立新分頁、不自行維護第二份選頁狀態。取消仍沿用關閉連線的 fail-closed 行為。
- `src/browser-live-session.mjs`：增加同頁 reload 入口；標題改讀目前文件的 `document.title`。實測同一個 data 頁被 Chrome 拒絕頁面內 reload 後，`page.title()` 為空，但 DOM 標題正確，URL 完全相同。沒有把未證實的 Chrome 內部快取機制當成已知根因。
- MCP 的 `browser_tabs list` 以當前頁面索引及完全一致的 URL 對照後，更新顯示標題；不使用猜測或舊標題補值。
- 截圖說明修正一項先前過度概括：**未指定 filename** 才是自動存入目前對話/模式 outputDir 並回傳圖片；**指定 filename** 則按 MCP client working directory 解析，回傳檔案參照。並非全部圖片都在相同位置。上游 `node_modules/playwright-core/lib/coreBundle.js` 的 `resolveClientFilename`/`workspaceFile`/`outputFile` 與本機讀回一致。沒有搬動檔案或改變既有存放行為。
- 測試修改：`test/browser-mcp-boundary.test.mjs`、`test/browser-live-session.test.mjs`。

### 實際 MCP 驗證

使用正式 K 專用 Chrome 154.0.8037.58、既有一般/無痕視窗及原生訊息連線，但載入**專案來源版模組**；不是宣稱目前執行中的 K 已載入修正。只建立本輪假 HTTP/data 分頁，收尾只關閉本輪分頁及假伺服器。

- 一般/無痕 × HTTP/percent data/base64 data：**6/6 同頁重新載入成功**，分頁物件/數量/URL 不變，計數歸零、navigation.type 為 reload；之後點擊仍可得到計數 1。
- 兩模式 × 兩種 data：**4/4** 被拒絕的頁面內 reload 之後，清單中「current 那一列」即時標題正確。沒有只靠其他分頁同名標題判定成功。
- 每頁指定檔名及不指定檔名各截一次：**12/12 截圖成功**。指定路徑有實際檔案，未指定時有 inline 圖片；目視抽查無痕 base64 圖中文字/Count 1 正確。
- **170 次前景抽樣，0 次 K Chrome 位於前景**；最大抽樣間隔 129ms。這是抽樣證據，不宣称连续每一毫秒均量到；沒有呼叫 OS 前景切換。
- 證據：`.runtime/formal-screenshot-repair/reload-1790466798302/result.json`、`*-tabs.txt`、`*-live.json`、`foreground-samples.csv`、output 內圖片。重現腳本 `.runtime/formal-screenshot-repair/reload-verify.mjs`。
- 保留早期失敗證據：初版測試錯把指定檔名也當成 inline、錯把顯式相對路徑當 outputDir；之後更嚴格的 current 列檢查揭露標題尚未修好，再以 DOM 即時標題修正。前述失敗不被冒稱成功。

- 最終凍結版相關回歸 **54/54 通過**、0 失敗/跳過；證據 .runtime/formal-screenshot-repair/final-regression-frozen.txt。兩個模組語法與待套用腳本語法檢查通過。

### 正式套用狀態

**程式與來源版真實 Chrome 驗證完成；正式部署尚未執行。** 07:54 `/health` 仍回 deployment=isolated，K 尚在執行。可用原生 UI 工具無法取得系統匣停止入口，最小化 K 也無法直接讀取完整忙碌狀態；沒有強制結束目前程序、取出 UI 認證、改造停止通道，亦沒有在运行中的正式程式區直接覆蓋兩個相依模組。

已準備 `.runtime/browser-reload-closeout/ready/` 兩檔及 `apply-when-stopped.ps1`。腳本**尚未執行**；會確認 47831 無監聽且既有 K owner 已結束，才備份及更新正式兩檔並核對 SHA-256。此腳本不會自動排程或等候使用者睡醒，不碰 Chrome/擴充/登入/對話。正常停止後才可套用並由原啟動器重開，再開新的 K 對話供 Opus 複驗。

### Opus 複驗入口（正式套用後）

兩模式分別透過 `browser_reload` 重新載入 HTTP、percent/base64 data；確認仍為同頁、計數歸零，再輸入/點擊/截圖。data 頁先執行被拒絕的頁面內 reload，確認 `browser_tabs list` 的 current 標題正確。分別驗證省略與提供 filename 的截圖回傳與實际存放位置。不用 F5 或 location.reload 當作 browser_reload 的替代。沿用假資料，不開真實網站或登入；使用者照常做其他事情，不得要求停止其他軟體。


### 16:55 正式部署更新（取代上方「尚未執行」狀態）
本輪已正式套用 browser-live-session.mjs 與 browser-mcp-stdio.mjs，並一併套用退出阻擋及確認框修正。備份、逐檔雜湊收據、正式 runtime 正常退出與重新啟動讀回，見 docs/explicit-exit-20260927.md。上方未執行描述是 07:54 當時狀態；舊 apply-when-stopped.ps1 未使用，不應再次執行。正式瀏覽器完整 Opus 複驗仍待執行，請依上方複驗入口操作並追加結果。退出測試會中斷當前 K 對話，請放在最後；重開後再補結果，不將斷線當成成功證據。

### 17:15 正式 K 內 Opus 5.5 複驗（16:55 部署版，同對話 `2f6afd1c`）

範圍：只用 `k_browser` 工具與本機假資料（`127.0.0.1:48124` 假網站，同上 `fake-server.mjs`，測完已停止；自製 percent／base64 data HTML）。沒有開真實網站、登入、上傳或下載，也沒有改程式。

**先驗證正式檔案，不只看收據**：`trusted-runtime` 下 5 個檔案（browser-live-session、browser-mcp-stdio、isolated-launcher、`index-DgnknxPg.js`、index.html）的 SHA-256 重新計算後，與 `deployment-exit-receipt.json` 完全一致；index.html 確實引用該 JS。模型端工具清單已出現 `browser_reload`，表示執行中的 MCP 載入了新版。

| 項目 | 一般 | 無痕 | 判定 |
|---|---|---|---|
| percent／base64 data 開新分頁、原頁不變 | ✅ | ✅ | 通過 |
| data 頁中文輸入／點擊／讀回（`origin=null`，計數 1→3） | ✅ | ✅ | 通過 |
| `browser_reload`：percent data | 同頁、`navigation.type=reload`、輸入與計數歸零、再點得 1 | 同左 | 通過 |
| `browser_reload`：base64 data | 同左 | 同左 | 通過 |
| `browser_reload`：本機 HTTP 頁 A | 同左（URL 不變） | 同左 | 通過 |
| `browser_reload`：whoami 頁 | 同頁重讀，cookie 仍在 | 未做 | 通過（僅一般） |
| 頁內 `location.reload()` 被 Chrome 擋下後，`browser_tabs list` 的 current 標題 | percent／base64 皆正確 | 皆正確 | 4/4 通過 |
| 同一情況下，evaluate／wait_for 回覆**末尾附帶的**分頁清單 | 標題仍空白 | 仍空白 | **未修好**（8/8 空白，見下） |
| 背景分頁 A：先截 B 讓 B 成為顯示頁，再選 A 點擊＋截圖 | 3/3，計數 1→2→3 | 3/3 | 通過 |
| 切換分頁（`browser_tabs select`） | A／B 間共切換 5 次 | 同左 | 通過 |
| 截圖（指定檔名 9 張＋未指定 3 張／模式） | 12/12 | 12/12 | 24/24 通過，0 次逾時 |
| 假登入隔離 | 一般登入 `regular-r2` | 無痕登入前讀不到 `regular-r2`；登入 `incognito-r2` 後，一般重讀仍只有 `regular-r2` | 雙向通過 |

- **截圖存放位置（實測）**：未指定檔名的 6 張都直接回傳圖片，另存為 `page-<時間>.png`；指定檔名的 18 張只回傳檔案參照。兩種都存到 `browser-output/2f6afd1c-…/external-<mode>/`，所以正式版的 MCP 工作目錄就是這個輸出資料夾。工具說明寫的「相對於工作區根目錄」在正式版仍不準確；07:58 段落的說明方向正確，但沒寫出正式版會落在同一個資料夾。
- **分頁標題只修好一半**：`browser_tabs list` 已改用 DOM 即時標題；但 evaluate、wait_for 等工具回覆末尾的「Open tabs」清單來自上游 MCP 的另一條輸出路徑，被擋的 reload 之後仍顯示空白標題（一般／無痕、percent／base64 × evaluate、wait_for 共 8 次都空白）。這不影響操作，只是模型看到的附帶清單不一致。
- **無痕 cookie 殘留（不是外洩）**：無痕在本輪登入前讀到 `server-cookie=incognito-fake`，這是今早 07:12 那輪無痕自己留下的；那次的無痕視窗一直沒關，而 cookie 只看主機、不分連接埠。讀到的不是一般模式的 `regular-r2`，所以不算跨模式外洩。localStorage 會分連接埠，因此是 `NONE`。
- **前景視窗（有限度的證據）**：`fg-sampler.ps1` 在沙箱內每 100ms 抽樣一次，只記錄前景視窗代號與視窗類別，不讀標題。共 6073 筆，歷時 670 秒，最大間隔 169ms。沙箱內讀不到前景視窗的程序編號（一律回 0），也無法列舉其他視窗，**因此無法直接認出哪個視窗是 K Chrome**。
  - 使用者大部分時間在遊戲視窗（`POEWindowClass`）或 K 聊天視窗（推定為 `17763008`）。這兩段時間內，我連續做了 data／HTTP／背景分頁／截圖／reload 等數十次操作：09:05:03–09:06:14、09:06:20–09:07:11、09:10:42–09:12:30（UTC）等時段，遊戲一直在前景；09:07:12–09:10:41 則是聊天視窗一直在前景，全程 0 次變動。每次離開遊戲之前，都先經過工作列（`Shell_TrayWnd`）或 Alt-Tab 介面（`XamlExplorerHostIslandWindow`、`ForegroundStaging`），符合使用者自己切換視窗的模式。
  - **未能歸因的一段**：09:04:50–09:05:03 間，前景三次直接切到另一個 Chrome 類視窗 `46990464`，中間沒有經過工作列，其後 `46990464` 位置出現約 2 秒的 `Ghost` 視窗（代表某視窗暫時沒有回應），然後使用者進入遊戲。當時我的操作是 data 頁點擊、截圖，以及安排被擋下的頁內 reload。這可能是使用者直接點視窗，也可能不是；沙箱內的資料不足以判定 `46990464` 是 K Chrome、日常 Chrome 還是其他 Chromium 程式。之後同樣類型的操作又做了 40 次以上，都沒有再出現這種情形，但**不能據此排除**。需要本人回想當時是否點過某個 Chrome 視窗，或在沙箱外用可讀 PID 的抽樣再驗一次。
  - 證據：`.runtime/opus-reverify-20260927/r2-foreground.csv`；截圖與主控台紀錄在 `browser-output/2f6afd1c-…/external-regular`、`external-incognito`，檔名以 `r2-` 開頭或為 09:04–09:13Z 的 `page-*`。
- **收尾**：只關閉本輪新開的分頁（一般 5 個、無痕 6 個），兩個模式都留下原本的 `about:blank`；假網站與抽樣程序都已停止。
- **退出測試：未驗證**（見 `explicit-exit-20260927.md` 同時段段落）。

### 17:45 工程補修與驗證（待正式套用）
- 修正 browser-mcp-stdio：所有工具回覆中出現的分頁列都依同索引＋同 URL 讀取當前 DOM 標題，不再只修 browser_tabs list。evaluate/wait/screenshot 附帶清單有獨立測試；圖片 payload 保持原樣。
- 截圖說明明確寫出正式 K 的 client working directory 即對話／模式的 browser-output；相對檔名不指向專案根目錄。仍以回傳檔案參照為實際位置。
- 本輪來源版使用真正 K Chrome、只開假頁：一般／無痕 × HTTP/percent/base64，6/6 同頁 reload，12/12 截圖。4/4 被阻擋的 reload evaluate 回覆附帶 current 標題正確；後續 evaluate/wait 未必附帶列表，沒有列表不能算列表通過。
- 最終本轮證據：.runtime/formal-screenshot-repair/reload-1790502117448/result.json；blocked.txt 是真正附帶清單。前景以沙箱外 PID 33420 抽樣：174 筆、最大間隔 127ms，0 次 K Chrome 在前景。僅為本輪抽樣，不宣稱重建 17:04 歷史。
- 先前一輪在無痕開 data 頁發生一次 waitForURL 10 秒逾時，結果保留於 reload-1790502053878；假頁已清理後另跑完整一輪成功。原因未確定，不隱藏失敗或稱為已根治。
- 現在 Windows 工具讀回舊紀錄的視窗代號 46990464 屬 K Electron 視窗；不是憑 Chrome 類別就能判定 Chrome。此為現在讀回，不當作歷史程序身分的完整證明。
- 同輪 84/84 回歸通過：.runtime/browser-reload-closeout/remainder-regression.txt。
- 正式原程式尚未換入：等待舊 K 的剩餘桌面 shell 正常退出，不在運行中覆蓋。

## 本輪正式來源模組實測（2026-09-27）
- 17:46 正式套用剩餘標題與截圖說明修正；部署收據 `.runtime/browser-reload-closeout/deployment-remainder-receipt.json`。
- 使用正式 trusted-runtime 模組連接 K 專用 Chrome，僅本機假頁、一般及無痕：6/6 同分頁重新載入、4/4 被擋頁內重新載入後附帶清單標題正確、12/12 截圖成功。沒有附帶清單的回覆不計入標題驗證。
- 正式證據 `.runtime/formal-screenshot-repair/reload-1790502426630/result.json`；前景 187 次抽樣，0 次 K Chrome 位於前景，最大間隔 126ms。這是抽樣證據，不宣稱連續監控。
- 保留來源試驗一次 data 開頁逾時證據 `reload-1790502053878/result.json`，後續獨立完整測試成功，但該偶發原因未確認。
- 執行中的 gateway 單獨關閉測試成功，證據 `reload-1790502831830/result.json`。正式 K 整體忙碌退出另失敗，見 explicit-exit-20260927.md；不混同瀏覽器通過與整體退出完成。
