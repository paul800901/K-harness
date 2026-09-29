# App 程式派工接線狀態

日期：2026-09-14。狀態：**已實作、跨程序離線驗證通過；App 原生 coding live 尚未執行，等待重新載入 MCP。**

後續更新：使用者要求繼續驗證 K 工作流，而非停在 App 設定。本輪已由目前主代理透過官方 MCP client 實際完成 K → Pi → DeepSeek 程式派工及獨立驗收；**不是 App 原生工具呼叫**。詳見[工作流判定](workflow-verdict-20260914.md)。下文保留先前的 App 檢查歷史。

注意：預備的 `app-code-20260914-070341` 已用於這次明確標示入口的 MCP live，結果已完成；不可再用該案例假裝尚未派工，也不可把它當成 App 原生驗證。後續 App 測試需先確認新版工具，再建立新的獨立案例，不重播已完成任務。

## 本輪完成

- `src/dispatcher.mjs` 接收逐任務 coding 權限、正規化後傳給 Pi 工人。權限納入相同 requestId 比對；舊 read/create-only 紀錄仍可讀回，不因新增欄位而重跑。
- 同一派工程序內，coding 可寫檔案若與活動任務的可讀／可寫範圍重疊就拒絕開始；不同檔案的獨立工作仍可並行。沒有宣稱跨程序鎖或 OS 沙箱。
- `src/mcp.mjs` 升至協定介面版本 0.2.0；沿用四工具，在 `k_worker_start` 增加嚴格的可選 `coding` 欄位。僅含 editFiles、testFiles、timeoutMs，不接受任意命令／參數。回傳交接也包含 coding。
- 因工具可以修改既有程式檔，開始工具的 `destructiveHint` 改為 true；主代理仍須有任務授權。未指定 coding 時不提供修改或測試工具。
- 新增 3 項派工測試、2 項實際 stdio MCP 測試。完整 `npm test` 為 41／41 通過，包含權限傳遞、重啟不重播、變更權限拒絕、同 host 衝突、真實子程序修復及固定測試、取消後保留原文備份與已完成修改。

## App 目前證據

在既有 App 任務「驗證 Astra 在 App 派工給 Flash」（`01a09e77-5916-76c3-b880-ed1c541917f7`）進行只讀原生工具 schema 檢查。該任務位於 `D:\K-harness`；本輪沒有建立新 App 任務。

該輪於 UTC 約 07:04:50–07:05:07 完成，實際回報原生 `k_worker_start` 仍只有 requestId、task、readFiles、outputFiles，尚無 coding。它依交接要求停止，没有呼叫 start、修改設定或改走 CLI／自製 MCP client。

原主代理另讀回：`.runtime/jobs/app-code-20260914-070341` 不存在。此次沒有新增 Flash live 工作；前輪直接工人的成功不拿來替代 App 證據。

預備的人工案例在 `.runtime/app-tests/code-20260914-070341/`：

- `summary.mjs`：刻意含四個錯誤，等待 Flash 修改。
- `checks.mjs`：唯讀固定測試，基線已重現失敗。
- `request.json`：固定 requestId `app-code-20260914-070341`，明確授權兩個輸入、一個可改檔案、10 秒固定測試；沒有其他資料或任意命令。
- `parent-evidence/test-wmuBB7/result.json`：本輪人工案例基線的實際失敗結果。

這些案例只在 Git 排除的本機 `.runtime`；不改正式程式或使用者資料。既有 key 沒有搬移／修改，測試程序沒有取得 key。

## 下一次接續

依 [OpenAI 官方 MCP 文件](https://learn.chatgpt.com/zh-Hant/docs/extend/mcp)，在 App 的 MCP 伺服器設定重新啟動伺服器。不要新增另一個 k_flash、改金鑰、修改全域設定或先重送任務。目前沒有可用的 App 工具讓本代理直接重啟該 MCP；也未強制終止 App／MCP 程序。

重新載入後，先在既有 K App 任務確認原生 schema 已有 coding；再核對固定 job ID 尚未執行，才以 request.json 原樣呼叫原生 start 一次並事件等待。原主代理讀回 diff、測試檔、備份及實際測試結果後，才判定 App 接線 live 是否通過。若 schema 仍舊，保持未派工狀態並回報，不把程式碼中的新 schema 當作已載入。

## 保持不變

全域 config.toml SHA-256：`DEE59BACBE57F5DDBB836849259EC256C8A5246920CEF2307D6C28DB43ECA46F`。

K `.codex/config.toml` SHA-256：`E83EAED986212B7DB9E0B0C0904D0A31DE3F2B0580A13EAB5712ED5A9BB57D63`。

本輪沒有安裝／升級依賴、改模型、複製秘密、改 KAI／DSH、發布或提交 Git。OpenAI Docs 技能用於核對專案 MCP 載入與重啟方式；實作與執行狀態均以上述本機證據為準。
