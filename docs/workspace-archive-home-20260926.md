# 封存目前工作區後回首頁（2026-09-26）

## 根因

側欄封存工作區只呼叫 `projects/metadata` 更新登錄並重新整理清單。封存後該列因此消失，但前端沒有清除目前主視圖的聊天室選取，舊對話仍留在畫面。

## 修正

- 僅在封存操作 (`archived: true`) 指向目前畫面工作區，且目前有選取對話時，另呼叫既有 `/api/workspace` 流程，以空白視圖回首頁。
- 對其他工作區的封存只更新側欄，不切換目前畫面。
- 使用既有 conversation controller 工作區選取流程建立空白視圖；已開啟聊天室仍由其 controller 持有，背景工作不因視圖切換停止。未刪除 K 草稿、K 歷史或供應商原生歷史。

## 修改與驗證

- `frontend/main.jsx`：封存目前工作區後回首頁。
- `test/conversation-navigation-ui.test.mjs`：加入封存作用範圍檢查。
- `test/conversation-controller.test.mjs` 原有案例已驗證切換至空白工作區後，先前 busy 對話仍開啟且繼續 busy；本次未改該測試。
- targeted tests：`node --test test/conversation-navigation-ui.test.mjs test/conversation-controller.test.mjs`，22/22 通過。

## 限制

未啟動桌面 UI 做人工互動驗收；未部署或重啟。這份修正不涵蓋隔離桌面啟動時的工作區 metadata 更新行為。
