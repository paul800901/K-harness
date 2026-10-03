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

正式程式已替換為 87d0ec2，439 個 Git 檔案及部署資產讀回一致；前版保存在 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791026493023`。不搬對話、語音或其他供應商登入，Codex 設定 hash 與本機設定（除版本／退版位置）不變。**四帳號已保存並逐一驗證可從安全儲存切換，正式四帳號 UI 通過；20:05 原入口重開且正式讀回完成，目前回到原帳號 A。切回 A 時兩次官方查詢未確認，均另做只查額度的刷新後成功，失敗收據保留，未宣稱整批一次通過。** 未 push／打 tag，東區不動。首次並行派工遇上帳號查詢的既有限制沿用前份紀錄，不因改好新增入口宣稱已修復。

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
## 部署後進度與本人登入交接

- 新候選使用既有相依，無安裝／升級；UI、Chrome 擴充、啟動器建置完成，候選完整 **646/646**（35,252 ms），fail／cancelled／skipped 0。
- 主代理獨立重跑建置、多帳號 UI probe、GPT Flash UI probe 均 PASS，不只採用子代理回報。兩個 UI probe 都另跑，不混入 646 的數量。
- 候選真服務 UI 已確認 GPT／Claude／Gemini 登入、新增按鈕可用、目前帳號官方額度、Flash effort；沒有假 API、模型工作或帳號寫入。隱藏 Electron 截圖逾時保留失敗收據，不以切前景修正；後續改讀真 DOM，未把截圖宣稱成功。
- 正式第一次真 UI 等待登入逾時；單獨原生 /usage 仍確認 A 已登入。第二次正式 UI 已讀到三家登入與新增按鈕可用，但額度查詢暫時未確認而失敗；工程腳本的舊 Gemini.*% 條件會誤匹配下方 GPT／Claude 數字，已識別此缺陷，後續雙帳號讀回改逐張 Gemini 帳號卡，不放寬為成功。兩份失敗收據保留；不宣稱正式額度已完成驗收，也不因只讀查詢失敗重送模型工作。
- 官方訂閱 Opus 5.5 同 session 補看 exit 0：確認前述 4 項及原生格式修正，未見直接阻擋更新問題。原文如下；其「寫入尚未驗」是審查時點，後續 A 安全保存已有真讀回，但 B 與切換仍待。
- 19:26:29 執行正式新版的 start 流程：先保存 A，官方 /usage 確認登入及額度，再保存 pending 並清除限定 Gemini live 槽，開官方 agy。19:27:01 A 的官方查詢成功，流程回傳 opened，agy PID 6524 存在。K 保持關閉，等待本人登入第二帳號並關閉官方程式；尚未 finish、activate A 或重開 K。
- 本人截圖確認官方登入選單，已說明選「1. Google OAuth」並按 Enter，不選 Google Cloud project。登入仍本人完成，不讀 Chrome 密碼、不接收 Google 授權碼。
- 接手工程：目前正式資料的 loginPending=true，原 A 憑證已安全保存。使用 `.runtime/gemini-login-flow-20261003/live-accounts.mjs finish` 前先確認本人完成且 agy/Antigravity 已關；其要求 B 不同於 A。完成後 `restore-a` 再核對官方額度，`live-enrolled-ui-readback.mjs` 查真正雙帳號介面，最後普通啟動器啟動與 served readback。不得重跑 start；不能因中斷自行清除 pending 或換第三帳號。

### Opus 補看原文（未改寫）

# 補看結論（Claude Opus 5.5，只讀）

**結論：** 上次的問題 1–4 都已在根因上處理；憑證儲存格式這個真正會擋住流程的問題也已修正。我沒有找到直接阻擋更新的問題。下面兩項建議在真 A→B→A 時順便確認，都不需要改程式。

## 實際看過的範圍
- `followup-packet/changes.diff`（全檔）
- `current/src/gemini-accounts.mjs` 第 39–90 行
- `current/test/gemini-credential-vault.test.mjs` 第 1–50 行，其餘從 diff 看
- 用 grep 核對了 `current/scripts/gemini-credentials.ps1` 和 `current/frontend/account-connections.jsx` 的修改位置
- 第一輪讀過的其餘檔案，這次只看了 diff，沒有全檔重讀
- 沒有執行任何程式，也沒有讀憑證

## 逐項核對
| 項目 | 判定 |
|---|---|
| 問題 1：pending 中重新整理後取消，按鈕卡停用 | **已修。** `account-connections.jsx:55` 在取消後若沒有帳號會重查官方狀態。mock 的 `/api/gemini/auth` 在 pending 時改回 400，和真後端一致；測試涵蓋「重新整理 → 取消 → 新增按鈕重新可用」（probe diff 第 293–302 行）。真後端在 pending 時仍回 400，標題會暫時顯示「無法確認」，可以接受。 |
| 問題 2：原本未登入時，取消沒有撤銷官方登入 | **已改為誠實文案。** 第 55、178 行明講取消不會撤銷官方登入、該登入也還沒加入 K；新測試 `gemini-accounts.test.mjs`「cancel without a previous identity」確認不會加入 K、也不刪除該登入。 |
| 問題 3：保存失敗時新帳號仍被寫入列表 | **已修根因。** `gemini-accounts.mjs:78-82` 先用一個沒放進清單的暫存身分做官方查詢，確認登入成功後才加入清單並設為目前使用。查詢過程中途存檔時，暫存身分不在清單裡，所以不會寫入；身分變動時只會把目前使用設為 null，pending 期間本來就是 null。回歸測試另外讀回存檔，確認只有 A。 |
| 問題 4：官方視窗未關的提示與錯誤文案 | **已修。** 補了關閉視窗的提示（第 176、178 行），忙碌錯誤訊息也改了（`gemini-credential-vault.mjs:22,45`）。 |
| `Write-SafeJson(null)` | **這其實是直接阻擋：** 舊版在 PS5.1 輸出空行，`parseOutput` 會判定「回傳格式無效」，導致「原生未登入」時 `current`／`prepareLogin` 一定失敗，新增流程走不下去。新版 `ps1:52` 輸出 `null`，PS5.1 有實測。 |
| 儲存格式改為 go-keyring | 目標改為 `gemini:antigravity`，內容用嚴格 UTF-8 解碼，沒有加任何備用格式。身分只取 `id_token` 裡的 `email`，要求必須是字串並符合格式，陣列或缺少都拒絕（`ps1:57-68`）。登入是否有效仍要靠官方 `/usage` 確認。原本的 C# 讀寫與讀回驗證都沒動，也沒有新增列舉憑證的路徑（測試第 50 行有 grep 防護）。 |
| 新增測試 | A+B 新增 C 後取消／保存、K 或官方程式忙碌時在任何改動前就擋下、原本未登入但已完成官方登入再取消，這幾個情境的斷言都對準真後端邏輯，不是驗證 mock。 |

## 低優先建議（不擋更新）
1. **`AGENTS.md` 的授權紀錄：** diff 第 12 行仍寫「保存／切換真實憑證仍須前述獨立授權」。你剛授權了「兩個本人帳號保存與 A→B→A，Google 登入由本人操作」。依專案慣例，建議在真驗收前把這次授權範圍補記進去。
2. **helper 測試沒涵蓋的格式錯誤：** 目前沒測 `id_token` 不是三段、或 base64 錯誤的情況。程式碼都會落到 `IDENTITY` 錯誤，判斷正確，只是沒有測試保護。

## 還沒驗證、建議在真 A→B→A 時順便確認
- **寫入與刪除路徑從沒碰過真格式：** helper 測試只抽出 `Get-Email`、`Get-AccountId`、`Write-SafeJson` 三個函式，`capture`、`activate`、`prepareLogin` 的真實 `CredWrite`／`CredDelete` 都還沒在 go-keyring 的資料上跑過。要確認的是：agy 能不能接受 K 寫回的內容（`UserName` 和 `Persist` 會沿用原本的設定），以及切換後 agy 能不能正常查 `/usage`。
- **agy 背景程序：** `Assert-Idle` 只認 `agy` 和 `Antigravity` 這兩個程序名稱。如果 agy 會留下其他名稱的背景程序，並在 token 更新時寫回 `gemini:antigravity`，就可能把剛切換好的帳號蓋掉。建議切換後隔一段時間再讀一次 `current`，確認仍是預期帳號。
- **token 更新後 `id_token` 還在不在：** 如果 agy 更新 token 後沒有保留 `id_token`，`current` 就會開始回報身分錯誤。建議在超過一小時、有過實際工作之後再讀一次 `current`。
- **其他未驗證項：** agy 是否還有其他登入儲存位置、`login.start` 開出的視窗是否真被 `Assert-Idle` 認得，都沒驗證。
- **測試數字是你回報的，我沒有執行：** 包括 38/38、6/6，以及前面那次 31 pass／1 fail。UI probe 仍不在 `npm test` 內，它驗證的是 mock，不是真後端。
- **一般限制：** go-keyring 的格式、`gemini:antigravity` 確實存在，都來自你的回報與公開原始碼，我無法獨立核對。

## 19:42 第二帳號官方資格仍未通過

- 使用者本人完成 Google OAuth、官方初始設定，之後 CLI 顯示 Eligibility Check 失敗。本人再按官方驗證連結，瀏覽器顯示「驗證成功」；未接收授權碼、未操作本人 Google 驗證，也未讀 Chrome 資料。
- 使用者回覆「已關閉」後，重新確認 agy／Antigravity 無程序、47831 無監聽，才執行一次 finish。第二身分確實不同於 A；helper 已安全保存 B，但官方查詢未成功，因此沒有把 B 加入 K 清單、沒有標為目前可用，也沒有清除 pending。
- 19:41:20 開始的 finish 失敗收據原為 `live-finish.json`，後續已完整另存 `.runtime/gemini-login-flow-20261003/live-finish-before-phone-verification.json`。沒有重跑 start，也沒有重送 finish。
- 19:42:21 另做一次只查官方登入的診斷，`--version` 為 1.2.16；`-p /usage` 2,839 ms、exit 1，輸出識別為 eligibility + verify your account，沒有工作區信任／初始化提示。前後身分一致，模型工作數 0。證據為 `diagnose-b.json`；只記分類、長度、退出碼與雜湊身分，不保存錯誤中的驗證網址或 token。
- 可確認是新的官方資格拒絕，不只是舊視窗紅字；不能由網頁「驗證成功」推論 Antigravity 後端已放行，也不能據此斷言是 Pro 訂閱、年齡或地區哪一項原因。
- 目前 A 原登入副本保留；B 的本機副本保留但未列入帳號清單；pending 仍在、原生目前為 B，K 未重開。已詢問使用者是否先取消本次新增、回到可用的 A 並重開 K，或保留現況由本人繼續驗證。尚未代替使用者決定。
- A→B→A、正式雙帳號介面及真實額度不足後工人接手均未完成；不執行依賴成功 B 的後續讀回。沒有 push／打 tag／東區更新，也沒有改計費、其他供應商登入或權限。
- 本階段沒有修改產品程式；完整測試仍以前述 646/646 為準，不能把這次資格拒絕算成通過。


## 19:48 本人確認同帳號及 Pro 後的單次讀回

- 本人提供 Gemini 網頁帳號面板，顯示與官方 CLI 相同的第二帳號及 Pro 標示，並回覆「沒錯啊」。不再以登入錯帳號或沒有 Pro 為推定原因；網頁 Pro 顯示不等於 Antigravity 資格已通過。
- 相隔約六分鐘後，只再做一次原生 /usage 查詢：19:48:54 回傳 exit 1，eligibility + verificationRequired，沒有信任資料夾／初始化提示，身分未變，模型工作數 0。收據 `diagnose-b-after-confirm.json`，前份失敗收據未覆寫。停止重複查詢與登入，不改帳號、安全設定、計費或權限。
- Google 完成頁 https://developers.google.com/gemini-code-assist/auth/auth_success_gemini?hl=zh-tw 可公開讀取，只憑該頁不能判定帳號即時資格。官方 CLI issue https://github.com/google-antigravity/antigravity-cli/issues/785 有使用者回報類似現象，但不是本機根因的證明。
- 本機根因仍未知，下一個有辨別力的步驟是由本人在官方 Antigravity 桌面版確認同一帳號的資格畫面；尚未執行，不把原生 CLI 被拒絕推成整個 Google 訂閱失效。K、pending 及原生 B 狀態保持不變，未切回 A。


## 19:53 手機驗證後通過，使用者擴充至四帳號

- 本人回報官方桌面程式另要求手機掃 QR 驗證，完成後提供同帳號官方額度畫面，Gemini 每週及五小時均 100%。使用者明確要求保存 B、切回 A，再加入第三與第四帳號，並表示所有官方視窗已關閉。此授權已同步補進 AGENTS.md；仍由本人處理 Google／手機驗證，不擴為第五個帳號、其他憑證、計費或 Git 發布。
- 先確認 agy／Antigravity 無程序、47831 無監聽。保留先前失敗 `live-finish-before-phone-verification.json` 並核對 hash 後，才在驗證狀態已變更的條件下執行一次 finish；不是自動重送模型工作。
- `live-finish.json`：19:53:55 官方查詢確認 B authenticated、每週 100%／五小時 100%；兩帳號已加入清單、B 為目前使用、pending=false。這取代前文當時「B 資格未過」的最新狀態，原失敗證據仍保留。
- `live-restore-a.json`：19:54:28 用安全儲存的 A 恢復原生登入，官方查詢 authenticated、每週 97%／五小時 100%，helper 再讀身分確實為 A；不用本人重登。B 已保存且仍在清單，額度標示為非目前帳號的前次查詢，不誤當即時。
- `live-start-c.json`：19:55 先保存 A，再建立 pending 並開啟第三帳號官方登入。目前清單 A+B、active=null、loginPending=true；等待本人第三帳號登入並關閉所有官方程式，K 保持關閉。未同時開第四帳號登入、未重跑第一次 start。
- 後續限定操作腳本 `.runtime/gemini-login-flow-20261003/live-four-accounts.mjs`：收到本人完成後先確認無 agy／Antigravity，執行 finish-c（必須是 A/B 之外的新身分），restore-a-c，再 start-d；依序 finish-d、restore-a-d。每步單獨收據，已有收據先查清結果，不直接重播；不把任一步命令已送出當完成。
- 已完成的是 B 真保存與回 A；仍待 C/D 本人登入、四個已保存身分的重用切換、真正式帳號／額度介面及原入口讀回。沒有送出模型工作；真正額度耗盡的工人接手仍另列未驗。產品程式無新變更，完整測試仍 646/646。


## 19:57 第三帳號保存及回原帳號成功，第四帳號待本人登入

- 本人提供第三帳號官方桌面畫面並回覆「第三個好了」。先重新確認沒有 agy／Antigravity 程序及 47831 監聽，再完成保存；不是只以截圖認定 K 已保存。
- `live-finish-c.json`：第三身分不同於 A/B，19:57:39 官方 authenticated、Gemini 每週 100%／五小時 100%，三筆帳號、目前 C、pending=false。
- `live-restore-a-c.json`：19:58:22 從本機安全保存切回 A，官方 authenticated、97%／100%，helper 身分再讀回一致，不要求本人重登。
- `live-start-d.json`：19:58:25 開始新增第四帳號，先保存 A、再建立 pending 並開啟官方登入。A/B/C 均保留，目前 active=null、loginPending=true；本人操作 D 登入／手機驗證，K 仍關閉。
- 已準備但尚未執行：`live-four-ui-readback.mjs` 檢查四張真帳號卡、逐帳號額度、目前 A、側欄四帳號及 GPT Flash 選單；`live-reuse-four.mjs` 在 D 保存及回 A 成功後，依序從安全保存切到 B→C→D→A，每次確認官方額度／身分，不開登入、不送模型工作。已有收據即停止，失敗先查既有結果，不重播整批。
- 仍待第四帳號本人登入、保存／回 A、四筆安全登入重用及最後正式 UI／普通入口讀回。產品程式無新修改，646/646 不變；尚未 push、打 tag 或更新東區。


## 20:05 四帳號完成與正式重開讀回

### 完成結果
- 本人提供第四帳號官方 CLI 顯示 Google AI Pro、無資格錯誤及官方額度畫面。實際程序檢查確認 agy／Antigravity 都已關閉、47831 無監聽後，20:00:30 `live-finish-d.json` 完成 D 保存及官方 authenticated、每週 100%／五小時 100%，四身分互不重複。
- 四筆登入保存在本機 Windows 憑證管理員的 K 專用命名空間；Node、HTTP 及工程收據只接身分／額度中繼資料，不接 token。Google OAuth、手機 QR 驗證皆本人完成，不搬 Chrome 設定檔、Google 密碼或授權碼，不動 GPT／Claude 登入及 API 計費。
- 已從安全保存實際切換 B→C→D→A，不必再開官方登入視窗。B/C/D 在各次切換後立即查詢成功；A 身分恢復成功但該次查詢未確認，後續單獨刷新成功。最終原生目前身分 A、四帳號、pending=false；不是四帳號同時登入執行。

| 帳號 | 最後成功官方確認（臺灣時間） | 每週 | 五小時 | 證據 |
| --- | --- | --- | --- | --- |
| 原帳號 A | 20:04:48 | 97% | 100% | live-refresh-final-a.json；無再次 activate |
| 第二帳號 B | 20:02:56 | 100% | 100% | live-reuse-four.json 的 B step |
| 第三帳號 C | 20:03:12 | 100% | 100% | live-reuse-four.json 的 C step |
| 第四帳號 D | 20:03:26 | 100% | 100% | live-reuse-four.json 的 D step |

百分比各自屬於該帳號，不合計；非目前帳號標示為前次查詢／舊資料，不假稱即時。上述皆官方 /usage，不是送模型工作或耗盡額度測試。

### 失敗及處理界線
- `live-restore-a-d.json`：20:00:57 開始，A 已寫回且身分讀回正確，但官方查詢 auth=unknown，整步收據 passed=false。沒有重跑 activate；`live-refresh-restored-a.json` 在原 A 不變下只刷新額度，20:02:30 成功，原生 /usage 13,647 ms。
- `live-reuse-four.json`：B/C/D passed steps 均保留；最後 A 的身分已切回，但查詢再次為 unknown，收據仍 passed=false／startedStep=A。未重播整批；`live-refresh-final-a.json` 確認目前確實 A，零次 activate、只查額度，20:04:48 成功，原生 /usage 3,070 ms。不能將整批收據改寫為 passed=true。
- 官方查詢偶發未確認的直接原因仍未定案。沒有提高 timeout、偷偷增加模型／帳號重試、刪除保護或假造 ready；K 既有 stale／unknown 呈現保留。這與 B 先前資格驗證拒絕分開記錄，不能混稱同一根因。
- B 的「網頁驗證成功但原生資格拒絕」失敗完整保留；本人再完成額外手機 QR 驗證後，原生才取得成功的額度結果。不推論所有帳號都必須經相同步驟。

### 介面、測試及正式部署
- `D:\K-harness\.runtime\gemini-login-flow-20261003\live-four-ui-readback.json`：正式 runtime、真後端／真四帳號資料，無 API mock。設定內四張卡各自顯示每週／五小時額度，原 A 為目前使用、切換及新增入口可用，GPT／Claude／Gemini 登入摘要正確；側欄四帳號及額度詳情四卡通過，GPT 新對話 Flash low/medium/high 回歸通過。帳號變更 POST 0、模型回合 0，測試未真的建立新對話。
- 隱藏 Electron 只做 DOM／互動讀回，未將先前截圖逾時冒稱成功；fixture 正常關閉後才由原入口啟動，不並行操作正式帳號。
- 20:05:48 `normal-start-readback.json`：原 `Start-K-Desktop.ps1` 啟動成功，PID 12180、視窗「K 執行中樞」、health deployment=native、正式 workspace／執行檔／版本 87d0ec2 一致。`served-readback.json`：三個正式資產 HTTP 200 且 hash 符合，未授權 /api/state 403。
- 程式測試：維護來源 646/646（33,784 ms）；乾淨候選 646/646（35,252 ms），fail/cancelled/skipped 0。先前帳號 UI 與 GPT Flash UI probe 另跑 PASS；本輪真四帳號 UI 亦另外 PASS，不混入 646。登入實測階段只改工程腳本與說明文件，未再改產品程式。
- 程式／啟動器還原版仍為 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791026493023`，不是對話／登入資料備份；不因程式退版刪除已保存帳號。

### 留存限制
- 真實額度耗盡後的新工人接手、首次多項 Gemini 派工競爭，以及長時間／token 到期後的連續穩定性，沒有在這次四帳號保存驗收中宣稱完成。GPT／Claude 各派 Flash 的先前限定真流程 2/2 證據沿用原紀錄，本輪未重做或擴權。
- 四帳號及原入口可用狀態已達成本輪登入／切換目標；後續不能因理論風險擴改程式。未 push／打 tag、未更新東區、未安裝套件、未清理資料。README、AGENTS.md 及本文件／索引同步至 D 根目錄，未整批覆蓋舊實驗工作樹。
