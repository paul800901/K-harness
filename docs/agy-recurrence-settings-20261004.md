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
- 正式套用將沿用現成 `selected-cores.json`／`selectedCoreExecutables`，只加本機 Gemini 選用項；Codex／Claude 不變。程式檔保留原處、不覆寫其他安裝，不新增核心尋找器、重試或常駐診斷。
- 本次暫時使用 Node 本機除錯連線取得限定檔案狀態及版本；不傾印程序記憶體、憑證或對話，收尾關閉連線及監聽。

## 前端變更與測試
- `frontend/main.jsx`：共用 Modal 標題列保留在外，錯誤及內容放進 `.modal-body`。
- `frontend/style.css`：只有開啟的 dialog 使用縱向排列；header 不縮小，body 自己捲動，關閉 dialog 不會被 CSS 強制顯示。
- `test/modal-scroll-ui-probe.mjs`：使用建置後真 Chrome、四個假帳號。舊版先重現「X 隨捲動移走」失敗；修後 1920×1080／100%、1366×768／125%、800×600／100% 通過，捲到底後 X 仍固定、能關閉並回到原焦點；Esc、背景點擊與短版額度視窗正常。
- 來源完整測試 **691/691**、0 失敗／跳過。新 Modal 真瀏覽器測試通過；既有額度版面、訂閱設定及 Gemini 多帳號 UI 回歸另行跑過。正式額度／更新／聊天室驗收待部署後補記，不把假資料畫面當正式成功。

## Opus、部署與發布
- 真正 **Opus 5.5** 已只讀複查（session `c12cb39f-3fb5-4182-adb1-2cab3f742f27`，官方 Claude 訂閱，回传模型 `claude-opus-5-5`）：判定最小修法足夠、無必修，可部署但須完成正式一般桌面啟動驗收。採納：只增 Gemini 相對路徑／1.2.16／previous=null，保留其餘兩核心；備份選用檔並標明副本不可清理；確認登入不是第二個重新導向問題。同失敗程序的 `/usage` 已先通過，正式仍另驗。其焦點外框可能裁切建議非阻擋項，不擴張修改。
- 本機修正尚未選入正式核心；前端未部署、未 push、未建立新 tag。正式套用前核對所有聊天室／工人／核准／登入均閒置，保留舊程式及核心選用紀錄。
- 四個帳號與原使用帳號不更換；東區不動。二進位檔、本機路徑選用、帳號與對話均不得提交 Git。K 專用核心副本不可當暫存清理；程式退版可保留修好的核心選用。若另還原舊核心選用檔，會回到已知 ENOENT，不把這稱為可用退路。
- 證據：維護工作樹 `.runtime/agy-recurrence-settings-20261004/`；真 UI 截圖及讀回 `.runtime/modal-scroll-ui-probe/`。
