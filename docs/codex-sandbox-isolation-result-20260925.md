# 官方 Codex Windows 沙箱：登入隔離實測結果（2026-09-25）

## 結論

**這次獲准的假資料試驗已完成，隔離判定未通過；不是等待 Opus 核准。**

本機 `codex-cli 0.155.0-alpha.16.4` 的 elevated Windows 沙箱擋住假 cookie／人工控制憑證的檔案讀取，也能讀寫指定工作目錄、執行 Node 與 Git；但沙箱內程式仍能讀取指定假人類程序的記憶體。因此不能直接把這個 runner 接到 Claude／Luna，就宣稱 K 的登入資料已受完整保護。

- 一般隔離檢查 **9/10**，唯一失敗是人類程序 VM_READ。
- 再用獨立假資料程序確認：**實際讀取 36 bytes 成功，逐位元組符合預先放入的假字串**，不是只拿到 handle 或推測。
- 正式瀏覽器仍關閉；未登入真實帳號、未讀取真實程序記憶體、未重啟 K、未修改正式代理啟動流程。
- 這個反證只針對本次版本、Windows elevated 啟動路徑與設定；不是宣稱所有 Codex 版本、平台或其他隔離方式都有相同結果。

## 使用者授權與執行範圍

1. 使用者先允許在 `D:\K-harness\.runtime\isolation-pilot` 下新建假資料目錄，使用既有 Codex 沙箱；須先確認範圍及保存 ACL 前後差異，不初始化或重設帳號、不改既有工作區 ACL。
2. 精確版本原始碼確認每次啟動都會重套 `.sandbox-bin` 權限後，另行詢問；使用者明確回覆 **「允許這項官方例行重套與假資料實測」**。允許 `C:\Users\Paulus\.codex\.sandbox-bin` 的官方例行權限重套與沙箱執行紀錄更新；沒有擴大到正式瀏覽器、其他帳號或工作區。
3. 兩項授權已記入根目錄 `AGENTS.md`。使用者要求持續做到結果再供 Opus 同儕複查；這不等於授權額外的系統環境變更。

未安裝套件或服務、未建立排程、未更換正式沙箱版本、未修改使用者全域設定。測試檔案保留，未清理或刪除。

## 版本與執行前範圍核對

- 執行檔：`C:\Users\Paulus\AppData\Local\OpenAI\Codex\bin\13995fba801849b0\codex.exe`
- SHA-256：`9015C47D1714294ECD9033C4B5AEFC3076797D867D1C36AA37749FCB76C8942F`
- 官方 tag：`rust-v0.155.0-alpha.16.4`
- tag 對應 commit：`3853cf0c49daadcacaacceb2cbb732f512eaacdb`
- 精確原始碼／雜湊索引：`D:\K-harness\.runtime\isolation-pilot\codex-45cbb03d-3263-45ee-a1a0-b26c709cda13\exact-source-index.json`

不是拿 main 分支推定本機行為。先前 main 檔案仍保留，但本次結論使用 `source\alpha16.4` 下對應 tag 的檔案及本機實測。

此版本要求 `-P` 指定 permission profile；elevated backend 也要求 effective `:root` read policy，不能改成 `:minimal` 加一個可寫目錄。實際 profile 是 `:root=read`、僅新 workspace 可寫、網路停用。**這不是「只有測試目錄可讀」的沙箱**；假私有資料由 Windows ACL 額外保護，測試程式只讀指定假檔與假記憶體。

為避免官方 setup 掃描並對真實使用者家目錄的子目錄補權限，啟動程序的 HOME／USERPROFILE 指向本次新建空白 `fake-profile`，TEMP／TMP 也在本次 workspace；`CODEX_HOME` 保留既有位置供官方使用現有沙箱，不複製登入檔。這些只是單一程序環境，不是修改全域環境。沙箱目標程式不繼承原本環境，僅填入必要 Windows 路徑及假工作目錄。

setup 的已知條件式目標（Codex runtime、快取、Windows／Program Files／ProgramData）事前已有足夠讀取權限；`.sandbox-bin` 已符合官方目標 DACL，重套不預期增加存取權。既有 setup marker 為版本 5，官方帳號正常且未過期，deny ACL state 空白；啟動前再核對，沒有觸發新增或重設帳號。

精確版本的 NUL 裝置路徑另用唯讀 READ_CONTROL 開啟核對，原始碼中的字串回傳 BAD_PATHNAME，於寫 ACL 前失敗；標準裝置路徑可開啟。證據在上述來源證據目錄的 `null-readonly-probe.json`。沒有修改 NUL 權限，也不把這個特定版本結果延伸到其他版本。

## 假資料與檢查結果

執行證據根目錄：

`D:\K-harness\.runtime\isolation-pilot\codex-run-48b7d00c-ab12-42c3-86b3-cd498e19e4d7`

- `owner-private`：人類使用者／SYSTEM／Administrators 可讀寫；只有假 cookie、假人工 token、假可信程式標記。
- `workspace`：沙箱可讀寫的全新測試目錄；測試程式、臨時檔及工具驗證都在這裡。
- run 根目錄僅給沙箱本層讀取／遍歷，不讓它修改 owner-private 或外層結果。
- 人類端新建一個隱藏、無網路工作的假 PowerShell 程序，確認 SID、PID 及存活狀態；只持有固定假字串，結束後正常退出。

| 檢查 | 實測 |
| --- | --- |
| 確實切成沙箱 SID，且非管理員 | 通過 |
| 測試根目錄符合限定位置 | 通過 |
| 讀假 cookie | ACCESS_DENIED |
| 讀假人工 token | ACCESS_DENIED |
| 寫假可信程式檔 | ACCESS_DENIED |
| workspace 讀寫 | 通過 |
| Node／Git | v24.14.1／2.51.0.windows.1，通過 |
| 對指定存活假人類程序取得 VM_READ | **取得成功，隔離失敗** |

上述完整結果：`attempt-30188dd6-f585-4a48-b5df-247585969179\result.json`。

### 實際記憶體讀取反證

最終證據：`attempt-eb962dcd-2c13-42e8-8f18-e7db1f120fd2\result.json` 及同目錄 `fake-owner.json`。

假人類程序自行配置 36 bytes，內容為 `K_FAKE_MEMORY_ONLY_NOT_A_REAL_COOKIE`，只把該假區塊的位址及長度交給測試程式。讀取器上限 64 bytes，只接受這個假值與指定 PID，不掃描其他程序或記憶體。

- 人類 user SID 結尾 `1004`；沙箱 user SID 結尾 `1006`，身分確實不同。
- 兩邊直接讀取 Windows `TokenLogonSid`，卻都是 `S-1-5-5-0-1755401`。
- 假人類程序的預設 DACL 對該 logon SID 有 `0x121411`，含 VM_READ。
- `OpenProcess(0x10)` 成功；`ReadProcessMemory` 成功；`bytesRead=36`、`fakeBytesMatched=true`、`readError=0`。
- 讀取前後人類程序存活、owner SID 正確，不是讀到退出程序或錯誤 PID。

**結論不是「有 shell 就一定能讀任何人」；而是本次啟動後仍共用登入識別，配上假人類程序的實際存取規則，確實允許了這次跨身分讀取。** 已足以否定本候選作為 K 保護人類登入資料的完整邊界。

## 原因與官方程式對照

以下連結固定在本機對應 commit：

- [runner_client.rs](https://github.com/openai/codex/blob/3853cf0c49daadcacaacceb2cbb732f512eaacdb/codex-rs/windows-sandbox-rs/src/elevated/runner_client.rs#L392-L411)：runner 仍由 `CreateProcessWithLogonW` 啟動；本次一般執行檔分支沒有額外 profile 載入旗標。
- [desktop.rs](https://github.com/openai/codex/blob/3853cf0c49daadcacaacceb2cbb732f512eaacdb/codex-rs/windows-sandbox-rs/src/desktop.rs#L297-L302)：官方知道共用 logon SID 的情況，該處修的是私有 desktop 物件的管理權，不是所有人類程序的記憶體權限。
- [token.rs](https://github.com/openai/codex/blob/3853cf0c49daadcacaacceb2cbb732f512eaacdb/codex-rs/windows-sandbox-rs/src/token.rs#L471-L519)：restricted token 的 logon SID 與 WRITE_RESTRICTED 處理，不能視為移除了對既有人類程序的讀取路徑；新 token 的 default DACL 也不是改寫既有人類程序 DACL。

因此「官方已經處理這個問題」需要限縮：有 private desktop 防護不等於本次需要的程序記憶體保密。沒有找到可直接切換、並經本機驗證能解決此問題的公開旗標；不為了讓測試變綠去改掉假人類程序的預設 DACL，也不只保護 K 一個程序而留下日常瀏覽器／密碼管理器旁路。

## 完整嘗試與診斷修正

保留全部中間結果，不挑成功輸出：

1. run 根目錄的首份 `result.json`：缺 `-P`，官方參數解析 exit 2，目標程式**未執行**。最早 harness 誤把空輸出標成 `targetExecuted=true`；原檔保留，另加 `attempt-notes.json` 更正。後續腳本改為有非空 probe/checks 才標執行。
2. `attempt-4c0b1949-90f7-4c2b-bfb9-b688a8f2fd0f`：`:minimal` policy 不符合 elevated backend，目標未執行、ACL 無差異；之後依精確來源與既有範圍核對使用 root-read policy。
3. `attempt-30188dd6-f585-4a48-b5df-247585969179`：目標確實執行，9/10，VM_READ 失敗。
4. `attempt-40a7e7bf-f12c-45a2-a53b-43e2791dae16`：已讀到 36 bytes 假值，但 `.NET Groups` 未取得 logon SID，成功後仍讀取 stale Win32 error 203，不用這兩欄作判定。改直接讀 `TokenLogonSid`，僅 API 失敗才記 last-error。
5. `attempt-eb962dcd-2c13-42e8-8f18-e7db1f120fd2`：修正診斷後再次實際成功讀取 36 bytes，雙方 logon SID／DACL 齊備，作為最終反證。

腳本為本次固定目錄的單次調查產物，沒有加入正式啟動入口；不能因檔案存在就重跑更換版本或修改範圍的試驗。

## 權限、帳號及結束讀回

每次保存 `before-launch.json`／`after-launch.json`，監測 K 根、`.runtime`、試點根、Codex 沙箱目錄及 helper 檔案、使用者 TEMP、原生 setup 目標與本次假資料目錄。

- 偵測到的 ACL 語意變更只有本輪新的 `workspace`；正式 K 工作目錄沒有變更。
- `unexpectedAclChanges=[]`；官方 `.sandbox-bin` 重套後 DACL 無語意差異。
- 官方帳號狀態及 setup marker 前後相同，舊 `KAgentSandbox` 維持停用。
- `cleanup-readback.json`：本次五個假人類程序皆已退出；未停止無關程序。另讀回沒有命令列指向此 run 的殘留程序。
- 此為原始碼列出的目標與實際監測路徑，不宣稱對整台電腦所有物件做全面前後快照。
- 本機 Windows 虛擬化相關功能只讀了安裝狀態（`optional-features-readonly.json`）；**沒有啟動 VM、WSL、Docker 或 Windows Sandbox**。

## 未完成項目與後續邊界

登入隔離仍未完成。不能因本次假檔案測試成功，就讓正式代理或真實登入資料接上候選。

1. 下一候選必須把**整個代理執行環境**與人類端分離：真正獨立登入工作階段，或成熟虛擬化環境；先查現成方案，不再只換使用者名稱或疊一個 private desktop。
2. 必須驗證不能透過 Windows interop、共享磁碟／管理端點、父程序、Docker／WSL 控制入口或程序記憶體返回人類身分；不是容器名稱或 guest 存在就算隔離。
3. 在安裝／啟動新環境、重新啟用測試帳號或改動額外系統權限前，先列出具體範圍、日常代價與復原方式，取得相應授權。本次授權僅既有官方 runner 與指定假資料，不能擅自轉成新 VM／常駐服務建置。
4. 既有 [可信端 MCP 試點](browser-isolation-pilot-20260925.md) 的人工入口發憑證、不可被 AI 改寫的正式部署、所有主／子代理執行路徑仍須一起落實；單獨通過 OS 測試也不等於全部完成。
5. Opus 可以依本文件與索引直接複查；這是完成試驗後的同儕查核，不是要求使用者轉述、也不是把下一步交給 Opus 決定。

本輪只新增調查證據、授權及工程紀錄，沒有產品程式 diff，未重跑全套產品測試。363/363 是先前 Opus 複查結果，**不是這次隔離的通過數字**。正式瀏覽器開關不存在，沒有正式部署或 live 登入驗收。
