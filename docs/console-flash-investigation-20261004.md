# 黑窗修復與三核心手動更新（2026-10-04）

## 結論與正式狀態

- 黑窗根因已捕捉：**K 查詢 Gemini 額度時，Antigravity CLI 自己啟動背景更新程序，開出了 Windows Terminal**。不是使用者手動更新，也不是 K 的 Git 更新器。
- 已套用南區正式程式，並加入使用者要求的三個小按鈕：更新 Claude Code、更新 Codex、更新 Antigravity。**平常不查新版、不下載、不自動更新；按下才處理，完全離開並停止 K、重開後生效。** 只準備新版本、不熱換正在工作的核心，因此不用新增工作鎖或更新排程。
- 維護來源：`C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`，基準 `9f99dab`。正式程式於 02:18 更新為 **`6830927`**；本人已明確同意套用並「離開並停止 K」，啟用前程序清單為空、連接埠 47831 未監聽。本批未 push、未打 tag、東區不動，亦不順便升級三家核心。
- 保留原有 `browser-extension/extension-protocol.cjs` 換行修改，不納入本批。

## 實際根因證據

臺灣時間 **01:33:30**，使用者回報剛剛閃黑窗；同時限時視窗記錄捕捉到可見 Windows Terminal（1129×635），與 agy pseudo-console 對應。程序樹：正式 K Electron PID 15836 → agy PID 18652 → 更新程序 PID 6316 → agy PID 28488。

官方 `cli-20261004_013329.log` 同一次執行記錄 `/usage`，並寫：

```text
I1004 01:33:30.148697 1 auto_updater.go:334] Spawned background update process with PID 6316
```

更新結果為 `Already on the latest version.`，檔案仍是 **agy 1.2.16**，沒有真的升版。官方[疑難排解](https://www.antigravity.google/docs/cli/troubleshooting/)記載背景自更新、15 分鐘節流，以及 `AGY_CLI_DISABLE_AUTO_UPDATE=true`。此文件與現場程序／可見視窗／原生日誌吻合，並非只看見 conhost 就推論根因。

之前的 85 秒程序快照、125 秒及 320 秒視窗觀察未捕捉到黑窗，沒有當作「不存在」的證據；WMI ProcessStartTrace 權限不足，未提升權限。後續 15 分鐘上限記錄於捕捉黑窗時提前結束；全部觀察器已退出，沒有新增常駐程式、排程或開機啟動。

## 處理方式與沒有做的事

### 黑窗最小修復

- `src/gemini-worker.mjs` 的共用子程序環境加入官方停用自更新旗標；主代理、Flash 工人、登入、目錄與額度查詢共用同一入口。僅作用於 K 啟動的核心，不改 Windows 全域環境或官方應用程式設定。
- 先以既有測試重現缺少旗標，再修正；補驗 caller 環境未被更改、三種 worker effort 皆收到旗標。
- 不停用額度查詢、不刪帳號身分防護、不改權限、不增加事後藏窗機制；本人登入仍使用可見官方視窗。

### 三核心手動更新

- `frontend/core-updates.jsx` 與設定頁：只有三個按鈕和更新結果，不做定時新版查詢、升級通知、版本管理面板或額度管理。
- `src/core-updates.mjs`：使用官方發行資料，下載到 K 的 `trusted-providers/updates` 新目錄，校驗官方雜湊，再執行 `--version` 讀回；全部成功才寫 `selected-cores.json`。不執行下載的安裝腳本、不改全域 PATH、不安裝 npm 相依、不碰登入檔。
- Codex 使用官方 npm 平台包，**完整保留**原生支援程式，不只抓單一 exe；Claude 使用官方 installer 公開的發行端點及 SHA-256；Antigravity 使用官方 installer 的 manifest 與 SHA-512。
- 啟動器只在**下一次完整啟動**讀取新核心位置；目前程序繼續使用啟動時固定的三核心。Gemini 新版也放 K 專用目錄，不覆寫全機 agy。
- 舊核心與失敗下載都保留，不自動清理。第一次 Gemini 更新會額外保存原本共用 agy 的程式檔，**不複製憑證**。後續記錄上一版位置供退回。
- 沒有新版／官方版本較舊不下載、不降版；同時重按拒絕，下載或版本校驗失敗不修改選用紀錄。關閉 K 會取消尚未完成的下載。
- K 啟動的 Claude 使用 `DISABLE_AUTOUPDATER=1`；Codex app-server 使用 `-c check_for_update_on_startup=false`。不改全域或帳號設定，也不動原生核准。

官方依據：[Codex 官方啟動器](https://github.com/openai/codex/blob/main/codex-cli/bin/codex.js)、[Codex 設定定義](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json)、[Claude 更新說明](https://code.claude.com/docs/en/setup)、[Claude 官方安裝腳本](https://claude.ai/install.ps1)、[Antigravity 官方安裝腳本](https://antigravity.google/cli/install.ps1)。安裝腳本只下載閱讀，沒有執行。

## 驗證

| 項目 | 實際結果 |
| --- | --- |
| 黑窗修復前回歸測試 | 缺少停用旗標，如預期失敗；原始紀錄保留 |
| 黑窗修復定向／完整 | 83/83、647/647 通過 |
| 真 Claude 額度查詢 | 1/1，不送模型工作，host 正常關閉 |
| 真 Gemini 額度查詢 | 新建沒有更新標記的 K 測試 profile，3/3 成功；都是 1.2.16、已登入、兩個額度窗口；未生成 updater 目錄／標記，原生日誌無背景更新程序 |
| 修復後視窗觀察 | 01:37:31–01:38:16，45 秒；6 個正常 agy 查詢程序，0 個可見 Terminal／Console、無 updater 子程序 |
| 手動更新定向 | 76/76 通過 |
| 手動更新完整 | 第一次 649/655：6 個舊 fixture 假設 app-server 固定參數；調整配置參數位置及 seam 的新契約後，655/655 通過。補選用核心啟動／登入接線兩項測試、採納 Opus 精簡後，最終 **657/657** 通過，0 failed／skipped |
| 真官方下載／版本讀回 | 3/3：Codex 0.160.0 完整 Windows 包、Claude 2.1.288、Antigravity 1.2.16；只存獨立測試目錄，沒有套用正式核心 |
| 真 K Codex 原生入口 | 新的手動更新配置參數下 initialize／model/list 成功，8 個模型；未送模型工作，正常關閉 |
| 新位置的真 Gemini 執行檔 | 使用獨立下載位置的官方 agy 1.2.16 與新測試 profile 查額度，3/3 成功；未保存／切換帳號，未啟動背景 updater。人工 Google 登入未重做 |
| 真 UI（假 API） | 三按鈕順序、未點無更新請求、處理中停用、已是新版、下載錯誤及窄版顯示全部通過；只送三次指定假更新，不操作真帳號 |
| UI 建置 | 通過；既有大 bundle 提醒保留，不擴張為前端拆包工程 |
| 正式重開後觀察 | 02:21:20–02:22:35，75 秒；兩個 agy 子程序直接來自正式 K PID 22292，包含真 /usage 查詢；0 個可見 Terminal／Console，原生日誌無背景 updater，觀察器已退出 |
| Opus 5.5 複查 | 真正官方 Claude 訂閱 `claude-opus-5-5` 初查及補查均成功；補查結論「沒有剩下值得修的問題，也沒有過度設計」。原文另存，審查不代替實測 |

## Opus 實際複查與取捨

- 初查 session `39662736-72d4-4e32-8204-905fc1a83afa`，補查 `069e149e-a55a-4127-a0a7-3a188e36c7a3`；皆使用 K 專用 Claude Code 2.1.285、訂閱、真正 `claude-opus-5-5`，只讀限定審查封包。未改登入或權限；完整回覆見 [Opus 原文](console-flash-opus-review-20261004.md)。
- 採納：選用紀錄／核心檔讀取失敗時，補完整紀錄路徑及「依紀錄退回該核心」說明；刪兩處重複版本解析及下載後重複範圍檢查。保留真正下載目錄與官方雜湊校驗，不加自動回退。
- 不採納刪整份選用紀錄的提示：這會連帶退回其他供應商；改成只處理有問題的核心。失敗下載先保留，不增加清理器，也不永久刪檔。
- Opus 對 Codex 舊 wrapper／PATH 的推測，經官方現行完整包及既有 K 直接原生啟動方式確認後撤回；Gemini 新位置的登入接線已補原文與自動測試，真版本額度查詢亦通過。
- 未做三家新版的完整模型工作與新位置 agy 人工登入：本次只部署更新入口，沒有要求把正式核心也升版；真下載／版本與 Gemini 查詢不誇稱為全功能新版驗收。這是驗證界線，不把每次未來新版測試做成常駐機制。

## 還原與限制

- 本批已正式套用，02:20 由原入口重開，視窗／health／程式版本與服務中資產讀回完成；四帳號及手動更新入口已在正式介面核對。
- 日後手動更新核心僅替換程式位置，不還原對話、記憶、登入或帳號；`Update-K.ps1 -Rollback` 是 K 殼程式退版，**不是三家核心退版**。核心需停止 K 後，將 `selected-cores.json` 該供應商切回其 `previous`；首次 Codex／Claude 沒有 previous 時移除該供應商選用紀錄，沿用原本保留的 trusted-providers 執行檔。可由 AI 協助，不加三個退版按鈕。
- 目前真下載驗證為 Windows x64；ARM64 的官方 metadata 對應有自動測試，沒有 ARM64 實機驗收。無新版會明確說明未更新；無網路或官方發行格式改變會明確失敗，不暗換來源。
- 本次下載／讀回不代表未來任意供應商新版與 K 的所有功能都相容，也不保證未來官方核心永遠不開其他視窗；舊版保留供退回。
- 未處理原先四項 Gemini 遺留問題，不與本次黑窗或更新入口混算。

## 本輪正式套用

- 本人回覆「同意套用，已離開並停止 K」，之後才啟用。無執行中 K 程序，既有更新器也確認 47831 未監聽；沒有強制結束或重送任何工作。
- 從本機 commit `683092707d7d70e42e5a0b170a980214bbdb18ef` 重新封裝乾淨候選，沿用正式相依，沒有安裝套件。建置 UI／擴充／啟動器，完整 **657/657**，0 failed／skipped；啟用前 450 個 Git 檔案與候選一致。
- 首次準備被 Windows PowerShell 5 的 stderr 處理中止：Vite 已成功，但既有 bundle 警告被當成 NativeCommandError。未啟用任何程式；用本機既有 PowerShell 7 接續同一候選，重新建置與完整測試通過。原失敗與後續日誌都保留，沒有改產品程式或環境來掩蓋警告。
- 舊正式 `0e49308` 與啟動器保留於 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791051524099`；舊版 index 與目前三個 UI 資產、啟動器雜湊讀回一致。
- 本機語音／Node 位置與 Codex 設定未變；三家核心執行檔和四帳號登錄檔啟用前後雜湊完全相同，未建立 `selected-cores.json`。因此這次只部署 K 修正／手動入口，**沒有替本人按更新核心**。原生對話／登入目錄原地保留，不建立對話備份或還原機制。
- 正式 UI 讀回：三按鈕順序正確；四個已保存帳號與原帳號不變，額度順序 Claude → GPT → Gemini，子代理 auto → Flash → Sol → Luna。驗收沒有送出任何 POST，沒有代替本人更新或切換帳號。
- 02:20:23 原入口重開，視窗「K 執行中樞」、PID 22292、health 為 native、版本 `6830927`；服務中的 CSS／JS／標誌三個資產 hash 全吻合，未授權 state 仍 403。
- 本批未 push、未打 tag、未更新東區。部署收據位於 `D:\K-harness\.runtime\console-core-update-deploy-20261004`。

## 本機證據位置

- `D:\K-harness\.runtime\console-flash-20261004\long-window-events-live.json`：實際可見黑窗。
- 同目錄 `candidate-window-events.json`：修復後觀察。
- 維護來源 `.runtime/console-flash-20261004/`：red、targeted、full-test、manual-update-targeted、manual-update-full、manual-update-full-2、final-reviewed-full 日誌、`native-gemini-regression.json`、`native-gemini-versioned.json`、`claude-native-usage.json`、`codex-manual-only-probe.json`、`native-downloads.json`、`ui/result.json` 與截圖；`opus-*` 與 `opus-followup/opus-*` 保留真實原始複查結果。
- 原始全機視窗／程序資料及下載產物不提交 Git。工程紀錄只節錄本次相關證據，不提交秘密或帳號。
