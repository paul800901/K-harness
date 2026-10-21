# Gemini（agy）完整接入 K：沙盒指令、派工、原生子代理與共用記憶（2026-10-21）

分支 `claude/gemini-full-20261021`，基底 main `73f7b67`。實作與實測：Opus 5.5（本月 Claude 額度較多，由 Opus 親自做）；最後檢查：GPT-6.1 Sol（high），結果見文末。

## 起因與本人決定

本人說明：Codex 只剩 20 美金、Claude 下月也降到 20 美金；Gemini 有 5 個帳號加 18 個月低價方案，幾乎不用錢，之後要盡量由 Gemini 出手，不再只當簡單子代理。本月趁 Claude 額度一次把 Gemini 完整接進 K，最後一次部署。本人逐項決定：

1. 「工作區寫入」改成沙盒內可跑指令：**開放**（前置實測見 [`gemini-main-fit-20261021.md`](gemini-main-fit-20261021.md) 補充二）。
2. 派工：**完整接上 agy 自己的派工（原生子代理），另外讓 Gemini 能派 GPT 與 Claude 兜底**。
3. 跨聊天室記住教訓：**要**，用原生功能做。
4. 分工說明：**不特地寫誰是主力**，由本人當時決定；只移除「Gemini 不能派工／不反向派工」的過時說法。

## 實測（真 agy 1.4.3，假資料）

證據都在 `D:\K-harness\.runtime\archive\`，未提交 Git。

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| 沙盒根因 | agy Windows 沙盒是 AppContainer，要 `%LOCALAPPDATA%\Packages\sandbox.{GUID}`；K 環境白名單缺 `LOCALAPPDATA`。補成 `<HOME>\AppData\Local` 即可，同次陰性對照確認 | `gemini-sandbox-env-20261021/`（s2、s6） |
| 沙盒邊界 | 擋：工作區外寫入／改寫／刪除、使用者資料夾與 %TEMP%、既有 junction 往外寫、HKCU、DNS／直接 IP／本機 loopback、子程序、跳出沙盒（headless 自動拒絕）。不擋：讀取 D 槽一般資料夾 | 同上 `report.md`（Sol 兩次只讀檢查） |
| `/learn` | print mode 會展開為 system 指令，先寫 `learning_proposal.md` 再等本人確認；它判斷專案規則寫工作區 `AGENTS.md` | `gemini-native-features-20261021/f1-learn.*` |
| 原生子代理 | `define_subagent`／`invoke_subagent` 在 print mode＋沙盒設定可用；事件 `step_type: subagent`＋`subagent_info`（type_name、role、initial_prompt、conversation_id、log_uri）；完成以 `system_message` 回到同回合 | `f2-subagent.*` |
| 規則引用 | 規則檔中的 `@[名稱](絕對路徑)` 會展開 HOME 外的共用檔，Flash 照共用規則回覆 | `f3-include.*` |
| 規則上限 | 單一規則檔 24,000 bytes（超過截斷）、always-on 規則合計 20,000 tokens；K 原 `AGENTS.md` 26,628 bytes 被截 | agy 內建 `agy-customizations/docs/rules.md` |
| 端到端 | 實際 `gemini-controller`（workspace-write）＋真 k_luna gateway＋真 Flash 工人：沙盒指令寫工作區成功、寫工作區外被拒且 Gemini 如實回報；Gemini 用 `luna_start` 派 Flash 寫 `flash.txt`、結束回合；K 待其閒置送完成通知，Gemini 讀回 `FLASH_OK` 驗收 | `gemini-full-live-20261021/live.mjs`、`live-summary.json` |

## 實作

| 檔案 | 改動 |
| --- | --- |
| `src/gemini-worker.mjs` | `geminiEnvironment` 加 `LOCALAPPDATA=<HOME>\AppData\Local`。新增 `geminiAccessArgs`（唯一的權限旗標對照：workspace-write→`--sandbox`、完整存取→skip）與 `geminiCommandsAllowed`。workspace-write：allow 工作區與指定可寫檔（共用規則）及 `command(*)`，deny 只剩 MCP／TEMP；**含 Google 連接器的工作區不開指令**（沙盒會讓指令越過保護 `google_ops_worker`、`.venv` 的 write_file deny）。`gateway` 選項開 `mcp(k_luna/*)`。工具說明依權限與是否開指令改寫；30 分鐘說明改為凡能跑指令就提示。工人啟動改用 `geminiAccessArgs`，指令說明依連接器狀態。 |
| `src/gemini-controller.mjs` | 每房一條 k_luna gateway＋lazy luna bridge（比照 Claude 主代理）：工人紀錄、產出檔列入成果、完成／待確認通知只在主代理閒置時以 K 事件回合送一次（送出前標記，送出不明不重送，使用者回合搶先時排到該回合後）、Codex／Claude 工人核准卡與 `answer`、Gemini 帳號就緒／受阻通知、停止聊天室一併停工人。權限／工作區／子代理設定在工人未結束時拒絕變更（不靠取消工人套用），且在任何副作用前檢查、失敗還原。原生子代理事件記為 `gemini-native` 工人，回合結束標 `ended`（結果未知）。一般對話維持 `--disable-slash-commands`，只有本人以 `/learn` 開頭的訊息展開；K 事件回合一律不展開。每房規則改為 `MODEL_ROLE_GUIDANCE`＋派工說明（`workerPolicyConfig` provider gemini）＋權限說明＋長期記憶說明，結尾以 `@[K 共用學習規則](…)` 引用 `agent-home/gemini/shared/learned-rules.md`（首次建立標題、不覆寫）。K 通知超過 30,000 字元截斷並提示用 `luna_inspect`（agy 經命令列收 prompt）。 |
| `src/worker-policy.mjs` | Gemini 主代理可派全部供應商；`workerPolicyConfig` 新增 provider `gemini`（k_luna、原生子代理用法、完成事件不輪詢）。移除 Astra 批次的 `GEMINI_MAIN_ROLE_GUIDANCE`（「本聊天室不能派工」已不成立）與 `MODEL_ROLE_GUIDANCE` 中「不需要 Gemini 主代理自動派 GPT／Claude」一行。 |
| `src/unified-controller.mjs`、`src/isolated-desktop.mjs` | Gemini 控制器取得 `workerCatalog` 與比照 Claude 的 `createLunaBridge` 工廠（Codex host、Claude／Gemini 工人選項）。 |
| `frontend/model-picker.jsx`、`frontend/permission-picker.jsx` | Gemini 聊天室顯示子代理設定；「工作區編輯」說明改為沙盒指令與可讀範圍。 |
| `AGENTS.md`、`docs/discussion-rules.md` | 新規則併入第三～七節；全文收緊措辭並把多模型討論 5 條原文移到 `docs/discussion-rules.md`（現行有效，`AGENTS.md` 留摘要與指向）。CRLF 計約 23,700 bytes，上限 24,000；新增 `test/agents-size.test.mjs` 防止再超過。 |

## 驗證

- 單元與整合：`npm test` **1797/1797**；`npm run build:ui` 後 `npm run test:ui` **49/49**（工作樹需連到主工作樹的 `.runtime/playwright-browsers`）。
- 新測試：k_luna MCP／權限／規則接線；工人完成通知只在閒置時送一次、使用者回合執行中不插隊、重複紀錄不再喚醒；工人未結束時拒絕設定變更且不取消工人、權限不被半途改掉；工人核准卡與回覆；停止聊天室停工人並關閉 gateway／bridge；原生子代理顯示與回合後 `ended`；`/learn` 才展開、`/goal` 照字面；Google 連接器工作區不開指令；`AGENTS.md` 大小。
- 改寫的既有測試：舊斷言「workspace-write 拒絕指令」「Gemini 主代理沒有子代理設定」「規則含不能派工」是本批刻意改變的行為；改為驗證新行為，唯讀仍拒絕指令、完整存取不變、工作區外寫入仍被拒。

## 已知限制（未處理）

- 立即送入、執行中核准／引導：agy headless 原生不支援（前批 P2 實測）。
- 回覆後背景指令約 30 分鐘被取消，回合結束後不自動喚醒；只以說明提醒模型在同回合等完。
- 沙盒不提供讀取隔離（讀得到 D 槽一般資料夾，包含其他專案）；沒有網路，裝套件、需本機連線的測試會失敗；GPU／長工作在沙盒內未驗證。
- 指令輸出在中文 Windows 為 Big5，agy 以 UTF-8 顯示成亂碼；沙盒包裝層每次都多一行「子目錄已存在」雜訊。結束碼仍正確。
- 原生子代理的個別結果 K 不另讀（只顯示執行中／已結束、結果未知），也不跨重開保存。
- 測試在 `D:\K-harness`、`.runtime`、`.runtime\tests` 留下 agy 能力 SID 的 `(S,X)` 穿越權限；正式使用後各工作區上層可能也會出現，未證實、未移除。
- `AGENTS.md` 餘量約 300 bytes，日後新增規則需同時精簡或移細節到 docs。

## 審核

- Opus 5.5 自查：修正兩處——關閉時先清掉 bridge 參考導致實際 bridge 沒關（測試抓到）；設定變更被拒時原本已先改權限，改為先檢查 gateway、失敗還原。另依完整測試發現 Google 連接器保護會被沙盒指令繞過，改為該類工作區不開指令。
- GPT-6.1 Sol 最後檢查：見下節（待補）。

## 部署狀態

未部署、未 push。與前批 `gemini-main-fit` 一起由本人在 K 外以 Codex 6.1 Sol 執行 `Update-K.ps1`（指令見交接）。
