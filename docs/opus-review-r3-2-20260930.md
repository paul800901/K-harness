# Opus 複查：R3-2 正式版（2026-09-30）

> 對象：正式部署的 `R3-2-candidate-20260930`（0df3bf7），紀錄見 [r3-2-cleanup-20260930.md](r3-2-cleanup-20260930.md)。部署後集中複查；只讀、未改程式、未送模型工作。

## 結論：通過，另有一項流程建議

| 項目 | 結果 |
|---|---|
| 正式檔案 | 正式 runtime 的 48 個 src 模組與 0df3bf7 逐檔一致，沒有殘留已刪模組 |
| 本聊天室即時狀態 | 跑在 K 專用 Claude Code **2.1.285**；環境變數完整（COMSPEC／PATHEXT／ProgramData）；存檔為 `-current.json`（20:42 寫入） |
| 刪減 | 核心 +193／−3,818 行。新增的 193 行大多是刪除後留下的簡化版本（瀏覽器面板改成只顯示外部 Chrome 狀態、desktop-server 只留原生入口、Electron 不再開 CDP 管道） |
| 子代理選擇（新功能） | `worker-policy` 只接受 GPT-6.1 Sol／GPT-6 Luna，推理程度以官方目錄驗證，不在清單就報錯、不換模型；`luna_start` 的同一 requestId 若換了模型或推理程度會拒絕重送；沒有失敗備援或自動重試。這兩個模型是使用者指定的固定選項，之後有新 GPT 模型要再改程式（有意為之） |
| 測試 | 652→497 項。刪掉的 24 個測試檔全都對應已移除的模組（Pi 工人、Sandboxie、內嵌瀏覽器、Win+H、探針），沒有誤刪仍在使用的功能的測試 |
| G 級防護 | 單次核准、不重送、不改走 API 計費、Host／Origin／token、下載 Zone.Identifier、資源回收筒均保留 |

## 流程建議：讓 `D:\K-harness` 的原始碼等於正式版

正式版原始碼現在在分支 `codex/r3-2`（`C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`）。主工作樹 `D:\K-harness` 仍停在 `main`（56bb038）：
- `src/` 有 72 個模組，其中 26 個已從正式版移除（Pi 工人、Sandboxie、內嵌瀏覽器、shared-knowledge 等）。
- 其餘模組也是較舊的版本。

K 的聊天室（包括本聊天室）和 Codex App 都以 `D:\K-harness` 為工作目錄。之後任何 AI 或人打開這裡看程式，看到的都是過期程式碼，容易誤判或改錯地方；交接文件雖有提醒，但這是一個長期的陷阱。

**建議（Astra 做，單一寫入者）**：
1. 把 `main` 合併到正式版（`R3-2-deployed-20260930`），讓 `D:\K-harness\src` 與正式 runtime 一致。
2. 共享知識實驗另開分支保存（例如 `experiment/shared-knowledge`）。
3. 主工作樹裡未提交的實驗檔先列清單，再決定放進實驗分支或保留；不要直接刪除。

## 未實測（照實列出）

- 正式 K 的外部 Chrome 助手：這次移除了 Electron 的 CDP 中繼，候選版已用獨立 headless Chromium 測過 4/4，但正式 Chrome 沒有實際操作。
- 真正的 Sonnet 5.5 主代理回合，以及 Sol 6.1 子代理任務。
- 麥克風聽寫、工作中退出、確認後強制結束。

以上建議使用者在日常使用時順手確認。
