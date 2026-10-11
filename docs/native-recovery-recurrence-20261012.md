# 長任務再次失敗：原生錯誤狀態與 Windows 工作列漏通知

狀態：候選修正已完成，正式仍為 `4ba2d5b6987cd44b3e684cd05b45a5477685b15b`。2026-10-12 本人回報兩房不到三小時再次失敗，並指出 Windows 工作列沒有提示。本人其後明確回覆「K 還在工作，先不要更新」；本批只保存候選，不停止、重啟、重送、部署或排程更新，等本人另行通知。

## 現場唯讀證據

- K 啟動紀錄為 2026-10-11 21:29:35（臺灣），程序從正式 trusted-runtime 開啟，安裝 controller SHA256 `20a540f09272d6a1014f964eec45b5553277180ab9b44618ac32ee2a7635a16c` 與前批驗收版相同，不是使用者未更新。
- Pick Me Up 分支於 23:19:20 最終 failed，普通 stream disconnected；拳王轉生於 23:56:23 最終 failed，remote compact stream disconnected。兩房目標皆 blocked、tokenBudget=null，不是目標用量上限所擋。原生已先自行重試，K 未收到後續 audit turn。
- failed 後的原生 host 請求紀錄持續成對出現 `thread/goal/get`、`thread/read`，退避至每30秒；穩定階段沒有進入下一個 `thread/turns/list` 或 `turn/start`。這是本機程式查核卡住，不是模型一直推理待命。原始資料庫與 rollout 只讀，沒有在原房開模型回合。
- Astra 00:18:56 的獨立讀回確認上述兩房 failed/blocked；鐵血劍獵犬與我殺了學院玩家仍 inProgress/active，因此不能為更新而中止它們。

## 直接根因與前次驗證盲點

1. 固定官方 Codex0.161.0（公開 commit `979011409de0a60b52f179721948e65531d26144`）的 `EventMsg::Error` 會設定 `systemError`。`note_turn_completed` 只清 running/pending，不清該錯誤旗標；下一個 turn 才清除。因此「已失敗且沒有執行中的主回合」不一定回到 `idle`。
2. K 自動核對 preflight 卻只接受 `idle`，遇真實 `systemError` 就等待，下次讀回仍相同，永遠到不了核對回合。改成接受 `idle` 或 `systemError`，其後仍須精確 failed turn、同一 blocked 目標、相關子代理確證結束、原生背景清單空、沒有核准/提問/停止及未知送出等原有查核；不是忽略錯誤或直接重播。
3. 前次真模型 E2E 是正常完成後，在 K 邊界注入 failed；原生內部仍是 idle。它證明成果核對及接續順序，但沒有覆蓋真 Error 造成的 systemError。本次明確補這條協定序列，不將前次結果當長任務穩定性證明。
4. Windows 工作列只訂閱 completionAttention，而後者把 failed/error/uncertain 直接排除，既不加入未讀也不增加序號。因此真正失敗不可能觸發原有工作列提醒。候選沿既有未讀/短閃爍機制加入「需注意」，不當成成功完成、不搶前景、不新增通知服務或設定；確定停止、原生仍在重試、舊歷史與重複事件不誤報。若停止本身無法確認而成為 uncertain，仍可能提醒，這是真正需注意而非成功停止。

## 證據與限制

全部本輪本機證據位於 `D:/K-harness/.runtime/native-recovery-recurrence-20261012/`。`stream-readback.json`／`rpc-retry-summary.json` 保存唯讀投影與原始位置；`astra-readonly-incident-check.json` 是主代理獨立查詢，不把子代理回報直接當真值。

服務端為何 compact/stream 失敗仍未知；本批修 K 的已證接續門檻與通知缺漏，不聲稱供應商永不出錯、長任務記憶偏移已根治。原生仍在工作的其他房、原對話/設定/帳號/計費不改。

自動核對原有範圍不擴張：只處理本次 live 歸屬的持續目標、無顯式 tokenBudget、同主代理一次核對；本人停止/暫停/變更優先、不從歷史或重新啟動復活舊 failed 工作。正式套用及最後驗證需在本檔後續讀回後才能標完成。

## 候選驗證與真正 Opus 複查

- Astra 最後全套 `node --test --test-concurrency=4 test/*.test.mjs` 為 **1296/1296、0失敗／取消／略過**（66.36秒），`full-final-concurrency4.log`；較早1295全套與其後追加39項聚焦紀錄均保留。主代理逐檔核對四個產品檔與 Opus 凍結包相同、獨立讀真核心事件／兩次loopback請求及自有host正常退出、真Electron鏈、UI截圖及正式仍舊版本。接受收據 `astra-candidate-acceptance.json`，狀態僅 candidate_verified_not_deployed_os_pixels_pending。
- 固定官方 Codex 0.161.0 binary SHA256 `a0f89acca07a511734cac7fddee26b2106fab68918717bc90df16104a0760a30`，新空 CODEX_HOME／假工作區、localhost 假 Responses 回傳真正 SSE response.failed。只替代 account/catalog 等 bootstrap，不替代 goal／turn／thread status：真核心送 systemError→failed、真 thread/read 回 systemError，候選只派一次同 thread/model/effort 核對；核對再次失敗也沒有第三次派送。兩次 HTTP 全部 loopback，兩個自有 host 均正常退出 code0。這是真核心協定與假模型，不是真 Astra／Sol 推理或供應商服務故障重現。證據 `native-error-observable.json` 與其指向的完整 raw result。
- controller SHA256 `417ab2a5a4dab0aec23d0fca865128f887aba7c0aa8feebfdf84b17d432e65ad`。接續新增兩項回歸由 RED 變 GREEN；38/38、六檔149/149。Opus 後僅補 latest 仍 inProgress／ID 不同不得派送的負向測試，最終39/39；沒有再改產品條件。
- 通知 RED 為24項中6失敗；修後相關60/60。真 createConversationController→假 session 終態→真 taskbar controller→真隱藏 Electron 44.4.5，三種失敗均正確呼叫 setOverlayIcon／flashFrame，精確房間及序號已讀清除；0 show/focus/showInactive、0原房操作、0模型回合。證據 `attention/electron-conversation-result.json`。**Windows 工作列实际圖示像素尚未驗收**，隱藏視窗 API 成功不能冒稱使用者桌面已目視確認。
- UI build 成功，實際 built UI 五組桌面／手機、100/125/150%及暖／淺／深色通過，0 pageerror；驗失敗文字保留、側欄「工作需注意」、精確已讀及遮罩／斷線不誤清。證據 `attention/ui-restored-coverage/result.json`。原三組覆蓋一度被縮減，依 Opus 意見恢復後追加兩組；原失敗與較早兩組證據保留，不覆寫。
- 官方 Claude Code 2.1.294、claude.ai Pro 訂閱、真正 `claude-opus-5-5`，session `de25b706-06cb-416b-81d5-8dfbe9738391`，21次只讀工具，無 blocking。原始結果 `opus/result.json`／`review.md`；複查當時 full suite／真核心 probe 尚待回報，其後才完成，不回寫原審查意見冒稱當時已知。
- 採納 Opus 的既有 UI 覆蓋恢復及非終局 systemError 負向回歸；停止失敗提醒及可自動核對失敗先提醒保留。systemError **本身不是**主回合確定结束的充分條件，非終局 Error 也可能設該旗標；原 exact latest failed 等檢查仍必要。
- 曾試作 preflight 例外的額外黃色通知，但本事故沒有該例外證據，且可能在成功後留下過期提示，Astra 不採納；相關暫時39項測試與 RED 原文保留，但不在最後產品。最小修正只改四個產品檔：desktop-controller、completion-attention、taskbar-attention、project-sidebar，沒有新增服務、設定或重送迴圈。

## 部署界線與未完成

本批未套用正式 K，沒有停止／重啟、修改原翻譯工作或對話 metadata、push、東區更新、帳號／計費／核心升級。本人最新指示是不更新，待另行通知後才進行正式套用與讀回；工作列實際桌面呈現也留待屆時確認。本候選解決已證 K 的接續門檻與失敗通知缺漏，不能宣稱供應商串流／壓縮錯誤、極長記憶偏移或其他歷史問題全部根治。
