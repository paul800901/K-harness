# K 內建聽寫接入

本文件取代前輪 Win+H 按鈕作為主聽寫入口的設計。2026-09-24 使用者要求依提供截圖：送出左邊麥克風、錄音時波形、停止填字、送出等待轉錄、取消保留草稿。

## 實作

- 沿用已安裝的 `@assistant-ui/react` 0.15.19 公開 `WebSpeechDictationAdapter`；沒有更新套件、另裝模型或接付費 API。
- `frontend/voice-composer.jsx`：zh-TW 語音辨識、首次使用的服務傳輸同意、麥克風權限、AudioContext/AnalyserNode 即時音量波形；不是固定動畫。取消、完成、錯誤、卸載皆釋放波形音軌與 AudioContext。切換對話會卸載並取消，不把結果送入另一對話。
- `frontend/dictation-session.mjs`：處理 adapter 的 final segments/end aggregate 差異；只提交 final，不重複附加。停止進入轉錄中；此時按送出可升級為完成後送出，最多一次。自然結束只填字。錯誤、取消、逾時不自動發訊息。
- `frontend/main.jsx`：麥克風移到送出左側。錄音時呈現取消、波形、停止聽寫、送出；停止只附加文字到原草稿，箭頭走現有 send/queue 流程。錄音時原草稿唯讀。不再呼叫 Win+H helper。
- `frontend/style.css`：上述控制、波形和首次使用說明樣式。

## 驗證與界線

- 最終全套 276/276 通過，新增聽寫生命週期測試 10/10；UI 建置成功。正式 HTTP 首頁讀回 `index-CS6w5J4K.js` 與 `index-BYdIorTP.css`，對應本次建置。
- 在隔離 47839/47840，以真實 WebSpeechDictationAdapter 接合成 SpeechRecognition 與合成音訊來源，透過瀏覽器實際操作：草稿→開始→波形→停止→轉錄中→原草稿附加文字；再次錄音取消不清稿；箭頭等待轉錄結束，mock controller 只收到一筆完整訊息，完成後輸入框清空。
- 此測試不呼叫真麥克風、不連外辨識、不發正式 Claude/GPT 訊息。fixture 位於 `.runtime/voice-ui-20260924/`；僅為測試，未加入正式前端。
- 首次確認原採瀏覽器 confirm，工具驗收出現阻塞，已改為 K 介面內明確同意區，不依賴原生確認框。
- 語音辨識服務由瀏覽器提供，不保證是 Microsoft，也不是 Codex 原生轉錄引擎；首次錄音前會說明可能傳至 Google/Microsoft 等瀏覽器供應商。不同主代理共用此輸入能力。
- 尚未驗證使用者真麥克風、國語準確度、東區 Win10 和個別瀏覽器服務可用性。支援 API 不等於服務必然成功；失敗明確提示且保留草稿，不靜默改走另一供應商。
- 正式 47831 已讀回新建置資產；此輪是前端接線，重新整理 K 介面即可載入，不需為此修改後端或重啟正在進行的工作。

## 開源來源

- https://github.com/assistant-ui/assistant-ui
- https://www.assistant-ui.com/docs/guides/dictation
- https://www.assistant-ui.com/elements/composer-voice

沿用已安裝套件的公開 adapter；沒有複製範例的模擬波形，也不以元件存在推論已達成 Codex 全功能對等。
