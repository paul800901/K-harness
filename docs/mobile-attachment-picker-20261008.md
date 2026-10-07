# 手機選檔返回後附件上傳被擋：候選修復（2026-10-08）

## 授權與狀態

使用者回報手機選圖後顯示「請先連線並開啟對話後加入附件」，追加要求所有附件一起檢查，並與真正 Opus 5.5 討論正確性與過度工程化。使用者明確要求**先不更新現有版本，等本人起床、K 翻譯工作告一段落後再更新**。

本批只修改獨立候選；**沒有部署、重啟／停止正式 K、push、更新東區、操作真帳號、安裝或升級套件**。不建立排程，不承諾離線後自動部署。主工作樹既有修改、其他工作與對話資料保留。

- 正式基線：`4a6c482f2df01e1b31216cffc9ec7a98088bdee9`。
- 候選：`C:\Users\Paulus\.codex\worktrees\mobile-image-upload\K-harness`，分支 `codex/mobile-image-upload-20261008`。
- 工程證據：`D:\K-harness\.runtime\mobile-upload-20261008`；候選測試證據在候選 `.runtime`。
- 程式固定版本、最終 Opus 結果：見本檔收尾讀回。

## 根因與最小修正

手機 remote UI 的 SSE 狀態連線在頁面 hidden 時關閉並設 `online=false`；從相簿／文件選擇器返回會重開 SSE，但檔案 change 可先於新的 snapshot。所有附件共用的 `upload` 錯把這個 SSE 讀回狀態當成獨立 HTTP 上傳的必要條件，直接拒絕，之後 snapshot 恢復「已連線」而錯誤保留。程式可重現此順序，**尚未確認這支真手機每次的精確事件時序**。

產品只改 `frontend/main.jsx`：

1. 去除 upload 的 `!online` 判斷。使用既有 XHR、HTTP／登入／對話驗證處理成功或失敗；不等待 SSE、不增加 pending-reconnect 佇列、timeout、effect、重試或備援。
2. 空清單／取消不觸發上傳。既有 busy、threadId、原生 connecting/offline/error/uncertain/stopping 判斷、按 thread 保存結果、AbortController、錯誤清 pending、草稿及原始檔處理不變。

最終**沒有新增 picker ref、prop 或 sourceThreadId 參數**。Opus 第二輪看到完整 JSX 與測試後，修正第一輪對換房風險的假設：`key=threadId` 會移除原 picker input，原 chooser 不會把檔案交給新 Chat input；snapshot 尚未呈現的競態仍由既有後端驗證拒絕。Astra 用真正原 chooser／移除後的 DOM 驗證後採納，刪掉初版 ref。

未修改 `state-connection.mjs`、`attachment-upload.mjs`、後端 uploadStream、原生權限、登入、上傳大小／格式或輸入模態。按鈕連線狀態仍保留，僅已選檔案不因 SSE 正在恢復而被拒絕；真正網路／403／伺服器拒絕仍回報失敗，不重送。

## Opus 5.5 討論與取捨

真正官方 Claude Code **2.1.292**、Claude.ai **Pro／firstParty**、實際回傳模型 **`claude-opus-5-5`**；僅 Read／Glob／Grep、plan／safe-mode、空 MCP、no-chrome 的去敏封包審核，未改帳號、計費或全域設定。

第一輪方案討論收據：`design/result.json`，session `7f1fb234-d52f-4baa-9f61-5fc934a44a65`，success／exit 0。

- Opus 明確建議移除 SSE online 的假前提，不設 remote 分支；後端與既有 XHR 錯誤已足夠。
- Opus 認為等待重新連線的 pending-file 狀態／timeout／effect 是不必要的過度工程化，故未採用前輪聊天初步提出的等待方案。
- Opus 第一輪建議捕捉 picker 原對話；初版曾加一個 App ref。第二輪指出這在實機上不是必要保護，而測試刻意操作了新房 input 才走到該分支。Astra 獨立改用原 chooser 實測，確認換房後原 input 已不在 DOM、沒有 POST／chip，遂**刪除整個 ref／prop／參數**，保留兩項核心修正。
- Opus 指出上傳結果在已切換畫面後可能不顯示原房錯誤；既有資料歸屬不變、不會誤寫新房，本批不再增加跨房通知系統。

第二輪完整 diff 與測試複查：`final/result.json`／`final/review.md`，session `06cff028-2a33-49fd-be28-8f0014755249`，success／exit 0、真 `claude-opus-5-5`。結論無阻擋，建議上述減法。減法後最後覆核在 `followup/result.json`／`followup/review.md`；詳細結論在本檔收尾讀回。

## 實際驗證

- **UI build 成功**；沿用固定基線 lockfile 相同的既有專案依賴副本，沒有 npm install。保留既有 chunk-size 提示，未為此調整架構。
- 初版**完整回歸 964/964**，fail／cancel／skip = 0，72.889 秒；命令 `node --test --test-concurrency=2 test/*.test.mjs`。減法後以同一命令另重跑，結果在收尾讀回。新 UI probe 是單獨執行，沒有把它加進 964 的項數。
- 新 `test/mobile-attachment-picker-ui-probe.mjs`：**13/13**。真 built React／Chromium 原生檔案選擇器／File／XHR、真 createDesktopController 與保存附件；SSE、auth 回覆及 native host 是 fixture。
- 主案例在 hidden→visible 後 snapshot 尚未到時，選 **PNG、JPG、TXT、PDF、DOCX、ZIP、MP3、M4A、MP4、LRF 共 10 檔**，每檔恰一次原始串流 POST、相同來源 thread；保存 bytes 逐一與輸入相符、草稿不送出，之後 reconnect 不重試。
- 其餘涵蓋取消、選檔期間換房／清空對話（對原 chooser 選檔，斷言 input 已移出 DOM、0 POST、0 chip、沒有新房錯誤）、後端已換房而前端 snapshot 未到、網路失敗、403 登入過期、上傳中移除、五種 native 阻擋狀態。拒絕 cases 無誤存／重送，pending 會移除。App busy、!threadId 條件未修改，不把它們列為本 probe 的新增直接呼叫實測。Chromium 取消選檔未必產生 change，取消案例不冒稱必然執行到空清單 return。
- 既有 `attachment-stream-ui-probe.mjs` **2/2**：desktop／remote 串流、保存錯誤、取消、上傳中換房；pageerror = 0。
- 既有 `attachment-ui-probe.mjs` **3/3**：真 controller 的附件投影／queue 與假 native 圖片路由；pageerror = 0。
- `git diff --check` 通過。

**界線**：以上是隔離候選，不是 Android 原生相簿／Tailscale／真模型端到端驗收。PNG、JPG 是實際圖片、DOCX／ZIP 是合成封裝；PDF 故意無效，以驗證擷取失敗仍保留原檔。音訊／影片／LRF 為合成原始 bytes，**只驗上傳和保存，不宣稱可播放、內容解讀或三家 native multimodal 全通**。本批不新增任何檔案內容能力。

## 保留的失敗與工具限制

- managed worktree 建立先停在 creating；一次 attach 回報無法驗證 ownerless 歸屬，沒有繞過。等待 operation 真正 completed／registrationError=null 後才修改候選。
- 第一個測試命令漏建立候選 `.runtime` 導致重導向失敗，未執行 build／probe；補 mkdir 後正常。
- probe 初版重用已關閉的 fake host，以及未等 React render 的 online assertion，是測試程式問題；已修 fixture，保留日誌，不歸因正式 K。
- 修正 fixture 後，原正式 built UI 的主要案例在等待附件 chip 時逾時，保留 red 證據 `mobile-image-baseline-probe3.txt`；這不是正式網站寫入或測試原圖。
- 第一次候選 probe 在無 thread case 預期舊通用錯誤，初版來源 ref 比對已先拒絕；中間曾修預期為換房提示。第二輪 Opus 發現這個新 input 路徑不是實機 picker 的歸屬，**最終改測原 chooser 並移除多餘 ref**，此中間結果不作最終保護證據。

## 正式狀態與後續

`formal-unchanged-readback.json` 確認正式版本仍是基線，`main.jsx`／`state-connection.mjs`／`attachment-upload.mjs` 與固定基線相同。既有正式 Electron PID 26648／29772／35944／38232 啟動時間仍為 2026-10-07 21:29:53，沒有本輪重啟。

後續**必須等使用者確認翻譯工作結束**，再重新核對真正閒置、其他候選是否更新基線，按既有 SOP 準備可退回程式及正式讀回；本文件不是部署／push 授權，也不把候選驗證當成正式手機已修。需要屆時做本人手機選圖／文件實機驗收。若正式來源已改，先核對整合，不覆蓋其他修改、不重播翻譯。

## 收尾讀回：已固定候選，等待本人允許更新

- **候選程式 commit：`2073a6bbee0d81e1412988f5c6ad4859503ac50e`**，parent 為正式基線 `4a6c482f2df01e1b31216cffc9ec7a98088bdee9`。只含 `frontend/main.jsx` 與新 UI probe；產品 diff 為 3 行新增、1 行刪除（兩項行為修正及一行註解），沒有其他產品變更。
- 減法後完整回歸 **964/964**，fail／cancel／skip = 0，**78.297 秒**；log `候選\.runtime\mobile-attachment-minimal-full-tests.txt`。
- 減法後新 UI probe **13/13**、既有串流 **2/2**、附件／圖片原生投影 **3/3** 再通過；無 pageerror。log 為 `mobile-attachment-minimal-probe.txt`、`mobile-attachment-minimal-existing-stream.txt`、`mobile-attachment-minimal-existing-native.txt`。
- 最後一輪真正 Opus 5.5：session **`bfc85cae-e56b-4d94-8113-cea5ddff9cef`**，success／exit 0，實際 `modelNames=[claude-opus-5-5]`。明確結論：**「沒有阻擋，減法正確，不需要再改產品，可以結案」**；確認所有多餘 ref／prop／參數已刪除，測試改用原 chooser 後符合事件路徑。
- Opus 另指出新 probe 的一行舊註解與已到達前支線所以不會再走到的判斷。最後只清掉這些**測試註解／死條件**，產品沒有再次改動；Astra 獨立重跑新 UI probe **13/13**（`mobile-attachment-final-probe.txt`），沒有冒稱 Opus 另審過這個註解清理版本。
- 最終 source/main 與最後 Opus 封包 main 完全相同（僅允許 CRLF/LF 差異），正式程式三個相關檔仍與基線相同。工程文件／索引收尾另固定 commit，不將較新的文件 SHA 宣稱成正式部署。
- **正式版本維持 4a6c482；本批未部署、未重啟、未停止翻譯、未 push、未更新東區。** 等待使用者醒來確認，不因測試通過自動更新。
