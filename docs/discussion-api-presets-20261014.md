# 討論 API：GLM、Kimi 預設選項（2026-10-14）

## 需求與邊界

本人要求 GLM、Kimi 像 DeepSeek 一樣可直接選擇，API 僅用於討論。本人提供的平台畫面確認 GLM 使用 Z.ai 一般 API、Kimi 使用 platform.kimi.com；不接 Coding Plan、不擴張主模型或工人路由。

基底為 `933ab9788c98c8310861846354fcb40200ed39b4`，程式提交為 `67841099bce533c1e16a96e6a2ec52852e7b6941`。本批不讀取、搬移或代填本人金鑰，不呼叫付費模型 API，不安裝相依或升級核心。

## 最小修改

- `frontend/discussion-api-settings.jsx`：既有供應商選單加入 **GLM（Z.ai）**、**Kimi**，保留 DeepSeek 與自訂 OpenAI 相容入口。選擇預設時帶入網址與預設名稱，自訂名稱不覆蓋；重開編輯依既有網址辨識，容許尾斜線。
- 切換到不同服務時清除表單內尚未保存的 Key 與舊模型 ID，避免把前一家金鑰或型號帶到下一家。不碰已保存的金鑰；後端既有「網址變更須重填 Key」規則不變。
- 不新增連線資料欄位、供應商轉接層、模型清單、重試或備援。模型沿用本人輸入或明確按「查詢模型」取得的目錄；選預設本身不保存、不發出 API 請求。
- `test/discussion-api-settings-ui-probe.mjs`：擴充既有真瀏覽器假資料測試，測試建置暫存改用既有 `test/scratch.mjs`。
- `docs/development-log.md`：加入本紀錄索引。

## 官方網址核對

2026-10-14 查核官方文件，僅設定一般 OpenAI 相容 Chat Completions 入口：

| 選項 | Base URL | 依據 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | 沿用既有預設 |
| GLM（Z.ai） | `https://api.z.ai/api/paas/v4` | [Z.ai Quick Start](https://docs.z.ai/guides/overview/quick-start) |
| Kimi | `https://api.moonshot.cn/v1` | [Kimi 快速開始](https://platform.kimi.com/docs/get-api-key) |

不從舊網址、地區猜測或口語名稱編造型號。預設網址存在不代表本人的 Key、餘額或模型權限已驗證。

## 驗證

- 新增的 UI 選項斷言在舊元件確實失敗：只有 `deepseek`、`custom`，缺少 `glm`、`kimi`；修改後 built UI 真瀏覽器測試通過。
- UI 回歸涵蓋兩家預設網址／名稱、保存與重開、尾斜線辨識、明確查詢模型、Key 不回填、不進 browser storage、跨服務清除表單 Key／型號、自訂名稱保留、原有訂閱／API 分組及遠端禁管理。
- 首次完整測試為 1637／1639：乾淨工作樹尚未先建置 `dist-ui/index.html`，使既有 branding 與 desktop HTTP 兩項測試失敗；沒有因此修改產品或測試斷言。補齊原有 UI 建置前置後再跑完整測試，**1639／1639 全數通過**。
- UI 正式建置成功；既有大型 bundle 提示保留，未擴張拆包工作。
- 本機證據位於本分支工作樹 `.runtime/archive/discussion-api-presets-20261014/`；不提交私人執行紀錄。

## 複查與部署狀態

- 真正 Opus 5.5 經 K 專用 Claude Code 2.1.296／Pro 訂閱完成唯讀複查，實際回傳模型為 `claude-opus-5-5`，session `360db45d-2f56-4e10-9801-0bf4019657ea`；exit 0、success、is_error=false，無必修。主代理核對 8 個 Read／Glob／Grep 工具呼叫皆在非敏感原始碼封包內，沒有改檔、執行命令或連網。
- Opus 非阻擋意見：尾斜線處理可抽函式、切自訂時保留名稱、新增 DeepSeek 的原始空名稱，均非需求缺口，保留較小實作；真服務的 `/models` 與串流相容性仍須明確區分未驗證。封包未含 `scratch.mjs`，主代理已直接檢查其匯出且實際 UI 測試成功。主代理獨立檢查全部 diff、UI 結果、建置與完整回歸，沒有將複查結論代替實測。
- **南區已部署並完成正式讀回。** 2026-10-14 10:04（Asia/Taipei）本人再次明確要求更新，Codex 在 K 外確認無 K 程序、47831 無監聽後，單次執行 `Update-K.ps1 -Ref 65c4fc0ba0bd4bf6d148194ee1cfbeda6e31487f`。此主線合併版本同時包含本批 `6784109` 與 [全面檢查後續](k-audit-followups-20261014.md) 的 `804cbde`，沒有退回較早分支。
- 更新器完成 UI、瀏覽器助手及啟動器建置，合併版本完整測試 **1646／1646 通過**；`.local/runtime.json` 讀回上述完整 SHA，`previous` 為 `releases/before-1791943539979`，其 `settings.json` 確認上一版 `e4d4b7ef82aabe48a6ce26f8f38a91326fb5d0b9`。Node／聽寫路徑未改，10 個本批修改的部署來源檔案與固定版本逐一相符。
- 10:06:20 啟動正式 K 後 `/health` 回 **200**，程序位於正式 runtime。10:07 公開靜態介面資產回 200、內容雜湊與已安裝建置一致，含 DeepSeek、GLM（Z.ai）、Kimi 及三家預設網址；未登入的 `/` 回 403 是既有桌面入口保護，未讀取登入資料或繞過驗證。
- 10:08:00 程式 push 完成；遠端 `main` 與本機均為 `65c4fc0ba0bd4bf6d148194ee1cfbeda6e31487f`。push 前檢查 11 個待送提交、24 個檔案的歷史差異，未含私人路徑或二進位檔；唯一疑似 Key 是 UI 測試明示的假資料，未發現真實憑證。部署紀錄另作純文件提交並同步，不再次重啟 K。
- 更新前最舊程式退版離開原路徑，但回收讀回未能確認可還原，已停止並回報；本人隨後明確要求不再保留該份、直接更新。本次未重試清理、未清空回收筒；更新後保留三份程式退版，不視為對話備份。
- 部署證據：主工作樹 `.runtime/archive/k-presets-followups-deploy-20261014/` 的更新紀錄、版本／健康／靜態資產讀回與秘密檢查／遠端 SHA；私人執行證據不提交。
- 未使用本人真 Key 驗證 GLM／Kimi 的模型查詢或討論回覆，不宣稱已完成真服務接通。東區未更新。
