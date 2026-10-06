# 新對話原生加速入口（2026-10-07）

## 需求、根因與最小變更

本人指出既有聊天室的推理選單有「原生加速」，新對話卻沒有。後端 `open()` 已接收並保存 `serviceTier`，也會傳入原生 `thread/start`／首次 `turn/start`；缺的是新對話介面的選擇與傳值，不需要另建後端或加速系統。

- `frontend/model-picker.jsx`：建立 Codex 對話時，共用既有推理／速度選單；僅原生目錄提供唯一 Fast 項才顯示，傳送其官方 ID。預設標準，不繼承目前聊天室的加速；換模型重新回到標準。建立時將選擇送到既有 `/api/open`。
- `frontend/reasoning-picker.jsx`：共用顯示增加「模型預設」及「建立後從第一則訊息開始使用」文案，保留更多額度提示。`effortName` 移至此元件並由原位置再匯出，避免循環引用。
- `frontend/model-picker.css`：只調新對話欄位內的選單按鈕，不改既有輸入框。
- `test/desktop-model-switch.test.mjs`、`test/new-dialog-fast-ui-probe.mjs`：原生協定假 host 與完整建置 UI 假 API 測試。

速度不改推理、操作權限或子代理預設。Claude／Gemini 不顯示也不接收 Codex tier；既有對話的切模型入口不因此改速。不新增 API 計費，不呼叫或改動真實工作。

## 候選驗證

- 來源完整測試 **911/911**；新增原生協定 fixture 確認 `thread/start` 及首個明確送出 `turn/start` 都帶 `priority`，建立不自動送訊息，原預設核准與工作區寫入權限不变。這不是新一輪真實模型測試。
- 新 UI 探針四尺寸：1440×1000、1100×760／125%、390×844、360×640；後兩組使用遠端 HTML 標記。全 API 攔截、假目錄使用 `catalog-fast`，確認未寫死 ID、模型切換／重新開對話回標準、推理預設不送空字串、各提供者 payload、Escape、邊界及不水平溢出。截圖已人工檢視；不是實機 Android 驗收。
- 原聊天室 Fast UI 三尺寸、GPT／Claude／Gemini 子代理選單探針通過。Vite 建置通過，保留既有大 bundle 警告。
- 兩個較舊探針未全通過，且以未改動的正式 `50fca2f` UI 重現相同失敗：`model-picker-compact-ui-probe.mjs:212` 仍找舊「登入 Gemini 訂閱」按鈕；`model-picker-ui-probe.mjs:68` 仍預期 Luna/high 預設而不是已正式採用的 auto/auto。本批不改不相關測試或帳號流程，不把這兩項報成通過。
- 真正官方訂閱 **Claude Opus 5.5** 只讀複查，session `e30e6ca1-398e-4143-9138-c9d54dfc0728`，無阻擋。未採納無必要的 effect／位置計算重構。既有後端在提交前目錄撤除 Fast 時會正規化成標準，屬原有行為，本批未擴改。

本機證據位於 `.runtime/new-dialog-fast-20261007/`，不發布私人截圖、憑證或對話。既有真原生 Fast／Standard 回合證據見 `goal-fast-workers-20261006.md`；本批只補前端入口，未重送真實工作。

## 正式狀態

已實作並完成來源驗證及 Opus 複查；尚未部署。正式仍為 `50fca2f`。下一步固定 Git 程式版本、乾淨候選建置／回歸；待本人正常停止 K 後才套用並讀回。保留對話、五帳號、手機登入與電腦金鑰備份，東區不動。
