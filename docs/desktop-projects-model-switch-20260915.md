# 多專案與主代理換模驗收

日期：2026-09-15。狀態：已實作、已建置，並在本機 K 介面完成下列實測。

## 本輪變更

- 左側改成多專案分組，每個專案包含自己的對話，可展開／收合，並保留收合設定。
- 支援加入既有資料夾；沒有對話的專案也會保留。加入專案不會切換目前對話、不會移動檔案或改變操作權限。
- 既有 K 對話按其工作資料夾歸組，不按模型分類，也不遞迴掃描、列出所有子資料夾。子代理不列入主要對話清單。
- 專案列的新增按鈕預選該專案；全域「新工作」可選專案。保留搜尋、釘選、重新命名、封存及既有選單關閉行為。
- 輸入區可選擇主代理與推理程度，模型清單取自已登入 Codex 的 model/list。
- 空白對話選模型不顯示換模風險警告；有歷史內容且選不同模型才要求確認。
- 選擇模型本身不呼叫推論；下一次 turn/start 明確帶入模型與推理程度。只有實際送出成功的模型變更，才在對話中留下換模註記。
- 仍沿用 Codex 正式對話歷史。換模不重建為只有摘要的新對話，也不改動子代理選擇、工作資料夾或操作權限。
- 修正驗收時觀察到的跨對話殘留換模提示；操作失敗時，對話框內也會顯示錯誤。

專案列改編自 DSH 的既有排列方式，未引入 DSH 執行服務或新的套件。來源與授權見 [專案側欄來源](third-party-workspace.md)。Codex 接口依據：[官方 App Server 文件](https://learn.chatgpt.com/docs/app-server)。

## 自動驗證

- `npm test`：124 項通過、0 失敗、0 略過。
- `npm run build:ui`：成功。仍有既有的單一前端 bundle 大於 500 kB 提醒，本輪未另做打包架構調整。
- 新增專案儲存、重複加入、並行加入、損壞資料保留、分組／搜尋／封存／子代理排除及 HTTP 權限測試。
- 新增換模確認／取消、無效選項、下一回合模型、推理程度、權限保留、換模註記重開讀回、長註記資料及空白對話切換測試。
- 獨立完整回歸曾發現新增專案測試錯把並行加入順序當成固定要求；已改成驗證成員完整與實際保存順序一致，重新完整執行後通過。

## 真實介面與模型驗證

在 K 內加入人工測試資料夾 `D:\K-harness\.runtime\專案介面驗收`，未讀取正式工作資料；受測模型沒有使用工具或派出子代理。

### A：同一對話 Luna 換成 Terra

- 對話：`01a0a40c-6257-7932-8961-23bc404fef3e`。
- 名稱：`驗收 A｜Luna → Terra 接續`。
- 第一回合 Luna 低推理、唯讀，收到人工代號後回覆 `K-PROJECT-731`。
- 在已有歷史時選 Terra，介面顯示接續品質／可能壓縮的警告；取消後仍為 Luna。
- 再次確認切換至 Terra，第二回合沒有再次提供代號，仍正確回覆 `K-PROJECT-731`。
- 透過官方 thread/read 找到該對話紀錄，獨立讀回兩個 turn_context：

| 回合 | 實際模型 | 推理程度 | 操作權限 |
| --- | --- | --- | --- |
| `01a0a40d-3bed-7261-b986-aab771ef545a` | `gpt-5.6-luna` | low | read-only |
| `01a0a40e-a71d-7e20-9328-58abce3df4d4` | `gpt-5.6-terra` | low | read-only |

兩回合 cwd 都是上述人工測試專案。這證明實際更換模型，不只是更換顯示標籤。

### B：同專案另一個獨立對話

- 對話：`01a0a410-1e35-79a1-9b35-f4692b5917ab`。
- 名稱：`驗收 B｜同專案獨立對話`。
- Luna 低推理、唯讀，回覆 `K-SECOND-READY`，沒有 A 的歷史或換模註記。
- K 讀回顯示一問一答、工具與子代理皆為空。

### 操作與顯示

- 同一專案可新增並保留 A、B 兩個對話。
- 重新載入最新建置後，專案、對話與收合狀態保留。
- 從測試專案切至 K-harness 原有對話，可讀回原本的 `K-SWITCH-READY-20260915`；再切回 A，四則原訊息、Terra 選擇與換模註記仍在。
- 再切 B，維持自己的 Luna、唯讀與獨立內容。另一對話的模型提示不殘留。
- 全域搜尋「驗收 A」只顯示符合的對話與所屬專案；關閉搜尋恢復專案列表。
- 三點選單點外部與 Esc 都可關閉，重新命名成功。
- 實際檢視多專案側欄、換模對話框及對話畫面；保留緊湊清單、暖色、圓角分區及右側工作面板。

## 限制

- 這是三次簡短人工模型回覆與介面驗證，不是長上下文、跨模型全部組合或所有通用工作的無損保證。
- Codex 中途換模仍可能影響接續品質或觸發上下文壓縮。K 提供明確提示與紀錄，沒有消除這個底層限制。
- 目前仍是一個正在操作的主代理回合；主回合執行中需先完成或停止，才能切換其他對話。多專案多對話不等於多個主代理同時執行。
- 本輪沒有新增專案刪除／改名、跨資料夾聚合或正式資料搬移機制。
- 測試專案與對話保留供檢視，沒有刪除舊資料；未改 DSH、全域設定、登入、API key 或計費方式。

## 修改清單與備份

程式碼：

- `src/projects.mjs`（新增）
- `src/desktop-server.mjs`
- `src/desktop-controller.mjs`
- `src/main-sessions.mjs`
- `frontend/project-groups.mjs`（新增）
- `frontend/project-sidebar.jsx`（新增）
- `frontend/main.jsx`
- `frontend/model-picker.jsx`
- `frontend/workspace.jsx`
- `frontend/sidebar.css`
- `test/projects.test.mjs`（新增）
- `test/desktop-model-switch.test.mjs`（新增）
- `test/desktop.test.mjs`

文件：本檔、`docs/third-party-workspace.md`。建置輸出位於 `dist-ui`；本機測試狀態位於 `.runtime`，正式 Codex 對話紀錄仍由 Codex 保存。

修改前備份：

- `D:\K-harness\.runtime\projects-ui-before-ac5a1e2a274e4675a0b571fd15f893bc`：main.jsx、model-picker.jsx、workspace.jsx、sidebar.css、desktop-server.mjs。
- `D:\K-harness\.runtime\model-switch-before-2c08db0e3b8f42e2a935fdb211580ef8`：desktop-controller.mjs、main-sessions.mjs。

備份可用於人工還原對應檔案，並非本輪全部新增檔案及測試紀錄的一鍵回復包。
