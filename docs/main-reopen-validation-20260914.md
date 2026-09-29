# 主控重開與殘留成果查詢

2026-09-14，本輪完成本機實作與跨程序離線驗證；未新增付費模型呼叫。

## 使用方式

在 `D:\K-harness` 執行 `./Start-K.ps1 -List`，列出 K 已保存的對話 ID、模型與最近保存時間。此入口不啟動 Codex 或模型。

用 `./Start-K.ps1 -Model gpt-6-astra -ResumeThreadId <清單中的ID>` 重開 Astra；Sol 使用 `gpt-5.6-sol`。恢復入口沿用原有官方主控；清單是本機指標，不保證伺服端對話仍可恢復。

現在取得對話 ID 後即保存並同步至磁碟，不再等候工人連線就緒才保存。未取得 ID 前中斷仍可能沒有本機指標。每次保存新增紀錄，清單依 ID 去重；破損紀錄只計數，不刪除或重建。

重開或 `/workers` 除了查本對話原派工，會檢查其指定輸出：`present` 檔案存在、`missing` 不存在、`unavailable` 路徑不合規或無法確認。不讀檔案內容，不代表正確或已驗收。

## 驗證

- 完整回歸 59／59 通過，0 失敗；主控入口語法檢查通過。
- 實際 `Start-K.ps1 -List` 找回既有 Astra 對話 `01a09f15-cdf1-7822-939c-f3c51c632a4b`。
- 對話保存／重新讀取、同 ID 去重、跨工作區紀錄拒絕、破損紀錄保留通過。
- 實際 MCP 子程序使用 Pi 腳本式模型，寫完 `output.txt` 後直接 `process.exit(23)`；不是正常取消或清理關閉。
- 全新 MCP 程序以同工作區與狀態目錄查詢 `crash-once`，回傳 `unresolved`、成果存在、`acceptance=not-reviewed`。只呼叫 inspect，沒有 start、cancel 或 wait。
- 讀回 `output.txt` 原文 `preserve crash output` 未變。最近完整回歸案例保留於 `.runtime/tests/main-crash-Yvv3nD`。

## 邊界

這是實際工人程序中斷與新主控查詢邏輯的離線整合證據，不是整個 K 終端、官方主控與真實 Astra／Flash 同時崩潰的驗證，也不是斷電耐久性或自動續跑。主對話仍由官方 Codex 執行核心保存；目前不宣稱完全取代 Codex App 或所有長程任務穩定。
