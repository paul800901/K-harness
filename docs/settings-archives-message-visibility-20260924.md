# 設定、封存管理與追加訊息顯示 — 2026-09-24

## 差異
- frontend/main.jsx：設定移除工作區路徑/新增工作區，封存入口移到設定；封存搜尋、還原、單筆刪除與清空的確認畫面。使用者的 steer/追加訊息不再被回合摺疊隱藏，處理過程不重複列出使用者訊息。
- frontend/project-sidebar.jsx：工作區選單新增詳細資訊，顯示完整路徑及複製按鈕；新增/管理保留側欄。
- frontend/sidebar.css：封存管理排版。
- src/archive-delete.mjs：只回收 K 對話版本、Claude K 投影及佇列；排除原生供應商歷史、附件及工作區。確認、封存/current thread 驗證、symlink 拒絕、單一 bundle 回收及失敗還原；bundle 有原路徑 manifest。
- src/unified-controller.mjs、src/desktop-server.mjs：/api/archives/delete 與修改互斥。metadata 使用 await 保持 lock 直到完成。
- test/archive-delete.test.mjs、test/unified-controller.test.mjs：回收失敗/假成功/範圍/確認及 metadata 競態。

## 驗證
- 隔離 47839 假 controller、真正 UI：兩筆同 group 使用者訊息都在未展開狀態可见；設定沒有工作區路徑/新增，左側詳細資訊顯示完整路徑。
- 封存 UI 假資料：單筆確認刪除、清空確認取消不變、還原後空清單均通過。沒有刪除真實聊天室。
- Windows 回收實測假檔後成功還原 bundle；主代理讀回 manifest 確認原路徑映射。證據 .runtime/tests/archive-recycle-proof-9uKnJp。
- 正式 47831 只讀確認：最後普通 user 與 source=steer user 同 group，兩筆已存在；不是訊息遺失。未重送。
- 全套 283/283 測試通過，UI 建置成功（既有 bundle-size 警告）。

## 部署限制
UI 新版已建置，重新整理載入。封存刪除 API 需重啟正式 K 後端才生效，本輪未停止或重啟正式服務，未宣稱正式刪除驗收完成。
資源回收筒還原的是 bundle；依 K-restore-manifest.json 映射還原到原位置，不會自動匯入供應商。
