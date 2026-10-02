# 東區工作列品牌修正（2026-10-03）

使用者回報桌面捷徑圖示正確，但執行中的工作列圖示及右鍵選單顯示 Electron。

## 根因及修改

- `src/electron-workbench.mjs` 原本只設定視窗標題及 ICO，沒有 Windows AppUserModelID 或工作列重新開啟資訊。補上應用程式名稱「K 執行中樞」、`K.Harness.Desktop`、既有 K ICO，以及同名的重新開啟資訊。
- `src/electron-isolated-main.cjs` 將 C 根目錄穩定啟動器路徑交給視窗；從工作列重新開啟時執行 `C:\K-harness\local-launcher\dist\K桌面啟動器.exe`。不得直接開啟缺少 supervisor 連線的 Electron 執行檔，也不修改桌面捷徑。
- `test/electron-workbench-icon.test.mjs` 除原 ICO 驗證外，在 Windows 檢查程式識別及重新開啟資訊。

## 驗證及套用

- 定向 11/11、完整候選建置 514/514 通過，無失敗或跳過；紀錄 `.runtime/bootstrap/taskbar-update-20261003.log`。
- 真正 Electron fixture 及正式視窗均透過 Windows `SHGetPropertyStoreForWindow` 唯讀讀回：AppID 為 `K.Harness.Desktop`，DisplayName 為「K 執行中樞」，IconResource 為 runtime 的既有 K ICO，RelaunchCommand 為 C 根目錄穩定啟動器。正式 ICO 與桌面捷徑來源檔逐位元一致。
- 已正式套用版本 `64cc530d73fd6245f22038942ff5e5ea7fa92808` 並從原入口重開。原生 health、五個相關程式來源及三個實際 HTTP UI 資產讀回一致；`.local/runtime.json` 保留 `dictationProvider: windows`。上一版程式保留於 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1790960340904`，不稱為對話資料備份。
- 本輪與設定內 Codex／Claude 登入修正一起套用；使用者最新回報後已確認正式埠及啟動器均停止。
- 已唯讀確認 Windows 先前釘選的 `Electron.lnk` 仍直接指向 runtime 的 `electron.exe`，Arguments 為空、Icon 為 `,0`；該項無法正確重新啟動 K。新版視窗資訊已修正；使用者需取消釘選舊 Electron，再釘选新版 K。不刪除工作列釘選、全域圖示快取或 Windows 設定，桌面原 K HARNESS 捷徑維持正確啟動器。
- 正式 K 控制項文字已讀回；原生畫面擷取再次回報 `FrameArrived timed out`，設定點擊回報 `coordinate input geometry is unavailable`。未取得工作列視覺截圖或正式設定操作驗收，不以 metadata 讀回宣稱畫面截圖驗收。

本輪未 push。本人帳號登入驗收另記於訂閱修正文件，不以品牌修正宣稱已登入。
