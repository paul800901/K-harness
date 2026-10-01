# K HARNESS：東區用最新版本 Git 發布（2026-10-01）

## 授權、內容與邊界

使用者在詢問最新修改是否已推 Git 後，明確確認「對，打新版本標記……這個是要給東區用的」。本輪將已驗證的本機聽寫補修與現況說明發布至原私人儲存庫 `https://github.com/paul800901/K-harness`，建立新 annotated tag **`k-r3-git-20261001c`**。不移動舊標記，不 force，不重啟／再次部署正在使用的本機 K。

- 遠端 main 起點：`4ed631e0ee0573f9814f4fbf67e8c8000b28e09f`，是本次來源 HEAD 的祖先，可 fast-forward。
- 產品修正：`ad1fa984329a22e624cd41de1391d71cbcd017a9`，3 個前端檔只取消 K 自加的本機聽寫同意；系統／原生麥克風權限、互斥鎖、停止／取消／草稿、瀏覽器外部語音同意均保留。2 個測試檔涵蓋直接開始與重開後免確認。
- 文件：現況 README、10/1 使用者決定、安裝／退版／NVIDIA 語音界線、舊 README 歷史留存，以及聽寫部署與未驗事項。README／安裝指南指定新版本 c，供東區乾淨安裝。
- 既有新機文字聊天室補修 `c043911` 及 b 標記均在本次版本祖先中；不恢復舊備援、DeepSeek／Pi、共享知識、Sandboxie 執行或內嵌瀏覽器。
- 舊 `k-r3-git-20261001`：`60672fc85f85c4b434c7298a897d7cec1c2f10e0`；舊 b tag object：`06b70964ee7aafa8b7a3a57291046630201e7696`，指向 `bb06b937e36350d425e05e0bd388688786db63c2`，均保留不動。
- 只推明確的 main 與新 tag；既有 `browser-extension/extension-protocol.cjs` 換行狀態不提交。個人設定、登入、對話、瀏覽器資料、Whisper 模型、node_modules、測試證據目錄不在待推檔案內。沒有新增 GitHub Release 附件、搬帳號或切換計費。

## 驗證與發布狀態

本輪發布前完整測試 **512/512，0 fail／0 skip**，33.86 秒；UI 建置成功，JS／CSS／logo 名稱及內容與本機正式已驗版本一致，只有既有 bundle 大小提示。

第一次發布前完整重跑曾為 **511/512**：既有 `test/browser-live-session.test.mjs:178` 下載測試，在短輪詢結束時仍為 downloading，期待 completed。該測試／模組與遠端原版未變；獨立重跑該檔 **11/11**，未改任何程式或測試，再完整重跑一次才得到上述 512/512。推測是既有短等待對並行 I/O 負載敏感，未確認根因，也未宣稱已修復；首次失敗日誌完整保留，不以測試修改掩蓋失敗。

先前來源／候選 512/512、本機正式聽寫假音訊 6 項通過已記錄於 [聽寫補修紀錄](voice-no-consent-20261001.md)。正式目錄完整補測另有 1 項既有目錄假設失敗（511/512），未冒稱正式全過；該測試與啟動模組未因本次修改而改動。

發布前先確認 tag c 不存在，查核範圍／敏感檔案排除與 fast-forward；以一次 atomic push 同時更新 main 及建立 c。推送後才升級為已發布，讀回遠端 main、新 tag object／commit 及舊 tag，並從 GitHub 乾淨下載 c 核對版本與程式／文件。若推送結果不確定，先讀遠端，不盲目重送或移動標記。

本節是版本打標前的已完成查核，不把測試通過當成已發布。證據位置：`D:\K-harness\.runtime\voice-release-c-20261001`，含 `release-c-tests.log`（首次失敗）、`release-c-download-isolated.log`、`release-c-tests-repeat.log`、`release-c-build.log`。實際發布讀回完成後追加結果至 main 同名文件；已發布標記不隨文件收尾移動。

## 實際發布與遠端讀回

**已發布並讀回完成（臺灣時間 2026-10-01 23:45）**。一次 `git push --atomic` 退出碼 0，同時 fast-forward main 與建立 annotated tag c；沒有 force、沒有重送，舊 tag 讀回不變。

- c tag object：`74bbc78acbfcf6f60ec2d10c8ef15d2d13f3d266`。
- c 的固定 commit：`50ee11e1b11358e1c93d7ee62d71938ea471e370`；首次發布時遠端 main 相同。包含原文字聊天室補修、`ad1fa98` 聽寫修正與最新文件。
- 遠端舊 `k-r3-git-20261001` 仍為 `60672fc85f85c4b434c7298a897d7cec1c2f10e0`；b tag object／commit 仍為 `06b70964ee7aafa8b7a3a57291046630201e7696`／`bb06b937e36350d425e05e0bd388688786db63c2`。
- 從 GitHub 乾淨 clone，再明確取回 c 並 checkout `c^{commit}`；HEAD 為 50ee11e、工作樹乾淨。3 個前端、2 個聽寫測試、README、AGENTS、安裝指南、package／lockfile、Setup／Update **12 個 Git blob** 與測過的來源一致。沒有 `.local`／`.runtime`／`.env.local`／node_modules；未另外下載套件或搬帳號。
- 清楚區分：這是乾淨下載與版本讀回，不是東區實機安裝或硬體驗收。首次失敗與兩類舊測試限制仍保留，沒有因發布而改寫成全部正式功能通過。
- 讀回證據：`release-c-prepush.json`、`release-c-push.log`、`release-c-push-result.json`、`release-c-remote.txt`、`release-c-clone.log`、`release-c-readback.json`。下載位置 `D:\K-harness\.runtime\voice-release-c-20261001\clean-clone`。
- 後續只提交／推送本段讀回及索引等文件至 main；**c 標記維持固定在 50ee11e，不隨文件收尾移動**。本輪沒有重新套用或重啟本機 K，也沒有 GitHub Release 附件或額外上傳。

## 東區安裝與未驗界線

依 [安裝指南](git-install-update.md) 使用乾淨 clone，checkout `k-r3-git-20261001c`，首次 `Setup-K.ps1 -Ref 'k-r3-git-20261001c'` 並提供該台官方 Codex／Claude exe 位置；已安裝者先離開並停止 K，再 `Update-K.ps1 -Ref 'k-r3-git-20261001c'`。不把開發機整個資料夾或登入憑證搬過去。

Git 下載讀回不是該台完整安裝。Windows 10、首次本人登入、Chrome 助手、真麥克風與剪貼簿操作仍待東區實測；目前 Whisper 需要 NVIDIA／相容 CUDA，Windows 內建語音方向尚未決定，無語音環境仍可使用文字對話。
