# 縮放分頁截圖畫布修復（2026-09-27）

狀態：**00:43 已備份更新正式模組，K 保持關閉，待使用者開啟重測。** 原始問題見 [交接文件](browser-screenshot-zoom-canvas-handoff-20260927.md)。

## 差異與根因

本輪產品只改 `src/electron-browser-views.mjs`。不改原生視窗縮放、尺寸等待／讀回、輸入命中、隔離政策、前端或登入資料，不安裝套件。

1. Playwright 以 CSS 尺寸建立截圖區域，但目前 Electron 原生 zoom 下 CDP 擷取採用縮放後座標。相同假頁與 793×832 面板、1280×800 viewport，原版 CSS PNG 實際為 **2065×1290**、device 為 **1280×800**；這次有固定 before/after 證據，不只是推測。
2. 捲動座標也須轉換：只縮 width/height 的中間版本，雖通過初始截圖尺寸，捲動後仍裁錯位置。主代理目視連拍圖發現上方角標消失、下方空白；最終使用已轉換的 document clip，避免 Playwright 再加未縮放 scroll offset。
3. 原生實體像素取整，使單純 clip 轉換仍有 1–2 px 誤差。保留 Playwright 原有截圖準備與 PNG 擷取，以隔離 JavaScript world 的離屏 canvas 校正到指定 CSS 尺寸，支援 PNG／JPEG／WebP。擷取本身維持 CSS 解析度，不先降成 device 低解析度再放大；不修改可見 DOM、頁面 zoom 或視窗尺寸。
4. zoom=1 直接沿用原始 screenshot。device 模式只轉換擷取範圍，保留實體解析度；CSS 模式输出要求的邏輯尺寸。檔案路徑、fullPage 及明確 clip 亦走原截圖準備流程。

## 實際驗證與失敗歷史

證據根目錄：`D:\K-harness\.runtime\screenshot-canvas-20260927`。使用已安裝 Electron、Playwright MCP 與本機假頁，沒有外部網站、登入或真模型回合。

- `before/runner.json`：原版同一路徑留白重現；來源 SHA256 `49DD81636FCDFADCD64049E3726C228A53008F446FB0E1D982FFE875998D3F6D`。
- `after/runner-attempt1.json` 等中間結果：clip-only 1279×798；直接 CDP fractional／rounded clip 分別 1280×799、1280×801，未採用。
- `after/runner-attempt2.json`：初始尺寸正確，但連拍僅驗尺寸漏掉捲動裁錯；已撤回該輪完整通過說法，保留圖檔。
- `after-attempt3/runner.json`：新增每張連拍四角色塊／client bounds 斷言後通過，主代理另行目視檢查。
- 最終證據以 `after-final/runner.json` 為準：精確 CSS 1280×800、device 793×496、背景未顯示頁 1024×768；PNG／JPEG／WebP、搜尋輸入與按鈕、捲動後連結命中、逐張四角檢查、連拍無 retry。WebP 用 renderer 解碼驗尺寸，不用不支援 WebP 的 Electron nativeImage 當空圖。
- 右侧約 24 CSS px 的灰白窄條已由主代理圖像確認是原生捲軸，不是本次大片空白缺陷；驗證區分 client area 與整張圖。

## 正式狀態與限制

使用者本輪已再次授權停止後直接套用。部署前核對正式服務／程序為零，備份既有正式模組再覆蓋，來源／目的地及備份 hash 讀回；不動對話與設定。

最終凍結來源 SHA256：`AEC445F233FF86AEDD5E9ABDADE6A3B320654DE80D2A118B5FD0CC6BA2F6D67B`；`after-final/runner.json` 與正式檔案相符。最終循序完整回歸 **552/552**，138.84 秒，無失敗／略過，證據 `full-regression-frozen.txt`。前兩輪回歸亦通過，但不拿修改途中結果冒充最終凍結版。

2026-09-27 00:43:39 正式程序／47831 listener 為零後，僅更新 `trusted-runtime/src/electron-browser-views.mjs` 這 **1 個模組**，來源、備份與目的地指紋均讀回。正式 K 保持關閉供本人重測，未重送原工作或啟動模型。

備份：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\screenshot-canvas-backup-20260927-004339`。其 `receipt.json` 保存 Source／Destination／Backup／OldHash／NewHash；還原時先正常停止 K，只將該 Backup 複製回 Destination 並核對 OldHash，不刪除資料。部署證據為本輪證據根目錄 `deployment-result.json`。

候選假頁通過不等於真網站或真模型正式驗收。既有間歇截圖逾時不能以本輪少量成功宣稱完全根治；Google 驗證、帳號登入、人工接手、下載／上傳不在本輪範圍。未針對非 100% Windows 顯示比例另做硬體驗證；本輪是指定 793×832 面板／1280×800 視口重現。
