# 註解浮框收合與原生 K 圖示

## 需求與變更
- 使用者要求加入留言只顯示選填留言浮框；composer 註解清單必須由人點開，點外面即收合。撤回的灰化問題不修改。
- `frontend/response-annotations.jsx`：清單新增外部 pointerdown／Escape 收合；空引用重置 expanded；新增留言浮框開啟時收合清單。保留草稿、原新增留言與聽寫。
- `frontend/main.jsx`：只向 ResponseQuotes 傳入 `collapse={!!quotePopover}`。
- `src/electron-workbench.mjs`：BaseWindow 指向既有 `frontend/assets/k-logo.ico`，避免沿用 Electron 執行檔預設圖示；不重畫圖示。
- 測試：`test/response-annotations-ui.test.mjs`、`test/electron-workbench-icon.test.mjs`。

## 驗證與過程限制
- 主代理定向註解／聽寫 34/34，圖示／原生權限／隔離啟動 16/16；本輪未重跑全套。
- 原生假對話 UI 12 項通過，涵蓋新增單框、展開後點外收合、草稿保留、Escape、移除最後一筆後新增、送出及跨室草稿。證據：`.runtime/annotation-ui-fix-20260926/evidence/annotation-ui-2026-09-26T15-15-30-479Z.json`。
- 主代理檢查操作腳本與 optional-comment.png，並重建至 `.runtime/annotation-dismiss-icon-20260926/build`，JS `index-CUHGuHx8.js` SHA256 `EA7BC1A8636E8748468B92D203AD9FF090254AAFDC78EE60ABA557A52DD974CD` 與該通過候選一致。
- 子代理曾誤解需求並刪除同一行 composer；主代理攔下，依本輪原始 patch 精確恢復六個被移除行，再比對確認只多 collapse 屬性。中間失敗候選保留，不算通過。後續未驗證的 useLayoutEffect 改動已撤回，部署只使用已驗證 useEffect 版本。
- 沒有測真麥克風、真模型理解；沒有修改隔離、路由、登入、權限或計費。

## 正式更新
- 使用者先停止後立即重開，主代理未覆蓋執行中檔案；再次要求保持停止後，23:18:06 正常關閉、退出碼 0。
- 23:18:42 更新 10 個目的地，確認程序／47831 listener 為零；包括正式原生模組、ICO，以及根與正式 dist-ui 的四個資產。保留所有舊 assets、對話與設定。
- 備份：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\annotation-dismiss-icon-backup-20260926-231842`。receipt.json 保存目的地與新舊 hash；備份及正式讀回一致。
- 工具開啟時回報使用者實體 Escape 中止，立即停止 UI 操作。使用者後續自行開啟；23:20:45 native isolated workbench ready。使用者 23:22 截圖已可見標題列與工作列 K 圖示恢復。health 仍為 isolated，10 檔再次 hash 核對相符。
- 正式註解完整互動仍未重測，不能把候選 UI 當成正式完整驗收。
- 還原：正常停止且確認無工作後，依 receipt.json 將 Existed=true 的備份回存 Destination 並核對 OldHash；新增圖示與 assets 可原處保留，不需刪除。重開後確認隔離健康與原資料。

## 使用者後續回報：Claude 斷線
23:22 新對話顯示 Claude Code 已中斷。23:24 只讀檢查確認正式健康服務仍在、K 投影僅 queued user message，但同 nativeSessionId `09b84af8-dc39-4212-9b32-dd41059a2532` 原生歷史已收到該訊息並呼叫瀏覽器工具。未重送、重啟或中斷工作。這不是已驗證的任務失敗／未送達；根因另行重現，暫不以此次圖示與註解修改歸因。

後續假 host 重現已確認：send 因權限／effort 變更主動 close 舊 host，watchHost 把預期的 close 當意外斷線，state 變 offline/busy=false；新 host 已 start，但 stream_event 被 offline guard 丟棄。`.runtime/annotation-dismiss-icon-20260926/restart-repro.test.mjs` 1/1，主代理獨立重跑通過。產品程式尚未修改，正式工作未中斷／重送；這個測試證實程式缺陷及相同現象，不代表取得當時執行堆疊。需在設定重啟期間區分預期關閉與真正斷線，並保留 close 失敗 uncertain、重開失敗 offline 的語意。
