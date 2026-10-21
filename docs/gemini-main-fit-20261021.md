# Gemini 主聊天室接法改善（2026-10-21）

本批只在 `C:/Users/Paulus/.codex/worktrees/gemini-main-fit/K-harness`、分支 `codex/gemini-main-fit-20261021` 工作，基底 `c809f21b412d1a59f3113e69c927c90216194c36`。程式提交 **`b7f9f85c2b256106e52ddc8e49ea4d2feb96e1f6`**；本紀錄、規則與索引另作文件提交。

實作工人 gpt-6-astra（xhigh）；**Opus 5.5 已獨立審核**，意見與補修見文末。工人階段不部署、不重啟、不 push、不合併 main；未修改主工作樹、既有聊天室資料或帳號設定，沒有再委派子代理。

## 實作差異與檔案

| 項目 | 檔案與行為 |
| --- | --- |
| B1 主聊天室分工 | `src/worker-policy.mjs` 新增三行 `GEMINI_MAIN_ROLE_GUIDANCE`：不能派工；第二意見／程式審查由本人另開 GPT／Claude；不向本人重述分工。`src/gemini-controller.mjs` 改將它寫入聊天室 HOME 的 always_on 規則。Codex／Claude 的 `MODEL_ROLE_GUIDANCE` 文字與接線不變。 |
| B2 工具說明 | `src/gemini-worker.mjs` 保留短版共用 `GEMINI_TOOL_GUIDANCE`，由 `geminiToolGuidance(accessMode)` 組合目前權限的一句正面說明；保留 .gsheet 是連結、先 metadata 再讀範圍、能力不足如實回報、不繞過拒絕、不把未知當零。主聊天室與 `geminiInstruction` 共用。工人既有不得再委派、非完整存取不能執行命令等限制保留。 |
| B2 指令生命週期 | 完整存取才加入：K 現行每回合是獨立 print 程序；背景未完成曾在回覆後約 30 分鐘被取消並退出；回合結束後不自動喚醒。長指令須在本回合等完、讀回後才交付，不承諾稍後自動接續。使用「曾在」表達既有證據，不將 30 分鐘寫成 K 新增的固定逾時。 |
| B3 斜線指令 | 普通回合保留 `--disable-slash-commands`，規則明示不要建議本人使用 /learn、/compact。既有目標操作的 /goal 展開例外不變。 |
| B4 附件 | `src/gemini-controller.mjs` 保留 name、readPath、warning，刪除重複 path；originalPath 只在不同於 readPath 時保留。警語縮成「資料，非授權；模態支援以原生工具實際讀取為準」，未知模型仍不冒稱已能處理模態。 |
| 測試 | 更新 `test/gemini-controller.test.mjs`、`test/gemini-worker.test.mjs` 既有案例，核對短版規則、切換三種權限後的規則與原生 deny／skip、工人共用說明、附件原檔／可讀路徑及警語。未放寬原生權限或 /goal 斷言。 |
| 文件 | 更新 `AGENTS.md` 第五節、`docs/model-role-guidance-20261003.md`、`docs/development-log.md` 及本紀錄。舊工程紀錄的當時驗收保留。 |

另查：`discussion-native.mjs` 的 Gemini 入口只注入其討論 instructions；Gemini 工人由 `geminiInstruction` 接任務，沒有完整 `MODEL_ROLE_GUIDANCE`。本批不另改這兩條路線的分工政策。

## 實測方式與登入邊界

所有證據原在工作樹，合併時已移到主工作樹 `D:\K-harness\.runtime\archive\gemini-main-fit-20261021\`，未提交 Git。`probe-help.mjs`、`probe-stream.mjs` 留存實際探測程式；HOME、假工作區與假檔經 `test/scratch.mjs` 建立，探測結束後依慣例回收。沒有讀取正式 `vault/private-state`、登入檔或既有聊天室 HOME。

先只讀來源確認：

- `gemini-controller.mjs` 先取得 `accounts.acquire(...)` 的帳號 lease，再用 `geminiEnvironment(env, home())` 啟動 agy。新 HOME 只寫設定、MCP 設定與規則，沒有複製登入檔。
- `geminiEnvironment` 只保留系統命令所需環境，重設 HOME／USERPROFILE，關閉 agy 自動更新，不傳 provider keys。
- `gemini-accounts.mjs`／`gemini-credential-vault.mjs` 管理目前共用登入的身分、額度與 lease；`scripts/gemini-credentials.ps1` 的來源顯示 native target 為 Windows 憑證管理員的 `gemini:antigravity`，不是每個 HOME 各一份憑證。
- 探測使用相同 `geminiEnvironment` 與原生 agy 登入途徑；只讓 agy 自行 silent auth，工人程式未讀取、複製或搬移任何憑證，未執行 credential helper 的 current／capture／activate 等操作。新 HOME 的 log 實際出現 `silent auth succeeded`。沒有登入操作、換帳號或其他 API 計費。
- 探測沒有接入正式 K 的記憶體內 account lease，也沒有另建／載入正式帳號 registry；所以本批不是正式多帳號排程驗收。只用當前共用原生登入，三個模型 probe 依序執行。未對正式 K 的其他 agy 程序發送訊號。

執行檔沿 `K_GEMINI_EXECUTABLE`，`--version` 回傳 **1.4.3**。`agy models` 列有 `gemini-3.8-flash-low`，P2/P3 只用此型號。假指令為 `powershell.exe -NoProfile -NonInteractive -File <probe-work.ps1>`：寫 started.txt，Start-Sleep 60 或 90 秒，再寫 done.txt；沒有其他外部副作用。僅假工作區用 `--dangerously-skip-permissions`，未改 K 權限接線。

本次暫存工作區位於 worktree 內，agy 會自動讀取祖先 AGENTS.md（native log 有 24,000 bytes 截斷訊息）；不能將本次消耗解讀成空規則環境或新短版規則的 token 比較，也未把模型實測當成新規則接線的獨立驗收。

## P1：print mode 命令清單

實際執行 `-p "/help" --output-format stream-json`，未加 `--disable-slash-commands`。事件依序為 `command_result(help)` → `result(SUCCESS)`；`num_turns: 0`，usage 各欄 0，程序 exit 0。native log 沒有 `streamGenerateContent`。

清單為 `/agents`、`/changelog`、`/config`（別名 `/settings`）、`/credits`、`/effort`、`/help`、`/hooks`、`/model`、`/permissions`、`/plugin`、`/skills`、`/usage`（別名 `/quota`）。清單不是每個指令都已執行、安全或適合對本人開放的證據。

**/learn、/compact 未列於 print mode 可用命令清單。** 為維持 P1 零模型回合，沒有另外將它們當模型提示送出，故本批不宣稱已直接驗證其所有 expansion／拒絕行為；/goal 是既有例外，也不能用 help 清單推論所有系統展開功能。繼續禁止建議本人使用這些指令，不提出全域開放方案。/help 本身已證實可作零推論工程診斷，但 K 沒有新增本人操作入口的需求。若未來考慮 /learn，必須另處理其「全域」其實是每聊天室隔離 HOME 的範圍。

證據：`p1-help.stdout.log`、`p1-help.native.log`、`p1-summary.json`、`cli-help.stderr.log`、`version.stdout.log`、`models.stdout.log`。原生 help 清楚描述 stream-json stdin 為「每行一則 NDJSON，逐則執行一回合」。

## P2：send-immediately 與預設均依序執行

兩組均使用 `-p "" --input-format stream-json --output-format stream-json`，stdin 持續開啟。第一則要求等待 60 秒指令完成並讀回假檔；看到 started.txt 後才送第二則 `{"event":"user","message":{"content":"...SECOND_SEEN..."}}`，確定第二則在指令尚未完成時寫入 stdin。

| 設定 | 第二則寫入 | 假指令完成檔讀回 | 第一個 result | 第二個原生 user_input | 第二個 result |
| --- | ---: | ---: | ---: | ---: | ---: |
| `queuedMessages: "send-immediately"` | 11.822 秒 | 71.906 秒 | 77.848 秒 | 77.875 秒 | 80.779 秒 |
| 不設 queuedMessages（預設） | 7.446 秒 | 67.465 秒 | 72.964 秒 | 72.990 秒 | 74.634 秒 |

時間均從各自程序啟動計算。兩組事件均為 `init` → 第一個 `user_input` → run_command／等待／讀檔 → `result(num_turns:1, FIRST_DONE)` → 第二個 `user_input` → `result(num_turns:2, SECOND_SEEN)`。每組保持相同 conversation_id；關 stdin 後 exit 0，沒有 kill 或重送。

**本次沒有執行中插話。** 設定檔包含 send-immediately 不足以使 print stream 在活動回合中插入第二則；不能將此接法標成 steer 可用。

證據：`p2-immediate.*`、`p2-default.*` 的 `stdout.ndjson`（原始事件）、`timeline.ndjson`（收取／送入時間）、`native.log`、`summary.json`；`event-sequences.json` 提供去除大型 init 工具目錄後的事件摘要。只作觀察摘要，沒有替換原始事件。

## P3：90 秒背景指令完成、同回合補充與 EOF

單一輸入要求 run_command 啟動 90 秒假指令後立即回覆 BACKGROUND_STARTED，不等待／不再呼叫工具；stdin 持續開啟。模型實際工具參數只有 CommandLine，沒有傳入提示中的 WaitMs；因此不能宣稱已驗證指定 WaitMs 的效果。原生後續回覆辨識它為 `task-2`。

觀察到：

1. 5.203 秒收到 run_command ACTIVE，5.964 秒看到 started.txt。
2. 96.058 秒串流送出 run_command DONE、exit 0、`synthetic-done`，以及 step 3 的 BACKGROUND_STARTED；96.080 秒觀測到 done.txt。**串流沒有在命令完成前交付該文字**，不可只看最終回答順序就說它已提早送出。
3. 原生出現 step 4 `system_message`，step 5 主動補充背景工作完成。98.940 秒才收到唯一 `result`，`num_turns:1`；native log 21:19:22 的模型請求對應此補充。這是尚未結束的同回合內處理背景完成，不是 result 之後的新回合。
4. 檔案完成後再觀察約 20 秒（result 後約 17 秒），沒有第二個 result／新回合，程序保持存活。116.222 秒關 stdin，116.291 秒正常 exit 0；未使用 killTree。

**持續 stdin 在短測中能保留程序，背景指令成功完成，完成通知能在原生回合結束前帶出補充。** 本測未覆蓋超過 30 分鐘、EOF 發生時仍有活動指令、停止／權限切換或重啟。不能據此承諾長任務無限存活，或稱回合結束後會自動接續。

原錄音聊天室兩次約 30 分鐘取消的結論與時間由 Opus 在任務書提供（16:04:48→16:34:49、17:14:49→17:44:51），本工人未讀該正式聊天室或再次重現。新版提示把「30 分鐘」表達為已觀察到的事件，且明確說的是**回合結束後**不自動喚醒，不否認 P3 證明的回合內補充。

證據：`p3-background.stdout.ndjson`、`p3-background.timeline.ndjson`、`p3-background.native.log`、`p3-background.summary.json`、`event-sequences.json`。

## 最小設計提案（未實作，交 Opus 決定）

P2 不支持立即送入；建議仍保留 `capabilities.steer = false` 與 K 待送佇列。若目的只是避免錯誤承諾，本批提示已可獨立交付。持續程序只在有明確效益且下列生命週期驗證通過後考慮，不以它冒充 30 分鐘問題已解決。

| 範圍 | 最小候選變更與必要限制 |
| --- | --- |
| 程序入口 | 在 `src/gemini-worker.mjs` 提供可持有 stdin 的原生程序 handle，沿既有 spawn、環境白名單、stderr 診斷與 killGeminiTree；主聊天室使用，普通工人保留既有單次行為。不另造代理迴圈。 |
| 聊天室所有權 | `src/gemini-controller.mjs` 每個已開啟聊天室擁有自己的 PID／stdin／串流解析器；程序存活與回合 busy 分開。每則以原生 result 結束，不能等程序 close 才結束回合，也不能把 agent_response 文字當 result。結果的 num_turns／usage 可能累積，訊息與工具需依本回合的起點歸屬，避免重用上輪 result。 |
| 送出與排隊 | `src/input-queue.mjs`、`src/unified-controller.mjs` 延用既有待送與來源聊天室綁定；一回合一則送入，不預先塞多則到 agy 隱藏佇列。`stdin.write` callback 只表示本機寫入，不等於原生接受；寫入後斷線／程序錯誤保留送出未確認，不重送、不啟動新程序重播。若將來真的要 steer，必須另有原生協定與真測，不能只改 queuedMessages。 |
| 背景指令 | 以原生工具事件與 result 判斷；保持 stdin 本身不代表可提供背景工作保證。回覆文字、工具 DONE、原生回合 result、程序退出是不同證據。不新增檔案猜測成功、模型監看或自動再提示。 |
| 停止／關閉 | 閒置且已無活動的程序可關 stdin、等待 close；活動回合的停止仍用既有 killTree 結束該聊天室自有樹。只有確認 close／樹結束才清除所有權；停止不明保留 unresolvedPid，阻止重播、換帳或宣稱成功。切換畫面不關其他房程序。EOF 在仍有背景工作時的行為須補測，不能假定 EOF 就是取消。 |
| /goal | `--disable-slash-commands` 是程序啟動旗標，不能在同一常駐程序裡假設逐訊息可切換。最小方案是保留目前 /goal 專用單次路線：先確認普通持續程序閒置並正常退出，再啟動 goal；不得為共用程序而全面開 slash。執行中的目標不換程序、不重播，不實作重啟復活。 |
| 設定變更 | HOME／cwd／模型／權限／MCP 改變仍需閒置；確認舊程序退出後，下次明確送出才依新設定啟動。不可只重寫 settings.json 就假設存活程序已改權限。 |
| 帳號 lease | `src/gemini-accounts.mjs` 的 lease 必須涵蓋原生程序整個存活期，不能在每個 result 就 release。閒置的持續 agy 仍可能持有登入；帳號切換要先等全部 Gemini 工作自然結束，關閉閒置程序並確認退出，再依既有官方耗盡／下一帳可用規則處理。同帳號並行仍可；不同帳號不並行。主／工人／討論程序一併核對，不靠另建 registry 解決。 |

候選驗收至少補：一個程序的兩個回合與 result 歸屬、EOF 活動背景指令、活動停止與 killTree 失敗、寫入不明不重送、/goal 模式銜接、閒置程序與 account lease／換帳、設定變更。這些只是設計項目，沒有宣稱已測或已接通。

## 驗證與原始失敗

- 聚焦 `node --test test/gemini-controller.test.mjs test/gemini-worker.test.mjs test/worker-policy.test.mjs`：98/98，0 fail，2,905.7406 ms。後續僅把生命週期文句改為「曾在」及相應斷言，再由完整測試涵蓋。
- 首次 `npm test`：1790 pass、2 fail，68,930.5353 ms。新 worktree 沒有 dist-ui，`branding.test.mjs:6` 的 favicon 與 `desktop.test.mjs:1212` 的首頁檢查因缺少建置頁失敗。沒有放寬或修改這兩個測試。
- 執行 `npm run build:ui -- --configLoader native` 補本 worktree 的測試產物，成功（634 ms）；native config loader 避免向共用 node_modules 寫入暫存設定 bundle。未安裝套件、未更動 junction 內容；Vite 的既有大 chunk 提示保留，未為此拆包。
- 再跑 `npm test`：**1792/1792，fail／cancelled／skipped／todo 全為 0，68,988.0536 ms**。
- `git diff --check` 通過。沒有 UI 原始碼異動，未加跑 `test:ui`。沒有改原生權限配置，P2/P3 的完整存取只在假工作區，不替代其他權限的 native probe。

原始完整輸出：`targeted-tests.log`、`full-tests.log`（首次失敗，完整保留）、`ui-build.log`、`full-tests-after-build.log`。首次末段失敗原文另存 `full-tests-initial-failures.log`，未改寫訊息。

## 取捨、審核與未完成

- 採納 Opus 任務書的 B1–B4 範圍；P2/P3 只做探測與提案，沒有擅自接持續程序或立即送入。
- 對 P3 的證據保留「回合內補充」與「回合後喚醒」的區分；未以短指令成功否定 Opus 已核實的 30 分鐘取消。
- /learn、/compact 直接執行與所有 expansion 行為仍未驗；未開放。新短版 always_on 的實際模型遵循只做接線測試，尚未另消耗回合驗收。
- 尚未實測長於 30 分鐘、持續 stdin 的活動 EOF、停止及 lease 切換；不能聲稱持續程序設計已可發布。
- 不開放 workspace-write 指令、不寫桌面、不復活工作、不猜目標檔案成功、不跨帳號並行。正式 main／K／GitHub 均未更新。
- 工人結果交真正 Opus 5.5 獨立審核；本文件的自查與完整測試不是 Opus 意見。

## 起因與 Gemini 自評的核對（Opus 5.5）

本人在錄音轉文字聊天室（完整存取）請 Gemini 自評接法困難，Gemini 交出六大項清單。Opus 逐條對程式與原生紀錄核對：

- 採納：分工長文無關（實際約 3,000 字，不是 8,000）、工具說明不分權限、斜線指令矛盾、附件提示冗長（即 B1–B4）。
- Gemini 稱工作因「伺服器重啟」中斷不實。該聊天室 native log 兩次都在最後一次模型請求後約 30 分鐘 `Cancelling steps` 並結束程序（16:04:48→16:34:49、17:14:49→17:44:51）；K 啟動器當天沒有重啟紀錄。P3 再證實 agy 在同回合內等背景指令完成才送 result，所以這是 agy 回合收尾等背景指令的上限，不是 K 截斷。
- 不採納：「同帳號鎖住其他聊天室」不實（`gemini-accounts.mjs` 的 `running` 計數允許同帳號並行，只有換帳號要等全部停止）；寫入工作區外桌面、重啟後自動復活、K 猜目標檔判成敗、跨帳號並行，皆與現行規則或最小接法衝突。
- 待本人決定：workspace-write 是否開放受控命令。本人指示先驗證 agy `--sandbox` 在 Windows 的實際邊界再考慮，本批不改權限。

## Opus 5.5 審核意見與補修

- 程式正確、範圍符合任務書；B1–B4 無過度工程化。P2 原始事件抽查確認第二則 `user_input` 在第一個 `result` 之後，兩種設定都沒有執行中插話。採納 Astra 建議：維持 `capabilities.steer = false` 與 K 待送佇列，**不實作持續程序**——P2 沒有插話效益，P3 的背景完成也在單次 print 程序的同回合內發生，持續 stdin 無法改善 30 分鐘上限。
- 補修 1：唯讀／工作區寫入的權限句改為也明講「不能執行命令」（及唯讀不能寫檔、工作區外寫入會被拒絕）。原版只列能做的事，Flash 仍可能嘗試命令並撞上 headless 自動拒絕；這是事實邊界，不是額外禁令。
- 補修 2：共用說明加回「背景執行無法向本人要求核准」。原句來自 `e95b30a`，是 headless 的原生事實，Astra 精簡時一併刪除；「為可選暫存流程讀工作區外檔案」的特定提醒不加回。
- 補修後聚焦測試 98/98，完整 `npm test` **1792/1792**。prettier 只格式化本次修改行。
- 部署：K 內的 AI 無法停止或更新所在的 K；本批需本人在無工作執行時「離開並停止 K」，於 K 外執行 `Update-K.ps1 -Ref <本批合併後 main 完整 SHA>`，讀回 `.local/runtime.json` 後再 push。截至本紀錄**尚未部署、尚未 push**。

## 補充：agy `--sandbox` Windows 實測（gpt-6.1-sol high，Opus 5.5 判讀）

本人指示 workspace-write 是否開放受控命令「先驗證過再考慮」。Sol 只做實測、不改程式；完整報告與原始事件在 `D:\K-harness\.runtime\archive\gemini-sandbox-probe-20261021\report.md`。

- 現行 `unsandboxed(*)` deny 在 agy 1.4.3 會直接封鎖所有命令（即使允許 `command(*)`、未加 `--sandbox`）；agy changelog 已將 `unsandboxed` 規則列為過時並提示遷移，但目前實際效果仍是封鎖。
- 移除該規則、允許命令且不加 `--sandbox` 時，14 項命令全部成功：可改寫／刪除工作區外假檔、寫入真實使用者目錄下的測試子目錄、改 HKCU 測試鍵、連 example.com、以子程序寫工作區外。原生 `write_file(W)` 規則不約束命令副作用。
- 加 `--sandbox` 後，連工作區內命令都在啟動前失敗（`The system could not find the environment option that was entered`，即找不到環境變數）。本機為 Windows build 26300，符合 changelog 的 24H2 以上支援條件；推測與 K 的 `geminiEnvironment` 環境變數白名單有關，**未驗證**。因此沙盒實際能擋什麼仍未知，不能當安全證據。
- 原生 write_file 寫工作區外仍被拒絕；被拒的 run_command 事件可能是 `DONE` 但輸出為 `Command failed to run`，CLI 結束碼 0 與 `SUCCESS` 都不代表操作成功。
- 清理：Opus 讀回 `HKCU:\Software\KSandboxProbe` 不存在、無殘留 agy 程序、Git 工作樹乾淨。

第一輪後 Opus 判讀：維持 workspace-write 禁止命令，不改權限；需先讓沙盒內命令正常執行再取得有效對照。

## 補充二：沙盒根因與實際邊界（Opus 5.5 親自實測，6.1 Sol 兩次只讀檢查）

本人要求可測就測：本月 Claude 額度較多，由 Opus 親自跑，6.1 Sol（high）做最後檢查。完整報告、實測程式與原始事件在 `D:\K-harness\.runtime\archive\gemini-sandbox-env-20261021\report.md`（`probe.mjs`～`probe3.mjs`，s1～s7）。只用假資料；未改 K 程式、未讀憑證或正式聊天室資料、未切換帳號。

- **根因**：agy 的 Windows 沙盒（AppContainer）要在 `%LOCALAPPDATA%\Packages\sandbox.{GUID}\AC\Temp` 建暫存；`geminiEnvironment` 白名單沒有 `LOCALAPPDATA`。只補 `LOCALAPPDATA = <隔離 HOME>\AppData\Local` 即可運作（s2），同一次測試不補就失敗（s6 陰性對照）。
- **確認擋住（UnauthorizedAccess／存取被拒）**：工作區外寫入、改寫與直接刪除；真實使用者資料夾、%TEMP%、隔離 HOME 寫入；經事先存在的 junction 往外寫；HKCU 寫入；沙盒命令的 DNS、直接 IP 與本機 loopback（主機對照可連，測試伺服器收到 0 次）；子程序繼承沙盒後的外部寫入；模型要求跳出沙盒（`permission check failed for unsandboxed`，`command(*)` allow 不涵蓋，靠 headless 預設拒絕）。
- **沒擋（讀取）**：D 槽一般資料夾可讀（含 D 槽根目錄新建資料夾、經 junction 讀）。測過的使用者資料夾假檔讀不到，但根目錄名稱可列出。**不提供只限工作區的讀取隔離**；D 槽上其他專案資料推定可被沙盒命令讀到，未逐一實測。
- **副作用**：工作區 W 的 ACL 執行前後相同；但測試工作區上層的 `D:\K-harness`、`.runtime`、`.runtime\tests` 各留下一條非繼承的能力 SID `S-1-15-3-1024-132000074-…:(S,X)`（只能同步與穿越），推定由 agy 沙盒加入、跑完未移除。未移除，來源與日後是否清除未證實。
- **實用限制**：沙盒命令沒有網路（pip／npm 安裝推論會失敗，未直接測）、不能連本機服務、只能寫工作區、不能寫桌面。GPU／CUDA、長工作、正式 K 啟動路徑（MCP、project grants）未驗證。
- Sol 第一次檢查指出刪除失敗不是明確拒絕、例外只記外層、讀取與網路結論過廣、junction 只測新建、缺陰性對照；第三輪逐項補證。第二次檢查判定主要缺口已解決，再收窄三處措辭（使用者資料夾讀取只限測過的假檔、網路只限沙盒命令、上層 ACL 只是可能）。

Opus 判讀：技術上可以做出「工作區寫入＋沙盒內可跑命令」的中間模式（補 `LOCALAPPDATA` 指向隔離 HOME、加 `--sandbox`、allow `command(*)`、移除 `command(*)`／`unsandboxed(*)` deny）。取捨是：寫入、網路與登錄檔被擋，但讀取範圍會從工作區擴大到 D 槽一般資料；這是權限變更，**待本人決定，本批不實作**。若採用，上線前需在正式 K 啟動路徑重跑同一組配對，並另驗實際工作（例如 CPU 轉錄）能否在沙盒內完成。
