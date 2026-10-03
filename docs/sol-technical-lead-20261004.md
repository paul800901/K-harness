# Sol 作為日常技術主腦（2026-10-04）

## 使用者決定與本輪範圍

使用者確認「GPT-6.1 Sol 基本上就是小 Astra，之後用不起 Astra 的替代」，並要求「好，這樣寫入 K」。Sol 不再只是輔助大腦或盯進度的監工，而是負責需求理解、規劃、架構、後端判斷、除錯、派工、測試與驗收的日常技術主腦。

- Opus 與本人討論方向，Sol 負責技術執行，Flash 做多數快速實作與修正。
- 使用者補充 Sol 延續 Astra 的後端強項、額度消耗少，適合作為技術中間層以分攤工作／用量；這是本人經驗，不代表 Sol 取代 Opus 通才角色或官方評測結論。不為平均額度硬派工，也不新增額度分配器。
- 使用者補充 GPT 系列產碼較慢，不適合作為大量產碼的預設工人；大量產碼優先快速 Flash，GPT 作技術判斷、檢查與必要補修。尤其不能因 Luna 慢就讓主代理一直輪詢；使用已接通的完成事件或阻塞等待，沒有其他必要工作就等待，不新增排程系統。
- 允許 Flash 多次修正；仍有進展就可繼續，不設固定失敗次數。反覆同錯、越改越糟或確實停滯，才考慮 Flash → Sol → Opus 接手。
- 接手前確認原工作停止、檢查已完成成果，只交接剩餘工作，不暗換模型或重播未知工作。Sol 按批次／完成事件查看結果，不持續輪詢。
- Astra 僅本人明確選用且可用時使用，不是日常必要步驟或自動升級。Sol 寫碼仍須真正 Opus 5.5 審核。
- 本人的預算規劃只是分工依據，不把訂閱價格、額度或模型可用性當成已查證的官方事實。

**只更新 AI 指引，不建新系統、不加人用提示。** 現有 Claude 派出的 Sol 子代理不能再派 Flash，未修改 `luna-bridge` 的禁止再委派／原生 agents 關閉設定。可行方式仍是 Opus 討論 → 交接到 Sol 主聊天室 → Sol 派 Flash；不宣稱自動分層派工已實作。文章、Google 生態工作、原生權限、手動選擇與帳號規則保持不變。

## 差異與檔案

- `src/worker-policy.mjs`：共用文字更新，沿既有 Codex developerInstructions、Claude append-system-prompt、Gemini always_on 規則入口生效；沒有新路由、計數器或自動重試。
- `src/claude-host.mjs`、`src/luna-gateway.mjs`：移除衝突的「Sol 輔助大腦」說明；MCP 說明如實保留 Sol 子代理不能再派工。
- `test/worker-policy.test.mjs`：更新角色及進展／接手邊界檢查，既有三家實際送出欄位測試沿用。
- `AGENTS.md`：新增本日決定，舊決定保留為歷史，由新決定取代。
- `README.md`：更新現況分工與自動串接限制，並修正上一批已 push 卻仍寫「僅本機」的過時發布說明。
- 本檔與 `docs/development-log.md`：驗證及交接紀錄。先前 `docs/model-role-guidance-20261003.md` 的 Opus 原文與部署證據不改寫。

## 驗證與複查

- 定向五檔 **47/47** 通過；補入最後的大量產碼／禁止忙輪詢決定後，完整 `npm test` **647/647** 通過（fail／cancelled／skipped／todo 均 0，33,802.9418 ms）。
- `npm run build:ui` 通過；既有大 bundle 提示保留，不為本輪拆包。`git diff --check` 通過，原有換行提示不影響驗證。
- 既有測試核對 Codex 真正送出的 `thread/start.developerInstructions`、Claude `--append-system-prompt`、Gemini 傳入 HOME 的原生規則檔皆含共用指引；這是接線測試，不是三家真模型執行或選模品質評估。
- 真正 **Opus 5.5** 透過既有 Claude.ai 訂閱、只讀工具實際複查；回傳模型 `claude-opus-5-5`、結果 success、session `492a3621-d045-4c32-8e8c-898bd279c796`。沒有 API 計費、登入或工具權限變更。

### Opus 實際結果與處理

原文開頭：

> 結論：沒有必須修的衝突，也沒有誤宣稱能力的地方。下面只有一個建議你決定的措辭缺口，加一個我無法在封包內確認的觀察。

- **未擴大 Opus 必審範圍**：它建議可把「Sol 寫碼必審」擴為「Sol 主導交付、包含 Flash 產出都必審」，亦明說可不修。本輪保留使用者原決定，不擅加所有 Flash 產出必過 Opus 的門檻，避免推翻 Flash 產碼／Sol 驗收的成本分工；不是 Opus 要求修 bug 而未修。
- **完成通知的疑問已核對**：Opus 封包未含 Codex controller，不能確認 Sol 主聊天室是否收到 Flash 完成通知。Astra 已讀 `src/desktop-controller.mjs` 的 `flashChanged`／`deliverFlashResults`：工人完成入佇列，主回合結束後，送原聊天室一次原生 `toolOutput`；既有 `test/codex-flash.test.mjs` 的完成、停止、未知結果不重播測試在本次完整回歸通過。正常流程不需 `gemini_wait` 輪詢；它仍供手動恢復，沒有為本次改新通知系統。
- **實際不能再派工**：Astra 另核對 `src/luna-bridge.mjs`，子代理提示明定不得再委派，`thread/start` 帶 `agents:{enabled:false}`；本輪未動。
- Opus 實際閱讀共用指引全檔、本紀錄當時版本、gateway 第 20–39 行、程式／測試 diff 及關鍵字搜尋。未讀完整 host／test、未讀 README／AGENTS／索引，也未自行跑測試；文件與未讀接線由 Astra 核對，不冒稱全檔或三家真實流程均由 Opus 驗收。

完整原文、請求及原始事件保留在維護來源 `.runtime/sol-technical-lead-20261004/`：`opus-prompt.txt`、`opus-review.md`、`opus-raw.jsonl`、`opus-result.json`，測試及建置 log 亦在同目錄。本輪未新增真模型回合來評估選模好壞，也未實測自動分層派工（本來未實作）。

## 部署與發布狀態

本輪已完成來源修改、測試與 Opus 複查，**尚未部署／push**。準備延續前一批授權套用，但讀回正式 K 仍在執行（47831，PID 28572），已請本人先完成工作並「離開並停止 K」；不強制結束或熱改執行中程式。先前南區正式程式為 `5b83aa6`，GitHub main 為 `379957f`（本輪 `ls-remote` 已核對）。不動四個帳號、對話、語音或東區；本輪未修前次 Opus 整批回查列出的四項遺留問題。
