# Opus 複審：R2 存檔競態小修（2026-09-30）

> 對象：`R2-candidate-20260930-savefix`（e25e649），回覆見 [r2-archive-compat-no-shared-knowledge-20260930.md 第 6 節](r2-archive-compat-no-shared-knowledge-20260930.md#6-opus-複審後補修windows-短暫讀取衝突2026-09-30)；前次複審 [opus-rereview-r2-20260930.md](opus-rereview-r2-20260930.md)。
> 本輪只讀審查＋測試重跑；未修改程式、未部署、未重啟 K、未提交 git。

## 結論：通過。程式面可以進入使用者試用

| 項目 | 判定 |
|---|---|
| 產品修改只有 `main-sessions.mjs` 的改名重試 | 通過：只重試同一個 `rename(temporary,target)`，只接受 EPERM／EACCES／EBUSY，最多 21 次嘗試（排定等待共 775ms）；用完或遇到其他錯誤原樣拋出；不重寫快照、不改 saveOrder、不重送任何工作。與 G 級「不自動重送」不衝突。 |
| 新增 6 個存檔測試 | 通過：都是行為測試——三種暫時錯誤會恢復且沿用同一個暫存檔與內容；用盡時拋出原錯誤、舊紀錄不變、之後仍可存；EIO 等其他錯誤只試一次；真正 `listMainSessions` 持續讀 150 個對話的同時存 1,000 次全部成功，讀取端從未看到半寫入的紀錄，目錄沒有殘留暫存檔。 |
| 兩個高頻讀檔測試改用 `observe-atomic-write` | 通過：改成攔截真正的改名、等替換完成再讀，不再持續開著目標檔，正是前次指出的問題；並新增「沒有存檔錯誤」斷言。 |
| `waitFor` 改回同步判斷 | 通過：已核對所有呼叫者都是同步條件，不會因回傳 Promise 而提早放行。 |
| conversation-controller 假佇列測試 | 通過：原本把待送訊息塞在假 host 上，但公開狀態來自獨立佇列，所以一直是空的——這是測試本身的錯；改用真正的 send／排隊／stop 建立待送訊息，只改測試。 |

## 本輪驗證

- `git diff R2-candidate-20260930 R2-candidate-20260930-savefix -- src test` 逐行審查。
- 驗證副本與候選的 src／test／shared／frontend 一致；獨立完整重跑 **637/637**（40.2 秒，0 跳過），紀錄 `.runtime/audit-20260929/r2-savefix-tests.log`。
- 正式 runtime 的 src／shared／frontend／dist-ui／web 與 R1 備份逐目錄相同——仍未部署。

## 試用前後注意

- 部署只換 R2 的 9 個產品檔，其餘沿用正式 R1；照交接文件的停機、備份、讀回程序。**重啟 K 會結束正在進行的聊天室**，請在沒有工作進行時由使用者同意後執行。
- 試用時留意：含「EPERM」或「保存失敗」的錯誤（應已極少）、封存對話刪除、Claude／Codex 對話開啟與切換、先前因環境變數缺失而失敗的指令。
- 未納入本批、仍待後續：其他 5 處「暫存＋改名」寫入仍無重試（正常使用下沒有同時讀取者，風險低）；連線中不能取消（C1）；A4 非 Error 字串化與 NODE_OPTIONS 小建議；盤點中的舊架構移除與結構整理。
