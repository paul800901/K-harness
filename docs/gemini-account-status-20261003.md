# Gemini 登入狀態與官方額度補修（2026-10-03）

使用者指出設定只寫「由官方管理」，無法判斷是否登入，並追問官方額度接法；出發前先完成基本功能，圖片及其他能力留到南區繼續。

## 根因與差異

- `src/gemini-login.mjs`：原本只查模型目錄，沒有查帳號。改用官方 `agy -p /usage`，取得有效 Gemini 帳號額度報表才顯示已登入；明確登入錯誤顯示未登入，網路／版本／未知格式顯示尚未確認。這是 CLI 直接回答的查詢，不送模型回合、不讀憑證、不改 API 計費。額度為原生剩餘百分比與重設時間，不以 Token 推估，也不混入 Antigravity 內的 Claude／GPT 額度。
- 同檔原本每次覆寫 settings，會清掉本人在官方程式完成的初始化／配色／資料分享設定。改成只在不存在時建立，已有設定逐位元組保留；沒有從其他 profile 搬設定或猜測還原已被舊版清除的偏好。
- `src/gemini-controller.mjs`：模型目錄不額外查帳號；沿用既有額度刷新流程，每分鐘查一次、合併同時請求；查詢失敗保留原時間並標為舊資料，不當成 0%。
- `frontend/account-connections.jsx`：收合列直接顯示 Gemini 已登入／未登入／尚未確認／未安裝；展開顯示查詢時間，確認登入後停用登入按鈕。說明首次開啟需初始化，完成後回 K 刷新。
- `frontend/usage.jsx`：側欄及詳情呈現 Gemini 每週、5 小時剩餘百分比、重設時間、資料時間與舊資料標示。
- 測試：`test/gemini-login.test.mjs`、`test/gemini-controller.test.mjs`、`test/model-picker-compact-ui-probe.mjs`；README、原三核心文件及開發索引同步更正。

更正先前「未找到正式額度介面」：官方 [Headless 文件](https://antigravity.google/docs/cli/headless/#unsupported-messages) 已說明 `/usage` 可透過獨立 `--print` 呼叫取得文字報表；先前調查不完整，不能歸因為官方沒有提供。此次無需第三方開源工具或新增相依。

## 驗證

- UI 建置成功；完整套件 **577/577**，失敗／取消／跳過 0，36540.2143 ms。證據 `.runtime/gemini-account-full-tests.log`。
- 建置介面真瀏覽器測試 PASS，含登入三種狀態、收合顯示、登入按鈕停用、97%／0% 額度、重設時間及舊資料標示；原模型／權限／子代理測試保留。證據 `.runtime/gemini-account-ui.log`、`.runtime/gemini-account-quota-ui.png`。
- 真實 agy **1.2.16**，2026-10-03 13:27:36 臺灣時間查詢成功：`auth.loggedIn=true`；每週 **97%**、重設 `2026-10-09T14:10:46Z`；5 小時 **97%**、重設 `2026-10-03T08:01:09Z`。證據 `.runtime/bootstrap/gemini-auth-status-live.json`。數字只代表該次查詢。
- 新增測試驗證額度用完 0% 仍屬已登入、目錄成功不等於登入、失敗不洩漏原始診斷、已有設定不被刷新／登入覆寫。
- 首次正式介面已讀回「Gemini 已登入」，但額度檢查失敗：`src/conversation-controller.mjs` 的共用額度投影只列 Codex／Claude，切到既有聊天室漏了 Gemini。補成保留所有原生供應商額度，新增切到 GPT 仍可見 Gemini 額度的回歸測試；不把首次失敗當成通過。首次證據保留為 `.runtime/bootstrap/gemini-account-live-ui-attempt1.json`。
- 接線補修後最終完整套件 **578/578**，失敗／取消／跳過 0，32275.1339 ms，證據 `.runtime/gemini-account-full-tests-final.log`。前端未再變動，沿用上面已驗證的建置。第二次工程 UI 啟動等待後腳本未找到預期控制項，留存 `gemini-account-live-ui-attempt2.json`，再次檢查加入階段與畫面定位證據；沒有據此更改產品或宣稱延遲根因已定位。
- 後續讀回查到官方 `models` 卡在「Fetching available models...」並於 30 秒逾時；帳號與額度不需要模型清單，拆開兩條查詢以免連帶受阻。未知／網路失敗仍不假報已登入或 0% 額度。

## 正式狀態與南區交接

本次修正已實作並完成本機驗證；正式部署與 GitHub 發布另於下方記錄，不以候選結果冒充正式套用。既有正式版本為 `383c744`。圖片、K 瀏覽器助手及更多 Gemini 主代理能力未在本次擴張。

南區取得最新 main 後，以現有 `Update-K.ps1 -Ref 'origin/main'` 更新；由本人安裝／登入 agy，先確認 `agy --version`、`agy models`，再執行 `node scripts/antigravity-permission-probe.mjs --run` 並取得 PASS。其他電腦尚未實測，不搬東區登入資料。

## 使用者出發前停止（正式更新延後）

使用者表示必須關閉東區電腦返家，明確要求延後東區更新，停止後續部署／重開。截至停止時：

- 最新程式提交 `352297e`：登入／額度查詢已與模型目錄分開；最終完整 **578/578**，失敗／取消／跳過 0，33844.9748 ms，證據 `.runtime/gemini-account-full-tests-release.log`。此提交尚未套用東區。
- 東區曾依本人「已停止 K，套用東區」授權，於 13:29:13 正常退出後先套用 `e56d946`、再套用 `51d0f9c`。目前正式 runtime 為 **`51d0f9c` 中間版，未完成最終正式驗收**；不宣稱部署完成。K 未透過正常入口重開。
- 舊正式 `383c744` 保留於 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1791005402840/runtime`；之後兩版亦各有備份。Codex／Claude 設定與聽寫設定讀回未變。
- 真 CLI 登入／額度與建置 UI 已通過；正式 UI 讀到「Gemini 已登入」，額度最終畫面尚未完成驗收。四次工程檢查的失敗證據保留於 `.runtime/bootstrap/gemini-account-live-ui-attempt1.json` 至 `attempt4.json`；後續查到模型目錄逾時，已在最新來源拆開依賴，不冒充最新正式成功。
- 南區優先拉取 main 的 `352297e` 或後續純文件提交，套用後驗證設定的登入狀態、額度視窗／側欄與切換聊天室，再執行 Flash 權限 probe。圖片及其他多功能留在這些基本確認之後，不擴張本輪。
