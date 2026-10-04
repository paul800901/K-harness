# agy 再次失聯根因與設定固定標題列（2026-10-04）

## 結論／範圍
- 本次保留尚在出錯的正式 K，取得同程序證據後才修。前一批僅服務恢復、原因未解；不能再將從 Codex 啟動的成功當作桌面啟動驗收。
- 使用者接受執行中聊天室不能移動，維持既有拒絕移動、不停止工作。本次不增加延後搬移或執行中熱換工作區。
- 設定標題及右上角 X 獨立於捲動內容；共用 Modal 同步適用，不新增按鈕／設定。

## agy 直接根因與實測
- 原失敗程序 PID 35344，父系為桌面 Explorer → K 啟動器 → Node → Electron。它本身及其 Node 子程序皆無法存取 `C:\Users\Paulus\AppData\Local\agy\bin\agy.exe`，原始 `stat` / `spawn --version` 都回 ENOENT；cwd 存在。大小寫、斜線與長路徑寫法無改善，非字串正規化問題。
- 同時間 Codex 工具程序看得到該檔，並可執行 1.2.16。以 Windows 檔案 handle 讀實際位置，該 agy 實體位於 `AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\agy\bin\agy.exe`；一般桌面程序看不到表面的安裝路徑。這是 AppData 的封裝程式檔案重新導向，不是 Google 帳號掉線、額度用完、Git 更新漏檔或工作區搬移造成。
- 官方背景說明：[Microsoft：封裝桌面程式的檔案系統行為](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)。判斷依本機 handle 與同程序對照，不只依文件推測。
- 將同一份 Google LLC 有效簽署的 1.2.16 執行檔複製到 K 自有 `trusted-providers\gemini-1.2.16-local-20261004\agy.exe`。來源與目的 SHA-256 同為 `871e1eeb205dd3269b762e81808b7a86fe7cf73b59da51b14e3d8ac005581bfe`。
- **未重啟的同一失敗 PID** 隨即能讀到新路徑並成功執行 `--version`。同一失敗 PID 使用原帳號 profile 執行 `/usage` 也成功：每週 95%、5 小時 100%，證明不只版本能跑。未改登入、未讀／搬 Chrome 密碼或 Google token。
- 正式套用已沿用現成 `selected-cores.json`／`selectedCoreExecutables`，只加本機 Gemini 選用項；Codex／Claude 不變。程式檔保留原處、不覆寫其他安裝，不新增核心尋找器、重試或常駐診斷。
- 本次暫時使用 Node 本機除錯連線取得限定檔案狀態及版本；不傾印程序記憶體、憑證或對話，收尾關閉連線及監聽。

## 前端變更與測試
- `frontend/main.jsx`：共用 Modal 標題列保留在外，錯誤及內容放進 `.modal-body`。
- `frontend/style.css`：只有開啟的 dialog 使用縱向排列；header 不縮小，body 自己捲動，關閉 dialog 不會被 CSS 強制顯示。
- `test/modal-scroll-ui-probe.mjs`：使用建置後真 Chrome、四個假帳號。舊版先重現「X 隨捲動移走」失敗；修後 1920×1080／100%、1366×768／125%、800×600／100% 通過，捲到底後 X 仍固定、能關閉並回到原焦點；Esc、背景點擊與短版額度視窗正常。
- 來源與固定 Git 封存建出的乾淨候選，各跑完整測試 **691/691**、0 失敗／跳過。新 Modal 真瀏覽器測試通過；既有額度版面、訂閱設定及 Gemini 多帳號 UI 回歸另行跑過。正式驗收另列如下，不把假資料畫面當正式成功。

## Opus、部署與發布
- 真正 **Opus 5.5** 已只讀複查（session `c12cb39f-3fb5-4182-adb1-2cab3f742f27`，官方 Claude 訂閱，回传模型 `claude-opus-5-5`）：判定最小修法足夠、無必修，可部署但須完成正式一般桌面啟動驗收。採納：只增 Gemini 相對路徑／1.2.16／previous=null，保留其餘兩核心；備份選用檔並標明副本不可清理；確認登入不是第二個重新導向問題。同失敗程序的 `/usage` 已先通過，正式仍另驗。其焦點外框可能裁切建議非阻擋項，不擴張修改。
- 18:30 已部署固定程式提交 `fffe4266f82890742ec67e772531ff217ff80a17`。463 個 Git 追蹤檔核對一致，建置及正式資產雜湊讀回通過。先核對所有聊天室／工人／核准／登入閒置，再正常停止；第一次仍有通知區啟動器時，部署檢查拒絕，待使用者完全離開才套用，未強制結束。
- 前一版程式 `fc241a0` 保留於 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1791109828830`；核心選用備份在 `.runtime/agy-settings-deploy-20261004/selected-cores-before.json`。部署及選用核心後、重新開啟前，185 個保護檔案完全不變；四帳號身分與使用中帳號也不變。
- 四個帳號與原使用帳號不更換；東區不動。二進位檔、本機路徑選用、帳號與對話均不得提交 Git。K 專用核心副本不可當暫存清理；程式退版可保留修好的核心選用。若另還原舊核心選用檔，會回到已知 ENOENT，不把這稱為可用退路。
- 證據：維護工作樹 `.runtime/agy-recurrence-settings-20261004/`；真 UI 截圖及讀回 `.runtime/modal-scroll-ui-probe/`。

## 正式一般桌面驗收（18:36–18:40）
- 第一次工具重開仍繼承 Codex 的路徑視野，**不計入一般桌面驗收**。使用者再完全關閉並親自從桌面開啟後，確認 Explorer 12120 → K 啟動器 40224 → Node 30664 → Electron 42232；此程序原 agy 路徑依舊不存在，但 K 專用核心存在且回傳 1.2.16，未靠重開或私有環境掩蓋問題。
- 正式刷新目前帳號 API 回 200、authenticated／ready；18:40:18 官方讀回每週 95%、5 小時 98%。其他三帳號仍保留，未輪替查詢，介面如實標示上次查詢的舊資料。Codex／Claude 官方訂閱登入均正常，側欄額度也正常顯示。
- 正式「更新 Antigravity」API 及實際按鈕均回「目前為 1.2.16，沒有較新的正式版本」，不再 ENOENT、不需重啟。官方本次沒有新版，因此未宣稱實測下載下一版本。
- 使用者自行開啟原 Gemini 聊天室並送出工作；同一桌面程序由 working → completed、error=null，訊息數 11 → 12。未代送訊息、不打斷、不換帳號。以此真實原對話續接取代再開假對話；本輪未另新建正式測試聊天室，也未另派 GPT／Claude 模型回合。
- 正式設定視窗實際捲至底部：內容 scrollTop 0 → 749，X 的頁面座標 y=74.453125 維持不變；按右上角 X 後 dialog 已關閉，不必捲回頂部。原生 UI 第一次索引點擊回「coordinate input geometry is unavailable」，重新觀察後使用當下截圖座標成功；不是 K 介面錯誤。
- 使用者恢復工作後另讀回：四帳號身分及使用中帳號不變、7 個核心／設定保護檔不變、176 個既有 session 檔不變；僅本人正在使用的 Gemini 對話及共用索引兩檔正常更新，未覆寫回舊資料。
- 正式三個前端資產與部署版本 SHA-256 相符，未授權 state API 維持 403。暫時除錯監聽收尾關閉；K 保持正常執行。
- 發布標記 `k-agy-settings-20261004` 固定指向已部署程式 `fffe426`，已正常推上既有 private GitHub，遠端 tag 解參照與程式 SHA 完全一致；未 force push、未改舊標記。`main` 後續只補本驗收紀錄／索引，不改程式。標記不攜帶本機核心、帳號或選用檔，東區後續按文件核對自己的核心路徑，不複製南區登入。
- 部署／保存讀回：正式根目錄 `.runtime/agy-settings-deploy-20261004/`；桌面程序與 UI/API 限定讀回：維護工作樹 `.runtime/agy-recurrence-settings-20261004/final-*.json`。未解事項僅為未發生的新版本下載及本輪未另測的模型回合，不再把找不到核心列為未修。
