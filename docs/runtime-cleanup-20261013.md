# .runtime 與本機工作區整理（2026-10-13）

本人授權「安裝後跑完測試，可刪就刪，以後有用就保存，但要放好」。Claude（Opus 5.5）執行；正式 K 未停止、未更新，整理前後 `/health` 皆 200。

## 相依安裝與測試

- `D:\K-harness` 依 `package-lock.json` 執行 `npm ci`（273 套件），只在專案內。
- 完整測試 `node --test --test-concurrency=4 test/*.test.mjs`：1589 項，1588 通過、1 失敗。失敗的 `local-dictation` 測試是因為在 K 內執行時繼承了正式 K 的 `K_DICTATION_PYTHON`／`K_DICTATION_MODEL`，測試卻預期預設路徑；去除這兩個環境變數重跑該檔 13/13 通過。
- 修正（只改測試）：該測試明確傳入預設路徑，不再依賴外部環境；環境變數覆寫行為仍由同檔另一測試涵蓋。有無環境變數皆 13/13。

## 整理原則

- 原地不動：正式 K（`trusted-runtime`、`trusted-providers` 目前與上一版核心、`vault`、`workspace`、`agent-home`、`browser-output`）、最新 3 份退版、Sandboxie 元件（`portable`、`boxes`，服務／驅動指向此處）、`playwright-browsers`、測試暫存 `tests`、`.runtime/secrets`、`browser-extension/.local`（擴充簽章私鑰）、`installed/`、`.local/`、其他聊天室進行中的新目錄。
- 刪除（資源回收筒）：沒有任何工程紀錄引用的 log、試驗腳本、Sandboxie 時期暫存（`k-sbie-*` 約 300 個）、測試殘留目錄；舊退版、未被引用的候選建置與其壓縮檔；`selected-cores.json` 未使用的舊核心（Claude 2.1.289、Codex 0.160.0）。
- 直接移除（不經回收筒）：舊退版、候選建置與封存區內的 `node_modules`，共約 190 個、72.2GB（65.5＋封存區 3.6＋Astra 更新後再整理退版 3.1）。皆為 npm 公開套件，可依 lockfile 原樣重新取得，不含專案資訊；回收筒容量（約 49GB）放不下。跳過任何連結（junction），不會順連結刪到其他位置。
- 保存（`.runtime/archive/`，名稱不變）：被 `docs` 引用的證據與 9 月舊開發狀態；`isolation-pilot` 旁的試驗與被引用候選放 `archive/isolation-pilot-extras/`。說明見 `.runtime/archive/README.md`。

## 結果

- `.runtime` 根層由約 640 項整理為：`archive`、`isolation-pilot`、`playwright-browsers`、`secrets`；測試暫存 `tests` 由測試自動重建；本次工具與清單在 `archive/tidy-20261013`。
- 退版只留最新 3 份（含 `runtime.json` 的 `previous`）。資源回收筒新增約 4GB；D 槽可用空間 503GB → 約 580GB（回收筒清空後會再增加）。
- Git：移除 `.runtime` 內兩個舊工作樹（`chat-links-20261007/source` 為乾淨 checkout；`multi-model-discussion-build-20261008/source` 的未提交草稿已存成 patch 於 `archive/multi-model-discussion-prototype-20261008/`，main 已有更新版本），刪除對應的已合併分支。剩 `main`、`backup/main-worktree-20261013`，以及 Codex App 自管工作樹使用的分支。
- 根目錄：`frontend/.runtime`（9 月 UI 建置輸出）移至 `archive/frontend-runtime-202609`；空的 `NVIDIA Corporation` 送回收筒。

## 路徑對照

工程紀錄中的 `.runtime/<名稱>` → `.runtime/archive/<名稱>`；`.runtime/isolation-pilot/<試驗目錄>` 與 `sandboxie-candidate-3b6c43ee/prepare-*`（被引用者）→ `.runtime/archive/isolation-pilot-extras/<名稱>`；`sandboxie-candidate-3b6c43ee/` 下的零散 json／log／腳本 → `.runtime/archive/isolation-pilot-extras/candidate-files/`。被刪除項目的清單在 `.runtime/archive/tidy-20261013/`（`del-junk.txt`、`recycle-ip.txt`、`recycle.log`、`strip.log`）。

## 中途更新

整理進行中 Astra 部署 `2f6cdc8`（Gemini 額度獨立查詢）並重開 K，本對話被中斷；回收工作停在 117/119，重開後補完。核對 Astra 這批 19 個提交皆在 main 並已 push、`AGENTS.md` 依主題原地改寫、正式 `/health` 200；退版依同一原則再整理成最新 3 份。Astra 留在根層的 4 個部署證據（`fable-*`、`quota-*`）移入 `archive/`。

在 `2f6cdc8` 之後的 main 加上本次測試修正重跑完整測試：1617 項，1616 通過。另外清掉 `.runtime/tests` 累積的 44,155 個測試暫存資料夾（659MB），以及本次重跑測試在根層留下的 63 個暫存目錄。

## 未處理

- `Update-K.ps1` 每次更新都新增退版、從不清理舊的，因此累積到 71 份（每份約 1.15GB）。之後應在更新器加保留份數，屬程式修改，依發布流程另做。
- 測試不清理自己的暫存：約 250 處 `mkdtemp` 寫進 `.runtime/tests`，另有一批測試與 `test/*-probe.mjs` 直接寫到 `.runtime/<名稱>`；每跑一次完整測試約多 1,500 個資料夾。應改成測試結束時自行刪除或統一寫到系統暫存，屬程式修改另做。
- 偶發失敗測試：`test/chat-continuation.test.mjs` 的「real controllers retain fresh completed accepted before its own late stdout tool events」單獨跑 5 次失敗 2 次，失敗時是 2 秒等待逾時（正常約 90 毫秒），不像單純負載變慢，可能是聊天室接續流程的時序問題。該區由 Sol／Astra 撰寫，需查明並經 Opus 5.5 審核。
- Codex App 自管的工作樹（`C:\Users\Paulus\.codex\worktrees\` 下 `k-mobile-remote`、`room-lock-fix-20261010`、`fable-models`、`quota-scheduler`）可能仍連著該 App 的對話，未動。
- 資源回收筒未清空，由本人決定。
