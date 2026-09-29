# 原生視窗語音錯誤：診斷與尚未採用的修法

## 後續狀態（2026-09-26）

使用者後續表示「我那邊完全關了 你把它通通改好 不用管他」，同意借用現成離線 ASR 程式與模型並完成 K 整合、驗證及正式更新。原先不動官網評論中正式 K 的限制已解除；以下保留當時診斷，不代表修復後狀態。後續實作與驗收見 [本機離線聽寫修復](native-voice-fix-20260926.md)。

## 當時狀態

**錯誤已重現，語音修復尚未完成，也沒有正式部署。** 使用者 2026-09-26 18:35 表示正式 K 正在評論官網，要求先不動那邊；本輪沒有更新 trusted-runtime、重新整理／重啟正式視窗、操作官網、觸發 Win+H 或使用真麥克風。

原有需求仍依 [瀏覽器聽寫規格](browser-dictation-20260924.md)：麥克風、真實波形、停止填字、等待轉錄後送出、取消保留草稿。不能僅改成「不支援」提示，也不能不經決定改回 Win+H 系統彈窗。

## 直接觀察

- 使用者截圖：`語音辨識發生錯誤 未自動送出；原草稿保留。`
- 原生 K 前端仍使用 `@assistant-ui/react` 的 `WebSpeechDictationAdapter`。檢查 JavaScript 介面存在，不等於對應辨識服務可用。
- 18:40 在獨立、隱藏、全新設定檔的 Electron `44.4.5` 視窗測試；使用 Chromium fake audio device，未收真麥克風，也未連正式 K。
- `SpeechRecognition`／`webkitSpeechRecognition` 介面存在；事件依序為 `start`、`error`，其中 `error = network`，沒有辨識結果。
- 因此直接定位到辨識服務階段，而不是 K 草稿追加或送出流程。這是獨立視窗重現，不是從使用者那一回合擷取到的原始錯誤事件；沒有據此宣稱使用者整台電腦斷網。

證據：

- `D:\K-harness\.runtime\voice-repair-20260926\native-recognition-probe.cjs`
- `D:\K-harness\.runtime\voice-repair-20260926\native-recognition-result.json`

## 不採用的兩個方案

1. **原生版直接顯示不支援。** 只能讓錯誤更清楚，不是修復使用者要的功能。
2. **沿用既有 `/api/dictation` 呼叫 Windows Win+H。** 曾在開發檔案接出候選並通過假 focus／失敗保稿測試，但不符合既有一體式操作流程，故不採用。Windows 系統聽寫是線上服務，必須另行明示；它隨 OS 焦點輸入，也不能假稱 K 能取得辨識結果、可靠取消該次 OS 聽寫或維持每室結果歸屬。

上述候選僅曾修改開發檔案；未部署、未執行真正快捷鍵。Win+H 候選六檔另存 `.runtime\voice-repair-20260926\win-h-rejected\`；不支援提示候選三檔另存 `.runtime\voice-repair-20260926\unsupported-rejected\`。兩者均已從開發檔案撤回，只撤回這次語音候選的新增內容，保留原有其他工作區變更；未使用 Git reset／checkout 或刪除任何資料。

撤回範圍：`frontend/voice-composer.jsx`、`frontend/dictation-session.mjs`、`frontend/main.jsx`、`frontend/response-annotations.jsx`、`scripts/Invoke-KWindowsDictation.ps1`、`test/dictation-session.test.mjs`。主代理另行讀回支援判斷與原草稿保護，核對新 helper／native consent／焦點接線已不在正式來源；獨立重跑 dictation-session、windows-dictation、response-annotations 三組測試 **19/19 通過**。Windows 測試僅執行 Probe 的結構編譯，未送出快捷鍵；結果保留於 `.runtime\voice-repair-20260926\restored-regressions.txt`。這是撤回後既有行為回歸，不是新語音功能驗收，也不是完整功能測試。

## 既有本機辨識可行性調查

- 只讀列出 Windows 現有 `System.Speech` 引擎，發現 `MS-1028-80-DESK`、`zh-TW`。
- 使用系統既有 `Microsoft Hanhan Desktop` 在記憶體合成假語音；沒有播放音訊、使用麥克風或讀真錄音。以未限制預期詞句的 `DictationGrammar` 測試，僅在當次引擎實例將 `AdaptationOn` 設成 `0`，未更改全域／持久化辨識設定。
- 假輸入：「請幫我檢查這個網頁。今天下午的工作已經完成。」
- 實際輸出：「請把握檢查這個網頁今天下午的工作已經完成」，confidence `0.604034543`。
- 這只能證明現有引擎能辨識串流，不足以當成準確度驗收；不直接把這個結果當作可部署修復。
- 測試腳本：`.runtime\voice-repair-20260926\sapi-feasibility.ps1`。

另依歷史工程索引找到既有離線轉錄工具；本輪只核對以下路徑存在：

- `D:\錄音轉文字\runtime\asr_faster_whisper_venv\Scripts\python.exe`
- `D:\錄音轉文字\runtime\models`

**尚未執行該 Python、載入模型、核對套件／GPU 可用性或接入 K。** 沒有查看該專案錄音、逐字稿、案件資料或憑證。已向使用者詢問是否允許只借用現成程式與模型、在 K 測試版驗證並維持原有操作流程；未取得答覆前不開始新接法，不安裝任何套件或新服務。路徑存在不是目前可用性證明。

## 官方參考（查閱於 2026-09-26）

- [Electron 專案中的 Web Speech network 錯誤回報](https://github.com/electron/electron/issues/46143)：上游背景，不能取代本次自己的錯誤重現。
- [Microsoft Windows voice typing](https://support.microsoft.com/en-us/accessibility/windows/use-voice-typing-to-talk-instead-of-type-on-your-pc)：Win+H 需要網際網路及文字欄位焦點。
- [Microsoft SpeechRecognitionEngine](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine)：既有 in-process 語音引擎及音訊串流輸入。
- [Microsoft recognizer settings](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.updaterecognizersetting)：`AdaptationOn` 為實例設定；未使用會持久化的 `PersistedBackgroundAdaptation` 變更。

## 驗收邊界

只完成診斷及候選取捨，不能報「語音已修好」。目前尚欠允許後的新接線、假音訊端到端與取消／停止／切室回歸、使用者真麥克風與國語準確度驗收。正式 K 仍保持原狀，後續部署必須先確認官網評論等工作已結束。
