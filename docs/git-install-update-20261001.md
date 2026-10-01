# Git 安裝／更新工程紀錄（2026-10-01）

## 授權與方向

使用者要求參考 DSH 的 Git 下載與更新，並另明確允許推送既有私人儲存庫 `paul800901/K-harness`。已回覆「離開並停止 K」，可在測試後正式套用。只推程式與文件，不含對話、登入、本機設定、Whisper 模型；不更改 DSH。

實際參考 `D:\DSH架構\DeepSeekHarness-0.1.5-rc.2-official` 的 `TRANSFER-README.md`、`Setup-Official-DSH.cmd`、`local-tools/official-dsh-updater.mjs`：私人 Git clone、lockfile 建置、個人 home 分離、候選驗證後啟用。這是 DSH 本地交付層，不是 upstream 原生更新功能；不照搬社群報告、外掛檢查，也不照搬其 fast-forward 後 push 失敗卻宣稱未更新的問題。

## 變更

- `Setup-K.ps1` / `Update-K.ps1` / `scripts/manage-install.mjs`：指定 Git ref → archive 到新目錄 → npm ci → 介面、擴充、啟動器建置 → 完整測試 → 確認停止後套用。不 checkout/reset 開發工作樹，不擷取未提交修改，不背景自動更新核心。
- `scripts/install-runtime.mjs`：只交換程式目錄，保存舊啟動器／入口與本機設定；失敗回復程式，顯式退版也保留退出的版本。舊正式 runtime 未含 launcher，退版直接使用配對備份，不假定舊 runtime 是完整 Git 安裝。
- `src/isolated-launcher.mjs` / launcher：由本機根目錄取得 candidate 及 Node，不再固定 D 槽與使用者。歷史資料目錄名稱不更動。
- `src/local-dictation.mjs` / Python helper：語音位置由本機設定提供，helper 用實際 Python 計算 CUDA DLL 路徑；不下載模型、不改 Win+H、不讀轉錄專案原錄音。
- Chrome 設定入口另記於安裝指南；明確呼叫才註冊，不因程式更新自行動日常 Chrome。
- `.gitignore` 排除 installed、附件與 native host 診斷；未提交既有 diagnostic。
- `README.md` / `docs/git-install-update.md` 說明首次環境、指定版本更新與退版。

## 驗證進度

- 修改前 DSH 僅只讀稽核，未變更任何 DSH 程式或資料。
- 維護工作樹完整測試 **508/508 通過**。
- 新增行為測試：程式更新、舊版（沒有內附 launcher）退版、個人假資料不變、執行中拒絕換程式、缺建置產物不換版、外部路徑不可搬。
- 先前審查發現 legacy runtime 無 launcher，已改從備份供應 launcher／入口，並以該真實結構測過退版。
- 下一階段：Git 提交後從 archive 乾淨建置／新路徑啟動及正式套用。此段落不宣稱這些已完成。

## 邊界

首次仍需要官方原生 CLI、Git／Node／npm 等環境；不偷搬帳號。Whisper 仍依賴可用 CUDA 環境，新電腦沒有安裝語音環境時不會憑空可用。Windows 10、實際登入、麥克風與 Chrome 使用者手動載入尚須在目標電腦驗收。程式退版不是使用者資料快照還原。

- 乾淨安裝第一次發現 Windows tar 解 Git archive 的中文 CMD 名稱失敗，正式程式未動；改用 Git ZIP 加 PowerShell Expand-Archive，保留失败候選，不重送任何模型工作。Windows PowerShell 5 的中文腳本亦已補 UTF-8 BOM，C# 啟動器已實際編譯通過。
