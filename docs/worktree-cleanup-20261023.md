# 舊開發工作樹清理（2026-10-23）

本人要求查清 `C:\Users\Paulus\.codex\worktrees\` 下留下的 K 開發工作樹與舊分支，沒問題的直接結束，並由 GPT-6.1 Sol 驗收收尾。Claude（Opus 5.5）盤點與執行；只動已合併的開發工作樹、Git 登記與分支，未動正式 K、對話或帳號資料。

## 盤點結果

- Git 登記 8 個工作樹，其中 `gemini-sheets-read`、`sidebar-order-persistence` 在盤點期間（00:16～00:17）已被外部移除（研判為 Codex App 自動清理），Git 登記隨後自動失效。其餘 6 個（`discussion-skill`、`fable-models`、`gemma-main-agents`、`k-mobile-remote`、`sheets-write`、`worker-status-cleanup`）：工作樹乾淨、HEAD 全部已包含在 `main`、沒有程序使用。
- 另有 3 個未登記的殘留資料夾：`mobile-image-upload`、`room-lock-fix-20261010`（只剩 `node_modules`）、`r2-simplification`（約 0.8 GB 舊 `.runtime`）。
- 分支：`codex/dolphin-loop-20261020`、`codex/mobile-remote-20261006` 已完全合入 `main`。`backup/main-worktree-20261013` 是 10-13 刻意建立的備份（見 [工作區對齊](workspace-alignment-20261013.md)），含 111 個 `main` 沒有的舊檔，**保留**。
- `~\.codex\worktrees` 下其他只剩 `.codex-worktree-name` 的空殼屬 Codex App 自管，未動。

## 發現的風險與已發生的事故

- 多個工作樹的 `node_modules`、`.runtime\playwright-browsers` 是指向外部的 junction：6 個指向 `D:\K-harness\node_modules`，2 個指向 `D:\K-harness\.runtime\playwright-browsers`，**`k-mobile-remote\node_modules` 直接指向正式 `trusted-runtime\node_modules`**；另有測試留下的自我循環 junction。
- 用會跟隨連結的方式刪除工作樹，會刪掉連結目標。**已發生一次**：`D:\K-harness\node_modules` 目前是空的，最後修改時間 2026-10-22 22:17:55，與 `voice-background-stability` 工作樹被移除的時間相同。主工作樹不跑測試、可依 lockfile 以 `npm ci` 重建，未造成實際損失；本次未重建。
- 若以同樣方式移除 `k-mobile-remote`，被清空的會是正式 K 的相依套件。往後移除任何工作樹前，先只拆 junction／symlink（不跟隨），再刪資料夾；不要把正式 `trusted-runtime` 的 `node_modules` 接到開發工作樹。

## 處理

1. 先拆 10 個對外 junction（只移除連結本身）。前後核對：正式 `trusted-runtime\node_modules` 193／193 項、`.runtime\playwright-browsers` 316／316 檔，未受影響。
2. 工程紀錄引用、但只存在舊工作樹的證據，複製到 `D:\K-harness\.runtime\archive\<原名稱>`（41 個資料夾、10,563 檔、1.57 GB），robocopy 比對模式逐一核對 41／41 一致。
   - 來源：`r2-simplification` 15 個、`k-mobile-remote` 22 個、`gemma-main-agents\.runtime\archive` 3 個、`sheets-write\.runtime\archive` 1 個。
   - 名稱相同的 3 個（`gemini-capabilities-20261004`、`modal-focus-20261004`、`modal-scroll-ui-probe`）：`r2-simplification` 版放 `archive\<原名稱>`，`k-mobile-remote` 版放 `archive\<原名稱>-k-mobile-remote`。
   - 不複製：`candidate-*` 乾淨候選目錄（可從 Git 重建；同目錄的 `candidate-*.zip` 已保留）、所有 `node_modules`、junction，以及 `attachment-stream-20261007\.runtime` 內 1.35 GB 的合成測試檔（紀錄寫明是假資料）。
   - 未複製的其他 `.runtime` 內容是測試暫存（`tests`、`luna-bridge-tests`、`remote-remember-*` 等），名稱未被任何工程紀錄引用。
   - `room-lock-fix-20261010`、`steer-final-display`、`multi-model-discussion-20261008` 等紀錄提到的證據在本次之前就已不存在，無從保存。
3. 9 個舊工作樹資料夾：拆掉剩餘的內部 junction，`node_modules` 依規則直接移除，其餘移到資源回收筒。外層只留 `.codex-worktree-name`，與 Codex App 自行清理後的樣子一致；`discussion-skill`、`sheets-write`、`worker-status-cleanup` 外層原本沒有該檔，刪完是空資料夾，以 `rmdir` 移除（只能刪空資料夾）。
   - 第一次批次執行到 10 分鐘工具時限被中止：前 7 個已完成，`r2-simplification` 處理到一半，`room-lock-fix-20261010` 未開始，逐項計數紀錄因中止未寫出。先讀回實際狀態，再對剩下 2 個重跑同一可重複步驟（`r2-simplification` 剩餘部分 0 個連結、0 個 node_modules；`room-lock-fix-20261010` 移除 1 個 node_modules），兩者均已移入回收筒。
4. `git worktree prune`，刪除兩個已合併分支；備份分支保留。

## 驗證

- 正式 `trusted-runtime
ode_modules` 在拆連結前、拆連結後、兩輪刪除後皆為 193 項；`D:\K-harness\.runtime\playwright-browsers` 皆為 316 檔。
- 保存的 41 個證據資料夾以 robocopy `/L` 比對來源，41／41 無差異。
- 9 個舊資料夾 `K-harness` 子目錄均已不存在；`git worktree prune` 移除 6 筆失效登記，`git worktree list` 只剩 `D:\K-harness`。
- `git branch -d`（只允許刪已合併分支）刪除 `codex/dolphin-loop-20261020`（c809f21）、`codex/mobile-remote-20261006`（f0d32ef）；剩 `main` 與 `backup/main-worktree-20261013`。
- 過程中沒有程序使用這些資料夾（以命令列含 `.codex\worktrees` 的程序查核為 0）。

## 驗收

- （待補：GPT-6.1 Sol 只讀驗收）

## 狀態

- 未動正式 K、未重啟；純文件與本機清理，不需部署。
