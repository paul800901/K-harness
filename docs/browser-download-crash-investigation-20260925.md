# 單筆下載與 Edge 程序崩潰調查（2026-09-25）

後續狀態：已完成舊下載紀錄的最小範圍相容性修補與正常 EOF 關閉，Edge／Chromium 重開下載、假登入保存實測通過，334 項測試通過。詳見 [後續修正與證據](browser-download-history-fix-20260925.md)。以下保留初期调查與當時未解的狀態，不代表仍完全無解；也不代表已修復 Chromium 的原生缺陷或可正式登入。

## 結論
已定位到 K 以外也能重現的 Edge 原生程序崩潰；尚未修復 Edge 本身，也未切換瀏覽器。
目前 Edge 153.0.4234.48。重用原本純假資料的測試 profile 時，官方 Playwright 的 `download.path()`（沒有 K、saveAs 包裝或來源標記）就能重現程序退出 `3221225477` / `0xC0000005`。
這不是 K 捕捉到單筆保存錯誤後主動關閉瀏覽器。整個底層程序已消失，不能靠 catch 把它當作仍可操作，也不能鬆開取消鎖掩蓋問題。

## 證據與對照
- K service 重現：`.runtime/download-failure-probe/93673e16-bc39-44ae-93ab-c5e5578d42c0/evidence.json`、`.runtime/download-failure-previous-console.log`。download-start → page/context close → download failure；Edge exitCode 3221225477。
- 去掉 K 後只等待 `download.failure()`：`.runtime/download-raw-edge-probe.mjs`、`.runtime/download-raw-edge.log`，本次仍存活。
- 去掉 K、改為 `download.path()`：`.runtime/download-raw-path-probe.mjs`、`.runtime/download-raw-path.log`，同一假 profile 重現相同程序退出碼。沒有載入 K 的保存／ADS 邏輯。
- 官方 repository 已有高度相符的 [issue #42506](https://github.com/microsoft/playwright/issues/42506)：重用 Edge profile、讀取下載完成資料時原生崩潰；其報告版本是 Edge 152，不能據此宣稱本機 153 的原生堆疊完全相同。
- 新 profile 本機 `.exe/.cmd/.txt` 皆完成：`.runtime/download-failure-probe/4ac887b6-a72d-46d1-ba2d-bccfd21930a2/evidence.json`。不採每次清空 profile 的 workaround，因為會破壞持續登入需求。
- 刻意取消未完成的假下載，失敗只影響該項、後續導航正常：`.runtime/download-failure-probe/003a4e05-0edc-4d9c-a962-461341c14623/evidence.json`。同一舊測試 profile 的成功也说明問題不是每次必現。
- 新增回歸測試：保存拋錯後 available=true、busy=false、context 不關閉；人工導航／點擊／交回 AI 仍可用。全套 **327/327**，`.runtime/download-failure-final-tests.log`。

## 修改與未完成
- 新增 `scripts/browser-download-failure-probe.mjs`，明確 `--run` 才啟動隔離測試；`--previous-fixture` 只使用已知純假資料的舊 fixture profile，不讀個人瀏覽器。
- 新增 `test/browser-live-session.test.mjs` 失敗範圍測試。沒有為此改寫 production session 邏輯、關掉保護或自動重送。
- 初次取消測試的假伺服器沒有送足資料，下載事件尚未觸發而等待；已調整 fixture 資料量、HTTP timeout 和關閉連線，沒有拿該次中斷當成功。
- 本機目前沒有 Playwright 對應的 bundled Chromium binary。已向使用者請求「僅 K 專案內下載及隔離驗證」；在答覆前不安裝、不改正式 backend。候選保留 Playwright/MCP/UI，只更換受測瀏覽器 binary，不自製瀏覽器。
- 未保證任意惡意網站不能觸發瀏覽器原生缺陷。此問題和 cookie／人工 token 隔離是兩件事；正式開關仍不存在，不能登入真實帳號。

## 複查指引
先確認原生 Edge 退出證據及「不經 K」對照，不再把這次失敗猜成 saveAs 的 JS rejection。替代 binary 驗證須包含：同 profile 關閉重開、正常／取消下載、人工接手、兩家 MCP、來源標記；沒有這些證據不更換正式預設。

## 使用者授權後的 Chromium 對照：未通過
- 使用者明確同意「允許，限專案內安裝與隔離驗證」，已記錄於 AGENTS.md。
- 官方安裝器只寫 `.runtime/playwright-browsers`：Chrome for Testing 154.0.8037.0 / chromium-1246，以及安裝器附帶 ffmpeg-1011、winldd-1007；沒有更改日常 Chrome／Edge、全域套件或正式預設。
- 新 profile 首次通過：`.runtime/download-failure-probe/5b279c79-b170-40fa-ab68-908ed68378b7/evidence.json`。
- **另一個程序重用同 profile 失敗，Chromium 同樣退出 0xC0000005**：`.runtime/download-failure-probe/fbab57ce-9088-4025-93dd-cadca62e009a/evidence.json`、`.runtime/chromium-download-reopen.log`。
- 對照固定原生 downloadsPath，排除每次臨時下載目錄變動：首次 `e7598952-b036-4f59-86f3-684b0b8857b2` 通過、重開 `4cc0d287-5980-4e5f-92a8-3c0f1f3b71e3` 仍同碼退出，證據同在 `.runtime/download-failure-probe/`；日誌 `.runtime/chromium-stable-reopen.log`。
- 因此不能照上游舊版報告宣稱「改 Chromium 就好了」。已否決直接更換正式預設，沒有继续浪費模型回合測一個已知未通過的候選。仍需瀏覽器原生層診斷／上游修正；目前沒有足夠證據定位原生 faulting module，也不宣稱一定是 Edge 獨有 bug。
