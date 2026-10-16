# 原生檔案連結預覽與桌面右鍵選單

## 範圍與根因

2026-10-16，本人回報小說聊天室的檔案連結點擊失敗、右鍵缺少開啟選項，要求修好後停在重啟前。本批只修改來源連結解析與桌面檔案操作；不修改小說、聊天紀錄、帳號、核心版本或權限模式，不部署、不重啟、不 push。

- 三個原始成果檔案均存在。Markdown 連結使用 `/D:/…`，原程式直接交給 Windows `path.resolve`，變成 `D:\D:\…`，因而回 `ENOENT`。不是檔案遺失，也不是檔案大小或模型額度問題。
- 畫面原用 button 顯示檔案連結，只接預覽；Electron 原生右鍵只有文字編輯及網頁網址複製，未提供本機檔案操作。

## 最小修改

- `src/native-message-file.mjs`：共用原有來源驗證與路徑解析；只在 Windows、解碼後符合 `/磁碟代號:/` 或 `/磁碟代號:\` 時去掉第一個斜線。保留原始 assistant 來源核對、行號、相對路徑、UNC 與 `file:` 處理；不改歷史訊息。
- `frontend/chat-messages.jsx`、`frontend/style.css`：檔案入口改為真正連結，網址仍是既有帶 `threadId` 的檔案預覽入口；左鍵保持預覽，樣式保留。關閉拖曳及中鍵預設開新頁行為。
- `src/conversation-controller.mjs`：新增僅供桌面原生殼直接呼叫的 `messageFilePath`，沿用 `projected(target(context))` 與同一來源解析；沒有新增 HTTP 路由或 renderer IPC。
- `src/electron-workbench.mjs`、`src/electron-file-actions.mjs`：同來源、主 frame 的本機檔案右鍵提供「用預設程式開啟／開啟方式…／在檔案總管中顯示／複製完整路徑」。開選單不執行動作，點原生選項時才依原 `threadId` 驗證來源與檔案存在；切房不錯用新房。失敗顯示原因，不暗中重試。內部網址不交外部瀏覽器。
- `scripts/open-file-with.ps1`：Windows 官方 `SHOpenWithDialog`，使用 `OAIF_EXEC`；檔案路徑及父視窗 HWND 由 UTF-8 stdin JSON 傳入，不拼成命令，不改預設檔案關聯。隱藏 PowerShell 主控台，不設人類選擇期限；取消不當失敗，不加安裝、服務、設定或備援。

## 驗證與限制

- 新增 `/C:/` 回歸測試在原碼確實失敗，重現 `C:\C:\…`；修正後成功，涵蓋中文、空格、括號、百分比編碼、`#`、行號與來源拒絕。
- 新增桌面選單測試：沒有點選不呼叫 OS、原房綁定、外部網址／缺 threadId／子 frame／離開 K 拒絕、來源消失／缺檔／目錄／OS 錯誤回報、中鍵不外開。
- 真正 Windows PowerShell 5.1 編譯原始 P/Invoke 宣告；完整 helper 流程只替換 Win32 對話框函式，驗證中文與命令樣貌檔名原樣傳遞、HWND、flags、成功／取消／錯誤。沒有真的開啟系統程式選擇視窗。
- 完整 `npm test` **1705/1705** 通過，0 失敗、取消、略過；介面建置成功。
- 第一次全套介面 **47/48** 通過；唯一失敗為語音測試等待轉錄逾時。測試工作樹沒有帶入正式啟動器使用的本機 Whisper 路徑，預設位置也不存在；已核對 `.local/runtime.json` 的既有 Python／模型確實存在，只將這兩個路徑傳入本次隔離測試程序，沒有安裝、更動系統環境或修改語音程式。重新執行完整介面測試 **48/48 全通過**（語音測試 46.3 秒通過），首次失敗紀錄保留；最終紀錄為 `ui-full-configured.log`。
- 三家模型呈現、1440／390 兩種寬度，共 6 個畫面案例；每例 11 種檔案連結均能預覽與完整下載，沒有 page error。已查看桌面截圖，文字與圖示正常。
- 隱藏隔離 Electron 44.4.5：真正 renderer 右鍵觸發原生 `context-menu`，實際建構四項 Menu，左鍵預覽成功；popup 與外部開檔／檔案總管／剪貼簿動作由 spy 接住，確認只傳原檔完整路徑，不對本人桌面開窗或搶焦點。首次外層 PowerShell 沒有等待 GUI 程序而誤報空白退出碼；沒有重開 probe，原子程序自行成功結束並留下成功讀回。
- 本批未操作正式 K，也未完成 OS 預設程式或「開啟方式」對話框的實際互動驗收。正式更新後仍須由本人實際點選確認；不把介面／callback／模擬 Win32 測試說成正式 OS 操作已驗收。
- 本機證據集中 `.runtime/archive/native-file-actions-20261016/`，含負向回歸、完整測試、畫面案例、native probe 與 Opus 原生回覆；不提交原始執行資料。

## Opus 5.5 複查與取捨

- 設計討論使用真正 `claude-opus-5-5`，已讀回原生 assistant 模型識別。
- 採納：中鍵與內部網址外開阻擋、不可拖曳、檔案選單不混入複製 API 網址、`openPath` 非空錯誤字串處理、主 frame、原房來源驗證、父視窗 HWND 與取消處理。
- 未採納 stdin 一定會亂碼的推論：helper 明確設定 UTF-8，實際 PowerShell 測試證明中文精確，因此不改用額外環境變數或命令字串。
- 不加 `OAIF_HIDE_REGISTRATION`：Microsoft 明示 Windows 10 起該旗標忽略，且此對話框不能更改預設關聯；保留有效的 `OAIF_EXEC`。
- 不新增副檔名黑名單或每次再確認；OS 開啟仍由本人選原生選項決定。現有 hover 顯示來源，保留四個操作選項，不另加唯讀路徑標題。
- 最終複查於 2026-10-16 18:10 +08:00 完成，原生 assistant 仍為 `claude-opus-5-5`；結論**沒有必修項**，測試全部通過後可提交、合回 main，本輪停在部署／重啟前。Opus 已讀產品修改及新增選單測試，其餘回歸與 probe 部分依本代理提供的證據，沒有冒稱自己重跑。
- 非阻擋限制保留：Open With 啟動失敗目前顯示通用錯誤，細節在 error cause；外部強殺正在顯示 modal 的 helper 可能使父視窗暫不可操作，K 不設 timeout、不自動殺它；沿現有 picker 的 `-File` 執行原則，不改系統 execution policy。圓桌投影中的 assistant 檔案連結沿用既有來源範圍，OS 動作仍只由本人點選。

## 正式來源

- [Electron context-menu](https://www.electronjs.org/docs/latest/api/web-contents#event-context-menu)：使用原生 frame 與 linkURL。
- [Electron shell](https://www.electronjs.org/docs/latest/api/shell)：預設程式開啟與檔案總管定位；`openPath` 的失敗是非空回傳字串。
- [Microsoft SHOpenWithDialog](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shopenwithdialog)、[OPENASINFO](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/ns-shlobj_core-openasinfo)：只開單一檔案，Windows 10 起不能透過此對話框改預設關聯。

## 部署狀態

依本人本輪指示，**已完成本機驗證，停在部署／重啟前**。

- 程式提交：`c3897d50fbcbb2455c892bac317a70f641f3ac19`；本文件與索引另開文件提交。
- 最終驗證：單元測試 1705/1705、介面測試 48/48、建置成功；真正 Opus 5.5 最終複查沒有必修項。原生 OS 視窗互動限制見上節。
- 2026-10-16 18:26 +08:00 唯讀核對：正式版本仍為 `0d14cbd14c3f5c841dda32db254665685ac0d5e6`，`/health` 回 200。
- 沒有執行 Update-K，沒有停止或重啟正式 K，沒有 push，東區不動；本次不是正式環境驗收完成。
