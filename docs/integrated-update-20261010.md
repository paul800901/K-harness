# 2026-10-10 三聊天室成果整合更新

## 授權、固定來源與範圍

本人要求配合「追查插話後最終回覆消失」「交接 K 模型容量錯誤」與本聊天室成果一起更新，並回覆已離開並停止 K。由本聊天室作唯一部署者，仍以實際停止確認為準，不強制結束／恢復／重送任何工作、不 push、不更新東區。

- 正式基底 `1a45a73440a5f948c5cec625de02340863b7c67d`。
- 容量聊天室固定 `bb1d1a9bd443aeb3b9349624ae84b4f9079d3a14`：產品已在正式基底，新增僅公開自用工具文件，保留 Git 發布與東區未更新界線。
- 插話聊天室固定 `1ac66aae84c19998b6e76b28afe3dcb589eda4ac`：累積 API 討論／原生搜尋、子代理快覽、串流錯誤呈現及 Codex AI 同專案新房接續工具；包含上一筆文件提交，未取用舊根工作樹產品檔案。
- 本聊天室固定 `a29e834ae8dea6f61fc4da28e7005ead232fd135`：閒置檢查不鎖导航、非導航操作讓路、純觀看已鎖 owner、明確重開後 queue 可送。原生串流失敗原因仍未知。

在既有 managed worktree 合併；僅 `conversation-controller.mjs` 及工程索引衝突。保留雙方 imports、continuation callbacks、待接續 ownership、正常 close 等待與 idle probe 中止，stop 同時取消待接續與開啟等待。新增一個真實重疊情境回歸：晚到的閒置 read 不得關閉已受理換房的來源，然後仍僅建立／送出一次。

## 記憶結論，不冒充程式能力

研究及真正 Opus 討論見 [實際診斷](long-context-discussion-20261010.md)、[全球論文／開源研究](agent-memory-research-20261010.md)。已證實至少一次舊暫停誤生效；相關保留歷史仍有後來的繼續，不能證明壓縮刪除／重排或核心受損。與原生串流／remote compact 錯誤分開處理。

不關閉原生壓縮，不新增第二套摘要記憶或按次數自動换房。方向是原始來源按需回讀、唯一既有進度保存驗收／在途／未決事項、暫停／繼續的適用範圍與生命週期，以及假資料驗證公開原生壓縮後重錨入口。這批未實作該記憶機制，也未驗收極長小說品質。Codex 換房工具保留原生 fork 歷史含壓縮，並不是記憶重置；Claude／Gemini 尚未接換房工具。

## 驗證與正式狀態

整合前各來源已有獨立真正 Opus／測試證據，仍须驗證合併結果。整合首輪聚焦 119/119；新增重疊 regression 後接續 16/16。沿用現有相依，不安裝／升級、不搬帳號或改計費。

執行證據留 `D:\K-harness\.runtime\k-integrated-update-20261010`。完整整合回歸、建置、built UI、真正 Opus 複查、固定來源及部署／正式讀回結果另在本節追加；沒有結果前，不宣稱正式已更新。

之前僅本聊天室候選 frozen build 被 Windows PowerShell 將 Vite stderr 提醒視為終止錯誤，雖 UI log 顯示完成，後續建置／驗收未執行；保存原目錄，不拿該次當正式可部署。整合建置分別記錄 exit code，提醒與失敗分開，不隱藏底層輸出。


## 整合正式收尾（2026-10-10，取代上方候選／停等狀態）

本人重新要求三聊天室成果一起更新；先兩次正常關閉失敗，啟動器只保存 confirmed:false，具體內部根因未知，不能歸因壓縮。本人親自確認強制結束「是」後，14:24:28 臺灣時間，K 既有功能結束自有 supervisor PID28584 程序樹；47831 無監聽後才部署。未知結果工作不重送。

### 整合驗收
- 固定程式 **433e7f23459eebf4fa7b1183cba495f39cf12e3d**，正式基底1a45；peer1ac66aa、room-lock a29e834、公開自用文件 bb1d1a9 都在 ancestry，不以舊根工作樹覆蓋新產品。
- UI／擴充／啟動器 build成功；固定候選完整序列 **1133/1133，0 failed**，195秒。
- built UI六組成功：聊天室切換1440／390（真控制器＋假供應商）、API設定9項、討論桌面／手機、串流錯誤桌面／手機、子代理快覽、使用者複製9組。647個archive來源核對，擴充build僅改protocol換行；還原archive位元組後零差異。不是长小說品質驗收。
- 真正 Claude Code2.1.294／claude-opus-5-5、Claude.ai Pro／firstParty，session aa94ae77-4ea9-459b-b91f-146969b3efdd，15次Read／Glob／Grep在限定封包，exit0／success／無阻擋。Astra獨立讀回重疊diff、測試、UI及來源。保留cancelOpening中止可選read等待：只讓navigationRequest失效仍可能留長等待；不為保守offline未確認額外加機制。

### 部署及正式讀回
- 14:24:47正式套用；舊程式、啟動器及設定在 **D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791613487228**，可退程式，不是使用者資料快照。
- 登入、對話、瀏覽器／語音資料原處保留。四份非秘密設定hash、五個目錄身分及第一層項目、Node／語音等既有設定核對未改；未掃描憑證內容，不宣稱全檔資料hash驗收。
- 正式owner health200、未認證state403，實際JS／CSS資產hash吻合；1440／390認證UI成功，**22個既有saved sessions**可列，無page error／POST，未開小說房／送模型回合／使用真API Key。測試owner正常close成功，不能因此宣稱原長任務關閉根因已解決。
- 前兩次renderer locator錯誤要求手機未開啟的側欄額度按鈕，timeout；實際手機初始圖正常。改核對兩尺寸共用可見工作台及認證state後成功，沒有修改產品去滿足錯誤locator。第二次log、初始圖及第三次成功log保留；第一次原始錯誤留工具輸出。
- 自動啟動器呼叫被工具執行限制拒絕，未換入口繞過。本人自行開啟後，**14:29:04 正式原生工作台 ready**；PID42224為新正式Electron，health200及版本433e7f23459eebf4fa7b1183cba495f39cf12e3d吻合。K現在已開啟；沒有由本輪恢復／重送工作。

證據 **D:/K-harness/.runtime/k-integrated-update-20261010**：candidate、validation-complete、full-test與6組UI logs、fixed-source-readback、acceptance、review/result、deployment-activation／preserved、formal-readback與兩尺寸圖片、restart-readback。正式程式維持433e7f2；後續僅工程文件收尾另提交。不push、不更新東區。

### 未解決／未驗證
上游stream／remote-compaction及原長任務正常關閉失敗根因未定；真付費API、長負載、歷史附件完整重開未驗收。Claude／Gemini尚無AI換房工具，既有人用分支MCP啟動缺口未修。記憶研究已保存，但有效控制指令生命週期／壓縮後重錨仍待實作与假資料probe；本批不是記憶漂移修復，不關原生壓縮。
