# 長聽寫背景穩定性：取消固定 120 秒、切房／切視窗保留兩種意圖（2026-10-22）

## 範圍與狀態

- 實作與設計：真正的 Opus 5.5（Claude Code 既有 Max 訂閱），在獨立工作樹 `codex/voice-background-stability-20261022` 完成；主代理只做最後驗收與收尾。
- 基準 `main` `b00cd36d57329e557a88a8de809982c8996c2367`；本批前正式程式為 `47a0ae6f35e733b28fd50ed0b808f81070b1754d`。
- 原程式 commit：`ad19b54635c24a41aa5e89a1ed3665ce345d6162`；補修／正式程式 commit：`312caf2da1a791bb03e57f7cd98c32cfb1e1e6d5`，文件分開提交。
- **南區已部署並讀回程式 `312caf2da1a791bb03e57f7cd98c32cfb1e1e6d5`，已合回 main 與 push**；詳見末節。正式 K 保持關閉，未操作真實麥克風或正式對話。
- 只用既有本機離線 Whisper（faster-whisper large-v3、CUDA），沒有改供應商、模型、計費或把音訊送上網路。

## 本人需求（原文摘要）

- 「有時候它在語音辨識，我可以接受它慢慢辨識，但是我切換聊天室，或切換別的視窗，有時候錄音相對比較長，它會斷掉，什麼都沒有辨識，等於我要重講一次。」不是每次，長聽寫或系統卡頓較常發生。
- 「長時間的錄音聽寫，我可以放著讓它慢慢辨識，然後跑到別的聊天室或別的視窗做別的事情，之後聽寫完自動上去、自動工作才理想。辨識固定 120 秒就很奇怪。」
- 聽寫有兩個意圖：錄音後按**最右側送出**，辨識完成直接送出工作；再按**聽寫鈕停止**，辨識完成只回填該聊天室輸入框、不送出。兩者都要在切換聊天室／視窗後保留，且不能送到目前畫面上的錯房。

## 根因證據與未知

已確認的機制（程式碼）：

1. **兩層固定 120 秒總時限**：前端 `NATIVE_DICTATION_TIMEOUT_MS = 120000` 到時 abort、清掉這次結果；後端 `createLocalDictation` 預設 `timeoutMs = 120000` 到時終止 Python。錄音樣本在停止時已清除，沒有可重試的音檔，所以超時就是「什麼都沒有」。
2. **隱藏視窗會取消**：`window.kBrowser.onWindowHidden`（關到系統匣送出的 `k-native-window-hidden`）與手機 `visibilitychange` 會取消目前與所有背景轉錄。普通 Alt-Tab 不走這個事件。
3. **切房後送出意圖被丟掉**：離開來源房的工作 `wasDetached` 後一律 `send:false`，回原房時送出箭頭也被停用。
4. 錄音中切房（`Chat` 以 `threadId` 為 key 重掛）會直接取消，連已講的話一起丟掉。

實測（本機真 Whisper，合成 zh-TW TTS 290 秒音檔，經 `createLocalDictation` 計時；不含 HTTP、base64 與前端編碼時間）：

| 時間 (UTC) | 音長 | 辨識耗時 | 舊上限 |
|---|---|---|---|
| 13:21:39 | 290 s | **118.3 s** | 120 s |
| 13:23:41 | 290 s | **112.5 s** | 120 s |

接近 5 分鐘上限的長聽寫在這台機器上本來就貼著 120 秒；前端計時從送出請求前開始，加上任何 GPU／系統負載（正式 K 同時在跑其他工作時更常見），就會超時、整段丟失。這與「長聽寫或系統卡頓比較容易」吻合。

未知：沒有重現本人當時的真實事件，也沒有當時的前端提示或後端紀錄可查；無法證明每次都是逾時，也可能是關到系統匣時被取消（第 2 點），或兩者都有。這次兩條路都一起修正。

## 最小方案

- **不設固定總時限**（符合 AGENTS 第七節「長工作不由 K 設固定總時長截斷」）：移除前端轉錄計時器與後端 `timeoutMs`。結束轉錄的方式只剩本人取消、HTTP 斷線（頁面重整／關閉時的既有 abort）、K 關閉，以及辨識器自己失敗。後端單一工作鎖不變，回原房仍可按取消。5 分鐘錄音上限與音檔大小上限不變。
- **切房／隱藏視窗不取消已停止的轉錄**：桌面隱藏事件與手機 `visibilitychange` 不再取消轉錄。若當時仍在**錄音**，就停止收音並把已講的內容轉成**只填草稿**（不送出），不會在背景偷偷收音；錄音中切房也一樣。正在等待麥克風權限時離開仍會取消。
- **兩種意圖都保留**：
  - 停止鈕 → 結果只附加到來源房**當下保存的草稿**，從不送出。
  - 送出箭頭 → 結果附加到來源房草稿後，經**來源房自己的 `submitText`** 送出一次（離開時最後一次 render 的 closure：該房的附件、引用、權限／推理程度、討論設定、佇列語意都沿用按下箭頭時的狀態），並套用 `roomAction` 房間鎖。
  - 若完成前回到來源房，畫面接回同一個請求，提示「轉錄完成後會在此聊天室送出。」，由前景原路徑送出一次。
- 手機遠端沒有送出箭頭，維持只填草稿。
- 不重試、不重播：送出失敗（含結果未知）只送一次，草稿（含辨識文字）保留在來源房，錯誤沿用既有的全域錯誤提示。沒有新增持久化、佇列、設定或按鈕。

## 檔案

- `frontend/native-dictation.mjs`：移除 `NATIVE_DICTATION_TIMEOUT_MS`、`transcriptionTimeoutMs` 與轉錄計時器。
- `src/local-dictation.mjs`：移除 `timeoutMs` 與子程序總時限；abort／close／stop 確認邏輯不變。
- `frontend/voice-composer.jsx`：隱藏時只停止錄音、不取消；離開房間時錄音中改為停止並轉成草稿；背景工作保留 `send` 意圖並在離開時更新為來源房最新的 callback；移除 `wasDetached`／`canSendOnCompletion`。
- `frontend/main.jsx`：`onBackgroundResult` 收到 `send` 時以來源房 `submitText` 送出一次；送出箭頭不再因曾離開而停用。
- 測試：`test/native-dictation.test.mjs`、`test/local-dictation.test.mjs`、`test/voice-composer-window-hidden.test.mjs`、`test/voice-room-switch-ui-probe.mjs`、`test/voice-composer-ui-probe.mjs`。

## 測試

證據放在 `D:\K-harness\.runtime\archive\voice-background-20261022`（Git 排除，只含合成音訊產生的紀錄與截圖，沒有真實錄音或秘密）。

- 單元測試（取代舊的「逾時」測試，不放寬斷言）：
  - 前端：讓 session 排過的計時器全部觸發（模擬很多分鐘），轉錄仍在進行、未 abort、無錯誤，完成後回傳 `send:true`。
  - 後端：mock 時鐘推進 30 分鐘，子程序沒有被終止，最後仍回傳文字。
  - 突變檢查：兩個新測試套在 HEAD 舊程式上都失敗（2/23 fail），新程式通過。
- `test/voice-room-switch-ui-probe.mjs`（已建置 UI、Chromium 合成音訊、延遲回應的假辨識器；桌面 1440×1000 本機入口＋手機 390×844 遠端 HTTPS）：
  - 既有：A 停止→B 完成只進 A；A→B→A 接回同一請求、附加到最新草稿；回 A 取消、晚到結果不加入；背景失敗保留草稿並顯示提示。
  - 改為新語意：隱藏 App／頁面不取消已停止的轉錄；錄音中隱藏、錄音中切房都會停止收音，只填 A 草稿、不送出、不進 B。
  - 桌面新增：A 有草稿與附件 → 按送出箭頭 → 切 B → 觸發隱藏 → **等待 125 秒（超過舊 120 秒）** → 完成後 **恰好送出 1 次**，`threadId` 為 A、文字為「A 草稿＋辨識結果」、附件 ID 為 A 的附件；B 草稿不變；回 A 草稿與附件已清空；再切回 A 不重播。
  - 送出意圖、完成前回 A：顯示「轉錄完成後會在此聊天室送出。」，完成後送出一次。
  - 背景送出被拒：只嘗試 1 次、不重試，A 保留完整草稿；B 從未收到 A 的送出。
  - 全程 0 page error。
  - 125 秒完整版單獨執行 147 秒通過，紀錄 `voice-room-switch-ui-probe-125s.log`；截圖 `ui-evidence/voice-room-switch-ui-probe/`，已目視確認 `desktop-send-pending.png` 的提示可見。
- `test/voice-composer-ui-probe.mjs`（真 Electron＋正式 preload＋HTTP＋**本機真 Whisper**，合成 TTS 音訊）：
  - 新增錄音中由主程序送出真正的 `k-native-window-hidden` IPC 並隱藏視窗：收音停止、Whisper 結果填入草稿、無送出。
  - 新增按送出箭頭後送出同一 IPC 並隱藏：Whisper 完成後恰好送出 1 次，內容為整份草稿＋辨識文字。
  - 68 秒通過，紀錄 `voice-composer-ui-probe.log`。
- `npm test`：**1821/1821**，72 秒，紀錄 `npm-test.log`。
- `npm run build:ui` 後 `npm run test:ui`：第二輪同一輪 **50/50**（489 秒，紀錄 `test-ui-round2.log`）。第一輪 49/50（`test-ui.log`）：`mobile-remote-ui-probe` 仍斷言舊行為「手機頁面隱藏時錄音直接取消、不發請求」，已改為新語意並維持嚴格斷言：多 1 次本機辨識、文字進草稿、不送出，隱藏前先收音 700 ms 確保有音訊。改完後單獨重跑，有 1 次失敗在與語音無關的手機鍵盤高度版面檢查（第 725 行，新開頁面，`mobile-remote-ui-probe-rerun2.log`），接著連續 3 次通過（rerun3～5）以及第二輪全套通過，判定是既有時序不穩，沒有修改該斷言，紀錄 `build-ui.log`、`test-ui.log`。
- `git diff --check`：無問題。
- 長音檔計時：`real-whisper-long-timing.jsonl`，腳本 `k-voice-long-timing.mjs`（合成語音、跑完由 scratch 移入回收筒）。

## Opus 自查與取捨

- **是否過度工程化**：沒有新增持久化、佇列、重試、設定或按鈕。背景送出直接重用來源房既有的 `submitText` 與房間鎖，沒有另寫一套送出邏輯；新增狀態只有 `entry.send`（只用於回房提示）與一個指向最新 callback 的 ref。
- **不設上限的風險**：辨識器若真的卡住，後端工作鎖會一直被占，之後的聽寫會得到「已有一筆語音辨識工作進行中」。解除方式是回來源房按取消，或重整／關閉頁面（斷線即終止子程序）。依 AGENTS 第七節選擇不由 K 判死；沒有加無活動偵測，那需要辨識器回報進度，屬另一個題目。
- **錄音中離開改為「停止並填草稿」而不是取消**：本人原話是「斷掉、什麼都沒有」。不在背景續錄，所以沒有隱藏麥克風；只填草稿、不送出，因為當時還沒表達送出意圖。真正的取消仍要按取消鈕。這改變了 10-07 文件中「錄音中切房仍取消」的舊設計。
- **背景送出沿用離開時的設定**：權限、推理程度、權限確認、討論設定、附件與引用都取按箭頭當時（離開前最後一次 render）的值，跟留在原房時會送出的內容一致。若該房在背景已被釋放或正在重連，後端明確回「未送出」，草稿保留。
- **刻意沒有處理的既有行為**：
  - ~~背景送出錯誤沒有標明是哪一房；同房鎖被占用時無提示不送~~：收尾複查已修正，見下節。
  - 背景送出正在等待後端回覆（通常不到 1 秒）時回到來源房，輸入框可能還短暫顯示剛送出的文字（與既有「晚到確認」行為同類）。
  - 前景送出路徑原本遇到全域鎖時就不送（`queueDraft` 既有）。
  - 5 分鐘上限後仍可按箭頭改成送出（既有）。
  - 以上都沒有擴大修改。
- **AGENTS.md**：現行第七、八節已涵蓋「不設固定總時長」與「切換畫面不停止工作」，語音條文沒有矛盾。檔案只剩約 138 bytes 空間，這次不修改。

## 收尾複查（Sol 提問，Opus 5.5 裁決與補修）

補修程式 commit：`312caf2da1a791bb03e57f7cd98c32cfb1e1e6d5`。本節為 Opus 交付時的複查紀錄；當時未部署、未 push、未 merge，後續正式收尾見末節。

1. **隱藏時麥克風仍在啟動（starting）會不會晚到後開始收音：成立，已修。**
   - 原因：`stopHiddenRecording` 只處理 recording。getUserMedia／AudioContext 晚到時，session 仍會進入 recording，造成隱藏視窗中收音；舊版 `cancelRef` 原本會取消這個階段。
   - 修正：starting 改走既有的 `cancel()`。session generation 遞增，晚到的 stream 由既有 token 檢查停止軌道；已停止的轉錄仍不受隱藏影響。沒有新增狀態。
   - 驗證：探針在兩個入口都把真實假裝置 stream 卡住，觸發隱藏後才放行。確認晚到 stream 的軌道全部 `ended`、從未出現「停止聽寫」、沒有轉錄請求，A 草稿保留並顯示取消提示。
2. **背景送出無聲不送與全域錯誤未標房：需要處理，已修。**
   - 明確送出意圖不能無聲消失。複查時另外發現，`submitText` 遇到 `quoteSendLock` 也會無聲 return，一併處理。
   - 修正：`onBackgroundResult` 在同房 `roomAction` 鎖或送出鎖被占用時，回傳來源房提示「此聊天室當時另有操作進行中，聽寫完成後未送出；文字已留在草稿。」送出失敗或結果未知時，回傳「聽寫完成後送出時發生問題：…文字已留在草稿。」`voice-composer` 把它存成來源房的背景提示，回房時顯示。
   - 全域錯誤改為在房內函式重拋帶房名的訊息「「房名」聽寫完成後送出時發生問題：…」。`action` 會先同步寫入原訊息，`roomAction` 之後覆寫，所以畫面上顯示帶房名的版本。
   - 不重試、不排程、不另建 queue，沒有修改一般 `roomAction` 或錯誤系統。
   - 限制：若送出失敗發生在本人已回到來源房之後，來源房提示要到下次進房才看到；當下只有帶房名的全域錯誤。
3. **來源房 closure 的引用、權限、effort：確認正確，補最低斷言。**
   - 探針先在 B 寫入 A 的引用；回 A 後用真實介面選「代我核准」並確認、推理程度選 high；按送出箭頭後切到 B 完成。
   - 送出內容：`threadId` 為 A，文字含 A 草稿＋辨識結果與 A 的引用和註解，`accessMode: 'auto-review'`、`permissionConfirmed: true`、`effort: 'high'`。切到 B 時 App 已重設為 B 的 `workspace-write` 和空 effort，所以這組斷言分得出來。送出後 A 的引用已清除。
   - 附件在原探針已驗證。

**收尾驗證**（紀錄都用 `closeout-` 前綴，放在原 archive 目錄，沒有覆蓋既有證據）：

- `npm test`：1821/1821（`closeout-npm-test.log`）。
- `npm run build:ui`（`closeout-build-ui.log`）後 `npm run test:ui`：同一輪 **50/50**，493 秒（`closeout-test-ui.log`）。其中 room-switch 探針用預設 125 秒，151 秒通過；真 Whisper Electron 探針 66 秒通過。
- 突變檢查，確認新斷言抓得到問題：
  - 用 ad19b54 的 `voice-composer.jsx` 與 `main.jsx` 建置，失敗在「the late microphone stream is stopped」（`closeout-mutation-ad19b54-probe.log`）。
  - 只把 `main.jsx` 換回 ad19b54，失敗在等待帶房名的錯誤（`closeout-mutation-old-main-probe.log`）。
  - 兩次之後都還原、核對與現行檔案逐位元相同，並重新建置。
  - 第二次在較早的被拒案例就停下，所以「同房鎖占用」案例沒有單獨的突變證據；該案例在新程式上斷言提示可見、草稿保留、送出次數不變。
- `git diff --check`：無問題。

## 尚未驗證／人工驗證限制

- 沒有重現本人當時的偶發事件；根因是「機制＋計時證據」，不是現場紀錄。
- 沒有用真人麥克風、真實長段口述，或真正的關到系統匣手勢（點視窗 X）；隱藏是由主程序直接送出同一個 IPC 並 `hide()`，Alt-Tab 失焦本來就不觸發任何取消，也沒有實測。
- 沒有在 GPU 高負載下實測超過 120 秒的真 Whisper（只有 112～118 秒的無控制負載樣本）；超過 120 秒的端到端情境由假辨識器的 125 秒 UI 探針與 mock 時鐘單元測試涵蓋。
- 手機實機（Android 背景化時瀏覽器是否中斷 fetch）沒有測；若被系統中斷，會顯示失敗並保留草稿，不會送出。
- 南區已部署並以正式產物與合成 fixture 驗證，但沒有啟動本人正式聊天室；日常實際長口述的確認仍待本人。東區未更新。
## 正式部署與獨立讀回（2026-10-22）

- 依本人「Astra 額度不足時由 GPT-6.1 Sol 高收尾」的授權交接，由 Sol 作單一驗收／部署者；額度後來重置未重播或換手。所有產品設計與程式修改仍由真正 Opus 5.5 完成。
- Sol 獨立檢查完整範圍、送出 closure、來源房附件／引用／權限、取消及錯誤語意後，指出啟動中隱藏晚到收音與背景鎖無聲不送兩項邊界。延續同一 Claude Code session（不是另開代理或重跑原任務），Opus 確認並最小補修；Sol 再檢查新增 diff 與證據，接受現行實作。沒有修改一般房間鎖、加入重試／備援／持久音檔或新設定。
- Opus 原工作與收尾接續均經只讀 preflight 確認 Claude.ai Max／firstParty，實際 assistant 型號為 `claude-opus-5-5`，無 fallback、無其他子代理，兩次皆正常退出、無 permission denial。CLI 的 list-price cost 欄位不是本人訂閱的實際 API 支出。

### 固定版本與驗證

- 原程式 `ad19b54635c24a41aa5e89a1ed3665ce345d6162`、原文件 `f87a3b71feb131807dfb94b07b69019d59c909f6`；補修程式 **`312caf2da1a791bb03e57f7cd98c32cfb1e1e6d5`**、補修文件 `38c9b9986abc6331953f0f833b23bb96940a3069`。先確認兩工作樹乾淨，再 fast-forward 合回 main；部署只指定補修程式完整 SHA，不把文件版本當程式版本。
- Opus 補修版完整測試 **1821/1821**，先建置再跑的完整 UI **同輪 50/50**（`closeout-npm-test.log`、`closeout-build-ui.log`、`closeout-test-ui.log`）。
- Sol 獨立重建 UI、關聯單元 **25/25**、語音 UI **2/2**：真 Whisper Electron 67.4 秒；切房探針 151.0 秒（含預設 **125 秒**延遲，未縮短），覆蓋兩按鈕意圖、切房／隱藏、晚到麥克風、附件、引用、確認權限與 high effort、取消、錯誤、同房鎖與只送一次。紀錄 `sol-build-ui.log`、`sol-target-tests.log`、`sol-voice-ui.log`。
- `git diff --check` 通過；人工 diff 與發布差異秘密樣式檢查未發現憑證，13 檔只含預期來源、測試及文件，沒有 `.runtime`、`.local`、帳號、對話或音訊上傳。這是範圍檢查，不宣稱能識別所有秘密格式。

### 南區正式套用

- **22:08:42～22:10:33（臺灣時間）**，在正式 K 外執行 `Update-K.ps1 -Ref 312caf2da1a791bb03e57f7cd98c32cfb1e1e6d5`，只執行一次。事前核對無 K 相關程序、47831 無監聽；更新器再確認停止，沒有強制停止或重播任何工作。
- 更新器候選建置、擴充／啟動器建置與完整測試 **1821/1821** 全通過，正式套用成功；完整 log 為 `sol-deploy.log`。
- `.local/runtime.json` 讀回 `version` 完整吻合上述程式 SHA，`previous` 為 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1792678220506`（保存前版 `47a0ae6f35e733b28fd50ed0b808f81070b1754d`）。設定差異只有 `version`、`previous`；原 Node、Python、Whisper 模型路徑未變。
- 正式 `trusted-runtime` 的 **825 個 Git 追蹤檔**對固定程式 commit 逐檔讀回：11 個逐位元相同、814 個只差 LF／CRLF、**實質差異 0**。不是用 main 上較新的文件版本誤比程式產物。收據 `sol-production-readback-final.json`。
- 帳號／對話／工作區／瀏覽器資料目錄保留原路徑，建立時間以同一 PowerShell DateTime ticks 讀回相同；沒有讀取憑證或把此 metadata 核對冒稱登入／全部對話內容驗收。前兩份讀回收據的時間比較混用 Node 毫秒精度及 PowerShell JSON 日期型別，造成 false negative；原始收據保留，修正比對方式後通過，沒有因此修改或回退正式程式。
- 退版保留最新三份：`before-1792661526026`（`fb2754150a52c685d5fc412d94a931e173d61c15`）、`before-1792672749670`（`2f46ccc1d0a6ccb6e7a8157ebad559fcc1ab20e5`）、`before-1792678220506`（前版 `47a0ae6…`）。更新器將最舊 `before-1792599782594` 移入資源回收筒；另讀回原路徑不存在且回收筒同來源目錄／名稱有一筆，確認可還原，未永久刪除。收據 `sol-release-recycle-readback.json`。
- 在**正式產物目錄**再執行同兩項 fixture UI，**2/2 通過**：真 Whisper Electron 68.3 秒、切房探針 151.3 秒（仍含 125 秒延遲）。測試用合成音訊、隔離假房間及假送出，不操作真人麥克風、本人正式對話或供應商工作；證據 `sol-production-voice-ui.log`、`sol-production-ui/`。不是以測試 fixture 冒稱本人 live 工作已驗收。

### 發布與剩餘界線

- **22:15:45 前**已 push 到既有公開 `origin/main`，並以 `git ls-remote` 讀回 **`38c9b9986abc6331953f0f833b23bb96940a3069`**；收據 `sol-first-push.log`、`sol-first-remote-readback.txt`。本節為其後純文件提交，再發布並讀回的完整 SHA 記在同目錄最終收據及 Git 歷史；不因文件收尾重啟或再部署 K。
- 證據總目錄：`D:\K-harness\.runtime\archive\voice-background-20261022`，Git 排除。正式程式版本始終為 **`312caf2da1a791bb03e57f7cd98c32cfb1e1e6d5`**，不可與後續文件 HEAD 混用。
- 正式 K 保持關閉，未自動開啟本人工作。真人長口述、實際點 X 關到系統匣、GPU 高負載下真 Whisper 超過 120 秒、手機實機 OS 背景斷線，以及東區當地更新仍未驗證；不宣稱已重現並證實本人當時偶發事件的唯一根因。原先已列的「失敗在回房後才到達時，來源房提示下次進房才顯示」與「送出 ack 前短暫顯示文字」仍保留，不擴張本題。
