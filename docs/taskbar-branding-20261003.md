# 東區工作列品牌修正（2026-10-03）

使用者回報桌面捷徑圖示正確，但執行中的工作列圖示及右鍵選單顯示 Electron。

## 根因及修改

- `src/electron-workbench.mjs` 原本只設定視窗標題及 ICO，沒有 Windows AppUserModelID 或工作列重新開啟資訊。補上應用程式名稱「K 執行中樞」、`K.Harness.Desktop`、既有 K ICO，以及同名的重新開啟資訊。
- `src/electron-isolated-main.cjs` 將 C 根目錄穩定啟動器路徑交給視窗；從工作列重新開啟時執行 `C:\K-harness\local-launcher\dist\K桌面啟動器.exe`。不得直接開啟缺少 supervisor 連線的 Electron 執行檔，也不修改桌面捷徑。
- `test/electron-workbench-icon.test.mjs` 除原 ICO 驗證外，在 Windows 檢查程式識別及重新開啟資訊。

## 驗證及套用

- 定向 11/11 通過；尚待完整候選建置、原生 Windows 資訊及正式更新讀回。
- 本輪與設定內 Codex／Claude 登入修正一起套用；使用者最新回報後已確認正式埠及啟動器均停止。
- Windows 先前釘選的 Electron 項目可能仍保存舊捷徑；不刪除工作列釘選、全域圖示快取或 Windows 設定。

本輪未 push。本人帳號登入驗收另記於訂閱修正文件，不以品牌修正宣稱已登入。
