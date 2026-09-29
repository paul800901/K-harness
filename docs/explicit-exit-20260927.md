# 2026-09-27 明確退出不再被工作狀態阻擋

## 原因與修改
K 自行加了兩層阻擋，不是 Electron 或 Pi 必要條件：設定頁 confirm，以及 isolated-launcher 依忙碌／核准／佇列／工人狀態拒絕 close。這次不推定是哪一筆殘留狀態造成舊正式版拒絕。
- frontend/main.jsx：移除停止後端的重複確認。
- src/isolated-launcher.mjs：使用者明確 close 直接交給既有 app.close 收尾，不再要求工作先變 idle。真正清理失敗仍回報失敗並可重試，不宣稱已退出。
- test/isolated-launcher.test.mjs：涵蓋忙碌、隱藏對話、待核准、佇列及工人；保留真正清理失敗重試。
Pi 參考：https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts 。/quit 直接 shutdown；不能推論所有產品所有退出入口都完全相同。

## 驗證與正式套用
- isolated-launcher + conversation-controller：28/28 通過。
- UI 建置成功；與舊正式 JS 比較，唯一差異為移除 confirm 外層。
- 使用者本輪明確允許後，只強制結束核對過的 K tray、supervisor、Electron 共 6 個程序，未關閉 Chrome。
- 已備份並正式套用 browser-live-session.mjs、browser-mcp-stdio.mjs、isolated-launcher.mjs、新 UI JS 與 index.html；未刪除舊資產或對話。
- 備份：D:\K-harness\.runtime\browser-reload-closeout\backup-exit-20260927-165431
- 雜湊收據：D:\K-harness\.runtime\browser-reload-closeout\deployment-exit-receipt.json
- 用正式 runtime 真實啟動 supervisor 後經同一 stdio close 入口驗證：READY、CLOSED confirmed=true、EXIT 0。未強制停止這輪驗證程序。
- 再透過正式 tray exe 啟動，16:55:22 ready；/health 讀回 deployment=isolated 與原 private-state。
- browser 三項修正沿用先前 54/54 及假頁實測證據；本次正式檔案雜湊相符，不冒稱新 Opus 複驗完成。
- 限制：本次真實退出驗證為啟動後退出；執行中與待核准情境由 28 項測試覆蓋，沒有啟動真實模型工作來取消。
- 另觀察：用舊 Windows PowerShell 直接讀取無 BOM 的 Start-K-Desktop.ps1 出現編碼解析錯誤；本次以其原本呼叫的正式 tray exe 啟動成功，未順手修改啟動腳本。

## 17:15 正式 K 內 Opus 5.5 複驗（同對話 `2f6afd1c`）
- **靜態讀回通過**：重新計算正式 `trusted-runtime` 中 5 個檔案的 SHA-256，與 `deployment-exit-receipt.json` 一致。正式 `isolated-launcher.mjs` 已沒有 `active-work` 拒絕分支；正式介面 JS 的「停止後端」按鈕直接呼叫 `shutdown`，外層沒有確認框（整份 JS 另有 2 處 `confirm(` 用在別處，本輪沒有逐一追查）。
- **實際退出：未驗證**。K 內 Opus 在沙箱內只能用瀏覽器與 Luna 工具，拿不到工作列「離開並停止 K」、設定頁「停止後端」或 supervisor stdio 的操作入口。本輪也沒有嘗試繞過 47831 的授權或結束程序。退出後本對話會中斷，無法由同一回合寫回結果。
- 同一輪瀏覽器複驗先完成並已寫入 `browser-data-background-20260927.md`，所以退出不會影響那些結果。
- 待本人操作：在 K 閒置時按工作列「離開並停止 K」（或設定頁「停止後端」），確認沒有出現「仍有工作或待核准事項」或「停止未確認」的提示、K 視窗與背景都結束，再用原入口重開。如要驗證這次修正的重點「工作中也能退出」，請在某個對話正在執行時按同一入口；該回合會中斷，屬於預期情形。重開後開新對話，讓 Opus 讀取托盤／supervisor 的紀錄與 `/health`，把結果補寫在本段之後。托盤程式仍保留舊的 `active-work` 提示文字，但新版 launcher 不會再送出這個拒絕。

### 17:45 工作中退出實測與補修（待正式套用）
- 透過真實 K 視窗送出一次無副作用 60 秒等待；確認 UI 已顯示「停止工作」且模型／權限選單 disabled。隨即設定→停止後端，沒有第二確認框，47831 不再監聽。
- 發現實際缺口：後端停止但原 Electron shell 與 supervisor 留著，不能把後端停掉稱為整個 K 已退出。
- src/desktop-server.mjs 增加 server close 通知；src/electron-isolated-main.cjs 收到後通知其私有 supervisor；src/electron-isolated-launcher.mjs 沿原 protocol.close 完成 owner cleanup 及 Electron 正常退出。沒有新增外部停止入口或繞過授權。
- 真實 Electron + 假 busy controller 的整合試驗另發現殘留 HTTP 連線會阻止 close 回呼；現在僅在工作資源收尾完成後關閉該 server 自有 HTTP 連線。不是殺程序、不是略過持久化。
- 假 busy 實際 Electron 整合結果 ready → closed true → EXIT 0，腳本 .runtime/browser-reload-closeout/verify-settings-exit.mjs。第一次逾時未當作成功；修正後正常退出。
- 84/84 回歸通過。正式待套用，使用者已收到請從系統匣結束舊殼的訊息；本輪不再次強殺正式 K。

### 後續更正：正式等待工具未開始
Opus 回報 60 秒 Start-Sleep 被執行環境拒絕，沒有另用其他方法或重試。因此上段 UI 出現「停止工作」只能證明當時回合尚在處理，不能證明有正在執行的 60 秒工具。撤回將該次正式 UI 操作當作「工具執行中退出」驗收的推論；正式執行中工具退出仍未驗證。真實 Electron 加假 busy controller 的測試結果仍有效，但屬測試，不等於正式模型工具實測。不要為湊等待而绕過既有執行限制；先正常結束目前閒置 K，套用剩餘修正，再另做有明確授權的瀏覽器等待／取消測試。

## 本輪正式套用與退出競態追查（2026-09-27）
- 17:46:53 備份後正式套用 browser-mcp-stdio.mjs、desktop-server.mjs、electron-isolated-main.cjs、electron-isolated-launcher.mjs；收據 `.runtime/browser-reload-closeout/deployment-remainder-receipt.json`，備份 `backup-remainder-20260927-174653`。重啟 health 確認 isolated。
- 前兩次 browser_wait_for(60) 都已結束才操作退出，不算執行中退出驗收。第三次獨立 browser_wait_for(120) 的原生 tool_use 紀錄為 2026-09-27T09:51:39.876Z；立即按正式設定頁停止後端，實際失敗：K 尚未完全關閉：對話控制器。不得把此輪標示完成。
- 可重現的直接競態：stopBox 主動停止橋接程序時，socket close 先於停止確認抵達，被當成 ERR_SANDBOXIE_PIPE_DISCONNECTED，污染 Claude host 的 processError，導致 close 拒絕。
- 新增 test/sandboxie-process.test.mjs 回歸：修正前確實失敗；src/sandboxie-process.mjs 現在只在未進行終止時將 socket error/close 視為非預期。stopBox 真正失敗仍照原路徑拒絕，不略過停止確認。
- sandboxie-process、claude-host、sandboxie-pool、sandboxie-control 合計 34/34 通過，證據 `.runtime/browser-reload-closeout/stop-pipe-regression.txt`。
- 此 socket 修正尚未正式套用：舊正式 PID 50936 仍監聽 47831，需先正常退出或取得本次限定結束程序授權。正式執行中退出仍待重新驗證。

## 18:01 本次明確授權後正式套用
- 使用者明確允許「結束這次 K」。結束前核對 PID 50936 的正式 Electron 路徑、父 PID 26316 的 isolated launcher 命令，再僅結束此 owner、三個直屬 Electron 子程序及 supervisor。未結束任何 Chrome；未刪對話或設定。
- 僅新增部署 src/sandboxie-process.mjs；備份 `.runtime/browser-reload-closeout/backup-stop-pipe-20260927-180123`，收據 `deployment-stop-pipe-receipt.json`，來源與正式 SHA-256 相符。
- 新增反向測試：預期斷線不能遮蔽真正 stopBox 未確認。35/35 通過，包含已重現的斷線競態修正前失敗／修正後成功。
- 正式 runtime 啟動後由既有 supervisor close 入口正常退出：READY → CLOSED confirmed=true → EXIT 0。
- 正式 desktop-server / Electron owner / launcher 模組另用獨立假 busy controller 實際走設定頁相同 shutdown HTTP 路徑：ready → closed true → EXIT 0；驗證後 47831 已無監聽。證據 `.runtime/browser-reload-closeout/formal-settings-exit-result.txt`；fixture `verify-formal-settings-exit.mjs`。這是正式程式的假工作整合測試，不冒稱新 Opus 忙碌回合驗收。
- 以原 tray 啟動器重開正式 K，health 讀回 isolated。此次沒有再呼叫 Opus 或其他模型，沒有再啟動耗額度的等待回合。
- 限制：最後修正後未再做真實 Opus 執行中退出，避免重複消耗使用者額度；以重現競態、35 項回歸、正式啟停與假工作整合測試驗證。
