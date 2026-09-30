# 模型選單精簡與正式套用（2026-09-30）

狀態：**使用者接受預覽後，23:14 已正式套用並由正常入口重開 K；5 檔讀回一致，正式 Electron 介面實際操作通過。** 建置、497/497 測試與假資料互動證據見下方；未發送真正模型工作。

## 使用者要求與根因

使用者指出模型卡片隨官方清單增加而換行，Claude 已擠成三行；新對話視窗太長，且直接顯示官方英文宣傳文字。確認採提供者切換、系列分組的單欄下拉選單、推理程度下拉選單，正常登入與子代理設定預設收合；使用者回覆「好 就這樣看看成品」。本輪先交可操作的介面預覽。

根因是前端把所有官方模型與推理程度展平成卡片，並直接輸出 selected.description；不是目錄資料或原生模型能力異常。

## 實際變更

產品只改兩檔：
- frontend/model-picker.jsx：模型選單依系列分組、同系列版本由新到舊；未知系列仍列於「其他」，不過濾新官方模型。沿用 Chromium 原生 popover 的外點／Esc 收合；上下鍵、Home、End、Enter 可選取。推理程度用原生 select。
- frontend/model-picker.css：取代舊步驟框、卡片換行與疊加覆寫；正常新對話為 540 × 529 CSS px，不必捲動。保留現有色彩／字級變數。

GPT：Sol、Astra、Luna、Terra；Claude：Opus、Sonnet、Haiku、Fable。不增加第二層「先選系列」操作，也不因呈現排序改變原本預設模型。

正常登入只顯示一行；展開仍可查看狀態、登入、刷新或停止登入。所選提供者未登入時展開登入區。子代理保留模型＋推理程度摘要，展開後可編輯；送出的 workerPolicy 與原生權限欄位不變。已有對話維持同一提供者。

英文宣傳說明不再顯示，不建立逐模型的翻譯維護表。模型專有名稱保留；已觀察到的 Requires usage credits 額外用量訊息轉為「需額外用量點數」，在選項與選取後保留，不按 Fable 名稱自行推定計費。未知官方 effort 保留原值，不默默改成已知強度。

無後端、路由、權限、計費、登入資料或套件變更。兩個產品檔合計較基準增加 879 bytes（以 LF 計算）；增加的是單一選單必要分組與鍵盤互動，不新增 framework、快取或重試。

## 驗證

- npm run build:ui：通過；既有 bundle 大於 500 kB 提示仍在，非本輪失敗。
- npm test：**497/497 通過**。
- test/model-picker-compact-ui-probe.mjs：Astra 獨立實跑通過。14 個假官方模型（包含未知系列／effort）、兩提供者分組與排序、鍵盤與滑鼠、Esc 焦點回復、點旁邊收合、英文說明移除、額外用量中文提示、登入收合／未登入展開／停止登入、子代理 Sol 6.1＋ultra 正確送出、既有對話不得跨提供者、取消不送 model 請求。
- test/model-picker-ui-probe.mjs：更新舊卡片 locators 與目前 snapshot 事件格式後，Luna 及 Astra 各實跑通過。建立假對話只送一次，工作區、模型、effort、權限與 Luna/high 預設正確；連線中取消仍可用，沒有重送。
- 實際建置畫面：1440×960、1280×720、1280×720／150% 縮放、520×720 及深色主題皆通過邊界檢查。11 個 Claude 與 8 個 GPT 選項保留，選單可捲動；Astra 已檢視截圖。150%／低高度時主視窗仍採原本捲動，不保證全部控制項同時顯示。
- 預覽用本機假登入／假 API；沒有呼叫模型、消耗模型額度或登入真帳號。Claude 目錄採之前已讀回的 2.1.285 清單；GPT 補齊截圖中的名稱作視覺 fixture，不宣稱再次連線取得新的官方清單。

中途狀況：新 probe 初稿的外點測試點在整個 dialog 外，依原行為一起關閉 dialog，後續找不到按鈕；改成點 dialog 標題驗證只關選單。同步修正 probe 的舊 SSE 裸 state、隱藏 popover 仍在 DOM、fixture effort 等測試假設；未為測試改掉產品功能。預覽腳本初次過早自動開視窗，被初始 state 更新收回，已在畫面就緒後開啟；首次失敗紀錄保留為 visual-run1.json。額外只讀正式 CSS 檔檢查發現其來源檔未隨 runtime 配送（ENOENT），並非產品錯誤，不以不存在檔案宣稱一致。

## 程式、證據與預覽

- 候選工作樹：C:/Users/Paulus/.codex/worktrees/r2-simplification/K-harness（codex/r3-2；開始時 HEAD 11b75e2）。
- 證據目錄：C:/Users/Paulus/.codex/worktrees/r2-simplification/K-harness/.runtime/compact-model-picker-20260930/
- full-test.log、behavior-run2.log、connection-cancel-run2.log、visual-result.json、build.log，以及 *.png 截圖。
- 暫時本機預覽：http://127.0.0.1:5191 。直接使用本輪 dist-ui，不是另畫的樣稿；選單可操作，POST 一律回覆「這是介面預覽」，不會建正式對話。預覽執行檔與 PID 記在同目錄 preview.mjs／preview-server.json，僅供本次看版型，不是正式新增服務。

## 23:08 預覽完成時的正式狀態

正式 frontend/model-picker.jsx 仍逐字（正規化 CRLF）符合改前 HEAD；正式 dist-ui 仍引用 index-BP3YcQJV.js／index-BkKrKFLz.css，本輪候選是 index-DUZMyD4a.js／index-Doe0qPzt.css。未覆蓋正式檔、未重啟 K、未操作使用者 Chrome。

等使用者看過成品後再決定正式套用。尚未驗證正式 Electron 視窗的實際手動操作／真正模型連線；本輪只變前端，不以假資料通過宣稱正式已生效。未處理 R3-3 或根目錄舊架構合併等其他工作。

## 23:14 正式套用與畫面讀回

使用者接受成品並要求換上。套用前確認正式 K 已停止：47831 無服務、無正式 Electron／系統匣程序；啟動紀錄亦顯示 23:11:33 正常停止。沒有強制結束工作或改動日常 Chrome。

- 正式位置：`D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime`。
- 只配送 `frontend/model-picker.jsx`、`frontend/model-picker.css`、`dist-ui/assets/index-DUZMyD4a.js`、`dist-ui/assets/index-Doe0qPzt.css`、`dist-ui/index.html`。先放資產，最後切換 index；未複製整個工作樹，未帶入共享知識或其他後端變更。
- 還原備份：`D:/K-harness/.runtime/releases/compact-model-picker-before-20260930-231446`。舊 index／JSX 已備份並核對；舊 hashed 資產保留。需還原時停止 K、還原備份的 index／JSX 即可，新增資產不必刪除。
- 23:14:49 由 `D:/K-harness/Start-K-Desktop.ps1` 正常啟動。正式 health 回覆 `deployment: native`；五個部署檔案 SHA-256 與候選完全一致。
- 實際操作正式 Electron 視窗：新對話視窗 540×529、帳號與子代理收合；GPT 8 模型按 Sol／Astra／Luna／Terra／其他分組，Claude 11 模型按 Opus／Sonnet／Haiku／Fable 分組。切提供者可直接收合舊選單，捲動與 End 鍵可到清單底部，Esc 收合且不改 Opus 5.5 選取。英文宣傳句已消失。最後按「取消」，未建立對話、未改既有模型／權限、未送訊息。
- 額外用量提示的來源條件仍由假資料測試覆蓋；目前 2.1.285 讀回的 Fable 說明未含額外用量字樣，故不自行按名稱加收費判定，也不宣稱本次做過計費驗收。
- 中途原始 HTTP 資產請求被既有可信桌面入口檢查拒絕；沒有繞過或修改檢查。本次正式驗收採磁碟五檔讀回＋原生 Electron 真實畫面，而非宣稱匿名 HTTP 資產讀回成功。
- 部署收據與介面讀回：`D:/K-harness/.runtime/compact-model-picker-release-20260930/deployment-receipt.json`、`formal-ui-readback.json`；工具紀錄保留實際畫面。先前 5191 假資料預覽於正式換上後結束，不留新增常駐服務。

範圍結案：只有已接受的模型選單介面更新。完整測試未因配送重跑，沿用同一份未變動的已驗建置。真正模型回合、新登入與既有聊天室送出不在本輪 UI 配送驗收內，沒有為此消耗模型對話額度；R3-3／根目錄舊來源清理未納入。
