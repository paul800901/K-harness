# Sandboxie Plus 隔離候選與假資料試驗（2026-09-25）

## 狀態

**本輪假資料試點完成：記憶體、指定檔案與單一受限通訊通道通過；臨時服務／驅動已解除安裝。** 不是正式接入或真實登入驗收。使用者已授權下載／安裝必要元件、限定假資料試驗及完成後解除安裝未採用元件。正式瀏覽器保持關閉，不碰真實登入。

## 為何選這個候選

上一輪官方 Codex Windows 沙箱實際讀到假人類程序的記憶體，故不能直接拿來包住 Claude／Luna。Sandboxie Plus 是現成的開源 Windows 程式沙箱，官方安全清單曾針對同類 host-process memory read 問題修正。這只是選擇下一候選的依據，不是本機通過證明。[官方安全紀錄](https://github.com/sandboxie-plus/Sandboxie/blob/master/SECURITY.md)

官方也說明：普通沙箱預設可讀大部分宿主檔案；唯讀並不代表 cookie 無法外洩。Privacy／Security Enhanced 模式需要證書，本輪不購買或申請。第一階段先檢查基本程序隔離及明確封鎖的假資料，不能冒稱已完成預設拒絕所有個資的正式部署。[官方 FAQ](https://sandboxie-plus.github.io/sandboxie-docs/Content/FrequentlyAskedQuestions/) · [功能與授權](https://sandboxie-plus.com/feature-comparison/)

使用本次官方穩定版 `v1.18.4`，來源 commit `487d56309fafe90e2771d4c9004333fe01b77094`。下載後必須同時符合 GitHub release SHA-256 及 Windows 有效 Authenticode 簽章，未通過不執行。

## 本機條件（本輪唯讀）

- Windows 11 專業版，build 26200，約 63.9 GiB RAM。
- 未找到 Sandboxie 服務、標準安裝檔位置及驅動登記。
- VirtualMachinePlatform 為 enabled；Hyper-V、Windows Sandbox、WSL optional feature 顯示 disabled。另有 WslService，故不據此斷言整台沒有任何 WSL 元件。
- `HypervisorPresent=false`、`VirtualizationFirmwareEnabled=false`；不把「記憶體夠」當成虛擬機已能直接用，也不擅自改 BIOS、Windows 功能或重開機。
- OptionalFeature 的 1／2 分別為 enabled／disabled，依 [Microsoft 定義](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-optionalfeature)。

證據目錄：`D:\K-harness\.runtime\isolation-pilot\sandboxie-assessment-173cf592-cd76-47f8-a6ae-e69541d35d31`，含 `host-readback.json`、官方 release 資料與安裝原始碼。

## 授權與安裝原則

使用者明確授權安裝與限定假資料試驗，並要求事後把不需要的元件解除安裝還原。記入 `AGENTS.md`。

優先使用官方 installer 的可攜模式，檔案放本次試驗目錄，僅臨時登記必要驅動／服務；按需啟動、不加 UI 登入自啟，不安裝 ImDisk、擴充套件或額外更新器。即使叫「可攜版」，啟用隔離仍需要系統驅動與管理員確認，不宣稱完全不影響系統。所有更動先記錄既有狀態，遇到既有 Sandboxie 登記即停止以免接管其他安裝。

不要求改 BIOS、不重新啟用 KAgentSandbox、不更改舊工作區 ACL、不讀舊 profile、現有 API key 或 provider 登入檔。付費功能若成必要條件，另行確認，不用修改程式或設定去繞過授權限制。

## 最小實測範圍

1. 宿主啟動只持有固定假字串的新程序。盒內程式對該存活程序請求 VM_READ、讀取已知假位址；須明確拒絕，不能拿程序不存在當成功。拒絕可以發生在取得 handle 或實際讀取時，不把 Windows 回傳一個已剝除讀取權限的 handle 誤當成可讀。
2. 建立正常人類權限可讀的假 cookie／人工 token。對照普通盒與明確封鎖規則，確認檔案確實存在而後者被拒；不以原本 Windows ACL 已拒絕掩蓋沙箱規則未生效。
3. 沙箱允許的新 workspace 能讀寫，Node／Git 能執行，子程序仍在盒內。不能犧牲所有功能來換取「什麼都不能做」的假通過。
4. 只檢查本次新建資源及假資料；不對真實 cookie、Windows 憑證管理員、其他程式記憶體做探測。
5. 保留結果、錯誤與有效設定。未採用的驅動／服務用官方工具停止及移除；檔案依回收筒規則處理，讀回剩餘項目後才回報還原。

## 正式接線仍必須做的事

就算本輪通過，仍須接入所有模型／工具子程序，而非只隔離一個主代理。K／Playwright／人工憑證留在可信端，只給 AI 受限 MCP 權限；要擋住 HTTP 人工 session 發放旁路，並分開 AI 可修改的工作區與正式啟動程式。不能為相容性任意加入讀外部程序記憶體、host 直接執行或個資路徑例外。[ReadIpcPath 官方語意](https://sandboxie-plus.github.io/sandboxie-docs/Content/ReadIpcPath/)

日常使用的代價仍需驗證：兩家 CLI 在盒內登入／持續保存、stdio 串流、MCP、取消、檔案實際寫回與原生沙箱相容；不能由基本假資料測試推定全部通過。Opus 的角色是讀取專案紀錄同儕複查，不是此工程流程的核准者。

## 本輪實際結果

### 官方元件與臨時安裝

- 安裝檔 SHA-256：`cfceda1b1a63abcd2b3e5fbfdc4895f15db56316f5a9f2f06aea230e209b120e`，符合官方 release digest；Authenticode Valid，簽署者 NOVASYNC LABS PTE. LTD.。
- 核心驅動 `SbieDrv.sys` 為 Microsoft Windows Hardware Compatibility Publisher 有效簽章；檔案版本 5.73.2。套件其他核心 EXE／DLL 為 5.73.4；如實記錄套件內差異，不修改檔案。
- 官方 `/PORTABLE=1 /CURRENTUSER` 解出檔案；20:27 經正常 UAC 以官方 KmdUtil 登記 SbieDrv／SbieSvc，**兩者都是 Manual**，非開機自啟。實際 IniPath 指向本次 portable 目錄。
- 未安裝 ImDisk、未啟動管理介面、未購買／申請證書，未修改 Windows 安全設定。
- 證據：`installer-verification.json`、`portable-verification.json`、`extract-result.json`、`before-system.json`、`install-system-result.json`。

### 同一個存活假程序的對照（v3）

| 測試 | 實際結果 |
| --- | --- |
| 沙箱外對照 | 同一假位址，兩種讀取 API 都讀回 36 bytes 固定假字串，handle granted access = 16 |
| 普通盒 | 記憶體讀取被拒；假檔案仍可讀，證明預設盒**不是**個資保護模式 |
| 限制盒 | 記憶體讀取被拒；兩個假檔案都明確 access denied；子 PowerShell 也被拒 |
| 工作能力 | workspace JSON 寫入與讀回、Node v24.14.1、Git 2.51.0 均成功 |

盒內 `OpenProcess(0x10)` 會回傳 handle，但 `NtQueryObject` 讀回 granted access 為 **0**。`ReadProcessMemory` 回 Win32 5／0 bytes；`NtReadVirtualMemory` 回 `0xC0000022`／0 bytes，沒有取得 marker。使用者 SID 與 logon SID 和宿主相同，所以不是靠換 SID 的檔案 ACL 假裝達到隔離。盒內 SbieDll 載入狀態為 true。

精確 v1.18.4 [obj_flt.c](https://github.com/sandboxie-plus/Sandboxie/blob/v1.18.4/Sandboxie/core/drv/obj_flt.c) 的核心 handle callback 與 [thread.c](https://github.com/sandboxie-plus/Sandboxie/blob/v1.18.4/Sandboxie/core/drv/thread.c) 權限篩選符合這個現象。全域未覆寫 EnableObjectFiltering（該版預設 true）；盒未設定 DisableObjectFilter。這是固定假資料/API 路徑的實測與原始碼核對，**不是所有攻擊手法或核心漏洞皆無法繞過的證明**；未做 direct-syscall、惡意核心驅動或真程序測試。

證據：`pilot-results-v3.json` 與 `workspace/*-v3.json`；假 owner 正常結束，exit 0。

### 保留的失敗／反證

- v1 測試過度要求 OpenProcess 必須失敗，將「handle 成功但讀取被拒」判成失敗。修正測試語意並增加 handle 權限與 native read 證據，沒有放寬產品保護設定。v1 原稿與結果保留。
- v2 的 NtQueryObject 結構大小錯寫 64；Windows 回 STATUS_INFO_LENGTH_MISMATCH，該次未進行沙箱讀取。更正為 56，v2 結果保留。
- 直接以 Start.exe 包裹 stdio **失敗**：假 Node 確實啟動，但外側收不到 stdin/stdout/stderr，child 自行逾時退出。不能直接把它插到 K 現有 spawn 後就宣稱可用。證據：`stdio-result.json`。
- 一次性測試設定複製了工具自動新增的 UserSettings 段，導致 OpenPipePath 放錯段；有效設定讀回發現後修正，只更動本次假盒，原檔留存。這也說明要讀回有效設定，不能只看寫檔成功。

### 通訊與解除安裝

因直接包裝 Start.exe 的 stdio 不通，使用**僅供這次測試的 named pipe** 轉接：Sandboxie 只放行 `\Device\NamedPipe\KIsolationPilot173cf592`，沒有開啟所有 IPC、host memory 或網路。盒內 Node 只啟動固定假 child，不接受通用任意命令。

- 10 項通訊檢查全部通過：繁體中文 ping/pong、stderr、child exit 7、Start.exe exit 7、正常關閉皆讀回；無逾時。
- 同一個 child 嘗試讀取指定假 cookie 仍回 `EPERM`，不是為了通訊而移除檔案限制。
- 這是技術可行性原型，**不是已經把 Claude／Codex／Luna 包進盒內**。尚未驗證模型登入、MCP／網路端點、取消整棵程序樹、重連及實際並行。
- 證據：`named-pipe-result.json`、`ipc-config-readback.json`、`pilot-Sandboxie-with-ipc.ini`、三支 pipe 測試原稿。子代理提供初稿，Astra 獨立檢查並修正訊息轉送與判定條件後才實跑，沒有將靜態解析當成通過。

20:39 以官方工具依序停止／解除登記 SbieSvc、SbieDrv；四個操作 exit 0，services、driver、EventLog source 登記皆不存在。新建三個假盒已先結束，讀回沒有 Sandboxie 背景程序。不清除 Windows 的正常安全與安裝事件紀錄。

20:40 將本次 `portable`、`boxes`、安裝 EXE **移入 D 槽資源回收筒**。逐項核對原路徑已不存在、回收 metadata 含完整原路徑、相對應回收 payload 仍存在；未永久刪除，未清空回收筒。小型假資料、測試腳本、原始碼核對副本、結果與文件保留供複查；沒有清理其他輪次或其他人的安裝。

最終讀回：K 工作區及試驗根目錄 ACL 和安裝前相同；`KAgentSandbox` 仍停用；正式 browser 開關仍不存在；Windows 的 Sandboxie.ini、使用者標準 Sandboxie 設定目錄未新增。證據為 `end-pilot-boxes.json`、`remove-system-result.json`、`after-system.json`、`recycle-results.json`。這是回到未登記／未常駐的狀態，不宣稱作業系統每個位元或稽核紀錄完全回到原樣。

## 本輪判定與下一步

**採納為下一階段接入候選，不宣稱真實登入已安全上線。** 相較前兩輪，這次對同 SID／同 logon SID 的固定假記憶體讀取有明確拒絕，檔案限制與通訊也能共存。試點使用普通盒和指定路徑規則，沒有靠付費功能；完整預設拒絕隱私策略與商用授權條件需在正式採用前另行核對。

接下來的最小完整工作是：把這個通訊方式接到**所有實際代理啟動入口**、分離可信啟動程式與 AI 可寫工作區、保護人類 HTTP session 的發放入口、限制被傳入的環境變數及機密路徑，再以假資料跑取消／重連／雙對話驗收。只保護一個示範程序或一個假資料夾並不等於整台個資已隔離。需要人工重新登入時明確交給使用者，不能複製既有憑證或代為登入。

本輪只改專案規則／文件及 git 排除的試驗內容，未改正式產品執行程式、未重啟 K；未重跑產品全套測試，也不挪用上一輪 363/363 當作這輪 Sandboxie 驗收數字。若下一階段正式採用 Sandboxie，它會成為必要執行依賴，不能一面要求持續隔離一面移除驅動；本輪依使用者清理要求已移除臨時登記，後續不能誤以為服務仍在運作。
