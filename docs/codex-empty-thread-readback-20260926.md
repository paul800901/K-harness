# Codex 空白 thread 讀回提示（2026-09-26）

## 根因與證據

- 正式 UI 點開尚未送出任何回合的 Codex 對話時，原生讀回回報 `thread not loaded: <threadId>`。主代理以專用閒置 owner、兩個本輪假 thread 讀回驗證：空 thread 的 `includeTurns: true/false` 都回報此錯誤；有一輪的 thread 可讀回 1 turn、preview 與路徑。證據保存在 `.runtime/closeout-20260926/evidence/formal-empty-thread-readback.json`。
- 本次使用版本的 Codex 原生端，在上述跨 owner 讀回中未保留該零回合 thread。K 仍保存其本機清單紀錄；這不表示歷史資料已被刪除，亦不把單一版本實測擴成所有版本的永久規格。

## 修正

- 僅當原生錯誤文字精確等於 `thread not loaded: ${threadId}` 時，顯示可理解的無法讀回提示：K 清單與原資料未變、沒有重送；若使用者確認從未送出訊息，可自行建立新對話。
- 不自動建立替代 thread、不改原 thread ID、不刪除清單/草稿、不吞其他 protocol error。

## 驗證與限制

- `node --test test/desktop.test.mjs`：本地假 host regression 確認精確錯誤只顯示提示、不呼叫 `thread/start`/`thread/resume`、K metadata 不變；其他 `-32600` protocol error 仍照原錯誤失敗且同樣不建立替代 thread。
- 子代理 focused 階段未操作正式服務。主代理後續已套用正式、472/472 完整回歸通過，重啟後由真正 Chrome UI 讀回有一回合的正式測試對話；見 `closeout-20260926.md` 最後讀回。零回合原生限制仍存在，不以自动新建掩蓋，也不要求為保存空白項目而浪費模型回合。
