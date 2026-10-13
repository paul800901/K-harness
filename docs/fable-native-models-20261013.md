# Fable 系列沿用 Claude Code 原生核心（2026-10-13）

## 需求與取捨

本人表示 Claude 已升級 100 美元方案，要求 K 加入 Fable 系列；隨後明確補充：「照原他們 Claude Code 的原生核心怎麼做就怎麼做，我們不要多餘限制。」

本批只移除先前因額外 usage credits 尚未授權而設的四處 Fable 特例。原生核心仍負責可用性、額度、計費與錯誤處理，K 不新增方案分級、額度檢查、計費攔截或確認介面，也不開啟／修改額外用量設定。這項現行決定取代 2026-10-08 工程紀錄的 Fable 暫時排除；歷史紀錄不回寫。

## 修改

- `src/claude-host.mjs`：不再從原生模型目錄排除 `claude-fable-*`；移除 host 啟動前的 Fable 名稱阻擋。
- `src/worker-policy.mjs`：已接通 Claude 通道時，工人選單不再排除 Fable。
- `src/luna-bridge.mjs`：既有 Claude 工人路線不再拒絕 Fable。
- `AGENTS.md`：合併本次現行規則，保留訂閱通道及不修改計費設定的邊界。
- 更新四份 host／worker／bridge／policy 單元測試與既有工人選單 UI probe。

產品程式只有上述三檔、四處刪減，沒有新相依、模型清單、路由、狀態或防禦層。原生 hidden／不可用過濾、模型 ID／effort 傳遞、訂閱認證、權限、未知工作不重播皆保留。既有聊天室及預設主模型不自動更換。

## 原生實讀與實際回合

沿用 K 專用 Claude 設定目錄與既已選定的官方 **Claude Code 2.1.294**，未查新版、安裝核心、搬移或讀取憑證。

- 原生 initialize 回傳去重後 **12** 個 Claude 型號，包含 `claude-fable-5`／`claude-fable-5-1`；兩者 efforts 都是 `low, medium, high, xhigh, max`。
- **登入方案仍回報 `pro`**，不能把本人升級陳述說成 CLI 已確認 Max。原生用量同時提供 Fable 模型區間及 50% 共用週額度資訊。K 不自行改寫此讀數，也不因此新增方案攔截。
- Fable 5 session `043327bd-1988-4de3-8f4a-706d6b2214d7`、Fable 5.1 session `7d076775-43d8-451d-a24d-68400dcdd996`：循序、各一次文字連通測試，均原生 `success`，實際 assistant model 與指定 ID 一致，回覆 `FABLE_OK`；未使用工具或重試。
- 測試前後 `extra_usage.is_enabled=false`，未修改設定。這是用量設定讀回，不是費用／帳單驗收；日後本人若啟用額外用量，Claude Code 的非互動原生行為照常適用，不由 K 另設同意門檻。

官方來源（當日查閱）：[Fable 方案說明](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan)、[Claude Code 模型設定](https://code.claude.com/docs/en/model-config#fable-and-usage-credits)。Max 包含 Fable 5／5.1 的共用週額度；print／未顯示同意提示的 SDK 在需使用已啟用 usage credits 時可能不再詢問。這不是本批另行變更計費。

## 驗證與限制

- 舊程式先以更新的測試重現 **4 項失敗**；移除四處特例後，聚焦測試 **34/34**。
- 前端建置通過（既有 bundle 大小警告，未擴張處理）。
- 既有工人模型選單 probe：桌面／手機通過，23 個原生模型 fixture＋auto；Fable 兩型號及五項推理程度可選，hidden／不可用、缺失手選不換模及原生 null effort 邏輯保留。
- 使用當日本機 initialize 的實際模型清單放進 built UI：桌面 1440×1000、手機 390×844 **2/2**。12 個 Claude 型號、Fable 分組、兩型號／五項 effort、主模型 Fable 5.1＋工人 Fable 5 精確送出均通過。僅攔截的假 `/api/open`，沒有正式聊天室操作；截圖由主代理實看。
- 首輪完整測試 **1588/1590**：新工作樹尚未完成前端建置即先啟動測試，branding／HTTP 兩項取不到 `dist-ui/index.html`。錯誤日誌保留，不改產品去掩蓋；建置完成後原樣重驗 **1590/1590，0 fail／cancelled／skipped，156.420 秒**。
- 舊 `model-picker-compact-ui-probe.mjs` 的 Claude／Fable 選單與額外用量標籤檢查已通過，但後段舊 Gemini 登入按鈕 locator 逾時，整支不能稱通過。沒有修改無關 Gemini；本批另以上述當日原生目錄的限定 UI 驗證完成 Fable 行為。

## 真正 Opus 5.5 複查

官方 Claude Code 訂閱、實際 `claude-opus-5-5`，session `225b8192-b7cf-45dc-8fab-09f4dc944f5e`，原生 success。只讀本批 diff 與相關來源，**沒有阻擋意見**；確認四處特例完整移除、修改精簡，未放寬權限、增加重試或更改計費設定。

採納：在此記錄目前 CLI 仍報 pro、auto 工人可從原生目錄選 Fable，以及原生非互動額外用量行為。不採用不存在的方案／計費 gate，也不改寫歷史文件。Opus 未自行執行測試或驗證帳號；主代理獨立核對 diff、原生回合、建置、測試與 UI 證據。

## 版本、部署與保留

工程基底 `73a7666`。原始碼主工作樹的既有 `test/local-dictation.test.mjs` 修改未動、未納入本批。

關閉前的驗收程式固定為 `fa8463ef51f86e21eca7dfa3aaf22c50dc25b550`，工程文件與現行規則另以文件 commit 保存。原生回合、全測、建置、相稱 UI 驗證及真正 Opus 複查皆完成，當時狀態為 **ready for deployment，尚未正式套用**；本輪正式更新結果見本文末段。

正式 K 的 `/health` 仍回應，執行版為 `a95fd65b1ae140c6b9220272dab68bbfbffc5370`；未確認正式 K 閒置／停止，所以未自行中止或更新。已告知本人用「離開並停止 K」後才能套用。尚未 push、未更新東區，也未對既有聊天室換模／重送。後續沿現有更新流程以完整 SHA 套用、保留程式退版、讀回，再按發布規則 push；不把候選成功說成正式選單已更新。

證據保留於 `C:/Users/Paulus/.codex/worktrees/fable-models/K-harness/.runtime/` 的 `fable-*`／`claude-fable-*-result.json`，原始原生清單在 `D:/K-harness/.runtime/fable-20261013/native-catalog.json`。這些本機資料不提交。應用程式建立工作樹時卡在 ignored `AGENTS.override.md` 掃描；只停止本任務該掃描，Git checkout 完整保留，附加登記失敗，未移除工作樹或證據。

## 關閉後更新：安裝打包根目錄修正

本人明確回覆「離開並停止 K 已關」後，確認 47831 不再監聽，且 K 專用程序已結束。先保存 91 份聊天室 metadata 的摘要及設定／入口／舊程式摘要；不讀取憑證、不搬移對話。

首次透過 `Update-K.ps1 -Ref c9fdbaf16bad8bfe059f1e5965566a5705a827f7` 執行，在啟動 Electron 安裝步驟前失敗，**沒有正式 activation**。根因是 installed `manage-install.mjs` 的 `run` 預設 cwd 為自身 `trusted-runtime` 子目錄；`git archive` 只打包此 Git 子路徑，而 `.runtime` 不在 commit 中，因此 ZIP 僅 62 bytes、沒有項目。空候選的 `npm ci` 轉而找到上層主工作樹 package，安裝同 lockfile 的 273 個相依，候選中仍沒有 `electron/install.js`。不歸因於另一聊天室的整理，也不把失敗當更新完成。

僅修 `scripts/manage-install.mjs`：從同一 Git 倉庫讀 `--show-toplevel`，將 archive 的 cwd 指向該根目錄；其他 fetch／版本指定／建置／測試／停止檢查／退版／activation 不改。`test/install-runtime.test.mjs` 增加真 Git＋無相依 fixture，模擬 installed updater 路徑，驗證根目錄 sentinel 確實進入候選，故意缺 Electron 而在 activation 前停止，原 runtime 不變；聚焦 **7/7**。未新增依賴、發布架構或自動重試。

真正 Opus 5.5 第二次限定複查：session `860f872d-42c5-4809-9bba-7976ab6ef959`，原生 success、實際 model `claude-opus-5-5`，結論 **No blockers**；確認修正與根因相符、兩行最小修正、不影響權限或退版。提醒部署 SHA 必須包含本修正，已納入收尾要求。複查未代替本機完整測試及正式讀回。

舊版 updater 不含自己的修正，本次在確認未 activation 後，以已審查來源中的同一 `scripts/manage-install.mjs` 接續打包／測試／正式更新，而非重送未知工作；新正式版將帶入修正，之後 `Update-K.ps1` 即可從 installed manager 正常打包。失敗空候選及全部日誌保留。

## 正式更新、桌面入口與發布讀回

- 本人補充阿布剛整理、正式包在桌面後，直接讀回 `C:\Users\Paulus\Desktop\K HARNESS.lnk`：目標仍是 `D:\K-harness\local-launcher\dist\K桌面啟動器.exe`，工作目錄 `D:\K-harness`，沒有另指向新包。啟動器仍載入既有 `trusted-runtime`；整理紀錄亦明確保留正式程式原位置。不歸咎整理，不搬移／覆寫阿布的整理成果。
- 包含 Fable 與更新器修正的固定程式版本 **`aee9e5ab4bd19b5142ca4d6c22ecd77c94ab52c3`** 已正式套用。工作樹全測 **1591/1591**（162.683 秒）；安裝流程三項建置與封裝完整重驗 **1591/1591**（66.026 秒）通過，才 activation。
- 程式退版保留於 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791891326740`，對應舊執行版 `a95fd65b1ae140c6b9220272dab68bbfbffc5370`；舊程式、入口與啟動器摘要核對通過。這是程式退版，不是對話資料快照。
- 安裝 **722 份版本來源**核對通過，封裝 ZIP 註記完整 commit SHA。最初驗證腳本直接比 Git blob 會把 Windows archive 換行判成差異；改比同一封裝內容，另核對 Vite 重寫的一份既有 generated asset 等於 Git bytes，最終零差異。兩份初次驗證日誌保留，未改產品去配合驗證。
- 正式 owner＋真登入的 `/api/models`，不是假模型 fixture：**桌面／手機 2/2**、12 個 Claude 型號、Fable 5／5.1 與五項原生 effort 均可選，工人選單亦有兩型號。主代理實看兩張截圖。只開新對話設定後取消，**33 個既有聊天室前後相同、0 POST、0 頁面錯誤**，未開原房、送出回合或建立聊天室。
- 首輪 UI probe 未等待工作區列表就操作，未取得模型回應而逾時；補上等待實際工作區列表後完成雙尺寸讀回，沒有修改產品。初次日誌保留。
- 正式讀回後重驗 **91 份聊天室 metadata、工作區登記、核心選擇與既有穩定設定未變**；阿布的測試修改及整理文件摘要也未變。未更改帳號／計費、權限、既有模型或重播工作。
- 讀回 owner 正常關閉，確認 K 已停止；本人可由原桌面捷徑重新開啟新版。沒有讓 K 留在背景運作，未更新東區。
- 程式合回 `main` 並 push，遠端 `refs/heads/main` 實讀為 **`aee9e5ab4bd19b5142ca4d6c22ecd77c94ab52c3`**；發布前 13 個變更路徑均為來源／測試／文件，沒有本機資料路徑或高可信秘密樣式命中。此部署紀錄另作純文件 commit，不再重啟 K；最終文件 SHA 與遠端讀回留於下列本機收尾收據。

本輪部署、失敗與成功日誌、雙尺寸截圖、安裝／保留／發布讀回皆保留在 `D:\K-harness\.runtime\fable-deploy-20261013`，不提交。Fable 原生實際回合與兩次真正 Opus 5.5 複查保留於前述工作樹證據；不把本次選單讀回說成所有既有正式工作的長跑驗收。
