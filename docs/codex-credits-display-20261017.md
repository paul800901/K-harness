# Codex 點數與重置次數顯示（2026-10-17）

## 需求

本人在東區要求 K「額度與用量」顯示 Codex 剩餘點數與可用重置次數（ChatGPT 設定頁「使用量與帳單」所列），只顯示；使用重置由本人在官方 App 操作，K 不接。Claude 點數不接：Claude Code `get_usage` 只回 rate_limits 與本次 session 花費，沒有點數或重置欄位；硬接須拿登入憑證呼叫 claude.ai 內部介面，違反憑證規則，本人也表示不買 Claude 點數。

## 變更

程式 commit `c81575357db6997bd68014403c0a10d7c855f5ed`（基於 main `8dedd8b`，程式等於正式 7271fde）。

- `src/usage.mjs`：`codexQuota()` 保留官方回應已有的 `credits {balance, unlimited}` 與 `rateLimitResetCredits {availableCount, items[{title, expiresAt}]}`（只留 status=available）。欄位依 codex-cli 0.159 `app-server generate-json-schema` 的 `GetAccountRateLimitsResponse`。
- `src/desktop-controller.mjs`：`account/rateLimits/read` 改送 `excludeResetCreditDetails: false`，每次查詢都取重置明細。
- `frontend/usage.jsx`：Codex 區塊加一行「剩餘點數／可用重置」，「查詢與重設時間」內列各重置到期時間；官方未給明細時標「官方未提供」。
- 測試：`test/usage.test.mjs` 新增點數／重置解析；`test/desktop.test.mjs` 斷言每次查詢都要明細。

## 複查與取捨

- GPT-6.1 Sol（high）複查，證據存 `.runtime/archive/codex-credits-review-20261017/review.md`。初版是背景查詢只取次數、人工更新或首次才取明細，次數不變時沿用舊明細。Sol 實際重現兩個問題：背景查詢進行中按人工更新會被合併、拿不到明細；舊券失效同時補新券時次數不變，會顯示舊到期時間。採 Sol 建議改為每次取完整明細，刪掉沿用與分流邏輯；代價是 K 開著時每分鐘多一次官方明細查詢。
- Sol 另指出 `toLocaleString()` 會捨入小數點數，已改 `maximumFractionDigits: 20`。
- 程式由 Opus 5.5 主代理撰寫、Sol 複查，不屬「GPT 程式須 Opus 審核」的情形。

## 驗證

- `npm test` 1736/1736 通過；`npm run build:ui` 成功。
- `npm run test:ui`（東區新裝 `.runtime/playwright-browsers` Chromium 1246）：
  - `usage-layout` 通過；Sol 另以臨時擴充的 probe 驗過餘額、次數、到期、不限、未知值與窄版面（未併入）。
  - `voice-composer` 失敗：Sol 在乾淨基底重現，東區測試環境為 `K_DICTATION_PROVIDER=windows`，兩版辨識回傳相同、不含「語音」的文字而逾時，與本改動無關。
  - `mobile-remote`、`menu-viewport`（新對話 provider 分頁於手機橫向）時過時不過；`mobile-remote` 在基底同樣失敗過，`menu-viewport` 重跑兩次一敗一過。判為既有不穩定，非本改動。
- 未用真帳號讀回點數／重置；須部署後在正式 K 對照 ChatGPT 設定頁。

## 部署狀態

- 原計畫：K 內 AI 不能更新所在 K；由本人在 K 外（VS Code）停止 K 後部署 `c81575357db6997bd68014403c0a10d7c855f5ed`，正式讀回後再 push。
- 2026-10-17 東區已部署（K 外 Claude Code 執行）：
  - 部署前：無 trusted-runtime 的 electron／node 程序，47831 未監聽；工作樹乾淨，HEAD `01a7ee6`，`c815753…^{commit}` 核對一致，與 `01a7ee6` 只差本文件與 development-log。
  - 第一次 `Update-K.ps1` 在建置中止：執行者外層加了 PowerShell `*>&1` 重新導向，配合更新器 `$ErrorActionPreference='Stop'`，把 vite-reporter 寫到 stderr 的一般訊息轉成錯誤。正式版未動（仍 7271fde、無新退版、無殘留程序）。拿掉重新導向後照原指令重跑，流程未改。
  - 第二次：完整測試 1736/1736 通過，結束代碼 0，已套用。
  - 讀回：`.local/runtime.json` version `c81575357db6997bd68014403c0a10d7c855f5ed`，與部署前相比只改 `version`、`previous`；`dictationProvider` 仍為 `windows`。退版 `releases/before-1792211163138`（7271fde），`before-1792179282418` 保留；最舊的 `before-1791005494895` 依更新器保留 3 份的既定規則移入資源回收筒。
  - 啟動 K 一次，health `deployment: native`，47831 由 trusted-runtime Electron 監聽。
  - 本人開「額度與用量」對照 ChatGPT 設定頁確認無誤：GPT／Codex 顯示「剩餘點數 61,850.9308535　可用重置 1」（依上述不捨入的設計顯示完整小數），重置到期時間正確。
  - 未升級三家核心，未改登入、計費，未重播工作。
- push：`01a7ee6` 已推 origin/main，`git ls-remote` 讀回 `01a7ee666f5ee3136aede9dca4f31e523e618d7a`。本部署紀錄為之後另一個文件 commit，不重新部署程式。
- 第一次誤改 `C:\K-harness` 的舊 main（當時落後正式版 222 commits），本人重開 K 看不到變化；已還原並改在正式版基礎上重做。同輪將東區修補 7271fde 合回 main（`8dedd8b`）並已 push，清理已合併分支、工作樹與舊 `prepare-*`。
