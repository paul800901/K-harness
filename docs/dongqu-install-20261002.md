# 東區 Windows 10 安裝與內建聽寫（2026-10-02）

## 目標與本機來源

使用者要求在 `C:\K-harness` 安裝東區所需依賴、官方最新 Claude Code 核心，並指定聽寫只能使用 Windows 內建方案。來源為 `k-r3-git-20261001c`（`50ee11e`）；本機新增 Windows 聽寫接線，不改模型、權限、訂閱計費或其他工作環境。此次修改未 push。

- 本機為 Windows 10 22H2、Intel UHD Graphics 730；Node 24.14.1、npm 11.11.0、Git 2.53.0、Chrome、.NET Framework C# 編譯器已存在。
- 官方 Claude Code latest 當次讀回為 **2.1.287**，由官方下載端取得，SHA-256 與 Anthropic Authenticode 有效簽章驗證成功；標準本機 CLI 安裝於 `%USERPROFILE%\.local\bin\claude.exe`。K 另保存專用核心，兩家登入均由本人重新操作，不搬既有憑證。
- Codex 使用本機官方 App 所附原生 **0.159.0-alpha.12.1**，連同其 exe 輔助程式交給 K 安裝器複製。
- Windows 已安裝 `MS-1028-80-DESK`／`zh-TW` 語音辨識引擎，不下載模型或語音套件。

## 最小修改

`Setup-K.ps1`、`scripts/manage-install.mjs` 增加本機 `dictationProvider` 選擇；啟動器依設定傳給本機辨識程序。`src/local-dictation.mjs` 在 windows 模式呼叫 `scripts/windows-dictation.ps1`，以 Windows PowerShell 5／System.Speech 的 DictationGrammar 處理記憶體 WAV。保留既有收音、波形、五分鐘上限、停止填字、取消、切換對話／隱藏視窗取消及本人送出流程；不另開 Win+H、切換系統語言或使用外部語音 API。未指定時仍沿用 Whisper。

## 驗證與失敗紀錄

- 首次原版完整建置測試為 **511/512**：安裝器測試要求標準位置可解析 Claude CLI，當時僅下載了 K 的 bootstrap exe。失敗候選及 `setup-20261002.log` 保留，未套用程式。完成官方 CLI 安裝後再驗證。
- 第一次同步 Recognize 在 WAV 結束後再次呼叫會報沒有音訊輸入；已改用原生 Multiple 與完成事件，不以忽略錯誤處理。
- 語音／CLI／安裝器定向測試 **41/41** 通過。Windows zh-TW 合成語音經真正 System.Speech 引擎辨識，讀回「今天在東區完成工作」。此為合成音訊驗證，不是真麥克風或辨識品質驗收。
- 完整建置、安裝啟用、Chrome 助手、啟動與訂閱狀態於完成後追加。實體麥克風、本人登入及真正模型工作仍須分別讀回；不得以套件或建置成功宣稱完成。

本機診斷位於 `.runtime/bootstrap`，不進 Git；正式個人登入／對話依既有 `agent-home`／`vault` 分區保存。
