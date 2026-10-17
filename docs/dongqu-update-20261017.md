# 東區更新準備（2026-10-17）

- 本人要求更新附件 K HARNESS 捷徑指向的安裝。實際桌面捷徑指向 `C:\K-harness\local-launcher\dist\K桌面啟動器.exe`。
- 本機 `.local/runtime.json` 現行程式為 `1a45a73440a5f948c5cec625de02340863b7c67d`，Windows 聽寫，本輪讀取時 47831 無監聽；來源工作樹原先乾淨。
- GitHub 連接器讀回 main 為 `d9d1b267954c094b17e8d952612140b7a040b507`。其工程索引及 `docs/integrated-deploy-20261016.md` 指定已部署程式 `46ec46040d3ee0df1a4fc82cfd5f21a6591800a3`；1734/1734、真正 Opus 複查與南區正式讀回是來源端既有證據，不是東區本輪測試。
- 本輪終端機 `git ls-remote origin HEAD refs/heads/main` 連 github.com:443 失敗。對話執行環境將本專案 `.git` 設唯讀，不能直接使用標準 fetch 更新流程；不是 GitHub 登入失敗。未嘗試繞過沙箱或變更權限。
- 已準備 `.runtime/update-20261017/Run-Update.ps1`，供本人一般 PowerShell 執行。它 fetch 固定版本，只擷取該版本既有更新器與必要相依，再由原專案更新器執行候選建置、完整測試與 activation；不修改來源工作樹或已安裝的舊更新器，不升級三家核心。沿用本機設定、保留退版，成功才啟動一次並讀 health。
- 驗證：PowerShell 語法解析；尚未執行下載／建置／測試／套用／啟動。程序完成紀錄寫在上述目錄的 `run-*/update.log` 與 `result.json`。尚待本人執行及當地正式讀回，未宣稱更新完成；Chrome 載入與真正模型回合未驗證。本輪沒有 push。

## 限制來源唯讀診斷（2026-10-17）

- 使用者撤銷先前 AGENTS.md 指示後要求查明限制來源；本輪只診斷，未修改全域設定、ACL、網路或權限模式。
- 當前對話實際 profile 為 managed／workspace-write，明列 C:\K-harness\.git 唯讀；網路雖 enabled=true，允許清單沒有 github.com／npm registry。approval reviewer 已為 auto_review，但 sandbox_approval 類別仍不允許，不能將自動審查誤認為完整存取。
- 透過獨立的唯讀檔案工具核對：專案 .codex/config.toml 無 sandbox／approval／network 限制；C:\Users\user\.codex\config.toml 指定 windows.sandbox=elevated，且 C:\K-harness 已 trusted。全域桌面狀態的 composer-permission-mode-visibility.full-access=true，因此不是單純未開啟該顯示設定。該桌面設定不證明本對話已選完整存取。
- C:\Users\user\.codex\requirements.toml 與 C:\ProgramData\OpenAI\Codex\requirements.toml 均不存在；不據此推定其他政策來源不存在。
- 本輪三個 shell 診斷都在 PowerShell 啟動前失敗：helper_sandbox_lock_failed，開啟 C:\Users\user\.codex\.sandbox-bin 遭 NtCreateFile 存取拒絕（os error 5）。同一錯誤已從 .sandbox/setup_error.json 讀回。未讀取被拒絕的 sandbox-bin、未改 ACL。
- 結論：原先 Git／網路限制可直接由本對話權限設定解釋；另外存在 Windows 原生沙箱初始化故障。尚無足夠證據確認 sandbox-bin 的拒絕由哪個元件或 ACL 變更造成，也未取得南區對照，不能稱東區 Windows 特有封鎖。K 更新仍未套用。

## K 內接續準備（2026-10-17 02:23）

- 本人更正任務主線為更新 K，Codex App 修復僅為順帶；接續本頁既有東區更新目標，未變更 CaseAgent。
- 本對話已成功執行 `git ls-remote`、`git fetch origin --tags`；遠端 main 仍為 `d9d1b267954c094b17e8d952612140b7a040b507`，已驗收程式固定為 `46ec46040d3ee0df1a4fc82cfd5f21a6591800a3`。原先的 Git／網路阻擋不適用於本次 K 對話。
- 使用該 commit 的原版 `manage-install.mjs`、`install-runtime.mjs`、`recycle-path.mjs`、`atomic-write.mjs` 準備候選，不覆寫舊 installed updater 或來源工作樹。真正 Opus 5.5 複查沿來源版本既有證據；本輪沒有產品程式修改。
- 第一次準備的外層 Windows PowerShell 使用 Stop 加合併 stderr，將 npm notice 當 NativeCommandError 中止。已確認 updater 程序停止、原候選僅到相依安裝、未 activation；保留原始紀錄。其後在同一候選目錄以直接子程序輸出到檔案，重新確認 npm ci 成功，再依原更新器順序完成 Electron、介面、擴充、啟動器及完整測試；沒有改產品或略過檢查。
- 東區本輪完整測試 **1734/1734 通過，0 失敗／取消／略過，91.9 秒**。介面、瀏覽器擴充、啟動器建置全部成功。
- 固定來源 **792 檔**核對通過、無未解差異：791 檔與該 commit 的 Git archive 位元組一致；建置重產的 `browser-extension/extension-protocol.cjs` 與原始 Git blob 一致。
- 候選：`.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/prepare-1792174761970`。證據：`.runtime/archive/dongqu-update-20261017/prepare-20261017-0219/`，包含 bootstrap、首次紀錄、完整建置／測試、prepared.json、candidate-readback.json。
- 正式 `.local/runtime.json` 仍為 `1a45a73440a5f948c5cec625de02340863b7c67d`，與本輪開始時的設定完整一致，包含 Windows 聽寫；正式 health 為 native，47831 仍由現用 K 監聽。**候選已驗證、尚未正式套用。**
- 固定版本的 AGENTS.md 明列：「在 K 內執行的 AI 無法停止或更新自己所在的 K；正式更新須 K 完全停止後，在 K 外執行 Update-K.ps1。」本輪不停止承載目前對話的 K，也不預先排程套用。
- 最後步驟：本人完成其他工作後選「離開並停止 K」，在一般 PowerShell 執行既有 `.runtime/update-20261017/Run-Update.ps1`。該腳本使用固定版原更新器，會重新依標準流程建置／測試、保留退版、套用、啟動一次並讀回 health；先前候選及證據保留。正式套用及原生回合仍須讀回，不能用本輪候選通過代替。
- 最後交付檢查另發現既有 `Run-Update.ps1` 為 UTF-8 無 BOM：文字以 UTF-8 載入可解析，但本機 Windows PowerShell 5.1 直接 ParseFile 產生 11 個中文誤解碼語法錯誤。已先備存原檔，再只加 UTF-8 BOM；除開頭 3 bytes 外逐位元組一致，未改腳本邏輯。直接 ParseFile 已為 0 錯誤，外部執行命令可用；原檔留在上述證據目錄。

## 更新中斷後的正式版本核對（2026-10-17 03:12）

- 本人表示畫面可能不對、詢問是否新版；已先詢問具體錯誤位置，尚未取得細節，未將截圖中的額度／模型選項直接判定為故障。
- 本輪讀回 `.local/runtime.json` 仍為 `1a45a73440a5f948c5cec625de02340863b7c67d`；現用 `trusted-runtime` 的 619 個 Git 來源檔均與此版 archive 一致，沒有缺檔或來源差異。dist-ui 所引用的 JS／CSS／圖片檔存在；不據此宣稱全部 UI 行為正確。
- 啟動器紀錄顯示 03:06:26 已正常停止 K；外部更新 `run-20261017-030634` 已開始，紀錄至候選 `prepare-1792177596411` 的建置輸出，末尾為 `^^C`，最後寫入時間 03:08:08。沒有 result.json、沒有完整測試完成紀錄；未見殘留 updater 或候選建置程序。03:08:09 啟動器再次啟動，03:08:10 ready；本輪 47831 由該次啟動的 trusted-runtime Electron PID 16504 監聽，health 為 native。
- 結論是外部更新在套用前中斷，重開後仍用舊版；不能認定已更新，也不推定 Ctrl+C 是本人有意取消或特定系統錯誤。更新器 `run()` 將子程序 stdout 暫存在 pipe，直到命令結束才輸出；完整測試期間可能沒有畫面輸出。先前成功候選的測試花 91.9 秒，這可解釋表面靜默，不能證明本次中斷原因。
- 既有已驗證候選 `prepare-1792174761970` 再次核對 792 個來源檔通過（protocol 生成檔符合原 Git blob），UI 資產存在。證據存 `.runtime/archive/dongqu-update-20261017/update-status-20261017-0312.json`。未重跑完整測試、未啟動新更新或自動重播未知工作。
- HTTP 根頁匿名讀回為 403；未使用憑證繞過，未宣稱已驗證實際載入的 UI 資產。版本結論依據設定、實際程序路徑與正式來源核對。
- 後續仍可沿既有外部 Run-Update.ps1 完成固定版更新；必須先離開並停止 K，讓腳本完成建置與測試、顯示更新完成並自行重開。K 內不停止或更新承載本對話的執行程式。本輪只追加診斷紀錄，未修改產品程式或帳號／對話設定。