# K 主代理中止與工人狀態回復

## 本輪修正

原入口 Ctrl+C 只送出 turn/interrupt 然後離開，沒有確認工人是否停止。本輪改為：

- 工作中 Ctrl+C：中止主回合，檢查本對話已派工的工作；只有目前主機回報 running 才取消並事件等待，保留所有已有成果，之後回到輸入畫面。
- `/workers`：從該對話工具紀錄取得確切 request ID，直接查狀態，不使用模型回合、不掃其他任務。
- 重開對話：先讀官方保存的原對話工具項目，查明原工人狀態。unresolved/unavailable 不視為已停止，也不接管或重派。
- `/exit` 或閒置 Ctrl+C 離開前同樣確認工人；查不到時明確顯示未知，不承諾回滾。
- 中止會終止尚在等待的核准問題；未知額外權限仍不核准。回合尚在建立時收到中止也會在取得 turn ID 後處理。

依 [OpenAI Docs 的 App Server 中止介面](https://learn.chatgpt.com/docs/app-server)，K 使用 turn/interrupt 中止主回合；工人另透過同一對話的 k_flash inspect/cancel/wait 處理。沒有另起模型或工人來檢查既有工人。

## 實際驗證

1. 使用 Start-K.ps1 重開 Astra 對話 `01a09f15-cdf1-7822-939c-f3c51c632a4b`，正確找回 `main-case-cYowCN` 並查得 completed。
2. 在真實 K 終端啟動一輪唯讀 README 分析，輸入 Ctrl+C；收到 interrupted，確認原工人狀態，回到「你 >」而非退出。接著 /workers 正常查詢、/exit 正常結束。
3. 最新版本再次重開與 /exit，確認離開前也讀回工人狀態。工人完成不代表此次狀態查詢有重新驗收成果。
4. 實際跨程序 MCP／Pi 模擬工人先寫 output.txt，再等待；新主控停止邏輯依序 inspect → cancel → wait，取得 cancelled，output.txt 原文保留，未重送。
5. 56／56 離線回歸通過，包括本輪 4 項對話工人範圍／取消測試。新增程式 src/main-workers.mjs，入口修改 src/main-cli.mjs；沒有改全域設定或憑證。

## 限制

第 2 項是真實 Astra 中止，但其工人已在先前完成；第 4 項是真正跨程序工人取消，但使用腳本模型，不是 DeepSeek API。不能把兩項拼接宣稱為「真實 Astra 中止時，活躍 Flash 同步停止」已實測。

仍待驗證：主控硬當機與工人副作用的整體恢復、核准期間的真人中止、主對話大量上下文壓縮、長程多服務工作。本輪没有建立自動重播、自動恢復或跨程序接管；未解決狀態持續明示，不因完成本輪而宣稱整個 K 可替代 Codex App。
