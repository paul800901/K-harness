# Gemini 獨立額度查詢與等待責任（候選，2026-10-13）

## 使用者可觀察結果與授權

目標不是每秒精確的百分比，而是：K 能查既有五帳的最新官方額度；確認目前帳號耗盡後擋住新派工，讓既有工人自然結束，再只切到已確認有額度的帳號。條件就緒通知原主代理核對成果，以新工單只接剩餘。暫時查詢失敗不能遺失等待責任，不能靠主代理反覆詢問。

使用者已同意 **「允許限定候選實測」**：憑證助手可使用已保存的帳號查 Google，過期時沿用已安裝官方 CLI 的登入參數更新；不輸出憑證、不改目前工作帳號、不派工、不部署。這項範圍優先於歷史部署授權。

目前只修改獨立 `codex/quota-scheduler-20261013` 候選。沒有操作四個真翻譯聊天室、重新開啟追蹤、停止／重啟／部署正式 K，沒有重播真工單、切帳或更換計費。其他聊天室的 Fable 模型接入是另一批變更，不能算成本批部署。

## 根因與最小完整修正

1. 舊額度來源依賴目前登入的原生查詢，查別帳須先切帳，因而把「讀額度」與「等全部工作停止」綁在一起。
2. 暫時查不到額度走到 `blocked` 並清除等待者；但主代理又被要求不要輪詢，造成沒有人再負責喚醒。
3. 舊 admission 容許 quota unknown；下一次原生失敗才發現不能用。其他帳號存在，也不代表已查明可用。

修正只保留既有帳號表與通知路徑，不重造模型核心、不新增監工模型或人用管理面板：

- `scripts/gemini-quota.ps1`：限定 Google quota／OAuth 端點；解析 5 小時與每週兩個 window，缺失／重複／非法值維持未知。PS 5.1 是固定執行引擎。
- `scripts/gemini-credentials.ps1`：只取指定 K managed target，秘密不離開 helper。刷新保存同一 target 並讀回；查額度不寫 live target。避免日後 capture／activate 將較舊 live token 蓋回更新後 managed token。
- `src/gemini-credential-vault.mjs`：Node 僅取得安全身分、quota 與明確錯誤類別；helper 操作串行，沒有 token 出現在 argv／stdout／診斷。
- `src/gemini-accounts.mjs`：每帳查詢 singleflight、既有表保存串行；工作中也可獨立查 quota。切帳仍須自然排空＋官方零額度＋下一帳已知可用。未知不能派工，也不能當耗盡切帳。
- `src/gemini-worker.mjs`：原生 quota/rate hint 可提前要求唯讀查詢，不中斷、不重播原工作；工單結果仍以原生終態／程序收尾為準。
- `src/gemini-handoff.mjs`：新增加的未送出 ID 隨原工單收據聚合、替換、消耗，不留下已消耗的 metadata，也不成為另一個等待來源。

### 等待與切換

`目前帳號可用 → 同帳派工`；正值快取最多 60 秒，不能保證下一請求一定成功。

`官方零額度 → 擋新工單、既有工作自然結束 → 依保存循環順序查候選 → 有額度才切一次 → 通知原房核對與接剩餘`。

`額度暫時未知／網路或服務失敗 → K 保留同一等待 → 1、2、4、8、10 分鐘上限的唯讀重查 → 有新終態才通知`。重試的是 quota read，不是模型工作。初次 waiting 每個等待者一次；重複相同失敗不消耗主代理回合。

`login invalid_grant → 需確認登入`；`invalid_client／schema 不相容 → 接頭錯誤，停止該等待並如實通知`。不把它們當額度用完。quota 401 在尚未 refresh 時只刷新一次，再失敗才歸登入問題。

全部帳號官方歸零且有 reset 時，由 K 等最早有效 reset 再查。若 reset 已過但仍回傳零，或官方沒有提供 reset，仍保留等待並退避重查，不猜重設時間、不以零放行，也不把等待清掉。使用者取消最後一個等待會撤 timer；程式重啟不從磁碟憑空復活舊工作。程序是否停止與成果是否完成是兩回事，解除程序鎖不代表舊工單成功或可重播。

## 官方／開源依據與限制

已安裝官方 agy 1.3.1 的 CLI help 與 [官方 CLI 參考](https://www.antigravity.google/docs/cli/reference/)／[usage 指令](https://antigravity.google/docs/cli/commands/usage?id=GoogleAntigravity) 沒有提供指定未啟用帳號的公開 quota 選項；不能聲稱這是穩定公開 API。

參照 MIT 的 [antigravity-account-pool](https://github.com/jayaliyev/antigravity-account-pool/tree/1b749f0ba30eba3c849b096cdd63cb054ec08004) 的實作證據，使用 Google `v1internal:retrieveUserQuotaSummary`，並只在需要 refresh 時從本機官方執行檔比對固定 client hash。未抄入 client 密文／明文，不採第三方 OAuth 外掛、proxy、自動模型重試、多帳同時執行或額度未知放行政策。

未公開端點、回應格式與官方 client 可能改版；不相容時必須回報，不偷偷 fallback 到切帳查詢／API 計費。Google quota 是查詢當時的觀測，不是原子額度保留。原生程式在 K 之外自行改登入也沒有跨程式 CAS；K 在派工前核對身分，不宣稱能鎖住外部官方程式。

## 已執行的真實限定實測

證據目錄：`D:/K-harness/.runtime/quota-scheduler-20261013/`。本節不代表模型工作、真帳號切換或正式四房長跑驗收。

- 五個既有帳號各自成功取得 Google quota。第一輪其中一帳出現 temporary，原件保留，沒有寫成零額度；後續該帳成功。另一次強制 access refresh 成功，未發現 refresh-token rotation。
- `manager-probe-1791892200542/result.json`：實際 manager＋Windows helper＋Google 查詢，**5 次 query、5 帳 authenticated/ready、0 次 activate**；原生目前帳號與正式 registry 完全不變。
- 此 manager probe 在 **模擬 K in-flight lock** 保持 busy 時成功查五帳；沒有真正啟動模型工人，不冒稱已對正在寫檔的真工人完成並行驗收。
- runtime／登入身分原位保留。過期／強制 refresh 可更新同一 managed credential，是本次明確候選授權內的唯一真實寫入；没有把秘密保存到工程證據。
- 首次錯誤 registry 路徑在讀檔前失敗；PS 5.1 無 BOM 解析／OEM 輸出問題均保留失敗證據，已改為 UTF-8 BOM 與 UTF-8 stdout。

## Fable 5.1 參與與獨立判斷

只用目前登入實際提供的 `claude-fable-5-1`，走既有官方 Claude Code 訂閱，確認 extra usage 關閉。`design-result.json`、`quota-design-result.json` 保存原生 assistant model 與成功 result；不是以模型自稱作驗證。

Fable 指出的等待清空、refresh token 被舊 live 覆蓋、query/activate 互斥、unknown admission、錯誤分類、401 一次 refresh、解析重複 bucket、PS 版本與 blob 大小、refresh token rotation 同帳同步均列入本次修正。

主代理未照單全收：不採「refresh token 不同就以 live 覆蓋」以免蓋掉剛刷新權杖；不以 native process 消失宣稱工作成功；暫時 quota retry 不逐次喚醒模型。

第三輪 `implementation-review-result.json` 原生 `claude-fable-5-1`／success 已讀回，具體裁決：

- 採納過期／缺失 reset 不能丟失等待，補全零後延遲恢復、取消 timer 回歸。
- bridge 原已有逐工單 `dispatch`，沒有足夠證據宣稱所有未開始工單都被誤認為已派工；仍補 `notStartedIds` 明確通知，所有 acquire 拒絕明示 `not-started`。切帳 ready 同時包含失敗與未送出工單，但以新 ID 只接剩餘；不切帳的 positive 則維持分流。
- 憑證儲存暫時失敗保留等待。壞 live 身分不丟掉獨立 quota，但不採「requiresActivation=false」；保守要求 idle 同步且仍讀回目前身分，無法確認不派工。
- HTTP 403／404／410 明示介面或權限問題，不當一般網路永久重試；429／500 留在 temporary。
- 舊 `quotaRefreshOriginalId` 恢復例外加回 exclusive，避免全查改成唯讀後漏鎖；假資料競態驗證通過。
- 不採「日期無法解析就當舊 token 覆蓋」。已實測 Windows PowerShell 5.1 可讀九位小數日期；HKLM／HKCU 未設 ModuleLogging 政策，未改任何政策。不能保證系統管理員日後啟用診斷仍無紀錄。

第四輪 `final-review-result.json` 已確認原生 `claude-fable-5-1`／success，指出兩個具體缺口，主代理已重現並修正：

- 新 acquire 通過初次 waiter 檢查後卡在 quota await，舊工單此時失败收尾；原本只看 running=0 就自行換帳，造成舊 waiter 帳號來源不符。現在再查 waiter／drain，未送出的工單加入同一排空流程；精確兩房序列驗證未開工、只切一次、兩房各通知一次。
- 官方零額度保留為 stale 且 reset 尚未到時，原碼跳過重查卻不承認耗盡，留下無效等待。改承認既有有時限零證據。初版測試漏設固定時鐘，已更正並加「確在 A 開工／尚未切帳」斷言；主代理用舊分支副本重現真正等待卡住，再驗證新版通過。

另採納 quota HTTP 400 明示介面錯誤；不加每次等待時間改變都喚醒主代理的通知。主代理發現的新 `notStartedIds` 收據 metadata 聚合缺口也已先重現失敗再修正。第五輪 `race-fix-review-result.json` 已讀回實際 `claude-fable-5-1`／success（session `c1d09ac8-deab-45b6-a63f-b0229f121897`），對這四項增量未再發現可重現阻斷缺陷。Fable 僅做來源複查，未自行執行測試；完整回饋與主代理裁決保留於證據目錄。

主代理另核對 `quota_client` 在 vault 會保留 `temporaryFailure=false`，fake helper→vault 分類已測；不因本次聚焦 prompt 沒附 vault 就當作缺失。stale 零＋全帳耗盡走有上限退避而非精確 reset timer，可能晚至下一次重查才通知，未誤宣稱即時重設。這不重播工作、也不造成主代理輪詢；保留目前最小方案。

## 驗證狀態

- helper 假 HTTP／假 Credential store 加收據：22/22；worker：56/56；帳號／四房四檔末版 180/180；兩個切帳競態／stale zero 回歸 2/2；收據 metadata 4/4。
- 第一輪多個舊期待拒絕 busy query／全查必切帳已不適用，失敗 log 保留；全量第一輪 1601/1603，兩項只因候選尚無 `dist-ui`，UI build 後全量 1611/1611 通過。
- 候選程式先固定 `f13557a`，後合入最新 main（只涉及已驗收 updater 與文件），整合點 `31b0e64`；完整 1613/1613 通過後仍依 Fable 新證據補修。末版程式 `94145a0`，完整 **1616/1616** 通過，log：`.runtime/quota-full-suite-closeout.txt`。UI build 已通過，僅既有 chunk size 提示。
- 未部署、未合回 main／push；只保留候選與證據。真實模型執行中查詢、五帳實際切換及四房正式長跑不在本輪限定 probe 授權內，尚未驗收。
- 五帳實測沒有任何 window 恰為零；真零額度的原始回應格式、refresh 後官方模型續用及真實換帳閉環仍未實測。不以正額度 probe／假 HTTP 或模擬工人取代這些驗收。

## 候選收尾

程式 `94145a0` 已完成本地驗證與真 Fable 5.1 增量末審。正式 runtime 仍為另一批已上線的 `aee9e5ab4bd19b5142ca4d6c22ecd77c94ab52c3`，本批未部署；主工作樹既有 local-dictation test／runtime-cleanup 文件保持原狀。候選留在 `C:/Users/Paulus/.codex/worktrees/quota-scheduler/K-harness`，等待後續明確授權的正式更新與真工作驗收。

## 本人正式更新授權（2026-10-13）

本人於候選收尾後明確要求「更新正式 K」，授權本批沿既有安全更新流程套用與讀回，取代前述候選不部署限制；不恢復或重送四房工作。依本輪指定，以已完成的真正 Fable 5.1 設計／末審為審查來源，不假稱 Opus 複查。同步修正 AGENTS 舊「全部實查須逐帳切換」及四帳描述，使現行規則符合本人五帳獨立查詢要求；程式來源仍是已驗收 94145a0，後續僅文件不同。正式結果另記於下。

部署前另發現兩處人類畫面說明仍寫「閒置逐帳切換再切回」，只同步替換為獨立查詢、不改查詢事件／按鈕條件／派工行為。此文案差異由主代理檢查，原 Fable 末審涵蓋的排程控制流程完全相同；封裝建置與完整測試仍重跑。
