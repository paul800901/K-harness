# 現有 Codex 沙箱試驗：前置範圍檢查（2026-09-25）

> **後續狀態已更新：** 使用者追加允許官方 `.sandbox-bin` 例行重套後，已完成假資料實測。檔案保護成功，但沙箱確實讀到假人類程序的 36 bytes，整體隔離未通過。見 [完整實測結果](codex-sandbox-isolation-result-20260925.md)。以下保留的是取得追加授權前的前置檢查歷史，不是最新執行狀態。

## 結論

**隔離測試尚未執行；停在授權的前置條件。** 現有沙箱已存在，但目前沒有足夠證據確認這一版本的 runner 能在「需要初始化或會改動範圍外 ACL」時先拒絕。不能用啟動後才比對權限，代替使用者要求的啟動前範圍確認。

這不是 Codex 沙箱隔離失敗，也不是已證明需要重建沙箱。未測假 cookie／人工 token 讀取、程序 VM_READ、Claude／Luna 的網路及串流，不宣稱這些項目已通過。

## 本輪授權

使用者回覆「允許，限上述假資料試驗」。授權只涵蓋 `D:\K-harness\.runtime\isolation-pilot` 下新假資料目錄及其測試 ACL。需要初始化、新帳號或不能將權限變更限制在範圍內，必須先停下。授權已記入 `AGENTS.md`。

## 已完成的唯讀確認與證據

本輪證據目錄：

`D:\K-harness\.runtime\isolation-pilot\codex-45cbb03d-3263-45ee-a1a0-b26c709cda13`

- `before.json`：執行說明指令前的六個目錄 ACL、相關沙箱帳號狀態、執行檔路徑及 SHA-256。
- `sandbox-help.txt`：本機原始說明輸出。語法為 `codex sandbox [OPTIONS] [COMMAND]...`；沒有再把 `windows` 傳成子指令。
- `codex-version.txt`：`codex-cli 0.155.0-alpha.16.4`。
- `result.json`：檢查後讀回與未執行項目；狀態為 `not-run-preflight-scope-unconfirmed`。

執行檔：`C:\Users\Paulus\AppData\Local\OpenAI\Codex\bin\13995fba801849b0\codex.exe`。

SHA-256：`9015C47D1714294ECD9033C4B5AEFC3076797D867D1C36AA37749FCB76C8942F`。

1. `CodexSandboxOffline`、`CodexSandboxOnline` 已存在且啟用；先前的 `KAgentSandbox` 仍停用。沒有修改帳號、讀取沙箱帳密或使用者訂閱登入檔。
2. 既有 `.sandbox/setup_marker.json` 記錄版本 5；這只能證明有既有設定紀錄，**不能證明新版 runner 不會要求刷新**。
3. 本機說明包含 `--sandbox-state-json`、`--permission-profile` 等選項；沒有列出禁止初始化／僅允許特定 ACL 變更的選項。不代表所有內部路徑都一定沒有這種能力，仍需對此安裝版本取得明確依據。
4. 本輪只執行 `codex sandbox --help` 與 `codex --version`，沒有提供待執行程式，沒有啟動 sandboxed command 或 setup。
5. K 原本只查 `windowsSandbox/readiness`，不呼叫 setup；這不能反推 CLI runner 的初始化行為。既有公開說明及本機快取沒有提供足以約束此次啟動的實作證據。
6. 六個監測目錄的 ACL 前後相同：K 根、`.runtime`、`isolation-pilot`、使用者 `.codex`、`.codex/.sandbox`、使用者暫存目錄。這是有限範圍讀回，**不是整台電腦所有 ACL 的快照**。未刪改 Opus 提到的既有 `CodexSandboxUsers` 權限。

## 下一步與停止條件

先查清此安裝版本 runner 的 setup／refresh 觸發條件與完整 ACL 目標；只有能確認變更限於本輪新目錄，才可沿用本次授權啟動假資料測試。若必須刷新系統沙箱，先列出具體影響與復原方式，另行取得授權，不用寬泛的「初始化」取代範圍說明。

真正開始測試時，仍須同時驗證：假私有檔確實存在但讀取遭系統拒絕、假人類程序存活時 VM_READ 被拒，以及允許的工作目錄可正常讀寫。不以「路徑不存在」、程序退出、網路不通或設定名稱當成隔離成立。

## 正式狀態與驗證限制

- `.runtime/browser-mcp.json` 仍不存在；沒有啟用瀏覽器、登入真帳號、重啟 K 或更改 provider 啟動方式。
- 沒有修改產品程式、本輪沒有重跑全套測試；363/363 是上一輪 Opus 的複查結果，不是這次沙箱實測成績。
- 本輪新增／更新只有授權與前置檢查紀錄、索引及隔離目錄內的證據檔；沒有執行 ACL 修改指令或帳號變更。

## 官方資料（用途是查證候選，並非本機隔離通過證據）

- [Developer commands](https://learn.chatgpt.com/docs/developer-commands)：官方提供原生 sandbox 命令入口；以本機說明校正這一版的實際命令語法。
- [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)：elevated 沙箱涉及專屬低權限使用者、檔案權限、防火牆與本機政策；現有設定不等於本次啟動沒有範圍外影響。
- [Permissions](https://learn.chatgpt.com/docs/permissions)：描述檔案／網路政策，不承諾 runner 初始化只會修改指定測試目錄的 ACL。
