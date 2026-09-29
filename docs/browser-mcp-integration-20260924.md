# 專案限定 Playwright MCP 接線（2026-09-24）

> 本文為首次接線紀錄。啟用前修正以 [browser-security-fix-20260924.md](browser-security-fix-20260924.md) 為準：入口已改為固定對話目錄的 stdio wrapper，唯讀／計畫模式停用，工具數由 25 改為 24。原生核准尚有未驗證模式，現在不要依下列範例啟用正式設定。

## 範圍與啟用方式

已安裝專案依賴 `@playwright/mcp@0.0.82`，並提供 Codex／Claude 原生主控的可選接線。預設關閉；只有 K 專案根目錄的 `.runtime/browser-mcp.json` 明確設為以下內容才啟用：

```json
{"enabled":true}
```

此檔屬於 `.runtime` 本機設定，不含帳密或 token。未建立檔案或設為 `{"enabled":false}` 時不提供 browser MCP。拒絕未知設定欄位，避免透過設定傳入其他可執行命令、profile 或登入狀態。停用時刪除該設定檔或改回 `false`，再重新開啟對話即可。

啟用後每個原生對話的 MCP 組態增加獨立名稱 `k_browser`，直接使用本專案已安裝的 Node CLI。每次對話組態使用專屬 `.runtime/browser-profiles/<conversation-id>` `--user-data-dir`，避免並行對話爭用同一 profile；不會讀取 Chrome、Edge 或其他既有使用者 profile，也沒有 `--storage-state`、外部 browser attach、`npx`、自動安裝瀏覽器或自動登入。server 只在建立該對話時按原生 MCP lifecycle 啟動；本接線不預先啟動 browser，瀏覽器動作需等對話明確呼叫 browser tool 才會開始。該 K 對話自己的 profile 會留在 `.runtime`，不會跨對話共用。

Codex 設定只在該次 `thread/start`／`thread/resume` 增加 `k_browser`，仍保留 `k_flash` disabled；不變更 worker、Flash 用量探測、全域 MCP 設定或原生登入。Claude 對話沿用既有 `k_luna` gateway 並加上 `k_browser`，不覆蓋工人 server。該能力由各原生 core 對話接管，不會由 K 暗中把 browser tool 呼叫派給工人。

## 驗證與限制

- `npm install --save-exact @playwright/mcp@0.0.82` 完成；鎖定版本 `0.0.82`，其 package metadata 要求 Node.js `>=18`。
- 單元與接線測試涵蓋預設關閉、明確啟用、設定檔失敗關閉、隔離參數、保留 `k_flash`／`k_luna` 與名稱衝突。對應 Codex、Claude controller 接線驗證通過。
- 另以本機無帳號 fixture 啟動已安裝 MCP stdio server，僅執行 initialize / `tools/list`，回傳 Playwright server 版本與 25 個工具；未呼叫任何 browser tool，未控制任何瀏覽器 UI，也未使用真實模型或帳號。
- 未驗證真實 Codex／Claude 模型呼叫、登入態延續、持久 profile 或同一瀏覽器人工接手。Codex 在新對話建立時尚無 native thread ID，因此初次 profile 使用隨機 ID，之後重新開啟時以 native ID 組態；本輪未建立或驗證兩者映射，不宣稱新建後重新開啟可延續登入態。沒有嵌入 browser 顯示或 K 內人工接手 UI，因此不能視為已完成嵌入式瀏覽器協作。
- 本變更尚未部署為正式桌面執行狀態；使用者需自行在 K 專案 `.runtime` 建立啟用檔並重開對話。

## 本次檔案

可重跑唯讀協定探測：`.runtime/browser-mcp-list-tools-proof.mjs`；實際讀回：`.runtime/browser-mcp-proof.json`。主代理已讀回 25 個工具清單與腳本；僅 initialize/listTools，沒有啟動瀏覽器操作，不能當作網頁操作驗收。

- `package.json`、`package-lock.json`：新增固定版本依賴。
- `src/browser-mcp-config.mjs`：專案 opt-in 讀取、CLI 設定與保留既有 MCP server 的合併。
- `src/desktop-controller.mjs`、`src/claude-controller.mjs`：各自的原生對話組態接線。
- `test/browser-mcp-config.test.mjs`、`test/desktop.test.mjs`、`test/claude-controller.test.mjs`：設定與 provider 接線測試。
