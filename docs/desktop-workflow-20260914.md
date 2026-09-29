# K HARNESS 桌面工作介面交付（2026-09-14）

## 結論與入口

本輪已完成「安裝在 K 專案內，接成可操作介面」的範圍，不再只是原生文字框加 DSH 樣式。已建置並啟動，使用 `http://127.0.0.1:47831/`；桌面「K HARNESS」仍指向 `D:\K-harness\Start-K-Desktop.ps1`。目前一次一個作用中的對話、固定 K 工作區，適合已驗證的非臨床檔案工作，不代表完整取代 Codex App。

主控仍是官方 Codex App Server 的 Astra／Sol，沿用既有 ChatGPT 訂閱登入；Pi／DeepSeek Flash 的派工、工具範圍與紀錄不變。沒有另建模型帳號系統、重做 GPT 對話記憶、改動 DSH、全域登入、模型或計費設定。

## 實際使用的開源元件

採 [assistant-ui ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store) 接 K 已有的訊息、執行狀態和操作，而非移植另一套後端。實際使用其 Thread、Composer、Message、ActionBar 與 Markdown 元件；K 自己提供對話側欄、成果／活動／核准面板。

- `@assistant-ui/react` 0.15.19、`@assistant-ui/react-markdown` 0.14.15。
- React／React DOM 19.2.4、remark-gfm 4.0.1、lucide-react 0.577.0。
- Vite 8.3.0；React 型別套件 19.2.14／19.2.3。
- PDF.js 6.3.289 與 mammoth 1.12.3，用於 PDF／DOCX 文字擷取。
- 以上僅安裝於 K 的 node_modules，版本鎖定於 package-lock.json；未安裝全域套件。安裝時停用套件生命週期腳本。DSH 獨立主題 CSS 及既有授權說明保留，並非整套 DSH UI 搬遷。

## 已實作功能

- 新工作可選 Astra／Sol；推理程度由帳號實際可用清單提供，預設沿用回傳設定，不自動升降。本輪 live 案例使用 low，沒有宣稱是 Ultra。
- 串流回覆、Markdown 表格、程式碼區塊與複製按鈕；外部圖片不自動下載、HTML 不執行。
- 檔案選擇器、多檔附件、拖入檔案及貼上圖片入口。附件保留原始 bytes，PDF／DOCX 另有擷取文字；圖片以正式 localImage 輸入提供主代理。
- 已送出附件在重開原對話後重新讀回，不能把其他對話的附件 ID 帶入。附件內容明示為資料，不是額外操作指令。
- 側欄按標題、模型、ID 搜尋；重新命名、釘選、封存／還原均是 K 本機清單 Metadata，不修改官方對話歷史、不刪對話。
- 同一瀏覽器視窗內依對話暫存文字草稿；重新整理可找回。尚未送出的附件選取不宣稱跨重啟持久保存，切換時會提示；已上傳原檔不刪除。
- 成果面板從原工人指定輸出建立清單，只允許預覽／下載列入該對話的檔案；檔案存在不代表通過驗收。
- 工具活動顯示參數與有限長度輸出；重開時可從原始對話回填工具紀錄。核准卡片顯示實際請求，只允許一次明確同意或拒絕，沒有永久核准。
- 停止主回合及可確認工人、淺／深色、可收合面板、設定視窗與停止後端。

## 驗收證據

### Astra 圖形介面

原生 thread `01a0a04e-f404-7bc3-8bc0-9607971833f8`，K 清單名稱「介面驗收｜附件、表格與續聊」。

1. 從實際檔案選擇器上傳 `examples/ui-acceptance-20260914.txt`。Astra 讀回後正確列出青蘋果 7、橘子 12、合計 19，以及 `K-UI-914-TEXT`。畫面呈現真正表格和 JSON 區塊。
2. 從畫面上傳人工 PDF、DOCX 和左右紅／藍 PNG。PDF 與 DOCX 均讀出 7 + 12 = 19，圖片回答左紅、右藍，沒有派工或模型寫檔。
3. 命名、釘選、封存、在封存清單找回並還原皆操作成功；文字草稿重新整理後仍在輸入框。
4. 切換到舊人工驗收對話，再回來，原文字與附件可讀。正常停止後端並重新啟動，原對話、四份已送附件與回覆仍可找回，未自動重送。

### Sol 圖形介面與核准

原生 thread `01a0a059-3102-7c13-a125-95a8e730ca7a`，K 清單名稱「介面驗收｜Sol 核准與停止」。

- 從新工作視窗選 Sol，真實回覆 `K-SOL-UI-914`。
- 原生 start 請求 `ui-denial-20260914-sol` 觸發核准卡片，readFiles／outputFiles 皆空。畫面完整顯示請求；操作者按拒絕後，Sol 回報拒絕並結束，紀錄僅一次 failed 的 start，沒有重試。
- 沒有授予本輪新 Flash 寫檔權限。圖形介面的一次「接受並完成寫檔」沒有另做 live；先前 Astra／Sol 真實工人閉環證據仍見 `main-host-validation-20260914.md`，不能混為本輪圖形操作證據。
- 修正後由畫面停止一次唯讀回合：實際狀態 interrupted、busy=false、questions=0、error=null；輸入與新工作恢復可操作。

### 成果、啟動及回歸

- 從 K 清單重開既有人工 thread `01a09f15-cdf1-7822-939c-f3c51c632a4b`，找到 `.runtime/main-tests/case-cYowCN/corrected.json`。預覽顯示原 marker、X／X／Y、13 與 unknownOwnerIds X，沒有重派工作。
- 成果／附件 HTTP 下載測試確認原始 bytes、附件回應標頭與只讀取清單內路徑。修正後預覽視窗中的下載連結保持完整相對路徑。瀏覽器下載按鈕已點擊，但自動化下載事件等待逾時，沒有將瀏覽器另存完成宣稱為已驗收。
- `Start-K-Desktop.ps1 -NoBrowser` 真實啟動成功；重複執行前後 PID 均為 32784，沿用同一個後端。既有桌面捷徑目標、參數、工作目錄已讀回；自動開窗未重試先前被政策拒絕的操作。
- `npm run build:ui` 成功，打包輸出位於 dist-ui。約 201 kB gzip 的主腳本仍有 Vite 500 kB 未壓縮大小提示，並非建置失敗或速度比較證據。
- 最後完整 `npm test`：68／68 通過，涵蓋原 worker／MCP、附件 bytes／PDF／DOCX、跨對話拒絕、原對話恢復、送出中停止競態、下載路由及一次性核准。沒有使用真實病歷。
- 實際 Chrome 頁面檢查沒有 JavaScript error；淺色與深色設定視窗皆目視檢查，交付時恢復淺色。

## 本輪實際抓到並修正的問題

1. PDF.js 新版文件物件清理 API 不符，以及 Windows 字型資料夾斜線：改用實際 loading task 清理與本機標準字型路徑，PDF 擷取重測通過。
2. 附件上傳途中切換對話可能錯掛：上傳明確帶 threadId，前後各自檢查；不是依回來時的作用中對話猜歸屬。
3. 重開對話附件不見：從原訊息內的附件 Metadata 定位原檔，驗證對話歸屬後恢復，不重新上傳。
4. 送出瞬間按停止可能漏掉尚未取得 ID 的回合：保留停止意圖，等待同次送出完成後中斷，無重派。
5. 預覽回傳 basename 覆蓋完整路徑：下載保持原對話核准的相對路徑。
6. 加附件／移除附件按鈕被聊天 form 當成 submit：明確設為普通按鈕。曾誤送一則人工草稿，紀錄保留；修正後先填文字再加入三檔、移除與重新加入圖片，確認沒有提前送出。
7. 停止已成功但 API 空回應造成 JSON 誤報：回傳明確的 stopRequested 結果，HTTP 與 Sol live 停止重測通過。
8. 後端 workspace 末尾斜線導致重複啟動誤認成其他服務：比較前正規化末尾斜線；重複啟動同 PID 驗證通過，不改變不同服務不可占用／終止的邊界。
9. 快速保存清單 Metadata 可能檔名衝突：使用不覆寫的新紀錄名稱；終端重開也保留既有標題、釘選與封存值。名稱保存失敗不再誤報成模型訊息未送出。

## 修改與回復位置

- 新前端：`frontend/index.html`、`frontend/main.jsx`、`frontend/style.css`、`vite.config.mjs`。
- 套件：`package.json`、`package-lock.json`；`.gitignore` 排除 dist-ui。
- 接線及檔案處理：`src/desktop-controller.mjs`、`src/desktop-server.mjs`、新增 `src/desktop-files.mjs`。
- 清單保存／入口：`src/main-sessions.mjs`、`src/main-cli.mjs`、`Start-K-Desktop.ps1`。
- 測試：`test/desktop.test.mjs`、新增 `test/desktop-files.test.mjs`、`examples/ui-acceptance-20260914.txt`、`scripts/ui-image-fixture.mjs`。
- 說明：README、本文件。舊 web 前端、DSH CSS 授權及歷史驗收文件保留，沒有清理使用者資料。
- 修改前原始碼與套件清單備份：`.runtime/desktop-source-backup-0fda1af3c9de477c8064739c70f7a523.zip`（79,862 bytes）。不含金鑰或執行歷史；回復前需停止 K、另存之後新增的變更，不能直接覆寫使用者後續工作。

## 仍然成立的限制

- 不是獨立免安裝 EXE；啟動器依賴目前 K 資料夾、Node 與既有 Codex 安裝。此處只綁 127.0.0.1，不開放區網。
- 一次一個作用中的主對話；後續已加入工作區選擇與簡潔用量卡，詳見[後續交付](desktop-usage-workspaces-20260914.md)。仍無多個主對話同時跑、完整編輯器／差異審閱或所有 Codex 外掛／瀏覽器工具。
- 附件每則最多 8 份，每檔最高 8 MB；純文字／擷取文字最高 256 KiB；PDF 最多 60 頁，沒有 OCR，不保證表格版面／內嵌圖片。DOCX 只擷取文字；尚不支援 XLSX、音訊與影片解析。
- 拖放與貼上圖片入口已實作，這輪實際上傳驗收使用檔案選擇器；未冒充三種方式都做了端到端測試。小螢幕響應式版面未全面驗收。
- 主代理仍唯讀，寫入依明確工人範圍和逐次核准。Pi 工具限制不是通用 OS 沙箱；不接病歷或敏感正式流程。
- 這次證明了具體短工作、圖形操作與重啟恢復，沒有證明任意長程任務完美、成本比 Codex 低、速度相等或更快。
