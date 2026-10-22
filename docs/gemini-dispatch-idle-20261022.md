# Gemini 同帳號派工不再做整機閒置檢查（2026-10-22）

原工作樹 `.runtime/worktrees/gemini-dispatch-idle-20261022`、分支 `gemini-dispatch-idle-20261022`，基底 main `9a2ec97`。程式＋測試提交 `74a7f6c`；本紀錄與索引另作文件提交。實作：Claude Opus 5.5 子代理。已合回 main；**2026-10-22 17:32:06（臺灣時間）南區已部署 `2f46ccc1d0a6ccb6e7a8157ebad559fcc1ab20e5`，程式版已 push 並讀回**。未啟動任何正式 agy，K 保持關閉，實際送出驗證待本人；東區未更新。

## 症狀與機制

- 本人在 Gemini 聊天室送出時出現「Antigravity 正在執行；請先關閉官方視窗並等工作停止，再新增、保存、取消或切換帳號。」，房間標成工作失敗、訊息留在輸入框。10-22 16:09、16:36 各一次。
- 原因：`src/gemini-accounts.mjs` 的 `acquire()` 在 K 自己的 running 計數為 0 時呼叫 `vault.assertIdle()`；`scripts/gemini-credentials.ps1` 的 `Assert-Idle` 用 `Get-Process` 找整台電腦任何 agy／Antigravity 程序。只要有一個 K 沒計入的 agy 存活，一般同帳號送出就被擋。
- 16:36 那次確認是主代理在正式機跑 `agy --version`／`models` 診斷探測時撞上送出。16:09 那次 K 內沒有 Gemini 房或工人在跑、官方 Antigravity 視窗 10/5 後沒開過、同時在跑的測試用的是假 agy，**來源未查明**。
- 設計本意：同帳號多房並行是允許的（running 計數；`docs/gemini-main-fit-20261021.md`「同帳號並行仍可；不同帳號不並行」）。只有新增／保存／切換帳號與登入權杖同步才需要全部 Gemini 程序停止。整機檢查放在同帳號派工上，與本意不符。

## 差異與檔案

| 檔案 | 內容 |
| --- | --- |
| `src/gemini-accounts.mjs` `acquire()`（原第 915 行） | 刪除 `if (!running) await vault.assertIdle();`。同帳號、不需切換、不需同步登入權杖的派工不再做整機程序檢查。 |
| `test/gemini-accounts.test.mjs` 第 835–888 行 | 新增三項回歸測試，見下。 |

保留不動：內部 `activate()` 先 `vault.assertIdle()`（PowerShell 的 activate 也自己 `Assert-Idle`）；`capture`／`startLogin`／`finishLogin`／`cancelLogin`／`prepareLogin`；`drainHandoff`；`refresh`／`refreshAll` 清除 uncertain 時的檢查；`requireIdleLogin()` 對 uncertain／loginPending 的拒絕；`acquire` 結尾 `vault.current()` 身分核對。

讀過 `acquire()` 確認需要整機閒置的路徑仍會檢查：

- 指定不同帳號（`target !== chosen.id`）：先拒絕 running>0，再經 `activate()` → `assertIdle`。
- 工人遇官方額度歸零換下一個帳號：`nextWorkerAccount()` → `activate()` → `assertIdle`（running>0 時前面已改登記等待）。
- 登入權杖需同步（`requiresActivation`）：running>0 時等待；否則 `activate()` → `assertIdle`。
- 開頭 `allRecheckDue()` 觸發的 `refreshAll` 是獨立唯讀查詢，不切換登入，本來就不需整機閒置。

其他檔案沒有派工時的整機檢查：controller、scheduler、handoff、luna-bridge 測試的 vault 都是空的 `assertIdle`，沒有依賴此行的斷言。

## 測試

新增：

1. `same-account dispatch does not inspect machine-wide native processes`：fixture 不閒置時，一般與工人同帳號派工都成功，`calls.assertIdle` 不增加、未 activate；同時 `activate` 與 `startLogin` 仍被 `fixture busy` 擋下。
2. `dispatch that must sync the login token still requires every native process to stop`：`requiresActivation=true` 時不閒置即拒絕、未 activate；閒置後派工並 activate 同帳號一次。
3. `dispatch that names another saved account still requires every native process to stop`：沒有其他工作在跑、指定不同已保存帳號，不閒置即拒絕且登入不變；閒置後切換並派工。

既有測試無需修改；「account changes are blocked while a Gemini task is running」、「simultaneous same-account starts…」等照舊通過。

驗證（均在工作樹）：

- 把程式換回舊版跑 `node --test test/gemini-accounts.test.mjs`：140 pass／1 fail，失敗的正是第 1 項，證明測試抓得到原問題；之後已恢復新版。
- `node --test test/gemini-accounts.test.mjs`：141/141 pass。
- `npm test`：1806/1806 pass，0 fail，約 86 秒。
- `git diff --check`：無輸出。

沒改介面，未跑 `npm run test:ui`。

## 取捨

- 只刪一行，不另加「只看 K 自己的程序」之類的新檢查：K 自己的 Gemini 工作已由 running 計數掌握，同帳號共用登入檔本來就允許並行；外部 agy（官方視窗、其他工具、診斷探測）與同帳號送出並不衝突。
- 風險：本人在官方 Antigravity 視窗**切換帳號**的同時 K 送出同帳號工作，可能用到切換後的身分。`acquire` 結尾的 `vault.current()` 身分核對仍會擋下派工前已發生的變更；派工後才切換的情況與修改前相同（舊檢查也只在 running=0 時做一次）。AGENTS.md 已定 K 取代官方介面、不為兩邊同時使用另建協調。
- 整機檢查留在真正會改寫共用登入的操作，PowerShell helper 的 `Assert-Idle` 也未改。

## 審核與部署狀態

- GPT-6.1 Sol 已覆核（工單 gemini-dispatch-idle-review-sol-20261022，只讀）：結論可合併、無必修；五項皆為備註，無建議修法。Sol 另跑 `node --test test/gemini-accounts.test.mjs` 141/141、`git diff --check` 通過。
- 主代理（Claude Fable 5.1）獨立讀過完整差異，於工作樹重跑 `npm test`：1806/1806 pass、0 fail，約 73 秒。
- 與同日 UI 視覺層次修正合併後，main 已重跑介面建置、`npm test` **1806/1806**、`npm run test:ui` **49/49**。2026-10-22 **17:32:06（臺灣時間）**由 K 外的 Codex App 執行一次更新器，正式套用 `2f46ccc1d0a6ccb6e7a8157ebad559fcc1ab20e5`；更新器再次完整測試 **1806/1806**。
- 已從更新器實際使用的 `D:\K-harness\.local\runtime.json` 讀回完整部署 SHA；816 個 Git 來源檔核對一致（含 Windows CRLF 正規化）。前一版 `fb2754150a52c685d5fc412d94a931e173d61c15` 保留於 `releases/before-1792661526026`，共保留最新三份程式退版。設定差異僅 `version`、`previous`，未操作帳號／對話／瀏覽器資料，未改計費與權限。
- `git push origin main` 後於 **17:34:35（臺灣時間）**讀回遠端完整 SHA 與正式部署版本相同。部署輸出、退版回收證據與完整讀回見 [UI 同批部署紀錄](ui-visual-hierarchy-20261022.md#正式部署與讀回)；本次工程紀錄與索引另作純文件提交，不再部署或重啟 K。
- **K 仍關閉，未做啟動後 health 或正式雙聊天室實測**；不能以程式部署與回歸測試通過宣稱正式互動已驗收。東區未更新。

## 未完成事項

- 16:09 那次的 agy 程序來源未查明；本修正後，同類外部程序不再擋同帳號送出，但若是 K 外有工具定期啟動 agy，仍會擋帳號切換與權杖同步。
- 正式機實測待本人啟動 K 後確認：一個 Gemini 聊天室執行時，在另一個 Gemini 聊天室送出，不再出現「Antigravity 正在執行」；設定頁切換帳號仍要求 Gemini 全部停止。本次部署未啟動正式 agy，也未代本人切換帳號。
