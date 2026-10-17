# 2026-10-12 原生子代理終態與舊提示核實修正候選

## 範圍與正式邊界

本人要求：修好、驗證與真正 Opus 5.5 複查後停止，K 正在工作；等本人醒來、停掉 K 並另行通知，才升級。此批只修兩個已重現的 K 缺口，沒有部署／重啟／停止正式 K／push／排程更新，也沒有操作原翻譯聊天室或恢復、重送工單。正式版本讀回仍是 `4af4b7d2bfcbefd8772329270b6432a50f9f44a3`。

這不是上游串流故障已解決，也不是極長任務記憶偏移已證解決。服務為何回傳一般 `other` 仍未知；固定 InternalServerError 的 high-demand 字樣不能當成容量不足證据。診斷及未修的核對提示／request ID 文案另見 [同日原始診斷](stream-recurrence-diagnosis-20261012.md)。

## 直接根因與最小修正

1. **已結束子回合被留在待確認。** 前批主代理接續已接受 `systemError`，但 `native-workers.mjs` 還只接受 idle/notLoaded。現在在核實父房歸屬、最新明確終態後，systemError 也正確回傳 completed/failed/cancelled。latest inProgress 仍優先為 running；外來、缺資料、未知與讀取失敗仍不冒稱結束。背景命令停止與核實契約未放寬。
2. **同一子代理重用後，舊提示再也對不上。** 原本新 turn 移除舊派送意圖，但 warning 留著；只讀最新 turn 永遠無法精確核實舊 turn。現在只針對未核實、同子代理最新 ID 已不同的提示，重新核對來源，沿公開原生 summary/cursor 查精確舊 turn ID＋終態。查到才標 resolved；不同狀態、找不到、失敗、過期讀回仍 UNKNOWN。不用新回合成功冒充舊回合成功，不刪原始提示，不把舊工單排回工作佇列，也不覆蓋新工人的 running 狀態。
3. **停止不為純顯示核實增加等待。** 採真正 Opus 的最小建議，`workers(true)` 不額外翻舊提示歷史；必要的最新狀態／背景命令停止照舊。舊提示不抹掉，之後一般讀取仍可精確核實。

只改兩個產品檔與相應兩個測試檔；沒有新 timer、模型待命、換模、帳號切換、cache、持久佇列或人用管理控制項。每次歷史 await 後校驗同 host、房間、view/request epoch 與最新 worker read；重複 cursor 或無新 turn 進展即停止查詢。

## 驗證

- 有效 RED：52 項、49 通過／3 失敗，證實兩個缺口及新查核尚不存在。第一次 RED 的測試 cleanup 漏 restore 導致保活，僅停止自有測試，原 log 保留；修 cleanup 後才取得上述完整 RED。
- 初次 GREEN 52/52；擴充 focused 109/109；補 stop 不翻舊歷史後 **110/110**。涵蓋 systemError/inProgress/foreign/missing、精確舊 turn、錯狀態、stale read、分頁無進展、非分頁及停止後一般查核，保留既有負向測試。
- Sol 中間快照完整 1313/1313。Astra 第一次獨立全套與 Sol 時間重疊，1312/1313：既有 Chrome profile 重連 descriptor 等待測試未追上；來源與測試不變、沒有另一套同時執行時重跑 1313/1313。失敗原件保留，未改該產品／測試或放寬門檻；不能把資源競爭推測說成已證精確原因。
- 最終單一完整回歸 **1314/1314**，正常 exit 0，65.084 秒；包含最後 !stop 修正，Astra 已讀回完整結果。
- UI build 成功；Astra 用 built UI 1440×1000、390×844 假資料驗證未核實提示可見→已核實旧提示移除→另一未核實提示仍可見，新工作文字保留，零 POST／零頁面錯誤，並目視截圖。不是正式使用者聊天室 UI 讀回。
- 固定官方 Codex **0.161.0**，空隔離 home／localhost 假 Responses：兩次真原生 failed/systemError，候選分類 failed/settled；公開 cursor 精確讀回第一回合，不拿第二回合代替。自有 host 正常 code 0 結束，無正式 home、憑證或外部模型請求。此測試是 isolated **main thread、parent=null**，不冒稱真正子代理／真服務故障；子代理歸屬與重用顯示由控制式 fixtures 驗證。

## 真正 Opus 5.5 與 Astra 驗收

官方 Claude Code 2.1.294／claude.ai 訂閱，實際 `claude-opus-5-5`，session `b1a87c0b-2408-40fa-bb9d-64be20d95669`。首輪 11 個工具呼叫，實際讀 diff、完整產品碼、固定原生 source 與 Astra probe，無 blocking／無不必要架構。採其 stop 路徑延遲建議；其餘無直接必要的額外案例不擴張本批。

同一實際 Opus session 最後增量 1 Glob＋2 Read，讀 scope 與精確最終 diff，確認 !stop 及新增測試落地正確，無 blocking，可結案。Opus 沒有跑測試或看到末次全量結果，該部分由 Astra 獨立執行、讀回 1314/1314 並驗收。Astra 另核對最終 diff、封包／工作樹內容、真核心探針與雙尺寸截圖，接受此候選，停止待本人關閉 K 後另行通知升級。未以代理自述或單純測試數量冒充正式成功。

## 本機證據

不公開私人對話或原始帳號資料。

- `D:/K-harness/.runtime/stream-recurrence-20261012/terminal-notice-fix/`：RED/GREEN、Sol 中間 full、build、首轮真正 Opus、作者交付。
- `D:/K-harness/.runtime/terminal-notice-fix-20261012/`：Astra 原失敗 full、獨立重跑／最終 full、真核心假 Responses、UI、Opus 最終增量。

## 新增 Flash 調度需求：只查明，未實作

本人另詢問多聊天室共用一個現用 Gemini 帳號、額度耗盡時等待其他工人完成，換帳號後通知原房接手。核對工程與正式 `gemini-accounts.mjs` 內容相同：已有運行中不換帳號／閒置按保存順序查驗下一帳號，**沒有完整的等候房間記錄及換好後回通知**，目前 busy 時會回報未送出本工作。

可行方案是由 K 程式記住來源、耗盡後暫緩新 Flash 派工讓現有工作自然結束、依序查驗切換，再通知原房主代理核對成果、以新工單接剩餘。本人暫停／取消優先；未知額度或未確認停止不強行切换。等待不讓模型定時待命，實際核對與續做才使用模型額度。本節只記錄當輪可行性與缺口，**不是已建置、已測試或已部署**，沒有趁本批操作真帳號。
