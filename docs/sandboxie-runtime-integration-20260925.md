# Sandboxie 程序接線與核心網路假資料驗證

## 判定與邊界

**隔離執行接頭與假資料原生 CLI 驗證完成；尚未正式接入所有代理，也不能啟用真實登入。** 正式 K 後端沒有由本輪重啟，`.runtime/browser-mcp.json` 未建立。其他工作中的前端部署不是本輪隔離驗收。

使用者要求繼續做到需要人介入為止，不把 Opus 同儕複查當成工程核准關卡；本輪假資料實驗及結果直接留在專案，不要求轉貼。最新詢問的 Software Compatibility 視窗來自這次臨時 Sandboxie 安裝，處置與更正見下方。

證據目錄：`D:\K-harness\.runtime\isolation-pilot\sandboxie-integration-c1e1d349`。它是新建目錄，沒有讀取既有瀏覽器 cookie、密碼、provider auth 檔或真實程序記憶體。

## 這輪實作

- `src/sandboxie-process.mjs`、`src/sandboxie-stdio-bridge.mjs`：把 K 的 stdin/stdout/stderr 透過專屬 named pipe 轉送到盒內程序；環境及啟動參數在 pipe 內傳輸，不寫入命令檔。不把外側啟動器 PID 當成模型 PID。
- 每個盒同時只有一個 runner lease（盒名不分大小寫）；啟動逾時、斷線、停止或原生程序結束都關閉整盒，官方 `/listpids` 讀回為空後才釋放 lease 及發出 close。關閉失敗維持占用、回報錯誤，不偽装成功。
- 轉送有 frame／輸出背壓限制。主代理複查補到的自然結束＋停止失敗路徑，也不會產生未處理 Promise rejection 而拖垮 K。
- `src/sandboxie-control.mjs`：官方 Start.exe 的終止／PID 讀回，以及明確的隔離環境變數。HOME、Claude/Codex 設定與 temp 在新的隔離 home，不繼承 API key、NODE_OPTIONS 或人工控制憑證。
- `src/codex-host.mjs`、`src/claude-host.mjs`：可注入同一隔離 runner；Claude 訂閱 preflight 與長駐程序必須使用同一 runner 身分及 home，不能以宿主登入檢查取代盒內檢查。既有訂閱與計費防線保留。
- `src/isolated-provider-hosts.mjs`：集中上述同 runner 接法；檢查逾時／過量输出／錯誤時先要求確定停止，沒有宿主或 API fallback。
- `src/desktop-server.mjs`：新增 **opt-in** `requireLaunchToken`。測試模式的公開 GET `/` 不再直接發人工 session；可信呼叫端才能取得一次性、60 秒有效的啟動 URL。正式預設仍是舊行為，托盤尚未接新入口；這不是單靠 URL 就完成隔離。

## 核心網路驗證與授權

使用者已明確允許在臨時安裝启用官方 WFP 並重載驅動。只修改這個安裝的 `Sandboxie.ini`，SbieDrv／SbieSvc 都是 Manual；未改 Windows Firewall 規則、帳號、既有工作區 ACL 或自動啟動項。

使用官方 v1.18.4 元件，安裝 EXE SHA-256 `cfceda1b1a63abcd2b3e5fbfdc4895f15db56316f5a9f2f06aea230e209b120e`、Authenticode Valid，核心各檔案也逐項核對。原始碼及有效設定讀回沒有以使用者態 hook 冒充核心阻擋。

| 對照 | 人類假入口 127.0.0.1:47961 | AI 假入口 127.0.0.1:47962 |
| --- | --- | --- |
| 盒外 Node | 200 | 200 |
| 盒內 Node | EACCES；伺服器收件數 0 | 200；收件數 1 |

實際 API 讀回 driver WFP flag 為 true，BFE Running；這個 flag 不單獨當作封鎖證明，以上雙入口實測才是行為證據。只驗證指定 IPv4 loopback 規則，**不是所有網路路徑／IPv6／所有系統服務已隔離的宣稱**。

證據：`network-result.json`、`workspace-a/network-host.json`、`workspace-a/network-box.json`、`wfp-driver-readback.json`、`wfp-driver-reload.json`、`wfp-Sandboxie.ini`。最初腳本 import 路徑錯誤在測試開始前失敗，修正後才產生通過結果；未冒充第一次成功。

## 真實 runner 驗證（不送模型回合）

`probe-runtime.mjs` 直接使用本輪產品接頭及新建的 trusted bridge 副本，**5 組通過**，結果在 `runtime-result-1790345594513.json`：

1. 196,624 bytes（繁體中文、binary、192 KiB payload）stdin/stdout 等值、stderr 等值、exit 7 正確，結束後盒內 PID 為空。
2. 主程序及其子程序讀兩個實存的假 cookie／人工 token，都回 EPERM，而不是「不存在」被當成拒絕。
3. A、B 各有至少三個盒內程序；停止 A 後 A 的 PID 空、B 仍有程序且持續輸出。再停止 B，B PID 也空。
4. 官方 Codex `0.155.0-alpha.16.4` 在新 home 啟動 app-server，initialize 與 account/read 成功；帳號為 null。沒有沿用宿主登入，沒有送 turn。
5. 官方 Claude `2.1.280` 在新 home 正常回應 version／auth capability／auth status；loggedIn=false。K 保持 available=false、要求官方登入，不略過訂閱驗證或切 API。

測完 A、B 都確定無程序。這已超過前輪「只有假 Node stdio 可行」的原型，但 **Claude 真正模型串流、Luna／Pi 全路徑與正式重新登入仍未驗證**。

## 使用者看到的相容性視窗

- 試驗啟動了本次 portable 的 `SbieCtrl.exe`，首次相容性檢查彈出 Software Compatibility，列出 Windows／Office、Edge、鍵盤等建議。不是 K 對話錯誤，也不是使用者另裝了不明工具。
- **更正最初說明：不能把 X 當成安全取消。** v1.18.4 `ThirdPartyDialog.cpp` 的 `OnCancel()` 在 AutoRun 時會呼叫 OnOK／套用模板。主代理查明後已立即告知使用者，不再建議自行按關閉或 OK。
- 主代理只終止核對路徑後的本次 SbieCtrl 程序，讀回没有 `Template=` 被套用；沒有點相容性確認。
- 官方窄範圍 opt-out 是目前使用者段的 `SbieCtrl_AutoRunSoftCompat=n`，不是 SandMan 的設定。只改本次臨時 INI，沒有隱藏安全通知或關閉核心防護。
- 後續跑完整 5 組實測，SbieCtrl 沒有可見主視窗（handle 0、title 空）、有效值為 n、模板仍空；之後結束該管理程序。

證據：`unexpected-gui-readback.json`、`before-compat-optout.ini`、`compat-optout-readback.json`。官方來源：[ThirdPartyDialog](https://github.com/sandboxie-plus/Sandboxie/blob/v1.18.4/Sandboxie/apps/control/ThirdPartyDialog.cpp)、[使用者設定前綴](https://github.com/sandboxie-plus/Sandboxie/blob/v1.18.4/Sandboxie/apps/control/UserSettings.cpp)。

## 驗證、還原與未完成

- 新增的 runner／control／host 接點／desktop bootstrap 聚焦測試先獨立 **26/26**；factory 7/7。主代理在全部檔案完稿後，循序全套 **401/401、0 失敗、exit 0**，約 123 秒；證據 `regression-final.log`。沒有建置／覆寫正在使用的正式 UI。
- 第一輪預設並行全套為 **397/399**，不算通過：既有 Claude controller projection 測例出現 Windows rename EPERM；另一個 factory 測例在檔案仍修改中啟動而卡住，主代理核對 PID／parent／命令後只停止該測試子程序。原始失敗與中止結果完整保留於 `regression-tests.log`，沒有修改原測試結果或重送真實模型工作。factory 完稿後單独 7/7 通過，之後才做固定版本循序全套。
- 22:15 官方 KmdUtil 的 stop/delete SbieSvc、stop/delete SbieDrv 四步 exit 0；相關服務、驅動、EventLog source 登記皆已不存在。證據 `remove-system-result.json`。沒有永久移除其他人的安裝或停止正式 K。
- 22:18 已把這次 `portable`、`boxes`、安裝 EXE 三個明確目標移入 D 槽資源回收筒，逐項讀回原路徑不存在、回收 metadata 原路徑吻合及 payload 存在。`recycle-results.json` 保留可恢復證據；假 workspace、測試原稿與設定副本保留供複查。沒有永久刪除或清空回收筒。
- `after-system.json` 讀回：臨時程序零、服務／驅動登記皆無；K 工作區 ACL 與試驗前相同、KAgentSandbox 仍停用、正式瀏覽器開關不存在。沒有宣稱 OS 稽核紀錄或整台電腦每個位元完全回復。
- 後續仍須把每個 main／Luna／Pi 執行入口接上隔離；把 trusted runtime 與 AI 可寫專案分開；把 owner-side browser gateway／人工啟動入口接完整並驗證。目前 **Pi 仍有 K 程序內 SDK 路徑，正式 browser 仍是舊接法**，不能因兩家 CLI 可啟動就宣稱全面隔離。
- 網站登入持續保存、真正模型操作與人機切換仍需完整隔離接線後驗收。現在不請使用者登入，也不複製憑證。
- 正式採用前需確認使用情境授權：官方 [feature comparison](https://sandboxie-plus.com/feature-comparison/) 表示 Sandboxie Plus 商業／教育使用需要 Business Certificate；本輪沒有購買或申請。基礎規則及 WFP 可用不等於所有正式使用都免費。
