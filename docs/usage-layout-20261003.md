# 額度頁分組與 Gemini 緊湊列表（2026-10-03）

## 使用者需求與範圍

- 額度與用量依 Claude → GPT → Gemini 排列，不讓四個 Gemini 大卡片把前兩家推到頁尾。
- 使用者認為現有「設定」帳號排列清楚；設定頁維持原樣，額度頁參考其分組方式。
- 僅改額度彈窗呈現。側欄、登入／保存／切換、原生權限、模型、計費、語音及對話資料均不改。

## 處理

- 三家分區加分隔線；Claude、GPT 額度留在前面。
- Gemini 每列保留帳號、目前使用、驗證狀態、每週／5 小時剩餘額度。舊資料、未登入、未確認及無額度資料仍直接顯示。
- 點帳號列展開查詢／重設時間；使用原生 details／summary，不新增設定或持久狀態。Claude／GPT 的時間與查詢說明亦可展開。
- 原本兩個同樣呼叫 `/api/usage?refresh=1` 的按鈕合成頁首一個；端點、輪詢、帳號選擇均未更動。明示只更新目前使用的 Gemini 帳號，不加總各帳號額度，不把舊資料說成即時資料。
- 未保存帳號的 Gemini 路徑仍可顯示官方單帳號額度；缺值顯示「—」、沒有重設時間不印 Invalid Date，0% 不誤判為未知。

## 修改檔案

- `frontend/usage.jsx`、`frontend/usage.css`：彈窗分組、緊湊列及展開明細。
- `test/usage-layout-ui-probe.mjs`：新建純假資料 UI 驗證與桌面／窄視窗截圖。
- `test/gemini-accounts-ui-probe.mjs`：更新三家順序斷言；以正確的 region 等待取代原本必定逾時再吞錯的文字等待。
- 本紀錄與 `docs/development-log.md`。

## 已執行驗證

- 維護來源完整測試 **646/646**，fail／cancelled／skipped 0（35,081 ms）。UI probe 另列，不灌入此數字。
- UI 建置通過；原有大 bundle 提示仍在，未為排版任務拆包。
- 新額度 UI probe：三家順序、四列及單一目前使用、桌面 1440×920 不捲動即可看完四帳號與完成鍵、滑鼠／Enter 展開收合、明細收合時仍顯示舊額度警告、0 與未知、未登入／未確認、離線停用更新、更新只打原 GET、不發帳號切換、390px 無水平溢出／可到達完成鍵、未保存帳號及無資料情境均通過。
- 主代理已實際查看桌面與窄視窗截圖；不是只讀測試輸出。假資料測試沒有登入或模型請求。
- 現行多帳號 UI probe 通過（登入／保存／取消／busy／切換等均為假資料回歸）；現行 GPT Flash UI probe 四組斷言亦通過，不新增模型工作。
- 額外跑舊 `model-picker-compact-ui-probe.mjs`：在第 212 行找已被上一批移除的「登入 Gemini 訂閱」按鈕逾時，未進到該檔最後的額度斷言。這是與本次排版無關的舊測試假設；未改設定 UI 遷就測試，也不宣稱它通過。本次新增 probe 已獨立覆蓋單帳號與額度缺值路徑。原始失敗保留 `model-ui.log`。

證據位於維護來源 `.runtime/usage-layout-20261003/`，包含 `full-tests.log`、`accounts-ui-current.log`、`ui-probe/result.json` 與兩張假帳號截圖。

## 部署狀態

已部署南區正式 K，20:20 原入口重開並完成讀回；未 push／打 tag，東區不動。

- 原正式版 `87d0ec2`；本批先套用 `cccc19b`，讀回成功後發現頁首「各帳號共用」容易誤解成跨帳號合併額度，僅改為「同一帳號的對話共用」。重新建候選、完整測試與 UI probe 後，正式最後版為 `df9bc7f339c4a82557c3cec50cdd9e3c97e221ee`。
- 第一份乾淨候選 646/646（36,020 ms）；最終候選 646/646（35,804 ms），兩者 fail／cancelled／skipped 0。最終候選新額度 UI probe PASS，主代理再次查看最終截圖。
- 使用者明確回覆「已離開並停止 K」後，兩次套用前均核對無 K 自有程序及 47831 監聽，保留程式／啟動器／設定。既有相依只複製未安裝；Codex 設定及本機語音路徑讀回未改。
- **退回本批前 87d0ec2** 的版本仍在 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791029871724`。
- 第二次套用另保留中間版 cccc19b 於 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791029991182`；這是目前 runtime.json 的 previous。兩份都是程式退版，不是對話或帳號資料備份。
- 正式服務搭配真 UI DOM 讀回 PASS：Claude → GPT → Gemini、四帳號、原帳號 A 仍目前使用、額度及收合／展開時間、設定頁四帳號。彈窗 640×741，scrollHeight = clientHeight，未需捲動。
- 正式讀回前後比較已保存的四帳號身分、目前帳號與待登入旗標，全部不變；沒有帳號／工作 POST、沒有模型回合。這次沒有重做憑證保存或切換。
- 20:20:15 原 `Start-K-Desktop.ps1` 啟動成功，PID 2968、視窗「K 執行中樞」、native health 與正式 executable 路徑正確；三個實際供應 UI 資產 hash 相符，未授權 `/api/state` 維持 403。
- 啟動外層命令因沿用 `$LASTEXITCODE` 回傳 1，但啟動腳本的實際 receipt 已成功；未因此重啟或重送，另做 served readback 全部通過，保留原始輸出。
- 隱藏 Electron 只作正式 DOM 讀回；本輪未對隱藏視窗截圖或搶前景。人工視覺檢查依實際 built UI／假帳號 Chrome 截圖，不將其稱為真帳號截圖。

正式證據在 `D:\K-harness\.runtime\usage-layout-20261003\`：`preparation.json`、`full-tests.log`、`candidate-ui/result.json`、`activation.json`、`pre-activate-processes.json`、`live-ui-readback.json`、`normal-start-readback.json`、`served-readback.json`。首次版本的 activation、完整測試與 UI receipt 另以 `first-*` 保留。

未處理：舊模型 UI probe 過期按鈕假設已如上記錄，未順手改模型／設定頁；前批官方偶發查詢未確認、首次並行派工與真耗盡接手的限制，仍依登入流程紀錄，不因本次排版宣稱解決。
