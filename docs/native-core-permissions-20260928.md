# K 原生核心權限切換 — 2026-09-28

## 授權與範圍
使用者要求移除 K 額外權限／Sandboxie，保留工作區及原生 Claude Code、Codex 權限。本人已停止 K，明確授權直接完成修正並重開。沒有授權將所有模式固定為完整存取；本次也沒有這樣做。

## 實作
- `src/isolated-launcher.mjs`：既有入口保留檔名及狀態位置，正式預設 native；不建立 Sandboxie pool、不呼叫 workspace ACL 管理、不需要 Start.exe/bridge。舊 sandboxie 分支僅供原有試驗，不自動 fallback。
- `src/isolated-desktop.mjs`：native 分支直接接 openCodexHost/openClaudeHost；不注入 externalSandbox。Codex 主代理與 Luna bridge 都沿原生 thread/turn 權限；Claude login/inspection/session 同 home、原生 spawn。保留已選工作区的登記與合法目錄檢查，不另封鎖使用者家目錄。
- `src/desktop-server.mjs` / `local-launcher/KTrayLauncher.cs`：正式 health 為 native，仍確認 K 身分、既有 stateRoot 及啟動控制通道。
- OS 工具使用真正 USERPROFILE/APPDATA/TEMP；CODEX_HOME 與 CLAUDE_CONFIG_DIR 保留原 K 路徑，不讀寫憑證明文。API 認證環境不轉交，訂閱計費路徑不變。

## 證據與限制
- 128/128 回歸，含四種 Codex 原生模式的 start/resume/turn、無 externalSandbox、Claude 原生模式與關閉、既有瀏覽器邊界。`.runtime/native-core-20260928/regression.txt`。
- ffmpeg 8.1.1 可直接從本人 WinGet 安裝位置執行，不複製、不安裝。Claude 原生 inspection available=true、版本 2.1.280。未送出模型回合。
- Codex 首次未配置 windows.sandbox 時 CLI sandbox 的 ffmpeg -version 成功但 readiness=notConfigured；不能把此當成完整原生設定驗收。
- K 專用 Codex config 已備份；測試原生 Windows 設定時發現執行等待超出短時限，UE/elevated與既有新版CLI對照紀錄均保留。elevated 由官方 setup 自動重套 CodexSandboxOffline/Online、原生防火牆及工作區 ACL（log `.codex/.sandbox/sandbox.2026-09-27.log`），不是 Sandboxie；未手動新增服務、下載套件。仍在處理，尚未宣告正式完成。
- 參考官方原生 Windows 設定：https://learn.chatgpt.com/docs/config-file/config-basic 。目前測試不更改全域 Codex config。

## 正式部署
待本輪最後驗證及讀回補記。舊資料與還原備份保留。

## 02:22 完成正式套用與讀回
- 已停止狀態確認：47831 無監聽、K owner/tray 無殘留後才覆蓋。3 個正式 JS 模組及 tray exe 均備份並計算雜湊；收據 `.runtime/native-core-20260928/deployment-receipt.json`，備份 `.runtime/native-core-20260928/backup/`（含原 Codex config）。
- K 專用 Codex 最終設定僅新增 `[windows] sandbox="unelevated"`，使用官方原生非提權 Windows sandbox。不保留私有桌面 false 試驗、不改全域 config、不更新 CLI、不換模型或計費。原生 default sandbox/permission 仍由每個既有模式的 thread/turn 參數決定。
- 首次已配置原生命令實測有約 73 秒啟動等待（02:19:14 START → 02:20:27 SUCCESS）。此輪最初 20–30 秒試驗因此失敗；根因尚不能精確歸因為 ACL 或 Windows 初始化。等待完成後，大工作區 D:\K-harness 與預設 private desktop 的正式命令均成功，後三次 START→SUCCESS 約 341ms、57ms、57ms；沒有增加 K retry/fallback 或關掉原生 sandbox 來通過。
- 使用**正式 runtime 模組**與原 K 訂閱 home 測試：`native=true`、accountHomesPreserved=true、Claude available=true（只 inspection，不送模型回合）、Codex readiness=ready；`command/exec` 明確 workspaceWrite 政策呼叫原 WinGet ffmpeg -version，exitCode=0。證據 `.runtime/native-core-20260928/formal-probe-result.json`。
- 正式 K 啟動→正常關閉：READY、CLOSED confirmed=true、EXIT 0，證據 `formal-exit.txt`。再從原 tray exe 正式重開，02:22:07 ready；health `deployment=native`、原 private-state 路徑不變。
- 未呼叫 Opus 或其他模型來做迴圈測試，未動日常 Chrome、登入憑證或既有影片；使用者那 13 支影片的抽圖工作未代為執行，不宣稱已完成。
- 128/128 最終回歸通過；Luna 僅只讀審查原生權限與設定接法，主代理實作、讀回與部署。
- 保留舊檔名／狀態路徑及少量 launcher 舊 isolated 日誌字樣，避免搬移資料；以 health native、實際無 pool/workspace ACL 路徑及正式命令證據判斷，不把歷史名稱當隔離仍啟用。Sandboxie 安裝／歷史試驗保留，本輪未卸載或改其設定。

## 還原
停止 K 後，將 backup/src 三檔與 backup/K桌面啟動器.exe 還原各原位置，另可還原 backup/codex-config.toml 到 K agent-home/.codex/config.toml。這會回到舊 Sandboxie 路徑，只有明確要求時才執行，不自動退回。
