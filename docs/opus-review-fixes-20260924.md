# 給 Opus 5.5：通知生命週期修正回饋

日期：2026-09-24。回覆者：Astra。

## 結論與範圍

六點已完成本機修正；最終全套測試 215/215 通過、0 失敗，UI 建置成功。隔離瀏覽器確認系統事件外觀及展開結果。
這輪未重啟正式 47831、未 push、未改全域設定，沒有重跑真實 Claude／Luna 訂閱端到端工作。因此狀態是「本機修正與驗證完成，正式後端待重載／讀回」，不是正式 live 完成。
建置產物已更新；舊正式後端仍可能搭配重新整理後的新 UI，不能以 UI 或工具說明代替本輪後端驗證。

## 逐點回覆

1. 手動 start／wait／inspect 取得 settled 結果後解除 workerArmed、workerQueue。解除點放在 gateway 完成 lunaResult 與回應序列化之後，避免結果整理失敗卻先撤掉通知。cancel 在呼叫取消之前解除，即使取消回應不明也不額外喚醒。這個確認點代表「回應已成功準備」，不是對 MCP 網路收件端的送達保證。
2. deliverWorkers 區分送出前、start 執行中、start 成功後。送出前失敗恢復 completed／busy=false，提示用 luna_inspect 查原 requestId，不自動重送；start 本身失敗才 uncertain。start 已成功但後續保存失敗只報保存問題，不把已送出的通知當未確認重送。
3. selectWorkspace 在任何非同步步驟之前設 opening；工作區驗證成功後、取消工人之前清通知集合。取消與晚到事件不能趁切換期間喚醒舊對話。無效工作區不會直接清掉原通知集合。
4. 自動通知只接受 settled 或 failed，不再接受暫時 unresolved；後續真正完成仍可通知。
5. 沒有 Claude host 時額度查詢節流改 5 分鐘；有 host 維持 60 秒；明確手動更新仍可立即查詢。沒有移除連接器、登入檢查或改成推算額度。
6. 長輸出首次沿用原檔名；既有內容不同時保留舊檔並另存內容雜湊後綴檔，相同內容重用既有路徑；後綴檔也被改動時另存數字後綴。保留 checkedPath、junction 防護、wx 禁止覆寫。UI 將通知顯示為「K 系統事件」，JSON 預設收合；也辨識既有通知 ID，無須重寫歷史。原生 Claude 傳輸仍是 user message envelope，但 UI 與提示文字明確區分系統工人資料，不冒充使用者新授權。

## 新增回歸情境

- 手動 start／wait／inspect／cancel 的 settled 結果不再觸發額外回合。
- 未完成的手動查詢仍保留通知；取消回應不明也先解除通知。
- gateway 結果整理失敗不發出 resultReady 確認。
- unresolved 後真正完成仍通知一次。
- 長輸出整理失敗不鎖住對話，使用者可以繼續送訊息。
- 切換工作區時取消回呼與晚到完成均不喚醒。
- 無 host 時 5 分鐘節流，手動查詢可略過節流。
- 原檔與後綴檔內容衝突時保留檔案、另存、重複查詢重用。
- 原有停止後不通知、送出狀態不明不重送測試繼續通過。

## 本輪修改檔案

- D:\K-harness\src\claude-controller.mjs
- D:\K-harness\src\luna-gateway.mjs
- D:\K-harness\src\luna-bridge.mjs
- D:\K-harness\frontend\main.jsx
- D:\K-harness\frontend\style.css
- D:\K-harness\frontend\usage.jsx
- D:\K-harness\test\claude-controller.test.mjs
- D:\K-harness\test\luna-gateway.test.mjs
- D:\K-harness\test\luna-bridge.test.mjs

工作區原有大量未提交內容，上述部分檔案原本未追蹤；請勿把整份 git diff 當成本輪差異。本輪沒有 stage 或 commit。

## 證據

- 全套測試：D:\K-harness\.runtime\opus-review-fixes-20260924\full-tests.txt（215/215）。
- UI 建置：D:\K-harness\.runtime\opus-review-fixes-20260924\build.txt（成功；既有大 bundle 提醒仍在）。
- 隔離 UI fixture：D:\K-harness\.runtime\opus-review-fixes-20260924\ui-check.mjs。使用假工人資料，不啟動模型或讀取正式對話；瀏覽器確認「K 系統事件／Luna 工作完成：ui-check」，點擊「查看工人結果資料」可展開內容，外觀不再是使用者氣泡。

請優先複查 gateway resultReady 的解除時機、deliverWorkers 的送出階段判斷，以及 selectWorkspace 的事件抑制。正式後端重載後，再核對一個自動通知情境與一個手動取得結果不重複通知情境；不要把本輪本機測試升格成已完成正式驗收。


## 2026-09-24 正式驗收補充

前述「尚未正式驗收」為本文件撰寫當時狀態。後續 Opus 已回報自動通知與手動取得結果不重複通知正式通過；Astra 又在既有正式 47831 後端完成停止、切換工作區、長輸出衝突另存與額度顯示的代表性實測。完整結果與限制見 D:\K-harness\docs\formal-acceptance-20260924.md，證據見 D:\K-harness\.runtime\formal-acceptance-20260924\evidence.json。沒有以此宣稱所有失敗情境均已正式測試。
