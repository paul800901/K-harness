# UI parity 安全範圍補充

日期：2026-09-24

## Claude Code 專案檔案規則

`.claude/settings.json` 僅設定 `permissions.deny`，拒絕 Claude Code 的 `Read` 與 `Edit` 工具存取任何層級、名稱為 `.env.local` 的檔案。規則使用官方文件中的 `Read(*.env)` basename glob 寫法並套用到完整 `.env.local` 副檔名；此寫法可涵蓋測試用的巢狀假檔。官方說明：拒絕規則優先於詢問及允許規則；Read/Edit 路徑模式依據 settings 所在專案目錄解析。[Claude Code permissions](https://code.claude.com/docs/en/permissions)

驗收只使用 `.runtime/ui-parity-20260924/security/fake-workspace/.env.local` 的假值，不以專案根目錄真 `.env.local` 作測試。Claude Code CLI 實測結果及原始輸出保存在 `.runtime/ui-parity-20260924/security/claude-deny-test.txt`。

**殘餘風險與更正**：此 deny 不是作業系統沙箱，但不能概括為「不阻止 Bash」。本次原生紀錄中，建立 `probe.env.local` 的命令已被 `permission-rule` 拒絕；Claude Code 也會對可辨識的命令與重導向套用檔案規則。因此不能把這次拒絕直接歸因為 Auto 判斷。此規則不代表 Codex 主代理或 Luna 具有同等防護，也不宣稱覆蓋所有命令或間接讀檔方式；工作區寫入沙箱不代表禁止讀取。金鑰仍在工作區的既有 `.env.local`，本輪未移動或讀取它。

## 工作者檔案路徑限制

`src/files.mjs` 在解析輸入路徑後，額外以 `realpath` 結果比對專案憑證檔路徑；即使前段詞法檢查漏過別名，也會在讀寫前拒絕實際解析為憑證檔的目標。

路徑驗證與稍後開啟檔案之間仍存在時間差（TOCTOU）。此工具不是作業系統層級沙箱，也不宣稱能抵禦所有並行檔案系統變更；本輪依規格只記錄限制，沒有改變其檔案開啟策略。

## 桌面啟動器健康檢查

啟動器解析 `/health` 的 `workspace` JSON 字串，去除路徑兩端的尾端分隔符後，以 Windows 不區分大小寫的完整路徑比較。這接受正式服務回傳的 `D:\K-harness\`，但拒絕 `D:\K-harness-alt` 與 `D:\K-harness\subdir\`。唯讀讀回及隔離 DLL 驗證結果在 `.runtime/ui-parity-20260924/security/launcher-live-health-response.txt`、`launcher-healthfix-build.txt` 與 `launcher-healthfix-tests.txt`；沒有部署啟動器或重啟後端。

## Claude 登入狀態檢查快取

`inspectClaude` 對已確認的 Claude.ai 訂閱、版本與登入狀態快取最多 5 分鐘，快取鍵為 CLI `commandSpec` 與工作目錄。每次檢查仍重新讀取有效 Claude 設定並拒絕 API／雲端供應商認證覆寫；只有成功驗證的結果會進快取。官方登入開始、完成、取消或關閉時會立即失效快取；不存在官方登出操作的主動通知，因此若在 K 之外登出，舊登入狀態最久可能保留至 TTL 到期。

定向回歸：`node --test test/claude-inspection-cache.test.mjs test/claude-login.test.mjs`，4/4 通過。該測試以假 CLI 和臨時使用者設定目錄驗證快取期限、provider override 即時檢查、失敗不快取及登入流程失效。
