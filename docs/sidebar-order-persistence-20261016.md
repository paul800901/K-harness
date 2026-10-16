# 側欄手動排序在完整重啟後遺失

## 問題與根因

本人回報：更新三家原生核心並完整重開 K 後，聊天室順序不再是原先手排的順序，但側欄仍顯示「手動排序」。本批只修正原生桌面偏好的持久保存，不改模型核心、排序規則或對話資料。

- 前端已將排序方式、手動順序存在 localStorage；第一次沒有保存順序時，`completeSessionOrder` 會依最近活動建立初始順序，排序方式則預設為手動。
- 正式桌面卻使用 Electron 的 `k-trusted-owner` partition。沒有 `persist:` 前綴的 partition 只存在記憶體；完整退出後，localStorage 一起消失。因此重開後「手動排序」標籤仍出現，但順序已重新依最近活動建立。
- 隔離原生程序實驗重現：第一個程序寫入手動 C、A、B，完整退出後第二個程序讀到空值；持久 partition 對照組保留設定。使用本機既有 Electron 44.4.5、人工資料及獨立暫存 profile，未動正式 K 的保存資料。
- Electron 官方語意見 [session.fromPartition](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)。正式 K 的 origin 固定為 `http://127.0.0.1:47831`，不是每次換埠造成的另一個問題。

## 最小修正

`src/electron-workbench.mjs` 只改兩行：

1. 桌面 partition 改為 `persist:k-trusted-owner`，沿用既有 vault/native-shell profile。
2. 權限處理器直接綁定 `owner.webContents.session`，不另外依舊 partition 名稱取得另一個 session。保留原本的音訊、剪貼簿、相機及螢幕分享權限規則。

不增加後端排序檔、API、同步層、遷移程式或清理機制。`test/electron-close-recovery.test.mjs` 的既有 mock 補上真實 WebContents 具備的 session 屬性。

### 持久化的邊界

- localStorage 目前僅保存側欄排列方式、排序、工作區收合狀態及外觀；草稿／引用使用 sessionStorage，本批沒有將它們改成 localStorage。
- 每次伺服器啟動都產生新的驗證值。測試把前次人工服務的 cookie 送到新服務，得到 403，再由原有 bootstrap 正常進入；未讀取真人 cookie。
- HTTP 回應一律 `Cache-Control: no-store`，UI 資產檔名帶建置雜湊，沒有 service worker。測試亦讀回 HTML 的 no-store。
- **先前完整退出時已遺失的手動順序無法從本修正還原。第一次改用持久 partition 沒有舊的持久順序可匯入，需要本人重新排一次；此後才會跨完整重啟保存。** 不憑畫面或最近活動猜原先排序。
- 正常退出沿 `workbench.close()` → `app.quit()`，與本次測試一致。強制終止、程序崩潰或斷電時，最後幾秒的變更不保證保存，本批不增加同步寫入／備份機制。

## 驗證

- 新增 `test/sidebar-persistence-ui-probe.mjs` 與 `test/fixtures/sidebar-persistence.cjs`，沿既有 UI probe 入口執行，暫存由 `test/scratch.mjs` 管理。測試用隱藏原生視窗，不搶焦點、不讀真人聊天室、不呼叫模型。
- 連續啟動三個完全獨立的 Electron 程序，使用相同人工 profile 與 loopback origin；沿正常退出流程，不額外強制 flush 儲存資料：
  1. 在真正建置的 UI 點選上移兩次，把 C、A、B 寫入；完整關閉程序。
  2. 重開仍為手動 C、A、B；更新 B 的活動並加入最新的 D，既有順序不變且 D 在尾端。再明確選「最近訊息」，呈現 D、B、A、C；完整關閉。
  3. 再開仍保留「最近訊息」選擇；人工資料恢復 A、B、C 時依活動排列。
- 三次皆確認權限處理器安裝在實際 view session；音訊允許條件、相機、跨來源、定位拒絕仍有效，定位另由真實 renderer Permissions API 讀回 denied。新程序不接受前次 cookie。
- 負向驗證：只把 partition 改回記憶體，測試在第二次啟動的「手動順序必須保留」斷言失敗；保留持久 partition、只把權限掛回舊 session，測試在「處理器須屬實際 owner session」斷言失敗。修改僅限人工測試的臨時副本，正式來源未被覆寫。
- 相關單元測試 **16/16** 通過；完整 `npm test` **1689/1689** 通過，0 失敗／取消／略過。介面建置成功（既有大 bundle 提示不影響建置）。完整介面首次 **47/48** 通過；唯一失敗是既有語音 probe。獨立工作樹缺少預設語音 Python／模型路徑，只為該測試程序帶入正式設定中的既有本機 Python／模型路徑後，完整語音 probe 通過。共 48 項各有通過證據，但不把首次結果改寫為 48/48；未安裝或更動語音程式。
- 測試開發時修正了 fixture 自身的三個問題：誤用不存在的 Session.checkPermission、renderer selector 引號、誤選未開啟選單的上移按鈕。這些首次失敗不冒稱產品回歸；修正後才取得上述正向與負向證據。

本機證據保留於 `.runtime/archive/sidebar-order-persistence-20261016/`，不提交原生回覆、測試輸出或本機 profile。

## Opus 5.5 討論與複查

- 修法討論已經由真正的 `claude-opus-5-5` 完成，原生 assistant 事件核對型號，不以其他模型代替。使用既有 Claude 訂閱、唯讀討論入口，僅檢視提供的程式與實測材料，沒有要求修改或派工。
- Opus 支持兩行修法；要求處理器綁實際 session、確認正式 origin 固定、查 HTTP cache 與既有 localStorage 項目、測試舊 cookie 失效，以及兩種負向變異。以上均已逐項核對／驗證。
- **2026-10-16 10:51 +08:00 最終複查通過**：原生 assistant 再次確認 `claude-opus-5-5`，結論為可合併、正式 K 全部閒置並正常退出後可部署，沒有已知必修問題。Opus 依提供的完整 shell、新增測試、diff 與結果審查，未自行進 repo 執行測試。
- 合併前要求的全域搜尋已完成：所有 Git 追蹤內容中，產品只有本次持久 partition 宣告；另外只有一份歷史文件與既有單元測試的舊 mock 提及舊名稱／fromPartition。沒有下載、webRequest、清除或其他入口另取舊 session；未順手清理不影響本案的 mock。
- 正式正常關閉路徑使用 `app.quit()`；測試用自己的 scratch/shell，正式使用自身 vault/native-shell，隔離候選路徑由候選根目錄推導，不共用正式 profile。未將同一正式 candidate 重複啟動來驗證。
- 採納低風險建議：測試 JSON 的 htmlNoStore 改由實際回應標頭計算，而非寫死 true，並重新跑三程序重啟測試通過。重新占用相同測試 port 及 fixture 清理失敗時可能等候 runner 逾時屬測試限制；本輪無此失敗，不為未觀察問題增加機制。

## 部署狀態

程式與測試提交：`129d4f3d99acae6f4b6f25831ec85b8b9c55d837`；工程紀錄另開文件提交，一起合回 main。

**南區已部署並完成遠端讀回。** 2026-10-16 14:40:41 +08:00，與圓桌／下一輪一般對話修正一起部署 `be96457721bcade1249b6ad2b36c89a7e7f7377a`。部署前已確認 K 無程序及 47831 listener；更新與正常啟動各一次，無強制停止或重送工作。

- `.local/runtime.json` 版本與部署 SHA 一致；`previous` 的版本為 `06de7fe1247a8d33c182fa935367fad3a88f9fdb`。正式服務 `/health` 回 **200／native**，持久 partition 修正已讀回。
- 更新器完整單元測試 **1689/1689** 通過；合併圓桌修正後，部署前完整介面實測另取得 **48/48** 通過，並保留上文首次測試的歷史結果。
- 程式退版保留 **3 份**，超額最舊一份已驗證移入資源回收筒；候選根層沒有殘留 `prepare-*.zip`，未動登入或對話資料。
- 2026-10-16 14:51:48 +08:00 首次 push 成功，遠端 main 與本機 main 同為上述完整 SHA；部署收尾文件另提交，不重啟正式 K。完整讀回及本機證據位置見[同批部署紀錄](roundtable-layout-next-turn-20261016.md#部署狀態)。
- **以前已遺失的手動順序仍無法還原，需重新排列一次，之後才跨完整重啟保存。** 本次未替本人猜測或改排聊天室；東區未更新。
