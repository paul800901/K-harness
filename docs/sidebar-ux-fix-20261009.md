# 側欄狀態、旧聊天室切換與穩定排序修正（2026-10-09）

## 範圍與目前狀態

使用者確認三項介面需求後授權實作，並明確表示 K 已完全關閉，可配合另一個「交接 K 模型容量錯誤」聊天室一起更新。這邊為唯一部署者；另一邊固定候選 `4825d0c81f3b4e413b4f93e08c937305b9f37f8a` 尚未經本輪真 Opus 複查，只能先整合為 NOT READY。既有插話後最終回覆修正 `9430c4551425397a6c40bd681b2aff3e9080cc57` 亦隨整批驗收。

目前是本機實作／假資料驗證，尚未正式套用、重啟或 push。真正 Opus 5.5 設計討論已完成，見 [研究](sidebar-ux-research-20261009.md)；新增程式的真正 Opus 複查須等官方額度於臺灣 06:30 恢復，不換模型或計費路徑。後續實際整合、複查、固定版本、部署與讀回追加本文件。

## 根因與最小修改

1. **只靠相近顏色**：原先工作中／有新回覆均為 6px 實心圓。`frontend/project-sidebar.jsx`／`sidebar.css` 改為 14px 缺口環（工作中）、靜態訊息形狀（有新回覆）、警告形狀加「待確認」。尊重減少動畫設定；已讀仍顯日期。不改 completion-attention 成功條件，不用綠勾宣稱整項任務驗收。
2. **冷開啟期間舊畫面被鎖住**：`frontend/main.jsx` 即時選取目標，未取得歷史前用靜態占位，不再把舊內容當成新聊天室。三家 `open` 在取得歷史後回呼，只呈現唯讀歷史；原生連線、權限、目標及工人讀回仍照原順序完成，才開放送出／分支。`shared/conversation-preview.mjs` 是短小的呈現投影，清掉舊聊天室的待確認、工人、佇列、成果及能力，不是執行 owner。
3. **舊開啟蓋回新選擇**：`conversation-controller.mjs` 的請求序號僅管畫面選擇。新點擊立即換投影，讓已接下的原生開啟先結束並保留 owner，之後只開最後選擇；不因換画面中止可能已恢復的原生工作，不重送。明確取消仍沿用 AbortSignal；取消等待中的最新選擇亦清除預覽。
4. **檔案保存被當最近活動**：`main-sessions.mjs` 新增 `sortAt`。舊紀錄首次保存沿用原檔案時間作相容排序錨點，並非聲稱那是實際發言時間。開啟、改名、釘選及設定保存不推進；原生接受新訊息／插話及完成回覆才推進。`saveMainSessionActivity` 沿用同一房間保存佇列、在佇列內讀最新 metadata，避免完成通知覆寫較新改名／權限。`project-groups.mjs` 依此排序並保留手動／釘選規則。
5. **傳送確認等候仍鎖側欄／草稿**：導航不使用全域 action 鎖；後端仍保留各房間／切換操作的原生限制。傳送確認期間可切房、可寫草稿；送出仍有原有鎖，唯讀預覽仍不可輸入。不增加自動重試或核准。

顯示／選擇與原生執行歸屬分開，前端樂觀選擇亦與權威 SSE snapshot／patch 分開，避免 patch 基準被假畫面破壞。沒有新資料庫、常駐預熱、歷史全集快取、設定頁或原生核心重作。底層冷連線時間未宣稱減少；本批改善可感知回應，並窄化單聊天室索引讀取。

## 修改檔案

- 呈現／導航：`frontend/main.jsx`、`project-sidebar.jsx`、`sidebar.css`、`style.css`、`project-groups.mjs`；`shared/conversation-preview.mjs`。
- 原生接殼／排序：`src/conversation-controller.mjs`、`unified-controller.mjs`、`desktop-controller.mjs`、`claude-controller.mjs`、`gemini-controller.mjs`、`main-sessions.mjs`。
- 回歸：`test/sidebar-ux.test.mjs`、`sidebar-ux-ui-probe.mjs`、三家 controller tests、`conversation-controller.test.mjs`、`conversation-navigation-ui.test.mjs`／UI probe。
- 既有導航探針原本還用舊 SSE 裸 state／JSON 附件，已更新成 snapshot 契約、raw stream 假附件及等待實際草稿復原；不是放寬產品判定。

## 本機證據及失敗

證據：`C:\Users\Paulus\.codex\worktrees\steer-final-display\K-harness\.runtime\sidebar-ux-20261009` 及同層測試 logs；研究／真 Opus 討論另在 `D:\K-harness\.runtime\sidebar-status-research-20261009`。

- 初版定向 64/64、三家原生 fixture 185/185；新增快速點選、舊失敗不蓋新目標、取消、已接下工作不因畫面切換停止、唯讀投影、排序與保存競態。
- 建置後 UI：三主題×1920／390 共 6/6。真 SSE patch，延遲 B 歷史／連線，歷史先可閱讀、連線前送出／分支禁用、繼續點 C，B 晚完成不蓋 C；減少動畫仍不同形狀、順序不變、0 模型工作呼叫。
- 既有導航 built UI：A 工作／待核准時切 B，B 送出／停止只帶 B ID；A 草稿／假附件回來；A 遲到成功、失敗及新草稿均保留正確歸屬。
- 第一輪完整預設並行 1075/1075 通過。追加取消測試後另一輪預設並行 1076 有三個失敗（容量接續時序、native failed、20ms partial 保存讀回）；原 log 保留 `sidebar-full-tests-parallel-failed.txt`，不得隱去。單獨 partial fixture 6/6，低並行完整結果待下方收尾。容量自動接續測試會隨另一邊移除此路徑而改為不重送驗證。
- Vite 大 bundle 警告保留；沒有为此另拆包或安裝相依。

未驗證：此次假資料 UI 不代替本人桌面／手機實機體驗；各家實際冷連線耗時分解未量測，不聲稱 Codex／Claude 閉源桌面內部實作；不把公開協定存在当已接全部能力。
