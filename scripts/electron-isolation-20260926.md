# Electron / Sandboxie 假資料隔離檢驗（2026-09-26）

## 目的與範圍

以既有 `KCandidate8` 盒，檢驗盒內 fake candidate 對外側可信 fake Electron main 與私有 CDP relay Node process 的記憶體／handle 權限，以及 vault、工作區與 47831 human 假入口的實際行為。只用新建假資料，不接模型、不載入真憑證、不改 Sandboxie policy／ACL、不用管理員、不複製 trusted-runtime，也不啟停正式 K。

入口：`scripts/electron-isolation-probe.mjs`；最小 Electron fake app：`scripts/electron-isolation-fake-app.cjs`。執行器直接重用 `src/sandboxie-control.mjs`、`src/sandboxie-process.mjs` 與既有 portable `Start.exe`；開始前先讀回 KCandidate1–8 idle，只租用 KCandidate8，結束透過既有 `control.stopBox()` 關閉本輪 lease。

## 最終實測

最終結果：`.runtime/isolation-pilot/electron-isolation-1790413383506-38268/result.json`；stdout/stderr 同目錄。狀態 `passed`，candidate exit code 0。測試前八盒 `/listpids` 均為空；最終八盒均讀回 0，47831 無 listener，測試 Node、Electron 與 candidate PID 均已退出。

| 檢查 | 證據 | 結果 |
| --- | --- | --- |
| 外側可信目標正對照 | relay Node PID `38268`、Electron main PID `20304`；host 讀取兩者主模組 PE header 的 2 bytes 均為 `MZ`；Electron 回報父 PID 為 relay Node，`--remote-debugging-pipe` fd 3/4 的 `Browser.getVersion` 回覆為 `Chrome/152.0.7977.130` | 通過 |
| 盒內讀記憶體 | candidate PID `47636` 對上述兩個仍存活 PID 取得的 handle，`NtQueryObject(ObjectBasicInformation, 56 bytes)` 分別回 `GrantedAccess=0x00001000`；PROCESS_VM_READ `0x10` 未授予。`ReadProcessMemory` 回 Win32 error 5、0 bytes；`NtReadVirtualMemory` 回 `STATUS_ACCESS_DENIED (0xC0000022)`、0 bytes | 通過 |
| DUP_HANDLE | 同一兩個目標的 `GrantedAccess=0x00121400`，PROCESS_DUP_HANDLE `0x40` 未授予；`DuplicateHandle` 呼叫失敗，error 6。呼叫使用 source handle `0`，有效性未知，因此**不是獨立的權限拒絕證據**；確證依據是 NtQueryObject 讀回的 granted-access mask 不含 `0x40` | 權限已剝除；呼叫失敗但不作獨立證明 |
| 新 vault 假檔 | Node 讀取 `vault/electron-isolation-1790413383506-38268.fake` 回 EPERM；PowerShell 讀取回 `UnauthorizedAccessException` | 通過 |
| 工作區假檔 | Node 與 PowerShell 均讀取新建輸入檔、寫入輸出並成功讀回 | 通過 |
| 47831 human 假入口 | host 先確認 port idle，之後僅短暫 bind 假 HTTP endpoint；盒內 Node 回 EACCES、PowerShell 回 AccessDenied，host 假服務 hits 為 0 | 通過 |

## 限制與正式狀態

- 這是限定 KCandidate8、兩個 fake owner process、指定檔案及 IPv4 loopback port 的假資料行為驗證，不證明所有進程、所有 handle、IPv6、其他網路路徑或正式 K 全面隔離。
- DUP_HANDLE 的 denied bit 由實際 granted-access mask 證明；使用 source handle 0 的 DuplicateHandle 失敗因 source 有效性未知，不能單獨歸因於權限。
- 本輪沒有修改正式 K、啟停正式 K、變更 policy／ACL、安裝元件、使用管理員或搬移憑證；不代表正式 Electron 候選或真模型驗收完成。
- 只新增並保留假資料／證據，未清理檔案。此前失敗試跑的紀錄保留在各自唯一命名的 `.runtime/isolation-pilot/electron-isolation-*` 目錄，不用作通過證據。
