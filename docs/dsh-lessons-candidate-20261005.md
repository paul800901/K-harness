# 原生檔案差異與背景完成驗收及部署

本批只修既有檔案差異入口，並補跨聊天室背景完成回歸。候選驗收後依本人要求停在部署前；使用者後續回覆「關掉了」，才重新確認已停止並接續部署、正式讀回與私人 GitHub 推送。未強制停止工作。

## 現況與範圍

- 固定程式版本：`7e2a8593c846e4ea81d3fa431b67d2178ea577e9`。
- 來源工作樹：`C:\Users\Paulus\.codex\worktrees\modal-focus-fix\K-harness`。
- 完整建置候選原位置：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\prepare-dsh-lessons-7e2a859-zip`；驗收後已移入同層 `trusted-runtime`，相依套件實體化修正見下節。
- 南區正式程式已由 `35de2b5d7a106bbde9a0859bcd75e3380305e2a1` 更新為 `7e2a8593c846e4ea81d3fa431b67d2178ea577e9`，正常入口重開、正式讀回與程式 push 已完成。未打 tag 或更新東區。
- K 固定正體中文。不引入多語言、工具卡片、外掛平台、自有代理核心、資料格式、設定或人用操作。

## 根因與最小修改

Codex 對話重開時會清空 `turnDiffs`，再從原生歷史還原 `tools[].patchChanges`。原成果面板內外兩層均依 `turnDiffs` 決定是否顯示差異，因此已還原的檔案變更仍看不到。修前建置版的 Chromium 探針確實讀到 `.native-diffs` 為 0，預期為 1。

1. `frontend/main.jsx`：同一個 `hasNativeDiffs` 同時檢查回合差異與工具差異，供內外兩層條件使用。
2. `frontend/native-ui.jsx`：原生差異維持唯讀，顯示進行中、已完成、失敗、已拒絕與狀態未知。只有工具差異時，不再同時說尚未收到差異；文案明示歷史狀態不代表目前檔案內容。
3. `test/desktop-native-events.test.mjs`：固定原生格式歷史重開兩次，四種狀態與差異保留，回答不重複，也不送新回合。
4. `test/conversation-native-regression.test.mjs`：Codex／Claude 的 A 在 B 顯示期間完成，保持 B 畫面與內容，完成通知不重計，回 A 只有一答且不重送。
5. `test/native-diffs-ui-probe.mjs`：操作真正建置後介面；僅假 API，檢查差異入口、狀態、review 開關、既有回合差異與其他供應商不臆造資料。

本機已選 Codex `0.160.0` 的 `app-server generate-json-schema` 確認 `FileChangeThreadItem.status` 必填，列舉為 `inProgress/completed/failed/declined`。這是純本機協定輸出，沒有呼叫模型。因此未為假想的缺失欄位修改 controller 或新增保存狀態。K 暫時產生的 `running` 只對應為進行中，其餘未知值不當成完成。

## 驗證結果

- 來源定向測試：46／46。
- 來源完整測試：800／800。
- 來源及乾淨候選的差異 UI：1920×1080／100%、1100×760／125%、900×700／150%，三組均通過；包含不同主題、patch-only、review true/false、四種原生狀態、K running、未知狀態、純回合差異、無差異保留 review、Claude／Gemini 空差異。零 POST，沒有核准、重送或寫入。來源畫面已目視。
- 來源及乾淨候選的既有完成提醒 UI：各三組通過。
- 候選 UI、瀏覽器擴充、桌面啟動器三項建置成功；沒有執行候選啟動器或連接正式 K。
- 候選完整測試：800／800。
- 候選 497 個 Git 追蹤檔與固定程式版本讀回一致；489 個文字檔只需正規化 CRLF 比較，實質差異為 0。
- 沿用本機已安裝相依套件與 Chromium，沒有安裝套件、換核心或改全域環境。

以上是部署前的隔離假資料、原生 controller／協定及真正瀏覽器驗證，不是假資料冒充正式模型回合。本批沒有讓 Codex／Claude／Gemini 對真實工作檔案執行改寫；正式啟動與資產讀回另列於下節。

## 真正 Opus 5.5 複查

設計階段經兩輪真正 Opus 5.5 討論，撤回工具卡片最高優先與外掛平台改造，只保留本批兩項。程式複查沿用 K 專用 Claude Code `2.1.289` 與已核對的 firstParty Claude.ai 訂閱，assistant model 為 `claude-opus-5-5`，session `0e93d8be-1b72-4f1f-9ba4-c73796346769`，正常結束且回傳 success。

Opus 僅使用 Read／Glob／Grep 閱讀程式資料包，沒有改檔或執行測試。結論為沒有阻擋項目、沒有過度設計；肯定共用顯示條件、原生狀態優先及未知不當完成。它提醒歷史 inProgress 可能保留、patch 標題沒有回合分組，均屬現有呈現界線，不要求擴大本批。核可不代表授權部署。

## 失敗紀錄與未驗證界線

- 首轮新增測試先遇到測試假設問題：Codex 完成提示需等待既有最終工人讀回；改為等待 fake host 的 promise 鏈結束。Claude 的重複完成測試改為只重送 `result`，不憑空重播整份 assistant 輸出。本批不宣稱已處理所有原生串流重播。
- 額外執行舊 `conversation-navigation-ui-probe.mjs` 時，其硬編碼瀏覽器位置與舊 SSE 格式不符合現行測試環境；在一次性驅動中對齊後，刻意拖住 `/api/send` 回應期間切 B 仍逾時。以原正式 `35de2b5` 重新建置，亦在同一位置逾時，非本批新增回歸。未修改這支舊探針或擴修「送出請求尚未回應時的切房」；不用它宣稱全情境通過。已驗證的是原生工作開始後的 A／B 隔離，以及既有完成提醒介面。
- Windows tar 解出中文檔名失敗；該不完整候選及中止的測試紀錄原地保留，不可部署。改用 UTF-8 ZIP 解出並完成 497 檔讀回的是上列 `-zip` 候選。沒有刪除失敗證據。
- 歷史 `inProgress` 如實保留為進行中，畫面明示依原生紀錄；不推估目前是否仍執行。正式線上原生事件順序與不同電腦仍未另驗；本機正式視窗／服務／資產讀回已完成，未用真人對話送新回合來驗證差異。

## 2026-10-05 南區正式部署與發布

- 部署前確認 47831 未監聽、沒有 K 後端／Electron 工作程序，正式版本仍為 `35de2b5`；維護工作樹乾淨，私人遠端 `0e78803` 是本批祖先，沒有合併或覆寫別人的新版本。
- 15:53 套用固定程式 SHA，497 個 Git 檔再次比對一致，含建置產物共 517 個程式檔讀回一致。替換前後 344 個既有保護檔、四帳號身分及目前帳號一致；語音、Node 與其他本機設定保留。
- 前版程式、啟動器與設定保留於 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791186810581`，代表性前版檔案已比對。這是程式退版，不是對話資料備份／還原。
- 第一次正常啟動失敗：候選 `node_modules` 為連到 `D:\K-harness\node_modules` 的 junction，Electron 真實路徑超出 `trusted-runtime`，既有安全檢查正確拒絕；單純建置／假資料 UI 未涵蓋這項安裝條件。未放寬檢查或改用其他啟動方式。
- 將該 junction 移到本次部署證據目錄保留，從同一套既有相依套件複製 38,818 個實體檔到正式程式內，robocopy 零失敗／零不符，Electron SHA-256 一致。沒有下載或安裝套件，沒有變更程式 SHA、原生核心、憑證或全域環境。
- 實體套件下加跑正式目錄完整測試：799／800；唯一失敗是既有 `isolated-launcher.test.mjs:35` 一律假定候選根等於程式根，未涵蓋正式資料夾名 `trusted-runtime` 必須取上層的既有分支。該測試及實作與前正式版本相同，未修改或冒稱通過；來源及一般候選目錄原有兩次 800／800 仍屬不同驗證環境。實際正式啟動以下列讀回驗證。
- 15:56 經原 `Start-K-Desktop.ps1` 正常重開成功；唯一 K 視窗回應正常，Electron 在正式程式內，health 為 native。三個 HTTP 介面資產與已驗收產物 hash 一致；未授權首頁及狀態 API 均仍為 403。
- 啟動後四帳號身分／目前帳號不變，四帳號均 authenticated／quota ready，沒有登入待處理或不明切換。344 個保護檔只有正常啟動的 Gemini 帳號額度檔更新，其餘不變；沒有發送使用者訊息或目標操作。
- 已確認 `paul800901/K-harness` 為私人儲存庫，程式以普通 fast-forward 推至 `origin/main`，遠端讀回完整 SHA `7e2a8593c846e4ea81d3fa431b67d2178ea577e9` 一致。文件收尾另提交，不改正式程式版本；不移動既有標記，東區仍未更新。

## 證據

來源證據在 `.runtime/dsh-lessons-20261005/`：修前／修後 UI、定向與完整測試、Opus 原文及 model 讀回、候選建置、497 檔核對、舊探針原版對照與失敗紀錄。候選自身 `.runtime/dsh-lessons-20261005/ui-after/` 保留候選畫面結果。

正式部署證據在 `D:\K-harness\.runtime\dsh-lessons-deploy-20261005\`：`activation.json`、替換前後保護檔比對、`dependency-copy.log`、`dependency-repair.json`、正式目錄附加測試原始紀錄、`formal-readback.json` 與 `program-push-readback.json`。首次啟動失敗亦保留在既有 `desktop-logs/launcher.log`，沒有清除失敗候選、相依連結或舊程式。K 已正常開啟供本人使用，不另建自動部署或重複檢查。
