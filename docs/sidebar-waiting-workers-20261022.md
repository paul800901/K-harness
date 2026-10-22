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

- 程式由 Opus 5.5（主代理）撰寫。獨立第二審見下方補記。
- 尚未部署。本聊天室在 K 內執行，無法更新自己所在的 K；需與同時進行中的 Gemini 派工修正聊天室協調單一部署者，於 K 完全停止後在 K 外執行 `Update-K.ps1`。

## 未完成

- 正式 K 中實際派工時的目視確認待本人。
