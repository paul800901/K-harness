# Gemini 新增帳號入口與 Opus 複查（2026-10-03）

## 使用者要看到的結果

設定內直接看得到「新增 Gemini 帳號」，不必先猜出要按「保存目前登入」。由本人完成官方 Google 登入，再回 K 保存；取消時可回原帳號。帳號分登入及額度，共用專案設定，不另外建立各帳號的記憶或 Chrome 設定檔。

使用者追加要求交由 Claude Opus 5.5 複查。真實憑證保存／切換另詢問後，使用者已明確回覆「允許，Google 登入由我操作」；只限目前帳號 A 及本人接著登入的第二帳號 B，做 A→B→A。GPT／Claude、Chrome 密碼及其他憑證不在授權內。

## 根因與修改範圍

原 UI 只有帳號清單已有資料時，才顯示「加入另一個帳號」；尚未加入清單但官方已登入時，只有「保存目前登入」，而「登入 Gemini 訂閱」停用。使用者因此看不到如何新增另一帳號。後端已有 startLogin 保存原登入、建立可跨重啟的待完成狀態，再開啟官方登入的流程，不需再建立另一套登入機制。

本輪修正集中在共用帳號元件，以及對應 UI／管理器回歸測試。GPT／Claude 登入、權限、計費、Chrome 資料與語音設定不改。

## 驗證與 Claude 複查

已透過 K 專用 Claude Code 2.1.285、claude.ai Pro／firstParty 官方登入，實際使用 `claude-opus-5-5` 執行只讀複查，exit 0、原生 session `85b61a46-7739-4eee-9c53-ee4ef992333d`。僅 Read／Glob／Grep，未開 shell、MCP、瀏覽器或子代理，沒有改走 API 計費。它閱讀的是明列程式與測試副本，不是讓其接觸登入資料。

| 發現 | 處理 |
| --- | --- |
| 沒有保存帳號時，登入途中重開 K 再取消，新增按鈕可能停用 | 取消後重查官方安裝／登入狀態；UI probe 改為真路由相同的 pending 時 auth 拒絕，加入重新整理回歸 |
| 原本未登入，官方已登入後再取消，該官方登入仍存在 | 採最小且不刪登入的處理：明確說明取消的是加入 K，不是假裝官方登出；假資料測試確認不加清單、不暗中保存／切換 |
| 無法確認登入成功，仍先把新帳號列為目前使用 | 在暫存身分上完成官方查詢，成功才加入清單並標為目前使用；Windows helper 仍會先安全保存使用者按保存時的登入，未驗證不加入 K 清單，也不自動刪除該副本 |
| 官方程式未關閉時，錯誤只寫不能切換，與新增／保存／取消不符 | 提示新增前與保存、取消前都需先關閉官方程式；安全錯誤一起說清楚，不取消 busy 防護、不殺外部程序 |

後端第三項先用新增回歸重現 **31 pass／1 fail**，修後帳號與 helper 假資料測試 **38/38**。另補 A+B 新增 C／取消、工作或官方程式忙碌時不得開始登入，以及無原帳號時官方登入保留但不加入 K 的測試。首次完整測試 **642/642**；補修後完整 **646/646**（33,784 ms），fail／cancelled／skipped 均 0；原生格式補修後仍須在新候選重跑完整測試。

已執行帳號管理器假資料測試 28/28，包含零帳號但原生已有 A 時直接新增 B、完全首次登入、開啟官方登入失敗後可取消還原、未完成登入不假報成功及重新啟動後保存清單。此處未執行 Windows 憑證 API。

## 部署與未驗證事項

目前仍在候選開發；正式 K 未替換，未 push／打 tag，東區不動。真實雙帳號保存、A→B→A、實際 Google 本人登入尚未驗收。首次並行派工遇上帳號查詢的既有限制沿用前份紀錄，不因改好新增入口宣稱已修復。

維護來源：`C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`。證據在其 `.runtime/gemini-login-flow-20261003`。正式 runtime 與舊實驗根目錄分開處理；不覆蓋舊實驗來源。

## 真實驗收發現：原生儲存格式錯誤

取得兩帳號明確授權後先確認 K／Antigravity／agy 均沒有工作，47831 無監聽，才讀取限定 Gemini 身分。第一次 current 得到格式錯誤；只檢查輸出結構，發現 PS 5.1 將 null 輸出成空行。沒有保存或切換。

進一步確認官方本機 agy 1.2.16 執行檔含 Go 的 zalando/go-keyring／wincred，不是先前依 AISW 參考的 Rust keyring。比對[go-keyring Windows 原始碼](https://github.com/zalando/go-keyring/blob/master/keyring_windows.go)，精確目標應為 service:user、秘密為 UTF-8 bytes。只讀精確 Gemini 目標證實存在，根物件是 token/auth_method/id_token；帳號在 OIDC id_token payload.email。未列舉 Windows 憑證、未輸出 token 或整份 JSON。

修正限定 target 為 gemini:antigravity、UTF-8 與 id_token email 解析，不保留錯誤目標的備援。payload 只作帳號識別，官方 /usage 才是登入驗證，不以解碼 JWT 冒稱密碼學驗證。假資料 PS 5.1 測試改用對應結構，另驗證 null JSON；初次誤改測試 -EncodedCommand 編碼造成測試失敗，已改回 PowerShell 所需 UTF-16LE，秘密 blob 仍是 UTF-8，失敗 log 保留。

實際讀回已確認原帳號 A 的安全識別；**19:15:43 開始的 capture 成功保存至 K 專用 Windows 安全儲存並核對原始 bytes／身分，live 登入未改動**。紀錄只含雜湊帳號 ID，不含秘密。第二帳號本人登入、A→B→A 與正式部署尚待下一步；格式修正亦交 Opus 補看。

證據：live-current.json、live-current-format.json、live-current-corrected.json 保留失敗；live-current-native-format.json、live-capture-a.json 是後續成功；helper-native-format-tests.log 為 6/6 假資料與 PS 5.1 測試。

## Opus 首次審查原文（未改寫）

# Gemini「新增帳號」流程只讀複查（Claude Opus 5.5）

**結論：** 這次 UI 改動和後端 `startLogin/finish/cancel` 的主要路徑大致一致。先寫紀錄、再清原生槽的順序正確；開啟失敗或重啟後都還能取消。但有 2 個中度問題，會讓新流程出現 UI 狀態不一致或「取消」名不符實，建議修正後再請本人做真登入驗收。另有 2 個低度問題與幾處測試缺口。

## 實際看過的內容
- `changes.diff`、`scope.json`
- `current/frontend/account-connections.jsx`（全檔）
- `current/src/gemini-accounts.mjs`（全檔）
- `current/src/gemini-credential-vault.mjs`、`current/scripts/gemini-credentials.ps1`、`current/src/gemini-login.mjs`（全檔）
- `current/src/desktop-server.mjs`：讀了第 95–164 行與第 185–199 行，其餘只用 grep 找 gemini 相關內容
- `current/test/gemini-accounts.test.mjs`：讀了第 1–150 行，並 grep 所有 login 相關測試
- `current/test/gemini-accounts-ui-probe.mjs`：讀了第 1–75 行，其餘從 diff 看
- `current/package.json`；`current/AGENTS.md` 只 grep 了 Gemini／憑證相關段落
- 沒讀 `test/gemini-credential-vault.test.mjs`
- git status 裡的 `browser-extension/extension-protocol.cjs` 和 `docs/gemini-login-flow-20261003.md` 不在 packet 內，也沒看。

## 三種情境逐一核對
| 情境 | 後端 | UI | 結果 |
|---|---|---|---|
| 無帳號、原生未登入 | `existing=null`，`previousAccountId=null`（`gemini-accounts.mjs:72-73`） | 空狀態顯示「新增」，pending 面板出現 | 一致；但見問題 1、2 |
| 無帳號、原生已登入 A | 先保存 A 並寫紀錄，再 `prepareLogin`，然後 `start`（`:72-74`） | 列表變成 [A]，空狀態區塊消失，顯示 pending 面板 | 一致 |
| 已有 A+B，目前用 A | 重新保存 A，`previous=A`；取消時以 `restoring` 方式恢復 A（`:85`） | 新增按鈕在 `!geminiLoginPending` 時才顯示（`account-connections.jsx:177`） | 邏輯一致，但後端與 UI 都沒有這個情境的測試 |
| 官方程式開啟失敗 | 紀錄已寫入，pending 保留（`:73-74`） | catch 後重讀列表，pending 面板出現，可以取消 | 一致，後端有測試 |
| 重啟 | `loginPending` 寫在檔案裡 | 見問題 1 | 後端有測試，UI 沒有 |
| 忙碌／狀態未確認 | `exclusive` 加上 `requireIdleLogin` 和 `assertIdle` 擋下 | 按鈕在 `geminiBusy` 時停用（`:174`、`:177`） | 一致；後端沒有測 `startLogin` 被忙碌擋下的情況 |
| pending 期間派 Gemini 工作 | `acquire` 被 `requireIdleLogin` 擋（`:109`） | 給其他元件的狀態設為 `available:false`（`:133`） | 一致 |

## 問題

**1.（中）pending 中重新整理頁面後，取消新增會讓「新增」按鈕卡在停用**
- **原因：** 列表為零筆時，`desktop-server.mjs:108` 會走 `inspect()`，而 `gemini-accounts.mjs:66` 呼叫 `requireIdleLogin()`（`:33`），在 pending 時直接拋錯，回傳 400。前端 `account-connections.jsx:36` 收到錯誤後把 `geminiStatus` 設成沒有 `installed` 的物件；第 174 行的「新增」按鈕帶有 `!geminiStatus?.installed` 條件，所以變成停用。
- **重現：** 無帳號、原生未登入 → 按「新增 Gemini 帳號」→ 重新整理頁面或重啟 K → 按「取消新增」。結果「新增」按鈕停用，標題顯示「無法確認 Antigravity 狀態。」，要手動按「刷新狀態」才恢復。
- **最小修正：** 在 `account-connections.jsx` 第 55 行之後加一行：`if(action==='cancel'&&!current?.accounts?.length)void refreshGeminiStatus();`
- **測試沒抓到：** probe 的 `/api/gemini/auth` mock 永遠回 200（probe 第 40 行），跟真後端不同。

**2.（中低）原本未登入時，「取消新增」不會撤銷剛完成的官方登入**
- **原因：** `gemini-accounts.mjs:85` 在 `previous` 為 null 時只把 `activeAccountId` 設成 null，原生槽裡留著使用者剛登入的帳號 C。前端第 55 行卻提示「原本未登入，沒有原帳號需要恢復」。
- **影響：**
  - 零帳號時，K 之後會直接沿用 C 的原生登入，等於取消沒有生效。
  - 若已有帳號、但開始新增時原生是登出狀態：取消後 C 沒加入 K，之後按「切換使用」會在 `:52` 被擋（「目前登入尚未加入 K」）。有帳號時 UI 又沒有「保存目前登入」按鈕，只能再按一次新增並保存才能解開。
- **重現：** 無帳號、原生未登入 → 新增 → 在官方程式登入 C 並關閉視窗 → 按「取消新增」→ 原生仍是 C。
- **最小修正（建議）：** 先改文案，避免誤導。第 55 行改為「已取消新增；若剛才已在官方程式完成登入，該登入仍保留，未加入 K。」，第 176 行同步調整。
  - 如果要改成真的撤銷：在 `cancelLogin` 中 `previous` 為 null 時呼叫 `await vault.prepareLogin()`。代價是 helper 會先把 C 的憑證另存一份在受管目標（`gemini-credentials.ps1:108`）才刪原生槽，這要由你決定能不能接受。
- **測試沒抓到：** `gemini-accounts.test.mjs:205-213` 取消時 fixture 的 `current` 仍是 null，沒模擬「已登入再取消」。

**3.（低）保存失敗時，新帳號仍被寫入列表並設為目前使用**
- **原因：** `gemini-accounts.mjs:78` 先 `remember` 並存檔，才在 `:79` 檢查登入是否確認成功。若憑證讀得到、但 `/usage` 沒確認成功，新帳號 C 已寫入列表、`activeAccountId=C`，pending 卻還在。UI 會同時顯示「目前使用：c@…」和 pending 面板；取消後 C 會以「尚未確認」卡片留下，而且 UI 沒有刪除入口。
- **最小修正：** 在 `remember` 前記下 `const isNew=!find(identity.accountId)`；確認失敗時，若 `isNew` 就把 C 移出列表，並設 `activeAccountId=null`、存檔，再拋錯。
- **測試沒抓到：** 現有失敗測試（`:225-231`）只涵蓋 `capture` 本身拋錯的情況。

**4.（低）官方視窗沒關時，錯誤文案和提示都不夠清楚**
- 官方視窗未關時，新增、保存、取消都會被 `assertIdle`（`gemini-credentials.ps1:73`）擋下，訊息是「不能切換帳號」（`gemini-credential-vault.mjs:22,45`），跟新增的情境對不上。
- pending 說明只提醒「保存前要關視窗」，沒提醒「取消前也要關」。建議第 176 行補一句「取消前也請先關閉官方視窗」。
- 另外，使用者若開著 Antigravity 桌面程式，第一次新增會直接失敗。這是安全的失敗，只需要文案說清楚。

## 測試覆蓋的實際情況
- `npm test` 只跑 `test/*.test.mjs`（`package.json:8`），**UI probe 不在其中**；它還寫死了 Chrome 的路徑（probe 第 26 行）。
- probe 的「直接新增原生 A／取消還原」只是在驗證 mock 自己的狀態（probe 第 51–61 行），**不等於驗證後端**。與真後端的差異包括：
  - `/api/gemini/auth` 在 pending 時不會報錯
  - `finish` 永遠新增 `acct-b`
  - `cancel` 不檢查 `enabled` 和 `assertIdle`
  - `login` 不會因狀態未確認而拒絕
- 後端測試全部使用假 vault：`prepareLogin` 只是把 `current` 設成 null，`capture` 在 null 時拋錯。**helper 的真實行為完全沒有被測到。**
- 缺少的測試：
  - `startLogin` 遇到忙碌或 `assertIdle` 失敗時被擋下
  - A+B 時新增 C
  - 問題 2、3 的情境
  - UI 在 pending 中重新整理

## 未驗證之處
- **沒有做真 Windows 憑證操作、真登入或 A→B→A。**
- helper 的兩個假設都沒驗證：原生憑證目標是 `antigravity.gemini`，身分是 UTF-16 JSON 裡的 email（`gemini-credentials.ps1:8,54`）。
  - 如果真實憑證不在這個目標，`current` 會一直回傳 null：新增時不會保留任何原帳號，「保存帳號」也會一直失敗（No live credential），只能取消。
  - 如果 JSON 解析失敗，`startLogin` 會在任何改動前就失敗，這是安全的。
- `login.start` 實際開出的官方視窗會不會被 `Assert-Idle` 正確辨識（程序名稱 `agy`／`Antigravity`）沒驗證。
- 已知的首次 acquire 競爭沒有深入看；在 pending 期間 `acquire` 會先被 `requireIdleLogin` 擋下，所以判斷它不直接阻擋新增登入。
- 我沒有執行任何測試、build 或程式；以上全部來自靜態閱讀。

另外，你要求不得寫檔，所以我沒有建立 plan mode 預設的計畫檔，只在這裡回報。