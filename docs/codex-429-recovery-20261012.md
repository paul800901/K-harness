# Codex 429 單次成果核對與交接修正（2026-10-12）

## 使用者要求與範圍

本人要求修正所有 429 都被排除接續的缺口；之後明確表示「現在是關的，等下可以直接更新上去」。本輪保留原生重試、歷史、壓縮、權限與模型選擇，只修 K 的失敗協調。尚未通過最後驗證的候選不得部署；不操作原翻譯房、不重播工作、不 push、不更新東區。

## 實際根因

- 正式 c1d5e38 的 recoverableError 把 HTTP429 和 rateLimitExceeded 當成已知硬限制一律拒絕；429 本身不足以證明週額度耗盡。
- 我殺了學院玩家在既有目標 blocked 時，真人再送「繼續」，回合在模型尚未回覆／呼叫交接工具前失敗。舊 recovery 只記錄 active goal 所屬回合，因此僅移除 429 deny 仍無法接續。未收到建房工具不能假裝已受理；這次用同一主代理先核對真人意圖、實際成果後再決定。
- 新資格不能依賴 turn/started 比 turn/start 回應早到。第一輪真正 Codex 訂閱假資料驗證重現回應先到，原實作漏接；其證據保留，不能用先前同步 fake transport 的綠燈代替修好。
- 若直接交接已受理，不能在同一失敗後又安排原房核對。獨立反例重現雙派，已由 accepted receipt 消耗該回合的核對資格。

## 最小修正

- src/desktop-controller.mjs：在現有局部分類區分確證硬限制、普通速率限制與其他服務錯誤；硬證據優先。普通 429 使用既有只讀核實排程，單次 30 秒本機冷卻後，同模型核對成果；無顯式預算／原生精確 failed 與同目標 blocked／工人和背景命令確證結束等條件保留。
- blocked 目標的本次 local 真人送出，使用送出所擁有的精確 native turn 綁定，不由歷史或任意原生背景回合建立资格。核對不自行恢復目標；核對後沿既有 goal_resume 或本人要求的 conversation_create。
- 核對換房只信任 adapter 覆寫的原失敗真人 turn ID，仍以當前 audit turn 記收據與核對終態。最新真人、原生身分、模型／權限、停止／暫停／目標變更都核對；程式交接 initial turn 不能變成真人授權。
- src/conversation-controller.mjs：已受理 fresh handoff 的 429 冷卻在建立新房之前；等待期間不持來源鎖，新的真人訊息可以送出並撤销舊交接。等待結束再次核對原生來源；停止或新意圖取消後不留空房、不誤標 uncertain 永久封住後續换房。原生建立／送出結果未知仍不重送。
- frontend/native-notices.mjs：具體 429 類型本地化；不把剩餘百分比與請求限制混為一談、不猜官方恢復時間；原始 error 保留。
- 只等待程式計時，不讓模型持續待命。一次真正成果核對會使用模型額度；若核對仍失敗，仍忠實回報並停止，不无限重試。

## 驗證紀錄（持續追加）

證據根目錄：本 worktree 的 .runtime/429-recovery-20261012。

- 前端 RED→GREEN：ui-red.log／ui-green.log，14/14；原始錯誤／其他供應商／未知碼保留。
- 原交接冷卻 RED 重現提早送出；最初探針本身等 finish 才查造成錯誤觀測已修，失敗 log 保留。最後 strengthen 後不吞 human-send 例外，實際斷言新訊息送出與取消為 cancelled。
- 真 conversation＋desktop controller、假 native transport：原本已受理→429 與 429→單次 audit→fresh handoff 兩條路徑各建立／交接一次，沒有 fork、原房雙派或重播。
- 第一輪全套1492：1490 pass／2 fail，兩項既有 raw turnError 契約因非429也多了 observedAt。最小修正只在 rate 類型保存冷卻時間；沒有放寬或改寫原測試期待。
- 第一輪真原生 native-e2e：Codex 固定官方核心、真正 gpt-6.1-sol、全新假資料目標 blocked、原已存 stage1 不變；只在 K 邊界將首回合 completed 注入為 429。240秒觀測到 0 audit、stage2 未產生，證明 response-first 漏接。不是上游真429重現；正常關閉自有假房，原房操作0。
- 真正 Opus5.5 首審：Claude Code2.1.294、claude.ai firstParty/pro、回傳 claude-opus-5-5、19次只讀工具、session 13fb2d56-dc12-4281-bccc-e7090cc18fee。提出建房後鎖內冷卻 B1、response-first 資格 B2；兩項均採納必要修正。未採額外產品測試設定建議，不為此另建框架。首審不等於末審通過。

## 狀態與邊界

目前仍在候選最後驗證，尚未套用；後續正式更新及來源／設定／桌面手機讀回結果另追加。沒有證明上游限流永不發生，也不宣稱所有長任務問題已解。查核未提供的 Retry-After／官方重設時間保持未知。原房已失敗的歷史不會因安裝新版自動復活。

## 候選完成與獨立驗收

- 最終全套 full-suite-v2.log：**1495/1495**，0 fail／cancelled／skipped，4並行；Sol response-first focused **314/314**，Astra conversation focused **74/74**。原失敗原件保留，沒有改寫舊測試期待。
- 最終真正原生 native-e2e-v2：官方固定 Codex 核心＋gpt-6.1-sol，新假資料房 `01a12f4e-ab0c-7b51-b27b-8a75b34d3e3c`；注入終態後 **30,021 ms** 才送一次 `k_native_goal_recovery`，兩次 turn/start 僅原始假資料回合＋一次核對。實際順序為 conversation_context → 讀 stage1 → goal_resume → 建 stage2 → 讀回兩檔 → 原生目標 complete。stage1 SHA／mtime未变，stage2正確；原房操作0，假房正常關閉。這是故障邊界注入的真模型成果驗證，不是宣稱真上游429已重現／消除。
- Opus 增量複查 opus-r1 實際回傳 `You've hit your weekly limit`，exit1／is_error=true，session `db030cd0-fa9b-4266-a8bc-52904fc30e31`，5次只讀工具後停止。**沒有末審通過**。依本人先前「CLAUDE額度應該不足，如果真不夠這次複查就算了，你處理好」的限定豁免，Astra獨立檢查最終diff、兩項阻擋修正、真原生工作順序及全套回歸後接受候選；未切帳號／模型／API計費重試複查。
- 最終 desktop SHA256：`7c0476b377884c4e0828dd0998d1941fef922088b21a6d12c43c29ef4cacef3c`。沒有新增第三方套件或模型常駐監工。
- 使用者已關閉並允許直接套用，候選可進正式封裝與獨立讀回；部署尚未由本節宣稱完成。

## 正式更新與獨立讀回（2026-10-12）

- 本人本輪明確表示「可以，现在是关的，等下可以直接更新上去」後，Astra 核對正式程序／監聽埠為0，單次套用固定版本 `2a185098b643d7bea919f6c0d0791405fb1ea1a6`。正式來源為 Git archive 的690個檔案，封裝及安裝後均逐 bytes 核對零差異；三項建置成功，封裝 focused **407/407**。
- 證據：`D:/K-harness/.runtime/native-429-recovery-deploy-20261012`。`activation.json`、`installed-source.json`、`formal-readback.json`、`launcher-rollback-readback.json` 分別記錄套用、來源、正式服務介面與入口／退版讀回。舊程式 `c1d5e38` 保留於 `D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1791795702897`；這是程式退版，不是對話資料快照。
- 正式 owner 實際啟動，health200、未授權state403、實際送出的JS/CSS與安裝檔一致；1440×960／390×844 介面、30房側欄及截圖由 Astra 讀回，0 POST／0頁面錯誤／未開任何原工作房。這是桌面／手機尺寸瀏覽器驗證，不是實體手機USB或Windows捷徑像素驗收。
- 78個原metadata完整hash／清單與5個資料位置／清單不變，核心選擇、Codex設定、專案及Google設定不變。Gemini帳號檔僅目前帳號三個正常查詢時間（auth.checkedAt、quota.checkedAt、lastQueryAt）更新，逐欄核對；沒有切帳號、改額度、搬憑證或更改計費。原始cache前後證據均保留。
- 更新前驗收第一次直接比較 worktree CRLF 與封裝 Git LF 被拒，當時未執行activation；隨後確認差異僅換行且封裝精確等於固定Git，並非產品漂移。正式讀回後停止檢查第一次證據檔名不在腳本既定選項內，被參數檢查拒絕；改用既定名稱完成檢查，沒有改寫產品或繞過停止核實。
- 正式驗證後正常關閉自有owner，K保持關閉，程序與47831／5199監聽均為0；兩個既有Chrome native host原樣保留。未強制停止、恢復原翻譯房、重播工作、push或更新東區。原房歷史失敗不因安裝自動復活；本人下一次明確接續後才按新版流程處理。
- **本次429協調修正已正式更新並完成上述讀回**。Opus增量仍是額度不足、沒有末審通過，沿用本人限定豁免與Astra獨立驗收。上游限流仍可能發生；30秒只是本機一次等待，不是官方保證恢復時間。真正成果核對需要模型額度，程式等待不使用模型待命；若核對本身仍失敗，不無限重試。

## Opus 5.5 末審補做（2026-10-14）

當時增量複查因 Opus 週額度用完中斷、未有末審。2026-10-14 由 Claude Opus 5.5（`claude-opus-5-5`，K 內 Claude Code 對話）閱讀 `2a18509` 的 `src/conversation-controller.mjs`、`src/desktop-controller.mjs`、`frontend/native-notices.mjs` 全部差異後補做：

- 結論：**通過，無阻擋問題，不需修改。**
- 核對項目：硬限制（401／403、額度／預算／上下文／權限等代碼與文字）優先於 429，剩下才歸為一般限流；冷卻以同回合首次觀測時間起算、不因重複事件重設；冷卻期間釋放來源鎖、結束後重新上鎖並重新核對本人意圖與來源狀態才建房；取消或關閉時 `cancelWait` 立即中斷等待（`close()` 先取消所有換房，不會卡 30 秒）；交接受理後清除該回合的目標核對，不雙派；官方確認零額度時不建立交接；只有綁定本次最新真人訊息的受阻目標回合可觸發單次核對。
- 觀察（不改）：硬限制的文字比對範圍偏寬，誤判方向是「停止、不自動接續」，屬安全側。
