# 東區套用已驗收版本（2026-10-09）

## 本人要求與固定版本

本人先要求下載 Git 更新，再明確回覆「套用」，授權本輪更新東區 `C:\K-harness` 的現用 K。此要求取代舊工程紀錄當時「東區未更新／不更新東區」的限制；不包含更新三家原生核心、搬登入、恢復工作或 GitHub 推送。

Git 來源已由 `0ae4be1` 快轉至 `bb1d1a9bd443aeb3b9349624ae84b4f9079d3a14`，141 個新提交，GitHub main 精確讀回一致。依 [安裝更新 SOP](git-install-update.md)，正式套用固定已驗收程式 **`1a45a73440a5f948c5cec625de02340863b7c67d`**；後續 main 的差異只有文件，不把文件版本當成程式版本。南區既有真正 Opus 複查、正式驗收及其界線見 [訊息複製收尾](user-message-copy-20261009.md)及 [公開發布紀錄](public-source-release-20261009.md)，本輪未冒稱重新複審。

## 準備、首次失敗與驗證

- 套用前本機版本 `51d0f9c18f98496e44af2a07887f6c534268ae99`。47831 無監聽，沒有 K 啟動器、現用 Electron 或 K 專用模型程序；未停止或重送工作。
- 首次執行既有 `Update-K.ps1 -PrepareOnly`，它選用舊 runtime 的管理器；從 Git 排除的安裝子目錄執行 archive，得到 62 bytes／0 entries 的空候選。隨後 npm 向父層根專案安裝相依，候選沒有 Electron，準備失敗。當時現用程式與 runtime 設定未替換；根工作樹的 Git 排除 node_modules 已成相依目錄，不另清理。失敗候選與日誌保留。
- 改用下載來源的 `scripts/manage-install.mjs`，從專案根目錄準備同一固定 SHA，仍沿既有 npm ci、Electron、介面／擴充／啟動器建置及完整測試流程。沒有修改產品、安裝器或版本內容；舊入口的子目錄打包問題仍待另行修正，不擴張本輪更新。
- 東區候選完整 **1088/1088 通過**，0 失敗／跳過，保留 `K_DICTATION_PROVIDER=windows`；介面、瀏覽器擴充及 C# 啟動器建置成功。候選 `prepare-1791554712020`。
- Git archive 的 **619 個來源檔**逐檔核對；建置對 `browser-extension/extension-protocol.cjs` 只產生 CRLF／LF 差異，已還原 archive 原始位元組再套用，沒有邏輯變更。

## 東區正式套用與讀回

2026-10-09 22:08 臺灣時間，重驗停止後使用既有 `activateRuntime`，交換候選及現用程式，保留上一版：

`C:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791554899837`

- `.local/runtime.json` 正式版本讀回為 `1a45a73440a5f948c5cec625de02340863b7c67d`，`previous` 指向上述備份。除了版本／退版位置，其餘設定相同，`dictationProvider=windows` 保留；既有私有 Codex config SHA256 相同。
- 程式交換前後，agent-home、vault、workspace、browser-output 及 trusted-providers 的 **5,650 個檔案路徑／大小／修改時間相同**。只讀檔案 metadata，未讀憑證內容；這不是全部內容 hash 驗證或對話備份。原生核心沿用既有檔案，未升級；Codex 原為 0.159.0-alpha.12.1、Claude Code 2.1.287。
- 從正常 `Start-K-Desktop.ps1` 重開，桌面捷徑仍指同一 `local-launcher/dist/K桌面啟動器.exe`。正式健康檢查 200，`deployment:native` 與原 private-state 正確；實際 HTTP JS／CSS 與部署檔 SHA256 一致，未認證 `/api/state` 仍為 403，未讀或繞過登入 token。
- Computer Use 讀回真正正式 Electron 的「K 執行中樞」視窗及無障礙文字：品牌、手動排序、原有工作區／聊天室、待命空選擇、「無未結束的子代理」與聽寫控制皆存在。未打開、恢復或送出真實聊天室工作。截圖曾報 `FrameArrived timed out: timed out waiting on channel`，改用無障礙文字完成畫面驗證，不宣稱截圖成功。
- K 保持正常開啟。本輪不另驗三家新模型回合、所有新增功能或實體麥克風，不以南區實測代替東區逐功能驗收。

## 瀏覽器助手

現用已安裝擴充仍為 0.1.2，因此依既有 `Setup-K-Browser.ps1` 更新至 **0.1.3**。15 個配送檔與可信建置 SHA256 一致；原兩份 Chrome 設定逐位元組相同，HKCU 僅重套同一 K native host 登記，沒有新增服務／自啟動或修改日常 Chrome。

擴充與登記備份：`vault/k-browser-assistant-backups/setup-20261009-221512-156`。當時 K 專用 Chrome 未執行，不強行開窗；已更新穩定載入目錄 `C:\K-harness\installed\k-browser-assistant`，**尚未實測 Chrome 載入 0.1.3 或真正瀏覽器工作**。程式退版與擴充備份分開，不將程式備份當成對話還原。

證據保留在 Git 排除的 `C:\K-harness\.runtime\dongqu-update-20261009-1791554556074`：首次 prepare.log、成功 prepare-current.log、source-readback.json、activation.json、preservation.json、formal-readback.json 與 browser-readback.json。Antigravity 工作樹未操作；本輪只新增本機工程紀錄與索引，不推送 GitHub。
