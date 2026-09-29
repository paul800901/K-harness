# 2026-09-27 K 停止卡住修復

## 現象與證據界線

使用者已無工作卻無法從系統匣停止 K。03:17 啟動器多次記錄 active-work 拒絕；正式 Electron 36668、supervisor 35012、tray 6692 仍在。六份持久輸入佇列為空，但不等於完整即時狀態；未取得舊程序的授權 owner snapshot，因此不能認定這次現場必定是哪個欄位阻擋。

程式確認存在死結路徑：`runIsolatedLauncherProtocol` 將單獨 `status: uncertain` 當成工作中，即使 `busy=false`、沒有問題、佇列或未結束 worker，也不進入既有 `app.close()`。不確定的收尾狀態因而無法重試正常收束。

## 最小變更

- `src/isolated-launcher.mjs`：移除 uncertain 單獨阻擋；保留 busy、問題、佇列、working/connecting 及未結束 worker 的阻擋。正常 close 仍須 await，失敗仍 confirmed:false，不假裝停止。
- `test/isolated-launcher.test.mjs`：新增主／隱藏房間 uncertain 可正常收尾、失敗可重試、佇列與 worker 各自仍阻擋。
- 未新增背景服務、自動啟動或永久強制結束機制。

## 驗證與正式操作

- 停止、isolated desktop、conversation controller/native regression：40/40 通過。
- 使用者明確允許本次只強制結束 K 自有程序。核對完整路徑、建立時間、父程序後結束舊 tray 6692 與 supervisor 35012；Electron 36668 因 IPC 斷線走既有清理自行結束，8 個 K box 均為空。
- 卡住的 K 專用 Chrome 32172 與其本次子程序依精確 profile／程序身分結束；日常 Chrome 14524 的建立時間與 PID 讀回不變。不刪除對話、設定或登入資料。
- 03:30 備份後僅更新正式 `trusted-runtime/src/isolated-launcher.mjs`，檔案 hash 相符。備份及收據：`.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/vault/shutdown-repair-backup-20260927-033025`、`.runtime/k-browser-assistant-20260927/shutdown-deployment.json`。
- 以正式 supervisor／正式 runtime 真正啟動 K，再送正常 close：ready → isolated health → closed confirmed:true → exit 0；47831 關閉且 8 box 全空。結果：`.runtime/k-browser-assistant-20260927/formal-shutdown-result.json`。此驗證不是注入 uncertain 到使用者對話；uncertain 路徑由定向回歸覆盖。

## 剩餘範圍

Chrome 白窗／連線逾時另行調查，見 `k-browser-assistant-20260927.md`；停止修復不代表瀏覽器或 Opus 正式回合已通過。舊現場阻擋欄位仍未知，不以已修程式路徑反推現場真值。
