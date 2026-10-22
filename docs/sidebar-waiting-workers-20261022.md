# 側欄顯示「等待子代理」

2026-10-22，分支 `sidebar-waiting-workers-20261022`。

## 問題

本人回報：側欄每個聊天室只有三種樣子——有新回覆（實心對話泡）、主代理工作中（轉圈）、什麼都沒有（日期）。主代理已待命、但本聊天室的子代理仍在跑時，側欄落到「什麼都沒有」，和沒工作的聊天室看起來一樣，容易誤會已經結束。聊天室內上方已有「主代理待命 · 子代理 · 等待 1」，只有側欄缺。

## 差異

- `src/conversation-controller.mjs`：每個聊天室的 `conversationActivity` 多帶 `pendingWorkers`，計算規則與上方子代理快覽相同——非命令、未結束、仍有執行歸屬（`executionUnowned !== true`）的工人。舊工單、已結束工單不算。
- `frontend/project-sidebar.jsx`：優先順序為「待確認（三角）→ 主代理處理中（轉圈）→ 等待子代理（沙漏，不轉動）→ 有新回覆（對話泡）→ 日期」。沙漏的提示文字為「等待子代理」。
- `frontend/sidebar.css`：`waiting-workers` 用與工作中相同的黃銅色，不加動畫，以和「主代理正在動」區分。

只是呈現，不改工人生命週期、不判死、不重送，拖曳與換工作區的既有限制不變。

## 驗證

- `test/conversation-controller.test.mjs`：沿用舊工單夾具，live＋仍有歸屬的 unresolved 計 2，舊工單與已結束不計；只剩舊工單時為 0。
- `test/sidebar-ux-ui-probe.mjs`：新增聊天室 D（主代理閒置、`pendingWorkers: 1`），三主題 × 兩寬度均確認沙漏出現一次、且轉圈／對話泡／沙漏三種圖形互不相同。截圖在 `.runtime/archive/sidebar-waiting-workers-20261022/`。
- `npm test` 1806/1806；`npm run build:ui` 後 `npm run test:ui` 49/49。

## 複查與部署狀態

- 程式由 Opus 5.5（主代理）撰寫並自查。
- Fable 5.1（high，只讀，工單 `fable-review-sidebar-waiting-workers-20261022`）四項皆無問題：計數與上方快覽同源（`workerDetails` 投影不改變 `workerEnded` 結果）；三家 `s.workers` 來源均含 K 工人與原生子代理；`sessions()` 展開無寫回副作用；`completion-attention.mjs` 在仍有自有未結束工人時不設未讀，沙漏與對話泡實際上幾乎不會同時成立。主代理已讀回 `src/completion-attention.mjs` 核對此點。
- 既有、非本次範圍：Claude 背景命令（`kind:'command'`）不計入沙漏，與快覽一致；側欄兩段三元判斷可合併，屬原寫法，不改。
- 尚未部署。本聊天室在 K 內執行，無法更新自己所在的 K；需與同時進行中的 Gemini 派工修正聊天室協調單一部署者，於 K 完全停止後在 K 外執行 `Update-K.ps1`。

## 未完成

- 正式 K 中實際派工時的目視確認待本人。
