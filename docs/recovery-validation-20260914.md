# 多步工作中斷接續驗收

結論：**真實程序中斷後，經主代理核對成果，再由新 DeepSeek 工人接續剩餘工作，本次通過。** 並未實作自動恢復原 provider session，也未驗證長上下文壓縮。

## 新增工程

`src/recovery.mjs` 的 `inspectRecovery(directory)` 及 CLI `recover <job-directory>` 提供唯讀接手資訊：原任務／限制、工作區、模型、最後回答、各授權檔案的目前存在狀態，以及對話是否保存成功寫入結果。不讀取檔案內容、不呼叫模型、不改舊任務、不判定成果已驗收，也不推定舊程序已死亡。

回報區分 present、missing、unavailable。有檔案不代表完整；沒有成功工具紀錄也不代表沒寫檔。主代理必須確認舊程序停止、讀回並驗收成果，才能明確授權新編號只做剩餘工作。既有成果改以唯讀輸入交接；程式或部分寫入等不確定情況仍須人工裁決，不能盲目重跑。

本輪新增 3 項離線測試，完整 `npm test` 44／44 通過。測試涵蓋存在但未記錄成功的成果、記錄成功但目前檔案缺失、越界與不可讀狀態、檢查不修改舊紀錄。

## Live 案例

案例位置：`.runtime/recovery-tests/case-6basi0`。只有 6 列人工工作清單，不含正式營運或臨床資料。完整工作是先整理 checkpoint，再產生 final.json 與 brief.md。

1. 第一個真實 DeepSeek 工人讀 input.json，寫出 checkpoint 後，由測試程式立即退出，沒有執行正常終態保存。這是實際程序結束，不是把狀態假寫成中斷。
2. `recover` 讀到舊任務 unresolved：checkpoint 已存在，但成功寫入的工具结果還未持久化；final.json 與 brief.md 均不存在。
3. 主代理確認執行程序已結束，獨立核對 checkpoint：保留兩列同為 Z1 的資料，總數 38 分鐘、完成 26、待辦 ID 為 P3/P5、未知 owner ID 為 Z1/P3/D6。沒有因對話缺少成功結果而重寫 checkpoint。
4. 在接續前新增主代理確認的最新需求：標題從「原始工作清單」改為「待辦接續驗收」。原資料与未知身分規則不變。
5. 啟動新程序／新工人。它取得由舊 job 找回的原任務、已驗收 checkpoint 和新標題要求；可建立的檔案只剩 final.json 與 brief.md，不能重寫 checkpoint。
6. 新工人 3 次模型請求、5 次工具呼叫、0 工具錯誤，約 7.16 秒完成續作；這不包含第一段工作、主代理判斷、兩段間的等待與驗收，不能當作整體效能比較。
7. 主代理再獨立驗收：JSON 各欄位精確一致，完成 4 列／待辦 2 列，總 38／完成 26／待辦 12 分鐘；重複列、原始順序、嚴格 null 身分、最新標題正確；checkpoint 字串與先前驗收版本相同，工人只寫剩餘兩檔。

舊 job 仍保留 unresolved，沒有倒填 completed。新 job 是獨立受限交接；主代理的驗收見 [acceptance.json](../.runtime/recovery-tests/case-6basi0/acceptance.json)。最終 [JSON](../.runtime/recovery-tests/case-6basi0/final.json) 與[說明文件](../.runtime/recovery-tests/case-6basi0/brief.md) 已讀回。所有 .runtime 證據均由 Git 排除。

## 仍未證明

- 模型自行從任意部分寫入、程式崩潰或外部操作結果不明的狀態安全恢復。
- 數小時任務、上下文壓縮／淘汰後的正確記憶與檢索。
- 不依賴主代理核對的全自動接續，或相同 provider session 的恢復。
- 所有通用任務都穩定、全面比 Luna 更快／更省。

本輪沒有更動模型、依賴、App／全域設定、其他專案或任何正式資料。下一階段應以有實際上下文遺失的案例驗證需求檢索，而不是把這個短案例放大成長程記憶保證。
