# 隔離候選一般命令、Claude→Luna 與連接器最小驗收準備

日期：2026-09-26（臺灣時間）
範圍：只整理驗收步驟與現有程式／文件證據；本文件不是 live pass。

## 結論

- 可安排一次只含合成資料的 candidate 一般命令驗收，但要區分「Sandboxie runner 的一般 Node 命令」與「Codex 原生 `exec`」。目前 UI/既有驗收紀錄明確記為 Codex Windows 原生 sandbox `notConfigured`；外層 Sandboxie 不證明原生 sandbox 已就緒。不得為了讓測試通過而初始化 Codex sandbox、改 `windows.sandbox`/ACL/帳號或放寬 policy。OpenAI 官方設定說明：原生 Windows 使用 Codex 時 `windows.sandbox` 設為 `elevated`；只有無管理權或 elevated setup 失敗才使用 `unelevated`。此資訊不構成在本機變更設定的授權：[Config basics](https://learn.chatgpt.com/docs/config-file/config-basic)。
- 不得把 `notConfigured` 當作「唯讀／拒絕寫入」的安全證明。先做既有 candidate 和有效狀態讀回；若需要 setup 或狀態不清，停止在 setup 前並交主代理裁決，不重試、不 fallback 到 host。
- Claude→Luna 現有接線會使用同一隔離 runner/home；Luna 指定 `gpt-6-luna`、`high`，沿用父對話 `accessMode` 生成原生 Codex thread/turn permissions，停用 K Flash MCP，agents 關閉。此為程式接線證據，**不是**本候選已實際啟動 Luna 的證據。
- 官方帳號連接器維持長期保留，不修改開關／帳號連結。候選驗收只列舉名稱/工具數與原生 approval/policy 狀態，不呼叫 connector，不讀真實 Drive/Figma/其他連接器內容。Codex 候選先前工具列舉含 Figma `codex_apps` 工具；Claude 的 Drive/Docs 僅有正式 K 的舊回報，候選 Claude 當前清單仍 UNKNOWN。

## 最小一次性驗收（由主代理在既有候選執行）

### 0. 停止條件與前置讀回

1. 僅使用獨立候選 `127.0.0.1:47971` 和其既定假資料 workspace；正式 K `47831` 不操作。
2. 先由主代理確認候選 PID/生命週期仍是預期版本、workspace 路徑仍固定、Sandboxie runner boxes 空閒、Codex sandbox readiness 原文及當前權限模式。不要讀取 auth/cookie/`.env`/agent-home。若候選版本、狀態或工作區不符，停止，不啟動第二個候選。
3. 確認本次未要求啟動新服務／初始化 Codex sandbox；不得藉驗收動到這些狀態。

### 1. 一般 Node 命令（候選內的 Codex `exec`；只驗 outer Sandboxie runner）

1. 主代理在明確的新子目錄 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\workspace\acceptance-probe-<UTC-id>` 放入唯一合成輸入 `input.txt`，內容例如 `K_FAKE_PROBE_<random-id>`；記錄檔案路徑與 SHA-256，不放任何真實資料。
2. 候選 launcher 將原生 provider host 放入 Sandboxie pool；未觀察到可由 owner 直接呼叫 `pool.spawnImpl` 的公開驗收入口，不要自造旁路 runner。未來如原生 Codex readiness 已由另一次授權設定為 ready，再由主代理用候選真實 Codex 工具執行一條固定、透明的 Node 命令：僅在該新子目錄讀 `input.txt`，寫 `output.txt`（不同固定字串），再讀回比對；cwd 必須正是該新目錄，無網路，限時，命令字串預先固定，不執行模型產生的任意程式碼。程序結束後讀回 Sandboxie boxes idle。Claude/Luna 不在這個 probe 內。
3. 檢查結果至少包含：子程序 exit code、stdout/stderr（先掃除可能敏感內容；此 probe 理應只輸出合成字串/狀態）、`output.txt` 內容及 hash、原輸入 hash 不變、runner 終止確認、box idle。完成後保留證據，不自動清理。
4. 在本次 `notConfigured` 狀態下，第 2 步不得執行，所以目前不能安全宣稱一般 Node 命令可測。即使未來通過，也只證明該時刻候選 Codex→Sandboxie 路徑在指定假 workspace 內完成此 Node 讀寫，不等於 Claude/Luna、其他 shell 命令或全面隔離通過；也不等於保護邊界測試。

### 2. Codex 原生 sandbox / 一般 `exec`（需主代理裁決是否可測）

目前 `notConfigured` 使原生隔離前提未成立。不得直接送一般 shell 命令或 Node 測試以探測能否繞過 setup；先保存 readiness 原文。如果官方 host 明確拒絕且沒有程序啟動，保存拒絕原文並停止。本輪不可初始化、切換 `elevated`/`unelevated`、放寬 sandbox 或退回普通主機執行。只有 setup 已由另一次明確授權且狀態重新讀回 ready 後，才可由主代理評估同一套合成 workspace probe；不能在本子任務中自行補做。

### 3. Claude→Luna（避免付費／外部呼叫）

- 本次僅讀程式／測試/狀態，不真正派送 Luna。靜態證據：`src/isolated-desktop.mjs` 的 Claude bridge 把 `executable` 和 `codexHost` 傳給 `createLunaBridge`；`src/luna-bridge.mjs` 用固定 Luna 模型與 high effort，`threadPermissions(accessMode, workspace)` 和 `turnPermissions(accessMode, workspace)` 建立原生權限，明確覆寫停用 `k_flash` MCP 並 `agents.enabled:false`。
- 如果日後另獲授權進行 live Luna 驗收，prompt 僅要求在既定新假 workspace 讀合成輸入、寫一個輸出並自我讀回；先確認 Luna thread/turn 的 approval policy、sandbox、writable root 與 network 設定。工作一旦顯示額外權限/網路/檔案核准，主代理只核准精確假 workspace 範圍且由本人決定；不核准擴大範圍，不重送狀態不明的派工。

## 核准與連接器讀回，不呼叫資料

- Codex `desktop-permissions.mjs`：`workspace-write` / `auto-review` 對一般工具均是 `approvalPolicy=on-request`、`sandbox=workspace-write`、只授權當前 workspace、`networkAccess=false`；`auto-review` 的 reviewer 為 `auto_review`。`danger-full-access` 是 `never`/`dangerFullAccess`，必須使用者明確切換，不是本驗收預設。MCP tool elicitation 與 command/file approval 在 UI 端呈現一次性核准；不應用模型最終文字代替實際核准回應。
- Claude 權限模式仍走 Claude Code 自己的原生 permission callback；不可把 Codex 原生 approval 語意推定為 Claude connector 的有效 gate。
- 連接器最小確認只接受 host/候選當前已顯示的工具名稱、server、scope/approval metadata 或原生 permission提示畫面。不要呼叫 `list`/`search`/`get` 或讀取真實 Drive/Figma 文檔以驗 gate；工具在清單出現不是已測權限、一次核准或資料外傳的證據。若工具列舉不足以揭示有效核准層，就標 UNKNOWN，不追加探測。

## 保留證據與待本人介入

建議主代理在候選既有非秘密 vault 的新 evidence 子目錄保留：時間/PID/port/候選版本與 policy readback、workspace/input/output hash、probe exit/result、sandbox readiness 原文、Claude/Luna permission configuration readback、connector 工具名稱與 approval metadata（不含 payload）。若 capture 包含模型 reasoning、token、auth/cookie 或真實文件內容，先不保存該原始 capture；只保留經檢查的最小非秘密欄位。

使用者介入：只有當 Codex sandbox setup 需要權限/管理員/改設定或測試結果需擴權時，主代理應精確說明要變更的單一設定、範圍、持續時間及讀回/還原方法後另行詢問。現階段不需要使用者重新登入，不需要本人開啟 connector 文檔，也不需要提供 Drive/Figma 文件。

## 本次未做

沒有啟動/停止候選或正式服務、沒有建立/執行 probe 程序、沒有初始化/改變 Codex/Sandboxie policy、ACL、帳號或設定、沒有呼叫真實模型/Luna/外部 connector，沒有寫入測試檔。此前 UI 文件記載的 431/431 是之前的回歸，不代表本文件步驟已跑過。

