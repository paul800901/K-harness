# GPT 遺留程式整理：跨專案排查（2026-10-15 起）

接續 [K 程式碼盤點](code-audit-overdefense-20260929.md) 與 10-13～10-14 的整理批次，範圍從 K 擴大到本人仍在使用的各專案。各專案的整理細節記在該專案自己的紀錄；本檔只記本人決定、作法、順序與進度。

## 本人決定（原話）

- 順序：「CODEX自己的部分可以最後做 先做其他部分 比如後來創建的各式專案」。K 剩下的零星項目：「這些也是 都納入排查」。
- 協作：「你每次進行排查 都要用子代理ASTRA 極高 一起弄 比如你弄完 他也要知道 討論完後沒問題就算沒問題這樣 兩大地球最強模型一起整理 我不相信弄不好」。
- CaseAgent：「並非不接 以前是K不穩定+沒有你CLAUDE 所以不接 現在不同了」。據此改寫 `AGENTS.md` 第一節與 `README.md`，取消臨床工作排除。
- DSH／KAI：「排在整理CODEX本體之前 你也看看 當初做的東西 問題如何 後來沒碰有很多原因 但GPT沒處理好也是問題」。先只讀檢查、回報問題；要不要修改，看完再由本人決定，`AGENTS.md`「不修改 DSH／KAI」暫不變。
- 範圍：「不是封存的專案 而是還有再用的 比如說錄音轉文字之類的」。主代理先前把 10-12「其他專案沒有做一半的，沒做的都封存了」誤讀成排除其他專案；那句話原本是針對暫存區工作槽。仍在使用的專案清單待本人確認。
- 專案先後：本人看過候選清單後，把「比較久沒動」（Maixu-Anatomy-Studio、kanpan-helper、多AI工作流測試場、caseagent_line_event_sidecar、CapyComic Reader、RenPyPortable、參賽）、「日期看不出來」（ObserveAvatarLab、ObserveVisualNotesLab、EyeBarTracker、VoiceLab）與 E 槽（CaseKnowledgeBase、見觀營運資料庫的業績表工具）指定為「這幾個放後面處理 先處理其他」。
- 討論功能與病患資料：主代理問是否要讓多模型討論避開病患資料，本人答「我不會開討論去討論病例...頂多運營那邊要討論」，不改程式。

## 作法

每一項：Astra（`gpt-6-astra`，推理程度 xhigh）只讀獨立盤點，與 Claude 的盤點並行 → 比對兩份 → 動手 → 交 Astra 複查 → 兩邊都同意才結案。談不攏的列給本人決定。Astra 若寫程式，仍由 Opus 5.5 審。各專案依自己的 AGENTS.md、測試與版本規則；沒有版本控制的專案先補 Git 基準再動程式。

## 順序

1. 見觀營運：社群 repo 的舊內容系統程式；總控、廣告、社群三個 repo 仍在 7/31 的 `codex/*` 分支上，未合回 main。
2. 錄音轉文字、video-deid：沒有可用的 Git（錄音轉文字的 `.git` 是空資料夾）。K 的語音聽寫使用錄音轉文字的執行環境，不可破壞。
3. 小說翻譯潤色：一次性腳本。
4. 最近有動的其他專案：比特幣投資試驗、Antigravity繁中化、AI輔助客戶專案、GitHub Copilot繁中化、幻獸帕魯模組，以及 CaseAgent。
5. K 非 Codex 部分：同一判斷集中一處（工人結束狀態清單仍有 5 處、`canceled`／`cancelled` 並存、`workers()` 回傳形狀相容寫法 3 處）；瀏覽器連線與本機工具伺服器的驗證共用、兩層瀏覽器連線合一；`isolated-desktop` 包裝 `selectWorkspace` 的重複檢查；依原始碼寫法比對的測試改成行為測試；前端 `App` 拆分。
6. DSH／KAI：只讀檢查。
7. K 的 Codex 主控（`desktop-controller` 拆分；沒有 host 時臨時啟動 Codex 程序讀模型目錄）。
8. 放後面的專案：上述「放後面處理」的清單。

## 進度

- 10-15 第 1 項見觀營運：社群 repo 舊內容系統程式封存完成，Astra 同意結案（社群 `d9dfb7a`、`bb03e3b`，總控 `a4c57fc`，皆已推上 GitHub）。細節與後續（影片規則與現行規則不一致、Veo 工具待確認、已發歷史停在 7/29）記在見觀總控 repo `docs/logs/RULES_CLEANUP_BACKLOG_2026-10-10.md`。三個 repo 的 7/31 工作分支 PR 已於 10-11 合併，只剩本機 main 未跟上，收尾提案交 Astra 確認中。
- 10-15 第 2 項錄音轉文字、video-deid：Astra 獨立盤點進行中。K 語音聽寫只用錄音轉文字的 `runtime\`（Python 環境與模型），不用它的程式碼。

## 部署狀態

本檔與 `AGENTS.md`、`README.md` 的修改都是純文件，不重啟正式 K。
