# 舊 Claude 聊天室看不到新派工模型（2026-10-28）

## 問題

本人提供畫面：10/26 建立的 Claude Opus 5.5 聊天室（考卷排版）說「可派的模型清單裡沒有 GPT-6.1 Terra」，但主模型選單已可選 6.1 Terra。本人先判斷是當初新增 Terra 時漏加。

## 實查與根因

- 不是漏加。Claude 主房的「目前官方可派模型」由 `src/worker-policy.mjs` 在每次啟動 Claude host 時從原生目錄動態產生，經 `claude-controller.mjs` 的 `workspaceInstructions` 併入 `--append-system-prompt`；沒有型號白名單。K 專用 Codex 的 `models_cache.json` 也列有 `gpt-6.1-terra`（`visibility: list`）。
- 掃描近期各 Claude 對話的原生 `api-request-shape`（`.runtime/archive/claude-prompt-snapshot-20261028/terra-scan.txt`）：10-27 起新建的對話清單都有 Terra；10-25／10-26 建立的舊對話（`69cb4948`、`1892be44`）在 10-27、10-28 重啟後仍是舊清單。考卷房 10-28 13:18 實際送出的系統提示也缺 10-27 新增的派工協定與共同記憶指標，證明整段 append 停在建立當天。
- 原因是 Claude Code 原生 `--system-prompt-snapshot`（預設 on）：對話第一次請求時記錄系統提示，之後每次請求與續接原樣沿用，即使之後啟動傳入不同文字，直到壓縮為止。K 每次啟動傳入的派工清單、協定、工作區規則、桌面控制說明因此對舊房無效。
- 共同記憶正文走回合內區塊，不受影響。

## 修正

- `src/claude-host.mjs`：Claude host 啟動參數加 `--system-prompt-snapshot off`，讓每次啟動都使用 K 當下傳入的內容。主房、工人、討論與分支共用同一組參數；工人每次都是新對話，沒有差別。
- `test/claude-host.test.mjs`：假 CLI 確認此參數為 `off`。
- K 保留的 Claude Code 2.1.285～2.1.312 各版 `--help` 都有此參數。

## 驗證

- 真實 Claude Code 2.1.312（haiku、暫存資料夾、K 專用設定目錄）實測，收據 `native-probe.txt`：
  - on：建立帶 ALPHA-7，續接改傳 BRAVO-9，仍回 ALPHA-7（重現問題）。
  - off：續接回 BRAVO-9。
  - 以預設 on 建立的舊對話，改用 off 續接也回 BRAVO-9，所以既有舊房更新後下一次啟動就會拿到現行清單。
- `test/claude-host.test.mjs` 16／16。

## 取捨

- off 會讓 Claude Code 每次請求重新產生系統提示。K 的 append 內容在 host 程序存活期間固定，日常仍可沿用提示快取；只有內容真的改變（重啟後清單變動、工作區規則或記憶索引變更）時才重新快取，這正是想要的行為。
- 未改成回合內附派工清單：工作區規則、協定、桌面控制說明同樣被凍結，只補清單會留下其他舊內容。

## 完整測試

- 完整 `npm test`：2,014／2,014，無失敗／取消／跳過（`full-test.log`）。未改介面，未跑 UI 測試。

## Opus 5.5 複查

真正 Opus 5.5（high）唯讀複查 `review-claude-prompt-snapshot-20261028`：判定為最小完整解、可合併，無阻擋問題。

- 只對主房加會漏掉同樣帶共同記憶指標的討論路徑；改回合內附清單要多送 token、多寫程式。兩者都不採用，與主代理判斷一致。
- 提示快取：同一程序內前綴不變，照常命中；只有內容真的改變或 CLI 升級時才失效。跨午夜日期變動可能多一次失效，屬推測、影響可忽略。
- 工人、討論（plan／safe-mode）、`--fork-session`＋`--resume-session-at` 都只是同一參數陣列，沒有衝突；分支會用這次啟動的提示，不繼承父對話舊記錄。
- 測試足夠，不需為各路徑重複斷言。
- 低嚴重度意見：`inspectClaude` 最低版本是 2.1.280（為 Opus 5.5 設），參數只確認 2.1.285 起存在。**未採納提高門檻**：K 專用 Claude Code 先前已經本人授權升到 2.1.285，南區最舊保留版即 2.1.285 且已確認支援；改門檻要動多個測試假資料，超出本修正範圍。東區更新時須確認該機 K 專用 Claude Code 不低於 2.1.285，否則啟動會因不認得參數失敗。
- 複查提醒補工程紀錄：即本文件與索引。

## 發布狀態

- 程式版本 `8859fff6169cbfad56c77214bae50339c903af2e`（基線 `aff7b7c`）。程式與本紀錄分開提交，合回 `main` 後寫 `.local/update-ready.json`，由本人按側欄「更新」部署；部署與 push 讀回待補。
- 東區未更新。考卷房等舊 Claude 聊天室要等南區更新後、下一次啟動該房時才會拿到現行清單。
