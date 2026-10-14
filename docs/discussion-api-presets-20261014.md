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
- **本地候選驗證完成，尚未部署、尚未 push。** 正式 K 仍在執行，未關閉或干擾；正式版與本批候選分開。後續固定部署上述程式 SHA，保留退版並完成正式讀回後才 push；文件提交不需重啟。
- 未使用本人真 Key 驗證 GLM／Kimi 的模型查詢或討論回覆，不宣稱已完成真服務接通。東區未更新。
