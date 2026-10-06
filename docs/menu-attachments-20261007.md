# 選單裁切與原始附件串流補修（2026-10-07）

## 使用者要求與部署邊界

- 詳細檢查桌面、手機所有選單，修正側欄底部選單被裁切。
- K 不應自行把 GPT 的 M4A、MP4 與 DJI LRF 擋在原生核心之前；大檔不能停在「正在讀取」而沒有進度或取消。
- **本批先準備、驗證並停止；使用者後續通知「離開並停止 K」後，才確認停止並套用。** 此停機邊界優先於過去的自動部署流程；本次正式結果見末節。
- 不讀取或上傳使用者真實錄音、影片與臨床工作；所有本批附件及 UI 測試為合成資料，不操作正式對話或執行中的工作、不改帳號／金鑰；隔離新建的原生假資料回合另列結果。

## 已確認根因

1. 側欄對話與工作區 ⋯ 為 scroll container 裡的絕對定位元素；即使提高 z-index，仍被父容器裁切。側欄檢視及子代理明細在高縮放／短視窗也會越界。
2. 檔案選擇器與後端各有一層副檔名／模型模態限制；原生核心還沒收到檔案，K 已拒絕 M4A、MP4、LRF。
3. 前端先用 FileReader 讀完整檔，再以 Base64 JSON 傳送；大型影片產生多份記憶體副本，畫面只有「正在讀取」。混選檔案失敗也未提供逐檔進度與取消。
4. Claude 組附件提示時，所有附件都先整檔讀入記憶體，雖然非圖片最後只傳路徑；這一步對大型影片沒有必要。

## 最小修正

### 選單

- 對話／工作區 ⋯、側欄檢視、工作面板新增、子代理明細、輸入框引用註解清單使用瀏覽器原生 popover top layer，離開裁切父容器；共用小型定位 hook 負責縮放、上下翻轉、邊界與可捲動高度。
- 跟隨視窗、visual viewport、父容器捲動與內容尺寸更新；手機沿用底部面板及原生遮罩，不新增 UI 框架或相依。
- 保留原動作、核准及對話歸屬；點選後收合，Escape／外點／焦點移出正常關閉。修掉選单已關閉但 stale open state 攔截後續對話框 Escape 的回歸。
- 新對話提供者分頁改彈性寬度，避免最窄手機固定最小寬擠出。
- 實測另找到並修正：150% 縮放的引用註解清單越出右上邊界；手機短畫面隱藏狀態列导致子代理入口消失；短側欄清單被上下固定內容擠成零高度。保留入口、短側欄可捲動，不裁掉功能。
- 定位優先使用瀏覽器 currentCSSZoom，避免窄按鈕 offsetWidth 整數捨入放大位移。

### 附件

- 選擇器不再設副檔名白名單。原始檔可先保存、交目前核心使用既有檔案工具；不把格式未知當成 K 拒收理由。
- 前端直接送 File 原始位元組，後端管線寫入 `.partial`，完成後才改為原檔並最後產生 `attachment.json`；進度、儲存中、取消、失敗收尾分開呈現。失敗不自動重送，草稿保留。
- 每檔固定來源 thread/workspace；切到其他聊天室不轉移附件，不能藉 ID 讀其他聊天室。
- 保留現有登入、私人入口身分、同源／CSRF、遠端命令防重、路徑及秘密檔名檢查。舊 JSON 接口為既有相容路徑，不是大型檔使用的主路徑。
- PDF／DOCX／文字擷取失敗仍保留原檔與警告；大於 32 MiB 時只略過 K 的可選預先擷取，原檔照常保存，不是上傳大小上限。Claude 的文字預覽最多讀前 8 KiB，不整讀只是為了顯示短提示。Codex、Claude、Gemini 提示保留原始路徑與可用擷取路徑；Claude 非圖片不再整檔讀取只是為了形成提示。
- **收到原檔不等於模型已直接聽懂音訊或看懂影片。** 本次不虛構原生 audio/video input、不暗換模型、不轉 API 計費，也不把轉錄或抽幀冒充原生模態。原生核心可依現有工具、權限、資源處理；做不到就回報真實限制。

## 候選階段驗證

- 最終來源完整測試 **921/921**；涵蓋 Opus 複查新增的可選擷取／限量預覽回歸。最後提示文案調整後，附件／Claude 定向 **104/104** 再次通過。
- 真實建置 UI + 假後端：新對話原生加速 4 尺寸、既有 Fast 3 尺寸、子代理 4 尺寸、modal focus 9 案例／3 手勢缩放、modal scroll 3 尺寸通過。
- 原始上傳 UI 2 尺寸：M4A/MP4/LRF、逐檔錯誤、取消、切聊天室、草稿保留及不自動重送通過；舊附件 UI 3 項與三提供者影音選檔回歸通過。
- 最終選單矩陣：**17 項 × 6 視窗＝102 項全部通過**；包含 100%／125%／150% 桌面縮放、360px／320px 手機及 700×360 橫向。檢查實際邊界、捲動後最後項目命中及入口不缺失；未向假後端以外送任何請求。桌面錨點、aria-expanded、Escape 還原焦點、外點關閉與草稿保存均通過；移除最後註解後再加入的展開狀態亦在六尺寸全數通過。
- 真 HTTP→磁碟保存→串流下載：合成 1,420,000,000 bytes 全流程大小／SHA-256 相符，非 stub；詳細路徑與讀回腳本見 `native-attachment-stream-20261007.md`。
- 官方 K 專用 Codex 0.160.0、GPT-6 Luna low／read-only 一次新假資料回合：三種副檔名均保存並送到原生 turn；第一回合的 PowerShell .NET 方法遭目前 language mode 拒絕，沒有讀回標記，原始失敗證據保留。確認無副作用後，只在同一隔離測試 thread 接續一次 read-only 回合，改用普通 Get-Content／Get-Item；三份原檔標記及 79-byte 大小均由原生命令讀回並吻合合成真值。**已驗證 K→原生檔案讀取，不宣稱影音解碼／理解驗收成功。** 未改權限、模型或正式工作；證據 `result.json`、`followup-result.json` 在 `.runtime/native-attachment-smoke-20261007/`。
- `.runtime/menu-attachments-20261007/baseline-observed.json` 是初次觀察紀錄；早期完整 baseline report 被候選結果覆蓋，**沒有假稱保留完整修前矩陣**。候選結果另存 `candidate.json`，缺失項不能算通過。

## 檔案

- 介面：`frontend/anchored-popover.{jsx,css}`、`project-sidebar.jsx`、`sidebar.css`、`main.jsx`、`style.css`、`mobile.css`、`model-picker.css`、`worker-activity-popover.{jsx,css}`、`response-annotations.{jsx,css}`、`attachment-upload.mjs`。
- 後端：`src/desktop-files.mjs`、`desktop-server.mjs`、三家 controller、`session-workspace.mjs`、`conversation-controller.mjs`、`unified-controller.mjs`。
- 測試：`test/menu-viewport-ui-probe.mjs`、`attachment-stream-ui-probe.mjs`、既有附件／影音／子代理 UI 及附件／controller／remote-access 單元回歸。

## 未驗證與限制

- 本批已部署及正式私人 HTTPS 讀回；本人已在 Android 重開確認免填金鑰直接連上、側欄底部「⋯」完整顯示；其他實機 OS 選項窗與大型遠端附件仍不混同電腦模擬結果。
- 原生 `<select>` 的作業系統選項窗不同於 K 自繪選單；測試控制項可見、聚焦及選取，不宣稱已逐一拍到 Windows／Android 原生選項窗。
- 檔案可保存與模型可解讀分開驗證；磁碟、瀏覽器、網路／隧道、原生工具及權限仍可能有自身限制。1.42 GB 結果為本機 HTTP，不宣稱手機經 Tailscale 的同尺寸傳輸已實測。
- 取消／中断／儲存失敗可能留下沒有附件紀錄的 `.partial` 檔；不當成可送出的附件，也未自動刪除資料。傳輸已完成後移除附件只會從草稿撤下，不承諾刪除電腦已保存的副本。
- 準備階段保留正式 `a2ae2f0` 不動；本人停止通知後才交換程式，未強制停止或重送任何工作。

## 原生接入依據

已檢查本機 Codex CLI 0.160.1 接口及 [官方 App Server 協定](https://learn.chatgpt.com/docs/app-server)。本批保留既有文字／圖片入口，原始附件透過檔案參考交核心工具；不由 ChatGPT App 能力推定 CLI 提供同樣的直接音影音輸入。

## Opus 第一輪複查與處置

真正 Claude Opus 5.5 經官方訂阅只讀檢查，session `7457b8a6-8466-4f8e-84a7-54f8abe29642`。完整原始結果在 `.runtime/menu-attachments-20261007/opus/`。

- 採納 F1/F2：大型文字／PDF／DOCX 的可選文字擷取仍整檔讀入，且讀檔錯誤在 catch 外；Claude 只為短預覽整讀擷取內容。已補修且完整 921 項及定向 104 項回歸通過，不把第一次 review 當成無問題通過。
- 採納 F4：縮放比例改用 currentCSSZoom，零／非有限測量保留正常值。
- R1 查證專案 React 19.2.4，非 React 18；補強實際觸發錨點／展開狀態驗證。
- 未採納 F3 自動永久刪暫存，因本專案回收規則及範圍限制；如需清理須另作可恢復的明確操作。
- 不新增固定閒置逾時、重試或原生媒體轉換：使用者明確不希望網路不順造成 K 額外限制造成中斷；保留取消、錯誤呈現、headers timeout 與原有認證。
- 既有小檔 JSON 相容入口保留，不藉本批另加 64KB 附件限制；所有新 UI 上傳均走 raw stream。
- 實機鍵盤／原生 OS 選項窗及遠端大型傳輸維持未驗證，沒有把模擬瀏覽器等同實機。
- 第二輪真正 Opus 5.5，session `100f1dfa-7349-43cd-81a7-24af3a7dfc45`，明確認證／來源歸屬、F1/F2/F4 及 quote 聽寫接線正確，**程式碼無阻擋級問題**。
- 第二輪指出低風險 B1：刪掉最後一則引用會卸載 popover，瀏覽器不送 toggle，open state 留 true。採其最小一行修正：close 遇已卸載／已關 popup 直接 setOpen(false)。實際六尺寸刪完→重新加入→再次展開均通過。
- E1：送審 packet 恰好截到測試增補中的失敗矩陣，沒有以該份資料宣稱通過；保留審查指出的證據不一致。測試原本先保持 quote top layer 開啟，再程式化選取下方文字、缺少人類 pointerdown，因此遮住工具列。修正 fixture 為真外點關閉→確定性 Range→真按鈕點擊；無 DOM click 繞過。最後 `candidate.json` 為 102/102、errors=[]、unexpectedPosts=[]。
- Mobile probe 原假 controller 未實作新 raw upload／stream download，首次在下載等待失敗；已補成真 saveAttachmentStream 和 source readback，完整 HTTPS 假身分流程通過（6 個合成對話，含已接收但回覆中斷時不重送）。主輸入及引用聽寫、原始附件保存／下載、斷線重連與不重送均通過。證據 `.runtime/mobile-remote/ui-result.json`；不當成真 Tailscale 或實機驗收。

## 固定候選準備

固定程式版本 `e0d552c20eac96b15e6a5677314d2a09a349be8a` 已由 Git archive 建立乾淨候選，路徑 `.runtime/menu-attachments-20261007/candidate-e0d552c`。沿用鎖檔相符的現有實體相依，沒有安裝套件、搬使用者資料或更動正式 runtime。

- 乾淨 UI、瀏覽器擴充、Windows 啟動器建置通過；完整測試 **921/921**。
- 乾淨候選 6 個 UI 產物（HTML、3 個 assets、2 個 icons）與已做 102 項矩陣／完整手機合成流程的來源建置逐檔 SHA-256 相同；manifest JSON 內容完全相同，只差 Git archive 的 LF 與來源 CRLF。既有 bundle 大小警告保留，非建置失敗。
- 第一次比對誤將來源保留的歷史資產全部納入，乾淨候選没有舊檔故失敗；第二次確認現用 6 檔相同、manifest 僅換行差異。沒有清除歷史資產，也未宣稱 manifest 位元組 hash 相同。
- 候選收據 `.runtime/menu-attachments-20261007/prepared.json`：validated=true、deployed=false、noInstall=true；正式設定讀回仍 `a2ae2f02d1ea58120a189b57f57fe2d351639519`。
- **已完成準備，停止在更新前。** 未部署、未重啟、未 push。使用者通知已停止 K 後，仍需確認自有工作停止、保留程式可退版本，再按既有安裝路徑限制套用本固定候選及正式讀回。
- 本批未更動手機安裝殼，預計更新電腦 K 後將手機 K 關掉重開即可；真手機／Tailscale 新版驗收仍待正式更新。

## 本人停止後正式套用（2026-10-07）

- 本人通知「離開並停止 K」；啟動器於臺灣 03:52:23 記錄 confirmed close、exit 0，K 自有程序與 47831／54832 監聽均已停止。未使用強制結束。
- 將已驗證 `e0d552c20eac96b15e6a5677314d2a09a349be8a` 候選複製至安裝根目錄下的新 prepare 位置，未搬走原候選。41397 檔複製零失敗；啟用前 296 個來源檔與固定 Git object 一致，沒有部署文件 HEAD `94499f3`。
- 使用既有 activateRuntime 保留並交換程式；正式版本 **`e0d552c20eac96b15e6a5677314d2a09a349be8a`**。退版保留 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791316592815`，對應原 `a2ae2f0` 程式、啟動器與本機設定。這不是對話資料備份。
- 交換前後 **37,163 個保護檔 SHA-256 全部相同**，五個 Gemini 帳號身分／選定帳號、原對話、手機登入與金鑰備份保留。未更新原生核心、安裝相依、修改東區或其他專案。
- 由原 `D:\K-harness\Start-K-Desktop.ps1` 啟動，03:57:15 記錄 workbench ready。正式 79 個產物 hash 與候選相同，3 個 UI 資產經 HTTP 讀回為 200 且 hash 相符；未授權首頁／state 均維持 403。
- 真 Tailscale 私人 HTTPS、獨立瀏覽器登入：1440×1000、900×600、360×740、320×480，底部對話／工作區／檢視／新對話模型／權限／推理選單 **24/24** 邊界及最後選項命中通過；Astra 另目視窄手機底部選單與短桌面新對話截圖。檔案選擇器 accept 沒有格式白名單；未上傳真實附件或送工作。
- 正式主／子代理均閒置，選擇的對話／訊息未改變；唯讀驗收未操作帳號、額度批查或目標。正常啟動／驗收後的三個保護檔變更是 remote-sessions、Gemini 帳號查詢紀錄、agy cli.log；帳號身分與選定帳號 hash 仍一致，不能把正常啟動後全目錄宣稱成完全不寫入。
- 首次正式 UI 驗收用了手機精確文字「已連線」等待 1440px 桌面，而桌面顯示「電腦 K 已連線」，故測試逾時；沒有產品斷線證據。改用實際 connected 狀態 selector 後 24 項全部通過，保留 `formal-ui-attempt1.json`，未更動程式。第一次測試登入未主動登出；後续驗收均登出自己的測試 session，沒有撤銷原手機登入。
- 證據在 `.runtime/menu-attachments-20261007/` 與安裝根 `.runtime/menu-attachments-deploy-20261007/`：activation、protection-before/after、reviewed-source-readback、formal-readback、formal-ui-readback 及截圖。正式啟動與私人入口已讀回；本人隨後明確確認 Android「已直接連上，選單完整顯示」。
- 不需重裝手機 App，本批未改 PWA 安裝殼；手機關掉重開載入新資產。1.42GB 附件仍只代表本機 HTTP 合成實測，未宣稱手機遠端同尺寸或原生影音理解已驗證。
- 東區未更新。GitHub 發布與本人手機確認見下節。

## 本人手機驗收與 GitHub 發布

- 本人依提示將手機 K 從最近使用 App 滑掉重開，再打開側欄底部對話「⋯」，明確回覆「已直接連上，選單完整顯示」。這證明此次免重填金鑰與該實機選單已驗收，不擴大成所有 Android 原生選項窗或真實大型影片處理均已驗收。
- 固定程式 `e0d552c20eac96b15e6a5677314d2a09a349be8a` 已依既定發布 SOP 推到現有 `origin/main`，`git ls-remote` 精確讀回同 SHA；未 force、未移動舊 tag。
- 工程收尾文件另提交，正式程式仍為 e0d552c；不因文件 HEAD 較新重部署。沒有更動東區、真實任務、原生帳號或計費。本批停止新增操作；M4A／MP4／LRF 原檔處理與巨大遠端傳輸的未驗證界線保留如上。
