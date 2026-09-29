# 瀏覽器下載安全補強與登入隔離交接（2026-09-25）

## 狀態
下載補強已實作，通過本機回歸及兩家原生模型下載驗證。正式瀏覽器未啟用、後端未重啟，沒有登入真實帳號、建立 Windows 帳號或修改 ACL。登入隔離仍未完成。

## 本輪修改
- `src/browser-live-session.mjs`：K 保存檔案後，在 Windows 寫入並讀回 `Zone.Identifier` 的 `ZoneId=3`；失敗不把該下載標為成功。這是來源標記，不代表防毒掃描或 SmartScreen 必定顯示。
- 實測發現官方 Playwright MCP 另存 `output/probe.txt`，所以不能只保護 K 的 downloads 副本。現在在 download 事件同步包裝該 Download 的公開 `saveAs`，兩條路徑共用保存檢查與標記；限定對話輸出目錄，拒絕既有目標和目錄連結，不修改 node_modules。
- Windows 保留檔名（如 CON、NUL、COM1）在 K 的保存名稱前加底線；上游指定路徑不偷偷改名，無法安全保存時失敗。
- 下載清單只顯示來源 origin，不洩露 URL 帳密、query 或路徑內 token；危險副檔名顯示提醒，儲存副本前另詢問確認。不自動開啟或執行下載。
- `shared/browser-downloads.mjs`、session、proxy 共用 64 MiB 儲存副本上限；proxy 即使收到缺少或不實 Content-Length 的串流也會累計並中止，並於讀取後再次確認對話未切換。

## 不能宣稱已解決的部分
HTTP「儲存副本」只傳送檔案內容，不會自動傳送 NTFS ADS。原檔與 MCP 另存檔已驗證有標記，但最終經使用者瀏覽器另存的副本，不保證保留網際網路標記。介面已明示並對危險類型要求確認；這只是降低誤開風險，不能當成來源標記保留已完成。若要保證最終 Windows 副本，需要另外接原生附件保存流程。

## 驗證
- 完整 `npm test`：326/326，0 失敗；`.runtime/browser-hardening-final-tests.log`。
- UI build 成功（既有 bundle 大小提醒保留）。
- `scripts/browser-download-probe.mjs` 預設 dry run；明確 `--run` 才呼叫官方 CLI。只允許本機假頁面及 navigate/snapshot/指定下載連結 click，不允許 shell 或其他工具。
- Claude 與 Codex 各一個原生回合，模型實際 click 下載，K 下載端點讀回正確內容，K 原檔與 MCP 副本皆有 ZoneId=3，全程 AI 操作狀態，假頁請求均為 loopback：
  - `.runtime/browser-download-probe/probe-codex-1f1d016c-00ec-4980-9737-6f5f3d504545/evidence.json`
  - `.runtime/browser-download-probe/probe-claude-f31e5bfe-2ff8-464e-b242-f16f2918f0f6/evidence.json`
- 先前兩份 probe 紀錄保留：`step` 名稱被檔名欄位覆蓋，造成摘要 false；沒有修改舊證據。修正為 fileName 後重新跑上述回合，全部 checks true。
- 真實 Edge + K 隔離 UI：本機純文字內容、假 `.cmd` 副檔名下載完成，來源／危險提示／64 MiB 與副本限制均可見；点击儲存副本確實出現確認。CUA 無法進一步處理該 confirm（工具逾時），已關閉暫時分頁，未驗證接受後副本。檔案未執行；保存檔 ADS 讀回 ZoneId=3。
- UI 初次以舊測試 profile 下載假 `.exe` 時，下載失敗且瀏覽器不可用，原因尚未確定；未繞過瀏覽器保護，不能把後續 `.cmd` 成功當成 `.exe` 成功。此項保留給後續複查，不影響兩家本機文字下載的已通過證據。
- 隔離 UI 伺服器及測試模型 host 均已關閉；未更動正式 browser-mcp 開關。

## 給 Opus 的複查範圍
1. 核對所有 saveAs 路徑都經過來源標記，不只 K 清單中的那份；升級 Playwright 後重跑原生 probe。
2. 核對 Windows 名稱、64 MiB proxy 串流限制、危險類型提醒與副本限制說明。
3. 不要把 HTTP 副本標記或登入隔離判成已完成。另讀 [持續登入方案](browser-persistent-login-plan-20260925.md)：僅方案和驗收條件，尚未變更系統。
4. 若重跑 UI，釐清假 `.exe` 失敗與確認視窗接受／拒絕流程；只用假資料，不執行下載內容、不登入帳號。
