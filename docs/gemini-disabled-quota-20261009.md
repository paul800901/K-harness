# Gemini 原生 disabled 額度修正（2026-10-09）

## 本人要求與範圍

本人指出更新額度後仍有每週 0%、5 小時 100% 與另一帳號「—」的差異，要求查明並修好；確認無工作且將關閉 K，修正驗證後更新正式 K，最後不啟動日常工作。不 push、不更新東區，不改登入／訂閱／帳號順序、聊天室、權限或原生重試。

## 直接根因與本次原生證據

- 確認正式 owner 未監聽、Antigravity 閒置。沿既有 K Windows vault／refreshAll 正式帳號切换流程，逐一查五個已保存帳號，finally 還原原帳號；未讀取憑證內容、未新增帳號、未送模型工作。
- 原生 CLI 為既有專案所選 agy 1.3.1，`-p /usage`，2026-10-09 13:57:07–13:57:52（臺灣）。五次 code 0，沒有 timeout、cleanup error，結束 busy false、身分還原相符。
- 第一列原文是 `Gemini Models\tWeekly Limit Remaining\t0%\t2026-10-09T14:10:46Z` 與 `Gemini Models\tFive Hour Limit Remaining\t100%\t2026-10-09T10:56:42Z`。100% 是本次原生回報，不是 K 預設填入，也不可因每週歸零改寫為 0%。
- 第二列原文是 `Gemini Models\tWeekly Limit Remaining\t0%\t2026-10-11T13:01:05Z` 與 `Gemini Models\tFive Hour Limit Remaining\tdisabled\t`。舊 parser 只接受百分比，把 disabled 明確狀態丟掉；畫面因找不到該欄顯示「—」。這次才查明第二列的直接根因；取代前批「未知是官方省略或 K 解析」的限制。
- 脫敏原生 usage 行、本次結果及還原讀回保留於 `D:\K-harness\.runtime\gemini-quota-diagnosis-20261009\native-usage.json`／`query-result.json`，不提交帳號地址或原生憑證。

## 最小修正

- `src/gemini-login.mjs`：只對既有 Gemini 兩個已知窗口的精確 `disabled` 保留 `disabled:true`、remainingPercent/reset=null。不編造百分比、重設時間、無限額度；原有合法百分比與未知 reset 行為不變。只 disabled、沒有任何數字的回應不新認定登入成功。
- `src/gemini-accounts.mjs`：成功查詢不將 disabled 欄判查詢失敗；順序交接忽略明確未啟用限制，但仍須至少一個已知正餘額，其他未知／零／重設／閒置規則不變。每週 0%＋disabled 仍阻止工作，不用 disabled 暗換帳號或推算恢復。
- `frontend/quota-display.mjs`、`frontend/usage.jsx`：明確狀態顯示「未啟用」／「不適用（官方未啟用）」；未知仍為「—」，已知 0%／100% 不變。沿用共用呈現於額度彈窗、側欄與設定帳號列。每週歸零提示加重／警示色及等待重設，補明另一窗口 100% 不代表可继续工作。
- `frontend/usage.css`：只新增已有 warning token 的提示樣式，不改色盤／排序／載入／其他功能。
- 不新增永久 raw log、查詢服務、重試、fallback、背景監控、設定或資料 migration。

## 驗證與發布狀態

- 第一輪針對性測試 87/87 通過：原生 disabled 不丟失、不混其他供應商、不當 0/100、未知仍未知；成功全帳號查詢還原；週零仍阻止工作；順序交接可選正額度＋disabled，但拒絕未知或全 disabled。
- 正式更新、built UI、完整回歸、真正 Opus 5.5 複查與正式讀回：待完成，尚未部署。本段後續以實際收尾追加為準。
- 公開資料只讀核對官方 [模型說明](https://antigravity.google/docs/models)／[方案說明](https://antigravity.google/docs/plans/)／[CLI 專案](https://github.com/google-antigravity/antigravity-cli)。未找到能證明 disabled 等於無限使用的正式契約，因此 UI 只翻譯「未啟用」，不宣稱 unlimited。直接根因依本次原生回應，不以公開 issue 推定帳號事實。


## 正式收尾（2026-10-09 14:09 臺灣，取代前文待部署狀態）

- 固定正式程式版本 `3bcdde04f8040e1e2777c276025ee980ec421d20`，從既有正式 6138b578 更新，沒有覆蓋另一批舊版；Git archive 617 個原始檔與候選／測試後讀回逐檔零差異。沿用既有相依實體副本與工具建置，未安裝或升級套件。
- 針對性 87/87，固定候選完整序列測試兩次皆 1088/1088、零失敗／略過；既有 sidebar built regression 6 個案例通過。完整測試中的 remote storage broken／EPERM 是刻意 fail-closed 案例，測試結果通過，不是本次額度程式錯誤；原文完整留存。
- 本批 built DOM 使用本次原生回報解析後的脱敏 fixture，warm/light/dark × 1920/390 共 6 個案例：更新後 disabled 在額度彈窗、側欄、設定列皆為「未啟用」，展開 reset 為不適用，週零提示加重、原生 five100 不變、未知仍—、無溢出／pageerror。主代理查看桌面／手機實際截图。初次 UI probe 手機 selector 寫錯／theme key 不符，只改一次性驗證腳本，不改產品或測試條件；保留首次局部截圖與最終結果，未以首次結果宣稱通過。
- 真正 Claude Code 2.1.294／官方 Pro 訂閱／`claude-opus-5-5` 只讀複查，session `e89c910e-6ff4-401a-9ccc-031092e927e4`，code0、success、非 error，12 個 Read/Glob/Grep。結論無阻斷項、無過度工程；指出順序交接與查詢失敗判斷的 disabled 適配是保持舊數字欄語意所需。兩個非阻斷建議（非已保存帳號 legacy reset 文案、footer 增加否定 unlimited）不擴充本次已驗證的 managed-account 問題；現用 UI 只翻譯 disabled、不宣稱無限額度。主代理独立驗收 scope、原碼 diff、原生原文、全部測試、建置與UI，再接受發布。
- 更新前 K port 未監聽、Gemini idle；使用既有 activateRuntime 保留退版：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791526039274`。程式／啟動器交換期間，98774 個既有對話、原生帳號 home、瀏覽器與設定檔 hashes 一致，其他 runtime 設定不變。這是程式退版，不是對話資料備份／還原。
- 新正式程式再次沿 K 既有 refreshAll 實查五個帳號，14:08:40–14:09:29（臺灣），全部原生 code0、無 timeout/cleanup error、finally 身分還原相符。第二列 disabled 已由正式 parser 寫入其新查詢紀錄，而非修改／回填舊快照；第一列原生仍 week0/five100，沒有改成0。只有本次被明確授權的額度實查更新 quota/auth 查詢時間；沒有讀取憑證內容、送出模型工作或重播聊天室。
- 正式 owner／認證 built UI 讀回完成於 `2026-10-09T06:09:38.135Z`：health200、未認證 API403、實際 JS/CSS 與部署檔相符；五個既有帳號、原身分保留、busy/uncertain false，second five「未啟用」、reset「不適用（官方未啟用）」可見。未開任何聊天室、selectedThread null、無 API POST 或 pageerror；最後正常關閉、port拒絕連線，K 維持停止。
- 證據：`D:\K-harness\.runtime\gemini-quota-diagnosis-20261009` 的 acceptance／deployment-preserved／post-deploy 原生查詢／formal-readback／UI／完整測試／Opus結果。只更新南區正式 K，不 push、不更新東區；文件收尾 commit 不再部署／重啟。
