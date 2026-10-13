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

驗收程式固定為 `fa8463ef51f86e21eca7dfa3aaf22c50dc25b550`，工程文件與現行規則另以文件 commit 保存。原生回合、全測、建置、相稱 UI 驗證及真正 Opus 複查皆完成，狀態為 **ready for deployment，尚未正式套用**。

正式 K 的 `/health` 仍回應，執行版為 `a95fd65b1ae140c6b9220272dab68bbfbffc5370`；未確認正式 K 閒置／停止，所以未自行中止或更新。已告知本人用「離開並停止 K」後才能套用。尚未 push、未更新東區，也未對既有聊天室換模／重送。後續沿現有更新流程以完整 SHA 套用、保留程式退版、讀回，再按發布規則 push；不把候選成功說成正式選單已更新。

證據保留於 `C:/Users/Paulus/.codex/worktrees/fable-models/K-harness/.runtime/` 的 `fable-*`／`claude-fable-*-result.json`，原始原生清單在 `D:/K-harness/.runtime/fable-20261013/native-catalog.json`。這些本機資料不提交。應用程式建立工作樹時卡在 ignored `AGENTS.override.md` 掃描；只停止本任務該掃描，Git checkout 完整保留，附加登記失敗，未移除工作樹或證據。
