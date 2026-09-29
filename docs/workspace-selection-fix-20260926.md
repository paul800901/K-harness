# 工作區封存與原生資料夾選取（2026-09-26）

## 授權與範圍
使用者允許接通其親自選定資料夾，先做假資料驗證，修好後更新並啟動正式 K。不得開放整顆磁碟、登入資料或人類控制入口。

## 已定位與修正
- 封存工作區原本只更新側欄；現在封存目前工作區會切回首頁，不停止其他聊天室。
- 隔離版曾以固定路徑字串冒充資料夾選擇器結果；改回 Windows 原生選擇器及明確物件契約。
- 每次啟動原本會把已封存的預設工作區重新顯示並覆蓋名字；現在只為初次登錄設定預設名稱。
- 沒有未封存工作區時，新對話不再默用隱藏工作區；提示先選資料夾。

## 執行與隔離修正
- 新增的資料夾必須真的成為 Claude／Codex／Luna 的工作目錄，且只對閒置隔離 slot 套用該工作區規則。
- 啟動準備中取消，必須等準備完成後才回收 slot，避免取消後還啟動程序。

## 驗證證據
- `.runtime/workspace-fix-20260926/archive-home.png`：以假資料伺服器、實際介面點選封存後，側欄無工作區、主畫面首頁、舊訊息消失。
- 沒有工作區點新對話，只顯示選資料夾提醒。
- sandboxie process/pool + navigation focused 27 項通過，新增空工作區測試後 navigation 8 項通過。
- UI build 成功，只有既有 chunk 大小提示。


## 最終結果：2026-09-26 04:19 正式上線
- 487/487 循序全套通過：`.runtime/workspace-fix-20260926/regression-final.log`。新 owner adapter/launcher focused 16/16。
- 真 Sandboxie、真 Node 假資料 A→B→A：中文與空白工作區 cwd 正確，直接寫入選定宿主資料夾成功；假 cookie、junction、已授權工作區內的假秘密檔均 EPERM；受保護唯讀子目錄寫入 EPERM；47831 人類入口 EACCES。證據 `live-workspaces.json` 與 `live-probe.mjs`（同證據目錄）。没有啟動模型回合、沒有讀真 cookie／金鑰。
- 保留所有既有 ClosedFilePath/ReadFilePath，只替換閒置 slot 的單一已登錄工作区 OpenFilePath；其他 slot 不改。新增及選擇仍需 owner cookie，不開放整顆磁碟、個人 HOME 或受保護目錄。
- 原生程序查詢工具對中文路徑截斷；改為專用 PowerShell helper 經官方 SbieApi_QueryConf Unicode 入口讀取有效設定。使用 NO_EXPAND/NO_TEMPLS，保留 DOS 路徑及全域規則以便比對；INI 原 UTF-16LE BOM 保留，單元測試涵蓋中文與 encoding。
- 正式 47831 後端 PID 23084，由既有系統匣啟動器 04:19:02 啟動，04:19:04 ready。health 為 isolated，未驗證 cookie 直接請求首頁仍 403。
- 真正 Chrome 正式頁面讀回：尚無工作區、首頁、沒有舊訊息；已封存私人工作區不復活。截圖 `formal-home.png`。
- 正式「新增工作區」點擊後，確實由正式後端啟動 trusted `pick-workspace.ps1` STA 程序（PID 24720）。重新整理取消後，該程序結束、按鈕恢復，沒有絕對路徑錯誤。
- 限制：本工具當輪不能操作 Windows 原生對話框，因此未代使用者完成正式原生視窗的選取按鈕。其回傳契約／新增登錄／兩家與 Luna cwd 路由有測試，真隔離讀寫另以上述假目錄驗證；不冒稱此輪已用兩家真模型跑新選目錄。

## 修改檔案
- `frontend/main.jsx`：封存當前工作區回首頁、空工作區的新對話提示。
- `src/desktop-server.mjs`、`src/isolated-desktop.mjs`：真 picker 契約、owner 選定資料夾驗證與登錄、動態 cwd、不復活已封存工作區。
- `src/isolated-launcher.mjs`、`src/sandboxie-workspaces.mjs`：owner 工作區授權及 Unicode 有效規則讀回。
- `src/sandboxie-pool.mjs`、`src/sandboxie-process.mjs`：啟動前準備與取消的 slot 生命週期。
- `scripts/query-sandboxie-workspace.ps1` 新增；既有 `scripts/pick-workspace.ps1` 補入 trusted runtime（原正式缺漏）。
- 對應 isolated-desktop/launcher、desktop、sandboxie-workspaces/process、navigation 測試。

## 失敗紀錄與復原
- 初次全套於代理尚在建立 export 時執行，475/476、1 個 import 失敗；非最終結果。最終循序全套487全部通過。
- 第一次 live probe 因 INI UTF-16LE 與 UTF-8 假設不符而拒絕；第二次因 SbieIni 非 Unicode 輸出截斷拒絕，測試腳本 stdin 未攔錯而提前結束。沒有啟動模型。保留 interrupted-probe-config.bin；已精確移除該次臨時假路徑規則、恢復原預設後再測。
- 最後 probe 完成後原始 INI 位元組還原並 reload；未留下 workspace-check 規則。原8個金鑰封鎖規則仍在。
- 正式檔案修改前已備份至 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\workspace-update-2026-09-25T20-18-30-563Z`。部署 receipt 為 `.runtime/workspace-fix-20260926/deployment.json`，183個 runtime/helper/UI 檔逐一位元組相同比對。既有 UI 舊資產未刪除，未移動任何登入資料、未刪除舊聊天室。
- 此輪未新增套件、帳號或其他系統設定；修改限制於已授權的選定資料夾及既有 Sandboxie slot。
