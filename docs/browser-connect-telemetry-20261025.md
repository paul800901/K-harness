# K 瀏覽器助手連線進度與失敗原因回報（2026-10-25）

## 起因

10-25 上午 K 專用 Chrome 的無痕連線連續兩次逾時（Gemini 一次、Opus 一次），一般模式正常，「允許在無痕模式中執行」原本就開著。K 只得到「90 秒逾時」；真正的錯誤只顯示在背景的擴充連線頁上，K 和 AI 都看不到。本人在 `chrome://extensions` 按 K 瀏覽器助手「重新載入」後恢復，Opus 隨即實測無痕連線與 Google 搜尋（未登入狀態）正常。重新載入清掉了擴充錯誤清單與連線頁，根因已查不回來。

本人要求根治：「既然是 K 專用瀏覽器，當然要能完整回報修理……手腳必須遍布傳感器，這樣才好修復，類似特斯拉的車那樣。」並確認回報不能造成變慢等副作用。

## 做法

連線流程不變：K 開本機 WebSocket → 原生訊息請擴充在一般視窗開連線頁 → 連線頁請背景程式建立分頁 → 背景程式接上 `/extension/<nonce>`。新增三種回報：

1. **連線頁進度旁路**（`browser-extension/source/ui/connectReport.ts`、`connect.tsx`）：連線頁通過本機位址檢查後，另開 `/status/<nonce>`，依序回報「連線頁已開啟（擴充版本）」「等待擴充背景程式驗證連線要求」「等待擴充背景程式建立無痕／一般分頁並接上」，失敗時回報錯誤原文。盡力而為：開不起來、送不出去一律略過，不重試、不影響連線。
2. **K 端接收**（`src/chrome-extension-context.mjs`）：只接受同一 nonce、擴充 origin、本機來源的一條旁路。連上前收到失敗原因就立即以「K 瀏覽器助手回報連線失敗：…」結束，不再等 90 秒；逾時訊息附「最後停在：…」與重新載入擴充的提示，完全沒有回報時說明可能是連線頁沒開或舊版擴充。旁路自己出錯或關閉不會中斷主連線。擴充主連線關閉時保留關閉原因（例如所有分頁都被關掉），放進之後指令的錯誤訊息。
3. **原生開頁失敗附步驟**（`browser-extension/source/nativeConnection.ts`、`src/chrome-native-connection.mjs`）：擴充只回固定步驟名（驗證連線要求／讀取 Chrome 視窗／檢查無痕權限／開啟連線頁失敗，或「無痕模式未允許」），仍不回 URL、relay、nonce 或 Chrome 例外原文；K 把它與 native host 自己的錯誤顯示出來。

擴充版本 0.1.4 → 0.1.5。回報只在建立連線那幾秒、本機傳幾則短訊息，連上後的網頁操作不經過旁路。新舊版本混用時：新擴充＋舊 K 的旁路被 403、略過；舊擴充＋新 K 沒有回報，逾時訊息照舊說明。

## 驗證

- `node browser-extension/build.mjs` 成功。
- 目標測試 36/36；完整 `npm test` 1941/1941。
- 新測試：旁路回報錯誤立即失敗、逾時附最後步驟、無回報的逾時說明、旁路錯誤 origin 與第二條連線 403、旁路收到無效 UTF-8（伺服器端 `error`）與關閉後主連線指令照常往返、主連線關閉原因帶入錯誤、原生失敗回覆只含步驟名且不含 URL／nonce、`connectReport` 的排隊／依序送出／關閉／例外吞掉／路徑不符不連線。
- 突變驗證：拿掉旁路的 `error` listener 後「旁路出錯不崩潰」測試失敗，補回通過。

## 分工與複查

- Flash 3.8（high）依 Opus 規格實作與補測試；第一次派工因 K 查詢 Gemini 模型目錄逾時、未啟動模型工作（工作樹確認無改動），以新工單重派一次完成。
- Opus 逐行複查後修正：
  - **必修**：K 端旁路 WebSocket 沒有 `error` listener，`ws` 套件在無 listener 時會把 `error` 當未處理例外丟出，可能讓 K 程序崩潰；補上並以突變驗證的測試覆蓋。
  - `connectReport.ts` 同一事件以 `onX` 與 `addEventListener` 各註冊一次、佇列與狀態旗標重複，精簡為依 `readyState` 送出或排隊。
  - 擴充原生失敗句與 K 外層句重複（「無法在背景建立連線頁：無法開啟連線頁（…失敗）」），改為擴充只回步驟名。
  - 斷線訊息與狀態字串整理成單一 helper；原「旁路關閉不影響主連線」測試沒有實際驗證主連線，改寫為旁路出錯關閉後仍能往返指令。
  - 還原建置產生、只有換行差異的 `browser-extension/extension-protocol.cjs`。
- GPT-6.1 Sol（high）收尾複查 `4d1369a`，1 項必修，屬實已修：
  - 擴充送出 `extension.initialized`、Playwright 還在 `connectOverCDP()` 時，擴充帶原因關閉主連線（例如 `All controlled tabs detached`），K 會切斷 CDP，外層卻只拋出 Playwright 的通用「已關閉」錯誤，遺失原因（Sol 以真協定＋Playwright 重現）。修正 `5f8b7e0`：建立連線失敗時若已有擴充關閉原因，改回報該原因；新增依真實順序（CDP 已開 → 擴充帶原因關閉 → K 切斷 CDP → 才拋錯）的測試，連跑 5 次通過，改回原碼則失敗。
  - 其餘面向 Sol 未發現阻擋問題：`ready()` 在收到 `extension.initialized` 時完成，初始化後晚到的旁路錯誤不會誤殺已建立的連線；旁路未被主流程等待；旁路有 `error` listener；新舊版本混用不阻斷；主連線條件未放寬、旁路要求同 nonce／擴充 origin／本機且只收一條。
  - 修正後完整 1942/1942。
- Sol（medium）複核 `5f8b7e0`：可部署。以真協定＋Playwright 確認原路徑改回報 `K browser extension disconnected: All controlled tabs detached.`；`connectBrowser` 自身逾時、`contexts()` 為空時保留原錯誤；`stop()` 自行終止不產生關閉原因。計時器與斷線競速 12 次中 9 次保留 Playwright 通用錯誤，來自初始化後 90 秒計時器關閉橋接的既有行為，非本批新增。

## 部署

程式版本 `5f8b7e058aaca6cf0b440d50a42440c610d34da8`，已合回 `main`。因另一聊天室（desktop-control）同時改 K，依多房規則不寫更新標記，由後完成的一方 rebase、統合驗收後寫標記，本人按一次「更新」兩批一起部署（已留協調訊息）。擴充變更的部署步驟：K 外 `Update-K.ps1`（或本人按「更新」）建置正式 runtime 的擴充 → 執行 `scripts/Setup-K-Browser.ps1` 把建置複製到 `installed/k-browser-assistant`（先備份、重套同一 native host 登記）→ 本人在 K 專用 Chrome 擴充頁按「重新載入」→ 讀回擴充版本 0.1.5 並實測一般／無痕連線。

## 未完成

- 真 Chrome 實測尚未進行。
- 10-25 無痕卡住的根因仍未知；下次再發生時，新的回報會指出停在哪一步。
- 東區未更新。
