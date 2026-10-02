# 東區更新合入 main 與南區取得方式（2026-10-03）

使用者確認兩項複查補修正確，並明確選擇「合進 main 再推」，授權將本輪東區七個提交整合至 `origin/main`。

## 整合與驗證

- 整合前 `origin/main` 為 `e80cd034d283785315b7063d725cd7818357b8f7`，東區分支為 `32c50a0`；差異為遠端一個工程文件提交及東區七個提交。
- 本機 main 已以 merge commit `2c176c0c82398601b5dd87078d1ac102f2dc17de` 合入 `dongqu/windows-dictation`，沒有衝突；保留遠端更新過的四份工程文件及東區完整歷史，不 rebase、force-push 或修改既有 tag。
- 除 README／docs 外，合併後所有追蹤檔與已驗證候選程式 `eba08d9` 一致。沿用該候選完整 **514/514** 與建置登入 UI 驗證；未將它們宣稱為本輪重新執行。合併後另在 `K_DICTATION_PROVIDER=windows` 重跑三個相關檔案 **20/20**，無失敗或跳過，紀錄 `.runtime/bootstrap/main-publish-tests-20261003.log`。
- README 與安裝更新指南改為 `origin/main`，說明 `git pull` 取得來源與更新器套用現用程式是兩個步驟；南區本機聽寫設定保留，未設定時仍預設 Whisper。
- 本輪只發布程式與工程文件；沒有重開、更新東區／南區現用 runtime，沒有搬登入、對話、語音模型或 `.local`／`.runtime` 檔案。

## 南區操作

南區 main 工作樹確認沒有需保留的修改後，`git pull --ff-only origin main` 取得這批更新。要實際使用新版，先由 K 選「離開並停止 K」，再執行 `Update-K.ps1 -Ref 'origin/main'`，成功後執行 `Start-K-Desktop.ps1`。本人登入、實體麥克風及真實模型回合仍須當地驗收。

## 發布狀態

2026-10-03 01:36（臺灣時間）已正常推送 `main`，由 `e80cd03` 更新至 `2cf47258ff293412a853e7db83a6e9984c1cb75d`。GitHub `refs/heads/main` 實際讀回與本機發布提交完全一致，東區七個提交及更新指南均可由南區取得。工作樹乾淨，未 force-push；此節為完成後的工程紀錄補記。
