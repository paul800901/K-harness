# K「更新」按鈕：在 K 裡按一下就更新並重新啟動（2026-10-24，尚未部署）

## 本人決定

2026-10-23 本人提議：「能不能做一個類似 Codex App 那樣……下載完它會跑，跑完之後它會自動關掉 Codex App，在重開的時候它就安裝好了。」起因是 Codex 額度用完時部署卡住，本人不想再靠 K 外的 Codex／VS Code／PowerShell。

設計經 Gemini 3.8 Flash 與 Claude Fable 5.1 各自提出意見後，由本人定案，刻意做到最簡：

- 「更新那邊不用寫太多東西……就只有一個下載按鈕而已……看了也沒用」：只有一個按鈕，不附更新說明，不跳確認視窗。
- 位置：「那個更新的按鈕都放在設定這邊……那個齒輪，它們右邊」：側欄最下方「⚙ 設定」同一行的右邊，電腦與手機同一處。
- 「我現在也在手機上跟你們聯絡去更新這些東西，所以我覺得這個功能蠻重要的」：手機可按；三家 AI 核心的更新仍只在電腦端。
- K 只給本人使用，不考慮多人更新；南區是主要版本，按鈕只更新到南區本機 `main` 的已驗收版本，不從網路下載；東區是附屬機，照舊由 AI 到當地輔助更新。
- 手機登入只綁本人手機、保存一年（Fable 查證 `src/remote-access.mjs` 的 `.local/remote-sessions.json`），更新後不用重登。

## 行為

1. **何時出現**：AI 完成一批（測試與複查處理完）、合回 `main` 後，在 repo root 寫 `.local/update-ready.json`（`{"ref":"<40 位程式版本 SHA>"}`）；只有它不同於 `.local/runtime.json` 的 `version` 時按鈕才出現。純文件變更不寫標記、不亮。
2. **按下**：同一個請求裡檢查全部閒置（聊天室工作中／待確認／仍有執行歸屬的未結束工人、Gemini busy／checking／loginPending、三家核心更新、Claude／Codex 登入程序、本機聽寫）。有工作就只回一句「還有工作在跑，等結束再按。」，不更新、不停止任何工作。
3. **閒置時**：K 經 Electron 主程序 → Node 監督程序 → 系統匣啟動器（stdout 一行 `{"type":"self-update","ref":...,"pid":...}`，驗證 pid 與 40 位小寫十六進位）。啟動器以既有正常關閉路徑關 K，**本路徑絕不強制結束**；未確認關閉就放棄並提示「K 更新未開始」。確認關閉後交棒給 `scripts/Self-Update-K.ps1` 並自行結束——因為 `Update-K.ps1` 會覆寫啟動器 exe，Windows 不能覆寫執行中的程式。
4. **更新腳本**（repo root，不在會被替換的 runtime 內）：視窗標題「K 更新中」，等啟動器結束，執行既有 `Update-K.ps1 -Ref <ref>`（建置、完整測試、切換、保留退版），輸出寫 `.local/self-update.log`，結果寫 `.local/self-update-result.json`，不論成敗都重新啟動啟動器。失敗原因取記錄最後一行實際錯誤（`Update-K.ps1` 本身只丟一句籠統訊息）。不碰 `.local/remote-access.json`、`.local/remote-sessions.json`，不結束任何程序。
5. **之後**：成功不打擾；失敗以原版本開回，按鈕下方顯示「上次更新沒成功：<原因>」，按鈕仍在可再試。
6. **手機**：更新開始後斷線時，原本的紅色斷線提示改為「K 更新中，完成後會自動重新連線。」，每 5 秒檢查 K 回來沒，回來就重新整理（5 分鐘內，或後端回報更新中）。
7. **保險**：後端請求更新後 3 分鐘內視為更新中；啟動器若沒能關閉 K，3 分鐘後按鈕恢復可按。測試／開發環境沒有接啟動器時，查詢回「沒有可更新的版本」，按下回 404。

## 實作

- 新增：`src/self-update.mjs`（讀標記、版本、上次結果）、`scripts/Self-Update-K.ps1`（UTF-8 BOM，PowerShell 5.1）、`test/self-update.test.mjs`、`test/self-update-ui-probe.mjs`。
- 修改：`src/desktop-server.mjs`（`GET`／`POST /api/self-update`、閒置檢查、更新中的 503 文字）、`src/remote-access.mjs`（手機允許兩條路由）、`src/electron-isolated-main.cjs`／`src/isolated-launcher.mjs`／`src/isolated-desktop.mjs`（訊號往外傳）、`src/electron-isolated-launcher.mjs`（轉成一行輸出）、`local-launcher/KTrayLauncher.cs`（處理更新訊號；`StopK` 加「失敗時不准強制結束」參數）、`frontend/main.jsx`、`frontend/sidebar.css`；為閒置檢查加最小唯讀 getter：`core-updates` 的 `pending`、`local-dictation` 的 `busy`、`codex-login` 的 `progress()`、聊天室活動摘要帶 `title`。
- 過程：Gemini 3.8 Flash 依規格起頭，改了後端、C#、腳本，但前端按鈕只寫了一半（引用不存在的變數，介面無法建置），新寫的 `desktop-server` 與啟動器測試會卡住（假子程序不回應關閉請求），它反覆試跑 4 組都卡住 20 分鐘以上。本人指示 Opus 親自處理：Opus 結束卡住的測試程序、正式停止 Flash 工單並核對成果，接手完成前端、重寫測試，並簡化 Flash 的寫法（組裝參數由三種傳法改為一種、刪除重複的目前聊天室檢查、新增 3 分鐘逾時、失敗原因取記錄最後一行、CSS 改用規範內色彩與字重、撤回格式化工具對無關程式的重排）。

## 驗證

- 完整 `node --test test/*.test.mjs`：**1878/1878**。新增測試：標記有效性與上次失敗只對應目前提供的版本；手機允許兩條路由；沒接啟動器時查詢回無可更新、按下 404；閒置時只交給啟動器一次、第二次回「已經在更新了」；有工作時回一句話並列出忙碌項目、不呼叫啟動器；沒有可更新版本、啟動器無法聯絡時 K 不關閉且可再按；監督程序只轉送合法請求；腳本可由 PowerShell 5.1 解析、有 BOM、不含遠端登入檔名與結束程序指令。
- `npm run build:ui` 後 `npm run test:ui`：**51/51**（新增 `self-update-ui-probe`：沒標記不顯示、顯示在設定同一行右邊、有工作時顯示提示、更新中不能再按、手機側欄顯示失敗原因）。截圖：`.runtime/archive/self-update-20261024/self-update-probe/`。
- `local-launcher/Build-K-Launcher.ps1` 在工作樹編譯成功（只輸出到工作樹，未執行）。
- **未做**：真實按下更新的端到端（需要已部署此版的啟動器；目前執行中的舊啟動器不認得更新訊號）。這一版本身須由 K 外代理部署一次；之後下一批即可用按鈕實測。

## 規則更新

`AGENTS.md` 第二節：正式更新句後加「本人可按側欄『更新』（AI 驗收合回 `main` 後寫 `.local/update-ready.json` 才出現；見本檔）」；第八節人用例外加「K『更新』按鈕（手機可按）」。為維持 24,000 bytes 上限（CRLF 23,980），移出以下非規則或重複文字（原文）：

- 第二節「公開不代表產品、維護或客服承諾，」（保留「不新增授權條款」）
- 第七節「Codex 的重試與重連交給原生核心。」（第一節「原生核心負責……重試」已涵蓋）
- 第八節 GPT Fast「不替其他家假造同等功能。」（第一節「各家沒有等價能力就明確標示，不硬湊、不假造」已涵蓋）
- 第八節語音「是否改用 Windows 內建語音，尚未決定。」（待決事項，不是規則）

## 審核與部署狀態

- Opus 5.5 接手完成並複查 Flash 的部分；GPT-6 Astra（xhigh）後端抓錯進行中。
- 未部署、未合回 main、未 push。
