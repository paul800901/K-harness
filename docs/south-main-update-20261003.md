# 南區下載新版、Gemini 啟用與正式讀回（2026-10-03）

## 結果

南區正式 K 已由 `ad1fa984329a22e624cd41de1391d71cbcd017a9` 更新至 GitHub main 的 **`0ae4be15ddab38251a89e5f3a5c74097fa19b2aa`**，15:03 由原入口重開，正式版本、視窗、健康狀態與前端資產讀回成功。不是只下載來源，也不是以東區的驗證取代本機實測。

本輪沒有修改產品程式、推送 GitHub、建立或移動 tag；新增本紀錄並更新工程索引。Gemini 圖片／瀏覽器等額外能力未擴張。

## 來源與範圍

- 使用者要求查 Git 新增內容、下載並弄好；後續明確回覆「安裝阿 但我不是早安裝好了?」，允許補官方 Antigravity CLI 與限定假資料測試。
- 維護來源 `C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness` 的 `codex/r3-2` 由 `e80cd03` 快轉至上述 main，59 個檔案有差異。原有 `browser-extension/extension-protocol.cjs` 換行差異保留，快轉前後檔案雜湊相同。
- `D:\K-harness` 根目錄仍是含未合併實驗的舊工作樹；沒有 reset、clean 或整批覆寫。正式更新只交換既有 runtime、啟動器與入口，另將本紀錄及索引入口存回根目錄，方便後續查找。
- 新版包含東區 Windows 聽寫選項、訂閱登入與品牌修正、子代理權限／檔案核准修正、Gemini 主代理及 Flash 子代理、帳號與額度查詢修正。南區本機設定沒有改用 Windows 聽寫，仍沿用原 Whisper Python／模型。
- 安裝器相依清單／lock 與原正式版只差 Windows 換行；複製原已安裝相依至全新候選，未執行 npm 安裝或升級。候選從指定 Git commit 匯出後重新建置 UI、擴充及啟動器；前端只有本次 3 個資產，未夾帶歷史建置。

## Antigravity：桌面版與命令列元件分開確認

最初只查命令列入口就說未安裝，說明不精確，已向使用者更正。這台原本確實有 **Antigravity 桌面版 2.19.1**，位於 `C:\Users\Paulus\AppData\Local\Programs\antigravity`；官方 `agy` 預設位置與 PATH 則沒有命令列元件，桌面程式目錄內也未找到 `agy.exe`。

依 [Google 官方安裝說明](https://antigravity.google/docs/cli/install/) 及其 Windows 安裝腳本提供的 manifest，取得 **agy 1.2.16**，核對官方 SHA-512 與有效 Google LLC 數位簽章，放入 `C:\Users\Paulus\AppData\Local\agy\bin\agy.exe`，實際 `--version` 成功。沒有重裝或修改桌面版，沒有修改 PATH、shell 別名、全域模型設定或 API 計費。

本輪只放置官方可執行檔，不執行含永久清除暫存動作的整支安裝腳本；下載檔及官方 manifest 留存。K 以既有完整路徑接法呼叫。官方程式自動沿用本 Windows 使用者既有登入，`/usage` 確認已登入，未要求重登、讀取／搬移憑證或登入東區帳號。K 專用 profile 只是設定與工作紀錄分開，**不宣稱 Windows 帳號認證因此隔離**。

## 本機驗證

證據根目錄：`D:\K-harness\.runtime\south-update-20261003`。

| 驗證 | 結果 | 證據 |
| --- | --- | --- |
| 完整程式測試 | **578/578**，失敗／取消／跳過 0，35,660 ms | `full-tests.log` |
| UI／擴充／啟動器建置 | 成功 | `build-ui.log`、`build-extension.log`、`build-launcher.log` |
| 模型／權限／帳號與額度假資料 UI | PASS，18 個模型 fixture、4 次假開啟請求，無真模型回合 | `model-picker-ui.log` |
| 訂閱登入設定 UI | PASS；兩家登入、刷新、取消與共用新對話入口 | `subscription-ui.log` |
| 真 agy 原生權限 probe | **8/8 PASS，8 次 Flash-low**；唯讀可讀、寫檔／指令拒絕、工作區內寫入、工作區外與 TEMP 拒絕、完整存取寫入、8 秒取消及程序樹無殘留 | `gemini-permission-probe.log` |
| 真 Gemini 主代理 | **2/2**；唯讀讀取隨機假檔，關閉控制器後以原生對話接續並回憶標記 | `gemini-main-readback.json` |
| Whisper 舊功能回歸 | **6 項 PASS**；假音訊經真本機 Whisper 填回原草稿、停止不送出、取消保稿、錯誤保稿、重開仍免 K 額外同意 | `whisper-ui.log` |
| 候選與正式程式的真帳號 UI | 兩次均 PASS；三家已連線、Gemini 原生額度、側欄、4 組 Gemini 模型可見；無建立正式對話或送出模型回合 | `candidate-ui-readback.json`、`live-ui-readback.json` |

權限 probe 使用原版 8 個檢查，只在一次性工程副本把最後的永久刪除改為 Windows 資源回收筒；確認回收呼叫成功、原路徑消失。沒有改寫任何權限規則、放寬拒絕條件、失敗換模或重送。另兩次主代理回合使用新建假資料目錄，原始驗證資料保留；本輪共 **10 次 Gemini 測試回合**，帳號／模型目錄查詢不計為模型回合。

工程殼使用正式服務與實際建置 UI，以隱藏視窗讀回，不搶前景；沒有攔截成假帳號結果，也沒有擷取登入令牌。正式程式那次於 14:57 讀到 Gemini 每週 97%、5 小時 96%，這只是當時的官方數字。未用此工程殼冒充原啟動器驗證，原入口另外在 15:03 啟動確認。

## 正式套用與可退回版本

- 套用前確認 47831 無監聽，沒有 K 專用 launcher／Electron／核心／supervisor 程序，沒有強制結束工作。候選的真模型與語音測試已結束。
- 全部 **423 個 Git 追蹤檔**與下載版本相符（文字只正規化 CRLF/LF）；測試產生的瀏覽器診斷檔先恢復原正式診斷，不部署假測試診斷。兩次早期檔案核對因單純 CRLF/LF 差異先停止，查明後修正工程核對方式，未更改產品或跳過內容核對；原失敗 `activation.log` 保留。
- 14:57:23 使用既有 `activateRuntime` 交易更新。前一版程式與啟動器保留於：
  `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791010643187`
- `.local/runtime.json` 只更新版本及上一版位置，其餘 Node／Whisper 位置保持原值；K 專用 Codex `config.toml` SHA-256 前後相同。沒有更換 Codex／Claude 核心或搬移既有對話、登入、瀏覽器資料。
- 正式新 UI、3 個資產、啟動器讀回一致；15:03:44 執行原 `Start-K-Desktop.ps1`，15:03:45 launcher ready，15:03:52 實際視窗為「K 執行中樞」，47831 的程序指向新 `trusted-runtime`，`/health` 為 `deployment: native` 與原 private-state。
- 15:04 從正式服務讀回 3 個資產均 HTTP 200 且雜湊相符；未授權 `/api/state` 仍為 **403**。證據 `activation.json`、`normal-start-readback.json`、`served-readback.json`。
- 可依既有退版流程回到上一版程式；**這不是對話資料備份，不還原對話**。

## 未驗證與保留限制

- 實體麥克風未重測，語音驗證使用假音訊與真 Whisper；未把東區 Windows 語音改設到南區。
- Gemini 圖片、K 瀏覽器助手與 Gemini 主代理跨供應商派工仍未接入；Flash 子代理仍限 Claude 的 `k_luna` 路徑。本輪沒有另跑完整真 Claude→Flash→Claude 通知回合，也沒有重送真 GPT／Claude 工作；既有登入與目錄／額度已在本機讀回，其他回歸以完整測試涵蓋。
- 沒有故意登出、耗盡額度或重現網路故障；目前成功不保證未來官方 CLI 版本權限行為不變，升版後仍須重跑原生 probe。
- 根目錄實驗工作樹不等於正式版本，後續維護仍從上述維護來源及正式版本收據判斷，不整批複製根目錄程式。
