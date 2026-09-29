# 雙訂閱整合：2026-09-23

## 操作

1. 開啟 K 執行中樞，按「新對話」。
2. 按「登入 Claude 訂閱」。官方 Claude Code 在背景啟動登入，瀏覽器授權由使用者本人完成；K 不讀取或搬移訂閱憑證。
3. 回 K 按「刷新登入狀態」。只有官方狀態確認為 Claude.ai 訂閱，才能選 Claude Opus 5.5。
4. 日常聊天、工具核准、停止與成果查看都留在 K。Codex 與 Claude 的原生對話分開；換供應商請新建對話，不會自動轉送另一邊的完整歷史。

## 路由與費用邊界

- GPT 主代理沿用官方 Codex app-server 與既有 ChatGPT 登入。主模型從帳號的實際目錄選擇。
- Claude 主代理沿用官方 Claude Code，固定 Opus 5.5；登入驗證不等於已確認該帳號模型額度，模型拒絕或額度耗盡時不重送、不換供應商。
- 一般子代理固定 GPT-6 Luna / high。Claude 經專案內的驗證式 loopback MCP 派給官方 Codex；沒有額外的 GPT 主代理中轉。第一次真正派工時才啟動 Luna bridge。
- 不強迫派工。工人的輸出仍需主代理驗收；逾時不代表未執行，不自動重送。
- DeepSeek / Pi 既有手動緊急流程保留，仍是 API 計費；未加入常態選單、不自動 fallback，正常新對話停用 k_flash。沒有把 DeepSeek 做成新的聊天主代理介面。
- 本機整合不更改服務商帳號上的加購或額外用量設定；使用者仍應在各服務商檢查自身計費設定。

## 權限與功能範圍

2026-09-23 後續修正：使用者要求保留 Claude Code 原生能力。K 不再注入 `ask: ['*']`，也不封鎖 Agent/Task、背景工具或額外的檔案路徑；由 Claude Code 本身與使用者選定的原生權限模式裁定。

- Claude 專用選單列出 `manual`、`acceptEdits`、`auto`、`bypassPermissions`、`dontAsk`、`plan`，不混用 Codex 的權限語意；預設不自動提高權限。原有工作區模式對應 manual，原有唯讀對應 plan。
- 原生設定來源恢復 user/project/local，原生 MCP 與 K Luna MCP 合併載入；K 不改寫全域設定，不代替 Claude 管理技能、hooks、外掛或原生子代理。
- 保留訂閱身分讀回與僅針對認證／供應商／端點覆寫的檢查。`forceLoginMethod` 單獨不足以防止 settings.env 注入 API key，已做無真實憑證、無模型請求的隔離探測。
- 一般派工預設仍是 GPT-6 Luna/high；原生 Task 能力不再被移除。Claude 權限不會自動擴張 Luna 工人的 Codex 權限。
- 原生能力清單依官方連線回報顯示，而不是硬編造工具可用性。移除限制不等於所有工具都已逐一實測，也不等於將終端的每個全螢幕選單嵌入 K。Computer use 仍依前次要求不另行加裝。

官方模式語意與程式化入口：[permissions](https://code.claude.com/docs/en/permissions)、[headless](https://code.claude.com/docs/en/headless)。

Claude API key、外部 provider 等環境覆寫只從子程序移除；不修改全域環境或其他專案。原生登入由官方 CLI 管理，K 的本機 gateway token 不是供應商登入憑證。

## 驗證層級

離線測試涵蓋 provider 路由、登入啟動、防重送、原生協定、權限/停止、session projection 與 Luna MCP。前端另做建置與實際瀏覽器入口檢查。

官方 stable 2.1.267 實測被 Opus 5.5 拒絕，回報至少需要 2.1.280。使用者另行同意後已更新官方 latest 2.1.280，既有 Claude Pro 登入保留。K 現在於請求模型前檢查最低相容版本。兩次更新前的程式備份均在 `.runtime/tool-backups/`，沒有備份或搬移帳號憑證。

驗證結果：

- 完整離線回歸 185/185 通過；UI build 與 diff-check 通過。
- K 登入按鈕實際啟動官方瀏覽器流程；官方 auth 讀回 loggedIn=true、claude.ai、pro、firstParty。
- Claude Code 2.1.280 真實 Opus 5.5 → K MCP → Codex GPT-6 Luna/high 流程完成。Luna 輸出 `K_LUNA_OK`，Claude 回覆 `K_CLAUDE_LUNA_OK` 與該原始结果。
- 人工任務不讀私人檔案、不使用命令、不寫工作成果。測試只核准工具搜尋與固定 requestId 的 Luna start/wait；其餘工具拒絕。
- 成功讀回在 `.runtime/dual-subscription-smoke/result.json`。舊 stable 不相容與首次權限接線失敗的讀回也保留；確認無 Luna 工作啟動後才重測，未盲目重送有副作用的工作。
- 實測補上官方 `--permission-prompt-tool stdio`，讓 Claude 工具核准確實交回 K；只有 `--permission-prompts host` 不足。

限制：Claude 複雜檔案/命令、真實中斷及跨重啟續作目前只有模擬回歸，尚未完成各情境真人工作驗收；兩邊額度耗盡切換也未實測。不能把這次限定訂閱派工成功擴張為全工具、全工作流程皆已驗證。

### 原生能力修正驗證（2026-09-24）

- 官方 Claude Code 六種權限模式均完成 stream 初始化；這是模式啟動驗證，不代表六種模式的所有工具行為都已測試。
- 真實 manual 模式讀取人工 fixture 無 K 強制核准；acceptEdits 模式寫入人工成果無 K 強制核准，檔案內容已讀回。
- 真實 K controller 同一對話由 manual 切至 acceptEdits，沿用原生 UUID 與前一回合 token，成功寫入第二回合成果；low effort 已傳遞。原生連線回報 53 個工具、技能、原生代理與既有 MCP；僅列出能力，未呼叫雲端資料連接器。
- 證據：`.runtime/claude-native-smoke/2026-09-23T15-56-09.034Z/evidence.json`、`.runtime/claude-controller-native-smoke/2026-09-23T16-02-17.089Z/evidence.json`。
- 模式與 effort 變更於下一次送出前重開同一原生對話，不轉送其他供應商歷史。Luna 工人不隨主代理權限升級。
- 最後完整回歸 191/191 通過，介面建置與 diff-check 通過。瀏覽器已讀回六種原生模式，未替使用者提高預設權限。
- 正式 47831 後端尚未重啟：本次自動重啟／開啟啟動器操作被工具政策擋下，沒有繞過；使用者需從桌面 K HARNESS 啟動並透過系統匣「重新啟動 K」載入新版後端。不得把目前狀態宣稱為新版後端已 live。

### 主代理選擇修正與正式載入（2026-09-24）

- 使用者指定新選單依序為 GPT／Claude → 模型 → 推理程度；新選擇僅列 GPT-6 Astra／Sol／Luna 與 Claude Opus 5.5。舊模型對話與檔案不刪除。
- 移除模型浮動選單與雙層捲動，縮短設定視窗；修正點擊 dialog 內部空白被誤判為 backdrop 而關閉。
- 修正 Claude 變更 effort 只更新狀態、未更新原生程序的根因：記錄原生程序實際 effort，下一回合依選定 effort 重開同一原生 session；選擇模型預設可清除明確 effort。
- 獨立人工測試由 low 選成 high，官方 Claude 原生程序使用 high，回覆 K_EFFORT_HIGH_OK；記錄在 `.runtime/flat-picker-live-1790182164929/evidence.json`。
- 使用者明確核准後，已停止舊 47831 後端、啟動新版並重開原有對話 `01a0a04e-f404-7bc3-8bc0-9607971833f8`。沒有重送訊息；新 API 讀回四個指定模型以及 Claude 的五種 effort。此前「新版後端尚未重啟」限制已解除。
- 在原有獨立視窗讀回 GPT 三模型、Claude 五種 effort；點高可選取，點視窗內空白仍保留。桌面畫面包含建立按鈕，無內層捲動；沒有替使用者建立新對話或變更既有對話權限。

## 雙訂閱登入區（2026-09-24）

- 新對話的 GPT / Codex 與 Claude 狀態、登入及刷新按鈕固定放在提供者選擇上方；不隨提供者切換隱藏，模型載入失敗時仍可登入。
- Codex 透過官方 app-server 的 account/read、account/login/start（type: chatgpt）與 account/login/cancel；K 不讀取憑證檔、不提供 API key 登入、不建立模型工作。登入頁由使用者開啟及完成，官方程序保管憑證。
- 官方協定來源：https://learn.chatgpt.com/docs/app-server
- 196/196 測試通過，UI 建置通過。已安全重啟閒置 K，本機讀回 ChatGPT pro / Claude.ai pro，並於現有獨立視窗確認兩列在提供者上方且完整對話框可見。
- 未登出現有帳號；登入開始／完成／取消以模擬官方協定測試，未為驗收重跑真實 OAuth 登入。
