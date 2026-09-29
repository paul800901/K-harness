# 原生 K 本機離線聽寫修復（2026-09-26）

## 狀態

20:28 使用者另請 **Opus 5.5 在正式 K 獨立複查**，回覆有條件通過；提出異常關閉流程問題及隔離實測缺口，尚未修正或補測。完整結果與邊界見 [Opus 複查紀錄](opus-review-local-voice-20260926.md)。

**20:18 已從原系統匣啟動入口成功啟動正式 K，隔離服務、真實視窗與新版介面均完成讀回，保持開啟。** 使用者在前次工具拒絕後明確表示「我不在電腦前，我授權你全權處理事情」，本輪再次使用相同正式入口成功，沒有改安全設定或換方式繞過。12 個部署檔案獨立複核一致；535/535 全套及 8 項獨立原生 UI 檢查通過。語音準確度仍只測合成音訊，沒有自動啟用使用者真麥克風。

## 需求、根因與範圍

原生 Electron 雖提供 Web Speech JavaScript 介面，獨立假音訊視窗實測在辨識服務階段回報 `network`，沒有結果。詳見 [診斷](native-voice-diagnosis-20260926.md)。不是以「麥克風不支援」或 Win+H 彈窗替代功能。

使用者明確表示正式 K 已完全關閉，允許修好、更新及啟動。只借用 `D:\錄音轉文字\runtime` 既有 Python／faster-whisper／large-v3 模型，不讀原錄音、逐字稿、案件或憑證，不下載、不安裝、不改原專案、不新增常駐辨識服務或付費 API。

## 修改

- `frontend/native-dictation.mjs`：真正麥克風串流與波形輸入，音訊只在記憶體中編成 PCM16／單聲道／16 kHz WAV。停止才送到 K 本機辨識入口；五分鐘精確取樣上限、取消／逾時後晚到結果失效。
- `frontend/voice-composer.jsx`、`frontend/main.jsx`、`frontend/response-annotations.jsx`：原生版接離線辨識、獨立首次同意；保留停止填草稿、箭頭等轉錄後送出、取消保留草稿、引用評論與切室歸屬。一般瀏覽器的原 Web Speech 分支不改成離線假支援。
- `src/local-dictation.mjs`、`scripts/local-dictation.py`：固定本機 Python／模型，不接受使用者提供路徑或命令。每筆請求按需啟動一個程序，stdin 傳 WAV、stdout 回文字；`-I -B` 禁用使用者 Python 匯入及快取寫入，模型只讀本機、離線推論。單筆鎖、120 秒逾時、取消及關閉會結束該筆程序；不能確認結束時不放行第二筆。
- `src/desktop-server.mjs`：新增 `/api/dictation/transcribe`，沿用桌面 session、來源、JSON 與明確本機請求驗證。僅此路由放寬音訊請求大小，原路由大小限制及錯誤狀態保留。
- `src/electron-isolated-main.cjs`：Windows 的直接啟動檔案路徑比對改為不分大小寫，非 Windows 維持大小寫規則；保留匯入不自行啟動及斷線停止。
- 測試：`test/native-dictation.test.mjs`、`test/local-dictation.test.mjs`、`test/electron-entry-dispatch.test.mjs`、`test/isolated-launcher.test.mjs`。

沒有重做瀏覽器、變更 Sandboxie 規則、放寬秘密檔權限或搬移登入資料。既有 `.env.local` 與實際 vault 開檔阻擋證據見 [隔離實測](workspace-secret-isolation-20260926.md)，與語音接線分開驗收。

## 驗證與部署

### 已取得證據

- 主代理獨立前端定向回歸 **31/31 通過**，新介面已建置於 `.runtime/voice-repair-20260926/build`；建置只有原有大型 bundle 提醒，沒有編譯失敗。
- 後端實際用既有 CUDA／float16 large-v3 模型辨識 7.214875 秒、230,922 bytes 合成國語 WAV，沒有提供預期答案。首次辨識是簡體，已保留結果；加入泛用的「以下是臺灣繁體中文的語音內容。」提示後，輸出「這是一段語音輸入測試。請保留原本的文字,不要自動送出。」，耗時 5,013 ms。接著獨立跑一秒全靜音，耗時 3,663 ms，結果為空字串。這是兩次依序的真模型推論，不是硬編測試答案。
- 證據：`.runtime/voice-repair-20260926/backend-smoke-1790421417023/summary.json`（首次簡體）、`backend-smoke-prompt-1790421493461/summary.json`（正體／靜音）、`frontend-root-tests.txt`。
- **首次全套 534 項：533 通過、1 失敗。** 新音訊路由錯誤回覆多帶了重複 `diagnostic` 欄位，與測試契約不符；已修正為只有真正診斷內容才附帶，定向後端 8 項通過，再重跑全套。首次失敗保留於 `.runtime/voice-repair-20260926/full-regression.txt`，沒有當成環境問題或刪除。
- **最終全套 535/535 通過，失敗／略過均為 0**，138.0 秒；相較首次多一項 HTTP 取消／關閉回歸。主代理在後端凍結後執行 `node --test --test-concurrency=1 test/*.test.mjs`，結果 `.runtime/voice-repair-20260926/full-regression-final.txt`。這是本輪版本全套，不是前一輪 513 項。

### 原生視窗端到端

獨立 Electron 視窗使用正式 `createElectronWorkbench`／建置後介面、私有 CDP pipe、新測試設定檔、假對話控制器與合成音訊裝置；沒有操作正式 K、真麥克風、登入或聊天模型。沒有測試專用的媒體權限 handler；fake-device/file/ui flags 只替代音訊裝置及測試權限互動，不能據此宣稱使用者本人 Windows 麥克風權限已驗證。

8 項通過：拒絕同意不取音、不呼叫辨識；實際非零音訊與波形、停止填字並保留原草稿；取消不呼叫辨識；箭頭等轉錄後只送一次假控制器；引用註解插入保存的游標位置且不送出；切室後晚到結果不串入；辨識失敗保稿；真前端 HTTP → 本機 Whisper → 草稿。

最後真引擎階段收到 8.192 秒、PCM16／16 kHz／單聲道、RMS 0.101993 的合成裝置音訊，填入 38 字且未送給聊天模型。合成裝置循環播送測試句，因此畫面有下一輪句子的開頭；不是宣稱逐字完全相符。主代理親自打開波形與真辨識填稿兩張截圖核對。

- 最終完整證據：`.runtime/voice-repair-20260926/ui-probe/evidence/ui-probe-2026-09-26T11-26-10-346Z.json`。
- 截圖及細節：`.runtime/voice-repair-20260926/ui-probe/candidate-state-2026-09-26T11-26-10-346Z/`。
- 測試腳本先前曾因隱藏視窗截圖逾時、cleanup 變數範圍、在首個音訊 frame 前即停止、引用卡片 selector 不符而失敗；證據全保留於 `ui-probe/evidence`，並非產品 ASR 故障或成功證據。最終候選 code 0、stderr 空白；另行確認候選 Electron 與辨識 Python 均未留存。

### 正式部署、備份與還原

- 部署前重新確認 `KCandidate1` 至 `KCandidate8` 全部無程序，正式連接埠沒有服務，無系統匣啟動器／原生 owner；未終止任何其他工作。
- 19:28:12 更新 trusted-runtime 的 `src/desktop-server.mjs`、`src/local-dictation.mjs`、`src/electron-isolated-main.cjs`、`scripts/local-dictation.py`，以及 trusted-runtime／根目錄兩份 `dist-ui` 的四個建置檔。其他既有檔案、舊 assets、對話與登入資料均保留。
- 備份：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\local-voice-backup-20260926-192811`；`receipt.json` 列出每個目的地、原檔是否存在、備份位置與前後 hash。只備份這次程式及 UI 檔，不複製秘密或對話。
- `.runtime/voice-repair-20260926/deployment-result.json`、`deployment-readback.json`：12 個檔案全部與測試來源 hash 相符。
- 已用**部署後 helper** 直接辨識同一份合成假語音，4,794 ms，正體輸出與前述一致；證據 `deployed-asr-smoke.json`。這是正式檔案的執行驗證，不是正式 UI 的端到端驗收。
- 隨後正常 `K桌面啟動器.exe` 的啟動工具呼叫在建立程序前被 policy 拒絕。19:28:54 再讀回無 `/health`、無 K 啟動器／owner，證據 `formal-launch-readback.json`。當時沒有重試啟動、用其他 shell／代理繞過或聲稱 K 已開啟。
- **後續新授權與正式讀回（20:18）**：使用者再次授權代為處理，先確認正式服務／程序仍未執行，再用原本 `D:\K-harness\local-launcher\dist\K桌面啟動器.exe` 啟動成功。`formal-health.json` 精確核對 `app=k-harness-desktop`、`deployment=isolated`、workspace 為原 `vault\private-state`；`formal-process.json` 讀到啟動器 PID 21636、原生 owner PID 8112，視窗標題為「K 執行中樞」。PID 僅代表此次讀回，不作後續固定目標。
- 主代理擷取並開啟**指定正式 K 視窗**，非其他桌面程式：`formal-local-voice.png` 與 `formal-local-voice-capture.json`。畫面正常顯示首頁、原 K-harness 工作區及既有對話列，無錯誤對話框；沒有選取或重送舊工作、沒有操作官網、登入或麥克風。
- `formal-ui-readback.json`：正式服務回傳 `/assets/index-CG-G3PzN.js`，HTTP 200、798,473 bytes，SHA-256 `A2805A1C7962CD9EB58174F4B1A6775548134DC69015D5C8BF65A8E505693961` 與本輪部署檔案一致；不只確認程序存在。Luna 另外只讀重算 receipt 12 個目的地 hash，全部吻合。
- 若需還原：先由系統匣正常停止 K 並確認無工作；按備份 `receipt.json` 將 `Existed=true` 的備份檔複製回各自 `Destination`，核對 `OldHash`，再由原桌面捷徑啟動。新增加的未引用 helper／hash 命名 assets 可原處保留，不需刪除任何檔案。此備份是本輪前已能開啟的 18:20 版本，不是先前入口有錯的 18:18 備份。

### 剩餘驗收

正式啟動與本輪介面版本已完成讀回。所有語音測試都使用本輪合成假音訊；使用者真麥克風、口音、噪音及長段辨識準確度尚未驗證，不自動替使用者開麥克風。通用繁中提示會影響解碼傾向，不保證任意語句完全沒有錯字。正式 K 現在保持開啟、無主動啟動的新模型工作；不新增自動排程或常駐辨識程序。
