# Agensh 與目前 K：研究、真核心假資料試驗及產品判斷

日期：2026-10-06。結論：**現有 K 已能做最小 Agensh-like 實驗，不需新增產品機制；目前只值得實驗，尚不足以導入日常。**

本輪沒有恢復 JEV、共享知識接線、共同權威記憶或背景注入，沒有修改產品程式、部署、重啟正式 K、push、安裝套件或改帳號／模型策略。所有模型試驗使用官方原生核心及既有訂閱，不使用 API key。下列結論是本輪讀回，不把歷史驗證或其他聊天室的候選改動算成本輪成果。

## A. 能不能現在做？

**可以。** 已用正式版本的 controller、原生 Codex agents、工作目錄中的少量工作紀錄，以及現成檔案／測試工具完成：

- A 組：主代理分配兩件工作，工人回報，主代理整合與驗收。
- B 組：要求主代理只提供共同目標及最後驗收；實際觀察到工人讀取 claim、認領工作、讀取同儕已驗證事件，並競爭取得整合工作。初始派工文字因原生加密無法完整稽核，不能斷言父代理絕對沒有先指定工作。
- B 的整合 claim 發生一次碰撞，未覆寫別人的 claim；由取得 claim 的工人完成整合。這不是只有傳訊成功的展示，最終產物經實際測試與獨立讀回。

但這只是**一組小型合成任務的行為驗證**。沒有證明工作品質、訂閱額度或整體效益優於中央派工，更沒有證明三家混合協作已成立。

## 1. 先校準本機真值

研究起點實際讀取根目錄與維護工作樹的 AGENTS、README、PROJECT_GOAL，以及 10/4–10/6 的 workspace、Gemini capabilities、native goals、goal resume／edit、capacity handoff 工程紀錄，再查 controller、host、workers、MCP 與權限實作。

| 層次 | 本輪讀回 | 解讀 |
|---|---|---|
| 目前 cwd | `D:\K-harness`，HEAD `56bb038fa7c7c60cca26a18f650d655f4a060972` | 較舊 checkout，已有大量他項未提交修改。不能用此處舊 src 代表正式 K。 |
| 維護工作樹 | `C:\Users\Paulus\.codex\worktrees\modal-focus-fix\K-harness` | 開始為 `f69c4e0`；14:14 讀回已為 `76e8fa2a740c83b4928a6ce645b4b0669166152b`，另有進行中修改。不介入另一工作。 |
| 正式程式快照 | `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\trusted-runtime`，程式 SHA `d88d1481dba2b834191473f4bf86942ff67eff39` | 依當日 activation 收據，並將 9 個關鍵來源檔正規化換行後與該 Git 版本逐一比較，9/9 相同。本輪實驗固定使用此版本。 |
| GitHub 對照 | 原生 Git 唯讀查到 `origin/main = f69c4e08dfdda173f2bda6b5500e476253e95129` | 是當時對照快照，不等於維護工作樹或正式部署。網頁入口 404，未假裝網頁讀取成功。 |

初次比對 `d88d148` 到 `f69c4e0` 只有三份說明文件差異，不代表後續未提交候選也相同。根目錄 PROJECT_GOAL 仍含 Strong Brain／Pi／DeepSeek 舊設計，不能凌駕現行規則。runtime 路徑仍含 sandboxie 字樣，**不代表現在仍用 Sandboxie 執行**。

官方執行檔實際 `--version`：Codex **0.160.0**、Claude Code **2.1.289**、Antigravity **1.2.17**。不是沿用舊工程紀錄中的 agy 1.2.16。

證據：[來源快照](D:/K-harness/.runtime/agensh-research-20261006/source-baseline.json)、[既有正式部署收據](D:/K-harness/.runtime/capacity-handoff-deploy-20261006/activation.json)。

## 2. 論文機制與可移植範圍

[Agensh 原文與附錄](https://arxiv.org/html/2609.26781v1)的關鍵差異是：

- 自主循環仍依賴共享 Git、訊息及持久事件；CLAIM 是協商宣告，不等於原子鎖。
- 程式修改使用各自 checkout／branch，再整合，不是任意同寫一份檔案。
- 訊息在迴圈或工具回傳邊界送達，不是任意中斷正在執行的程序。
- board 的廣泛注入及強 FAIL／FACT 指引，不宜直接照搬到 K。
- 1,024-agent 結果限 pandoc；固定時間不等於等成本，也沒有證明勝過 K 的強中央派工。

因此本輪只取「**局部自主分工、可追溯工作證據、同儕整合**」，不複製完整運行基礎設施或共享記憶。論文連出的上游 GitHub 未成功讀取，不宣稱審過其實作。

## 3. 三個原生主核心：實際差異

下列來源均指上述固定正式 runtime，不指較舊根目錄 src。

| 能力 | Codex／GPT | Claude Code | Antigravity／Gemini |
|---|---|---|---|
| session／history | app-server 的 thread/start、thread/resume；原生歷史 | 原生 session ID、resume；不是 K 重播全部聊天 | agy print 回合，後續帶原生 conversation ID；不是每次新對話 |
| K 保存什麼 | UI metadata、workspace、模型／權限、thread ID、通知與成果索引 | UI messages／tools／artifacts、原生 ID、goal／compaction 呈現 | UI 投影、原生 conversation ID、工作區與 goal 呈現 |
| context／compaction | 原生管理；K 有原生 compact 入口 | 原生管理；K 接原生 compact | 原生管理；K 沒有等價手動 compact 接口 |
| goal | 原生 thread goal/get／set／clear 及事件，與普通回合區分 | 原生 /goal／Stop-hook 流程；「No goal set」不能自行判成目標成功 | 原生 goal 流程；須真實 SUCCESS＋GOAL_COMPLETE 才標完成 |
| reopen／resume | 讀回原生 thread；不等於重播舊工作或還原檔案 | resume 原生對話；K 不自行重開已結束目標 | 有原生 ID才可續接；曾啟動卻無 ID 不重播，舊 active 保守為 unknown |
| 工作中 steer | K 接原生 turn/steer | K 接原生控制流程 | K 明確不支援；不能把新 print 程序說成中途訊息 |

本輪三家都完成同一原生 session 的關閉 controller／重建／續接測試；**沒有另測 goal 完成、長上下文或壓縮後品質**，這些能力的敘述來自當前程式與既有工程紀錄，不算本輪新增驗收。

來源：[Codex controller](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/desktop-controller.mjs)（goal 548–561、resume 779–810、steer／compact 872–882）、[main sessions](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/main-sessions.mjs)、[Claude controller](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/claude-controller.mjs)、[Claude host](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/claude-host.mjs)、[Gemini controller](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/gemini-controller.mjs)（103–122、159–207）。

### 子代理不是同一種 lifecycle

| 路徑 | 持久性／多工／接續 | 中途訊息與再派工 | workspace／Git／tests |
|---|---|---|---|
| Codex native agents | 原生子 thread；可並行；原生管理接續與事件。本輪真實兩工人完成 | 有原生 message／wait；不是三家共通 peer 網路。可否再派依原生設定，本輪明確禁止 | 本輪沿用工作目錄與權限；workspace-write 實際跑 shell／tests。不要把工具權限當 OS 完全隔離 |
| Claude → GPT Sol／Luna bridge | 每 job 一次工作；requestId 與 thread ID 保存，能 inspect／wait／cancel | bridge 設 `agents.enabled=false` 並禁止再委派；沒有 gateway follow-up／steer／resume-task 接口。持久紀錄不等於持久互動工人 | cwd 綁父工作區，派工 schema 無個別 worktree 參數；Git／測試受對應原生權限及核准限制 |
| GPT／Claude → Flash gateway | 一個 agy print job；可有多個 job，但不代表無容量限制 | 現行 worker 不傳 conversation resume、沒有 peer inbox／steer，指引禁止再委派 | 同父工作區；workspace-write 允許工作區檔案寫入，但 deny shell／unsandboxed／未准 MCP，不能直接把本輪 Node claim／Git test 做法套上去 |
| Claude 原生 Task／agents | 本輪真 Opus init 有 Task、ListAgents、SendMessage；原生子代理能力存在 | 工具存在不等於所有隊伍生命周期已實測。K 使用 print host，不能宣稱 interactive agent teams 已接通 | 受 Claude 原生權限；有 EnterWorktree 工具，但未完成 K 跨核心等價性實測 |
| Gemini 主核心 | conversation 持續與 goal 可用 | 未取得 K 跨核心 peer／再派工等價接口證據，不編造 | Gemini 專案 MCP 可接；權限仍依原生模式 |

Claude 官方 [agent teams 說明](https://code.claude.com/docs/en/agent-teams)另列 experimental／interactive 限制；不要把原生 [subagents](https://code.claude.com/docs/en/sub-agents) 或工具名稱誤認為 print 模式完整 swarm。Antigravity 的 [headless 文件](https://antigravity.google/docs/cli/headless/)也區分 print 與 conversation 接續。

來源：[worker policy](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/worker-policy.mjs)、[native workers](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/native-workers.mjs)、[Luna bridge](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/luna-bridge.mjs)（212–265）、[gateway](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/luna-gateway.mjs)、[Gemini worker](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/gemini-worker.mjs)（26–73、169–239）。

### 現有 MCP 可以承接，不代表已經提供協作工具

現有工具已提供 start／inspect／wait／cancel、帳號查詢和特定 goal 操作；沒有通用 claim／publish／peer-message。Codex、Claude 的原生 MCP 設定入口與 Gemini project-scoped MCP 已有，不必先造另一套 runtime。

但是 [Gemini project MCP](D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/src/gemini-project-mcp.mjs)要求精確 workspace owner，read/write 工具需明列；它不是自動通用於三家的共用設定。日後若真的補一個協作 MCP，還須逐家確認載入、native child 繼承及權限，不能只寫一份設定就宣稱完成。

## B. 真正缺口是什麼？

**對第一個 bounded、檔案拉取式、兩工人實驗：沒有阻止成立的產品缺口。** 已跑通，不為未來想像增加機制。

若把目標提高為「GPT／Claude／Flash 工人長駐、任意時刻彼此收訊並在中斷後繼續」，現有 Flash/GPT gateway 的 one-shot 與無 peer-steer 才是實際限制；那是另一個、更大的問題，不是本輪先修改 lifecycle 的理由。保持原 lifecycle 也能讓工人在自己回合內按需讀取同儕檔案。

Flash workspace-write 不可 shell，會阻擋本輪使用的 Node 排他 claim 和 Git/tests，但**不阻擋宣告式 claim、分檔寫入與讀取證據**。不能為了實驗直接把 Flash 升成 full access。若一定要求同一測試預算由每個工人自行執行，須事先確認該原生權限確實允許，否則固定使用共同驗證者並同樣套用 A/B。

### 已實際重現的 workspace 問題

以正式 `geminiGitStatus`／`geminiOutputFiles` 在新建假 Git repo 執行：

1. 原本已 dirty 的檔案再被修改，git status 相同，`outputFiles=[]`。
2. 兩個重疊 job 的前後差異都列出兩人的檔案，無法判斷各自作者。
3. 模擬兩人先讀同一舊內容再各自寫回，後寫者覆蓋前者成果。
4. 原生檔案 exclusive-create 同時競爭，只一個成功。

這是**本機確定性假資料試驗，不是模型自發行為**。證據：[workspace probe](D:/K-harness/.runtime/agensh-research-20261006/workspace-probe.json)。GPT bridge 只蒐集原生 fileChange，shell 寫檔也不能假定完整歸因；本輪 Codex 原生 worker 的 `outputFiles=[]` 但成果確實存在，故驗收直接讀檔和真測試，不靠清單。

判斷：互不重疊的 JSON／文章片段可用同目錄分檔，不需 worktree；有重疊程式編輯就用現成獨立副本／worktree，或序列化同一檔案的寫入。**只換 branch 而仍共用同一實體 checkout 不構成隔離。** 本輪沒有建立程式 merge framework，也沒有假裝驗證真程式合併。

## C. 最小實作

**產品程式修改：0。** 本輪僅新增實驗材料與本文件／索引。

一次工作只需：共同目標與驗收條件、各工人自己的原生 session、工作範圍內的 claim／事件／成果檔。事件用短紀錄保留「作者、範圍、版本／條件、實際證據位置、目前狀態、被何者更正」；接收者自行判斷。不做長期共同記憶，不把整份紀錄灌入每回合。

工人先讀相關工作狀態，選尚未完成部分；完成後留下實際測試結果及 artifact 引用；需要整合的人再讀相關證據。主核心保留目標、權限、真正高階判斷與 final acceptance。這是 **hybrid 的候選做法，不是取消強主核心**。

本輪排他 claim 使用 OS 既有檔案操作，是避免實驗整合撞寫的局部措施，不是聲稱論文必須使用 transaction／lease。程序中斷後 claim 不會自動恢復，也不會自動重播；目前不為未測的長駐工作建 TTL／queue／recovery service。

只有日後實測證明檔案拉取或宣告式 claim 不足，才考慮在現有 MCP 內加少數 run-scoped 操作；不得先建 server、scheduler、完整 schema、知識圖譜或人用管理頁。

## D. 已做的驗證與能證明什麼

### D1. 真實 native 多代理：中央 vs 自主協作

每組 **1 主代理＋2 工人，共 3 個模型 session**，不是把主代理成本漏算成「總共兩個」。全部 `gpt-6.1-sol / medium`，workspace-write，原生 fresh child、`fork_turns=none`，一輪工作可多次工具呼叫，無重開、無再派工、無 goal。A/B 同數量、同 lifecycle、同權限、同工作目錄隔離方式與測試上限。兩份 input、history、驗證器逐位元相同。

任務：各處理 alpha／beta v2 篩選及加總，產出 count、sum、ids，整合成一份 JSON；提供一個舊版本 FAIL 和一個無證據錯誤假說。不是難題，也不是盲測：預期數值可見。各工人針對測試最多兩次，主代理總驗收一次；實際兩組都只各跑一次 targeted test 與一次 final test。

| 讀回指標 | A 中央 | B 自主 |
|---|---:|---:|
| 真正可接受成果 | alpha=20、beta=23，所有 ids 正確 | 相同 |
| targeted＋final 實際測試 | 3 次，exit 0 | 3 次，exit 0 |
| send 至完成耗時，不含 host 建立／事後審核 | 76.353 秒 | 77.096 秒 |
| 主代理原生 totalTokens | 362,632 | 176,301 |
| 主代理其中 cachedInputTokens | 339,840 | 156,928 |
| 主代理非快取輸入（input 減 cached） | 21,219 | 18,034 |
| 主代理 outputTokens | 1,573 | 1,339 |
| 兩工人原生 totalTokens 合計 | 612,875 | 510,867 |
| 兩工人其中 cachedInputTokens | 577,280 | 479,488 |
| 兩工人非快取輸入合計 | 33,137 | 29,022 |
| 兩工人 outputTokens 合計 | 2,458 | 2,357 |
| 主代理 shell 呼叫數 | 5 | 1，只有 final test |
| 工人 shell 呼叫數 | 11 | 12 |
| 啟動後主代理矯正介入 | 1 次補目錄並傳訊 | 0 |
| 整合者 | 主代理 | 工人 child_two |
| claim 碰撞 | 0 | 1，整合 claim 的 EEXIST |
| 觀察到重複產物寫入／覆寫／成果重做 | 0／0／0 | 0／0／0 |
| 測試程式以外的失敗命令 | 2 次缺 claim 目錄 | 1 次缺目錄查詢＋1 次 claim 碰撞 |
| 可歸因訂閱額度／金額 | UNKNOWN | UNKNOWN |

讀回不是只採信代理總結：核對原生 child thread ID、parent ID、model、medium、單一 completed turn、命令 exit/output，以及實際 JSON 內容。B 的第二位工人先看到 alpha claim 再認領 beta，讀到 alpha 的 PASS 事件後自己整合；另一工人的整合競爭被拒絕。B 主代理在啟動後沒有轉送訊息或寫整合檔；但初始派工內容不可讀，故「啟動時也完全沒有指定工作」未獲直接證實，實際行為僅與該政策相符。

**方法限制必須保留：**

- 只有 A→B 一對，未交錯順序／重複；cache、模型排程與網路時間沒有控制。
- fixture 漏建 claims/events 目錄，引發非預期準備工作：A 多一次主代理介入。不能把這部分的差異算成自主協作固有效益；未隱藏失敗，也未重跑到好看為止。
- 指定共同資料與新上下文政策，但原生 child prompt 內容被加密保存，不能證明父代理實際下傳文字完全等長、只差 treatment。**不是嚴格等 context amount 的因果比較。**
- B 主代理原生 token 比 A 低是觀測值，不是「省一半額度」。差距主要是反覆快取輸入；非快取輸入加輸出僅約少 15%，仍不是計費估算。A 的先讀全部輸入、讀全部成果及補目錄也增加呼叫，不能將差異歸因於自主協作。沒有本任務專屬的訂閱用量證據。
- A 的工人以程式篩選加總；B 直接寫入固定數值。產物都符合題目，但不能證明 B 做了同樣的計算過程，也不能斷言它是計算或抄錄預期值。這只能驗收該份輸出，不是一般化解題能力比較。
- 原生新 session 仍載入 K 上層規則，並非零背景上下文；絕對 token 不代表單獨協作協議的成本。
- 工作已分成兩個簡單獨立資料片段；未測真正任務發現、長時間依賴、程式 patch 合併、混合三核心協作、worker 中斷恢復。

因此這次是**已實際 A/B 跑過的 feasibility pilot，不是淨正收益驗收**。

證據：[結果摘要](D:/K-harness/.runtime/agensh-research-20261006/collaboration-summary.json)、[逐命令證據](D:/K-harness/.runtime/agensh-research-20261006/collaboration-command-evidence.json)、[A 原生讀回](D:/K-harness/.runtime/agensh-research-20261006/central-collaboration.json)、[B 原生讀回](D:/K-harness/.runtime/agensh-research-20261006/self-collaboration.json)。原始 native events 保留於同一實驗目錄。

### D2. 真三核心 shared-state regression

Codex Sol medium／Claude Opus 5.5 medium／Gemini Flash medium，各跑 control 與 selective-read 兩個新 session；各 3 回合，中間關閉並重建 controller、續接同一原生 session。共 **6 sessions、18 回合、72 個逐欄位檢查，72/72 通過**。

檢查：保留原對話 nonce 與使用者核准 limit=17；同儕無證據的 limit=70 不覆蓋原約定；v1 FAIL 不阻擋 v2；未驗假說不變成真值；續接後讀到 E4 與 E5 更正，正確接受所給 v2 fixture 結果10，不把歷史 v1 失敗抹掉；不宣稱親自跑過提供的測試。

Codex／Gemini 使用 read-only，Claude 使用原生 plan。沒有升權、搬憑證或切帳號。Gemini 測試是主核心 conversation 路徑，不是證明 gateway Flash 已具備持久 session。

續接並非重設為預設權限：三個 controller 都先取 saved accessMode／effort。補查 Codex 六個測量回合的 native turn_context 均為 read-only／medium；Claude init 均回傳 plan，saved metadata 為 medium；Gemini saved metadata 為 read-only／medium。Claude／Gemini 沒有逐回合原生 effort echo，Gemini 本試驗也未另存 raw native events，因此不宣稱三家有同等深度的協定證據。

fixture 的 receipt 與輸入同目錄，確有測試答案可被額外讀取的風險。補查六個 session 的工具紀錄，每個只有兩次精確讀取 coordination.txt，沒有列目錄或讀 receipt。這保留了本輪 nonce／limit 檢查的解讀，但不能排除供應商未公開的內部 context 組裝；日後應把測量收據置於模型任務目錄外。評分程式逐一用嚴格相等比較第 2 回合 5 欄、第 3 回合 7 欄；不是模型自評。

**這是短程、明確提示、合成同儕資料的回歸探針**。證據是測試提供的 observation，不是真同儕執行；不能因此宣稱三家長期記憶完全無損、壓縮後無退化或 JEV 問題已全面解決。72 checks 不是 72 個獨立任務。控制組沒有新證據，因此保留 unknown 才是正確答案。

證據：[context 檢查](D:/K-harness/.runtime/agensh-research-20261006/context-summary.json)、[評分程式](D:/K-harness/.runtime/agensh-research-20261006/summarize-context.mjs)、[續接與工具讀回](D:/K-harness/.runtime/agensh-research-20261006/context-readback-audit.json)、[Codex](D:/K-harness/.runtime/agensh-research-20261006/codex-context-results.json)、[Claude](D:/K-harness/.runtime/agensh-research-20261006/claude-context-results.json)、[Gemini](D:/K-harness/.runtime/agensh-research-20261006/gemini-context-results.json)。

### D3. 什麼證據才足以再升級

以下為尚未執行的驗證設計，不是本輪待部署清單：

1. 選一件代表性、可獨立驗收的真工作；A/B固定同模型／effort／原生 lifecycle／權限／檔案隔離／測試預算與共同資料。先備妥目錄，給各工人同一份固定文字協議，而不是讓主代理自由縮寫；只改 allocation/integration policy。
2. 至少做數對交錯 A/B 與 B/A，固定工作規模；不要同時加入更多工人或改 Flash lifecycle。母體差異大的文章與程式工作分開判斷，不加總成虛假單一分數。
3. 先看可接受成果、遺漏及實際返工；再比較全程時間、主代理介入與原生用量、工人用量、碰撞、重複測試及人工成本。沒有可歸因額度就繼續 UNKNOWN。
4. 三家混合的試驗兩組用同樣組成與權限；確認各自讀寫協作檔、證據交接、權限拒絕仍有效。不要用本輪三家各自測試代替混合協作。
5. 在原生續接及實際 context compaction 邊界重測過期 FAIL、同名不同版本、更正、多來源衝突與既有 session 較準確資訊。加入失敗證據無法讀取時保留未知的案例。出現理解退化就不導入，不靠新記憶層補另一層。

## E. 產品決策與完成狀態

**選擇：只值得實驗。** 理由是工人同儕讀取、認領及整合已有真實行為證據，不需要新增產品機制即可進一步研究。但本輪較少的主代理工具呼叫／介入混有 setup 與任務處理方式差異，不能當成自主協作淨減負的證明；時間／品質無優勢、成本未知，純自主初始分工、三核心混合協作與長上下文回歸仍未驗。此時加可選模式、按鈕、daemon、peer router 都比證據走得更遠。

若日後反覆真工作證明有收益，優先採「主核心定目標／權限／驗收＋小組局部自主協作」；不取消主核心、不更換模型偏好，不把 JEV 的失敗泛化為所有共享狀態都無效。

| 狀態 | 本輪結果 |
|---|---|
| 研究 current code／論文 | 已完成，來源快照與差異保留 |
| 建立實驗 | 已完成，限本機 `.runtime/agensh-research-20261006` |
| 跑假資料 | 已完成，檔案失敗模式＋真模型合成任務 |
| 跑真三核心 | 已完成各自短程 native context／reopen 測試；**未完成三家共同協作** |
| 實際中央 vs 自主比較 | 已完成一對 Codex 多代理 pilot；**未達因果或淨效益驗收** |
| 修改產品 | **沒有**；只新增研究／實驗材料並更新本索引 |
| 部署／push／正式重啟 | **沒有** |

實驗腳本不是可直接重跑覆蓋的產品工具；其中原始 run 會寫同名 fixture。保留原始結果，後續若再測應使用新 run 目錄，不重播未知工作。沒有清理或刪除資料，既有 dirty workspace、JEV 封存與正式設定維持原狀。

### 真 Opus 複查與 Astra 裁決

官方 Claude Code 的 native init 確認 `claude-opus-5-5`／plan，session `eef434ef-ae04-4f1b-b64c-2b8ae759d659`。只讀複查了研究草稿、實驗方法與 Sol 的實際 inline 命令，沒有重跑模型任務或改檔。原文：[Opus 複查](D:/K-harness/.runtime/agensh-research-20261006/opus-review.json)。

採納並修正：補非快取用量、移除淨減負訊號的強推論、將純自主初始分工降為未直接證實、揭露 A 計算／B 固定輸出差異、補工具讀檔與續接設定讀回、提供評分程式及原生規則背景限制。Opus 提出的續接可能回到預設值，經 source＋native／saved evidence 核對不成立；仍保留兩家缺少 native effort echo 的限制。「B 抄答案」也無直接證據，改用可觀察的固定值寫入描述，不推測內部推理。

Opus 沒有指出本輪 inline 命令造成成果覆寫或額外產品寫入；它確認 shell 次數、真測試與 claim collision 證據。這不是宣稱其已全面驗收 K，亦不是修訂後再審。Astra 自行核對修訂、原始事件與檔案後收尾；正式來源 9 檔結尾再比對仍相同，見 [結尾來源核對](D:/K-harness/.runtime/agensh-research-20261006/source-final-check.json)。

本輪到「已證實可做、尚未證實值得導入」即停止，不再以增加架構或測試數量代替產品判斷。

## 使用者定案 2026-10-06

保留本研究、原始實驗與限制，作為日後遇到類似協作機制或實際任務時的比較基準；屆時可再設計對照實驗。現階段不納入正式 K、不列為產品開發待辦，也不繼續追加實驗或建立自動追蹤。這是研究留存，不是功能導入決定；正式產品維持不動。
