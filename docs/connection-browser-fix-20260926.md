# Claude 設定重啟狀態與瀏覽器尺寸完成讀回

## 授權與範圍
使用者提供三分頁實測回報，要求修好連線狀態及瀏覽器尺寸／截圖問題後直接更新正式 K，再由本人測試。已由系統匣正常停止，launcher.log 23:32:47 confirmed close／exit 0。沒有自動重送原任務、操作真網站、登入或繞過 Google CAPTCHA；網頁結構另存檔案的既有行為不改。

## Claude：已重現並修正
設定權限／effort 變更時，send 主動關閉舊 host；watchHost 把這次預期關閉當成意外斷線，將狀態設為 offline。新 host 仍收到工作，但新 stream_event 被 offline guard 丟棄，因此原生歷史繼續、K 畫面停住。

- `src/claude-controller.mjs`：僅舊 host 的設定重啟關閉期間標記 restartingHost，不誤改 offline；成功確認後恢復原監聽語意。
- `test/claude-controller.test.mjs`：替換 host 後 working/busy、串流回覆及 completed；真正意外退出仍 offline；close 失敗仍 uncertain 並保留原 host。
- 主代理拒絕子代理額外的全域 uncertain 忽略條件，僅保留本次根因所需範圍。獨立定向 55/55 通過。
- 不修改任何真實對話投影或原生歷史，不以修復為由自動再送工作。

## 瀏覽器：尺寸成功條件已修正；截圖根因仍有限制
- `src/electron-browser-views.mjs`：背景分頁也等待 renderer 兩次 animation frame；最多 5 秒，逾時明確失敗。讀回實際 innerWidth／innerHeight（容許原生縮放的 1px 四捨五入）才回報尺寸成功。
- view 不存在不再靜默成功；失敗恢復前次 viewport metadata、native bounds 與 zoom。不新增設定面板、不改隔離／人工接手鎖。
- 原始碼原先只有 current view 等待繪製，背景 view 設定 bounds 後就返回；這可直接確認，但不足以單獨證明使用者真網站截圖逾時的全部根因。
- 子代理早期第 2 頁尺寸未變，是測試先 resize 才 select 的錯誤，已撤回產品缺陷判斷。早期真 MCP 路徑曾得到與使用者相同的 5 秒 screenshot timeout，紀錄保留。
- 主代理用同一固定 probe 對原版及修正版比較：兩者這次均成功。因此**不能宣稱截圖問題已確定根治**，也未證實「被分頁蓋住」的推測。此次修改確認改善尺寸完成契約；真網站截圖間歇失敗仍需使用者再驗，若重現應續查，不應任意加 retry／延長截圖 timeout。

## 最終候選驗證
- `.runtime/connection-browser-fix-20260926/first-tab-final.txt`：官方 MCP new 建三頁，select 第 1 頁，不呼叫 views.show，1280×720 resize 24ms、緊接 screenshot 62ms；DOM／viewport／native bounds 同為 1280×720。
- `first-tab-baseline.txt`：相同固定 probe 載入原版模組也成功，保留反證。
- `three-tab-final.txt`：三分頁各三種尺寸，9 次尺寸／截圖讀回，另驗前背景切換與人工接手拒絕 MCP，exit 0、stderr 空。
- `bounded-resize-final.txt`：假頁面停止 RAF，resize 約 5009ms 明確回錯、不虛報成功，viewport 恢復 1280×720。
- 子代理既有 scoped candidate 14 項＋假 cookie 重新啟動讀回通過；不得當真帳號驗收。
- 中間測試語法錯、選頁順序錯與 timeout 均保留在 `.runtime/electron-first-tab-probe-20260926`，不計為通過。

## 正式狀態
最終主代理循序回歸 **552/552**，141.86 秒，沒有失敗或略過，證據 `full-regression.txt`。23:55:50 確認正式程序及 47831 listener 為零後，僅部署上述 **2 個產品模組**；來源凍結 hash、備份及目的地 hash 均核對相符。前端、ICO、對話、設定、登入、隔離政策不動。

備份：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\connection-browser-backup-20260926-235550`；receipt.json 保存 Source、Destination、Backup、OldHash、NewHash。還原時先正常停止 K，再只將這兩個 Backup 複製回 Destination 並核對 OldHash，不刪資料。

**正式檔案已更新、尚未重開驗收**。依使用者「我再來測試」保持 K 關閉，未啟動模型／重送原任務。不宣稱真模型／真網站已修後驗收。截圖間歇失敗是否完全排除仍為未完成驗收事項。
