# 隔離候選：本人登入後的雙模型 UI 驗收

日期：2026-09-26（臺灣時間）。只操作獨立候選 `127.0.0.1:47971`，未切換正式 K。

## 登入讀回

使用者回覆「完成」後，在候選新對話畫面直接讀回：ChatGPT pro、Claude.ai pro（Claude Code 2.1.280）。沒有讀取 auth.json、授權碼、cookie 或搬用既有憑證。

本輪為修正 Codex 初始化而正常關閉並重開候選；新程序仍讀回兩家的 pro 訂閱，不需重新登入。這是 CLI 訂閱登入延續，**不是其他網站登入驗收**。

## 找到並修正的問題

首次從真實 UI 建立 Codex 對話，官方拒絕 `thread/start`（-32600），還沒開始模型回合。停下候選後，透過同一隔離執行器與 K controller 取得原始錯誤：

`failed to load configuration: invalid transport in mcp_servers.k_flash`

K 原本用 `{enabled:false}` 覆寫 MCP。官方即使停用也會驗證 transport；乾淨 home 沒有舊設定補足 command，因而失敗。不是登入失敗，也不是 Sandboxie 擋了模型請求。

最小修正：

- `src/codex-host.mjs`：提供完整但停用的設定 `{enabled:false,command:process.execPath,args:['--version']}`。不啟動 MCP；即使誤執行該命令也只印版本，不提供工具。
- `src/desktop-controller.mjs`：停用 Flash／未啟用瀏覽器都用完整設定，仍覆寫可能繼承的同名 MCP；不依賴舊 home。
- `src/luna-bridge.mjs`：同一已觀察根因也存在於 Claude→Luna 的停用 Flash 設定，一併修正。
- `test/desktop-switch.test.mjs`、`test/desktop.test.mjs`、`test/luna-bridge.test.mjs`：核對完整停用設定；切換測試的 fake native host 也驗證 transport，避免再把不合法設定當通過。

未改核准模式、沙箱、ACL、WFP、帳號、計費或正式開關。真實官方 `thread/start` 修後成功；診斷沒有送模型回合。診斷結束時背景額度查詢因 host 正常關閉而收到停止錯誤，原始紀錄保留，不將它算成初始化失敗或模型測試。

## 真實模型與右側 UI

不是 fixture：以 K 自己的主聊天輸入框送出，經 Sandboxie 內真正官方 CLI、原生工具核准、可信端 owner browser，再由 K 右側畫面操作。兩家各 3 個簡短模型回合，沒有 shell、工作檔案或外站存取。Codex 的保存紀錄顯示：先透過原生 `exec` 執行 JavaScript 列舉工具，再透過 `exec` 呼叫 `tools.mcp__k_browser__*`；這條工具協調執行路徑已實際跑過，不能概括成「所有原生程式執行皆未驗證」。未驗證的是該執行器完整能力／隔離邊界，以及一般 shell 命令；工具回傳不能單獨證明 `exec` 內部在哪個程序執行。

| 驗收 | Claude Opus 5.5／手動核准 | GPT-6 Astra／要求核准 |
|---|---|---|
| 讀本機假頁 | 標題 K FAKE ONLY，欄位 EMPTY | 相同 |
| 原生核准 | navigate、snapshot 都顯示單次核准 | navigate、只讀 DOM evaluate 顯示單次核准；snapshot 沒問人 |
| 右側真實畫面 | 看見同一標題／欄位 | 相同 |
| 從右側人工接手輸入 | HUMAN_CLAUDE_20260926 | HUMAN_CODEX_20260926 |
| 接手期間再呼叫 snapshot | 已核准仍被 K 拒絕 | 被 K 拒絕（原生此工具不要求核准） |
| 交回 AI 後實際讀回 | HUMAN_CLAUDE_20260926 | HUMAN_CODEX_20260926 |

兩家的拒絕原文均為 `Browser operation denied: browser is in human-control mode or unavailable.`；兩者拒絕後都停止、沒有繞路。Claude session 的 tool output 與 Codex 原生 rollout 的工具回傳可供複查，不只採信模型最後文字。

操作人補充：兩次 `HUMAN_*` 假文字均由 Astra 透過電腦操作工具操作 K 右側介面，模擬人工接手，不是使用者本人輸入。當輪操作方式是右側「Tab」選到假頁欄位，再從「輸入文字到目前網頁欄位／送出文字」送入，並非直接修改頁面 DOM。使用者本人完成的是先前官方訂閱登入，不能把登入操作者與本段測試操作者混為一談。

證據限制補充：主代理當時在工具回傳中查看過 1440×900 全頁截圖，觀察右側並非白畫面，但沒有將截圖、完整接手操作軌跡或核准請求／回應匯存到本輪證據目錄。上表的畫面、輸入路徑和核准提示屬於當輪操作觀察，不能只憑保存的模型讀值獨立重驗；模型工具的拒絕及讀值則有原始回傳證據。這是每秒快照，不是真實瀏覽器視窗／影片；沒有測密碼管理器、CAPTCHA 或其他帳號。

## 測試與證據

證據目錄：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\live-model-20260926\`（Git 排除）。

- `claude-ui-tools.json`：K 的本次三回合訊息與真實 tool output。
- `codex-ui-tools.json`：只取本次假頁對話的 user／assistant 訊息及工具呼叫、工具回傳；不含 auth 檔或 reasoning items。
- `codex-start-before.json`、`codex-start-diagnostic.json`：相同隔離執行路徑修前／修後。
- 三個 `.mjs.before`：候選更新前副本。一次性重現腳本在候選根目錄 `diagnose-codex-start.mjs`；只在候選已停止、八盒空閒時執行，沒有模型回合。
- 首次 focused 62/63：產品修正後，唯讀瀏覽器斷言仍是舊 `{enabled:false}`；已更新斷言，失敗紀錄保留。
- 首次無篩選 `node --test` 誤將兩個刻意失敗的 fixtures 當測試入口，433/435；保留 `regression.log`，不把這次宣稱全套通過。正確入口依 package.json 為 `test/*.test.mjs`，本輪循序重跑紀錄是 `regression-scoped.log`。
- 最終正確全套 **431/431 通過**，131.27 秒；0 失敗、0 取消、0 跳過。

## 部署與尚未驗證

- 候選正常關閉 PID 37172，修後重新啟動 **PID 49664／47971**。保留人工後續使用入口，沒有新增常駐或開機自啟。
- 正式 **47831／PID 50264** 未重啟、未替換。正式 UI SHA256 仍為 `69F730FFB39E7F4E170228BA16FB0F17AAC574D5018C3B31FE0538DD0D1F3FF0`；本輪沒有重建 UI。
- 本輪證實雙模型瀏覽器工具接線、同頁畫面、人工接手與 CLI 訂閱登入延續。外層假檔／記憶體／網路隔離證據仍見前輪候選紀錄，不能把本輪瀏覽器測試說成重新做過全部隔離攻擊。
- **Codex 原生 Windows 沙箱在新 home 回報 notConfigured。** 未初始化、未新增帳號或調整權限。外層 Sandboxie 與原生 MCP 已實測，`exec` 列舉與呼叫瀏覽器工具也有紀錄；但 `exec` 的完整能力／隔離邊界、一般 shell 命令執行、兩層沙箱相容性仍未驗收，不宣稱一般開發流程已全部可用。
- Claude→Luna 此次修正有自動測試；沒有額外啟動真正 Luna 任務。
- 右側沿用共用 UI 的舊隔離警語，尚未按候選實際狀態區分；保留「勿登入其他真實帳號」限制，而非移除警語當作安全完成。
- 正式啟用／其他網站持續登入沒有授權，仍未執行。其他網站的 cookie 重開延續只有之前假資料證據，本輪沒有新增網站登入驗證。

## 2026-09-26 複查後更正與使用者決定

- 上述操作人、證據缺口及 `exec` 範圍已依複查補明。本次沒有重跑模型回合或 UI 操作，沒有補造過去截圖，也沒有將新測試當成過去的證據。下一次相關 UI 驗收須保存截圖、操作人／步驟與核准請求／回應，且排除憑證與敏感內容。
- 帳號連接器是獨立的資料存取途徑：Codex 候選工具列舉已出現 `codex_apps` 的 Figma 工具；Claude 的 Google Drive／Claude Docs 是 Opus 在正式 K 的可見工具回報，不能據此宣稱候選 Claude 已確認。兩家連接器皆未在本輪呼叫，實際讀寫權限與核准行為未納入驗收。瀏覽器接手鎖不涵蓋它們；本機瀏覽器隔離不等於連接器權限控管。
- 使用者現已明確決定長期保留官方帳號連接器能力，**不是暫時保留，也不採用預先停用方案**。不更動現有連接器開關、全域帳號連結或服務授權；保留能力不等於任意讀寫授權。此決定已寫入 `AGENTS.md`，正式部署與其他網站登入限制不因此改變。
- 尺寸能力更正：保存的 Codex 工具列舉已有 `mcp__k_browser__browser_resize({width,height})`；底層能力並非全未接入，但沒有實際 resize 呼叫證據。右側目前依寬度等比例縮放，點擊依圖片實際寬高換算座標；尺寸變更後的畫面／點擊／接手配合尚未驗證。縮放工具與寬高雙向貼合尚未實作。
- 本次僅修正文書與規則，未改程式、未重啟或部署、未呼叫外部帳號工具；431/431 是前輪驗收及 Opus 重跑結果，不是本次新增測試結果。
