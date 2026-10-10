# K 輔助原生壓縮：協定實測與最小候選

## 使用者最新要求與範圍

使用者明確澄清：不打算關閉原生壓縮，而是 K 必須有輔助原生壓縮的能力。本輪依此驗證公開接點，並與真正 Opus 5.5 討論。**完成隔離 runtime 原型及設計裁決；未整合成產品功能、未部署／重啟／停止正式 K、未修改六個測試對話以外的原生聊天室、未改小說、未恢復／重送原工作、未 push。** 不將此原型稱為極長任務已修復。

來源是當前已安裝 `433e7f23459eebf4fa7b1183cba495f39cf12e3d`，工程工作樹 `C:\Users\Paulus\.codex\worktrees\room-lock-fix-20261010\K-harness` 當時 HEAD `ff8cc395a02f53675bd92636d9fa222a36342394`。正式執行檔／帳號不升級。主工作樹原有修改保留，不將其旧產品碼當現況。

證據根目錄：`D:\K-harness\.runtime\compaction-assist-probe-20261010`。本輪新增 schema、已固定官方 tag 的少量唯讀來源、假資料腳本及討論封包；工程工作樹 `.runtime/compaction-assist-probe/prototype-gateway.mjs` 是臨時原型，非正式 gateway 修改。未安裝相依、搬憑證、改全域設定、啟用付費 API 或另一套記憶系統。

## 直接原生測試

Codex 0.161.0／官方 ChatGPT 訂閱，原生目錄核對 `gpt-6.1-sol`，effort medium，read-only。僅六個新建測試 thread、各自新建假資料 cwd。普通模型工具不得 Shell、讀真實檔案、瀏覽器或派工；動態工具只供一次假輸出。目標測試另允許原生 goal get/update 完成各自的假目標，預算 4,000，兩者讀回 complete。這個預算不是帳單或完整實驗總用量證明。

| 原型 | 實際結果 | 必須保留的限制 |
|---|---|---|
| `protocol-v2/result.json` | developer-role `thread/inject_items` 接受，閒置時沒有開新 turn；手動壓縮後下一個明確回合讀到 marker、永久術語、已取消舊暫停 | 回合內自動壓縮第一次完成時注入，第一個後續回答仍是 `NONE`；再一次壓縮後才讀到 marker。ACK 不代表立即續行可見，不能把事件監聽器事後注入當可靠主路徑 |
| `hook-v2/result.json` | 同步 `SessionStart`、matcher `^compact$` command hook：一回合內一個假工具輸出觸發一次自動壓縮，立即後續回答讀到 marker；另一次手動壓縮後 goal 自行開始，沒有另呼叫 turn/start，讀到 marker 並 complete；兩次 hook、無 warning | 固定文字 marker 是時機測試，不是控制／工作記憶驗收；測試降低了僅本測試 thread 的自動壓縮門檻，正式門檻未改 |
| `mcp-hook/result.json` | 同一原生 `SessionStart` compact 用 `mcp_tool` 呼叫既有 K gateway 的原型唯讀入口；callback 同步讀 native goal 與原始 thread，7ms／5ms 完成，立即回答及後續自行 goal 都讀到 marker；兩次 hook、一次假輸出、一次自動壓縮，無 warning | 這是兩次小歷史 callback 的總耗時，不是大歷史效能或可靠率；沒有證明全部真實長任務、錯誤路徑或其他供應商 |

六個測試 thread：
- inject idle `01a1248b-5c6c-70d0-88e5-659d87fd8171`、auto `01a1248b-9f10-7983-98bb-42c50f1d5d98`。
- command hook auto `01a1248f-cff0-7532-a81b-698c1530feab`、goal `01a12490-0b57-74f3-bfc9-52a6fd3cd242`。
- MCP hook auto `01a12492-da6e-7401-b6ae-0f3c02bdac73`、goal `01a12493-2803-79b0-962b-cd293a40ce56`。

所有普通測試回合 completed；兩個假 goal complete；腳本 finally 只關自己的測試 host／gateway，不對正式 K 發停止。沒有刪除測試對話或檔案。

### 原生擴充與信任邊界

- 由已安裝執行檔產生 experimental JSON schema，再讀 [官方 App Server 文件](https://learn.chatgpt.com/docs/app-server) 與 [官方 hooks 文件](https://learn.chatgpt.com/docs/hooks)。文件指出 `SessionStart(source=compact)` 在下一個模型請求前執行，也涵蓋回合內自動壓縮。實測結果支持本台入口可行，不把文件當實測替代。
- 固定 `rust-v0.161.0` 官方 `hook_config.rs`／`hooks/schema.rs`：`mcp_tool` 存在；`PostCompact` output 只有共同欄位，**不支援本方案所需的 `PostCompact.additionalContext`**，不使用臆造欄位。新增原型採 `SessionStart.additionalContext`。
- 每次先原生 `hooks/list`，取得並核對自己那一個新 hook 的 key／hash；只在自己新 host 的 `-c` session-flags layer 信任該精確定義，再讀回 `trustStatus: trusted`。沒有用 bypass flag、沒有寫 K 家目錄／全域 config 或永久信任其他 hooks。
- 真 MCP hook meta 是 `{progressToken:1,threadId:<本測試 root>}`，沒有現有改動類工具要求的 `x-codex-turn-metadata` 或 turn id。產品若接入，唯讀 callback 應獨立核對本 gateway／本原生 thread 身分；**goal_edit、goal_resume、conversation_continue 的改動驗證不得放寬**。原型目前只白名單六個中的自己測試 id；不將其視為產品隔離已驗收。

### 初次失敗也保留

1. 最初 `sandbox: readOnly` 被協定拒絕，未建立 thread／模型回合。新的獨立 v2 使用 schema 實際要求的 `read-only`。`error.json` 保留。
2. 初次 session-flags 信任 key 的 dotted override 被解析錯誤，讀回仍 untrusted；停在模型回合之前。新 v2 改整張 `hooks.state` 表，再精確讀回 trusted。`hook/error.json` 保留。
3. MCP 原型最初假 bridge 缺 start/wait/inspect/cancel，gateway constructor 先拒絕，沒有原生請求；補上全部拒絕派工的假函式後才開始測試。沒有重送任何原工作。
4. 官方來源查閱若路徑不存在有 404，未把不存在檔案當已读；後續只用實際取得的 schema／config／registry 等來源。

## 真正 Opus 5.5 討論與主代理裁決

Claude Code 2.1.294／官方 Claude.ai firstParty Pro；兩輪实际 assistant model `claude-opus-5-5`，session `c88de6b7-a578-46f1-9cfd-6da56a3d1971`，均 exit0、success、is_error false。第一輪16、第二輪6次 Read／Glob／Grep，讀取範圍是 `opus/packet`；禁止 Shell、寫入、MCP、Chrome、派工及 API 切換。原始輸出／preflight／結果在 `opus`、`opus-round2`。

第一輪建議唯讀工具＋固定 command 提醒，並錯把封包缺少 MCP config 定義推成原生不支援。Astra 沒直接採信，補入官方固定來源及新增 MCP 直接實測，指出 metadata／重入 RPC 已有事實。第二輪 Opus 撤回存在性推論，支持修正成下列最小候選；仍非程式碼／產品驗收。

### 最小產品候選（尚未整合）

1. **沿既有 gateway 增加一個唯讀現況入口。** 模型可以按需取得同對話原始本人訊息 id／順序／原文、原生 goal 即時讀回、已知工人與壓縮資訊；原文按頁／長度限額取得，標記截斷／省略與 UNKNOWN。不生成另一份遞迴摘要，不做自然語言分類器，不由 K 判定所有指令有效性。
2. **原生同步 `SessionStart compact` hook 呼叫同一唯讀 callback。** 壓縮後、第一次續行前自動提供一份小型必要事實；附讀回時間／來源，明示引用歷史不是新本人命令，不授權恢復或重派。既有改動工具的身分與授權不變。不要再用競態已被觀察到的事後 `thread/inject_items` 作主路徑。
3. **決策前重新讀回，工作記憶沿用已有真值。** 更新 K 的一次性暫停完成／被明確取消後不再復活；待工人收尾且未被取消的新暫停仍有效。任何 native active 通知不能單獨當取消證明。模型重讀專案既有進度／術語／事件／裁定與成果，不照搬過期交接或另建第二套 ledger。K 不擅改小說真值。

快照不是永久真值：較舊快照只供歷史參考；需要控制目標、派工或延續成果時用唯讀工具取得新資料，並核對原文／實際成果。同步可見不等於模型一定正確理解，不宣稱硬性攔住所有原生 update_goal。

## 未完成與正式狀態

產品尚未接入。仍需把上述唯讀入口與受信任 hook 正常整合，再相稱驗證：多次壓縮最新資料覆蓋、舊暫停取消／合法延後暫停、本人新更正、hook／工具失敗或逾時、子代理與四房隔離、較大歷史按需讀回及未知成果不重播。保留原生預算／用量／權限，不能用另一個模型或新 goal 掩蓋限制。

本輪只驗 Codex 0.161.0；Claude／Gemini 仍須各自的公開入口及實測，不能冒稱三核心已接通。未在自然默認門檻或實際上百次壓縮長任務驗證；尚無降低誤停／翻譯品質偏移的可靠率或總用量結論。正式 K 維持當前已安裝版本，不自動排程、重新執行或更新。

## 後續產品候選

本文件記錄前置原型；後續本人要求開始執行，Codex同步hook＋唯讀回讀已整合並完成候選驗證／真正Opus程式複查，精確實作、失敗及仍未驗證界線見 [產品候選](compaction-assist-candidate-20261010.md)。未部署正式版，不能把前置marker或短測當100次長工作已修。
