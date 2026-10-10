# Codex 原生串流失敗：診斷與候選呈現修正（2026-10-10）

## 本人要求與範圍

本人提供手機「我殺了學院玩家」截圖，要求找出問題、與真正 Opus 5.5 討論、修正並由 Opus 檢查程式碼及防禦性／過度工程化，完成後停止，等本人回來與前批一起更新。

本輪只修候選錯誤呈現，沒有停止／部署／重啟正式 K、push、恢复目標、重送小說、換模型或修改工作成果。前批 API／Exa、子代理快覽等候選保留。

## 原生證據與根因界線

- 以唯讀 SQLite／JSONL 查該聊天室的既有原生紀錄，最新回合於 **2026-10-10 臺灣 07:04:57** 結束，status 為 **failed**，模型 GPT-6.1 Sol。
- 原生錯誤是 `stream disconnected before completion: An error occurred while processing your request...`，`codexErrorInfo='other'`、`additionalDetails=null`。完整錯誤含 request ID，與截圖一致。
- 同一 request ID 的原生日誌記錄 `/responses` **HTTP 200 OK**，隨後記錄串流回合錯誤。這不是手機介面自行推測的失敗，也不能從這個錯誤推論為 429／500、容量不足或額度不足。OpenAI 更內部原因沒有回傳，仍未知；不能宣稱本輪修好 OpenAI 服務。
- 該失敗回合的原生歷史仍有 **6 筆 completed commandExecution** 與 **2 筆 completed collabAgentToolCall**，因此「回合失敗」不等於「之前沒有執行任何工作」。本輪只核對事件種類與狀態，不驗收小說內容，也不重做成果。
- K 已保留原生 failed／受阻及部分回覆；缺口在 `frontend/native-notices.mjs` 原本只辨識容量／用量限制，串流錯誤直接回傳整段英文。

官方協定：[Codex App Server — Errors](https://learn.chatgpt.com/docs/app-server#errors) 說明原生 failed 與原始 error；本次實際 error 形狀以現場紀錄為準。沒有 HTTP 錯誤碼或 Retry-After 就不編造。HTTP 200 來自原生日誌，不擅自填入原生 error 物件。

## 最小完整修正

產品只在 `frontend/native-notices.mjs` 增加 **5 行**：

1. 原生結構化 `responseStreamDisconnected` 辨識為串流中斷。
2. 本次實際 generic `other` 或舊紀錄無 code 時，僅辨識**開頭** `stream disconnected before completion:`。具體容量／用量／登入等碼不被文字覆蓋，其他未知錯誤與非 Codex 供應商維持原文。
3. 顯示「**Codex 回覆在完成前中斷；本輪未完成。接續前先核對已保存成果，K 不會自動重送。**」

既有 raw error／request ID 折疊詳情保留、不變造事件或新增狀態。原生 `willRetry` 仍先顯示重連／等待網路／重試提示，不誤說已終止。沒有新增重試按鈕、模型備援、快取、解析 request ID 的狀態或恢復機制。

修改檔案：
- `frontend/native-notices.mjs`
- `test/native-notices.test.mjs`、`test/codex-capacity-fallback.test.mjs`
- `test/stream-error-ui-probe.mjs`
- 本紀錄與 `docs/development-log.md`。

## 驗證與真正 Opus

私有證據目錄：`D:\K-harness\.runtime\stream-error-fix-20261010`，含實際原生證據、討論／審核封包及完整結果；不提交登入資料或原始小說內容。

- 真正 Opus 5.5 事前討論：官方 Claude.ai Pro／CLI 2.1.294，實際 `claude-opus-5-5`，session `fee46283-a81b-435f-abce-adc4d9e70cb9`，code 0／success／is_error false，6 次唯讀工具。支持只修顯示；要求允許實際 other、結構化码優先、查所有呼叫者與實測詳情，不加重播／換模／備援。
- 所有 `codexErrorKind` 產品呼叫已查：只有 `localizeNativeNotice` 使用，新增 stream 不觸發選模型或執行路由。
- 定向 **29/29**：實際 error 形狀、raw 不變、結構化碼與文字優先、未知／非 Codex 不誤判、willRetry、partial 工具成果、failed／受阻、沒有 K 重送／換模／自動復活目標。
- UI build 成功；原有 bundle 大小警告仍保留，本輪不做無關拆包。
- 建置後假資料 UI **桌面 1440×900／手機遠端 393×852** 通過：單則中文錯誤、原始詳情与 request ID、保留 partial 訊息與未完成／受阻、手機仍已連線且沒有誤導重新登入／重連、原生重試文案不同、無水平溢出／POST。截圖及 result 在工作樹 `.runtime/stream-error-ui-probe`。
- 第一次 UI probe 失敗：誤要求 busy=false／無子代理時的手機底部存在「工作失敗」。既有手機設計隱藏此狀態，故只修 probe 的手機預期（改驗未完成文案／受阻目標），不修改無關產品。原失敗 `ui-probe.log` 保留，成功在 `ui-probe-second.log`。

- 真正 Opus 5.5 最終程式碼複查：官方 Claude.ai Pro／CLI 2.1.294，實際 `claude-opus-5-5`，session `0619ff9a-8fe5-4bf3-b803-fdd68d33a970`，code 0／success／is_error false，12 次唯讀工具；讀實際 diff、localizer、controller、main／native UI 呼叫。**無 blocker，沒有過度工程化，現有防護足夠，不加備援或額外狀態。**全套結果尚待主代理讀回，沒有把代理結論當測試完成。
- Opus 記錄兩項既有鄰近限制，本輪不擴張：活動保存／worker 查詢又失敗時，既有 controller 可能以另一錯誤覆蓋主提示，stream raw仍在turnError但主詳情因不相同而隱藏；wrapper 若有未觀察到的前置空白則維持英文。兩者不是此次截圖的已證實原因，未新增防禦來處理。

- 完整序列測試 **1107/1107**，fail／cancelled／skipped 均 0，`serial-tests.log`，161.48 秒。主代理已獨立讀回退出碼 0、全套結果、actual diff 與手機建置截圖；不是由 Opus 代替測試驗收。
- 本輪完成的是**已實作且本地／建置後假資料驗證的候選**。正式服務故障未被宣稱修復，也沒有真實模型回合重試驗證（避免重播工作）。

## 候選停等

本輪是候選呈現修復，不是服務故障修復或正式更新。正式程式指標讀回仍 `1a45a73440a5f948c5cec625de02340863b7c67d`，K 未被本輪停止／重啟。等本人回來允許，核對工作停止並與前批一併升級；程序還原只涵蓋程式，不還原／重播對話資料。
