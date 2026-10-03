# Gemini 後續開發與帳號邊界（2026-10-03）

## 本輪範圍與現況

使用者要求先完成開發；東區更新留到下次到當地。本輪不更新、停止或重開任何正式 K，不新增多帳號管理，不切換登入或 API 計費。

維護來源是 `C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`，基底 `0ae4be15ddab38251a89e5f3a5c74097fa19b2aa`。`D:\K-harness` 舊工作樹既有實驗修改保留，不能整批覆蓋或 pull。候選證據存於 `D:\K-harness\.runtime\gemini-followup-20261003`。

南區正式 K 仍是 `0ae4be1`。15:37（臺灣時間）讀回原生 health、版本及原監聽程序 PID 32212 一致；15:51 再確認 health、同一 PID 及本輪三個產品模組仍與基底版本一致，沒有重新啟動，證據 `final-formal-unchanged-readback.json`。東區最後已知狀態仍依維護來源的 `docs/gemini-account-status-20261003.md`「使用者出發前停止／正式更新延後」，本輪沒有連到東區讀回。

## 多帳號：目前不提供

- 三家訂閱可以各自登入，不等於同一家可以同時綁多個帳號。
- K 沒有同供應商的帳號清單、聊天室指定帳號、輪替額度或多帳號併用功能。
- Gemini 的設定與對話位於 K 各自的 profile，但 Antigravity 登入仍由官方程式沿用 Windows 使用者；覆寫 `USERPROFILE/HOME` 不是認證隔離。在官方程式換帳號可能影響後續 K 呼叫。
- 本輪只確認、記錄這項限制，沒有替使用者設計或啟用多帳號功能。

依據：現有 `geminiEnvironment`、`createGeminiLogin`、主對話與 worker 的設定路徑，以及[官方安裝／登入文件](https://antigravity.google/docs/cli/install/)。K 沒有讀取或搬移憑證。

## 圖片附件：候選實作

原接法在上傳與送出兩處全面拒絕圖片。實測證明 agy 1.2.16 的原生 `view_file` 可讀取圖片，不需要另外改用 API，也不需要把不支援的 image block 塞進 headless 輸入。

- 先生成含隨機代碼、形狀、顏色的假 PNG，prompt 只給檔案路徑，不給答案。Flash 3.8／low、唯讀原生回合正確辨識 `QZ770AAA`、圓形與綠色，事件有 `view_file` 的實際路徑及 DONE。
- 使用已安裝的 ffmpeg 轉成 JPEG、WebP；另一個唯讀回合分別讀取兩張並正確辨識。沒有安裝新套件或讀使用者圖片。
- 候選移除整體圖片封鎖，沿用既有附件名稱／格式／大小、工作區路徑、對話歸屬、每則最多八件等檢查。只傳附件路徑，沒有在 CLI 參數傳圖片二進位或憑證。
- 目前圖片入口只開通已驗證的 Gemini 3.8 Flash 型號；真實回合使用 low，其餘推理程度未另跑。其他 Gemini 型號仍列為尚未驗證，不說成模型本身不能看圖。

證據：`image-probe/evidence/run-summary.json`、`stream-events.ndjson`、`format-run-summary.json`、`format-stream-events.ndjson`。控制器定向單測 10/10；本輪最終完整測試另列。

## K 瀏覽器助手：候選接線

- Gemini 改接既有 owner browser registry 與 K 專用 Chrome gateway，不建立另一套瀏覽器，也不使用 Gemini 原生瀏覽器作備援。
- 未設定助手仍可開文字對話；唯讀不接瀏覽器；工作區編輯／本人明確選用的完整存取權才接既有助手。停止、換對話與改權限沿用對話自己的 owner 連線，不控制其他對話或正式 Chrome。
- 只在 K 的 Gemini profile 寫入 `k_browser` AI endpoint 與 AI token；不把 human token、擁有者路徑或瀏覽器登入資料交給模型。只預先允許 `mcp(k_browser/*)`，保留非完整存取模式的 command、unsandboxed、寫入範圍與 TEMP 拒絕。
- 開發時自查並修正兩個新接線問題：驗證失敗不能清掉舊瀏覽器；關閉失敗不能在同一次操作立即重試。另移除沒有連線時的重複關閉。失敗測試證據保留，不把第一次紅燈寫成原正式版缺陷。

真原生候選 v1 已經走到 `browser_session`、`browser_snapshot`、`browser_take_screenshot`，三者工具事件均 DONE；原生取得假頁文字，MCP 圖片被原生存成內部檔案，但 180 秒測試期限內沒有最終回答，該回合失敗且沒有重送。圖片與上傳附件當時使用同一張假圖，因此也不能藉此證明模型單獨看懂 MCP 截圖。

v1 的原生 Git 探測還向上看到外層 K repo 的未追蹤圖片，不能把這次 fixture 宣稱成完整的目錄隔離證據。v2 改為新建假 Git 工作區，並把 K 狀態根目錄與工作區分開，符合正式程式的目錄形狀；不帶附件，以不同隨機代碼的 MCP 假截圖測試，不加額外讀取許可，使用產品既有的 600 秒期限。首次 v2 runner 的 const 重指派在原生 run 前就失敗；零原生事件、零供應商回合，純本地 sentinel 確認後只修測試腳本，不改產品。

**v2 的唯一真實回合 completed，約 22 秒**：Flash 3.8／low 經真正 K gateway 選 regular、取得 MCP PNG，再由原生 `view_file` 讀取工作區外、自己的 profile 中產生的圖片。不帶原附件，模型仍正確讀出只存在於圖中的 `MCPDBB558F` 與藍色；將方形稱為矩形，不能聲稱形狀描述完全精確，但已足以證明讀到這次 MCP 圖片內容。沒有加 skip、額外 read allow 或變更原生權限。

這是**真模型＋真 K gateway＋假瀏覽器內容**，不是本輪真 Chrome 操作驗收。v1 逾時的原因仍未確定；v2 同時改正 fixture 邊界與期限，不能推論是哪一項消除了問題。主代理檢查原始事件、prompt 與結果後，15:48 補讀回兩個 owner MCP 連接埠均已關閉、無該測試 node/agy 程序。原摘要 `closedFakeChildren:0` 在 cleanup 前就計算，後來沒有重算，不是清理後的漏關證據；原值保留，另存 `post-close-readback.json`。

證據：`image-probe/browser-candidate/evidence` 與 `image-probe/browser-candidate-v2/evidence`。所有假資料留存，沒有永久刪除。

### 原生 MCP 前置實測

使用 agy 1.2.16、Flash 3.8／low、新假 profile 與既有 K gateway：

1. 第一個 probe 誤用了不存在的 `luna_list`，得到真實「Tool not found」。這只證明接到 gateway，不代表功能驗收；腳本錯誤保留。
2. 第二個 probe 只允許 `k_luna/luna_inspect`，同一回合恰好抵達一次允許的 gateway；`k_other/luna_inspect` 被原生拒絕。刻意拒絕後該原生回合沒有 final output，因此原測試要求 final marker 的總斷言為 false；不能把它改寫成整回合成功，但 allowed/denied 的工具事件證據成立。
3. 第三個 probe 在 home 與工作區 `.agents` 設同名 `k_luna`、分別回不同隨機代碼；實際只呼叫 home endpoint 並正確回傳 home 代碼。這驗證了本機目前版本的同名設定優先序，不把未知未來版本也當成已驗證。

證據：`mcp-probe/evidence.json`、`mcp-probe-v2/evidence.json`、`mcp-precedence/evidence.json`。官方背景：[MCP 設定](https://antigravity.google/docs/mcp/)、[權限](https://antigravity.google/docs/permissions/)、[Headless 限制](https://antigravity.google/docs/cli/headless/)。沒有為了通過測試加 skip 或取消 native deny。

## Claude → Flash → Claude：真流程未驗收

**同日後續**：取得兩次限定核准授權後，Claude 與 GPT 各派一次 Flash 的真實完整回報已通過，見 [後續紀錄](gpt-flash-20261003.md)；以下保留當時未核准的證據。

- 第一個測試把 open 階段空的 MCP 清單誤當未接線，在送工作前停下。複查發現 control initialize 與第一個模型回合的 system/init 是不同階段；空清單不是未接線的證據。
- v2 保留 Sonnet 5.5 與 `claude-plan`，只送一次新假資料派工。真正 system/init 已列出 k_luna；Claude 實際提出一次 `luna_start`，指定 Flash 3.8／low。
- 這一步觸發原生操作核准。尚未核准，因此沒有 Flash worker，沒有自動回報回合。測試正常關閉，問題以拒絕／取消收束；沒有改權限、重送、讀取使用者檔案或接觸正式對話。
- 已向使用者另詢問「只核准一次 Flash 讀取新建測試文字檔」的限定測試。未取得答覆前不能把這段流程列為通過。

證據：`claude-flash/evidence/claude-flash-acceptance.json`、`claude-flash/v2/evidence/claude-flash-acceptance-v2.json` 及兩次 post-close 讀回。

## Gemini 跨派 GPT：停在權限取捨，未接入

不能直接把 Gemini 的一般模式對應成同名的 Codex 模式：前者明確禁用指令，後者的沙箱內指令仍可能可用，會造成子代理取得主代理沒有的操作權限。

先查本機官方 Codex 0.159.0 的 CLI／schema，再做一次新假資料的 Luna／high、read-only 原生回合：程序限定 `--disable shell_tool`，保留沙箱與 on-request，若有核准請求一律拒絕。結果原生回合完成，但模型回報「沒有可用的非 shell 原生讀檔工具」，沒有讀到隨機 marker；事件沒有命令、檔案修改或 MCP 工具呼叫。禁 shell 旗標確實存在，不等於剩餘工具足以派工。

沒有因此打開 shell、改成完整存取、加另一套檔案工具或偷偷改走其他模型。已向使用者提出取捨：**是否只在本人明確選用完整存取權的 Gemini 對話提供跨派 GPT，一般模式保持不開放**。未獲答覆前不實作這項路由。

證據：`claude-flash/codex-shell-capability-v1/findings.json`、`live-luna-read-only/evidence/luna-read-only-shell-disabled.json` 與 `review.json`。原 runner 的 `noMcpUse:false` 誤把 MCP startup status 通知分類成工具呼叫；原始事件保留，主代理讀回確認沒有 `mcpToolCall`，不能據此聲稱模型呼叫過 MCP。這只證明本次官方版本／模型／旗標組合，不推論所有未來接法都不可能。

## Gemini 額度切換：真介面驗收未完成

用正式建置前端、隔離候選與官方 `agy /usage` 取得真額度，沒有送模型回合或操作正式 K。測試沿用兩個 UI 建立的空白 Gemini 對話；最後一輪沒有再新增。

- 15:48:49（臺灣時間）官方查詢成功：每週剩餘 97%、5 小時剩餘 95%。這只是當時讀值，不是固定額度。
- 開啟第一個既有對話時，`/api/open` 回傳 200，UI 選取列及控制器 threadId 均符合預期。
- 隨後隱藏 Electron 的 `page.screenshot()` 等待 45 秒逾時，尚未完成側欄／詳情額度核對、第二個對話切換及關閉重開。所以**不能說跨對話額度保留已通過真介面驗收**，也沒有證據將截圖卡住歸因於產品額度缺陷。
- 先前測試腳本的選取器、API 欄位假設、初始工作區與選中對話假設錯誤，以及一次官方額度查詢逾時均保留；沒有把失敗記錄刪掉或改成通過。最後一次有界驗證後停止，不繼續建立對話或反覆查額度。
- 候選測試程序已退出；15:51 主代理讀回候選埠 47837 無監聽，正式 47831 仍由原 PID 32212 監聽。

證據：`quota-switch/readback.json`、`quota-switch/failed-live-usage-timeout.json` 及同目錄測試腳本與隔離資料。`passed:false` 保留，這項仍待後續實際介面驗收。

## 測試與尚待完成

- 最終完整程式測試 **586/586 通過**，失敗、取消、跳過均為 0，33,246 ms。證據 `full-tests-final.log`。前一輪 585/585 尚未包含最後一個 browser 單測；最終七項 browser 單測都已納入。實際模型 probe 不放進日常單測，也沒有用 skip 掩蓋未驗證項目。
- UI 用現有相依成功建置，證據 `ui-build.log`；既有大區塊大小警告不是建置失敗，未為此做無關拆包。
- 尚待：真 Chrome 操作、額度切換介面驗收、取得限定核准後的 Claude → Flash → Claude 完整回報，以及 Gemini 跨派 GPT 的權限取捨與實作。本文件不宣稱整批開發或正式驗收已完成。

## 檔案與部署

產品候選修改：`src/gemini-controller.mjs`、`src/isolated-desktop.mjs`、`src/owner-browser-registry.mjs`；測試：`test/gemini-controller.test.mjs`、`test/gemini-browser.test.mjs`、`test/owner-browser-registry.test.mjs`。文件：`README.md`、本紀錄及 `docs/development-log.md`。

UI 已使用現有相依成功建置到本輪獨立證據目錄，沒有安裝或更新套件。尚未部署、未 push、未打新 tag；不更動正式對話、登入、聽寫設定、使用者的 Chrome 或其他專案。既有未提交的南區更新紀錄及換行差異保留。
