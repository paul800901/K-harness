# Gemini 派工被拒「憑證身分缺失或不唯一」：agy 1.4.6 登入紀錄改格式（2026-10-23，南區已部署）

## 問題

2026-10-23 20:55（臺灣時間）派 Flash 工作時，K 在派工前的帳號核對失敗：「憑證身分缺失或不唯一，拒絕操作。」工作沒有開始、工作樹沒有變更、未重送。同時段 `gemini_accounts` 顯示五個帳號 20:53 實查都成功，卻全部標記 `requiresActivation`。影響：在部署修正前，所有需要同步目前登入的 Gemini 主聊天室送出與 Flash 工人都會被拒。

本人指示：「現在只剩 Gemini 暫時沒辦法使用，那我們現在處理 Gemini 的問題。」

## 查證

- `scripts/gemini-credentials.ps1` 以 `gemini:antigravity` 登入紀錄最上層的 `id_token`（JWT）裡的 email 辨認帳號（`Get-Email`）。讀不出就丟 `IDENTITY`；額度查詢時讀不出目前登入身分會把所有帳號標 `requiresActivation`，派工時 `activate` 先讀目前身分，失敗即拒絕。
- 10-03 的審查早已列出這個風險：「如果 agy 更新 token 後沒有保留 `id_token`，`current` 就會開始回報身分錯誤」（[gemini-login-flow-20261003.md](gemini-login-flow-20261003.md)）。
- 今天 20:05 K 重開時 Antigravity 由 1.4.5 升到 1.4.6。比對 `trusted-providers/updates` 內 1.2.17～1.4.6 的執行檔（只看字串，未執行 agy）：只有 1.4.6 新增 `json:"id_token_email,omitempty"`。
- 經本人同意，以憑證助手同一套讀取元件做一次唯讀結構檢查，只輸出欄位名稱、型別與布林值，沒有輸出任何值：最上層只有 `token`、`auth_method`、`id_token_email`；**沒有 `id_token`**；`id_token_email` 是有效的電子郵件格式；`token` 內有 `access_token`、`token_type`、`refresh_token`、`expiry`、`expires_in`。檢查腳本只呼叫讀取，未寫入或刪除。
- 推定經過：20:23 起的 Flash 工作期間，agy 1.4.6 更新權杖並以新格式改寫目前登入紀錄，之後 K 讀不出身分。

更正：先前曾建議本人用「新增 Gemini 帳號」重新登入作為暫時恢復；查證後 1.4.6 重新登入同樣寫新格式，K 仍讀不出，該建議無效，已向本人更正。

## 修正

`scripts/gemini-credentials.ps1`：

- `Get-Email`：沒有 `id_token` 且有字串 `id_token_email` 時，要求符合原本的電子郵件格式後使用它；有 `id_token` 時照舊解析。只用於辨認已保存的帳號，登入是否有效仍以官方 `/usage` 為準（與原設計相同）。
- `Save-CurrentManaged`：判斷「同一次登入、保存副本較新就不覆寫」的條件原本只比 `id_token`；新格式兩邊都沒有 `id_token`，改為同時比 `id_token` 與 `id_token_email`。舊格式行為不變。曾嘗試改成「同帳號即不覆寫」，但會改變既有測試保護的「不同次登入要覆寫」語意，已撤回。

不加入其他備援格式，也不改 Node 端。

## 驗證

- `test/gemini-credential-vault.test.mjs`：PowerShell 5.1 假資料新增 1.4.6 格式（有效 email 讀出並轉小寫、無效 email 拒絕）。
- `test/gemini-quota-helper.test.mjs`：新增 1.4.6 格式下同帳號不以較舊副本覆寫、不同帳號會覆寫。
- 完整 `npm test` 1848/1848。
- 經本人同意，用修正後的憑證助手對真實目前登入執行唯讀 `current`：讀出的帳號代號與 K 記錄的目前帳號一致（未印出電子郵件）；正式版憑證助手同時仍回報 `IDENTITY`（第 71 行）。
- 部署前未執行 agy、未切換帳號、未寫入任何登入紀錄；部署後實際派工通過（見下節）。

## 審核與部署狀態

Opus 5.5 實作。與同分支 [登入失效修正](auth-expiry-recovery-20261023.md#審核與部署狀態) 一起於 2026-10-23 22:27–22:28（臺灣時間）部署為 `0cf673e33087a4b3d856aeea671e77b28e8eaa0b`，更新器 1848/1848、讀回含 `id_token_email` 與 UTF-8 BOM，已 push。

部署後實際派 Flash 最小工作成功，五個帳號 `requiresActivation` 全部清除；Gemini 已恢復。東區未更新（東區 agy 若也升到 1.4.6 會遇到同樣問題，需同版本更新）。
