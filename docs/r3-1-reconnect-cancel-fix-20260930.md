# R3-1 複查補修：取消重連後不再假裝已連線

## 結論

**2026-09-30 19:04 已備份並正式套用兩個控制器，K 已從原入口重開。** 來源提交 `d1fb826027cfa3ce15491ef20c2ffefcdf9d5f10`；完整測試 652/652，直接載入部署模組的三個假 host 案例 3/3，正式檔案與 health 已讀回。沒有送出真正模型工作。

依 [Opus 複查](opus-review-r3-1-20260930.md)只修取消重新連線這項缺陷；未做 Fable 介面調整、R3-2～4 清理或其他功能。使用者確認「已停止」後才更新，保留既有資料、原生權限、計費與不重送工作規則。

## 根因與最小修正

- **Claude**：open 已關掉舊 host，取消時卻整份還原前一個 ready／completed 狀態。現在仍保留原對話畫面，但已關閉舊 host 且有原對話時改成 `interrupted`，瀏覽器連線標記關閉。沿用既有 send 的恢復路徑，只有使用者下一則新訊息才重連同一 native session；取消本身不重連、不重送舊訊息。若新 host 清理失敗，原本 uncertain／錯誤處理仍保留。
- **Codex**：瀏覽器恢復會先關舊 host；一般設定重連即使重用 host，也可能已重設 items／uiTiming 等投影。這個階段取消後改成 `offline`，而不是還原成假的 ready；下一次開啟原聊天室會沿用既有恢復路徑，讀取原生歷史並 resume。沒有另外建立整套狀態快照回復機制。
- 產品只改 `src/claude-controller.mjs`、`src/desktop-controller.mjs`。沒有新增重試、檢查服務、背景重連、UI 或相依套件。測試在既有 `test/claude-controller.test.mjs`、`test/desktop-switch.test.mjs` 補三個案例。

## 驗證

證據目錄：`D:\K-harness\.runtime\r3-validation-20260930\.runtime\r3\reconnect-cancel`。

| 證據 | 結果 |
|---|---|
| `before.log` | 未修版本三個新案例 **0/3**：Claude 取消後仍 completed；Codex 替換 host／重用 host 兩條路徑都仍 ready |
| `targeted.log` | Claude、Codex 切換及 conversation controller **78/78** |
| `full.log` | **652/652，0 fail／0 skip，40.47 秒**。前版 649 加本輪 3 案例；未修改前端，不重建相同 bundle |
| 三個案例的後續動作 | 保留 threadId、訊息與取消前設定；取消時無 turn/start／Claude start。Claude 下一則新訊息重連原 session 並只送一次；Codex 下一次開啟確實 resume、讀到更新後歷史，之後只送一次新訊息 |
| `formal-tests.log` | 同樣三案例改為直接 import 正式 runtime 模組，獨立假資料 **3/3**；不是觸碰使用者的真對話。實際使用的測試副本在 `formal-tests/` |
| 正式停止／重開 | 19:02:50 confirmed close；19:02:51 正常 exit 0／stopped。19:04:28 原系統匣啟動、19:04:30 ready；tray PID 38976，owner PID 10948 |
| 正式讀回 | 兩檔 SHA-256 與測過的來源一致；47831 `/health` 為 `deployment=native`，資料位置不變 |

中途有一次只讀雜湊命令把 PowerShell foreach 直接接管線而解析失敗，沒有執行寫入；改成逐檔輸出後四個來源／驗證檔一致。初次查找假設了不存在的測試檔名，隨即依實際 test 清單定位；未改環境或建立替代工具。

## 部署與還原

- 收據：`D:\K-harness\.runtime\r3-validation-20260930\.runtime\r3\reconnect-cancel\deployment.json`，包含兩檔來源／目標／前後雜湊及 health 讀回。
- 備份：`D:\K-harness\.runtime\releases\R3-1-before-cancel-fix-20260930-190414`。要退回此補修前，正常停止 K 後，只將這兩份備份複製回收據對應的 target，核對 beforeSha256，再由原入口重開；不刪資料。
- 原 17:24 的 25 檔收據保留為歷史，其中這兩個控制器由本次收據覆蓋；其餘部署檔未改。R2／R1 留底也不動。根目錄產品來源未合併，Codex App 的 k_flash 不變。

## 驗證界線

本輪證明的是：原正式缺陷可由假 host 重現、修後兩核心的取消及下一次明確操作可恢復，且正確模組已載入正式服務。**沒有用真正模型連線中途取消，沒有在正式畫面點按，也沒有讓 Opus 再複審本補修。** 不消耗額度製造回合，不為此切走使用者前景；舊審查中模型選單／強制結束的實機觀察仍屬原未驗項目。
