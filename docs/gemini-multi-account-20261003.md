# Gemini 多帳號工人候選（2026-10-03）

## 使用者決定與可觀察結果

使用者要求改造現在的 K，Gemini 優先。多個本人 Pro 帳號只分登入身分與額度，不分記憶或工具設定。專案文件保存任務規則、進度與成果；GPT／Claude 保留主代理角色。A 工人停止後，由主代理檢查已有成果，再以 B 的新工人處理剩餘任務，不搬原生歷史、不重播原工作。

本次明確要求的人用介面是設定內的多帳號登入狀態及剩餘額度，不是新增通用帳號管理後台。東區更新仍延後；南區正式 K 不動。

## 最小設計與本地實作

### 登入、設定與資料

- 只保留一套現有工作區／權限 profile。帳號管理不複製 `.gemini`、MCP 設定、專案資料、Chrome cookies、Google 密碼或 GPT／Claude 登入。
- 新增 Windows 憑證 helper；工廠預設停用，桌面沿用既有 `allowLogin` 開關，必須由本人使用帳號操作入口才首次保存。此次未啟動允許真憑證操作的候選；只允許精確 Antigravity live target 與 K 自己的帳號副本。帳號副本放 Windows Credential Manager，不存純文字 token，不將秘密傳入 Node、HTTP、模型工具、命令列或日誌。
- helper 依目前查到的第三方原始碼使用 `antigravity.gemini` target，UTF-16 JSON 中唯一 email 作身分。這些格式**尚未以本機真實憑證驗證**；不符就停止，不枚舉其他憑證、不猜別的入口。原生 Windows API 讀寫／刪除也尚未實測。
- 設定「保存目前登入」明確加入帳號；重複加入同一身分不增加另一份額度。
- 「加入另一帳號」先保存原登入，再只清除 Antigravity 的本機 live 快取，由官方程式開本人登入；不呼叫可能撤銷登入的 `/logout`，不清除設定。完成後關閉官方程式，再按完成登入。取消可還原原帳號，不保存被取消的新帳號副本。
- 登入中斷的 pending 狀態留在帳號紀錄中，重開候選可完成或取消，不自動猜登入成功。
- Windows 安全儲存保護本機持久化，不宣稱能隔離同一 Windows 使用者下具有完整存取權的程式。

### 額度與畫面

- 側欄顯示目前帳號及該帳號的每週／5 小時額度、已加入的帳號數；不加總百分比、不把未知當零或滿額。
- 設定中逐帳號顯示 email、目前使用、官方登入驗證結果、查詢時間、額度與重設時間。非目前帳號顯示上次查詢資料。
- 額度仍由官方 `/usage` 讀取；只有保存憑證不是已驗證登入。查詢前後必須是同一身分，否則丟棄結果，不寫進原帳號。
- 刷新目前帳號不暗中輪流登入其他帳號。要取得非目前帳號的新數字，先明確切換；舊回應不能覆蓋新的畫面操作。
- GPT／Claude 登入與額度呈現不變。

### 工作與切換

- 同一 K 的 Gemini 主代理、Flash 工人及官方狀態查詢共用帳號操作協調；工作中禁止切換。切換前另查 agy／Antigravity 程序，外部程式未關閉就拒絕，不自動殺程序。
- Flash 可明確指定已加入的 `accountId`。省略時先沿用目前帳號；只有官方資料明確顯示額度為 0 且尚未到重設時間，才在**新派工開始前**選另一個帳號，切換後再向官方查核。
- 某個工作失敗不在原地重送，也不因速率限制／網路／權限錯誤暗換帳號。工作結果保留帳號與輸出，主代理另開新的 `requestId`，用 `handoffFrom` 連到已確認停止的原工作；接手內容由主代理整理，不由 K 複製整份原任務。
- `gemini_accounts` 是只讀 AI 工具；回傳帳號身分、最後查得的額度與忙碌狀態，沒有憑證或切換副作用。
- Gemini 主對話一旦執行就綁定帳號；舊的無綁定原生對話在多帳號模式下不直接跨帳號續接，需新對話交接。GPT／Claude 歷史與記憶不改。
- 程序停止不確定時，帳號管理保持阻擋。刷新只能在原生程序確實已停後解除；不重送舊工作。

## 檔案範圍

- 新增 `src/gemini-accounts.mjs`：秘密以外的帳號紀錄、官方額度歸屬、工作／登入互斥與接手帳號選擇。
- 新增 `src/gemini-credential-vault.mjs`、`scripts/gemini-credentials.ps1`：限定 Windows 憑證邊界，不使用 AISW 整套設定同步。
- 修改 `src/isolated-desktop.mjs`、`src/desktop-server.mjs`：共用服務、沿用桌面 session／origin／POST 核准入口。
- 修改 `src/gemini-controller.mjs`、`src/gemini-worker.mjs`、`src/luna-bridge.mjs`、`src/luna-gateway.mjs`：帳號綁定、新工人接手與不重播。
- 修改 `frontend/account-connections.jsx`、`frontend/usage.jsx` 及對應 CSS；新增假資料 UI probe。
- 新增帳號／Windows helper 測試，補 worker／controller 回歸；更新本紀錄、AGENTS 使用者決定與工程索引。

前一輪圖片／瀏覽器候選仍在同一維護工作樹；其 README、browser registry、圖片測試等既有差異保留，不算本次多帳號新成果。

## 驗證狀態

- 定向既有與新增派工／主對話回歸：85/85。
- 首次完整測試：608 項，607 通過；唯一失敗為新增 CSS 字級沒有使用既有共用尺度，須修正程式，不放寬檢查。
- Windows helper 測試：假輸出邊界、PS 5.1 實際身分解析、雜湊及 C# 編譯；**不包含 CredRead／Write／Delete 實際操作**。獨立複查發現初版使用 PS 7／新 .NET 寫法，已改 PS 5.1 並以假資料實際執行，不只檢查語法。
- CSS 已改用既有字級尺度，不放寬測試；主代理完整測試先 **612/612**；最後補「尚未加入帳號時，停止不確定仍可在確認原生程序停止後解除」回歸，定稿完整 **613/613**，0 failed／skipped（`.runtime/gemini-accounts-full-final2.log`）。
- 帳號管理／Windows helper 曾單獨跑 **23/23**，最後新增 1 項停止恢復案例亦含於完整測試；包含取消新登入不保存新帳號、停止不確定不再派工、壞掉的帳號紀錄回報錯誤且不覆寫。主代理程式複查另補上接手等待後重新核對 bridge 關閉狀態，該特定關閉競態未另作實測。
- `npm run build:ui`：主代理定稿重跑成功，僅既有大型資產包提醒；未為此擴大重構。
- `node test/gemini-accounts-ui-probe.mjs`：主代理定稿重跑 PASS。實際建置畫面配假 API 測試保存前登入確認、取消／完成登入、逐帳號額度、舊資料、工作中阻擋、刷新、不加總、GPT／Claude 保留，以及切換後新對話模型目錄更新。
- 獨立複查補修：原 UI 仍用舊 `geminiStatus` 判斷新對話能否使用；現在以 active 帳號為準。停止不確定原先封死刷新入口；現在以結構化 `uncertain` 狀態允許確認停止後刷新，不解析提示文字，也不放行切換或登入。
- UI probe 與帳號／憑證單元測試皆為假資料；Windows PS 5.1 的解析與編譯是真的執行，但未呼叫系統憑證 API。沒有真人登入或模型工作。
- 主代理已目視雙帳號設定截圖：`.runtime/gemini-accounts-ui-probe/settings-two-accounts.png`。建置、UI、完整測試日誌分別保留在 `.runtime/gemini-accounts-build-final.log`、`.runtime/gemini-accounts-ui-final.log`、`.runtime/gemini-accounts-full-final2.log`。
- `git diff --check` 通過；前一輪候選差異及首次失敗紀錄保留。

## 正式狀態與仍需本人參與

目前是**本地候選，未正式部署、未 push、未打版本標記**。未讀取、保存、切換或刪除任何真實登入憑證，未新增真帳號，未送真模型回合，未安裝套件。真憑證管理已另詢問明確授權；在答覆及假資料驗證完成前不執行。

實際兩帳號驗收尚未完成：原生憑證 target／格式、本人登入、訂閱資格、額度身分歸屬、刷新後憑證保存、A→B 工人接手及取消還原，均不能用假資料測試代替。也未驗證其他程式在 K 外擅自換登入的所有競態；使用帳號輪替時應關閉獨立 Antigravity。

本次沒有擴大跨供應商入口：現行 Flash 派工仍走 Claude 的 k_luna gateway；Codex 原生子代理不因此變成可派 Flash。GPT／Claude 自身多帳號仍是次要研究，不混入本批。

**同日後續更新**：使用者追加要求後，GPT → Flash 已納入候選，GPT／Claude 各一次真實限定讀檔與回原對話均通過；詳見 [GPT／Claude 一起派 Flash](gpt-flash-20261003.md)。原生 GPT 子代理仍獨立走原生入口，真實帳號輪替仍未驗收；本節以上保留上一輪狀態。

維護來源：`C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`。`D:\K-harness` 保留舊實驗工作樹，只同步本工程紀錄、索引與新增使用者決定，不覆蓋來源或正式 runtime。

## 來源

- [Antigravity 官方登入](https://antigravity.google/docs/cli/install/)：Windows keyring 與本人瀏覽器登入。
- [AISW 固定版原始碼](https://github.com/burakdede/aisw/blob/00b4c24895e64234a89df55abfa12655711141ce/src/auth/antigravity.rs)：只作精確登入目標研究，不採用其設定目錄同步。
- [keyring-rs 3 Windows 實作](https://github.com/hwchen/keyring-rs/blob/v3.6.3/src/windows.rs)：target 命名及 UTF-16 password 儲存。
- [Windows CredReadW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw)、[CredWriteW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew)：原生 Credential Manager 呼叫邊界。
