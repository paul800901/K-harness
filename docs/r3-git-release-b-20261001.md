# K HARNESS：新機補修 Git 發布（2026-10-01）

## 授權與版本內容

使用者看完集中複查與一行修正後，明確要求「你把它做好」：將 `c043911` 推上既有 GitHub 儲存庫，建立新的 `k-r3-git-20261001b`，供東區新電腦安裝。只發布已驗證程式、測試與文件；不移動舊 tag、不改登入／計費／模型設定、不重啟正式 K。

- 儲存庫：`https://github.com/paul800901/K-harness`；本輪 GitHub CLI 讀回 isPrivate=true、預設分支 main。
- 原遠端 main：`0778c7e2b883cf023c1d1ca31899efec1d101c90`。
- 原標記 `k-r3-git-20261001`：`60672fc85f85c4b434c7298a897d7cec1c2f10e0`；保持不變。
- 新標記：`k-r3-git-20261001b`；包含補修 `c0439113e31cd83c58e03d568a8ce3f61418b1c6` 與複查文件 `771d4c3`，另更新 README／安裝指南／開發索引，讓新機明確指定新標記。
- 修正效果：沒有 Chrome 助手設定時，普通文字對話仍可開啟；已設定助手的路徑不變，不恢復舊備援。不額外加入其他產品修改。

## 發布前驗證

- 本輪再次完整測試 **509/509，0 fail／0 skip**，33.87 秒；日誌 `D:\K-harness\.runtime\concentrated-review-20261001\release-b-tests.log`。
- 查核遠端 main 是本次 HEAD 的祖先，可 fast-forward；新 tag 尚不存在。僅明確推 `HEAD:main` 與新 tag，使用 atomic push，不使用 force 或 push --tags。
- 審查待推差異：只有一行產品補修、回歸測試、複查與發布文件。既有 extension-protocol 換行狀態不提交；`.local`／`.runtime`／個人環境與登入資料不在 Git 追蹤或新增提交內。
- 本機正式程式先前已更新至 c043911 並讀回，本輪只發布 Git，不再次套用或中斷 K。

## 新電腦使用版本

依 `docs/git-install-update.md`：乾淨 clone 後 checkout `k-r3-git-20261001b`，首次 `Setup-K.ps1 -Ref 'k-r3-git-20261001b'`；已安裝者用 `Update-K.ps1 -Ref 'k-r3-git-20261001b'`。官方 CLI 路徑、本人登入、Chrome 助手與 Whisper 環境仍依該台實際狀況設定，不搬開發機憑證或整個資料夾。

## 發布讀回

此文件建立時尚未推送；發布完成必須另外取得遠端 main／tag 與乾淨下載讀回，實際結果補記於此。沒有把待推狀態當成已發布。

Windows 10、真麥克風、剪貼簿操作與該台首次登入仍待東區實機驗收；Git 發布與程式測試不取代這些測試。