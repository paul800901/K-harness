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

### 等待與切換

`目前帳號可用 → 同帳派工`；正值快取最多 60 秒，不能保證下一請求一定成功。

`官方零額度 → 擋新工單、既有工作自然結束 → 依保存循環順序查候選 → 有額度才切一次 → 通知原房核對與接剩餘`。

`額度暫時未知／網路或服務失敗 → K 保留同一等待 → 1、2、4、8、10 分鐘上限的唯讀重查 → 有新終態才通知`。重試的是 quota read，不是模型工作。初次 waiting 每個等待者一次；重複相同失敗不消耗主代理回合。

`login invalid_grant → 需確認登入`；`invalid_client／schema 不相容 → 接頭錯誤，停止該等待並如實通知`。不把它們當額度用完。quota 401 在尚未 refresh 時只刷新一次，再失敗才歸登入問題。

全部帳號官方歸零且有 reset 時，由 K 等最早有效 reset 再查。使用者取消最後一個等待會撤 timer；程式重啟不從磁碟憑空復活舊工作。程序是否停止與成果是否完成是兩回事，解除程序鎖不代表舊工單成功或可重播。

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

主代理未照單全收：不採「refresh token 不同就以 live 覆蓋」以免蓋掉剛刷新權杖；不以 native process 消失宣稱工作成功；暫時 quota retry 不逐次喚醒模型。第三輪整份實作複查及完整測試仍在執行，結果待下節更新。

## 驗證狀態

- helper 假 HTTP／假 Credential store：14/14；worker：56/56。
- 帳號／四房整合測試正在依新的「免切帳查詢」契約更新；第一輪多個舊期待拒絕 busy query／全查必切帳已不適用，失敗 log 保留。尚未完成全量驗收，不以局部測試宣稱已修好上線。
- 未部署、未 merge／push；只保留候選與證據。
