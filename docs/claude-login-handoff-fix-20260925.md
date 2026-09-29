# Claude 官方登入連結與人工授權碼交接修正

## 問題與直接原因

使用者在隔離 Chrome 複製登入網址，無法貼到日常 Chrome。上一則要求直接跨視窗複製的說明不適用本候選，現更正。

1. 候選 Sandboxie 盒設為 `OpenClipboard=n`，沒有開放跨盒剪貼簿；本輪**保留**這個保護。
2. 真正執行候選內官方 Claude Code 2.1.280，空 home、未登入，stdout 印出的手動入口已是 `https://claude.com/cai/oauth/authorize`。K 前後端允許清單只有舊網域，兩層都丟掉了新入口。
3. 官方 CLI 印出的手動網址與自動開啟的 loopback 登入不是同一條交接流程。官方手動流程會回傳 `code#state`，須交回仍在等待的同一個 CLI；原 K 沒有這個欄位，光補連結仍不完整。

確認方式：官方程式內嵌 auth login JS 和一次空 home 的受限執行。輸出僅保留網域／路徑／長度，未寫入完整 OAuth query。假探測盒 KCandidate4 結束後讀回零程序。官方文件：[Authentication](https://code.claude.com/docs/en/authentication)。

`BROWSER` 是 CLI 的自訂 opener，不是停用瀏覽器開關，opener 的輸出會被 CLI 捕獲且不轉送。未採用自造 OAuth callback、重寫 redirect、讀取 Chrome 資料或放寬隔離。

## 變更

- `shared/claude-login-url.mjs`：前後端共用官方授權網址判斷，補實際觀察到的 claude.com；拒絕假網域、帳密 URL、非 HTTPS、非預設埠與非 oauth 路徑。
- `src/claude-login.mjs`：保留完整分段 stdout，等網址分隔符後才提供連結；處理 OSC 超連結控制字元。拒絕舊程序晚到輸出污染新登入。
- 同檔提供不啟動新程序的 progress 讀取，及單行授權碼交接。只在現有登入等待時、state 相符、stdin 可用才交付；拒絕重複提交。授權碼只經原程序 stdin，不放 argv、環境、聊天歷史或回傳資料。交付 stdin 不等於登入成功。
- `src/desktop-server.mjs`：新增人類登入狀態與授權碼路由，仍受既有 session、Origin、顯式 POST 檢查；不設模型工具入口。
- `frontend/model-picker.jsx`／`.css`：自動讀取短小登入進度；「複製登入連結」有明確成功／失敗回饋；提供 password 型授權碼欄位，不存草稿。送出即清空；由官方 CLI 完成後才重新檢查真實訂閱狀態。
- 新增／擴充 `test/claude-login-http.test.mjs`、`test/claude-login.test.mjs`。

## 驗證

- 針對性登入、HTTP、隔離工廠測試 **14/14**。
- 首次全套並行 **430/431**：既有 Claude controller 的 Luna 通知測試只等 40 ms，這次在固定等待後尚未完成；保留失敗紀錄，未為這個不相關測試改產品或放寬斷言。
- 按前輪同樣的循序方式，全套 **431/431**，130.31 秒。
- 獨立候選真實 UI：啟動官方 Claude 登入後，新網域連結自動出現；點擊 K 的複製按鈕，隨即讀回剪貼簿與完整 href **一致**。稍早跨工具間隔的讀回曾不一致，未把該次當作通過，也未推測原因；最後同一次工具呼叫內的點擊／讀回通過。
- UI 送入假的錯誤 state，K 拒絕並清空欄位，仍保留登入等待；假碼沒有送到官方換 token 端點。沒有填入、讀取或保存使用者真正授權碼。
- 真正人類登入後的官方成功回應／模型工作回合仍待驗證，不能以假碼測試宣稱完成。

證據：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\login-handoff-fix\`：`result.json`、`regression.log`、`regression-sequential.log`、正式 UI 前後 hash、候選舊 UI／兩個後端模組副本。CLI 空 home 探測腳本在 `.runtime/isolation-pilot/auth-output-probe.mjs`，沒有憑證。

## 部署與使用者下一步

**2026-09-26 後續**：本人已完成 Claude 登入，兩家 pro 及候選重啟後登入延續均讀回；真實雙模型 UI 接手已通過，最新候選 PID 49664。以下保留當時交接狀態；目前結果以 [雙模型 UI 驗收](isolated-model-ui-acceptance-20260926.md) 為準。

- **只更新獨立候選 47971**。舊候選正常關閉，八盒皆空後重開，目前 PID 37172。候選自動開出的隔離 Chrome 仍可能存在，可不用它；不從那個視窗跨盒複製。
- 正式 47831 PID 50264 未動，正式 `dist-ui/index.html` 前後 SHA256 相同：`69F730FFB39E7F4E170228BA16FB0F17AAC574D5018C3B31FE0538DD0D1F3FF0`。
- 候選畫面現已確認 **ChatGPT pro 訂閱登入**；Claude 仍等待本人登入。未搬用原帳號憑證，未修改 API 計費或正式瀏覽器開關。
- 從 **K 的「複製登入連結」** 複製到日常 Chrome；本人完成官方 Claude 授權後，將官方完整授權碼貼到 **K 的「Claude 官方授權碼」**，按「交付官方驗證」。不要把密碼／驗證碼／授權碼貼到聊天。
- 完成後再驗證真正 Claude／Codex 模型與右側瀏覽器的工作流程；目前仍不准登入其他網站帳號。
