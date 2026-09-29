# Playwright MCP 啟用前修正

對應 `opus-review-browser-mcp-20260924.md`。正式 `.runtime/browser-mcp.json` 不建立，正式 47831 不重啟、不變更對話。

## 根因與變更
- 原先僅用 enabled 開關，不看存取模式。`readBrowserMcpConfig` 改要求 provider/accessMode；唯讀、Claude 計畫與未知模式不給工具。Controller 切換驗證另見 `browser-permission-fix-20260924.md`。
- 僅把 cwd 改小不夠：已安裝 Playwright `coreBundle.js` 的 initializeServer 會採 client roots 第一項覆蓋工作目錄。因此新增小型 stdio 入口，沿用官方公開 `createConnection` 和既有 MCP transport；固定 roots、cwd、outputDir 為該對話 `.runtime/browser-output/<id>`。Claude 不支援 Codex 的 MCP cwd 欄位，入口自行 chdir，兩邊一致。
- 入口在將 upload/drop 交給官方工具前用 realpath 檢查來源；外部路徑（含假 `.env.local`）直接回報工具拒絕，不先開瀏覽器或讀檔內容。符號連結解析後也須位於專屬目錄。
- 上游 `browser_run_code_unsafe` 的 code-origin 存取明確豁免檔案 guard，因此 K 不列出該工具且直接呼叫也拒絕。關閉自動提供網頁 WebMCP 工具，避免本輪驗證以外的額外工具面。
- 這些是工具層約束，不宣稱是作業系統沙箱，也不保證能抵抗惡意本機程序的檔案競態；官方 MCP 本身亦非安全邊界。原生主代理的既有 shell/其他工具權限未被此變更擴張或縮減。
- `AGENTS.md` 補記使用者在安裝前已明確回覆的專案限定安裝授權；不是事後追認。

## 隔離驗證
`test/browser-mcp-boundary.test.mjs` 使用真的 stdio 入口與已安裝 Playwright，測試 Client 主動宣告 project-wide roots：
- tools/list 可讀、unsafe code 不列出，直接呼叫亦拒絕。
- 測試工作區 `.env.local` 只有 `FAKE_NOT_A_KEY`；browser_file_upload 與 browser_drop 都被拒絕。
- 沒有網站外發、未碰真金鑰，也沒有開啟瀏覽器。這是實際工具拒絕，不是網站檔案上傳 UI 的端到端驗收。
- 同目錄一般檔案通過路徑檢查；沒有用成功上傳去冒充核准測試。

## 網路與原生核准
瀏覽器屬外部 MCP 程序，不受 Codex 命令沙箱 networkAccess:false 限制；UI 必須單獨揭露。核准依兩家原生模式，不能從『要求核准』文字推定每次 browser tool 都詢問。

未新增任意網站 allowlist：使用者尚未指定工作網站，且上游明示 origin 清單不涵蓋重導等所有情形，不是可靠網路隔離。功能繼續預設關閉；正式使用需另外驗證原生核准、真實瀏覽器接手及網站範圍。

原生模式探測結果另見 `browser-native-approval-probe-20260924.md`；只可依各列的實際證據判斷，不以 mock 測試概括。

## 本輪最終驗收
- 主代理獨立重跑完整測試：311/311 通過，0 失敗；`.runtime/browser-security-tests.log`。首次重跑發現舊測試仍預期只停用 k_flash，已更新為亦明確停用 k_browser 後重跑全套。
- `npm run build:ui` 成功，既有超過 500 kB 的 bundle 提醒仍在。
- 47844 隔離 UI 的權限選單實際顯示「瀏覽器已啟用：可存取網路與網站；不受命令沙箱網路限制，核准依原生工具政策」。測試頁、隔離服務均已關閉。
- 四個原生新回合中，只有 Codex auto-review 真的提出工具並在原生審查被拒絕；Codex workspace-write、Claude manual/auto 未形成工具呼叫。第 3 項的網路揭露已實作，但核准驗收仍不完整。後續測試應允許原生必要的 ToolSearch/schema discovery，再限定單一無外發負向工具；不能把沒有提示誤認成已放行。
- 正式 `.runtime/browser-mcp.json` 仍不存在。沒有重新啟動 47831、沒有讀取真金鑰、沒有建立正式瀏覽器工作。右側瀏覽器畫面與人工接手仍未交付。

## 精確程式範圍
`src/browser-mcp-config.mjs`、`src/browser-mcp-stdio.mjs`：模式與檔案邊界。
`src/desktop-controller.mjs`、`src/claude-controller.mjs`：原生配置及模式切換；Codex 停用時明確送 k_browser.enabled=false，重新開啟後再檢查忙碌狀態；browserAccess 僅成功後設為啟用。
`frontend/permission-picker.jsx`、`frontend/main.jsx`：網路權限揭露。
`test/browser-mcp-config.test.mjs`、`test/browser-mcp-boundary.test.mjs`、相關 controller 測試及 `test/desktop-switch.test.mjs`：回歸。
`AGENTS.md`：補記既有專案安裝授權。保留同工作區其餘既有變更，未提交或推送。
