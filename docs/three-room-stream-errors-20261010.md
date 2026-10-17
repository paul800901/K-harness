# 三聊天室連續錯誤：原生紀錄唯讀核對

## 結論與範圍

2026-10-10 本人提供拳王轉生、鐵血獵犬、我殺了學院玩家三張畫面，詢問是否同類。**原始紀錄確認三者均出現原生請求／串流未完成；學院玩家其中一次明確發生在remote compact階段。**同類錯誤訊息不證明底層同一根因，也不證明記憶／上下文已損壞。

只讀K專用原生資料庫、這三個rollout及K保存的對話metadata；未改設定／產品／目標／小說，未重送、恢復、停止工作或重啟／部署。沒有啟動模型討論或供應商測試。紀錄中的retry建議是錯誤文字，不是使用者授權，不據此重送。

## 原始證據

原生家目錄：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\agent-home\.codex`。`state_5.sqlite`／`goals_1.sqlite`以readOnly開啟；按thread id取得rollout_path，串流解析指定三檔，只輸出錯誤、事件型別、壓縮計數與goal狀態，不讀回小說正文。時間均為臺灣時間（UTC+8）。

| 聊天室／原生thread | 原始事件位置與時間 | 原生錯誤 |
|---|---|---|
| 拳王轉生 `01a11cbd-2d3b-7102-b22f-dd20eb32682b` | rollout第22271行，10/10 08:13:48 | task_complete.error：`stream disconnected before completion: An error occurred while processing your request...`；request `57d7fe1e-2b9e-4615-ac5e-4191380cf5b8`，與第一張畫面一致 |
| 鐵血獵犬 `01a11781-3936-7bd3-85ff-f18c5e987da5` | 第42371行，10/10 12:38:56 | 相同stream disconnected前綴；request `713b3361-7bae-49bd-9a15-f4e7a5c3fc85`，與第二張畫面一致 |
| 我殺了學院玩家 `01a11cac-e246-7f62-acd6-17d8abebb91c` | 第14919行，10/10 08:11:04 | `Error running remote compact task: stream disconnected before completion: An error occurred while processing your request...`；request `569402d0-b02a-4bf3-865a-43e888429270` |

三筆均`codex_error_info: other`，沒有足夠細分根因。拳王另於第22167行10/10 06:54:04有同前綴錯誤request `700a6114-5f5c-43b8-9b08-55eb0bc5a64b`；學院玩家第14865行10/10 07:04:57也有一般stream disconnected，request `d666df30-1f12-491b-9508-01ec87fa44eb`。證實不只一次，但不是三房同時故障的證據。

本次讀回的已保存compacted為拳王34／鐵血75／學院33；三者goal均blocked。這是讀取時狀態，不是授權或根因。學院玩家在08:11錯誤後仍有後續task_complete，最後一個09:46:54的回合沒有上述error；第三張09:46的內容是後續模型討論，不能當當回合再次失敗的證明。

K三個`*-current.json`是設定／對話metadata，沒有lastError欄位；不憑猜測欄位讀出錯誤。初次猜測`trusted-runtime/src/native-main-controller.mjs`路徑不存在，沒有以其當證據，也未因此廣掃其他目錄。本輪分類依原生task_complete.error及截圖精確request id。

## 如何解讀

1. **同類現象：**原生請求／串流未完成。第三房至少一筆是壓縮請求未完成，前兩筆未被原生文字標成壓縮失敗。
2. **底層根因未知：**供應商處理、傳輸、請求內容／長度或其他因素，這個generic訊息不能區分；不直接歸因額度、壓縮次數、K錯誤或某種核心損壞。
3. **與語意偏移分開：**先前已核對的舊暫停誤生效是另一項行為問題。第三張模型說「壓縮可能使脈絡失真」是推論，不是診斷；不能替代錯誤事件與因果證據。
4. **工作結果未知不重播：**畫面顯示未結束／待確認子代理，不等於全部仍在跑，也不等於全部未產生成果；後續若獲恢復授權，先查既有工單與成果，不能直接重派。

相關前輪證據：[長脈絡診斷](long-context-discussion-20261010.md)、[全球記憶研究](agent-memory-research-20261010.md)。本輪只是新錯誤分類／讀回，沒有實作修復或驗收。
