# K 內 Gemini 的 Google Ops 盤點核對（2026-10-04）

## 結論

使用者提供的盤點不能照單當成既有功能：「已有設定欄位」不證明憑證仍有效；「能列評論／影片」不等於能回評／發文／上傳。不能把這批工作說成只差一條 MCP 接線。

本次唯讀核對 `D:\ObserveOpsControl_官網廣告社群\02_廣告_AdsControl` 的規則、來源碼及 README；沒有讀 `.env`、OAuth JSON、token、資料庫、真實客戶或素材內容，没有執行同步、API 或改動外專案。其既有未提交變更保持不動。

## 實際存在與缺口

| 能力 | 已有實作 | 不能宣稱 |
| --- | --- | --- |
| GBP | 帳號、據點、評論、貼文的 GET 清單 | 沒有回評／發文方法；未驗證現有憑證與 API 權限 |
| Search Console | 站點、search analytics query | 未驗證本人網站可讀或資料新鮮度 |
| GA4 | 帳戶／資源摘要、runReport | 未驗證本人資源可讀；指標不直接代表到店或營收 |
| YouTube | 頻道、uploads playlist、影片及統計 GET | 沒有影片 upload 方法；未驗證目前 token |
| Google Ads | 本次不操作、不擴張既有 Ads 權限 | 不宣稱能調整預算、出價或廣告 |

主要證據：

- `google_ops_worker/google_ops_client.py` 304–344：GBP GET；347–423：同步寫 SQLite；426–490：Search Console；494–648：GA4；685–717：CLI choices。
- `google_ops_worker/sync_gbp.py`、`sync_search_console.py`、`sync_ga4.py` 只有固定指令 wrapper，不是各自完整 API。
- `youtube_api_worker/youtube_client.py` 176–199 僅 GET；268–316 讀頻道／影片；345–376 同步；396–404 CLI 只有 test_connection/sync。沒有 upload。
- `backend/routes/google_ops_sync.js` 73–111 與 `backend/routes/youtube_sync.js` 67–102 是觸發同步，不是純查詢工具；同步會寫 DB 和紀錄，未設 selector 時還可能改外專案 `.env`（Google Ops 449–450、631–632；YouTube 345–376）。

## 為什麼不能直接照原方案掛進 K

1. 現有同步有本機副作用，不能包裝後標成唯讀。
2. `backend/server.js` 31–36 為 wildcard CORS，130–133 直接掛路由，152–157 listen 未指定 host；所查路由未見認證 middleware。這是靜態判讀，不是外網可達性結論，不應直接以既有路由作為 K 的受限工具介面。
3. Google Ops scopes 實碼有 `analytics.edit`，README 只寫 readonly；本輪記錄但不順手變更權限。
4. MCP 是工具接入方式，不是 Google API 必須另加的平台。若要 API 工具，先重用具體讀取函式，避免通用 command／URL proxy，不把秘密搬進 K；查詢與對外發布分開。
5. 不需要另造「素材路徑映射服務」。依實際任務提供明確素材路徑即可；不因資料夾存在而開放整顆 E 槽或整個素材倉庫。營運現況規則顯示北區已停業，舊北區素材不能當成可發布的現況。

## 本輪處理與未完成

- 優先完成使用者追加要求的原生搜尋、讀網頁及 Chrome 通道，見 [工程紀錄](gemini-web-browser-20261004.md)。這些能力與 Google Ops API 是不同接法。
- 尚未建立 `k_google_ops`，未擴張自訂 MCP 白名單；不為了配合不準確的盤點，把沒有的 API 寫入功能說成已接通。
- Google Ops 的「既有唯讀查詢封裝」與「新增回評／發文／上傳」須按上述實際差異安排，不能作為同一個小接線變更直接部署。
- 本次 API live 測試數 0；程式盤點不等於 API 驗收。沒有部署、push 或外部發布。
