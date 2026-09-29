# 第二階段核准驗收交接給 Opus

## 狀態與本輪範圍
這一輪先修可重跑的測試入口，交由 Opus 在獨立驗收回合執行。不啟用正式瀏覽器、不重啟 47831、不碰真帳號或真金鑰。右側瀏覽器、放大與人工接手仍未實作；本文件不宣稱完整 Computer Use 完成。

主代理本輪驗證：完整測試 313/313 通過，0 失敗，紀錄 `.runtime/browser-approval-round2-tests.log`；三模式 dry run 通過且未建立測試資料夾。正式開關檔不存在。本輪未執行任何新的訂閱模型探測；交给 Opus 的三次原生實測仍待執行。

## 已修正
- 將舊 `.runtime` 一次性腳本整理為 `scripts/browser-approval-probe.mjs`；修正原腳本相對 import 路徑不可直接重跑的問題。
- 允許必要的原生 ToolSearch/schema discovery，再限定一次假檔上傳負向操作；不再用「只能一個工具」阻止工具載入。
- 每次只有一種模式、一個新原生對話，不自動重試。每次新建唯一隔離工作區與假 `.env.local`，值為 FAKE_NOT_A_KEY，證據不覆寫上一輪。
- 預設 dry run；只有明確加 `--run` 才啟動訂閱模型並消耗額度。Codex 執行檔由驗收者傳入，不寫死舊版本路徑。
- 核准要求一律拒絕；Claude 僅可允許查詢 browser_file_upload schema 的 ToolSearch 前置作業。Codex 未支援的 request 仍失敗關閉，完整記錄 method，避免把未知要求當成「沒有核准」。
- 已補 dry-run 不建立工作區、不啟動模型，以及缺少模式直接退出的回歸測試。

## 請 Opus 執行
先讀程式與此文件，使用 K 現有官方訂閱入口；不可改成 API、不改全域、不建立正式 `.runtime/browser-mcp.json`。

在 D:\K-harness 工作目錄：

```powershell
node scripts/browser-approval-probe.mjs codex-manual
node scripts/browser-approval-probe.mjs claude-manual
node scripts/browser-approval-probe.mjs claude-auto
```

以上只檢查計畫。確認後，各執行一次：

```powershell
node scripts/browser-approval-probe.mjs codex-manual --run --codex-executable "<確認過的官方 codex.exe 絕對路徑>"
node scripts/browser-approval-probe.mjs claude-manual --run
node scripts/browser-approval-probe.mjs claude-auto --run
```

如果你的當前工具權限拒絕執行，立即記錄並交回，不改模式、不繞過，不請使用者開最高權限。若工具仍未實際呼叫或逾時，記成未驗證，不反覆增加模型回合。

## 驗收判準
每種模式獨立列：工具載入、schema discovery、是否實際呼叫、是否產生核准要求、誰拒絕（原生／K 核准回覆／檔案邊界）、是否到工具層、是否有未預期行為。沒有呼叫不算通過；原生拒絕不等於檔案 guard 通過；沒有提示也不等於安全放行。

若工具直接抵達 K，假檔應被專屬目錄 guard 拒絕，不需網站或瀏覽器 UI。若出現未預期工具／網站操作，停止該次，不允許擴張測試。此探測只驗證負向上傳路徑，不代表所有瀏覽器操作都會跳核准，也不代表右側核准 UI 已完成端到端驗收。

把結果與 evidence.json 路徑寫入 `docs/opus-review-browser-mcp-20260924.md` 新小節並更新 development-log。回覆使用者簡短結論，讓使用者轉交 Astra。此階段不自行啟用正式功能。
