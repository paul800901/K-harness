# 附件漏存修正與輕量檔名標籤

## 結論與使用者要求

**2026-09-25 22:26 正式 K 後端已安全重啟並套用；22:27–22:28 原使用者視窗與正式 API 讀回通過。**

使用者本輪明確要求修後端，不做縮圖／放大檢視。附件呈現為「PNG＋檔名前段」，過長以省略號截短，滑鼠停留以瀏覽器原生 title 顯示完整檔名。這項要求覆蓋上一輪提議的縮圖補回；沒有新增圖片檢視器、預覽快取或另一套附件歷史。

## 已確認的根因

- 原訊息「看看?」的 PNG 已實際送進 Claude 原生對話，不是圖片送失敗。
- `src/claude-controller.mjs` 原本讀取附件並組成原生 image/text payload，但 `appendMessage` 建立的 K 顯示紀錄保留 `attachments: []`，送出時沒有存回附件 metadata。因此 UI 只有文字；原生 replay 也不補這個 K 欄位。
- 精確核對同一原生訊息 UUID 的 PNG 與 K upload：345,395 bytes，SHA-256 同為 `48b0efa414d080b5a628a522a4472d32500c5d6b512e28c62892653a16b0ac0f`。不把「看不到標籤」誤當作模型沒收到。

## 差異與檔案

| 檔案 | 本輪最小變更 |
| --- | --- |
| `src/claude-controller.mjs` | 沿用原來的附件載入與跨室驗證，收集 records；在附件完整讀取、來源 host 未改變的檢查後，設回 `sentMessage.attachments`，沿用現有保存流程。原生傳圖內容不變。 |
| `test/claude-controller.test.mjs` | 新增圖片＋文字附件 metadata、原生 replay、close/reopen 保留測試；外室附件在原生 start 前拒絕。 |
| `frontend/main.jsx` | 草稿與已送出附件共用簡短類型／檔名標籤；title 保留完整檔名，移除附件縮圖／大小文字。草稿的讀取中／警告／移除仍保留；已送出附件沿用既有直接下載連結。 |
| `frontend/style.css` | 標籤窄版、檔名 ellipsis；色碼與字級仍用共用變數，移除附件 img 專用樣式。 |
| `test/attachment-label-ui-probe.mjs` | 只有假後端／隔離 Chromium 的 UI 回歸，不連真模型、不讀日常瀏覽器 profile。 |
| `README.md`、`docs/development-log.md` | 更新最新狀態及本紀錄索引。 |

這次沒有新增套件、預覽端點、持久狀態、背景服務或全歷史 migration；沒有提交／push，也沒有改模型、權限與計費。

## 驗證

證據根目錄：`D:\K-harness\.runtime\attachment-label-20260925`。

- 全套 `npm test`：**401/401**，`npm-test.log`。包含其他並行任務已加入的既有測試，不把全部 401 項當成本輪新增。
- Claude 聚焦測試：**37/37**；主代理獨立檢查修改及回歸結果。
- 樣式／外觀：**8/8**，`style-tests.log`。
- 隔離建置成功：`build/`；只有既有 bundle 大小提示，沒有為此擴大重構。
- `ui/result.json`：Claude 與 Codex 共用 UI 都通過 clipboard paste → 原檔 base64 上傳至正確聊天室 → 移除／重貼 → 只送一次附件 ID → 已送出標籤。完整 title、實際 ellipsis、草稿清除、既有下載均驗證。
- 兩供應商各 3 主題 × 2 寬度（1920／1024），共 12 張已送出畫面，加 2 張草稿畫面；沒有頁面橫向溢出或 JS error。Astra 親看暖色／深色窄版／草稿代表圖。
- 顯示標籤時 **0 次附件內容自動請求、0 張附件 img、0 個放大對話框**；只有按既有下載連結才取檔。
- `navigation/result.json`：既有 **9 類**跨聊天室操作通過，草稿、附件、停止及晚到送出回覆的歸屬不受影響。

## 原訊息精確補回

- 聊天室：`claude-00895023-cd8d-4fea-9047-934671aea34e`。
- 訊息：`6faf8bc8-029f-4083-b451-5c19d0bb6643`，文字「看看?」。
- 附件：`4670e1a7-a5e3-406c-89d7-cc301f0a19cd`，原始檔名 **image.png**；短檔名不需強制省略。
- 正常關閉後端後，先備份整份 K projection 至 `before/claude-projection.json`，再次核對原生 UUID／PNG hash／upload 所屬聊天室，再只修改該訊息的 attachments。
- 語意深比較確認除此欄位外全份 projection 不變；沒有修改 Claude 原生 JSONL、原圖或其他舊訊息。並非為所有舊附件做模糊猜配。
- `repair-and-deploy.json` 保存精確補回及部署 hash。這是一次性修復，不把修復腳本接入日常執行。

## 正式部署與 live 讀回

1. 原視窗無草稿、未送出附件或待送訊息。
2. `/api/state` 列出三個已開啟聊天室，均非 busy、沒有待確認；各室 `/api/workers` 空，對應持久佇列均空。新鮮狀態再讀回後才送正常 shutdown，沒有強殺或中斷工作。
3. 22:25:26 正常關閉舊 PID 35072，確認 47831 已釋放；補回單則 metadata。
4. 先放新 hash assets，再切 `dist-ui/index.html`；所有舊 assets 保留。使用原 `Start-K-Desktop.ps1 -NoBrowser` 啟動，22:26:07 新 PID **50264** 提供相同本機服務。
5. 正式 HTTP 讀回 index 與所有 assets hash 等同隔離候選；原使用者 K 視窗重新整理、從清單重開同一對話，實際看到 **PNG image.png**。
6. 原生對話仍是同一 session，K 訊息共 **31 則**及所有 user message IDs 均與重啟前一致；整份原生 JSONL SHA-256 仍相同。**沒有重送 PNG、沒有新增模型回合**。
7. 正式 UI title 是 `image.png`，沒有附件 img／錯誤，17px／110% 保留。原 `claude-opus-5-5`／`claude-auto` 不變；正式瀏覽器仍關閉。未啟用隔離 runner、啟動 token 選項或 PWA 候選。

證據：`formal-before.json`、`repair-and-deploy.json`、`http-readback.json`、`formal-after.json`、`live-ui.json`、`live-attachment-label.png`。

正式 index SHA-256：`69f730ffb39e7f4e170228ba16fb0f17aac574d5018c3b31fe0538dd0d1f3ff0`。

## 回復及剩餘邊界

- 前端回復：`before/index.html` 是本輪套用前的正式入口；舊 assets 未刪，僅需回復這個入口並重新整理。不要清掉其他工作。
- 後端回復只撤本輪 send 流程的附件收集／存回行，不可用工作樹整體 reset。若需再重啟，一樣先查所有聊天室均已閒置。
- projection 備份僅供核對與單欄位回復；若已有新對話，不可直接拿整份舊備份覆蓋後續訊息。
- 新送出路徑已由假原生 host＋隔離 UI 驗證，正式驗收使用原有真實 PNG 的精確補回與重開讀回；**沒有為測試額外要求模型再看一次圖**。
- 其他歷史缺失附件未擅自批次修補。本次需求完成；工作列 PWA、真實待核准狀態同步、Windows 標題列是其他任務，不在此提升驗收狀態。
