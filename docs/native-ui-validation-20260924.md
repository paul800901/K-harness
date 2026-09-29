# 共用原生介面與複製回饋驗收（2026-09-24）

## 變更
- frontend/native-ui.jsx：共用通知、原生推理摘要、唯讀差異、明確确认原生審查、@ 工作區檔案搜尋、CopyFeedback。
- frontend/main.jsx / frontend/style.css：掛接上列介面；缺少的累計用量顯示「尚無資料」而非 0；不支援能力明示，不向 Claude 呼叫 Codex 操作。
- 複製：await clipboard.writeText 成功後才顯示勾勾/已複製，2 秒後恢复；失敗顯示可重試，不宣稱已複製；卸載清計時器。
- @ 搜尋只在目前草稿末尾觸發，空 @ 顯示輸入提示；候選選取只插入引用路徑，不讀內容、不自動送出。
- 差異面板為原生回合 diff/patch 唯讀顯示，不含檔案回復。審查按鈕先出確認才啟動原生審查；Claude 明示未接入等價來源。

## 主代理隔離 UI 驗收
使用 .runtime/archive-ui-20260924/native-server.mjs 的假 controller（47840），不接真實對話、不使用模型額度：
- 複製後立即可見「已複製」，之後恢復「複製」。成功分支已測；clipboard 拒絕分支有程式處理，未做瀏覽器拒絕實測。
- 原生通知可見；展開處理過程可見假原生公開摘要。
- 差異面板展開可見 fake diff；審查顯示明確確認（未啟動真實 review）。
- 輸入 @demo 找到 src/demo.mjs，選取後草稿為引用路徑；沒有送出使用者回合。

## 官方 Codex 只讀實測
主代理啟動另一個官方 app-server，只做 initialize、windowsSandbox/readiness、fuzzyFileSearch；沒有 thread/start 或 review/start。
- 沙箱 readiness=ready（不代表完整隔離驗證）。
- 隔離根目錄的 native-search-probe.txt 找到，回應符合本機 schema。
- 證據：.runtime/native-readonly-proof/evidence.json；假檔保留，不碰真實秘密。

## 部署限制
已建置 UI；正式後端尚未重啟。新的事件來源/搜尋/審查路由需重啟後端才有。正式端到端模型審查、真實限流/改派/差異串流尚未驗收，不宣稱已全部上線。歷史回溯、檔案還原與即時語音不在本輪冒接。

最終全套回歸：296/296 通過，0 失敗；UI 建置成功（大型 bundle 警告）。
