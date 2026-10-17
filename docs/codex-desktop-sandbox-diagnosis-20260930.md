# Codex 桌面沙箱設定停止：2026-09-30 唯讀診斷

> 後續使用者要求透過 K 修復；12:24 官方 elevated setup 已成功、readiness=ready，原生沙箱命令讀寫及界線測試通過。詳見下方修復記錄。上段唯讀狀態保留為歷史。

使用者要求找出官方 Codex 更新後 Windows 設定停止原因。本輪未修產品、未變更 Windows 權限／服務／設定，未重啟或部署 K。

## 已確認

- 本機套件 OpenAI.Codex 版本 `26.928.1915.0`。
- `C:\Users\Paulus\.codex\.sandbox\setup_error.json` 回報 `helper_sandbox_lock_failed`，訊息為開啟 `.sandbox-bin` 目錄失敗，發生於鎖定該目錄的步驟。
- 最新 `sandbox-eb45dd7eb6f65db0.log`：台灣時間 2026-09-30 12:02:14，防火牆設定及 WFP 12 個過濾器成功後，立即上述錯誤。
- `setup_marker.json` 為 0 bytes；當日執行紀錄回報 marker missing or incompatible，因而再次要求設定。
- 16 份 `sandbox-*.log` 均有同一錯誤，最早本輪查得 2026-09-28 13:04:03，最新 09-30 12:02:14。不能稱為今天才首次發生。
- `.sandbox-bin` 是普通目錄，非連結；SYSTEM／Administrators 為 Modify，Paulus 為 Modify + ChangePermissions，CodexSandboxUsers 為 ReadAndExecute。僅讀取 ACL，未修改。
- `CodexSandboxService.OpenAI.Codex` 為 Running，指向該已安裝版本的官方服務程式。

## 判讀與限制

直接失敗點已定位為官方沙箱 setup 開啟／鎖定工具目錄失敗。紀錄未帶底層 Windows error code；不能據此斷言是 ACL、其他程序持有 handle，或新版實作缺陷，也不能證明此次更新是唯一原因。此前紀錄包含 K 的舊 helper 對同一全域位置執行 refresh，不能排除历史設定交互影響。

官方文件 https://learn.chatgpt.com/docs/windows/windows-sandbox 說明可重新執行 elevated 設定，持續失敗則有較弱的 unelevated 暫時替代。此文件未確認本機特定 lock error 的修補方式。本輪未切換或弱化沙箱。

後續修復需先釐清開啟目錄所需 access 與底層錯誤，再決定最小權限修復；不能只因錯誤名稱含 lock 就宣稱另有程序占用。恢復可用需再驗證官方桌面實際模型回合與工具執行，尚未完成。

## 後續修復：同日 12:24，使用者要求透過 K 處理

### 實際修正與驗證

1. 以官方已安裝 CLI `0.159.0` 查詢，全域 home 的 readiness 為 `updateRequired`。該快取 codex.exe 與桌面套件 resources/codex.exe SHA-256 完全相同：`86E8EF1013F98DF51FDEEA446597F7E3CA32E454D1D4D8C0402A68B03C311D70`。
2. 既有留存官方 `0.155.0-alpha.16.4` 原始碼 `setup_provisioning.rs` 說明 ProvisionOnly 以 `READ_CONTROL | WRITE_DAC` 開目錄；SYSTEM 的現有 Modify ACL 不含 WRITE_DAC。這份來源是舊版，不能單靠來源宣稱新版相同，後續以實機成功／失敗差異佐證。
3. 備份 `.sandbox-bin` 的 owner／SDDL。只對該目錄的 SYSTEM 新增 ChangePermissions，不向子項繼承、不給沙箱使用者更多權限。首次 PowerShell Set-Acl 要求 SeSecurityPrivilege 而失敗，讀回證明未改動；改以僅 Access 區段的 DirectorySecurity／SetAccessControl 成功，不修改 owner 或 audit。
4. 首次官方 setupStart 因既有全域 `sandbox_mode="danger-full-access"` 回報 `only managed permission profiles can be enforced by the Windows sandbox`，尚未跑 provisioning。未改全域設定；只對此次 app-server 啟動傳入 `sandbox_mode="workspace-write"` 後，官方 `windowsSandbox/setupStart` elevated 模式成功，後續 readiness=`ready`。
5. `setup_error.json` 由官方流程清除；marker 從 0 bytes 成為 255 bytes。官方 setup 重套 ACL 後，`.sandbox-bin` SDDL 與修復前備份完全相同，臨時 SYSTEM 權限已不再保留。
6. 真正執行官方 `codex sandbox -P :workspace`，使用 `PAULUS\CodexSandboxOffline`：假工作區內寫入／讀回通過；寫入假工作區外的同輪測試檔被 UnauthorizedAccessException 拒絕，外部檔不存在；exit code 0。未呼叫模型、未讀訂閱憑證。

### 證據、檔案與限制

- `.runtime/codex-desktop-repair-20260930/`：ACL before／patched、原錯誤備份、readiness-before、setup-result、verification、check-setup.mjs 與 workspace/probe.ps1。全程未刪除既有資料。
- 文件更新：本檔及 `docs/development-log.md`；無 K 產品程式變更、部署或重啟。
- 全域既有 approval_policy=never、sandbox_mode=danger-full-access、windows.sandbox=elevated 的值未被切換。修復測試明確使用較嚴格的 workspace 沙箱，沒有以關閉沙箱繞過。
- 實測支持 SYSTEM 缺少目錄 WRITE_DAC 導致 provisioning 失敗的判讀。官方流程會再次移除此臨時權限，未修改官方程式，因此不能保證未來需要完整 provisioning 的更新不再復發。
- 已驗證官方原生沙箱可執行命令；未強制關閉使用者桌面程式、未在其對話送模型訊息。桌面可能需重新開啟以刷新失敗畫面，畫面及實際模型回合仍待使用者讀回。
