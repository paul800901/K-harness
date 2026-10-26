# GitHub 儲存庫大整理（2026-10-26）

## 起因

本人問 AI 能不能讀 GitHub；確認沿用本機已登入的 `gh`（帳號 paul800901，Windows 憑證管理員），不另做 K 專用連接器（理由：已可用、三家都能透過指令使用、另做要新憑證與維護；日後若遇到手機直接瀏覽、嚴格唯讀或 Gemini 沙盒不能連網等具體限制再考慮）。接著本人要求盤點 GitHub 上的舊儲存庫：沒用的收掉、落後的整理好，多為 GPT 早期留下的技術債。

## 盤點（10-23）

23 個儲存庫，與本機副本逐一比對（不 fetch，用 GitHub API 讀遠端 SHA）。本人逐項決定：

| 儲存庫 | 決定 |
|---|---|
| K-harness、見觀營運五庫、GitHub Copilot 繁中化、帕魯三模組 | 保留、整理尾巴 |
| patient-portal | 保留。是 CaseAgent「LINE 對話工作台」的 Railway 部署來源（README 寫明正式入口），程式 9/15 後沒改不代表沒在用 |
| kanpan-helper（看盤助手） | 沒人用，全部收掉 |
| CaseAgent_Solo、ObserveOS-Build-Week、-BodyAlign-v12d、SpineVision | 封存 |
| maixu-linchang-single-store-runtime | 檢查無依賴後刪除 |
| kai-harness、dsh-official-zh-tw、maixu-linchang-custom、kai-work-host、gpt-web-codex | 本人要晚點再考慮，這次不動 |
| antigravity2.0-zh-tw（fork，落後上游 19 筆） | 本人表示 K 取代官方介面後繁中化不太重要；這次未動 |

## 實際處理（10-26）

- **kanpan-helper**：兩個每日 workflow 停用、GitHub Pages 取消、Copilot 7 月開的 PR #1 關閉並刪分支；本機唯一未上傳分支 `codex/duplicate-threshold-075-tests`（同一門檻修正＋回歸測試）推上保存後封存。本機 `D:\kanpan-helper`、桌面 `kanpan_helper_github_sync` 移入資源回收筒（無 junction、無 Windows 排程）。
- **封存四庫**：CaseAgent_Solo、ObserveOS-Build-Week、-BodyAlign-v12d、SpineVision。BodyAlign 公開庫內有 `bodyalign.sqlite3`，唯讀檢查 patients 表只有 1 筆且姓名、電話皆空（其他識別與日期欄位有值）；已封存，未改寫歷史。
- **刪除 maixu-linchang-single-store-runtime**：GitHub code search 無引用；本機唯一提及是 `D:\DSH架構\maixu-linchang-custom\README.md`，明寫為舊佔位庫、用途不同。8 個分支中只有 `security-hardening-2026-06-30` 有兩份短筆記，先存到 `D:\封存\舊脈序臨場\single-store-runtime-docs` 再刪；刪後 API 讀回 404。
- **AwakeningCrystalConverter**：9/20 未提交的修改是移除工作燈腳本的伺服器授權閘門，讓多人客戶端燈號也更新（腳本只換本機材質，不寫遊戲狀態），測試已含客戶端情境；`tests/run.ps1` 全過。提交 `c008bf4`，另把 9/11 四份未追蹤開發筆記收進 `docs/`（`293d2cb`），連同 10-16 未上傳的 `13cec6d` 一起 push，遠端讀回一致。未發布工作坊，需遊戲內多人實測。
- **PalSkillDPSAnalyzer**：10-16 未上傳的說明文字提交 `3759cb1` 快轉推上 main；遠端 3 個舊 `codex/*` 分支刪除（其中兩個有 1 筆提交，`git cherry` 確認 main 已有等價修改）。舊 worktree `PalSkillDPSAnalyzer-v0.5.41-release` 只剩忽略的建置產物，先拆內部指向主資料夾的 `.toolchain` junction（拆後主資料夾 .toolchain 仍有 298,451 檔），再移入回收筒並 prune；本機只留 main 並改追蹤 origin/main。`D:\PalSkillDPSAnalyzer`、`D:\PalResourceFactoryMod` 是指向「幻獸帕魯模組」的 junction，不是重複副本，保留。
- **PalResourceFactoryMod**：GPT 從未提交的建置／安裝／探測工具、Unreal 專案骨架與 8–9 月研究筆記收進 main（`7834ac0`，66 檔；推送前掃過金鑰樣式與私人路徑）。Unreal 編輯器自動產生、含 Android File Server SecurityToken 的 `unreal/Config/DefaultEngine.ini` 加入 `.gitignore` 不上傳。9/20 未經遊戲測試的「多人開房主機也能結算」修改（3 個 native C++ 檔＋測試說明）另放分支 `listen-host-test`（`4dd8cc9`），main 維持已發布 v0.3.20 的行為。注意：本機遊戲目前裝的是 9/20 這版測試 DLL（備份與還原方法見該分支 `docs/LISTEN_HOST_TEST_20260920.md`）。

## 驗收（GPT-6.1 Sol，只讀，high）

逐項查證 GitHub 與本機狀態均屬實：封存、workflow 停用、Pages 404、分支與遠端 SHA、刪除庫 404、本機路徑、`.toolchain` 298,451 檔完好；DSH／KAI 五庫、patient-portal、見觀五庫、K-harness 未被這次動到。listen-host 放分支、覺醒水晶燈號修正範圍、PalSkill 刪除分支無獨特內容遺失，判斷合理。結論「可結案」，另提：

- **必修（已處理）**：`listen-host-test` 分支說明仍寫「沒有發布 GitHub」，已改為「當時未發布，10-26 推到分支保存、仍未合入 main 或發布工作坊」（`5ade58e`）。
- **補漏（已處理）**：PalSkillDPSAnalyzer 本機還有 9/19 的 stash（基底 v0.5.28，16 檔）。比對後：HUD 退出／閒置修正已隨 v0.5.29 發布；其餘「野外 Boss 接受基地帕魯、F3 Widget 重建」是當時刻意未發布、未經遊戲驗證的改動（主線 CHANGELOG 明寫未納入）。以 stash 的完整 tree 建立分支 `field-boss-base-workers-wip`（`164055a`，tree 與 stash 相同；stash 內唯一未追蹤檔與 main 相同）推上後 drop stash。
- **界線**：BodyAlign 資料庫該筆姓名電話為空，但其他識別與日期欄位有值，只能說「沒有姓名電話」。覺醒水晶「未發布工作坊」只由 GitHub release 推知，未直接查 Steam。
- **建議（未做）**：`7834ac0` 有 17 檔含建置／遊戲路徑（如 `D:\PalSkillDPSAnalyzer`、Steam 安裝路徑），兩庫較早的 Blender 檔與舊 README 含使用者資料夾路徑；未見金鑰、權杖或病患資料。都是既有公開內容，非憑證，暫不改寫歷史。

## DSH／KAI 第二輪（10-26 下午）

本人決定：
- maixu-linchang-custom、kai-work-host、gpt-web-codex 沒用，封存（kai-work-host 先關 5 個 Dependabot PR）。已做。
- **dsh-official-zh-tw 與 kai-harness 保留，是「學習用」的兩個獨立專案，不是封存**：DSH 偶爾開來測 DeepSeek 新模型能力、追蹤開源第一的做法；KAI 是 DSH 版的 K（K 的前身），日後部署開源方案時參考其做法。要寫清楚、不要亂。
- antigravity2.0-zh-tw 放著不動。

處理：
- 兩庫 GitHub 說明改為上述用途；關閉 Dependabot PR 共 20 個（DSH 11、KAI 9）。
- 第一次盤點誤判更正：KAI 最終版（`D:\DSH架構\DeepSeekHarness-0.1.2-alpha.3-KAI-exact-20260905`，9/1–9/5，含 candidate 線）、`D:\KAI\kai-harness` 的 phase-1-1 領先 13 筆、DSH 10-05 的 0.2.1 升級，**原本都只在本機**（初次盤點的比對把 gh 404 錯誤輸出誤當成存在；之後改用退出碼判斷）。
- 上傳被 DSH 官方原始碼自帶的 lefthook pre-push 檢查擋下（需要 pnpm；`postinstall` 自動掛上）。本人確認上傳目的地是自己的私人庫、等於雙重備份後同意略過；本人另說可裝套件，但裝 pnpm 後仍要在 DSH 資料夾裝整套相依才能跑檢查，對純備份不划算，故以 `--no-verify` 推送。
- kai-harness 關閉 Actions（原本每天跑 Dependabot，推送也會觸發 20 組 CI）；DSH 原本已關。兩庫刪 `.github/dependabot.yml`（本機各一筆提交 `9a25311`、`7b686aa`）。
- KAI 最終版推為 `kai-final-20260905` 並設為預設分支；phase-1-1 推上；DSH main 推到 `7b686aa`。遠端 SHA 全部讀回一致；本機未提交檔數不變（KAI exact 25、DSH 0.2.1 10）。

## 官方 DSH 升級到 0.2.1-rc.3（10-26 晚）

本人要求升級但不影響繁中語言包與本機外掛。沿用 10/18 rc.2 的流程，詳見 `D:\DSH架構\官方桌面版\客製桌面建置-0.2.1-rc.3\README.md`：
- 官方 nightly 來源下載 rc.3，大小、SHA-512、DeepSeek 簽章核對通過；官方安裝換成 rc.3，rc.2 改名保留。
- 同一套 `build-local.cjs` 重建繁中桌面客製版：殼層只差版本字串，精確片段全部比對成功；18,181 原檔不變、改 7 檔；`menu.test.cjs` 3/3。
- 新增官方外掛「介面自訂」：補套件中文說明與 5 句介面文字（語言包 `dictionaries.json` 與建置檔同步）。
- 回收保護依賴的官方元件比對無實質變化，版本鎖加 rc.3；暫存 profile 實測三外掛皆載入、回收狀態 enabled；`trash-store` 8/8。
- `開啟 DSH 桌面版.ps1` 改指 rc.3（舊入口備份）。未開啟桌面視窗、未送對話；暫存解壓與測試資料夾移入回收筒。

## 本機 DSH／KAI 資料夾整理（10-26 晚）

本人確認脈序臨場聊天室已結束後開始；並接受「搬動的舊版本可閱讀但相依套件連結失效、要執行須重裝」。檢查：無程序使用、桌面捷徑只指向 `官方桌面版`、K 工作區清單只登記 `D:\DSH架構` 根目錄（其 `.runtime` 不動）。

- KAI 兩份從 `D:\DSH架構` 搬到 `D:\KAI`：`KAI候選版-20260901`（Git 主庫）、`KAI最終版-20260905`（其 worktree），`git worktree repair` 後讀回正常，未提交檔數不變（366／25）。主庫上 4 個已不存在的 9/3 測試 worktree 先以標籤 `kai-job-20260903-154241`、`-165419`、`-191231` 保存其未被分支包含的提交，再 prune。
- DSH 0.1.0-rc.5、0.1.1-rc.2、0.1.5-rc.2 與封存包、8 月測試報告移到 `D:\DSH架構\舊版本`（Git 狀態與 stash 讀回不變）。`官方桌面版`、`DeepSeekHarness-0.2.1-alpha.1-local`（客製腳本借用其 node_modules）不動。
- KAI 周邊 7 個資料夾移到 `D:\封存\KAI周邊_20261026`；脈序臨場交付包併入 `D:\封存\脈序臨場_20261026`。
- 回收筒：`D:\DSH架構\node_modules`（只有 vite 快取）、空的 `D:\KAI\kai-worktrees`、Codex 遺留的 KAI worktree `~\.codex\worktrees\4f17`（乾淨、提交已在 10 個分支內、無 junction），之後 prune。
- 兩資料夾 `README.md` 重寫：各資料夾用途、DSH 升級步驟、已移出項目。

## 未完成／待本人

- rc.3 桌面版實際開啟與試用待本人。
- 本機未提交修改原樣保留（KAI 候選版 366、最終版 25、kai-harness 9、DSH 0.2.1 10、舊版若干），未判斷內容價值。
- 覺醒水晶轉換器客戶端燈號、資源工廠多人開房（分支 `listen-host-test`）、帕魯 DPS 野外 Boss 基地帕魯（分支 `field-boss-base-workers-wip`）：都要遊戲內實測後才可合入或發布。
- 純外部儲存庫與本機整理，K 程式未改、不需部署。
