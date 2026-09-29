# Codex externalSandbox 單次假資料驗證（2026-09-26）

## 結果

**官方 `command/exec` 接受了 `externalSandbox` 與 `networkAccess: enabled`，假資料 Node 命令正常結束，並從 Sandboxie 虛擬化路徑讀回相同輸出；此結果只證明該命令呼叫可用，不等於已證明 Sandboxie 對任意路徑／網路的隔離，或產品已接線。** Codex native readiness 回報 `notConfigured`，未執行初始化或任何模型回合。

證據：[`external-sandbox-probe-20260926.json`](../.runtime/closeout-20260926/external-sandbox-probe-20260926.json)。單次執行記錄與新增假資料位於 `.runtime/closeout-20260926/`；輸入為 `K_FAKE_EXTERNAL_SANDBOX_PROBE_20260926`。只使用專用 `KCandidate8`，`/listpids` preflight 為空，結束後 pool close 再確認該 box 為空。

## 呼叫與觀察

- 使用既有 trusted Codex executable / app-server、現有 Sandboxie runner、fresh isolated home；沒有讀取或沿用 provider login/auth profile，沒有讀密鑰、外部帳號、一般網路，也沒有模型 turn。
- 讀取本機 `.runtime/codex-protocol/v2/CommandExecParams.json` 確認 `sandboxPolicy` 形狀。只送出一次官方 JSON-RPC `command/exec`，`sandboxPolicy: {type: "externalSandbox", networkAccess: "enabled"}`，執行 fake workspace 中的 Node `-e`：讀入假 sentinel、檢查 Node 與 Git 版本、以 `wx` 寫出 JSON。
- Codex 回應 `exitCode: 0`，stdout 為 `{"status":"passed","node":"v24.14.1","git":{"status":0,"error":null,"version":"git version 2.51.0.windows.1","stderr":""},"inputMatched":true}`，stderr 空；沒有官方 protocol error。
- 最初嘗試在 box 關閉後從 host workspace 讀 `probe-output.json` 得 `ENOENT`。只依該已知輸出檔路徑唯讀查看 Sandboxie 虛擬化目錄後，確認內容與官方 stdout 相同。原因與既有設定相符：`Sandboxie.ini` 的 `OpenFilePath` 只列候選內 `...\workspace\*`；本次 workspace 位於該候選外，`FileRootPath` 因而將寫入導向 box 的虛擬化樹。這不是命令寫入失敗；盒外原 workspace 仍未有該檔。沒有掃描其他 box 資料、改設定或重送命令。
- Sandboxie 正常關閉並讀回 box 空閒；沒有更動候選或正式服務。文件時間使用本機台北日期，原始 JSON 時間戳為 UTC。

## 隔離版接線（程式／測試已完成，無原生 thread/turn live 驗證）

- 現有 `src/desktop-permissions.mjs` 將使用者模式集中轉成 `thread/start`、`thread/fork` 與每回合 `turn/start` 參數，`permissionMode()` 明確不接受 `externalSandbox`；`src/luna-bridge.mjs` 也呼叫同一組 mode mapper。不要把 `externalSandbox` 加成全域一般存取模式，也不要把它映射成 `read-only`。
- 已新增 isolated-only `isolatedCodexSandboxPolicy()`，只由 `src/isolated-desktop.mjs` 注入主 Codex controller 與 Claude→Luna Codex bridge；兩者在每次 `turn/start` 使用同一 policy helper。一般部署未注入該 helper，既有 `desktop-permissions.mjs` 映射不變。既有 candidate Sandboxie policy 明示 `AllowNetworkAccess=y`，而沒有原生證據可說 `externalSandbox.networkAccess:'restricted'` 會讓它封網，因此隔離版各存取模式均如實送 `networkAccess:'enabled'`；thread/turn 保留原有 `approvalPolicy` / `approvalsReviewer`。主代理 state 暴露 `executionPolicy`，且既有 UI 原生通知呈現「一般程式連網」警告；既有核准 UI 的 `networkApprovalContext` 原生詳情欄位不作替換。
- isolated 的 read-only 在任何 `thread/start` 前清楚拒絕：candidate readiness 為 `notConfigured`，不能證明 app-server `readOnly` 有原生 enforcement，Sandboxie 外層 `externalSandbox` 也不是 read-only。沒有退化或偽標示唯讀。
- focused tests 確認 isolated main Codex 與 Luna 的 turn payload、native approval/reviewer 欄位與 `networkAccess: enabled`，並確認 read-only 不會建立 thread；主代理 state／原生通知也有一般程式網路提示。這些是 fake-host 單元／整合測試，**未跑真實 thread/turn、模型回合或候選服務**。
- 此命令 probe 只驗證命令參數與 sandbox policy 被官方 app-server 接受，並讀回 Sandboxie 虛擬化輸出。native `notConfigured`、無外網測試、未跑 thread/turn，都是明確限制；它不是正式部署、網路隔離、產品整合或 live acceptance。

## 範圍與限制

此後續實作只改 isolated Codex provider policy seam 與其 focused tests；未改 Windows 設定、帳號、ACL、Sandboxie policy 或正式／候選服務；未登入、讀取 auth、呼叫模型、連外或永久刪除任何資料。測試假資料與 fresh home 保留供複查。thread config 仍用官方支援的 native `sandbox` enum；真正外層 policy 在各 turn 明確送出，候選啟動／恢復行為仍需由主代理安排假 workspace 環境後做原生 app-server 驗證。
