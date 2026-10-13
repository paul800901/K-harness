# 存檔遇防毒占用時誤判失敗（2026-10-14）

## 症狀

`test/chat-continuation.test.mjs`「real controllers retain fresh completed accepted before its own late stdout tool events」單獨跑約 5 次失敗 2 次，失敗時是 2 秒等待逾時。本人長期感覺換房／接續「時序有問題」，先前修不好。

## 原因（實測）

以重現腳本反覆執行同一情境並在逾時當下讀出換房紀錄：失敗時紀錄為 `uncertain`，錯誤是 `EPERM: operation not permitted, rename '<...>.tmp' -> '<...>/chat-continuations/native-1.json'`。新聊天室已建立、接續訊息也已送出，只是最後一次存檔失敗，K 因此把成功的換房標為「結果不明」且依規則不重送。

`src/atomic-write.mjs` 先寫暫存檔再改名覆蓋。Windows 上目標檔被其他程式開著時，改名會被拒（EPERM／EACCES／EBUSY）。原本最多重試 20 次、總計約 0.78 秒就放棄。實測在負載下被占用 0.28–2.0 秒；單一讀取者每 10 毫秒讀同檔最多只占 42 毫秒，排除測試自身讀取；本機 Defender 即時掃描開啟，判斷為掃描剛寫入的檔案所致。

所有經 `atomicWrite` 存的 K 狀態（約 40 處：換房紀錄、聊天室、工人、帳號排程等）都有同樣風險，不只換房。

## 修正

- `atomicWrite` 改為依時間等待：最多 10 秒、間隔逐步加到 0.1 秒，只重試改名，不重做呼叫端工作；非鎖定錯誤仍立即拋出。正常情況無差別。
- 新增選項 `{lockWaitMs}` 只供測試縮短等待；原「21 次後放棄」測試改為「超過等待預算後放棄，之後仍可存檔」。
- `chat-continuation.test.mjs` 的檔案狀態等待由 2 秒放寬到 15 秒（大於 10 秒存檔等待），正常約 0.1 秒即通過。

## 驗證

- 修正前：重現腳本 40 次失敗 2 次；改名重試最長 2,036 毫秒。
- 修正後：重現腳本 3×40＝120 次全過；`chat-continuation`＋`atomic-write` 連跑 3 次 79/79。
- 完整測試見本批收尾紀錄。

## 複查與未處理

- 由 Opus 5.5 撰寫與自查；改動小、無新增狀態或設定。
- 尚未部署（K 內無法自更新），隨本批交 Codex 部署。
- `scripts/k-browser-native-host.mjs` 的 `writeDescriptor` 自行改名、遇鎖即失敗，可能造成偶發瀏覽器連線問題；它安裝在 vault，需重新設定瀏覽器助手才生效，另案處理。`codex-host-diagnostics` 只寫診斷且失敗即忽略，不影響功能。

## 補充：Defender 排除後的對照（2026-10-14 01:10）

另一個聊天室依本人決定將 K 與三家核心（含 node.exe）加入 Defender 排除後，把 `atomicWrite` 暫時換回舊版（20 次、約 0.78 秒）重跑同一重現腳本：3×40＝120 次全過；排除前同條件每 40 次失敗約 2 次。證實原因為 Defender 即時掃描。新版仍保留並待部署：東區等未設排除的電腦、以及其他偶發占用仍會發生，新版在無占用時不增加任何等待。實驗後已還原為新版，工作樹無修改。
