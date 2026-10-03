# Gemini 搜尋、讀網頁與 Flash 瀏覽器接入（2026-10-04）

## 範圍與現況

使用者要求補齊 Gemini 主代理及 Flash 工人的原生搜尋／讀公開網頁，以及 K 專用 Chrome 操作。這不是 Google 商家 API 接入；該份外部盤點的核對見 [Google Ops 核對](google-ops-audit-20261004.md)。本批不新增人用設定，不改四帳號、登入、計費或對話。

**目前是已完成真實連線驗證的候選，已通過最後回歸／複查，正在部署準備，尚未部署／push。** 主代理原有瀏覽器接線保留；Flash 新增同一 K 瀏覽器通道。

2026-10-04 使用者在明確說明「補原生讀網址許可、開啟 K 專用 Chrome、完成實測、確認無工作後保留退版並部署」後回覆「全權處理，我沒有在電腦前了」。依此加入原生 `read_url(*)` 許可並由助手開啟原有 K Chrome；沒有加入自動開窗功能，沒有改用 skip 繞過其他權限。不含 GitHub 發布、東區更新或 Google 營運發布。

## 根因與最小修改

- 工人原先沒有 `mcp_config.json`，且所有 MCP 均拒絕。桌面原本只把瀏覽器交给主代理，沒有傳給 GPT／Claude 的 Flash 工人。
- 在兩個 Flash 入口傳入既有 owner registry；每個工人使用自己的連線和本次執行設定目錄，避免並行工人互相覆蓋 MCP 位址。只傳 AI 入口，不傳人類控制權。
- 主代理／工人共用原生 settings 與 MCP 格式，僅在已取得 K 瀏覽器連線時開放 `mcp(k_browser/*)`；不開放其他 MCP。唯讀模式仍沒有互動瀏覽器；指令、工作區外寫入等限制不變。
- 工人完成／停止後關閉自己的連線，不關閉使用者 Chrome。關閉失敗標示未確認，不宣稱工作安全停止、不重播。已關閉的 registry session 不再永久保留於集合；原主代理重開時仍重新登記。
- 沒設定瀏覽器助手仍可做文字工作，不恢復舊備援，不強行開 Chrome／搶前景。

## 原生搜尋／讀網址實測

agy 1.2.16、真正 Gemini 3.8 Flash low、K `createGeminiWorker`、新建空白工作區、唯讀原生權限：

- `search_web`：真實執行完成。
- `read_url_content`：原生拒絕 `read_url(example.com)`；沒有改用指令或其他工具繞過。
- CLI 回傳退出碼 0，但沒有最終回答；K 正確標為 failed，而不是把 exit 0 算成功。
- 上述是修正前基準。取得「全權處理」後，加入原生 `read_url(*)`；未增加 execute_url、指令或全面略過權限。
- 補許可後真正 Flash 工人（唯讀）與 Gemini 主代理（工作區編輯）均完成 `search_web`、`read_url_content`、讀取原生回傳檔，零工具錯誤／拒絕。
- **原生讀網址會回快取內容**：這次 example.com 回傳明示 Cached Content，與 Chrome 當下頁面不同。搜尋／读網址接線成功不是資料必定即時；需要即時或動態頁面時用 K Chrome，不能憑記憶補連結。

官方 [headless 文件](https://www.antigravity.google/docs/cli/headless/) 說明，需核准的工具在背景模式會被拒絕；不支援用 `control_response` 補做互動核准。僅有官方工具名稱不等於本次權限下可用。設定語意另見 [官方原生權限](https://www.antigravity.google/docs/permissions?tab=cli)。

## 驗證進度

- 第一輪既有相關測試 58/58；新增 5 項工人瀏覽器回歸後，第二輪相關測試 55/55（不同檔案集合，不相加）；第一輪完整測試 662/662。另依實際讀網址拒絕補一項錯誤歸屬測試，保留網址、避免重複列兩次拒絕。
- 新測試覆蓋並行目錄與連線歸屬、沒有助手、唯讀不開瀏覽器、取消後關閉、關閉失敗、模型與連線初始化失敗不啟動回合。
- 新增的每次執行獨立設定目錄已跑真正 Flash 3.8 low：工作區編輯模式、不加 skip，經真 owner gateway 設定，讀取新建假檔回覆隨機辨識碼成功，零工具拒絕。沒有使用瀏覽器，不當成 Chrome 驗收。
- Opus 5.5 初查及補查完成：原始輸出與採納判斷見下節；修正後最後完整測試 **663/663**，無失敗、略過或取消，`git diff --check` 通過。
- 真 Chrome：主代理及 Flash 工人均經 `browser_session regular` 開新測試分頁、讀 example.com、點連結至 IANA Example Domains、產生真正 PNG。只操作新測試分頁及公開網站，沒有登入或營運寫入。
- 第一輪兩個模型均先猜錯一次 click 參數，工具明確拒絕後模型讀定義／改正，實際點擊只有一次；錯誤原樣保留，沒有把它寫成零錯誤。根因是沿用舊 MCP 參數記憶，不是 Chrome 接線失效。補一句共用 AI 指引：先讀工具定義，`[ref=e13]` 傳 `{"target":"e13"}`，不加轉接層、參數容錯或自動重試；補測及真實再驗收另記下方。
- 證據留維護工作樹 `.runtime/gemini-web-browser-20261004/`；baseline 保留原始 NDJSON、stderr、結果，沒有憑證或真實營運資料。

## 差異檔案

`src/gemini-worker.mjs`、`src/gemini-controller.mjs`、`src/isolated-desktop.mjs`、`src/owner-browser-registry.mjs`、`test/gemini-worker.test.mjs`、`test/gemini-browser.test.mjs`、`test/gemini-controller.test.mjs`，以及 AGENTS、README、本文件與索引。`browser-extension/extension-protocol.cjs` 原有 EOL 差異不是本批修改，不重設、不提交。

正式 K 仍是上一批 `6830927`；東區不更新。未執行 Google 發布、回評、影片上傳、廣告調整或憑證轉移。

## 真正 Opus 5.5 複查

官方 Claude Code 2.1.285、Claude 訂閱、回傳模型 `claude-opus-5-5`，唯讀封包；只允許 Read/Glob/Grep，沒有使用 API key、執行程式或接入其他專案。完整原始輸出保存於 `.runtime/gemini-web-browser-20261004/opus-raw.jsonl` 與 `opus-review.md`。

Opus 初查沒有阻擋性問題，提出：

1. 每工人目錄累積，建議完成後刪除。**不採自動刪除**：原生紀錄、失敗證據、瀏覽器下載或截圖不能當垃圾；也沒有新增清理授權。只修正沒有助手時沿用原 profile、不額外建 runHome。保留目錄的成本如實記錄，不加清理排程或回收架構。
2. registry 開啟失敗仍保留空 session。採納，失敗分支解除登記；其他已執行中的連線不動。
3. 共用 settings 內重複判斷 readonly。採納刪除；呼叫入口與 registry 已決定是否提供瀏覽器，不另外重複防禦。

Opus 沒有執行測試、也沒有查驗 Chrome；不把靜態複查當成實際能力證據。指出的獨立 profile 登入可用性疑問，已以上述真正 Flash 讀假檔驗證；後續已獲授權完成 Chrome 及讀網址實測，新增差異再送 Opus 補查。

補查回傳仍為 `claude-opus-5-5`、成功完成，確認上述調整沒有阻擋問題或新增過度防禦；輸出於 `followup/opus-review.md`。另外指出「原操作與 close 同時失敗時，close 訊息會蓋過原錯誤」：本輪不增加一份狀態保留雙錯誤，未確認停止的最高優先訊息仍正確保留。其提出的 registry 舊有失敗清理觀察不是本次退化，也沒有實際重現；不順手擴大改動。

## 授權後實測證據與未驗證事項

- `web-authorized-1791056204064`：工人及主代理的實際原生事件、快取頁面與完成結果。
- `chrome-worker-1791056123651`／`chrome-main-1791056561187`：第一次真 Chrome 讀頁／點擊／截圖；含上述參數錯誤，沒有刪除失敗紀錄。
- 本輪沒有測網站登入、Google 後台發佈、原生新生成圖、影片上傳，也沒有讓 Gemini 主代理派 GPT／Claude。
- 多個主代理／工人同時操作同一個 Chrome 的並行真實驗收未做；已驗證的是每工人 profile／連線分離的自動測試及先後各一個真任務。不把它說成多帳號並行。
- 後續正式部署與讀回收據將記於本節；目前 formal 仍為 `6830927`，不把候選當成正式版。

## 最後回歸與補查（授權後）

- 完整測試 **664/664**，fail／skip／cancel 均 0，約 33 秒；`full-tests-guidance.txt`。`git diff --check` 通過。
- 補指引後 `chrome-worker-1791056768199`、`chrome-main-1791056947585`：兩者全部工具零錯誤／拒絕，實際讀頁、點擊、截圖完成。主代理按指引先讀工具定義後使用 `target:e13`。PNG 已人工視覺核對為 IANA Example Domains，而非空白圖。
- 真正 Opus 5.5 最終補查：`authorized-review/opus-review.md`、`opus-raw.jsonl`、`opus-result.json`；官方 Claude Code 2.1.285、Claude 訂閱，回傳 `claude-opus-5-5`，session `829a5634-77f5-4273-9dcb-f84fbdb89db3`，成功且無阻擋問題。
- Opus 確認指令／寫檔／MCP 邊界沒有退化，短工具指引不屬過度工程化。提醒原生 read_url 許可不是資料外送授權；模型仍須依任務與規則使用，沒有另建 URL 防火牆。執行紀錄持續保留，未新增清理架構。
- Opus 建議的無瀏覽器反向指引測試不另加一套：既有 controller 測試已檢查無助手時原生規則全文恰為原分工文字，新增工人測試亦覆蓋無瀏覽器不送指引。
