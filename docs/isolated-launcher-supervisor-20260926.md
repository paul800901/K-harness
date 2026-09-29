# 隔離版 K owner supervisor 與托盤接線（2026-09-26）

後續邊界、模型、UI 與部署結果見[整批收尾](closeout-20260926.md)，以下保留實作階段紀錄。最終編譯候選為 `K桌面啟動器-candidate-3.exe`；是否正式採用須依總表讀回，不以編譯成功推定上線。

## 本輪範圍

- 新增 `src/isolated-launcher.mjs`：固定採用既有 candidate root `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee` 下的 trusted runtime/providers、Sandboxie runner boxes、agent-home、owner browser profiles、已授權 `workspace`，HTTP port 固定 47831。
- 正式狀態根目錄使用 vault 下新的 `vault\private-state`；既有候選 `vault\state` 與其他資料未讀取、修改或搬移。候選假頁 server／trace／lifecycle 記錄不在正式 supervisor 路徑。
- 隔離桌面可將同一固定 workspace 顯示為「私人工作區」；`/health` 增加 `deployment: "isolated"`。isolated deployment 必須同時使用 launch-token gate；health 只作服務身分辨識，不取代 Sandboxie/WFP 邊界。
- `local-launcher/KTrayLauncher.cs` 只啟動固定 trusted-runtime 的 `isolated-launcher.mjs`，不再呼叫一般 `Start-K-Desktop.ps1`。Node、入口模組、隔離目錄、provider binary 缺漏，pool 預檢失敗或 port 被其他程序使用時均 fail closed，沒有標準 host fallback、HTTP stop、程序強殺或接管外部服務。
- 新 state 目錄由 owner 在已存在 vault 下建立；程式不設定 ACL。真正啟動前仍須主代理讀回確認該新子目錄實際落在現有 vault 的模型拒絕邊界中；程式路徑檢查本身不證明有效 Sandboxie policy。

## 托盤與 supervisor protocol

- Supervisor stdin 接受純文字 `open\n`、`close\n`。
- 啟動在 stdout 發一行 `{ "type":"ready", "origin":"http://127.0.0.1:47831", "pid":..., "launchUrl":".../bootstrap?token=..." }`；`open` 回覆相同欄位但 `type:"open"` 並生成新的一次性 60 秒 URL；正常關閉後發 `{ "type":"closed", "confirmed":true, "pid":... }`。
- C# 驗證 Node PID、固定 origin／port、bootstrap 路徑與 64 位 hex token，並驗證 health 的 `deployment` 及 state-root 路徑。只有符合時才把 launch URL 交給瀏覽器。stdout URL 絕不可寫入 launcher log 或持久化；C# 只記錄 URL 已收到的脫敏狀態。
- `close` 前檢查目前與已開啟房間的 busy、待回答問題、排程訊息及可見未結束 workers；有活動回傳 `type:"error", code:"active-work"`，托盤顯示先完成／停止的提示，不強制終止。若關閉未被確認，supervisor 保持可重試，托盤不會重啟。
- 此 API 以 owner 私有 stdio 作為 browser bootstrap capability 交接，不是網路端點，也不是完整本機使用者／程序隔離。其安全性仍依既有可信 launcher、固定 trusted runtime/provider、Sandboxie pool 及端口保護。

## 驗證與狀態

- 單元／整合測試：`node --test test/isolated-launcher.test.mjs test/isolated-desktop.test.mjs test/desktop-native-events.test.mjs test/desktop.test.mjs`，50/50 通過。測試使用 mock supervisor/pool，不啟動模型或 Sandboxie。
- C# launcher 以既有 .NET Framework `csc.exe` 編譯成功，候選產物僅寫入 `D:\K-harness\.runtime\closeout-20260926\launcher-candidate\K桌面啟動器-candidate-2.exe`；未執行、安裝、覆寫既有 launcher、啟動／停止服務或實際送出 bootstrap URL。
- 尚待主代理檢視 diff、把 trusted-runtime 中 supervisor source 與 dependencies 安全同步至固定路徑、串接正式托盤 binary、讀回 47831 的實際 health／policy、完成已授權的 Codex safe-command fake probe 和真正候選模型 UI 驗收。未宣稱正式部署或 live 驗收。
- 外部 sandbox、帳號／ACL／WFP 沒有在此檔設定或變更。Codex `externalSandbox` 的實際安全路徑由主代理另行驗收；本輪程式不靜默放寬 Codex 權限。

## 最終唯讀啟動路徑驗收（2026-09-26）

> 以下為部署前靜態審查；其後已完成真正 47831 監聽時的 WFP 拒絕與 private-state 假檔拒絕，UI 也已確認兩家訂閱仍登入。實測和最終正式啟動狀態見 [整批收尾](closeout-20260926.md)。

### 目前固定接線

- `local-launcher/KTrayLauncher.cs` 僅啟動固定 candidate 的 `trusted-runtime/src/isolated-launcher.mjs`，不回退一般 host；只接受自身子程序 PID、固定 `127.0.0.1:47831`、一次性 bootstrap URL，以及 `/health` 的 `deployment=isolated` 和 `workspace=vault/private-state`。托盤控制走私有 stdio，不用 HTTP stop。
- `src/isolated-launcher.mjs` 建立/使用 `vault/private-state` 作為 K session/state root；將固定 candidate `workspace` 設為 agent workspace，並用「私人工作區」標示。`src/isolated-desktop.mjs` 限制 workspace selection 仍只能回到該固定目錄，兩者不混用。
- provider/命令工具經同一 Sandboxie pool，home 變數指向 candidate `agent-home` 的 `.codex` 與 `.claude`。目錄存在；本次沒有讀認證檔，故不聲稱帳號目前可用或仍為登入狀態。
- 候選 `Sandboxie.ini` 對各 KCandidate box 設 `NetworkEnableWFP=y`，並以 `NetworkAccess` 封鎖 loopback TCP `127.0.0.1:47831`、`:47971`；同時 `ClosedFilePath=<candidate>\vault\*` 保護 private state/profile，`ReadFilePath=<candidate>\trusted-runtime\*` 與 `...\trusted-providers\*` 將可信程式碼/執行檔設唯讀。隔離 Codex 呼叫如實使用 `externalSandbox` + `networkAccess: enabled`，所以 47831/47971 的防護依賴此 Sandboxie/WFP 外層規則，不能稱為 Codex native restricted sandbox。

### 安全界線與阻擋判斷

- 已登入的 `agent-home` 由 Sandboxie `OpenFilePath` 直接提供給盒內程序，且 provider/命令工具共用該 home。這代表模型可控制的同盒子子程序可能讀寫其自身 provider 登入資料；它不是對訂閱憑證的隔離邊界。此為目前採用已登入 CLI home 的明確界線，不等同 owner vault 或人工控制能力外洩。
- 本次程式與 policy 靜態核對未發現已授權 agent 可取得 owner vault 內 browser profile/live descriptor，或可連到 K human HTTP entry 的具體路徑：vault 命中 ClosedFilePath，K server 綁定 IPv4 loopback，WFP 規則封鎖兩個 K 入口埠；人類瀏覽器控制是 owner in-process 方法，MCP gateway 只提供 AI 端能力。啟動 URL/token 留在 owner stdio/記憶體交接，K API 尚須一次性 bootstrap 與 session cookie。沒有讀取 cookie/token 或真實憑證。
- `KTrayLauncher` 與 supervisor 本身未在本次 candidate agent child 內執行；目前用固定受保護路徑與 stdio 身分讀回，未見 agent 對 owner launcher/runtime 的具體寫入路徑。啟動前仍需部署端讀回有效 Sandboxie/WFP 狀態；靜態 INI 和程式接線不等於當前驅動/規則已生效。
- 本次僅讀檔與目錄存在性、未啟動服務或模型、未改程式/policy；此節是最後靜態接線驗收，不代表正式服務已部署或已完成 live 驗收。
