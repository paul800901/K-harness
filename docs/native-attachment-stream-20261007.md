# 原始附件串流上傳與下載（2026-10-07）

## 修改範圍

- `frontend/attachment-upload.mjs` 將瀏覽器 `File` 原始 bytes 傳送至既有 `/api/upload`，使用 `X-K-Request`、`X-K-Command`、`X-K-Thread-Id`、`X-K-File-Name`；支援上傳進度與呼叫端取消，不自動重送。
- `src/desktop-server.mjs` 在既有本機認證、Origin、明確請求及遠端 route whitelist／session／command 防重檢查後，直接將 octet-stream Request 傳給 controller，不先累積 JSON chunks。舊 JSON route 仍相容。
- `src/desktop-files.mjs` 使用串流寫入暫存原檔，成功後才改為正式原檔路徑及寫入附件 record；通用檔案、影音及未知副檔名不轉 Base64、不讀整檔。只有文字擷取、DOCX、需要 K 端 PDF 文字擷取的路徑讀檔；原生 PDF 模態已可接收的路徑不為擷取額外載入整份 PDF。擷取失敗保留原檔並註記 warning。
- K 端文字／PDF／DOCX 擷取是可選便利功能，不是上傳限制：只對不超過 32 MiB 的檔案嘗試擷取；較大檔跳過擷取、保留原始附件並提供原生路徑與 warning。擷取所需 `readFile` 與解析均在失敗 fallback 內，錯誤不會阻止原檔保存。Claude 文字附件只讀最多 8 KiB 作提示預覽，仍保留原附件完整 byte count 與原始路徑；該 8 KiB 不是原生讀取或上傳限制。
- GPT／Claude／Gemini 的附件上下文包含原始檔路徑；既有擷取 `readPath`／`path` 保留。Gemini 只保留圖片 native modality 檢查，一般 PDF／影音／未知格式交由核心以路徑處理，不宣稱模型已驗證可直接讀取該模態。
- `GET /api/attachment?...&download=1` 經 `sessionAttachment` 的對話歸屬與 `checkedPath` 檢查後，以 `createReadStream` 回傳原檔，保留下載檔名、MIME 與 byte length；artifact 路徑未改。

## 長時間傳輸設定與限制

- 本機與遠端 HTTP listener 設 `requestTimeout: 0`，避免 Node 預設固定 request body timeout 中斷低速長附件；明確保留 `headersTimeout: 60000`。這不放寬 host／session／Origin／CSRF／command 驗證，也不設定 K 自訂檔案大小限制。
- 仍受用戶端、網路／代理、磁碟空間及原生核心實際能力限制；本地串流成功不代表任何模型能直接理解該格式。HTTP headers 仍有 60 秒上限。
- 中斷上傳不會建立可見附件 record，但可能留下 `.partial` 暫存副本；本輪不自動清除，以免擴大刪除行為。
- 不含 `download=1` 的附件預覽仍使用既有 buffer 讀取；本次只將原檔下載改為串流。大型預覽的記憶體消耗與 artifact 下載不在本次範圍。

## 假資料驗證與部署狀態

- 定向測試涵蓋二進位上傳 auth／Origin／CSRF，遠端 route whitelist／`X-K-Command` 防重、未知副檔名及影音原檔、跨對話拒絕、擷取失敗保留、失敗 stream 不建 record、完整串流上傳及下載 hash。
- 真實本機 HTTP listener 將合成 **16,777,339 bytes** 寫入專案 `.runtime`，磁碟原檔及 HTTP download 的 byte count／SHA-256 一致。
- 真實本機 HTTP listener 另將合成 **1,420,000,000 bytes**（固定測試 byte pattern，非私人媒體）完整上傳至專案 `.runtime/attachment-stream-20261007/.runtime/uploads/aac97a0d-8a49-4f3a-9ca8-fc34ec578b4b/source.lrf`，record、磁碟原檔與串流下載均為 1,420,000,000 bytes，SHA-256 均為 `2cac42710251bb56a2785c31bdc6ef73a3adb0e41f5a60f47fd91836afaa95d2`。假資料保留，不清除。
- 可重現／讀回腳本 `.runtime/attachment-stream-20261007/full-http-smoke.mjs`；`node .runtime/attachment-stream-20261007/full-http-smoke.mjs --verify-existing` 只讀驗證既存原檔與 record，結果收據在 `.runtime/attachment-stream-20261007/result.json`。只有明確使用 `--run` 才會另建並保留一份 1.42GB 假附件。
- 另有 1,420,000,000-byte stub consumer 測試只證明 HTTP handler 可串流；本節完整保存結論另由以上真實磁碟 write/read 與下載 hash 支持。未呼叫模型或正式服務，未部署或改正式 K。
- 真原生 Codex attachment smoke 後續已執行一次：使用 K profile 的 Codex 0.160.0、account/read 回報 ChatGPT Pro，model/list 確認 `gpt-6-luna` 支援 `low`；在全新 `.runtime/native-attachment-smoke-20261007/isolatedroot` 以 read-only 開啟新 thread `01a112ad-f347-7440-a110-317903a912c6`，由真 `createDesktopController.uploadStream` 上傳三份合成 79-byte 假文字資料（`.m4a`／`.mp4`／`.lrf`），再經同一 controller `send`，原生 turn `01a112ad-f463-7630-9e8b-35bdb1a0699e` 回報 completed。這證實 K controller 將一般影音／未知附件 path 交進原生 turn，不證實模型成功讀取。
- 對該**唯一合成測試 thread**做 `thread/read`（沒有送第二回合、查其他 thread 或改權限）後取得原始 `commandExecution`：核心選用 PowerShell 7，以 `[System.IO.File]::ReadAllBytes`／`[System.Text.Encoding]::UTF8.GetString` 檢查三個測試路徑；執行環境回報目前 language mode 不支援這些方法，後續因空值再報錯。協定 item `exitCode` 是 0，但 `aggregatedOutput` 明確包含上述錯誤，因此不能把它算成附件讀取成功，也不能推論原檔路徑不可交付。依本次範圍未改權限、未切換讀取方式、未重跑 turn。精確 command／output 保存在 `.runtime/native-attachment-smoke-20261007/result.json` 的 `nativeCommandReadback`，附件與 native turn 細節亦在該收據。
- 附件擷取記憶體補修的定向回歸：`node --test test/desktop-files.test.mjs test/claude-controller.test.mjs`，104/104 passed。涵蓋 32 MiB+17 bytes 合成文字附件 stream 原檔保存與磁碟 SHA-256、超界跳過 extraction 且仍保存、bounded preview 僅讀 4 KiB／保留完整 size、既有 PDF/DOCX 解析失敗保留原附件，以及 Claude 附件預覽提示的 byte count／原始路徑。未宣稱完整來源測試或正式運行驗收。

- 確認前次只有 read-only PowerShell .NET 方法失敗、沒有不明副作用後，在同一合成 thread 接續一次限定讀回，維持 gpt-6-luna／low／read-only、原 K profile；改用普通 `Get-Content -LiteralPath ... -Raw` 與 `Get-Item ... | Select-Object -ExpandProperty Length`。Turn `01a112b6-5417-7972-b033-4d4a45719ce1` completed，三檔標記及 79 bytes 均由原始 command output 讀回，與本機合成檔一致。沒有重傳附件、新增其他 thread、擴權或重播使用者工作。證據 `.runtime/native-attachment-smoke-20261007/followup-result.json`（原始 output 與核對）及 `run-followup-readonly.mjs`；只證明 K 到原生核心的原始檔讀取，非影音解碼／模態能力測試。
