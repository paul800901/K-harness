# 用量、外觀與工作區交付（2026-09-14）

## 已實作

- 左下簡潔用量：Codex 帳號共用訂閱剩餘百分比；Flash 本對話累計 Token。
- Codex 使用既有官方 App Server 的 `account/rateLimits/read`，收到 `account/rateLimits/updated` 後重新查詢完整值；可見頁面約每分鐘更新，也可手動更新。不新增模型回合、不購買、不消耗重設券、不換計費或登入。
- Flash 約每 10 秒從本對話工具紀錄指定的工作 ID 讀取既有 Pi JSONL。只加總 provider 為 DeepSeek 的已回報 assistant `totalTokens`，不重複加入快取與推理 Token；重開不重複累加。回覆尚未結束或中斷缺用量，會標示執行中／部分未確認。
- 配色修正為三個獨立選項：淺色（原本白色 `#fff`）、暖色（暖白 `#fffcf8`、米灰 `#f8f3e9`、VS 藍 `#007acc`）、深色。既有 DSH 設計／捲軸 CSS 沿用，不改 DSH 本體。
- K 內建介面縮放 90／100／110／125／150%，對話與輸入文字已依後續要求擴為 **14～22px，每 1px 一個選項**；設定存在 K 的 localStorage，不依賴瀏覽器縮放選單。23:20 後驗證 19px 重載保存，再恢復使用者當時的暖色、125%、18px。
- 介面為正體中文與臺灣詞彙；補齊推理程度與工具狀態中文。模型名稱、Token、檔案路徑及工具原始輸出保留原文；頁面語系 `zh-Hant-TW`。
- 左上可選工作區，設定視窗亦有切換入口；支援輸入路徑、上一層、下一層資料夾與曾用工作區。只列下一層資料夾，不掃描檔案內容。
- 對話紀錄集中留在 K `.runtime/main-sessions`，每對話保存所屬工作區，清單按工作區篩選。重開舊對話回到其原工作區；主代理 cwd、Flash `--workspace`、附件與成果讀取均使用同一位置。
- Flash 程式及金鑰路徑仍在 K；每對話 runtime override，不寫其他專案或全域 config/trust。選資料夾不自動批准寫入。正在執行的主回合不得切換工作區。

官方協定依據：[Codex App Server](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt)。也核對本機產生的 GetAccountRateLimitsResponse、AccountRateLimitsUpdatedNotification、ThreadStartParams／ThreadResumeParams schema。

## 驗證結果

- 完整回歸 **80／80**；前端正式建置成功。沒有新增套件或變更 lockfile。
- 真實額度讀回：2026-09-14 22:55–23:05（臺灣時間）官方只回傳每週視窗，剩餘 66%；未捏造未提供的 5 小時額度。此為當時讀值，畫面後續會更新。
- 真實歷史 Flash：`main-case-cYowCN` 三次回覆 895 + 1,232 + 1,598 = **3,725 Token**。UI 與後端一致，反覆更新及重啟後不倍增。
- 舊 Astra 對話 `01a09f15-cdf1-7822-939c-f3c51c632a4b` 已於新版後端重啟後接續：歷史、corrected.json 成果清單、Token 回讀成功；未送出模型訊息或重新派工。
- UI 選擇人工資料夾 `D:\K-harness\.runtime\main-tests\case-cYowCN`，Sol 新對話 `01a0a071-c89b-7b21-adc8-efbba0ec15a9` ready；實際執行中 Flash MCP 程序的 `--workspace` 精確指向同資料夾。這次只驗證 runtime 接線，沒有在新工作區再發付費模型任務，也沒有代核准寫檔。
- 自動測試另覆蓋：工作區不同時附件不能串用、原對話重開恢復其資料夾、無效位置不丟失目前對話、工作中切換被拒絕。
- 瀏覽器實際操作：縮放與字體選單、重載保留設定、淺／深切換、工作區瀏覽與選取、重開歷史、用量卡。修正 150% 設定視窗裁切及 125% 主畫面右側未填滿。1920×855 視窗下 app 實測 1920×855、zoom 1.25、對話 CSS 字級 20px。900×720 測試下 app 尺寸吻合、送出按鈕位於畫面內；未宣稱所有尺寸全面驗收。
- 最後一次頁面檢查沒有瀏覽器 console error。

## 邊界與未完成事項

- Flash 顯示的是 **本對話 Token**，不是整個 DeepSeek 帳號消費、餘額或精確美元／人民幣帳單。此次依使用者「價格或 Token」先做實際 Token，不硬套可能過期的單價。
- 「即時」是官方額度事件與定期查詢、模型回覆完成後的 usage 回報，不是每生成一個 Token 就有正式帳單。網路失敗保留舊數字並註明舊資料；未知不當作 0%。
- Codex 尚未送出第一則訊息的空白 thread 有時沒有落地 rollout，重啟後無法 resume；顯示中文提示請建新工作，舊清單仍保留，不自動重建或重送。有內容的歷史恢復已另行實測。
- 仍一次一個主對話運作。終端舊入口只允許 K 根工作區，避免把圖形介面的其他工作區對話錯誤恢復到 K 根。
- 現有啟動器仍依賴 Node、官方 Codex 安裝與瀏覽器 app 視窗；**這不是已完成獨立桌面 EXE 封裝**。縮放功能在 K 本身，之後桌面 WebView 可沿用，但該封裝尚未實測。
- 只作非臨床工作，既有權限／工人驗收邊界不變。沒有接入 CaseAgent、改 DSH、刪除歷史或修改全域登入與計費。

## 本輪修改

`src/usage.mjs`、`src/workspaces.mjs`、desktop-controller/server、main-sessions/main-cli、main-workers、mcp-stdio；`frontend/usage.jsx/css`、`workspace.jsx/css`、`appearance.jsx/mjs`、main.jsx、style.css、index.html；usage/workspaces/appearance/desktop/main-sessions 測試與本文件。舊 source 備份保持原樣，沒有覆蓋或清理。
