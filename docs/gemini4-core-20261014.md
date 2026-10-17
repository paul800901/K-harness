# Gemini 核心更新與 Gemini 4 可用性（2026-10-14）

## 結論與範圍

本人要求沿正常流程更新 K 的 Gemini 核心；Gemini 4 若原生可用，主代理與子代理都應能選。

- K 專用 Antigravity **1.3.4 已下載、驗證並設為下次啟動版本**；06:12（Asia/Taipei）更新器回報 `restartRequired: true`。本輪尚未確認正式 K 完整重開，不把候選實測當成正式生效。
- 本台目前登入通道在新版 `agy models` **仍只提供 Gemini 3.8 Flash 的 high／medium／low**，沒有 Gemini 4 Argon。本輪未將不存在於原生清單的型號硬加入選單，也沒有用其他模型冒充 Gemini 4。
- K 既有主代理模型分組與 GPT／Claude 的 Gemini 子代理篩選均接受原生 `gemini-*` 型號，不存在本輪需要移除的 Gemini 4 阻擋；因此**不改 K 程式**。模型選單再次載入時以原生清單為準，不另造清單或監看服務。
- 不換帳號、不改訂閱／計費、不讀取或複製憑證、不改全域核心、不強制停止正式 K；東區未操作。正式 K 程式版本仍為 `72f04c22d6fc41d4bfcde35d2bc0ffbd69faac0e`，沒有順帶部署尚待部署的排版批。

## Gemini App 與 Antigravity 的差異

Google 的 [Antigravity 官方模型表](https://antigravity.google/docs/models/)（本日查核）列明：Gemini 4 Argon 在 Antigravity 供 Google AI Ultra／Enterprise 使用，Google AI Pro 不提供；CLI 是支援入口之一。Gemini App 已看見新模型，不足以證明 K 使用的 Antigravity 登入通道也已取得相同權限。

本輪沒有另查或變更本人的訂閱方案；目前能直接確認的是新版原生清單沒有 Argon。不可將方案推測寫成已查明的個別帳號原因，也未嘗試繞過原生清單或改走付費 API。

## 與 Fable 的比較

[Fable 紀錄](fable-native-models-20261013.md)中的接法同樣是沿用原生目錄與訂閱路線，讓主代理與子代理一致可選。差異是：當時 Claude Code 2.1.294 已回報 Fable，K 有四處額外阻擋須移除，**並未升級 Claude 核心**。本次新版 Antigravity 尚未回報 Gemini 4，K 也沒有相同阻擋，不能照搬「刪阻擋就可用」的結論。

## 更新與讀回

- 更新前 `selected-cores.json` 記錄為 1.3.1，指向 `updates/gemini-1.3.1-j3RmnW/agy.exe`；該檔實際 `--version` 回 **1.3.2**。只記錄此差異，不推測既有差異的原因。
- 沿正式 runtime 的 `src/core-updates.mjs` 查官方 manifest、下載並核對 SHA-512，再用既有 `createCoreUpdates` 更新 Gemini 選用紀錄；執行前再核對官方 release 與已測候選完全一致，沒有另寫安裝器。
- 新選用檔：`trusted-providers/updates/gemini-1.3.4-nboJN7/agy.exe`，相對於正式隔離環境根目錄；讀回選用版本 **1.3.4**，下載檔雜湊與官方 manifest 一致。
- `previous` 保留原檔 `updates/gemini-1.3.1-j3RmnW/agy.exe`；舊檔更新前後雜湊一致。原指標的版本標籤仍為 1.3.1，實際執行版本差異如上。沒有刪除任何舊核心。
- Codex 與 Claude 的選用設定前後完全相同；只改 K 專用 Gemini 選用紀錄。正式程序的核心在啟動時才讀取，這不是執行中切版。

## 驗證與證據邊界

1. **原生登入／目錄**：舊核心的 `/usage` 確認目前已登入且額度可用；新版版本讀回 1.3.4，目錄只有三個 Flash effort。沒有模型輪替或帳號輪替。
2. **權限 probe：8/8 PASS，8 次模型呼叫**。以正式 `72f04c2` 的 `gemini-worker.mjs` 呼叫新版 exe，驗證唯讀讀檔、唯讀強制寫入／命令拒絕、工作區可寫／TEMP 拒絕、父層拒絕、絕對外部路徑拒絕、一般工作區任務、完整存取寫入、取消自己建立的測試程序樹；取消後無殘留程序。
3. **K 主代理實測 PASS**：同樣使用正式 runtime 的 `createGeminiController`，獨立假工作區、唯讀、Flash low 一次回合，原生完成並回覆 `K_GEMINI134_MAIN_OK`；沒有操作既有聊天室。
4. **主／子選單資料核對 PASS**：正式主代理目錄提供 Flash high／medium／low，GPT 與 Claude 的子代理篩選均保留該模型。另以 Argon high／medium 假清單確認既有分組及兩條子代理篩選不阻擋新型號；這只是合成路由驗證，**不是 Gemini 4 可用或執行成功的證據**。本輪未做 Gemini 4 多模態或正式 UI 實測。
5. 本輪沒有修改產品程式、權限策略、模型預設或依賴，不重跑無關的整套測試；上述是新核心的相稱原生相容性驗證，不宣稱新增程式已由 Opus 審核。

證據集中於 `.runtime/archive/gemini4-core-20261014/`：`official-release.json`、`current-native.json`、`candidate-native.json`、`permission-probe-1.3.4.log`、`main-smoke-result.json`、`selection-before.json`、`core-update-result.json`。本機證據不提交 Git。

權限 probe 使用既有八項行為檢查的本機副本，只調整為指定 K 候選 exe、載入正式 worker、將假資料留在上述 archive；沒有更改八項行為判定。原 probe 的自動永久清理未執行，假資料保留，未把保留資料謊稱清理成功。取消只針對此 probe 建立的程序，不是強制停止使用者工作。

## 未完成事項與文件狀態

- 已請本人在 K 工作自然結束後完整離開並停止，再用原桌面捷徑重開；~~**正式重開及生效讀回待確認**~~（10-15 已讀回：K 於 10-14 23:48 啟動，晚於核心更新，啟動流程讀選用紀錄而載入 1.3.4，見[剩餘事項收尾](remaining-fixes-20261015.md#gemini-核心讀回)）。
- 設定更新後正式 `/health` 再查為 **200**，程式版本仍為上述 `72f04c2`；這只確認既有 K 持續服務，不代表已切到新核心。
- Gemini 4 的本台原生可用性未成立，因此主代理／子代理均未新增該選項；不改訂閱來達成此條件。
- 本輪只提交這份紀錄與工程索引。開始時 `main` 為 `a91eddb`，另有四個既存、尚未推送的提交，含尚待部署的排版批；不藉本次核心更新把無關批次一併 push。
