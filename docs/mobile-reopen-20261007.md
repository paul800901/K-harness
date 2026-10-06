# 手機重開誤顯示配對頁補修（2026-10-07）

## 本人要求與可觀察結果

本人確認只從 Android 最近使用的 App 滑掉 K 或返回主畫面，並未使用設定底部的「登出此遠端裝置」。只供自己的手機使用，希望直接連線，不應每次關閉都重新輸入金鑰；同意在電腦備份金鑰。這不是多使用者登入產品，也不把個人 App 保存金鑰一概禁止。

本次保持現有 PWA，不另建 APK。驗收以已配對手機滑掉再開直接進 K 為準；電腦及假資料瀏覽器結果不冒充實機驗收。

## 已證實與未證實

- 正式 remote-sessions 持久紀錄及原配對設定保留，現存兩筆登入尚未過期。這只能證明伺服器仍保存有效紀錄，不能從中辨識手機有沒有帶上自己的 Cookie。
- 以獨立持久設定檔、真 Chromium、HTTPS、真 K 認證及假身分重現：配對後完整關閉／重開瀏覽器可進入；從外站連結第一次 GET / 沒带 Strict Cookie，會顯示配對頁，但頁內同源 GET /api/sessions 為 200，表示原登入仍有效。頁內 location.replace('/') 可恢復，不需重輸金鑰。
- 這是已證實的入口缺陷；目前 USB 未連入，尚不能斷言它就是本人 Android 這次問題的唯一根因。

## 最小修改與不變條件

- src/remote-access.mjs：配對頁 pageshow 時只做一次既有 GET /api/sessions（no-store）；成功才回固定首頁。403、503、斷網保留原表單，不自動送金鑰、重試工作或操作帳號。
- 不改 Cookie 的 Secure／HttpOnly／SameSite=Strict、365 天與每日續期，不改原金鑰、既有登入／撤銷、來源檢查或操作去重；不新增 API、資料庫、框架、輪詢或設定。
- test/remote-login.test.mjs 補瀏覽器 window fixture 與初次／恢復頁面測試；test/remote-reopen-ui-probe.mjs 是需本機現有 Chrome／測試憑證的手動整合探針，不列為跨平台 CI。
- 依本人要求，將既有金鑰以獨立文字檔保留於正式 vault/private-state/.local/phone-access-key.txt，寫入前核對與正式設定雜湊相符，寫入後完全讀回比對。沒有更換／撤銷登入；明文不進聊天、日誌或 Git。此備份隨私人資料原地保留，不依附工程 worktree 或程式退版。

## 驗證與失敗紀錄

- 基線探針 probe-3tOkNb 已重現入口錯誤；修正探針 probe-dculRB 通過：一度配對後程序重開、跨站入口自行恢復，只有一次登入 POST；主動登出後重開仍停配對頁，無工作／設定／帳號 POST 或頁面例外。全為假身分與假資料。
- 最早探針缺少 Playwright：發現既有 node_modules junction 指向已不存在的另一 worktree。先保留該 junction，再連至現存正式相依；鎖檔一致，沒有安裝套件。首次保存 junction 因目標父目錄缺失失敗，建立本次證據目錄後完成。
- 基線探針第一次普通 reload 不能恢復、第二次測試 APIRequestContext 的假網域解析失敗；改成頁內同源導航及頁內 logout 後成功。失敗產物保留，不當成產品已驗收。
- 首次完整測試 906/908：兩個舊登入測試的 VM 缺 window，新增 pageshow 後觸發 ReferenceError。補齊測試環境並增加 2 條行為測試；定向 12/12、補修後完整 910/910 通過（46.40 秒）。
- 真正 Opus 5.5（claude-opus-5-5）唯讀複查 session 40a35020-a3fe-4d31-ac99-8b439017a419，沒有發布阻擋；認可既有認證一致、關閉中 503 不導頁、登出不恢復及無寫入重播。採納輕量自動回歸建議，不為未觀察的導航循環增加 storage 旗標；Android 仍待實機。

工程證據留在 Git 排除的 .runtime/remote-reopen-20261007/；不提交真人畫面、帳號、Cookie 或金鑰。

## 部署狀態

僅本機修正，正式仍是 9bb71b4e562b36ed4f89b896151d1110139e8b29。正式閒置讀回 busy=false、執行工人 0／無待確認、無忙碌聊天室；未送工作、未恢復目標或重查 Gemini 額度。待完整驗證、固定候選及本人正常停止後套用；原對話、帳號、手機登入及電腦金鑰備份須原地保留。東區不動。
