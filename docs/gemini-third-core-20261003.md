# Gemini 第三原生核心（2026-10-03）

## 使用者決定與範圍

使用者在 Flash 部署後追加要求：K 從 GPT／Claude 雙核心升級為 GPT／Claude／Gemini 三核心，Gemini 主代理先列出目前全部可用模型，並保留 Gemini 3.8 Flash 子代理。這是個人工作台，不新增管理平台、第二套代理核心、API key 或計費路徑。尚不存在於原生目錄的 Gemini 4 Pro 不列入。

## 差異與檔案

- `src/gemini-controller.mjs`：使用官方 agy `-p --output-format stream-json`，每個回合送新指令；後續以官方 `--conversation` 原生 ID 接續。K 只保存聊天呈現與必要 ID，歷史／壓縮由 agy 管理。模型與推理選項從 `agy models` 取得，選擇精確對應官方 model ID，不切換供應商或重播失敗工作。文字、文件附件、成果、改名／釘選／封存、停止與共用待送佇列接入既有控制器。
- `src/gemini-worker.mjs`：共用依 LOCALAPPDATA 推導執行檔的位置，串流解析加入事件回呼；保留已驗證的 Flash 權限與取消實作。
- `src/gemini-login.mjs`、`src/desktop-server.mjs`：可從「帳號連線」開啟官方 agy 互動程式，由本人處理登入。agy 負責 Windows 登入狀態與外部預設瀏覽器；Chrome 為預設瀏覽器時會開 Chrome。K 不讀 Chrome 登入檔、密碼、授權碼或 Windows 憑證，不接收 Google 授權碼。目錄查詢成功只標示「由官方管理」，不冒充已驗證登入。
- `src/isolated-desktop.mjs`、`src/unified-controller.mjs`、`src/main-sessions.mjs`、`shared/model-provider.mjs`：第三供應商路由、共同對話索引與獨立目錄失敗；沒有 agy 不會把 Gemini 工作交給 GPT／Claude。跨供應商分支沿用明確交接，不搬原生歷史。
- `src/archive-delete.mjs`：既有「刪除指定已封存對話」包含 Gemini 的 K 投影；不刪原生 profile 或登入資料。本輪沒有執行使用者資料刪除。
- `frontend/model-picker.jsx`、`frontend/main.jsx`、`frontend/permission-picker.jsx`：第三提供者、原生模型／推理清單與 Gemini 專用權限文字。Claude 的子代理預設可選 Flash 3.8；切到 GPT 時不暗改 Flash 預設，要求選回 GPT 支援的子代理或自動選擇。
- `frontend/account-connections.jsx`、`frontend/model-picker.css`、`frontend/usage.jsx`：外部官方登入入口、三家狀態的版面及 Gemini 額度未提供說明，不估算百分比。
- `test/gemini-controller.test.mjs`、`test/gemini-login.test.mjs`：原生續接、精確模型、權限、取消、附件／成果、缺少程式／登入與人類入口檢查；既有 unified／R3 測試注入第三核心測試替身，避免測試呼叫本機 agy。`test/model-picker-compact-ui-probe.mjs` 補第三提供者及 Flash 預設的實際建置介面驗證。
- `README.md`、`AGENTS.md`、`docs/development-log.md`：現況、使用者決定與索引。

## 權限與接入邊界

Gemini 主對話 profile 位於 K 資料根的 `agent-home/gemini/main/<K thread ID>`；帳號入口使用 `agent-home/gemini/account`。覆寫 HOME／USERPROFILE，沒有改動真實 `~/.gemini` 或 K 的 Codex／Claude 家目錄。主對話的原生歷史留在它自己的 profile，跨回合不複製歷史。

- 唯讀與工作區編輯採 Flash probe 已驗證的原生 allow／deny；工作區編輯使用預設權限模式＋Windows 原生工作區絕對路徑 allow，拒絕命令、MCP、unsandboxed、%TEMP% 與工作區外寫入。不能改回 strict。這是原生工具權限，不宣稱為作業系統隔離。
- agy headless 不提供與 Codex／Claude 等價的逐項互動核准，需要核准即由原生拒絕，故不顯示「要求核准／代我核准」。完整存取權須人明確選用，傳官方 `--dangerously-skip-permissions`。
- 已接文字與可擷取文字的文件附件；此接法未接圖片內容、立即插話、手動壓縮、原生同供應商分支、K 瀏覽器助手與 K 跨供應商子代理 gateway。Gemini 原生工具能力不能因此宣稱與其他兩家完全相同。Flash 子代理仍由 Claude 的 k_luna gateway 派工。
- 更正：原先未找到可讀額度的判斷不完整；官方 `/usage` 支援獨立 `agy -p /usage`，後續補修已接入登入確認及官方額度，詳見 [登入與額度補修](gemini-account-status-20261003.md)。

原生來源：[安裝與登入](https://antigravity.google/docs/cli/install/)、[Headless 與原生續接](https://antigravity.google/docs/cli/headless/)、[官方 usage](https://antigravity.google/docs/cli/commands/usage/)。

## 驗證

1. 新增定向測試 **12/12** 通過。UI 建置完成後，完整套件 **573/573** 通過，失敗／取消／跳過均為 0，52966.9643 ms。證據 `.runtime/gemini-new-tests.log`、`.runtime/three-core-build.log`、`.runtime/three-core-full-tests.log`。
2. 建置後的介面測試 **PASS**：18 個假目錄項目、4 次攔截的建立請求；驗證第三提供者、四個 Gemini 模型、Pro 僅 high／low、權限確認、供應商綁定及 Claude 的 Flash／low 預設。沒有向供應商送模型回合或開真實登入。證據 `.runtime/three-core-ui.log`、`.runtime/three-core-picker.png`。首次建置發現新增 JSX 少一個大括號，修正後建置及瀏覽器檢查通過。
3. 真實 Gemini 主代理 **2/2 回合 completed**：Flash 3.8／low 在 repo `.runtime/tests/gemini-main-live-bg5wUR/workspace` 寫入隨機假代碼；關閉控制器後重新建立，以同一 agy 原生 ID 接續，第二回合不讀檔、不重送第一回合內容，正確回憶代碼並寫入 `resume.txt`。兩檔實際讀回符合、成果清單包含兩檔。原生 ID 與呈現保存於獨立測試 profile；沒有使用正式對話派子代理。證據 `.runtime/gemini-main-live.log` 與該測試資料夾的 `evidence.json`。
4. 目錄讀回 **agy 1.2.16**，Flash 3.8／3.7／3.6 各 high／medium／low，Pro 3.1 為 high／low，共 11 個原生變體、4 個選單模型。先前 Flash 部署 probe 是 1.2.15；本輪未執行安裝／升級命令，不能據此宣稱版本變化的原因。
5. agy **1.2.16 權限 probe PASS，8/8、8/10 次模型呼叫**；取消在 8001 ms 觸發，觀察到 agy／conhost／pwsh，程序樹無殘留、測試資料清除完成。完整 JSON 留於 [Flash 驗證文件](antigravity-worker-20261003.md#三核心接入時重新驗證agy-1216)，原始證據 `.runtime/three-core-permission-probe.log`。
6. 正式組合入口補入 Gemini 的環境與既有「候選禁止真實登入」條件；含新控制器、登入與入口的 **20/20** 定向測試通過，證據 `.runtime/three-core-integration-tests.log`。補完後再跑最終完整套件 **573/573**，失敗／取消／跳過均為 0，32413.9399 ms，證據 `.runtime/three-core-full-tests-final.log`。
7. 本輪 26 個修改／新增檔案均為有效 UTF-8、無 BOM 或替代字元。`src/`、`scripts/` 的東區專屬路徑檢查無命中；agy 位置由 LOCALAPPDATA 推得。沒有新相依、安裝／升級 agy 或環境修改；Flash worktree 保留。

```json
{
  "status": "PASS",
  "agyVersion": "1.2.16",
  "model": "gemini-3.8-flash-low",
  "checksPassed": 8,
  "checksTotal": 8,
  "modelCalls": 8,
  "abortElapsedMs": 8001,
  "remainingProcesses": [],
  "cleanup": true
}
```

## 部署狀態

正式三核心程式提交 **`383c744eafe81a9c88c2a27630c7b169570aeb28`** 已部署。原 Flash 版 K 在 12:00:15 由 supervisor 正常關閉、exit 0；套用前正式連接埠沒有監聽，K 自有 launcher／Electron 已不存在。保留原 `86906bc` 的可還原程式於 `C:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791001162339`，不是對話資料快照。

來源與部署的 **16/16** 個程式／介面檔案讀回一致；既有 Codex config、Claude settings 狀態及 Windows 聽寫設定前後一致。相依宣告／lock 與原正式版完全一致，複用已安裝的相依、擴充與啟動器，沒有安裝或升級套件。證據 `.runtime/bootstrap/three-core-prepared.json`、`three-core-activation.json`。

正式 native owner 使用既有資料位置與原生核心，透過 Electron 的實際 UI 檢查新對話：提供者為 **GPT／Claude／Gemini**；Gemini 四個模型均可選，Flash 3.8 為 high／medium／low，權限顯示「工作區編輯」。沒有建立新正式對話、送主代理回合或派工；關閉時 idle、busy=false、questions=0、沒有背景對話工作。證據 `.runtime/bootstrap/three-core-live-ui.json`、`three-core-live-ui.png`、`three-core-live-ui.log`。首次介面等待 60 秒逾時，保存為 `three-core-live-ui-attempt1.json`，未送工作且正常關閉；加入讀回定位資料後重開驗證通過，沒有為此改動產品或宣稱已定位原生延遲原因。

最後經原 `Start-K-Desktop.ps1` 重開，2026-10-03 12:22:39（臺灣時間）讀回：

- `/health`：`app=k-harness-desktop`、`deployment=native`、正確 private-state。
- `.local/runtime.json`：`383c744eafe81a9c88c2a27630c7b169570aeb28`。
- 正式 Electron PID 25792，執行檔來自新的 trusted-runtime，視窗「K 執行中樞」；launcher 12:22:09 回報 ready。
- 證據 `.runtime/bootstrap/three-core-normal-readback.json` 及 `.runtime/desktop-logs/launcher.log`。

未推送 GitHub，Flash worktree 保留。原 Claude 對話的 Flash 完成通知依使用者要求留給主代理自行派工驗收；沒有替使用者重新登入 Google，也沒有讀取／複製憑證。

## GitHub 發布（2026-10-03）

使用者回覆「推送」後，正常推送 `origin/main`，從 `bec2f12` 前進至 `339dc250d951575de2dadad1ab7beab531bc72ff`；`git ls-remote --heads origin main` 與本機 HEAD 讀回一致，工作樹乾淨。包含 Flash 可攜性、第三核心及正式部署紀錄，沒有強制推送或刪除 worktree。此次僅發布既有已驗證提交，沒有重新部署或中斷正式 K。
