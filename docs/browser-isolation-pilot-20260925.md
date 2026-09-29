# 瀏覽器登入隔離試點：可信端工具入口與 Windows 反證（2026-09-25）

## 結論／交接狀態

**部分完成；不是可正式登入版本。** 新的 owner-side Playwright MCP 入口已實作並通過假資料驗證；新 Windows 測試帳號的檔案隔離成立，但程序記憶體隔離沒有通過。沒有將新入口接到正式 controller，也沒有啟用正式瀏覽器、重啟後端或接入任何真實帳號。

- 自動回歸：**344/344**（原有 340 加 4 個 gateway 測試）。這個數字不包含「Windows 隔離通過」的宣稱。
- 獨立 Windows 試點：**9/10 檢查通過，整體判定 failed**；`OpenProcess(PROCESS_VM_READ)` 對指定人類測試程序取得了 handle，不能假設換帳號就能保護後端記憶體。
- 測試帳號 `KAgentSandbox` 已停用並讀回 `Enabled=false`；沒有刪帳號、清資料或保存其密碼。

## 授權與實際系統影響

使用者本輪明確回覆「允許建立測試帳號與限定目錄的隔離試驗」。已補進 `AGENTS.md`。

本輪建立一個標準本機帳號 `KAgentSandbox`，SID 結尾 **1008**，加入內建 Users，不加入 Administrators；測試結束停用。只對本輪新建的以下 run 及子目錄設定 ACL：

`D:\K-harness\.runtime\isolation-pilot\ddd7a1e9-2b62-4e7d-b8a3-8f92ce67b592`

- `owner-private`：目前使用者、SYSTEM、Administrators FullControl；只有假 cookie、假人工 token、假可信程式標記檔。
- `tools`：上述管理主體 FullControl；測試帳號 ReadAndExecute。
- `workspace`：上述管理主體 FullControl；測試帳號 Modify。
- run 根目錄：測試帳號只讀／遍歷，不能改測試腳本、owner-private 或結果檔。

沒有修改既有 K workspace／其他專案／Windows 全域安全策略的權限；沒有安裝服務、登入啟動項、排程、套件，沒有搬用 Codex／Claude 憑證。測試帳號沒有既有憑證，未載入使用者 profile；子程序環境清空後只填系統環境及試點 TEMP／USERPROFILE。

第一次啟動因 Windows Description 長度限制在建立帳號前失敗：
`D:\K-harness\.runtime\isolation-pilot\a85e0e0e-7f3f-4f17-8e5d-6c41988c378a\result.json`。
修正描述長度後才跑上述完整試點。兩次資料都保留，未清理。

## 本輪程式修改

| 檔案 | 實際差異 |
| --- | --- |
| `src/browser-owner-gateway.mjs` | 新增供可信 K 程序持有的 MCP HTTP 入口；仍使用官方 Playwright `createConnection` 與現有檔案／接手限制，不重寫瀏覽器核心。 |
| `src/browser-live-session.mjs` | 增加 `publishDescriptor:false`，此模式不寫 `live.json`；人工 capability 僅回給同程序可信 caller。原有 stdio 假資料流程預設行為維持，不能把舊流程當作已安全。 |
| `test/browser-owner-gateway.test.mjs` | 新增四項匿名／AI authority、真實 Edge 同頁接手、HTTP 取消與重複 ID、profile 範圍回歸。 |
| `scripts/Invoke-KIsolationPilot.ps1` | 一次性 elevated 假資料試驗；既有同名帳號即拒絕，不重設未知帳密；隨機密碼只在記憶體；完成或失敗都停用本次建立帳號。 |
| `scripts/Test-KIsolationIdentity.ps1` | 真的在測試帳號下讀／寫／開程序 handle 與執行 git/node；拒絕項須為 ACCESS_DENIED，不以檔案不存在當通過。 |

### 新 gateway 的已驗證行為

1. CLI 只拿 `aiMcpServer`（HTTP MCP URL + AI token），沒有 profile 路徑、人工 token、browser launcher 或通用 CDP 入口。AI token 不能呼叫人工 `/action`；匿名 GET 不會取得 cookie。
2. profile 在 AI 檔案根目錄外。沿用工具檔案限制和 `browser_run_code_unsafe` 封鎖；根目錄不採用 native client 傳來的 workspace。
3. 用本機假網頁、真實 Edge 驗證：AI 讀頁，人工看到同頁快照並輸入假文字；人工接手後即使重新初始化 MCP，AI 仍被鎖住；交回後 AI 可以讀到剛才文字。沒有真實模型回合或額度消耗。
4. HTTP 工具回應未結束便斷線，轉入既有「先安全關閉再解除 busy」取消流程；相同 request ID 的第二個請求返回 409，不覆寫 SDK response map 或提前解除 busy。工具逾時亦走取消路徑，逾時分支尚未另外作真實等待驗證。
5. 新入口的人工控制方法只可由持有 gateway 物件的 K 程序呼叫。**這不是 OS 邊界**；若模型能讀同程序記憶體或改寫可信程式，仍不安全。

回歸證據：`D:\K-harness\.runtime\isolation-gateway-tests-20260925.txt`，344/344，0 skipped。Node 語法與兩支 PowerShell Parser 均通過。全套測試後沒有這次 probe／gateway 測試殘留程序。

## Windows 實測結果（不是模型驗收）

完整結果：

- `D:\K-harness\.runtime\isolation-pilot\ddd7a1e9-2b62-4e7d-b8a3-8f92ce67b592\result.json`
- 同目錄 `readback.json`：帳號停用、各目錄實際 ACL、正式開關讀回。

| 項目 | 結果 |
| --- | --- |
| 子程序 SID 確為新帳號，非人類 SID；不是管理員 | 通過 |
| 假 cookie／假人工 token 的檔案讀取 | ACCESS_DENIED，通過 |
| 修改 owner-private 的可信程式假檔 | ACCESS_DENIED，通過 |
| 指定 workspace 讀寫 | 通過 |
| node／git 執行 | v24.14.1／2.51.0.windows.1，通過 |
| 程序記憶體讀取權 | **失敗：取得人類測試程序的 VM_READ handle** |

沒有嘗試讀取真實記憶體內容。取得 VM_READ handle 已足夠否定這條簡單啟動路徑的保密承諾。可信 parent 在測試前後核對目標程序仍屬同一人類 SID；不是用目標退出／PID 不存在製造拒絕。

目前 owner PowerShell 與正式 K Node 的 DACL 讀回，都含一條登入工作階段 SID 的 `0x121411` 權限（包括 VM_READ）。查閱 [Microsoft CreateProcessWithLogonW 說明](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw) 與 [Codex 官方 desktop.rs](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/desktop.rs) 後，確認這個啟動 API 會使用呼叫端的 logon SID；Codex 原始碼也特別處理共用 logon SID 的權限問題。因此 **換 user SID 不等於建立新的 logon SID 邊界**，這與本次 VM_READ 反證相符。

證據限制：本輪沒有記錄子程序 TokenGroups，不能把本機完整存取檢查鏈宣稱已逐項追蹤；查閱的是官方 main 原始碼，不代表本機安裝版已具備相同實作，也不代表 Codex 的命令沙箱會自動保護 Claude 或 K。沒有修改任何既有程序 DACL／token／desktop 來讓測試勉強通過。

## 另外查到、正式接入前必須處理的邊界

1. **現行 desktop server 的人工 session 發放**：`GET /` 仍會向任何 loopback caller 發 cookie，可拿來呼叫核准／人工 browser action。新 gateway 沒有這條路，但舊 desktop route 本輪尚未變更。只擋跨站 Origin 不會擋同機低權 shell；須與可信桌面啟動入口一起改，不能只藏 URL。
2. **可信部署不能等於 AI 可改的 checkout**：現行 launcher 直接執行 `D:\K-harness` 原始碼；若把同一樹給低權模型修改，人工重啟可能執行其改動。正式 source/launcher 的不可寫部署與人工 review/promote 尚未設計完成，不更動現有部署 ACL。
3. **所有代理執行路徑須一起處理**：Codex、Claude 以及 Luna 工人目前仍由人類身分啟動。不能只改主 Claude 入口，卻把同身分工人留成旁路。這輪未改 provider spawn、不影響現有訂閱登入。

## 下一輪交接順序

1. 先複查本輪反證與 gateway 的 capability／取消邊界；**不要啟用** `.runtime/browser-mcp.json`，不要在試點登入真帳號。
2. 沿用成熟 Windows 程序隔離機制評估，先解開「換 user SID 卻仍共用 logon SID」問題。下一候選可比較 `LogonUser` 取得獨立登入 token 後再啟動，與完整 restricted-token runner；需先列明必要權限、desktop 與啟動條件，不擅自新增服務或調整全域政策。下輪先讀回雙方 TokenLogonSid，再測 VM_READ；private desktop 防護不等於程序記憶體防護，不以單換帳號或單加 desktop 宣稱成功。
3. 設計並驗證 desktop 人工 bootstrap、唯讀可信部署及所有 CLI/工人的低權執行接線，再提出正式目錄、權限、啟動方式與復原方式供使用者確認。
4. OS 及控制入口都過後，才進行兩家官方 CLI 各自登入和真實模型驗收；不複製原帳號登入檔、不改 API 計費。

本試點腳本刻意拒絕已存在的 `KAgentSandbox`。後續不得為了重跑而刪除帳號或重設未知帳密；若重用本次已停用帳號，須核對 SID／本次紀錄並明確設計限定復用流程，不能直接繞過防護。

## 正式環境

讀回 `.runtime/browser-mcp.json` 不存在；正式 backend PID **3084**，啟動於 **2026-09-25 12:25:23 +08:00**，這輪未重啟。新 gateway 只在 isolated tests 使用，尚未取代原有 stdio/browser-live-proxy。沒有宣稱日常右側 UI 已使用新隔離。

## 官方來源（本輪查閱；用於下一步，不是本輪 OS 成功證據）

- [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)：原生 sandbox 也不是單純更換使用者名稱。
- [Codex 開源 token 實作](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/token.rs)：restricted token、default DACL 等現成做法；本輪尚未直接整合。
- [Codex 開源 desktop 實作](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/desktop.rs)：明確記錄 `CreateProcessWithLogonW` 會共用呼叫端 logon SID；desktop ACL 管理權改按 owner user SID 給予，不能只按共用 logon SID。
- [Microsoft CreateProcessWithLogonW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw)：啟動與 logon SID／profile 語意。
- [Microsoft CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)：Windows 原生 token 限制機制。
