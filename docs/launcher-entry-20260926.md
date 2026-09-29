# 系統匣啟動器相容入口（2026-09-26）

## 變更

- 將根目錄 `Start-K-Desktop.ps1` 收窄為相容入口，只啟動 `local-launcher/dist/K桌面啟動器.exe`。
- 若啟動器不存在，提示後停止；沒有一般 host server、HTTP bootstrap 或其他啟動 fallback。
- `-NoBrowser` 不再繞過系統匣 launcher 啟動舊後端，改為明確錯誤提示。
- 舊版入口原文保留於 `.runtime/closeout-20260926/backup/legacy-Start-K-Desktop-20260926.ps1`，SHA-256 `D30EF303FC5768CA5497B6CAE80F00816211BD7314780A154C67B87F5DFC43E9`。
- 更新 `README.md` 與 `local-launcher/README.txt`，說明相容入口、缺失時 fail-closed、`-NoBrowser` 舊行為，以及只可由目前啟動器控制其候選服務。

## 驗證與邊界

- 新增 `test/desktop-launch-entry.test.mjs`，來源檢查確認目前入口只呼叫系統匣 EXE、缺少 EXE 會先拒絕；測試不依賴 `.runtime` 備份檔，以便乾淨 checkout 執行。
- 針對測試：`node --test test/desktop-launch-entry.test.mjs`，2/2 通過。
- 未啟動任何程序、未編譯或部署 EXE、未呼叫後端／模型；因此不代表系統匣啟動或 UI 的 live 驗收完成。
- `-NoBrowser` 呼叫者須改用安全系統匣啟動器；本相容腳本不提供無瀏覽器啟後端模式。
