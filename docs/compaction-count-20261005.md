# 聊天室原生壓縮次數（2026-10-05）

## 需求與根因

本人要求目前聊天室上方顯示已壓縮次數，切換、重開保留；只計原生確認完成，不重複，不把未知當零，並與真正 Opus 5.5 商量。

- Codex 原接頭只在已棄用的 `thread/compacted` 增加 RAM 計數；本機正式核心實測只送 `contextCompaction` 的 started/completed，所以完成後仍是 0。原生 `thread/read includeTurns` 會保留完成的 item，K 原先沒讀。
- Claude 只把手動 `/compact` 後的成功 result 當作一次，沒有讀 `system/compact_boundary`；自動壓縮未計入，跨聊天室未重設，重開未保存。
- Gemini 目前接法無權威壓縮計數事件，不應初始化為 0。舊 ProgressPanel 未在日常 UI 顯示。

## 最小修正

- `src/desktop-controller.mjs`：從原生歷史重建 ID 集合，主聊天室 `item/completed contextCompaction` union；started、子代理、deprecated echo 不加次數。不新增 K 計數檔；缺少完整 history 結構或斷線標未知，重開再依原生資料讀回。
- `src/claude-controller.mjs`：依目前 native session 的 `compact_boundary.uuid` 去重，立即存入既有 Claude UI projection 的可選 `compactions` 欄位；結果成功不再推估。新聊天室確認從 0 開始；舊紀錄缺欄位、未完成回合斷線／重開保留未知，已觀測 ID 仍保留；最新結論分支繼承來源紀錄。原生歷史不更動。
- `src/gemini-controller.mjs`：未回報即未知。
- `frontend/compaction-status.mjs`、`frontend/main.jsx`：只在目前聊天室標題列顯示「已壓縮 N 次」；不完整則「壓縮次數未知」或「壓縮次數未知（已記錄 N 次）」。不新增面板、橫幅、按鈕或自訂壓縮引擎。
- tests：三家控制器、標籤單元測試與 `test/compaction-ui-probe.mjs`。

新增欄位為既有本機投影的向後相容擴充，不遷移、不重写原生歷史、不搬憑證；不改原生模型、權限、訂閱或帳號。

## Opus 討論與實測

真正 `claude-opus-5-5` 使用 K 既有 Claude 訂閱，plan／Read,Glob,Grep／無 MCP，設計討論 session `5e56afe4-dcee-40c1-a6cb-3457fa08e1da`。採納先查 Codex 原生歷史而不是另存計數、Claude UUID union 並立即保存、缺失紀錄未知、子代理排除。最終程式首查 session `36d42347-7272-4240-bd34-33f5ad3f896c` 找到 Claude 開啟失敗後關閉可能把上一房間投影寫進目標的阻擋，已先驗證 workspace 再同步切换整份狀態，補失敗／關閉後目標紀錄不變測試；同時採納 close 只在 wasBusy 時寫入、原生自主回合先記 inFlight、Codex Set 重設移至同步段。補查 `36155807-066e-47bc-b84b-036b03137564` 指出送出／手動壓縮的標記寫入需進既有保存佇列，已修兩處並用延遲旧快照的測試驗證先後順序。最後限縮複查 `c460f992-1c30-4163-aa46-b961e434a89d` 確認剩餘阻擋解除、未見直接引入新阻擋。四次均核對真實 assistant model 為 `claude-opus-5-5`，不是用其他模型代審；Opus 僅閱碼，測試由主代理執行並讀回。

證據留於開發工作樹 `.runtime/compaction-20261005`，不提交帳號或原生 transcript：

- 修正前：新假聊天室 Codex live completed 的 ID 與兩次 history、關閉重開後 history 相同，但 K counter 仍 0；Claude 實測收到 `compact_boundary` 與 UUID。
- 修正後：Codex `01a10a47-bbe3-7be0-a594-99481b0eeca1`，Claude `claude-fbc2bd04-5f26-4a62-beba-ed3419e9cef2`；各一則極短假資料＋一次原生手動壓縮，均 0 → 1，關閉後用全新 controller／原生 host 重開仍 1，complete=true。未讀真實工作內容，未派工或要求工具寫入。
- UI：1920×1080／100%／暖色、1100×760／125%／亮色、900×700／150%／暗色。已知 0／3、舊未知／部分 12、切房／重載／無聊天室不顯示，標題列不裁切，無 POST；已目視截圖。
- 初次 discovery 測試腳本誤把同步 Codex hostFactory 寫成 async，建立聊天室前失敗；修正腳本後重驗。只停止該失敗 probe 自有、未送工作之 Codex 子程序，不中斷正式 K。第一次更新舊單元測試因 CRLF 文字替換未套用，仍期待 result 自增而失敗；已改為原生 boundary 後重跑。
- 初輪 targeted 90/90、完整 775/775；補齊 Gemini 未回報、生命週期／寫入競爭與 Opus 阻擋回歸後，最終完整 **781/781** 通過、`git diff --check` 通過。最終來源另以原測試聊天室再次開全新原生 host/controller 讀回，Codex／Claude 均仍 1、complete=true，沒有再送訊息。

## 邊界

- Codex 依目前已選核心的權威 history；未驗證只回舊通知的其他版本。
- Claude 自動壓縮以實際同型 boundary（trigger=auto）做回歸；沒有為驗證刻意灌滿真實上下文。真正實測是手動壓縮。
- Claude 舊紀錄不掃描原生私有 transcript 補數，顯示未知；同一原生 session 若在 K 外繼續使用，K 無法保證總數。回合途中崩潰由已存 inFlight 標成未知；不假定 resume 一定重播遺漏 boundary。
- 分支包含分支點前的原生壓縮；Claude 目前只允許最新結論分支。這是觀測資訊，不用次數推估品質或剩餘上下文。

- Opus 非阻擋提醒：Claude 既有送出／compact 在存檔 await 後尚未重新核對停止／host，另有 failed open 時 workerPolicy 暫時沿用目標值的既有問題；未為本次計數功能順手擴修。已選核心正常路徑與本次失敗／資料隔離路徑已驗證，不能據此宣稱所有停止競爭都已驗收。

## 正式狀態

已在開發版實作，真正 Opus 設計／首查／兩次補查、整套 781/781、真原生重開及三種 UI 驗證完成；準備固定本地 Git 版本。未部署、未 push、未改標記。正式 K 仍為 `4ead4bf24ed609a01b4d6acfb4f5bdf48d574248`；本輪收尾核對 127.0.0.1:47831 仍由正式 K PID 18548 監聽；未滿足「離開並停止 K」條件，不為此顯示功能打斷使用者工作。下一次本人停止後，依此批固定 SHA 準備乾淨候選、再測／保留退版、套用／正式讀回，再依 SOP 推私人 GitHub。東區不動。
