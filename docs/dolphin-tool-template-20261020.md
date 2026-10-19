# Dolphin 本機工具模板修正（2026-10-20）

## 本輪範圍

本人回報 Dolphin 只列出計畫或把 `filesystem_read`、`filesystem_write` 的 JSON 寫成聊天文字，輸出資料夾沒有實際產物；要求與真正 Opus 5.5 討論、查開源社群並修正。本人先明確允許「只修 Dolphin 專屬模板」，後允許實測有效後修 Dolphin 等待設定；最後追加授權自行處理這顆小模型必要調整，不再逐項詢問。仍保留可還原性，不改其他模型、帳號、權限或計費。

本輪不恢復原小說工作，不讀其原文與翻譯內容；測試僅使用新建的無敏感韓文短句。等待設定候選在分支實作，原生核心、帳號、目標模式、工人與權限設定不變。沒有安裝或升級套件、沒有換模型或使用 API Key。

## 根因與證據

- 直接讀取現有 Dolphin Q4_K_M GGUF 的 metadata（僅讀標頭）：底模為 Mistral Small 24B Instruct 2501、原生上下文 32768，並非後來更新的 Dolphin 1.2。
- 其原始 Jinja 只處理 system/user/assistant，沒有可用工具定義、assistant tool_calls 與 tool 結果角色；其他角色還會報不支援。
- 修前簡短 system＋單一無副作用工具，Chat Completions 與 Responses 的 auto/required 各一輪均沒有工具呼叫。LM Studio 原始輸入紀錄只有 57 tokens，證實工具定義在套模板時消失；不是使用者少說一句「直接開工」。此前 K bridge＋原生 Codex 的三輪自然對話測試亦為工具事件 0、輸出檔 0。
- 修前四輪完整結果 JSON 被重測腳本覆寫，不能再作為現存獨立證據；修前原始輸入／輸出 log 與前述原生 K 三輪結果仍保留。
- HF 底模當前 tokenizer_config 也不含工具模板，不能宣稱「量化轉換弄丟上游原有模板」。依底模作者指定的 mistral-common tokenizer 格式確認 V7 的工具編碼，不套用新版 V11 模板。
- 單次原始 `/v1/completions` 診斷，提供 V7 的 AVAILABLE_TOOLS 後可得到正確名稱／參數 JSON。這只是定位，不把 K 改接純文字 completions，不把聊天 JSON 解析成執行命令。

## 最小變更

只新增 LM Studio 原生「每個模型預設」中的 Dolphin Q4_K_M 設定：

`C:\Users\Paulus\.lmstudio\.internal\user-concrete-model-default-config\bartowski\cognitivecomputations_Dolphin-Mistral-24B-Venice-Edition-GGUF\cognitivecomputations_Dolphin-Mistral-24B-Venice-Edition-Q4_K_M.gguf.json`

第一版設定只有 `llm.load.promptTemplate`，當時沒有 inference 參數變動；後續 14 層配置與溫度調整見下文。這是該程式實際的 per-model 設定儲存，不是 model index 或 GGUF metadata 快取。格式對照既有 per-model 設定與官方 lmstudio-js schema，實際重新載入與格式化輸入紀錄確認生效。

保留原有無工具對話格式與預設 system，補上三項：

1. 最後一個 user 訊息前輸出 `[AVAILABLE_TOOLS]` 與 JSON 定義。
2. assistant 的工具歷史依 V7 輸出 `[TOOL_CALLS]` 陣列，arguments 若已是 JSON 字串不再雙重編碼。
3. tool 結果輸出 `[TOOL_RESULTS]id[TOOL_CONTENT]content[/TOOL_RESULTS]`，不再拒絕 tool 角色。

原來沒有該 Dolphin override，繼承的 GGUF 模板已另存。還原時只將上述新增設定檔移入資源回收筒，下一次正常載入即回到原 GGUF 模板；不改權重或其他模型。其他模型設定另有操作前後摘要核對。

## 驗證

- 修後兩個 API 各 auto/required，共 4/4 返回真正的結構化 `tool_calls`／`function_call`，不再只有文字。K 沒有設成永久 required，仍由模型 auto 選工具。
- echo 參數被模型多加句點，故只能判斷工具協定已接通，不能稱為精確字串遵循測試通過。
- 工具結果往返另測通過：第一輪真正呼叫 `k_diag_echo`，這次精確參數沒有多句點；第二輪提供帶 receipt 的工具結果後，模型正確讀懂。說明工具結果角色不是下一個阻礙，但不保證每次參數均精確。
- 模板設定只有 `llm.load.promptTemplate`，原來 override 不存在；套用後 SHA-256 `bb0d93d86295a5766b93418773399eac2ada2c8f83a19af1943a8ef4975da687`。其他三份模型設定前後摘要一致。
- 原生 K 讀寫閉環與複查結果待補，不能僅憑上述四次宣稱整個工作流程可用。

## 第二個阻礙：無串流期間的兩層等待

工具定義真正送入之後，隔離原生測試的首個請求 59,118 bytes、13 個原生工具，超過原生 Codex 的預設 300,000 ms SSE 閒置上限。約 310 秒報 `idle timeout waiting for SSE`，之後重連被既有 busy 防重送拒絕；只有一個真正的 LM Studio 推論，沒有實際檔案工具事件。後兩句只得到 busy 拒絕，不視為有效模型測試。

僅把隔離原生設定拉到 1,200,000 ms 後，約 316 秒變成 `Transport error ... error decoding response body`；上游 fetch tap 記 `terminated`。回應標頭僅花 25 ms，指向 Node fetch 另有預設 300 秒內容閒置限制，尚缺該次直接 `cause.code`，故不能把推論當成完整因果證明。

後續隔離對照以既有 Undici Agent 診斷參數在兩層都延長等待（不是正式 Node HTTP 候選），仍保留原提示、原工具、auto 選工具、權限與 768 輸出 token 診斷上限；不設工作總長度截止、不啟動目標循環。這次原生回合終於 completed，只有一次真正推論，但仍只回覆「現在開始」，工具事件 0、輸出檔 0：等待解除了提前斷線，沒有解決完整任務能力。

LM Studio 實際格式化提示有工具定義，16,935 input tokens；首 token 1162.09 秒，總推論 1300.37 秒、114 output tokens、0.817 tokens/s。之後查到另一個錄音轉文字工作在相同期間使用顯卡（其 Python 程序開始於 01:07:52），不能把這次速度當成 Dolphin 獨占資源的 benchmark，更不能因此停止別的工作。原生測試已結束、自己的模型實例已確認卸載後才調整。

## 工具行為與記憶體配置後續候選

本人擴大授權後，在同一 Dolphin 專屬設定中追加：

- 保留原模板，加上工具必須以真正 V7 工具呼叫發出、不編造工具結果、不以承諾稍後開始結束工作的內部提示；不改本人自然語言提問，不強制 `tool_choice`。
- GPU offload ratio 0.35，LM Studio 實際讀回由 16 層改 14 層；載入估計由權重 5.91 GB＋context 1.46 GB 改為 5.17 GB＋1.28 GB，為 8 GB 顯卡保留更多餘裕。這只是目前配置候選，不宣稱已證明溢位或已改善速度；不改權重、量化精度或 32768 context。
- 前一份模板設定完整另存 `dolphin-before-performance-tools.json`，還原時可回復前一設定；最初沒有 override 的狀態仍可藉回收新設定檔還原。

使用分支的實際 HTTP 候選再做相同自然語言檔案測試，候選結果待補；不把原生 completed 或畫面文字當成檔案完成。

候選程式僅對既有 `selfhost-dolphin-mistral-24b-venice`、local、1234 端點：

- `src/gemma-main.mjs`：原生 provider inline table 加 `stream_idle_timeout_ms=1200000`，不改重試。
- `src/gemma-responses.mjs`：用現有 Node 內建 HTTP 傳輸等待本機 Dolphin，socket idle 1,230,000 ms，保留串流與取消、不跟隨重新導向、不重試；既有 Responses 格式轉換與 lease 完成／未知判定不變。
- 其他 Gemma、Qwen、自架與雲端端點仍用原有 fetch 與原生等待，無新依賴、全域 dispatcher、heartbeat 或人用設定。
- 新增／補充 `test/dolphin-inference.test.mjs`、`test/gemma-main.test.mjs`：閒置標頭／內容、正常串流、取消、重新導向、錯誤內容、既有 bridge SSE 與只對 Dolphin 生效。

聚焦測試 20/20；完整 `npm test` 1792/1792（0 fail／skip），正式原生閉環與部署狀態待補。候選不是正式生效。

## 原生工具行為的實際失敗與後續調整

第一輪 14 層配置實際有兩個原生 `exec_command` 事件，但它把 PowerShell 再包一層 `powershell -Command`，變數被外層展開，兩次均 exit 1；即使命令成功也只會複製韓文，並非翻譯。另有原生語言模式不允許點載入 profile 的訊息，不把這則警告誤認成 K 阻擋或主要語法錯誤，不改權限或全域 profile。工具結果送回後模型輸出空 EOS，沒有成果。

第二句自然語言後，模型違反測試的「不派工」指示，兩次嘗試原生 spawn_agent，因同時傳 message 和 items 均被原生參數驗證拒絕，沒有建立子代理。為避免越出隔離範圍，主代理核對沒有工具子程序（僅 conhost）後，只停止該次隔離 Codex 與自己的 runner，再卸載自有模型；不稱本次自然 completed 或成功。單獨卸載模型不能保證停止原生回合：該次曾被仍在執行的回合重新載入，故最後同時核對自己的原生程序與實例已結束。原小說與其他工作未重播。

先前測試工作區位在 K Git 專案內，實際 request 確有父層 K 工程 AGENTS。後續仍經既有 scratch helper，在暫存工作資料夾建立獨立 Git repository，讓原生規則探索停在正確專案邊界；實際 request 已確認不含 K 工程規則。沒有改正式規則探索、關閉工具、改本人提問或原生權限。13 個原生工具仍保留。

同一 Dolphin 的 operation 設定追加 `llm.prediction.temperature=0.15`，原來 fields 為空；先前有效溫度未知，不倒推為某個數字。本機公開 SDK 唯讀 RPC `getBasePredictionConfig` 已讀回該實例基礎溫度 0.15；原生請求未額外覆寫溫度。沒有安裝 SDK，沒有讀取帳號或金鑰，也沒有額外推論。其他取樣項目不更動。

乾淨專案邊界＋溫度設定的第一個自然語言測試：原生 completed、0 工具、0 產物，還編造不存在檔案；原始測試檔實際存在。追加 Dolphin 專屬 Windows 工具用法提示後再測：實際格式化提示 7602 tokens、新提示及工具定義均存在、不含 K 工程規則，但仍 completed、0 工具、0 產物，只承諾稍後執行。這些是模型行為失敗，不是 transport 或 K 核准阻擋。

最後候選將工具提示移到工具清單旁，加入清楚標示「僅語法示例、不是已執行或證據」的原生呼叫 JSON；沒有偽造工具結果、把聊天文字當指令執行或強制 tool_choice。實際檔案閉環與 Opus 後續意見待補。所有模型設定前一版均另存，未修改權重。

## 工具真執行後，讀取文字編碼的第三個阻礙

工具清單旁的語法示例版本確實產生原生列檔、讀檔及兩次 apply_patch，建立了兩個實體檔；但不能視為翻譯成功。PowerShell 的 `Get-Content -Encoding UTF8` 把韓文輸出成問號，模型據此捏造「這是一個測試句子」，二次翻譯檔甚至是英文，也沒有實際讀回。

另外以同一原生 Codex 0.163.0、workspaceWrite、ready 沙箱做三組不經模型的 command/exec 對照，原始檔是已知 UTF-8 合成韓文：

1. 語言模式讀回 ConstrainedLanguage；Get-Content 來源讀取成功，但 stdout 韓文變成問號。
2. 設定 Console.OutputEncoding 為 UTF-8 被該語言模式拒絕；沒有採用、沒有放寬沙箱。
3. 直接以既有 Node.js 的 fs 讀位元組到 stdout，原句完整、exit 0、stderr 空白。這是相同原生權限本來允許的程式，不是繞過 setter 或另設權限。

因此只調整 Dolphin 模板的讀檔用法，採獨立 Node 命令輸出 UTF-8、apply_patch 寫入運算結果；保留原生工具與核准，不新增 K 執行器或文字轉指令。操作前設定存於 dolphin-before-utf8-node.json。真正 Opus 5.5 已實讀上述三組結果與候選模板，無阻擋；建議 Node 獨立命令、不透過 PowerShell 管線或變數，讀回同法。管線再編碼風險是推論，沒有冒稱已實測。

這版的原生自然語言測試（probe-utf8-node-result.json）實際 Node 讀回完整韓文，但只回英文翻譯與「接著開始」，原生 completed、1 個真正命令、0 輸出檔。證明讀取已修、執行連續性仍未解決；不把模型承諾當背景工作。

## 執行連續性：續作提示與範圍對照

真正 Opus 5.5 建議把未完工作須繼續實際呼叫的提示放在最後工具結果後，不加新代理迴圈。實測 probe-tool-continuation 第一個推論即只列計畫，未到工具結果；再把一份繁中提醒放在最後 user/tool 後，probe-action-footer 仍為 0 工具。實際 LM Studio 格式化輸入已讀到提醒，並非設定未生效；兩者均自然 EOS，不是 768 輸出上限截斷。

再將工具清單旁的英文長說明改成較短繁中與明示虛構的列檔／lime 轉 LIME 寫檔語法例，沒有假的工具回傳、沒有把示例當證據。probe-action-examples 的兩路翻譯任務仍只列計畫；尚不能宣稱已解決。

為區分工具協定與多步驟工作能力，另做兩項有界診斷，不代替完整驗收：

- 原封不動 13 個原生工具，單一「建立工具測試.txt、寫入指定繁中文字串、讀回」：3 次模型推論，真正 apply_patch 成功、真正 Node 讀回成功、獨立讀回實體檔內容一致；最後繁中回報。這證明原生工具與 UTF-8 的基本寫入／讀回可用，不等於兩路翻譯或長任務可靠。
- 僅在該隔離診斷請求把模型可見工具定義減為 exec_command/apply_patch，原完整兩路翻譯仍 0 工具，並誤稱缺翻譯工具。沒有把工具減量部署 K，也沒有修改原生權限或代理核心；不能把問題歸因為工具太多。

最後一項候選只把「沒有翻譯工具」的否定措辭改為「文字理解與翻譯由模型完成，檔案讀寫由工具執行」。完整 13 工具的原始兩路請求仍只有承諾，0 產物（probe-translation-role-result.json）。此時模型設定有 V7 協定、繁中內部工具指引、14 層配置、溫度 0.15，沒有換權重或工具強制策略。不能把偶發工具成功稱為完整能力。

## 單一真實翻譯檔案閉環通過

維持最後一版模板、原生 13 工具、相同 workspaceWrite/auto-review、無額外續送，改用另一份合成韓文「내일 오후 세 시에 도서관에서 만나요.」做單路檔案翻譯。模型真正 Node 讀取原句、apply_patch 寫譯文.txt、Node 讀回後才回報。4 次真實模型推論，3 個成功工具事件；主代理獨立核對輸出 JSON 中保存的實體檔為「明天下午三點在圖書館見面。」，與原句相符、無多餘空格。實際讀回同值，沒有誤用虛構範例檔名或內容。

證據為 probe-single-translation-result.json 與 events.json。這是另一個來源、較簡單單路工作的閉環證據，不是原先兩路任務通過，更不代表正式桌面或長篇可靠；也因此不採用「這顆只能聊天、不能做檔案工作」的絕對結論。其後同模板的三輪自然對話有界模擬全部只列計畫，0 工具／0 產物；另一個新對話以較直接的祈使句要求兩路翻譯亦為 0 工具。沒有產品自動續送或恢復原小說。證據：probe-natural-fixed-result.json、probe-two-files-imperative-result.json。

## 真正 Opus 5.5

同一 Claude Code 訂閱 native session，實際 init model `claude-opus-5-5`、effort high，先後討論根因、對照直接測試，再審核模板。沒有以其他模型代替，沒有交付執行權限。前兩輪已指出 bridge 在上游零呼叫時不能背鍋，並撤回「先縮短提示／移除工具」的初步假說；反對把聊天 JSON 當工具、新代理迴圈或永久強制工具。

後續兩輪 Opus 同意 V7 模板、工具結果往返與還原證據，認為新失敗是等待而不是模板又失效；支持先隔離實測。再對照兩層逾時與最小候選，不採心跳、聊天 JSON parser、永久強制工具或新代理迴圈。Opus 前稱每模型內部參數必然變成人用設定不準確，已明確更正；本輪沒有新增人用設定。

一次候選工作樹讀取被唯讀工作階段拒絕，Opus 明確說未讀到程式，不列為複查。改提供可讀的實際 diff 與新增測試副本後，真正逐行審查通過、無阻擋；確認只影響 Dolphin、原生等待整數在 inline table、傳輸不重試／不自行取消、取消與未知 lease 保留、304 由 3xx 分支拒絕。非阻擋連線池假設未有實證，不加 `agent:false`、額外標頭處理或新包裝；採納註解改為 stay silent，不在缺少分段量測時稱都是 prefill。仍須實際原生檔案閉環，不以單元測試代替。

Opus 最後亦指出行為對提示敏感，應停止無根據地堆提示；建議離線多樣本對照。主代理未採用 5×5 大型對照：基本寫入已成功、兩工具減量仍失敗，足以排除「完全無法執行工具」及「減為兩工具即可解決」；目前沒有完成驗收，不擴建診斷或強迫續送來交差。Opus 關於低溫近乎確定性、或有限測試便能斷言任何設定均無效的說法沒有足夠依據，不採納為事實。

## Dolphin 1.2 的獨立候選（未驗收）

在不再盲目堆提示的前提下，查到作者 1.2 更新紀錄明列 improved tool calling。固定作者來源 commit 337ce042026e598256f4bbb8178116b59c9e302d 的 config 為 Mistral3ForConditionalGeneration、131072 context；模板為 V11 工具格式。這與本機舊 bartowski GGUF 的 llama／32768／V7 不同；不能把舊版 V7 覆寫直接複製到新版。

第三方 douganger/Dolphin-Mistral-24B-Venice-Edition-1.2-GGUF 的 README 明示從 1.2 重新量化。只下載一份 Q4_K_M，固定 repository revision 7e247c4f18b38efa0af65983ae7d65cc8a39e371，預期 14333923104 bytes、SHA256 1c76a921c568b5f652c2a5d87d5b051abb1cb8519ceec32b673b766a47b4e9f1；下載完整驗證後才更名為 GGUF，未完成前只有 partial，不稱已安裝可用。這不是官方量化，其 README 的量化評分不是本案獨立實測。

已讀 partial 的完整 metadata header，architecture 是 mistral3、內嵌 Unsloth 模板為 [TOOL_CALLS]name[CALL_ID]id[ARGS]arguments。general.base_model 的舊 2501 名稱與實際架構／模板不一致，完整檔驗證與實測優先，不能僅依標籤斷言。這是有來源的候選，尚非改善證明。舊權重、設定、既有對話不替換，新版只使用獨立識別與測試工作區。

真正 Opus 5.5 high 已讀固定來源，支持另測 1.2，不帶舊行為補丁；接受僅保留 Windows／Node UTF-8 的環境事實。建議先檢查直接工具呼叫及結果往返，再做既有 K 原生 13 工具失敗案例；核對 V11 ID、工具清單數量，不把宣傳、完成下載或原生 completed 當驗收。新識別不會自動繼承舊版 20 分鐘等待，隔離測試可明示注入相同兩層等待，正式是否擴充須依實際證據。此時下載未完成，正式接入、部署與 push 仍未完成；後續實測如下。

## 1.2 完整檔與實際測試結果

下載已結束，實際長度與串流 SHA256 全部符合上述固定來源（dolphin-12-download-check.json）。LM Studio 稍後自動索引為 dolphin-mistral-24b-venice-edition-1.2；沒有重啟服務或載入外部模型，沒有安裝引擎、套件、視覺投影檔或轉移帳號。一次 lms import --dry-run 停在非互動提示，隨後在確認其 PID 與參數後只停止自己的 dry-run；沒有真正 import 或搬移檔案。完整 GGUF metadata：mistral3、131072、363 tensors、V11 內嵌模板；本案只以 32768 context、14 GPU 層、temperature 0.15 做隔離測試。

以下全部是新 1.2 權重、獨立識別、合成短句與暫存工作資料夾；沒有替換正式舊 Dolphin、改既有對話或恢復小說。

- 內嵌 V11 僅加 Windows／Node 環境事實：直接單一 echo auto 回聊天中的 JS 程式碼，0 結構化呼叫。
- 完全移除模板覆寫：直接單一 echo auto 只列計畫；required 診斷也回程式碼與虛構成功，直到 384 輸出上限。required 未成為產品策略，不能把它當有效格式約束。
- 原生 Codex＋既有 K Responses bridge＋完整 13 工具、相同原生核准：兩路翻譯只回聊天中的 JSON，內有未授權測試上網的翻譯 API 程式碼；0 工具，0 產物，也沒有真的發出網路請求。這不是核准阻擋。
- 固定作者 SYSTEM_PROMPT.txt 原文（只代入名稱與日期）的直接 echo auto 仍把呼叫寫成程式碼。raw completions 預填 TOOL_CALLS 的一次格式診斷會接出工具名稱和參數，但缺少回傳文字中的 ARGS；這是預填、不是主動呼叫成功，也不足據此斷言能力上限。GGUF 中相關標記均為 control tokens，沒有以缺少單一顯示標記過度推論。
- 只加一段簡短 V11 呼叫語法說明＋Node 環境事實：直接 echo auto 確實產生結構化 k_diag_echo，實際執行無副作用 echo、送回同一 id 工具結果後正確回報。原始記錄有重複 ARGS，LM Studio 仍成功解析；沒有在 K 新增解析器或處理聊天文字。
- 同一簡短 V11 提示放最前的原生 13 工具兩路翻譯，仍只回 Markdown JSON 讀檔程式，0 工具；把相同提示搬到實際 AVAILABLE_TOOLS 旁的單次對照，仍只回含空白翻譯函式的示意程式，0 工具、0 產物。不是語法說明未套用，也不以直接 echo 成功取代完整驗收。

證據：dolphin-12-catalog.json、final-metadata.json、special-token-comparison.json、direct/clean-direct/format/guided-direct 的 result 與 logs，以及 probe-dolphin-12-natural、guided-natural、adjacent-natural 的 result/events/request。實際 LM Studio 格式化輸入與輸出集中 dolphin-12-native-lms-log.jsonl。原始請求仍保留全部工具，沒有永久 forced tool_choice、外掛代理迴圈、模型自動切換或把 Markdown JSON 執行為命令。

結論：新舊 Dolphin 都存在可重現的工具行為限制。舊版單一路徑已有實體譯文與讀回成功，新版只有直接 echo 往返成功；兩路翻譯在現有 K 原生工具環境尚未通過。不能稱新版更可靠、正式可用或全流程完成；也不能由這些有限測試宣稱所有量化、引擎或模型版本永遠無效。為避免留下未驗收的行為補丁，新候選的模板覆寫還原為無覆寫，僅保留 14 層與 0.15 載入／取樣配置，舊設定及每版候選另存可追溯。1.2 不加入正式 K 清單，不替換舊對話，不部署未驗收候選。

## 已驗證連線修正的獨立發佈範圍

最後收尾發現：Dolphin 模板已生效，但正式 K 還留兩層 300 秒等待，會留下已知的連線落差。本人原先已明確授權「隔離證實延長等待有效後，只修正式 Dolphin 的原生等待，驗證與 Opus 複查通過才套用」，且本輪已授權該小模型必要修改不再逐項詢問。先前暫不部署是主代理計畫，不是本人禁令。

主代理因此把連線修正獨立為小範圍發佈，不把模型兩路任務失敗冒稱修好。真正 Opus 5.5 high 再次核對後放行此範圍，條件為固定已審程式、同 commit 完整測試、正式路徑無測試 fetch／額外 timeout 的讀回、保持取消／不重送與如實標示模型限制。

程式 commit：e049894ace2cc3984385354c43116d4479d0c938。主代理重核 2 個來源與既有測試 diff，只有先前已採納的註解由 prefill 改 stay silent，不同 Git index hash 不算程式差異；新增測試與 Opus 實讀副本正規化換行後相同。固定 commit 再跑 npm test：1792/1792、0 fail/skip、73.45 秒。沒有 UI 異動。正式安裝與遠端讀回尚待下節記錄。

長時間驗證邊界：先前超過 300 秒自然完成那次是隔離 Undici 診斷，Node HTTP 版本的 idle、串流與取消由相稱的短時值單元測試及單路實測佐證；不能稱正式 Node HTTP 已實測靜默超過 300 秒。1200000 ms 是內容閒置等待，不是工作總長截止；native retry 不改，本人仍可停止。

舊 Dolphin 實際設定與單路成功快照的 JSON 解析後完全相同；正規化 JSON 的 SHA256 均為 80334357d3dea0d0713ad738a44a15a0a9d5b1a3e788fe88717168586d0b1d10，原檔 SHA 不同僅為排版。另 3 份設定 hash 與初始值相同。新 1.2 模板覆寫已撤回、未註冊 K。自有測試 logger 已結束，LM Studio 最後讀回 loaded_instances 為空，K 的 47831 埠未監聽，沒有強制關閉工作。原小說與目標保持停止。

還原分開處理：程式可用上一份程式退版；舊 Dolphin 專屬模板則可把本次新增的 per-model 設定檔移入資源回收筒，回到 GGUF 內嵌原始模板。1.2 權重保留，不擅自刪除。

## 正式建置的測試時序阻擋

第一次 Update-K 指向 af1b969583281ebe89916552228c54e79ea41d9c，建置成功、完整測試 1791/1792，因此更新器拒絕啟用；runtime.json 讀回仍為 97ad9c90db462dc48479dca7e1841128d9b26dd9。沒有略過測試、強制切換或重送工作，失敗候選保留於 prepare-1792438853003。

唯一失敗是既有 test/codex-capacity-fallback.test.mjs 的 stop before send acknowledgement：測試睡 20ms 假設 send 已到原生確認等待，但 send 前有非同步檔案操作，負載下該前提未被保證；finally.close 的 finished turn 錯誤又蓋住當時斷言。最小修正只在假 host 到達 startAck 等待點發出測試事件，測試等此事件後才 stop；四項斷言不變，沒有改正式控制器、sleep、skip、retry 或放寬行為。

測試同步 commit b21bfb0（上一版只加該測試差異），focused 19/19、固定 commit 完整 npm test 1792/1792，0 fail/skip，72.71 秒。真正 Opus 5.5 high 實讀 diff 與失敗紀錄後放行，仍須 updater 正常完整重建與正式合成讀寫驗證。其非阻擋建議是再加測試 send 提早結束的防掛等待；未觀察該問題，不為此擴張本次修正。

非 Dolphin 的鄰近未確認風險另記：第一次失敗可能碰到 stop 早於原生 turn/start 的時序，之後控制器仍握有 finished turnId，close 嘗試中斷時失敗。只有這次堆疊，原斷言被 finally 蓋住，不能直接斷言正式程式 bug 或宣稱已修；與本次 Dolphin 差異無關，沒有順手改控制器。
## 狀態與限制

模板已在本機 Dolphin 專屬設定生效，等待程式已固定版本；第一次正式更新被完整測試擋下、未啟用，修正測試同步後待再次正常建置驗證。原小說工作與目標保持停止／暫停，不重播。其他電腦沒有套用本機設定。

本機工程證據保留於 `D:\K-harness\.runtime\archive\selfhost-tools-20261020`；不提交原生對話、模型紀錄、私人設定或測試暫存。此文件不把測試／模型狀態擴稱為正式 GUI 全流程驗收。

## 查證來源

- [LM Studio 工具呼叫：原生／預設格式、模板與解析器分工](https://lmstudio.ai/docs/developer/openai-compat/tools)
- [LM Studio 每個模型的預設](https://lmstudio.ai/docs/app/advanced/per-model)、[模板覆寫](https://lmstudio.ai/docs/app/advanced/prompt-template)
- [LM Studio 官方 schema（llm.load.promptTemplate）](https://github.com/lmstudio-ai/lmstudio-js/blob/main/packages/lms-kv-config/src/schema.ts)
- [Mistral Small 2501 作者說明](https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501)、[官方 tokenizer 實作](https://github.com/mistralai/mistral-common/blob/main/src/mistral_common/tokens/tokenizers/instruct.py)
- [底模社群補工具模板的討論 #13](https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501/discussions/13)：僅作類似案例，沒有照抄未合併模板。
- [MLX 相似缺工具模板案例 #1639](https://github.com/ml-explore/mlx-lm/issues/1639)：後端不同，不冒稱為本機相同修復。
- [原生 Codex provider 閒置等待設定](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Node fetch 與 dispatcher](https://github.com/nodejs/node/blob/main/doc/api/globals.md)、[Undici 內容閒置預設 300 秒](https://github.com/nodejs/undici/blob/main/docs/docs/api/Dispatcher.md)

- [Dolphin 作者 1.2 更新](https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition/commit/337ce042026e598256f4bbb8178116b59c9e302d)
- [明示重建 1.2 的第三方 GGUF](https://huggingface.co/douganger/Dolphin-Mistral-24B-Venice-Edition-1.2-GGUF)
