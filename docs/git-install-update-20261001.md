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

## 乾淨安裝追加實測

- Git ZIP 在 `D:\K-harness\.runtime\git-install-smoke\新機 測試`（中文及空格）完成 npm ci、三項建置與 **508/508** 完整測試；兩家原生 exe 版本為 Codex 0.159.0、Claude Code 2.1.285。沒有複製登入資料。
- 接著真正啟動抓到缺漏：Electron 44 套件沒有 postinstall，npm ci 不會自動取得 Electron binary。第一次啟動失敗，正式 K 未動；安裝器補上官方 `node_modules/electron/install.js`，不是以測試通過當成啟動通過。
- Chrome 設定腳本在上述假安裝目錄驗證中文設定／wrapper；註冊 helper 換成只記錄參數的測試 stub，因此本次沒有寫 HKCU、沒有開 Chrome，不能宣稱新機 Chrome 已驗收。

## 正式完成與 Git 讀回（2026-10-01 10:01 後）

- 官方 Electron binary 下載完成後，中文空格的新安裝目錄真正啟動 Electron；收到 `ready`，送一次 `close` 後收到 `closed confirmed=true`，退出碼 0。匿名 GET `/` 回 403 是可信入口保護，不作為登入／畫面內容通過證據。
- 正式安裝候選再次從 Git 建置，完整測試 **508/508 通過**（34.17 秒）；啟動入口另發現既有 `Start-K-Desktop.ps1` 未含 BOM，Windows PowerShell 5 解析失敗。已補 BOM、再次建置與 **508/508 通過**（33.85 秒），沒有掩蓋這次失敗。
- 正式啟用程式 commit：`60672fc85f85c4b434c7298a897d7cec1c2f10e0`。最後僅更新入口增加「退回舊版後從已保留新版載入更新器」，此入口以假 manager 實際透過 PowerShell 5 執行驗證；不重新建置未改的介面／binary。
- 正式 runtime 395 個 Git 追蹤檔與維護來源逐一比對，除 CRLF/LF 正規化外 **沒有差異**。根目錄僅套用配套 launcher、Start／Update 入口及本機設定，沒有整批覆寫舊根目錄開發來源。
- `D:\K-harness\.local\runtime.json` 已保存目前 Node 及原有 Whisper Python／模型位置，沒有搬錄音、模型、登入或對話。原有瀏覽器設定／HKCU 註冊未更動。
- 可退回的更新前正式版：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1790819992956`。`previous` 指向此真正更新前版本，不指向本輪尚未成功啟動的中間版；中間產物仍保留。
- 10:01:38 由正式 Start 入口啟動，10:01:39 launcher 記錄 `native isolated workbench ready`；`GET /health` 回 `deployment=native` 與原有 private-state 路徑。未發起收費模型工作；本輪不宣稱真實麥克風／新機登入已驗收。
- 已 fast-forward 推送私人 `paul800901/K-harness` 的 main，並發布 Git tag **`k-r3-git-20261001`**，遠端 main／tag 讀回皆為上述 commit。未 force push。
- 再由 GitHub clone 此 tag 至新目錄讀回相同 commit，存在 Setup 入口、沒有 `.local`／`.runtime` 個人資料。推送前已检查本輪 Git 物件路徑及追蹤檔秘密樣式，未發現登入／憑證／執行資料被納入。
- 本段完成紀錄另作文件提交；發布 tag 與正式程式版本保持不變。Windows 10 實機、目標電腦官方登入、Chrome 載入和語音硬體仍須在該台驗證。
