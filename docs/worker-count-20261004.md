# 全 K 子代理執行數、簡化交接通知與 Gemini 登入誤判（2026-10-04）

## 使用者要求

- 參考 DSH 在聊天室上方呈現子代理的方式，但使用者只需要現在有幾個在跑，不需要累積完成數或工作內容。數量供對照工作管理員，不是 CPU 使用率，也不是保證工作未卡住。
- 上方常駐「子代理執行中：N」，統計 K 本次服務所持有的所有聊天室；零個顯示 0，無法確認時顯示「子代理：狀態待確認」。不搬 DSH 程式／框架，不改 DSH，不新增監控服務、定時查詢或人用管理頁。

## 最小實作

- `src/conversation-controller.mjs`：從既有 live controllers 的 workers 狀態導出 `workerActivity`。只算 running 且未 settled 的子代理，排除準備／等待、終態與背景命令；隱藏聊天室仍計入，切畫面不停止工作。傳到介面的新增資料只有數量與是否未確認，不加入工作內容。
- `src/desktop-controller.mjs`：Codex 已知子代理的回合開始／完成／狀態事件，及既有 collab 活動，觸發原本的 worker 讀回。先前子回合事件被主聊天室過濾掉，可能讓清單直到主回合完成才刷新。以讀回序號避免較慢的舊結果把已完成改回執行中；原 stop／idle 呼叫仍取得完整結果，沒有重送工作。
- `src/claude-controller.mjs`：現有 local_bash 背景命令標記 `kind:command`，只從代理數排除，不取消停機／移動保護。真實重現背景 Agent 結束後仍 running：原生 local_agent task_started 未綁 nativeTaskId。最小補上建立／綁定，同既有 task_notification 完成訊號收尾；已完成者不被晚到工具結果復活，async_launched 有原生工作綁定時仍為 running。
- `frontend/main.jsx`、`frontend/style.css`：上方常駐數字；事件連線中斷不繼續顯示舊數字。移除右側分頁的累積數、不再因子代理自動開啟面板；既有按需明細暫留，未刪歷史。窄視窗／縮放時標題可縮、標頭可換行。

## 驗證與限制

- 本機完整測試 708/708 通過；新增多聊天室加總、排除背景命令及終態、隱藏聊天室失聯、Codex 子回合完成時主代理仍 busy、慢讀回不復活已完成代理。
- `test/worker-count-ui-probe.mjs`：真建置介面＋假 API／事件流，100／125／150% 三主題／視窗，驗證 0→3、切聊天室仍 3、完成扣除至 0、未知／斷線／恢復、不自動開右側及標頭完整顯示；3/3 通過、無頁面錯誤。初版 150% 標頭過高溢出，改用可縮標題與自適應高度後通過。
- 未因沒有輸出或 CPU 低就判定子代理死亡；供應商不回報的狀態不能自行推斷。沒有新增跨模型／跨帳號路由、重試、取消、權限或帳號變更。
- 原生真派工（新建假資料工作區，既有官方訂閱、不操作使用者聊天室）：Codex GPT-6 Luna/high 子代理觀察到 running→completed；Claude Opus 5.5 兩個前景代理同時執行、各自完成，背景代理亦在 task_notification 後完成歸零。未修前的背景 running 殘留與修後證據均保留。
- Gemini Flash 前段測試：第一次僅 models 查詢逾時，確認未送出任務且程序已結束後才新建測試。第二次原生程序啟動，橋接狀態 starting→running→failed/settled，無殘留執行數；官方日誌回 UNAVAILABLE / 503「The service is currently unavailable」且 Not sending user message。這兩次沒有成功完成回合，不換帳號、不放寬權限、不改原生核心、不加入重試。後續另建的同帳號雙工人已成功，詳下方帳號驗證；先前失敗紀錄保留，不能宣稱 Google 服務不再有暫時錯誤。
- `native-evidence.json` 保留必要摘要；上述原生／UI／單元證據不等於正式版已部署。

## 複查與發布

- 真正 Opus 5.5 第一輪只讀複查完成（session `a4455bf5-31a8-4a24-b688-fa4fcc3b1a93`），確認無過度工程化，要求實測狀態可信度；上述已補真派工及 Claude 背景修正，計數最終複查已確認無阻擋（session `ed7c9589-dec0-46d2-afc9-b9682a3937fb`）。使用者追加通知／帳號已經真正 Opus 5.5 兩輪複查：`84fc5666-89fc-4888-b544-99f845b908a7`、`86276fae-7968-41b3-9853-c589e914300a`，最終無阻擋。程式已固定、部署及推 GitHub，詳末節正式讀回；未強制停止使用者工作。
- 證據：維護工作樹 `.runtime/worker-count-20261004/`，及 `.runtime/worker-count-full.log`、`.runtime/worker-count-targeted.log`。

## 使用者追加：不顯示 AI 交接通知

- `frontend/native-notices.mjs` 僅隱藏 info 層級的 `worker-completion` 橫幅（包含重複的「Flash 子代理結果已交給 Codex 主代理驗收」）；底層交付、原始事件與處理過程不刪。警告／錯誤／登入與待決定事項保留。
- 單元測試驗證輸入未改及同 kind 錯誤不隱藏；`test/native-notices-ui-probe.mjs` 確認真建置介面無橫幅、無空白占位、無「知道了」，真正錯誤仍顯示。

## 使用者追加：四帳號切換與同時使用

### 已確認根因

1. 正式帳號原生日誌 21:32／21:33 已有 `OAuth: authenticated successfully`，但 `/usage` 等候未完成而逾時。K 將既有 authenticated 改為 unknown，派工再一律回「需重新確認登入」。21:34 沒有重新登入就查詢成功，證明不能將未知當成登出。早前假資料 Flash 原生測試另遇 Google 503；不將兩者混為同一次失敗。
2. `acquire()` 在原生身分非同步檢查期間共用 changing 鎖，三個同帳號工人同時進入時，後兩個會被誤判正在切換／登入。先前只測先後取得 lease，沒有覆蓋同時啟動。
3. 額度查詢本身會暫時鎖住換帳號，介面卻泛稱「正在工作」。不是所有按鈕停用都代表登出或永遠卡住。

### 最小修正與邊界

- `src/gemini-login.mjs`：已確認程序收尾的逾時／明確服務暫時不可用，回 temporaryFailure；未知仍未知，不改稱登出。真正登入拒絕仍是 signed-out。
- `src/gemini-accounts.mjs`：僅前次已驗證的同一身分，在上述暫時查詢失敗時保留原 auth 與原驗證時間；額度保留舊值且標 stale。未驗證者不變成已驗證，已登出者不復活，身分查詢前後比對不變。這不是宣稱即時認證成功，實際回合仍由原生 agy 驗證。無法辨識的失敗仍阻擋，但不瞎要求重新登入。
- 僅將取得 lease 的前置檢查依序執行，不序列化模型工作、不重送失敗任務。真正人為切帳鎖仍在；只要有工作，其他帳號不能覆蓋共用登入。
- `frontend/account-connections.jsx` 以現有刷新進度顯示「正在查詢 Gemini 額度」，查詢收尾後恢復按鈕；不新增管理面板或重試。
- 四個保存帳號可輪流選用；同一帳號可同時有多個工人。**四個不同帳號同時跑尚未提供**：目前 Windows 原生憑證槽共用，不能以多份 HOME 或直接移除鎖假裝隔離。此批不改憑證儲存／作業系統帳號／計費，也不把本限制宣稱已完成。

### 驗證

- 44/44 帳號／登入定向測試；完整 708/708。新增真同時 Promise.all 三次取得、失敗後鎖釋放、跨帳號執行中拒絕、逾時保留前次認證、真登出阻擋、查詢後按鈕可恢復。
- 帳號 UI 假 API 實測查詢文字、鎖定期間禁切換、收尾後自動恢復；原新增／完成／取消／狀態未知／四帳號呈現流程回歸通過。不以假 API 當成真登入。
- 真實四帳號逐一切換，身分均正確、收尾 busy=false；前三個官方 `/usage` 當次成功，第四個當次逾時，保留舊認證且未鎖死。後續只重查第四個額度，原生查詢成功，四帳號均已取得本輪成功證據，沒有要求重新登入。兩次檢查都回到原選帳號且確認原生身分。
- 同帳號兩個新建唯讀假資料工人，OS 原生程序確實重疊，同時取得 lease、分別回答 `CHECK_0 77`／`CHECK_1 88`，皆 completed + settled，收尾 busy=false、原帳號不變。不是同時四不同帳號，不重送使用者翻譯。
- 證據：`.runtime/worker-count-20261004/native-accounts-1791121559352/result.json` 與 `native-fourth-query-1791121896657/result.json`；只在正式 K 與原生程式均已停止後驗證，不讀寫使用者工作內容。

### Opus 複查採納與取捨

- 採納：保留上次真正驗證時間時，不能失去既有 60 秒查詢節流。新增同一帳號列的 `lastQueryAt` 記錄嘗試時間，只供既有節流使用、不當成新認證或公開欄位；補測短時間 usage/acquire 不重查，61 秒後才查。
- 採納：將暫時失敗匹配收斂到 `code 503`／`503 Service Unavailable`／`network timeout`／已清理的逾時，不把其他 unavailable（例如訂閱不提供）誤標 Google 503。
- 確認接受的語意：UI「已驗證」是所列時間的成功確認，暫時斷線不撤銷既有認證；即時是否授權仍由每次原生 agy 驗證，外部撤銷的帳號無法因此繞過原生核准。非暫時未知、明確登出、身分不一致、程序清理未確認仍不放行。不再疊另一層登入有效期限機制。
- `--version` 失敗與不可辨識的 `/usage` 例外保守回 unknown，不為未觀察案例再擴增分類。本輪 Opus 不要求此項；保留限制。

## 正式部署與 Git 讀回

- 固定程式 `6fbdcfde943b4e671c15288494017497e8dea745`；由該 Git 版本建立乾淨候選，沿用原相依、不安裝或升級套件。候選完整 708/708、零失敗／跳過，472 個 Git 原始檔逐一比對一致。
- 2026-10-04 21:59 核對 K 啟動器、背景服務及原生工作均已停止，才換入正式程式。187 個受保護檔案（原生核心、設定、保存對話）及四帳號身分／選用不變；只換程式與啟動器，沒有搬登入憑證或還原使用者資料。
- 保留原正式 `7e13c7a29abccf7eb14dddcff71455adc9a3987f`，退版位置 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791122392341`，舊介面與啟動器已比對。
- 22:00 由代理呼叫既有 `D:\K-harness\Start-K-Desktop.ps1` 重開：正式 health 正常、三個實際供應介面資產 hash 一致、未授權 state 仍 403。啟動後目前 Gemini 帳號原生額度查詢成功，四帳號皆保留 authenticated，無 loginPending。這是既有入口的代理啟動讀回，不冒稱本人從 Explorer 啟動或本輪再次人工介面驗收；UI 行為驗證與真派工證據分列於上。
- 程式已推私人 `paul800901/K-harness` 的 `main`；新標記 `k-worker-count-accounts-20261004` 解參照為上述固定程式 SHA，遠端讀回一致。收尾文件另提交，不改標記或正式程式版本；東區未更新。
- 部署證據在 `D:\K-harness\.runtime\worker-count-deploy-20261004`：`preparation.json`、`full-tests.log`、`activation.json`、`protection-before.json`、`protection-after.json`、`served-readback.json`、`startup-readback.json`。
