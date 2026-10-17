# 東區 K 更新：交接 VS Code Claude（2026-10-17）

## 本人最新要求與範圍

本人改交 VS Code 的 Claude Opus 5.5 處理 K 更新，K 內代理已停止後續開發與測試。請直接查明失敗、完成必要修正與驗證，再由 K 外更新本機；不要讓本人反覆執行同一個未修好的腳本。只處理 K HARNESS；不修改 CaseAgent、不處理官方 Codex App、不改帳號／權限／計費或升級三家原生核心。若 K 尚有工作，請本人先用正常「離開並停止」關閉，不強制終止。

## 現況與位置

- 本機安裝來源：`C:\K-harness`。本機正式設定 `.local/runtime.json` 仍為 `1a45a73440a5f948c5cec625de02340863b7c67d`，Windows 聽寫。尚未更新成功。
- 正式執行目錄：`C:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\trusted-runtime`。同層 agent-home、vault、workspace、browser-output 是既有登入／對話／資料，不搬動或覆蓋。
- 本交接工作樹：`C:\K-harness工作區\k-update-repair-20261017`，分支 `fix/dongqu-handoff-write-order-20261017`，基底 `d9d1b267954c094b17e8d952612140b7a040b507`（當時 origin/main；程式基底為已發布 `46ec46040d3ee0df1a4fc82cfd5f21a6591800a3`）。
- `C:\K-harness` 本機 main 較舊且分歧，另有既有 docs 修改；不要 reset、覆蓋或誤把它部署成新版。`C:\K-harness工作區\antigravity-worker` 也是舊分支，不是本次候選。修復與交接文件放在本工作樹。
- 現有外部腳本：`C:\K-harness\.runtime\update-20261017\Run-Update.ps1`，仍固定 46ec4604，未改成含本次修正的版本。驗證後須固定真正含修復的 Git SHA，再使用既有更新／退版機制；不要把未提交修改直接冒充已驗證版本。

## 最新失敗：不能跳過或改鬆斷言

- 最新更新紀錄：`C:\K-harness\.runtime\update-20261017\run-20261017-031330\update.log`。
- 失敗候選：`C:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\prepare-1792178012202`。已無本輪 updater／測試程序；保留失敗現場。
- 完整測試約 86 秒後 exit 1：`test/fresh-target-model.test.mjs:233`，`closing during target creation reproduces interrupted handoff evidence without sending`，預期 `uncertain`，實際 `cancelled`。
- 失敗實體紀錄：上述候選的 `.runtime/tests/run-16992-1792178049715/fresh-target-IMgNnx/.runtime/chat-continuations/native-1.json`。最終保存 cancelled、錯誤「K 已關閉，未建立接續聊天室。」且缺少 newThreadId。
- 程式證據：`src/conversation-controller.mjs` 的 cancelContinuation、finishContinuation／onCreated 都會保存同一 receipt；原 writeContinuation 直接 atomicWrite。atomicWrite 保證每份檔案完整，沒有保證併發保存順序；舊 cancelled 快照可能在較新的 created／uncertain 快照後完成覆蓋。這是目前最吻合證據的原因，請 Opus 獨立複查，不把它當成已驗證結論。
- 原先另一候選曾完整 1734/1734 通過，不能用該次成功否定本次失敗，也不能跳過測試硬套用。
- 更早 03:06 更新紀錄有 Ctrl+C；最新 03:13 這次是明確斷言失敗，不要混為一談。

## 已做、尚未驗證的最小修正

- 本工作樹只有 `src/conversation-controller.mjs` 的程式修改：新增每個 receipt 檔案的 Promise 保存順序，呼叫時先抓 JSON 快照，前一保存結束後才執行下一保存；不同聊天室不互相阻塞；沿現有 main-sessions 保存鏈模式；最後清除對應 Promise。
- 尚未提交、尚未跑修正後測試、尚未 build、尚未真正 Opus 5.5 審核、尚未部署。請檢查 diff 後採納或修正，不能宣稱已完成。
- 本工作樹 `npm ci --no-audit --no-fund` 與 Electron install 已成功完成；沒有背景安裝／測試留給下一位。紀錄：`.runtime/archive/handoff-write-order-20261017/dependencies.log`。
- 驗證應包括原失敗情境、相關 continuation 測試、適當的競態重現／回歸驗證、完整 npm test；如有介面變更依 AGENTS 補 UI 檢查。不要只重跑到偶然綠燈，也不要把預期改成接受 cancelled。

## 收尾標準

獨立檢查正確性、錯誤傳遞、是否過度設計與未知工作不重播；保留原生核准及本人停止意圖。測試與 Opus 複查通過後固定 Git SHA，正常停止 K，從 VS Code 外部流程使用既有 updater 部署、保留程式退版，再正常啟動並讀回版本、程序／介面、health、本機設定與必要功能。保存工程紀錄，實際完成後再告知本人；若未完成明列真正卡點。

如沿用原更新器，其子程序 stdout 會等該步完成才整批輸出，測試期間約 90 秒沒有輸出並不等於卡死。此點不是本次斷言失敗的修復。

## VS Code Claude 接手結果（2026-10-17）

- **原因獨立核對**：`close()` → `cancelContinuation` 對同一 receipt 物件設 cancelled 並保存（快照在建立前，無 newThreadId）；`finishContinuation` 同時進行，`onCreated` 保存 cancelled＋newThreadId，接著 `sourceCurrent()` 因 closing 拋出，catch 保存 uncertain。三次寫入同一 `native-1.json`；`atomicWrite` 以 rename 取代，Windows 下同目標並行 rename 會 EPERM／EACCES 並按時間重試，最舊快照可能最後落地。與現場檔（cancelled、無 newThreadId、「K 已關閉」）完全吻合。
- **修正**：採納前位代理的每檔 Promise 保存順序（`src/conversation-controller.mjs` writeContinuation），未改邏輯；呼叫時取快照、各呼叫者仍收到自己的錯誤、前一筆失敗不擋後一筆、不同聊天室不互鎖。不改停止意圖、不送出、不重播；記憶體 cancelled 仍在送出前擋下。
- **回歸測試**：`test/fresh-target-model.test.mjs` 新增 `delayed cancellation save cannot overwrite the later interrupted handoff result`，以 `syncBuiltinESMExports` 將建立前 cancelled 快照的 rename 延遲 300 ms，斷言延遲確實發生一次、最終 uncertain／native-2、turn/start 僅 1 次。**未套修正時穩定重現現場失敗（實際 cancelled）**，套用後三次皆通過；原斷言未放寬。
- **完整測試**（工作樹，依更新器順序先 vite／擴充／啟動器建置）：**1735/1735 通過，0 失敗／取消／略過，85.9 秒**。首次未建置 dist-ui 時 2 項 UI 檔案測試失敗（ENOENT），屬建置前置，建置後全過。紀錄：`.runtime/archive/handoff-write-order-20261017/`。
- **Opus 5.5 複查**（獨立 Claude Opus 5.5 子代理，只讀）：診斷與所有 writeContinuation 呼叫點一致；鏈正確、無死鎖、無未處理 rejection；保留停止意圖與不重播；最小修正，不建議擴大到 atomicWrite。非阻擋建議：fixture 移至 patch 前，避免 fixture 失敗時 rename 未還原——已採納，該測試檔 20/20 通過。
- **固定程式版本**：`7271fdefa2d27a005a996e06076c9c12875195d3`（基於 d9d1b26／程式 46ec4604，只含上述兩檔）。本文件為另一 docs commit。
- **部署方式**：沿既有外部腳本複製為 `.runtime/update-20261017/Run-Update-7271fdef.ps1`，只改固定 SHA（原 46ec4604 腳本保留）；K 開始前已確認停止（47831 無監聽、assertStopped 通過），由 VS Code（K 外）執行。

## 東區正式部署與讀回（2026-10-17 03:35）

- 更新紀錄：`C:\K-harness\.runtime\update-20261017\run-20261017-033246`（update.log、result.json）。更新器候選完整測試 **1735/1735 通過，0 失敗，91.9 秒**；建置全成功後才 activation。
- `.local/runtime.json`：version `7271fdefa2d27a005a996e06076c9c12875195d3`，`dictationProvider: windows`、nodeExecutable 不變（腳本逐欄比對其他設定未變才啟動）。退版：`releases/before-1792179282418`（含上一版 runtime、啟動器與設定），可用 `Update-K.ps1 -Rollback`。
- 啟動：launcher.log 03:25:37 正常停止；03:35:07 啟動、03:35:08 native workbench ready。47831 由 `trusted-runtime\node_modules\electron\dist\electron.exe`（PID 7236）監聽，health 200、deployment native。
- 來源核對：現用 runtime 對 7271fdef 的 792 檔：791 檔與 git archive 位元組一致；建置重產 `browser-extension/extension-protocol.cjs` 與原 Git blob 一致；修正碼已在現用 `src/conversation-controller.mjs`。
- agent-home／vault／workspace／browser-output 未由更新器替換；未改帳號、權限、計費，未升級三家核心，未動 CaseAgent 或官方 Codex App。
- **未驗證**：真正模型回合、介面實際操作、Chrome 擴充重新載入（本版擴充來源相同於 46ec4604 基底，若需載入另依 Setup-K-Browser）。
- **未 push**：7271fdef 與本 docs commit 只在本機分支 `fix/dongqu-handoff-write-order-20261017`；`C:\K-harness` 本機 main 未變更。南區仍為 46ec4604，待決定是否推送／南區同步。
