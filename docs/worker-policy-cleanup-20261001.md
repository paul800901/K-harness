# 子代理政策精簡與延遲包裝接線（2026-10-01）

## 範圍
使用者要求現在精簡並更新 K，不等待下一批。不改自動選擇／手動預設、舊對話、權限、訂閱或失敗不重送語意。

## 修改
- workerPolicyConfig 共用 validateWorkerPolicy，不重寫模型／auto 配對規則。
- 派工前先解析預設，僅一次檢查尚未具體選擇的 auto；移除後續重複模型名單檢查。
- 移除 gateway 的假 Luna/high、空政策與清單備援。
- 實際完整測試發現：Claude controller 的 lazyBridge 原本沒有傳 workerPolicy／workerOptions，所以舊 gateway 的備援並非永遠不觸發。補傳現有 workerPolicy；拿掉原本到不了此路徑的 workerOptions 展示接線。不為取得清單提早啟動 Codex；原生模型／effort 驗證仍在 bridge。
- 產品四檔，淨減 4 行；沒有新服務、路由器、重試或設定。

## 驗證
首次完整測試 500/502，兩個真 controller → gateway 接線測試暴露上述遺漏，未掩蓋。補接後再跑全部測試；隔離桌面測試直接讀 MCP tools/list，確認自動政策確實到工具說明，沒有 Luna/high 備援。
最終完整測試 **502/502** 通過。正式部署前確認 K 無 listener、自有程序已離開。**03:01 已更新四個後端檔並從原入口重開**，四檔雜湊一致，native health 正常；正式模組讀回 auto/auto，Codex agents 僅 enabled，無固定模型。未呼叫真模型，不消耗模型回合。

## 還原與證據
- 來源提交：`a117eca`。
- 備份：`D:\K-harness\.runtime\releases\worker-policy-cleanup-before-20261001-030134`；正常停 K 後將四個原檔複製回對應位置即可還原。
- 收據／首輪失敗及最終通過輸出：`D:\K-harness\.runtime\worker-policy-cleanup-release-20261001`。前端、對話、登入資料皆未改動。
