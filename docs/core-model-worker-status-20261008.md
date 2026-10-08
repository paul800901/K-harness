# 三核心／模型更新核對與本聊天室子代理視窗（2026-10-08）

## 結論與正式邊界

**僅候選完成，停止等待本人；正式 K 未更新。** 本批與前面的手機附件、三核心原檔交付及原生子代理結果接續修正放在同一候選，等本人翻譯工作告一段落後再決定升級。不部署、不重啟、不停止翻譯、不 push、不更新東區。

使用者另行允許只下載較新的原生核心到獨立候選並測試，保留舊版；不切換正式啟動版本、不動登入或計費。並明確選擇子代理視窗只顯示本聊天室尚未結束的子代理。人類用途是辨識長時間沒回報、等待或可能卡住，不是管理全部工單。

- 候選：`C:\Users\Paulus\.codex\worktrees\mobile-image-upload\K-harness`，分支 `codex/native-attachments-20261008`，本批基底 `72b1c967d6c81b078e09f54a8fb5e605b515a83a`。
- 正式程式基線：`4a6c482f2df01e1b31216cffc9ec7a98088bdee9`。
- 正式核心選擇：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\trusted-providers\selected-cores.json`，本批未修改。
- 本批證據：`D:\K-harness\.runtime\core-catalog-audit-20261008`；UI 截圖另在候選的 `.runtime/core-catalog-audit-20261008`。
- 前批附件的真三核心矩陣及限制見 [附件相容紀錄](attachment-native-compat-20261008.md)，不以本批純文字 smoke 取代附件實測。

## 更新究竟會不會跟上

分成三件事，不混稱自動更新：

1. **模型選單**向當下原生核心查可用目錄／推理程度，hidden 不顯示，既有對話不自動換模型。Claude `/models` 由未開工作 host 的 catalog controller 做原生 initialize；本次沒有觀察到需要另造刷新快取的根因。
2. **核心執行檔**不是官方一出新版就偷偷切換。K 的核心更新流程另行下載／選用，下次啟動才使用；這次只放獨立測試候選，不寫正式 selected-cores。
3. **新能力**若需要新的協定或介面接線，必須個別確認。官方 CLI／TUI／IDE／SDK 有功能，不等於 K 已接通或本帳號已驗證。模型目錄存在也不等於每個模型都實際完成推論。

官方 metadata 實查時間：`2026-10-08T04:26:32.849Z`。

| 核心 | 正式現用 | 官方穩定版 | 本次候選處理 |
|---|---|---|---|
| Codex | 0.160.1 | 0.161.0 | 獨立下載、官方完整性驗證及版本讀回，真 Sol／Luna 限定假資料回合 |
| Claude Code | 2.1.292 | 2.1.293 | 獨立下載、官方完整性驗證及版本讀回，真 Haiku 5.5 純文字回合 |
| Antigravity CLI | 1.3.1 | 1.3.1 | 已是最新穩定版，讀原生目錄，不重下載／切換 |

版本、下載來源與完整性證據分別在 `releases.json`、`downloaded.json`。下載到證據目錄的 `providers`，不是正式 `trusted-providers/updates`，也沒有執行安裝器或改全域設定。

### 實際目錄及 K 接入範圍

- **Codex：7 型號**：GPT-6.1 Sol、GPT-6 Astra、GPT-6 Sol、GPT-6 Luna、GPT-5.6 Sol、GPT-5.6 Terra、GPT-5.6 Luna。原生 efforts 為 low／medium／high／xhigh／max／ultra；兩個 Luna 沒有 ultra。ultra 在現用 0.160.1 已有，不冒稱本次新加入。inputModalities、原生 Fast／priority 沿用現有接線；未做全部型號、ultra 自動派工或新增 Daybreak／Bedrock／API／TUI 音訊的真驗收，未接新計費路徑。
- **Claude：新版原生去重 12 型號，候選 K 可選 10 型號**：Opus 5.5、Sonnet 5.5、Haiku 5.5、Haiku 4.5、Sonnet 5、Opus 5、Opus 4.8、Opus 4.7、Opus 4.6、Sonnet 4.6。Fable 5／5.1 暫不開放，原因見下節。多數現代模型提供五項 efforts；Opus／Sonnet 4.6 沒有 xhigh；Haiku 4.5 沒有 efforts。Haiku 5.5 要 CLI 至少 2.1.293，新候選已真回合讀回。其他型號沒有逐一做推論／vision／1M context 驗收。
- **Antigravity：K 顯示 4 個 Gemini 家族**：3.8／3.7／3.6 Flash 各 low／medium／high，3.1 Pro 為 low／high。實際 `agy models` 還列出 Claude Sonnet 4.6、Opus 4.6 thinking、GPT OSS 120B medium，屬於**原生有、K 尚未接入**。K 現有路由用 provider／model ID 判定，直接塞入同名 Claude ID 會走錯核心，所以沒有順手擴路由。官方網站在部分產品／方案描述 Claude 5.5，不代表本次 CLI 1.3.1 目錄已提供它。

精確 ID、逐模型 efforts 及原生 metadata 保留在 `native-catalogs.json`、`candidate-catalogs.json`、`candidate-after-catalogs.json`。不為尚無用途的 Adaptive／Fast／Auto 欄位新增 state 或人用設定。

## 根因與最小修正

### Claude 推理清單及額外計費邊界

- `src/claude-controller.mjs`：刪掉 `system/init` 用 K 固定五項 efforts 覆蓋已選模型原生 efforts 的一行。原來 open／selectModel 已設好逐模型清單，不再加重複查表或 wrapper。
- `src/claude-host.mjs`：診斷不再宣稱固定 efforts 是原生能力；init 沒 models 時回空清單，不製造 Opus 目錄。
- 同檔：原生目錄解析濾掉 `claude-fable-*`；`openClaudeHost` 在 preflight／spawn 之前拒絕 Fable，明說可能額外計費、未授權、沒有換模。
- 官方文件明示 Fable 的 `-p`／SDK 非互動使用可能沒有同意提示便消耗 usage credits；因此沒有做 Fable 真回合，不改登入或改 API 計費。正式 main-session 標頭唯讀查到 13 份、0 份讀取失敗、沒有 Fable 對話。
- **限制**：K 這兩處防止 K 直接選用／啟動 Fable，不是 Claude Code 內部子代理的全面模型封鎖；不能承諾其內部自行選 Fable 也已受阻。本批不修改官方核心或增加計費攔截架構。

### 子代理快速視窗

修改 `frontend/main.jsx`、`frontend/worker-activity-popover.jsx`／CSS、`frontend/work-status.mjs`：

- 沿用 `currentWorkers(state)`，只列本聊天室未結束、且非 executionUnowned 舊工單的列；其他聊天室、已結束／已核對歷史不列。
- 數字等於列數，準備中／等待中／待確認／等待核准仍算尚未結束；待確認與久未回報另標示。切聊天室立即換成該房資料，不停止任何背景工作。
- 卡片保留暱稱或簡短任務、原生狀態／最近活動；原生有提供才顯示已耗時及最近工具。展開看最後讀回、錯誤及等待原因。
- 後端或核心連線不確定時顯示未知，保留上次列，不用假的 0 或「沒有子代理」當目前真值。
- 刪除聊天室分組、歷史／結束摺疊及未用全域計數 renderer／CSS。不新增後端 projection、路由、狀態、輪詢、重派、停止或 Token 統計。
- **最近有活動不等於有實質進度，久未回報不等於卡死，也不能藉此證明沒有空燒 Token。** Claude Token 增加也可能更新活動時間；不以此判死或宣稱省用量。

後端全域診斷／歷史／查核紀錄及主工作狀態保留；本次改的是人類快速視窗，不刪原工單。現有無 owner 標記的歷史、不完整 connection metadata 等不擴張成另一套管理機制。

## 真 Opus 5.5 討論與複查

沿用官方 Claude 訂閱，以真 `claude-opus-5-5` 做兩次只讀工程檢視，沒有以 GPT 冒充：

- 討論 session `d5f60c91-effe-4bed-b7d5-cdb8daaf0221`：採納前端限定顯示、刪 effort 覆寫一行、移除假 metadata、Fable 暫停；不加刷新快取／未用能力欄位／新路由。原文在 `discussion/review.md`。
- 最後 session `9ed21bcb-0b07-4727-a83e-7b628f445f7c`：沒有本次範圍的阻擋問題，認為修改精簡。指出 CLI 內部 Fable 限制及既有空 threadId 理論案例，沒有要求擴張修正；最後原文在 `final/review.md`。
- Opus 最後只看定向測試，沒有親看完整 UI／全測結果；Astra 另行讀回以下實際證據，不把複查當驗收。原生 result code 0，modelNames 都是 Opus 5.5。原生 cost estimate 不是新增 API 帳單或實際訂閱扣款證明。

## 驗證及保留的失敗

| 證據 | 本次結果／界線 |
|---|---|
| `targeted.txt` | 120/120；含 Haiku 無 effort、4.6 不顯示 xhigh、未來 effort 保留、重開 host 不覆寫、Fable 在任何子程序前拒絕 |
| `full-tests.txt` | 低並行完整單元 986/986，0 fail／cancel／skip |
| `build-ui.txt` | built UI 成功；既有 chunk-size 警告保留 |
| `worker-ui.txt`、`worker-history-ui.txt`、`worker-wait-ui-current.txt` | 本聊天室範圍四尺寸／縮放／主題、歷史桌面與手機兩尺寸、等待四尺寸全通過；假資料與真 Chromium，不是正式聊天室驗收 |
| `mobile-ui-fixed.txt` | 假 HTTPS／SSE 手機整合通過，6 房／3 次假送出；非實體 Android |
| `attachments-ui.txt` | 13/13，PNG／JPG／TXT／PDF／DOCX／ZIP／MP3／M4A／MP4／LRF 原始 bytes 及選檔／取消／切房／斷線回歸；不等於模型理解全格式 |
| `native-model-ui.txt` | 實際候選原生目錄放入 built selector，桌面 1440／手機 390，各 GPT 7／Claude 10／Gemini 4；Haiku 5.5 efforts 可選，Fable 不出現，6 組通過；沒有送出模型回合 |
| `haiku-native/result.json` | 新 Claude 2.1.293、真 Haiku 5.5／low，純文字標記正確、0 工具、不換模 |
| `native-candidate-acceptance/result.json` | 新 Codex 0.161.0：Sol 主代理先待命、唯一 Luna 子代理回合假拒絕完成、一次通知後原生結果接續正確；2 父回合／1 子回合、modelChanges 空，沒有重派或操作翻譯 |

保留而沒有抹掉的失敗／修正：

- UI wait 舊探針仍期待已結束摺疊，依新規改成不列；手機原本無桌面 header，探針不再誤檢查；切房 fixture 等 React 舊 footer detached，避免驗到上房舊畫面。最終四組成功不是忽略失敗。
- 首次手機整合缺測試證書；只用既有 OpenSSL 產生候選限定、一日 self-signed 假證書後成功，不安裝工具、不複製真人憑證。
- `models-ui.txt` 既有合成探針仍期待 Luna／high，但現在正式規則為 AI 自動／auto，該探針失敗保留，沒有順手改模型預設。另做上述原生目錄 selector 定向實際 UI 驗證六組通過，不宣稱所有舊 UI 探針都成功。
- 官方／候選目錄 initialize 沒有模型回合，和真 smoke 分開。未測所有模型、ultra 自動派工、Fable 真計費／CLI 內部封鎖、agy 非 Gemini 路由、新 CLI 專屬功能、正式 UI 或實體手機。

## 官方來源

- [Codex 0.161.0 release](https://github.com/openai/codex/releases/tag/rust-v0.161.0)、[App Server 公開協定](https://learn.chatgpt.com/docs/app-server)：清單與能力需依本帳號／原生 metadata，不把 TUI／API 特性當 K 接線。
- [Claude 模型設定](https://code.claude.com/docs/en/model-config)、[官方 changelog](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)：Haiku 5.5 最低版本及 Fable 非互動額外用量提示。
- [Antigravity CLI](https://antigravity.google/docs/cli/overview/)、[CLI reference](https://antigravity.google/docs/cli/reference/)、[changelog](https://antigravity.google/docs/changelog/)、[模型說明](https://antigravity.google/docs/models/)：CLI 版本與 IDE／SDK 分開，實際可選以本次 agy 目錄為準。

## 停止與後續更新條件

本批本機程式／測試／UI／真限定回合及真 Opus 討論完成。正式程式與三核心選擇保持原值；沒有更新正式 K、停止工作、重啟、push、切換帳號或計費。測試／失敗／原生歷史原處保留。程式候選與下載檔可一起供本人之後決定升級，**現在停止等待，不自行排程或部署**。
