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
- 第二次完整建置與測試 **513/513** 通過，無失敗或跳過；安裝器已啟用本機提交 `9bf271897a3074dc591901ad1f88be4074040b30`，`.local/runtime.json` 讀回 `dictationProvider: windows`。紀錄為 `.runtime/bootstrap/setup-windows-20261002.log`。
- 安裝後的真正 Windows 辨識程序再讀回合成語句「今天在東區完成工作」；一秒靜音回傳空文字。實體麥克風與辨識品質仍未驗收。
- Chrome 助手固定位置為 `C:\K-harness\installed\k-browser-assistant`，版本 **0.1.2**；HKCU 的專用 Native Messaging 註冊及桌面 `K HARNESS.lnk` 目標已讀回，設定前備份保留於 vault。早先自動載入實驗僅當次有效，重開未保留；電腦操作工具在無法可靠確認網址時停止，未宣稱正式載入完成。
- 使用者提供已載入助手並允許無痕／檔案存取的截圖，但 23:47 原生 host 診斷讀回 `parent_check / parent_mismatch`。23:49 檢查 K Chrome 的 `Preferences` 與 `Secure Preferences` 均無此助手；當時唯一 Chrome 主程序未使用 K 設定檔，原生連線 descriptor 不存在。這是助手載入在日常 Chrome 的設定檔不符，未放寬原生 host 限制或修改日常 Chrome。
- 23:49 由正式桌面啟動器開啟 K，launcher log 為 `native isolated workbench ready`，`http://127.0.0.1:47831/health` 讀回 `app: k-harness-desktop / deployment: native`。接著使用原有 `Open-K-Browser.ps1` 開啟 K 設定檔，程序讀回存在。所謂 K 專用 Chrome 是同一套已安裝 Chrome 的獨立使用者設定檔，不是額外安裝的瀏覽器。
- 使用者於 K 專用視窗載入助手並提供允許無痕／檔案存取的截圖後，23:52 原生 host 診斷為 `ready / errorCode: null`，原生連線 descriptor 已建立。23:54 使用已安裝正式版 `createChromeExtensionContext` 與 `openChromeConnectPageViaNative`，一般模式真正連線及唯讀分頁列舉成功；未讀頁面內容、未操作原有分頁或帳號。驗證結果保存於 `.runtime/bootstrap/installed-browser-verification.json`。無痕設定已由使用者開啟，但真正無痕連線／操作尚未驗證。
- 原生核心實際讀回 Claude Code **2.1.287**、Codex **0.159.0-alpha.12.1**。初次 Codex 狀態檢查發現空白專用 `.codex` 目錄尚未建立，已只在 `agent-home` 下建立該目錄；重查為 `Not logged in`。Claude 專用 home 的官方 auth status 為 `loggedIn: false`。未搬移既有登入、代為登入或送出模型回合。
- 尚未完成：本人兩家訂閱登入、實體麥克風與真正模型工作、無痕真連線／操作驗收。不得以套件、建置或主程式健康檢查成功宣稱全部完成。

本機診斷位於 `.runtime/bootstrap`，不進 Git；正式個人登入／對話依既有 `agent-home`／`vault` 分區保存。
