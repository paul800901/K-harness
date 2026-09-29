# 工作中附件與暫時狀態橫幅修正（2026-09-24）

## 根因
1. Claude system/status=requesting 每次變成永久 notice，與既有 working indicator 重複，還會堆疊。
2. 後端兩家 upload 原本已允許 busy；frontend/main.jsx upload handler 與加入檔案按鈕卻仍禁止 state.busy，貼圖也走同個 handler 而被錯擋。

## 修正
- src/claude-controller.mjs 不再把 requesting 建立通知；保留真實錯誤與額度警告。
- frontend/native-ui.jsx 忽略舊後端已累積的 kind=status，刷新立即不再出現舊橫幅，無須等後端重啟。
- frontend/main.jsx 加入附件改以連線/對話切換狀態把關，不以主代理忙碌把關；點選、拖曳與貼上共用此規則。仍保留大小、份數、threadId 所有權與未完成上傳不能送出。
- 附件進草稿與待送佇列，不中斷或自動插入執行中回合；含附件的立即送入仍明示暫不支援。

## 驗收
- 完整 npm test 301/301，0失敗；UI build 成功。
- 新 regression：busy Claude 可上傳假附件，原生 start 次數維持1、busy保持true；錯誤 threadId 拒絕；重複 requesting 不新增 notices。
- 隔離 UI 47842：注入兩條舊 status notices，均不顯示；工作中點「加入檔案」上傳 probe.txt 可見附件，填 B 並送出後可見「排隊中 · 1 個附件」，A 仍在工作、停止按鈕保留。
- 隔離 fixture .runtime/archive-ui-20260924/busy-upload.mjs；全套 log .runtime/busy-upload-tests.log。
- 本次 UI 實測檔案選取入口；剪貼簿圖片走同一 upload handler，但未另作真實剪貼簿圖片實測。

## 正式狀態
UI 已建置，重新整理載入即可消除舊橫幅並解鎖忙碌時附件入口（既有後端已允許 upload）。本輪沒有停止、重啟或向使用者正式對話送訊息。後端停止產生 status notices 需下次正常重啟載入。
