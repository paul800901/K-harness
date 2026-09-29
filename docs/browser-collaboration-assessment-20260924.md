# 瀏覽器協作接入評估

## 使用者目標
右側主要是成果與可觀察、可接手的瀏覽器；子代理為次要頁面。技術資訊留後台。核准留在輸入框上方。

## 2026-09-24 實際讀回
- K 由 `local-launcher/KTrayLauncher.cs` / `Start-K-Desktop.ps1` 使用 Chrome/Edge `--app` 開啟本機網頁，不是已具備多 WebView 的桌面容器。
- `src/desktop-server.mjs` 使用同源 CSP；不能把任意網站 iframe 當成已接通的瀏覽器。不能為了嵌入取消現有安全策略。
- Claude 經 `src/luna-gateway.mjs` 產生 MCP 設定，Codex 經 `src/workspaces.mjs` / `src/desktop-controller.mjs` 設定原生程序工具。新增瀏覽器工具應走這兩條公開原生入口，不另建 LLM loop。
- 目前 package.json 未宣告 Playwright、Puppeteer 或 Electron；沒有確認過現成可重用的 K 瀏覽器控制服務。

## 官方/上游來源及判斷
1. Microsoft Playwright MCP： https://github.com/microsoft/playwright-mcp
   提供 MCP 工具、可選 browser channel、CDP 接入、獨立 profile、現有瀏覽器 extension；Apache-2.0。適合提供兩家原生代理共同使用的瀏覽器工具，不需它另選模型。上游明示 MCP 本身不是安全隔離邊界。
2. OpenAI Computer Use： https://learn.chatgpt.com/docs/computer-use
   文件說明桌面 App 外掛及 App 權限；此次查閱未建立「可把 App 內嵌瀏覽器元件直接嵌入第三方 K」的公開 SDK 證據。不能從本對話能用 CUA 推論 K 也能直接呼叫。
3. Browser Use Web UI： https://github.com/browser-use/web-ui
   有 Python/Web UI/VNC 現成方案，但標準設定要求模型 API keys；直接照搬會引入另一套代理執行與可能不同計費。此次不採用，不安裝 Docker 或讀取既有瀏覽器登入資料。

## 最小落地順序
1. 先完成人類面板與 inline 核准，不放假的瀏覽器分頁。
2. 經使用者確認，只在 K 安裝固定版本 Playwright MCP，使用專用 profile；先以無帳號、本機測試頁驗證原生 MCP 的開頁、讀取、點擊與關閉。
3. 再驗證 Claude/Codex 原生核心實際可呼叫；避免只用手工 MCP 呼叫代替模型驗證。
4. 右側 live view、放大與人工接手需選有公開接口的視圖/串流方案。單純 MCP 工具不等於內嵌協作 UI。不得用獨立 iframe 假裝與 AI 控制同一頁。
5. 人工登入、同一 session 延續、接手期間禁止 AI 操作、停止/切換工作區清理分別驗收。只管 K 專用程序，不終止使用者瀏覽器。

## 本輪邊界
本檔是已完成來源查證的接入評估，不是已接通報告。使用者本輪已回覆「允許，限 K 專案安裝與隔離驗證」；後續安裝及接線證據另見 browser-mcp-integration-20260924.md。不修改全域、不改計費、不登入、不部署正式服務。
