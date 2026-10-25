# 桌面控制（Computer Use）`k_desktop`（2026-10-25）

## 起因與本人決定（原話）

- 「K有 COMPUTER USE功能嗎?」→ 查證後回覆：沒有，只有背景控制 K Chrome；10-17 曾列為之後的新功能（見 [k-noncodex-cleanup-20261016.md](k-noncodex-cleanup-20261016.md)）。
- 「三大核心 我知道CODEX有 你和GEMINI呢?」、針對「可以上網查三家最新官方說明」附註「讓6.1SOL去查」。
- 針對「Windows 上的 Computer Use 會接管前景與滑鼠鍵盤」附註：「我知道 但這沒問題 既然都要讓Computer Use 就是知道電腦有問題要讓AI代管 我當然不會待在電腦前了」。
- 針對「K 自己接一套 Windows 桌面控制工具讓三家共用（Windows-MCP、Microsoft UFO）」附註：「沒問題 有開源元件就好」。
- 安裝授權（K 提問面板）：選「授權安裝（建議）」——在 K 專案內安裝 Windows-MCP 與它需要的 Python 3.14，只裝在 K 專案內、關閉使用統計、不設開機啟動、不開網路連線。
- Sol 複查後問「本人接手」功能（保留就得讓每個完整存取權聊天室在背景監看鍵鼠）要不要保留，本人選其他並寫：「和CODEX APP一樣就好 AI動手 我能看 如果我有問題 直接按ESC AI自己本來就會停 有問題我會在聊天室和AI說 沒必要所謂的本人接手吧」。→ 不要接手功能、改 `--no-control`。注意：K 目前**沒有**按 Esc 停止 AI 的功能（介面的 Esc 只關側欄等面板），停手要按聊天室停止鍵或傳訊息（手機也可）；已在回報中向本人說明。
- 自架主代理（Gemma 等）完整存取時是否也給：本人選「一樣可以用（建議）」。

## 調查：三家官方能力（GPT-6.1 Sol，Opus 抽查）

查證日 2026-10-25。Sol 只讀公開資料；Opus 另以 WebFetch 讀官方原文核對 Codex 與 Claude 兩項關鍵結論，Gemini 部分未另核。

| 核心 | 官方產品 | K 所用的命令列核心 |
|---|---|---|
| Codex | ChatGPT 桌面 App（Work／Codex）外掛，macOS／Windows；Windows 在前景接管鍵鼠，不能與本人同時用 | 文件只談桌面 App，未見 CLI／app-server 入口（[computer-use](https://learn.chatgpt.com/docs/computer-use)） |
| Claude | Claude 桌面 App macOS／Windows；Claude Code CLI 內建 `computer-use` MCP | CLI **僅 macOS**、僅互動模式、不支援 `-p`；需 Pro／Max（[CLI 文件](https://code.claude.com/docs/en/computer-use)） |
| Gemini | Antigravity 只有 Chrome 瀏覽器代理（`/browser`、Chrome DevTools MCP） | 未見桌面控制；Gemini API 有 `ENVIRONMENT_DESKTOP` 但屬 API 計費（[Gemini API](https://ai.google.dev/gemini-api/docs/computer-use)） |

結論：Windows 上的 K 無法沿用任何一家原生的 Computer Use。依本人決定改由 K 接開源本機桌面控制 MCP，讓三家共用（同 K Chrome 的做法）。Sol 列出的候選：CursorTouch／Windows-MCP（MIT）、Microsoft UFO 的本機 MCP 元件（MIT）；採 Windows-MCP（PyPI 套件、stdio MCP、可排除工具）。

## 安裝（Opus，本人授權）

- 位置：`D:\K-harness\.runtime\desktop-control\`（Git 已排除 `.runtime/`）。
  - `python\`：uv 管理的 CPython 3.14.4（`uv python install 3.14 --install-dir … --no-bin --no-registry`，`UV_PYTHON_INSTALL_REGISTRY=0`）。
  - `.venv\`：`uv venv --managed-python --python 3.14`；先裝 PyPI `windows-mcp==0.8.8`（92 個套件，含相依），後改為 GitHub 固定 commit（見下）。
  - `uv-cache\`：`UV_CACHE_DIR` 指在此，不用全域快取。
  - 合計約 369 MB。
- 未改系統 Python 3.11.9、未新增 `~/.local/bin` 執行檔；`HKCU\Software\Python\Astral` 只有安裝前就存在的 3.12.13，沒有 3.14 登錄項。
- **版本改為 GitHub 固定 commit**：0.8.8 正式版在 10-03（#445）加入 AI 控制提示、暫時封鎖實體輸入與本人接手，伺服器一啟動就裝全域低階鍵鼠 hook（每 5 秒重掛），且沒有關閉選項；10-12（#458）才加入 `--no-control`，尚未發布。本人不要接手功能，所以改裝 `windows-mcp @ git+https://github.com/CursorTouch/Windows-MCP@0db91ff6e64f35707ce4a401aa2ce4476e7ef59d`（10-24 main HEAD，套件版本字串仍為 0.8.8；相依沿用原 92 個）。原始碼確認 `--no-control` 時 `ControlCoordinator.start()` 直接返回、不建立實體輸入監看，也不啟動控制提示與通知。0.8.7 雖沒有 hook，但缺 10-01 的座標／Unicode 輸入修正，不採用。
- 啟動方式：`windows-mcp.exe serve --transport stdio --no-control --exclude-tools PowerShell,FileSystem,Registry,Process,Scrape`，環境變數 `ANONYMIZED_TELEMETRY=false`（套件預設開啟 PostHog 匿名統計；原始碼在此值為 false 時不建立 PostHog client）。固定 stdio 是因為未指定時會採用 `~/.windows-mcp/config.toml` 的 transport。不跑 `windows-mcp install`（那會建登入時啟動的排程工作）。
- MCP 握手實測（只 initialize、tools/list 與唯讀的 ControlStatus，未做任何桌面動作）：伺服器 `windows-mcp 4.1.3`；首次啟動 5.9 秒、之後約 1.8～2.0 秒；`--no-control` 時 ControlStatus 回報 `state: disabled`。排除後 16 個工具：ControlStatus、App、DisplayInventory、Snapshot、Screenshot、Click、Type、Scroll、Move、Shortcut、Wait、WaitFor、MultiSelect、MultiEdit、Clipboard、Notification；工具定義約 17 KB。

## 設計

- 名稱 `k_desktop`；接在三家**主對話**、且只在完整存取權（Claude `bypassPermissions`、Codex／Gemini `danger-full-access`）。桌面控制能點開終端機打字，等同完整存取，給較低權限會繞過原生沙盒。K 工人（`luna_start`／Flash）一律不給；Codex 與 Claude 的**原生子代理**依官方行為會繼承主對話的 MCP（權限同主對話，符合「子代理權限不得超過主對話」，由主代理決定是否交付桌面任務）。自架主代理（走 Codex 路徑）選完整存取時同樣提供（本人決定）。
- 安裝位置由本人在私有狀態登記一次：`vault/private-state/.runtime/desktop-control.json`，`{"executable": "<windows-mcp.exe 絕對路徑>"}`；沒有此檔即不提供（同 `google-ops.json` 的做法，專案檔案不能自行登記新執行檔）。
- 排除 PowerShell、FileSystem、Registry、Process、Scrape：三家核心本來就有指令與檔案能力，網頁另有 K Chrome，不重複開入口。ControlStatus 排不掉（套件的過濾器強制保留），在 `--no-control` 下只回報 disabled，無害。
- 不要本人接手（本人決定，同 Codex App）：`--no-control`，閒置聊天室不常駐全域鍵鼠 hook。停手方式同 K Chrome：聊天室停止鍵或傳訊息（MCP 標準取消），不自動重做被中斷的動作。
- 模型指引（僅在有 `k_desktop` 時加入）：會操作本人的前景視窗、滑鼠與鍵盤；只在本人該次明確要求操作桌面或其他程式時使用；網頁優先 `k_browser`；本人按停止或傳訊息就停手，不自動重做被中斷的動作。

## 修改

### 第一版（程式 `4f63d47`，Flash 實作、Opus 複查修正）

- `src/desktop-control-mcp.mjs`（新）：`desktopControlMcp({root, fullAccess})` 讀私有狀態綁定；沒有完整存取、沒有綁定檔或執行檔不存在回 `null`，綁定路徑不是絕對路徑則拋錯（同 google-ops）；回傳 stdio 的 command／args／env。另匯出模型指引 `DESKTOP_CONTROL_GUIDANCE`。
- `src/claude-controller.mjs`：`nativeMcpConfig` 在 `bypassPermissions` 時加 `k_desktop`（stdio）；主對話開啟與權限／推理切換重啟兩處，有 `k_desktop` 才把指引接在 `workspaceInstructions` 後。
- `src/desktop-controller.mjs`（Codex）：`danger-full-access` 時 `k_desktop` 加 `startup_timeout_sec: 30`，否則用 `disabledCodexMcpServer()` 蓋掉同名設定；有 `k_desktop` 才加指引。
- `src/gemini-controller.mjs`、`src/gemini-worker.mjs`：主對話 `danger-full-access` 時 `mcp_config.json` 加 `k_desktop`、`settings.json` 允許 `mcp(k_desktop/*)`、規則檔加指引；Flash／Gemini 工人路徑不傳。
- `src/gemini-project-mcp.mjs`：`k_desktop` 列為保留名稱，工作區設定不能取代。
- 測試：新增 `test/desktop-control-mcp.test.mjs`；Claude／Codex／Gemini 主對話各一則「完整存取有、較低權限沒有（含指引）」；Codex resume 的 `mcp_servers` 期望加 `k_desktop: disabled`；Gemini 專案設定拒絕 `k_desktop`。
- Opus 複查修正：Flash 讓 `geminiSettings` 同時接受 options 與尾端參數兩種傳法（多餘），改回只用既有 options 物件；Flash 寫入的 LF 混入 CRLF 檔案已統一；新增與修改的測試依 `.prettierrc.json` 重排（主分支這些檔案原本即符合格式）。
- Flash 為讓工作樹跑網頁測試，另建 `dist-ui` junction 連到主工作樹（Git 排除）；移除工作樹前須先拆 `node_modules` 與 `dist-ui` 兩個 junction。

### 複查修正（程式 `2d94670`，Opus）

- Codex 切換權限：同一 app-server 對已載入的 thread 做 resume 會沿用原 MCP 程序（[browser-reconnect-fix-20260925.md](browser-reconnect-fix-20260925.md) 實測），降權後 `k_desktop` 會殘留、升權也不會加入。新增 `hostDesktop`（目前 host 最後一次組裝是否含 `k_desktop`）；open() 在既有 thread 上若 `hostDesktop` 與這次應有的不同，就沿用工作區移動／瀏覽器恢復的既有流程關閉並重建 host，再 resume 同一 thread（歷史留在原生，不重送）。
- 啟動參數加 `--transport stdio`、`--no-control`；指引改為停止鍵／傳訊息即停手。（當時也把 `ControlStatus` 加進排除清單，Sol 複核指出套件強制保留它，下一版已移除；Opus 先前寫「剩 15 個工具」是沒有重跑工具清單的錯誤。）
- 測試：Codex 測試改為「完整存取→唯讀會重建 host、resume 為 disabled 且無指引；唯讀→要求核准不重建」，突變驗證（拿掉條件）會失敗；三家控制器測試改與 `desktopControlMcp()` 輸出比對，參數只在 `test/desktop-control-mcp.test.mjs` 固定一次；刪除只比對指引文字的測試。

### 第二次複查修正（程式 `2785b47`，Opus）

- Codex 桌面狀態改為**逐 thread 記錄**：單一旗標會在「完整存取的 A 開唯讀分支（或分支被取消）」後被改成沒有桌面，之後把 A 改唯讀就跳過重建、桌面工具殘留。`hostDesktop` 改成 Map（thread id → 目前 host 載入它時是否含 `k_desktop`），在原生 start／fork／resume 回來時記錄、建立新 host 時清空；只有「該 thread 已在此 host 載入且狀態相反」才重建。沒採用 Sol 建議的「open 成功才賦值」，因為取消發生在原生呼叫之後時，已載入的 thread 會沒有紀錄。
- `--exclude-tools` 移除 `ControlStatus`。
- 回歸測試「a read-only Codex fork does not hide that its full-access parent is still loaded with Desktop Control」；以突變模擬舊的單一旗標語意會失敗。

### 第三次複查修正（程式 `fa02154`，Opus）

- `abortable()` 只停止等待、不取消已送出的原生請求：完整存取開啟對話時若在 `thread/resume` 回覆前按停止，原生仍可能載入含 `k_desktop` 的 thread，而 K 重用 host、Map 沒紀錄，之後唯讀重開會漏重建。改為**送出 resume 前**先記錄該 thread；若其實沒載入，代價只是多一次 host 重建（安全方向）。未採用「取消時關閉重用的 host」，以免改變既有取消行為。
- 回歸測試「a cancelled full-access Codex resume still counts as loaded with Desktop Control」；拿掉預先記錄時失敗。

## 驗證

- 第一版：相關測試檔 82/82；完整 `npm test` 1937/1937。
- 第一次複查修正後：相關測試 58/58；完整 `npm test` 1936/1936（刪 1 則只比對文字的測試）。
- 第二次複查修正後：完整 `npm test` 1937/1937（新增分支回歸測試）。
- 第三次複查修正後：完整 `npm test` 1938/1938（新增取消回歸測試）。
- 官方文件確認三家設定格式都支援 stdio 的 `env`：Antigravity `mcp_config.json`（[MCP](https://antigravity.google/docs/mcp)，`env` 為注入 stdio 程序的環境變數）；Codex 與 Claude Code 的 stdio MCP 原本即有 `env`。
- 未改介面，不需 `build:ui`／`test:ui`。

## 審查

- Opus：逐行複查 Flash 改動（見第一版修正）。
- GPT-6.1 Sol 第一輪（`4f63d47`，只讀）：
  1. 高｜Codex 降權不保證移除 `k_desktop`：屬實，已修（見複查修正）。
  2. 中｜未固定 stdio，`~/.windows-mcp/config.toml` 可改 transport：屬實，已加 `--transport stdio`。
  3. 中｜多房可同時取得桌面控制、無跨程序互斥：屬實但**不處理**——本人單人使用、規則是本人該次明確要求才用，不另建跨程序鎖；列為已知限制。
  4. 低｜指引說「移動滑鼠就收回」與實作門檻不符：本人改決定不要接手功能，改 `--no-control` 後此句刪除。
  - 其餘結論：Claude 重啟 host 與 Gemini 每回合 prepare 的權限切換路徑正確；K 工人沒拿到；原生子代理會繼承（文件已改寫）；Codex 在完整存取下呼叫帶 `destructiveHint` 的 MCP 工具是否會要求核准**未查明**（K 已支援空表單 `mcp_tool_call` 核准，不會無故卡住，但本人不在電腦前時會等核准）；自架主代理完整存取時也有（本人決定保留）；PostHog 停用正確；0.8.8 的全域 hook 是啟動即安裝（已改 `--no-control` 避開）；Gemini 環境未保留 `APPDATA`，`App` 工具找使用者私人開始選單捷徑的備援可能漏找。
- GPT-6.1 Sol 複核（`2d94670`）：結論「不可部署」。
  1. 高｜取消降權分支後漏重建：屬實，已改逐 thread 記錄（見第二次複查修正）。
  2. 低｜`ControlStatus` 無法由 `--exclude-tools` 排除（`__main__.py` 過濾器強制保留）：屬實，已從清單移除，不改第三方套件。
  - 其餘：一般降權修正正確；`--no-control` 確實略過全域鍵鼠 hook、raw input、輸入 watchdog 與接手提示；PostHog 停用與固定 stdio 有效；截圖時的閃光 overlay 與預設關閉的 UIA watchdog 不受 `--no-control` 影響（維持預設，不另加環境變數）。
- GPT-6.1 Sol 第二次複核（`2785b47`）：結論「不可部署」。1 項高：取消尚未回覆的 resume 後可能漏重建——屬實，已修（見第三次複查修正）。其餘：Map 鍵值在 `localRefs`／`nativeThreads` 各分支一致；一般 fork、fresh continuation、unsent 重用、失敗、relocation、browser recovery 正確；Map 屬必要小幅狀態，未見過度工程化。
- GPT-6.1 Sol 第三次複核（`fa02154`，限上一輪高嚴重度意見）：已關閉空窗；既有 resume、fresh continuation／fork（回覆前取消時新 ID 尚未存入 K 清單、無法重開）、unsent 重用、start-with-threadId、archived→unarchive→第二次 resume 各路徑皆安全；預先記錄不會造成「該重建卻沒重建」。結論「可部署」。

## 部署

- 合回：分支 rebase 到含瀏覽器連線回報批（`5f8b7e0`）的最新 main `799475b`，兩批合併完整 `npm test` 1952/1952；快轉 main 到 `5e540dc`（程式 `8eab458343945e7f931e714df9d8022de2a45622`）。
- 私有狀態登記：`vault/private-state/.runtime/desktop-control.json` → `D:K-harness.runtimedesktop-control.venvScriptswindows-mcp.exe`（讀回執行檔存在）。
- 2026-10-25 12:40 寫 `.local/update-ready.json` 指向 `8eab458`；本人按「更新」，12:54（臺灣時間）完成：`self-update-result.json` ok、943c44d→8eab458，更新器內完整測試 1952/1952，退版保留三份（`before-1792904067892` 為 previous）。`self-update-error.log` 只有 Vite 的 chunk 大小與 outDir 警告。
- 正式讀回（本 Claude 主對話，略過權限提示）：K 重開後出現 `mcp__k_desktop__*` 16 個工具；`ControlStatus` 回 `state: disabled`（無鍵鼠 hook）；`DisplayInventory` 讀到 1920×1080 單螢幕。程序列表確認 Claude 啟動的 windows-mcp 參數為 `serve --transport stdio --no-control --exclude-tools PowerShell,FileSystem,Registry,Process,Scrape`；每個完整存取權 Claude 主對話一份，實測工作集約 170 MB（兩個 Claude 聊天室各一份）。
- push：`b15dc81..5e540dc`，遠端讀回 `5e540dce9d285616da9d76b7ec46faf3b0edcf49`（含先前已部署未推的檔案連結、心跳修正與瀏覽器回報批）。push 前掃描差異無秘密字樣。
- 瀏覽器批擴充：執行 `scripts/Setup-K-Browser.ps1`，`installed/k-browser-assistant` 由 0.1.4 換為 0.1.5，備份於 `vault/k-browser-assistant-backups/setup-20261025-130952-416`；待本人在 K 專用 Chrome 擴充頁按「重新載入」後實測一般／無痕連線。
- GPT、Gemini 主對話的正式實測（含 Codex 是否跳 MCP 核准）尚未做。

## 已知限制與未完成

- **K 沒有按 Esc 停止 AI**：停手用聊天室停止鍵或傳訊息（手機也可）。
- 電腦鎖定或睡眠時無法操作；本人離開時要保持解鎖，尚未實測。
- Codex 完整存取下呼叫 `k_desktop` 是否會跳 MCP 工具核准未實測；若會，本人不在時工作會停在核准。部署後以無副作用的工具（如 `DisplayInventory`）實測。
- 每個完整存取權主對話各啟動一個 windows-mcp 程序（啟動約 2 秒、實測約 170 MB）；工具定義約 17 KB 會進入各核心的上下文。
- 多個聊天室理論上可同時控制桌面，靠「本人該次明確要求才用」約束，K 不另加鎖。
- Gemini 主對話的 windows-mcp 繼承 agy 的白名單環境（沒有 `APPDATA`），開程式時可能找不到只在使用者私人開始選單的捷徑。
- 用的是 GitHub 未發布 commit；Windows-MCP 下一個正式版包含 `--no-control` 後可改回正式版（需本人授權的更新）。
- 尚未做真實桌面動作的端到端實測（會操作滑鼠，需本人同意的時段）。
- 東區電腦需另外安裝並登記 `desktop-control.json`，未做。

## AGENTS.md 精簡（為維持 24,000 bytes 上限移出，原文如下，非現行規則）

- 第一節「臨床相關工作（含 CaseAgent）不再排除；進入該專案時依其 AGENTS.md。」→「臨床相關工作（含 CaseAgent）依該專案 AGENTS.md。」
- 第二節正式執行目錄後的「（目錄名是歷史遺留，不需 Sandboxie）」；第三節已寫明 Sandboxie 元件不再使用。
- 第九節「；內嵌瀏覽器已移除」與 K Chrome 開啟時的「（可能閃一下，已接受）」；閃現例外仍保留在下一條。
