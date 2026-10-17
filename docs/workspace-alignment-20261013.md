# D:\K-harness 原始碼工作區對齊（2026-10-13）

本人要求先整理 K 的工作區再處理技術債。Claude（Opus 5.5）執行，只動 Git 原始碼工作區；未更新正式 K、未 push、未動東區。

## 對齊前狀態

- `D:\K-harness` 的 `main` 停在 R2 時期 `56bb038`，落後 `origin/main` 212 個提交；9 個追蹤檔被修改、約 100 個未追蹤檔，多為先前對話直接寫進此舊工作樹的文件。
- 在此開啟的 K 聊天室因此讀到過期 `AGENTS.md`／README，缺少 10-04 起的多節規則。
- 正式 K（`trusted-runtime`）的 `.local/runtime.json` 版本為 `a95fd65`，與 `codex/room-lock-fix-20261010` 最前端 `bd82d3a` 的程式碼相同（兩者只差 docs）；正式 K 本身不需更新。

## 處理

1. 以暫存索引建立備份分支 `backup/main-worktree-20261013`（`9951d13`，父提交為舊 main `56bb038`），內含 9 個修改檔與 100 個未追蹤檔；`installed/`、`.codex-remote-attachments/` 不入 Git、留在原處。
2. `main` 重設為 `bd82d3a`。舊 main 獨有的 4 個 R2 文件提交保留在備份分支歷史。
3. 收回文件：
   - 11 份只存在舊工作樹、Git 從未收錄的紀錄原樣加入；`k-fixes-deploy-held-20261007.md` 與 `efbd899` 版本相同，一併加入。
   - 本機版為分支版超集或狀態較新者改用本機版：`gemini-k-fixes-integration-20261007`、`native-failure-opus-investigation-20261010`、`opus-review-r3-1-20260930`、`worker-native-models-engineering-20261008`、`gemini-command-pathext-20261007`。
   - 其餘 7 份兩邊不同的文件（`git-install-update`、`readme-history-before-20261001`、`codex-capacity-error-20261009`、`steer-final-display-20261009` 等）採分支版；這些是不同對話對同一收尾的平行寫法，舊寫法保留在備份分支。
4. 根目錄 8 張除錯截圖移至 `.runtime/root-screenshots-20261013/`，未刪除。

## 分支整理

- 已合併分支刪除：`codex/chat-links-20261007`、`mobile-image-upload-20261008`、`modal-focus-fix`、`public-readme-20261009`、`r2-simplification`、`r3-1`、`r3-2`。
- 已含於 main 的 `steer-final-display-20261009` 刪除。
- 5 條只含文件收尾提交、未合回主線的分支，內容併入 main：`attachment-only-20261009`（2771bad）、`discussion-feature-20261008`（7d19ccf）、`gemini-command-pathext-20261007`（3ee970a）、`native-attachments-20261008`（823c65f）四條刪除（原提交 SHA 供日後查回）；`k-diagnostic-fixes-20261007`（efbd899）仍被工作樹使用而保留。
  - 7d19ccf 的 f5e9e26 正式部署收尾段落原本不在 main，已收回 3 份文件；`development-log` 兩行舊「未部署」索引改為分支上的部署後寫法，並補回 10-07 三項修正條目。
  - 其餘提交內容 main 已涵蓋或有較新寫法。
- 仍被其他工作樹使用、未動：`codex/room-lock-fix-20261010`、`mobile-remote-20261006`、`multi-model-discussion-20261008`、`k-diagnostic-fixes-20261007`（`.runtime/chat-links-20261007/source`）。

## 未完成

- `node_modules` 仍是舊 main 時期安裝，與現行 `package-lock.json` 不一致；未自動重新安裝，在此跑測試前需另行處理。
- 其他分支、額外工作樹、`.runtime` 試驗產物與 GitHub 未推送的 70 個提交另行整理。
