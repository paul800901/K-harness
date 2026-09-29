# 閒置聊天室原生資源回收（2026-09-26）

> 本頁記錄初次實作範圍；本輪最終測試及正式版本狀態統一見 [整批收尾](closeout-20260926.md)。五個真實模型聊天室的自動回收情境尚未額外實測，不以協定測試宣稱該組合已驗收。

## 範圍與差異

- `src/conversation-controller.mjs`：新聊天室建立或切回時，依最近開啟順序維持目前聊天室及最近三個隱藏聊天室的原生 controller；超出候選集合的隱藏 controller 僅在安全檢查全部通過後才關閉。重新開啟已釋放的聊天室時，依保存的原 thread 建立新的原生 controller，歷史仍由原生對話提供。
- `test/conversation-controller.test.mjs`：驗證容量回收、同 thread 重開，以及核准、queue、未完成 worker、browser human mode 和 teardown 失敗保留行為。

## 閒置判斷

只處理非 active room。候選 controller 必須有 thread、屬於 ready/completed/interrupted 等可恢復狀態、無 busy／待核准／待送訊息，且 K session 索引仍有該 thread。再透過原生 `workers()` 查詢確認沒有未結束或狀態不明的 worker。若 browser 已啟用，必須能讀回 browser state 並確認 `mode=ai`、`busy=false`、`available=true`；human takeover、browser 不可讀或任何狀態不明皆保留。檢查失敗、controller.close() 拒絕或未確認完成時，不從 pool 移除，留待後續清理／關閉處理。

回收不刪除歷史、草稿或附件；不停止工作、不呼叫模型、不操作帳號或 browser UI。沒有背景 timer；在成功開啟/切回時做一次清理嘗試。忙碌或受保護的聊天室可使 controller 總數超過四個。

## 驗證

- `node --test test/conversation-controller.test.mjs`：執行結果記錄於本次工程回報。
- 僅測試替身驗證 pool 的保留／關閉決策；未啟動正式或候選應用，未以真實原生 worker/browser/OS 行為驗收。

## 部署與未完成

本變更僅本地程式與測試，未部署。真實原生 controller 釋放與 resume 行為仍須在另行授權、非正式隔離環境中驗證；browser takeover 的讀回只用來保守拒絕回收，未宣稱完成 browser 連線釋放。
