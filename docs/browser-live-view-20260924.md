# 瀏覽器同頁顯示與人工接手

## 使用者要求
右側採可關閉分頁列與「＋」新增選單，成果與子代理按需開啟；瀏覽器是協作分頁，不是固定技術面板。AI 與人使用同一個對話專屬瀏覽器，人工接手時不得和 AI 同時操作。

## 實作責任界線
- 沿用已安裝 Microsoft Playwright MCP 的公開 `createConnection(config, contextGetter)`，不新增代理模型或切換計費；以同一 BrowserContext 供官方工具及畫面使用。
- 右側採定期擷取的真實頁面畫面，不是任意網站 iframe，也不是假預覽。這不是原生 WebView 或連續影片串流；應明示更新方式。
- 對話專屬瀏覽器維持獨立 profile；不讀使用者 Chrome/Edge 個人登入資料。只使用既有系統瀏覽器，不自動安裝。
- MCP 程序內的協作服務只聽 loopback 並驗證隨機 token；連線描述存 profile 目錄，不存允許模型上傳的 output 目錄。桌面服務以目前對話的 sessionKey 查找，不接受前端傳入 endpoint/port/token/path。
- K 原有桌面 cookie、Origin、POST 標頭防護保留。換對話後舊 threadId 被拒；frame 回來後再核對對話，避免舊畫面混入新對話。
- 接手先禁止新的 AI 瀏覽器工具；已開始的操作需完成才允許人工輸入，不能宣稱中途撤回已送出的網站操作。交回前不得有人工作業仍在進行。
- 登入/OTP 由使用者操作；本輪驗收只准隔離本機無帳號測試，不做真登入、不操作真網站，不建立正式 browser-mcp.json。

## 需分別驗收
1. 同一真實頁面右側可見與放大；不是另一瀏覽器。
2. 「＋」新增、分頁切換、關閉；不可把關閉視圖冒充關閉原生頁面。
3. AI 工具在接手期間遭拒；進行中工具完成前人工不能操作。
4. 人工輸入可在同一頁讀回，交回 AI 後同一頁內容仍在。
5. 認證、跨來源、舊對話、斷線、關閉清理和先前假檔邊界仍通過。

## 本輪驗收與狀態
- 實作包含：可關閉分頁列＋新增選單；多個真正網頁共用對話 BrowserContext；右側每秒更新畫面與展開；人工點選、文字、有限按鍵、上下捲動與網址導航；接手／交回 AI 的工具層互斥。
- 主代理透過 CUA 操作 47845 隔離 K 介面，實際啟動獨立無頭 Edge，僅導航 47846 本機假資料頁。頁面文字 K_HANDOFF_OK 已輸入並按測試按鈕讀回；交回 AI 後內容保留，重新整理 K 後仍可看到相同內容。
- 多個網頁：新增第二頁後切回原頁網址正確；已有兩個視圖時用＋新增，只多一頁；關閉此網頁只移除該頁，其餘仍在。
- CUA 找到並修正：按鈕文字對比、展開圖像被控制列覆蓋、錯用全域selected URL、隱藏分頁收到新增訊號重複開頁、收合後仍輪詢、操作送出時未即時鎖按鈕。最後補上的 sending 鎖以程式檢查／建置確認，仍交 Opus 做快速互動複查。
- 初始畫面是 1024×768，但點擊按實際圖片大小換算；原生 browser_resize 改尺寸後後端依頁面 viewportSize 檢查。未驗證每個網站或所有原生工具。
- 沒有真帳號登入，沒有原生模型在這輪操作瀏覽器。『同頁交回 AI』本輪確認控制權切回與頁面保留；真正 Claude/Codex 模型接續同頁仍待下一輪隔離驗收，不能把 mock 或畫面驗收當成已完成模型路徑。
- 正式 browser-mcp.json 不存在，正式後端未重啟。這是已實作、局部真實 UI 驗證，仍待 Opus 複查，不是正式上線。

## 程式範圍
- src/browser-live-session.mjs：共用 context、loopback控制服務、人工接手與頁面操作。
- src/browser-mcp-stdio.mjs：公開 contextGetter 接線、工具互斥與程序關閉；既有檔案防護保留。
- src/browser-live-proxy.mjs、src/desktop-server.mjs：目前對話限定的認證代理；只有 image blob 新增於 CSP，沒有放行外部 iframe。
- src/desktop-controller.mjs、src/claude-controller.mjs：browserAccess sessionKey 對應目前真正 profile，不回傳token。
- frontend/browser-panel.jsx/css、frontend/main.jsx：多分頁、真實畫面、人機控制。
- test/browser-live-session.test.mjs、test/browser-live-proxy.test.mjs：接手競態、認證、舊對話、原生工具拒絕及清理。

## 交給 Opus 的下一輪
先重跑完整測試／讀 diff，特別查舊對話／切換頁面、hidden分頁新增一次性、接手中的AI工具互斥、context關閉無殘留；確認不擴張檔案讀取權限。三個原生上傳負向案例無須重跑。
再以新的隔離會話測真正 Claude／Codex 各一個短回合：先只讀本機無帳號測試頁（不得真網站登入），對照右側同頁；人工接手期間工具應被拒，交回後讀得到原欄位內容。若不允許目前環境操作或無法驗證，記錄未驗證並交回，不以直接修改狀態代替，不自行正式啟用。
右側操作目前是定期快照，不是原生 WebView；原生密碼管理器、檔案選擇器、CAPTCHA、瀏覽器安全警告接手仍未驗證。關閉右側分頁檢視不會關閉原生頁面，使用「關閉此網頁」才會關頁。

## 最終本機驗證
- 完整測試 319/319 通過，0 失敗；紀錄：.runtime/browser-live-final-tests.log。
- build:ui 通過；僅有既有大型 bundle 提醒。
- 隔離驗收頁已關閉，47845/47846 測試服務已停止；沒有啟用正式瀏覽器，也沒有重啟 47831 正式後端。

