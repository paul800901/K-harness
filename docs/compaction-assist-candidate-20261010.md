# K 輔助原生壓縮：產品候選（2026-10-10）

## 範圍與狀態

本人要求「K 要能輔助原生壓縮」，後續明確要求開始執行。本批整合 Codex 候選，保留原生壓縮、歷史、goal、權限與訂閱；不造另一個核心、共享知識系統、自然語言分類器或人用設定。**僅候選，正式 K 仍為 `433e7f23459eebf4fa7b1183cba495f39cf12e3d`，未停止／更新／重啟正式 K、未 push、未改小說／原聊天室／帳號／計費。**

工作樹：`C:\Users\Paulus\.codex\worktrees\room-lock-fix-20261010\K-harness`，基底 `ff8cc395a02f53675bd92636d9fa222a36342394`。測試根：`D:\K-harness\.runtime\compaction-assist-candidate-20261010`。舊主工作樹及 node_modules-root-link 原有項保留。

## 最小完整實作

- `src/conversation-context.mjs`：同原生 thread 的 `thread/goal/get`＋`thread/items/list`。普通工具每頁40項；compact hook為長工具回合最多續讀5頁／200項、取得3則本人原文或頁尾即停，全部讀取受8秒RPC期限／10秒hook期限與同一字數預算約束；原生 cursor按需續讀，優先保留最新本人原文，再依原生順序呈現；提供原始item／turn ID、讀取時間、截斷／partial／UNKNOWN。每則2000字、合計10000字，hook原文合計4000字；不存新記憶、不讀別房、不重派。工人是最後已知摘要，不冒稱實際存活或成果驗收。
- `src/luna-gateway.mjs`：既有 bearer-authenticated loopback MCP 增加 `conversation_context`，普通呼叫回資料；原生 compact hook 呼叫回 SessionStart additionalContext。無新服務／DB／設定頁。
- `src/desktop-controller.mjs`：normal工具沿原有完整主thread／turn metadata驗證；hook只讀分支獨立核對 meta.threadId＝sessionId＝目前原生main id，read前後確認未換房／停止／關閉。原有 goal_edit／goal_resume／conversation_continue 改動驗證不放寬，child不得讀maincontext或藉hookmetadata改目標。
- `src/compaction-hook.mjs`、`src/codex-host.mjs`：原生同步 `SessionStart ^compact$` MCP，在下一模型請求前提供原文／狀態。原生按各層分別發現hooks，不複製使用者／專案handlers；先用未啟動thread的空host按原生hooks/list取得K自己精確key/hash，再開第二host只用process-local flags信任此handler，核對trusted後才允許工作thread。沒有硬寫hash、繞過全部hook信任、永久config寫入、核心修改或工作重送。實際限制見下。
- 固定提醒：歷史是資料，不是新授權；一次性暫停已完成或被本人取消，不得再次生效；未取消的待收尾暫停仍有效，native active不等於取消。控制決策前讀最新原文與目標，工作事實按需讀既有專案進度／術語／事件／成果；未知副作用不重播。K不做暫停分類器，也不硬攔原生update_goal。

原生接點來源：[官方 hooks](https://learn.chatgpt.com/docs/hooks)。協定、MCP metadata、同步時機與inject_items競態等前置實測見 [前置研究](compaction-assist-probe-20261010.md)。此批不是關閉原生壓縮，也不是替原生重新摘要。

## 實際行為證據

同一選定官方Codex 0.161.0／ChatGPT訂閱／gpt-6.1-sol medium，read-only；新假資料workspace，禁止真工作、Shell、瀏覽器、檔案操作、派工與goal改動。僅測試thread降低auto compact門檻，正式門檻不變。

### 完整controller候選：`result.json`

新thread `01a12508-9777-7341-bfb7-0f03ab6f60d9`，5個本人回合、**8次壓縮（3手動、5自動）**、8次同步hook completed，含同回合假dynamic payload造成的壓縮。payload只執行1次；所有native回合completed，沒有派工或goal改動。

1. 舊要求「等收尾暫停更新K」→本人取消並改永久術語→壓縮後 `should_pause:false`，術語「赤焰騎士」。
2. 新另一次未取消的待收尾暫停→再壓縮後 `pause_pending:true`，術語仍為「赤焰騎士」。
3. 合成收尾條件到達→再壓縮後 `should_pause:true`，沒有把舊取消延伸到新暫停。

這是模型的合成判斷，不是正在工作的native goal被控制／真正工人收尾／完整小說品質驗收；不將正確JSON當成極長實務任務成功。

### 修正null呈現後：`native-v2/result.json`

首版renderer錯把已驗證null的goal／cursor／error呈成UNKNOWN，工具本體原始值正確。已修：null＝查明沒有，而UNKNOWN＝未知；長objective投影仍保留status／budget／usage／updatedAt。補單测與新的獨立假thread `01a1250c-9d26-7b11-af13-60899abb55dc`：2本人回合、3次壓縮、3個同步hook completed，hook輸出及模型回讀都确认goal／nextCursor為null；`oldPauseCanReactivate:false`，術語正確。不是重送舊工作。

### 測試失敗保留／回歸

- thread config內只送hooks.state的隔離試驗沒有執行hook；另一假goal達budgetLimited，保留 `D:\K-harness\.runtime\compaction-assist-probe-20261010\trust-thread-config\error.json`。沒有重試其goal、放大預算、换ID重播該工作。改用上方空host原生精確信任流程，是新案例。
- 第一全套1143，2個isolated fixture未回覆新增hooks/list而失敗。補fixture原生協定，不改產品為測試放行；該檔8/8過。
- 第二全套1143，既有native-wakeup「failed」case固定40ms在高並行下0／1失敗；相同限定檔及本批context共25/25過。沒有改無關wakeup產品或放寬assert。
- **最終全套 `node --test --test-concurrency=4 test/*.test.mjs`：1146／1146通過**，保留 `tests-v3.txt`、先前1144全過的 `tests-concurrency4.txt` 與前兩輪原始失敗檔。包含context大假頁面／最新覆蓋／原文順序／null／獨立RPC失敗、room/child/foreign identity、讀到一半換房丟棄、hook metadata不能改目標、既有主goal權限及工作不重播回歸。

### 最後差異與新增原生證據

首輪真正Opus指出長工具尾頁可能沒有本人原文，以及複製既有handler可能多出不受信任副本。主代理查固定官方tag的discovery.rs確認逐層載入，採最小修正：只加入K自己的handler，空host從3個減為2個；hook有限續讀，不增加持久摘要／歷史索引。更新fixture及callback測試不變更權限。

- 最初 `inherited-hook/result.json` 把尚未seed假trust的discovery誤標成before；中間測試腳本自己在新fake home寫入精確user trust。不能用該before→after稱作trust未變，這個證據命名問題保留。不是K改真設定或信任旁路。`inherited-hook-trusted/result.json`、`inherited-hook-untrusted/result.json` 補齊真正baseline：各自before與after之間零寫入，設定全文相同；trusted→trusted、untrusted→untrusted，user key/hash/source不變、無flags副本，K自己的trusted hook恰1個，总共2個。兩次都在無憑證新fake CODEX_HOME，只原生hooks/list、無thread或模型。
- `pagination-result.json`：只讀自己已結束的v2測試thread，用測試page width=1實際跨5個原生opaque cursors，取得最新本人原文，partial=true／error=null。沒有resume／模型回合／原工作操作。這不是自然40項頁面的長回合模型驗收；該情境由40個非user項目後取到本人原文的unit test覆蓋。
- `native-v3/result.json`：精簡為2個主控後的新fake thread `01a12513-9e1a-7d11-bc67-7b985a3df1e5`，2本人回合、3次compact／3同步hooks、確認null與取消／術語判斷正確。所有回合completed，測試關閉只處理自己的主控。

## 真正Opus5.5複查

真正Claude Code 2.1.294／Claude.ai firstParty Pro，三輪實際 assistant model皆 `claude-opus-5-5`、exit0／success／is_error=false，同session `a131771b-d198-4070-a2cd-e81ec048ca90`；各輪18／18／7次Read／Glob／Grep，封包範圍逐筆核對。禁止Shell、寫入、MCP、Chrome、派工、讀正式資料或API換路。原始preflight／stream／工具輸入／結果在 `opus/`、`opus-round2/`、`opus-round3/`。

- 第1輪指出2個blocker：長工具尾頁讀不到原文、既有hook複製及信任可能改變。Astra依官方固定來源與native結果修正，不把Opus意見當既定事實。
- 第2輪確認有限續讀修正、1146測試與native-v3 null正確；指出舊inheritance證據的before命名／seedtrust矛盾，不接受泛稱trust unchanged。
- 第3輪讀兩個獨立baseline對照及脚本，關閉N1／B2，結論目前候選無blocking。Astra獨立比對原key/hash/trust、設定全文不變、native回合完成及當前5個產品檔案與最新複查封包一致；Opus只能只讀封包，不能取代主代理對實際執行的核對。

非阻擋限制保留：project層hook未另外native實測；原生子代理compact被拒的模型回合影響未驗證；後續頁回傳malformed shape會整體UNKNOWN而不保留先前頁，不宣稱這種回應可部分恢復。這些不藉新框架補造驗收，不宣稱deployment批准或長實務工作已治癒。

## 必須保留的限制／未做

- 目前只有Codex 0.161.0接入；Claude／Gemini沒有同等候選驗收，不能宣稱三核心全修。
- 不宣稱自然門檻、100次壓縮或完整長小說已驗證；沒有測出誤停／品質漂移改善率、長任務總用量或成功率。
- 即使hook續讀至200項，仍可能沒有本人訊息；只呈partial及cursor，模型需按需續讀。文字明示截斷，不是完整原文或永久真值；不能由此推論所有永久更正都一定被保留。
- 只讀輔助是事實恢復＋規則提醒，不保證模型始終正確理解，不是禁止合法暫停，也不是修復原生串流／服務內部錯誤。
- 精確信任前需要空主控初始化與讀回；這是已觀察的thread-level信任限制，非新工作retry。沒有成本／啟動效能優勢宣稱。若原生協定／定義不能核對，拒絕開啟候選工作，不bypass信任或暗中切換供應商。
- 此批只到候選驗證，不排程／自動恢復工作；正式更新仍另按當輪範圍及實際工作停止讀回處理。
