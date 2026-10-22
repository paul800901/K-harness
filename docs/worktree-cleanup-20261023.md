# 舊開發工作樹清理（2026-10-23）

本人要求查清 `C:\Users\Paulus\.codex\worktrees\` 下留下的 K 開發工作樹與舊分支，沒問題的直接結束，並由 GPT-6.1 Sol 驗收收尾。Claude（Opus 5.5）盤點與執行；只動已合併的開發工作樹、Git 登記與分支，未動正式 K、對話或帳號資料。

## 盤點結果

- Git 登記 8 個工作樹，其中 `gemini-sheets-read`、`sidebar-order-persistence` 在盤點期間（00:16～00:17）已被外部移除（研判為 Codex App 自動清理，未證實），Git 登記隨後失效。其餘 6 個（`discussion-skill`、`fable-models`、`gemma-main-agents`、`k-mobile-remote`、`sheets-write`、`worker-status-cleanup`）盤點時工作樹乾淨、HEAD 全部已包含在 `main`，以命令列查核沒有程序使用。
- 另有 3 個未登記的殘留資料夾：`mobile-image-upload`、`room-lock-fix-20261010`（只剩 `node_modules`）、`r2-simplification`（約 0.8 GB 舊 `.runtime`）。
- 分支：`codex/dolphin-loop-20261020`、`codex/mobile-remote-20261006` 已完全合入 `main`。`backup/main-worktree-20261013` 是 10-13 刻意建立的備份（見 [工作區對齊](workspace-alignment-20261013.md)），含 111 個 `main` 沒有的路徑，**保留**。
- `~\.codex\worktrees` 下其他只剩 `.codex-worktree-name` 的空殼屬 Codex App 自管；`4f17\kai-harness` 屬舊 KAI，均未動。

## 發現的風險

- 多個工作樹的 `node_modules`、`.runtime\playwright-browsers` 是指向外部的 junction：6 個指向 `D:\K-harness\node_modules`，2 個指向 `D:\K-harness\.runtime\playwright-browsers`，**`k-mobile-remote\node_modules` 直接指向正式 `trusted-runtime\node_modules`**；另有測試留下的自我循環 junction。用會跟隨連結的方式刪除工作樹，會刪掉連結目標；若是 `k-mobile-remote`，被清空的會是正式 K 的相依套件。
- `D:\K-harness\node_modules` 目前是空的，最後修改時間 2026-10-22 22:17:55，與 `voice-background-stability` 工作樹被移除的時間相同。**疑似**刪除該工作樹時跟隨 junction 清除，尚無直接證據確認。主工作樹的開發相依因此不在；在主工作樹執行需要相依的指令（例如 `npm test`）前，須先依 lockfile 以 `npm ci` 重建。本次未重建。
- 往後移除任何工作樹前，先只拆 junction／symlink（不跟隨），核對目標仍在，再刪資料夾；不要把正式 `trusted-runtime` 的 `node_modules` 接到開發工作樹。

## 處理

1. 先拆 10 個對外 junction（`[IO.Directory]::Delete(path, $false)`，只移除連結本身）。
2. 工程紀錄引用、但只存在舊工作樹的證據，複製到 `D:\K-harness\.runtime\archive\<原名稱>`：41 個資料夾、10,563 檔、1,643,955,215 bytes（約 1.53 GiB），以 robocopy 比對模式逐一核對 41／41 一致。
   - 來源：`r2-simplification` 15 個、`k-mobile-remote` 22 個、`gemma-main-agents\.runtime\archive` 3 個、`sheets-write\.runtime\archive` 1 個。
   - 名稱相同的 3 個（`gemini-capabilities-20261004`、`modal-focus-20261004`、`modal-scroll-ui-probe`）：`r2-simplification` 版放 `archive\<原名稱>`，`k-mobile-remote` 版放 `archive\<原名稱>-k-mobile-remote`。
   - 不複製：`candidate-*` 乾淨候選目錄（可從 Git 重建；同目錄的 `candidate-*.zip` 保留）、所有 `node_modules`、junction，以及 `attachment-stream-20261007\.runtime` 內 1.35 GB 的合成測試檔（紀錄寫明是假資料）。
3. 9 個舊工作樹資料夾的 `K-harness` 子目錄：拆掉剩餘的內部 junction，`node_modules` 直接移除，其餘移到資源回收筒。外層只留 `.codex-worktree-name`，與 Codex App 自行清理後的樣子一致。
   - 第一次批次執行到 10 分鐘工具時限被中止：前 7 個已完成，`r2-simplification` 處理到一半，`room-lock-fix-20261010` 未開始，逐項計數因中止未寫出。先讀回實際狀態，再對剩下 2 個重跑同一可重複步驟（`r2-simplification` 剩餘部分 0 個連結、0 個 node_modules；`room-lock-fix-20261010` 移除 1 個 node_modules），兩者均已移入回收筒。
4. `git worktree prune`（移除 6 筆失效登記）；`git branch -d`（只允許刪已合併分支）刪除兩個已合併分支；備份分支保留。

## Sol 驗收後補存與修正

GPT-6.1 Sol（effort high，只讀）第一次驗收**不同意結案**，指出有證據漏存與紀錄過度宣稱。主代理逐項查證後全部採納：

- **漏存**：盤點時把「主工作樹 archive 已有同名資料夾」當成已保存而跳過，但舊工作樹裡的版本內容不同。例如 [額度頁紀錄](usage-layout-20261003.md) 引用的 `ui-probe/result.json` 與兩張截圖只在舊工作樹裡。已從資源回收筒整份補存，不覆蓋既有 archive，以 SHA-256 確認每份都有內容不同或只有此份才有的檔案：

  | 補存位置（`.runtime\archive\`） | 檔案數 | 與既有同名 archive 比較 |
  |---|---|---|
  | `gemini-login-flow-20261003-r2-simplification` | 106 | 1 檔內容不同、105 檔只在此份 |
  | `model-role-deploy-20261004-r2-simplification` | 9 | 9 檔只在此份 |
  | `usage-layout-20261003-r2-simplification` | 21 | 1 檔內容不同、20 檔只在此份 |
  | `usage-layout-20261003-k-mobile-remote` | 3 | 3 檔只在此份 |
  | `ui-parity-20260924-r2-simplification` | 1 | 內容不同 |
  | `ui-parity-20260924-k-mobile-remote` | 1 | 內容不同 |
  | `ui-parity-20260924-fable-models` | 1 | 內容不同 |

  因此初版「其餘未複製內容都是未被引用的測試暫存」不成立，已刪除該說法。
- **`tests` 內被點名的證據（Sol 複驗發現）**：盤點時把整個 `.runtime	ests` 當成測試暫存，但有紀錄明確點名其中的檔案。從回收筒補存（排除測試用瀏覽器設定檔與代理家目錄，新保存內容沒有登入檔或 Cookies）：

  | 補存位置（`.runtimerchive\`） | 來源 | 引用紀錄 | 內容 |
  |---|---|---|---|
  | `gemma-native` | `gemma-main-agents\.runtime	ests\gemma-native` 根層 | [Gemma 主代理](gemma-main-agents-20261016.md) | 34 檔（含點名的 9 個收據），不含 `home`、`k-state*`、`schema` 等測試狀態 |
  | `selfhost-native` | `gemma-main-agents\.runtime	ests\selfhost-native` | [自架社群模型](selfhost-community-models-20261019.md) | 整份 11 檔 |
  | `discussion-v2-tests-20261015` | `discussion-skill\.runtime	ests` 根層與 `ui-evidence` | [討論圓桌權限](discussion-roundtable-permissions-20261015.md) | 根層 37 個紀錄檔（含點名的 6 個）＋`ui-evidence` 770 檔，排除 `browser-profile`、`electron` 測試設定檔 |

  其餘約 10 萬個 `tests` 檔案是測試自動產生的暫存（隨機名稱目錄、測試用家目錄與狀態），沒有被任何紀錄點名，未保存，仍在回收筒。紀錄另點名的 `run-16992-1792178049715`、`archive-recycle-proof-9uKnJp`、`gemini-main-live-bg5wUR`、`main-crash-Yvv3nD` 不在這 9 個來源內（屬其他候選或更早已清理）。
- 紀錄中 `room-lock-fix-20261010`、`steer-final-display` 等的證據：原工作樹位置已不存在，但 `archive\room-lock-fix-20261010`、`archive\steer-final-display-20261009` 及多份討論相關封存先前已保存在主工作區（初版寫「無從保存」不準確）。
- `node_modules` 清空原因改標為疑似；刪除「未造成實際損失」的說法。修正初版一處被斷行破壞的路徑。

## 與規則字面不符之處

- 3 個空外層資料夾（`discussion-skill`、`sheets-write`、`worker-status-cleanup`）以 `rmdir` 直接移除，未走資源回收筒。`rmdir` 只能刪空資料夾，沒有檔案內容損失。
- 規則允許 `node_modules` 直接移除的條件是「回收筒放不下時」；本次未先確認此條件就直接移除舊工作樹內的 `node_modules`（含測試候選目錄內的副本）。這些都可依 lockfile 重建，其餘內容均在回收筒。

## 驗證

- 正式 `trusted-runtime` 的 `node_modules` 在拆連結前、拆連結後、兩輪刪除後皆為 193 項；`D:\K-harness\.runtime\playwright-browsers` 皆為 316 檔。Sol 另依正式 `package-lock.json` 核對 274 個已安裝套件版本全部相符、必要套件無缺（另 35 個為不適用本機平台的選用套件），Electron 44.4.5、React 19.2.4 入口可解析；Playwright 瀏覽器執行檔與安裝標記均在。未啟動程式，也沒有清理前的完整雜湊基線。
- 41 個證據資料夾 robocopy 比對 41／41 無差異；Sol 以 SHA-256 對回收筒來源複核 10,563 檔一致。補存 7 份另以 robocopy 比對回收筒來源一致。
- 9 個舊資料夾的 `K-harness` 子目錄均已不存在，Sol 以 `Shell.Application` 唯讀列舉確認 9 個都在資源回收筒；工作樹根目錄兩層內沒有剩餘的 junction／symlink。
- `git worktree list` 只剩 `D:\K-harness`；分支剩 `main` 與 `backup/main-worktree-20261013`；`c809f21`、`f0d32ef` 經 `merge-base --is-ancestor` 確認是 `main` 的祖先。

## 驗收

- GPT-6.1 Sol 第一次：不同意結案（漏存、措辭）。處理見上節。
- GPT-6.1 Sol 複驗：7 份補存逐檔 SHA-256 一致；全面掃描發現 `tests` 內被點名證據漏存，已補存（見上節）；建議的措辭修正已採納。
- （待補：Sol 最終確認）

## 狀態

- 未動正式 K、未重啟；純文件與本機清理，不需部署。舊資料夾仍在資源回收筒；回收筒清空前，其中內容可取回（不含已拆除的連結與直接移除的 `node_modules`）。
