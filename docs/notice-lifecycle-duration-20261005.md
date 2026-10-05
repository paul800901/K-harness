# 原生警告呈現、關閉狀態與長時間格式

## 範圍與狀態
- 使用者回報：重連通知橫向累積、按掉後切換聊天室又出現，以及 `531 分 44 秒` 不易閱讀。
- 本批只修呈現與通知生命週期，保留真正錯誤、核准、登入與額度訊息；不更改原生重試機制、不自動重送工作、不操作正式聊天室。
- 沿用本人最新要求：修完、測完、複查後先停；**不部署、不 push、不重啟、不打標記**。既有附件修正仍保留於同一維護工作樹，未順手回退或發布。

## 直接根因與改動
- `frontend/style.css` 原本把 `.native-notices` 容器與單張通知共用 `display:flex`，預設橫排，子項遭壓縮後產生橫向捲動與直排「知道了」。改為有高度上限的垂直列表，內容換行，關閉 X 維持固定大小；沒有通知時不占空白區。
- `frontend/native-ui.jsx` 原本每次 `threadId` 改變就清空已關閉 ID。現在按供應商、工作區、對話保存目前介面中的關閉記錄，不因切換畫面重設；同一重連事件更新次數也不重新彈出。新的斷線事件有新 ID，仍能提醒。
- `src/desktop-controller.mjs` 原本忽略 Codex `error.willRetry`，每步都當成獨立錯誤。現在保存原生 `willRetry` 與同次重試識別，保留各步原始訊息；模型文字／推理重新輸出、該回合結束或確定終止重試時標記已恢復／結束。其他聊天室事件與背景終端輸出不能當成模型連線恢復。
- `frontend/native-notices.mjs` 只投影同次重試最新狀態，顯示「正在重新連線（n/n）」或「等待網路恢復…」，不把中間重試步驟當作真正工作失敗。已恢復重試不常駐；終止錯誤與未知警告保留。僅已知 `Falling back from WebSockets to HTTPS transport` 工程 warning 留後台，不廣泛隱藏連線錯誤。
- 人類提示以精簡摘要呈現；過長或轉譯的原生文字可展開「查看詳細內容」，完整原生 `message` 仍在記錄中。既有最多 100 則原生 notice 的保留規則未改，不宣稱永久保存所有事件或完整原生事件的所有欄位。
- `shared/conversation-groups.mjs` 加入共用 `formatElapsed`，`frontend/main.jsx` 的執行中與已完成耗時均使用它。按整秒顯示：`59 秒`、`1 分 0 秒`、`8 小時 51 分 44 秒`、`1 天 2 小時 3 分 4 秒`；只改格式，原始起迄時間與計時邏輯不變。

## 公開專案參考
- [OpenCode SessionRetry](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/session-ui/src/components/session-retry.tsx)：依目前 retry 狀態更新同一區塊，呈現次數／等待時間；離開 retry 就不顯示，長原因採短預覽和完整提示。K 借用「單一狀態更新」方向，沒有複製其框架或自行建立重試倒數。
- [Codex CLI streaming](https://github.com/openai/codex/blob/7f892275e31002f0422477c6219189284560e689/codex-rs/tui/src/chatwidget/streaming.rs) 的 `on_stream_error` 更新狀態列並記住原標題；[reconnect](https://github.com/openai/codex/blob/7f892275e31002f0422477c6219189284560e689/codex-rs/tui/src/chatwidget/reconnect.rs) 把斷線等待及最終失敗分開處理。此為 CLI 公開原始碼，不宣稱 Codex App 桌面介面完全相同。
- [Claude Code 官方變更紀錄](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)：有重試第二次後才顯示原因的調整；Remote Control 連線失敗則改成持續的失敗指示、詳細原因及重連入口。這是官方紀錄，不是完整 UI 開源證據，也不把 Remote Control 行為推廣成所有聊天錯誤。
- 共同方向：暫時重試是會更新／消失的狀態；真正失敗保留可理解的原因，不逐步堆積需要人按「知道了」的卡片。K 的原生事件仍是真值，不自行判斷模型成功。

## 驗證紀錄
- 修正前：後端新測試如預期失敗，未保存 `willRetry`；舊建置 UI 在三種尺寸都重現已關閉 5 則通知切回後復活。1100×760／125% 與 900×700／150% 均重現橫向溢出。
- 修正後：定向測試 22/22。涵蓋同次重試合併、新斷線區別、原文保留、模型輸出恢復、其他聊天室／背景命令不誤清除、終止錯誤保留、沒有新增 turn/start／steer／interrupt，以及秒／分／小時／天邊界。
- 真瀏覽器＋假 API／SSE UI：1920×1080／100% 暖色、1100×760／125% 淺色、900×700／150% 深色全數通過。驗證垂直且無橫向溢出、逐聊天室關閉、重試只留最新一次、同次更新不復活、新事件可顯示、恢復後不占空白、原始錯誤可展開，以及執行中小時／已完成天格式。沒有 POST 或模型工作，無頁面錯誤；主代理已檢視截圖。
- 既有原生通知 UI 回歸通過：Claude 額度正體中文與原生恢復時間、Codex 錯誤不重複、工程通知無空白區、未知警告／guardian／改派／錯誤仍保留。
- 初次完整測試 768/769：一項引用工具列靜態測試以已搬移的 `function formatElapsed` 作為片段結尾，導致誤讀後面整份程式；改用現存相鄰 `WorkProgress` 邊界並確認邊界有效，不改引用功能。完整重跑結果與複查見下方收尾。
- 測試與研究證據：維護工作樹 `.runtime/notice-research-20261005/`（before.log、before-ui、focused.log、after-ui、native-notices-regression.log、full-tests.log、full-tests-final.log、上游來源快照）。UI 探測程式 `test/notice-lifecycle-ui-probe.mjs`；後端／投影／格式測試分別在 `test/desktop-native-events.test.mjs`、`test/native-notices.test.mjs`、`test/conversation-groups.test.mjs`。

## 限制
- 本批關閉記錄存於目前介面生命週期，保證聊天室切換不重現；不承諾整個介面重新載入後仍記住所有關閉記錄，沒有為未要求情境增加持久化或遷移。
- 重試恢復以收到原生模型進度／回合事件為準，未刻意切斷真實網路干擾使用中的 K；假事件與本機 UI 成功不等於正式連線故障已治好。
- Codex 明確提供 `willRetry` 才接這個重試生命週期；其他供應商未知警告不靠文字猜成已恢復。共用排版、逐聊天室關閉及耗時格式適用共用介面。
- 正式執行檔、登入、對話、帳號與工作均未改動。

## 收尾
- 完整重跑 **769/769 通過**，UI 建置成功；原有 Vite 大型 chunk 提醒仍在，未為本批另做切包重構。
- 真正 Claude Code **2.1.289／Opus 5.5** 官方訂閱只讀複查完成，session `0b187d37-114c-4a78-bd78-3155c1766c64`，回傳模型 `claude-opus-5-5`，**無正確性、安全或資料遺失阻擋**。主代理獨立核對相關 diff、769/769、UI 結果與截圖；審查不冒稱模型親自執行測試。原文與模型收據留在 `.runtime/notice-research-20261005/opus-review/`。
- 採納複查的非阻擋限制記錄：若恢復後只有工具項目而沒有模型文字／推理，提示可能保守地留到回合結束；若核心程序終止而沒有回合結束事件，提示可能留到重開對話或下次回合。沒有具體新失敗證據，不擴張為工具／程序健康監控。本批「詳細內容」完整保留現有 `error.message`，不宣稱另接所有底層錯誤欄位。
- 已完成本機實作、測試及複查，停在維護工作樹。**未提交／推送 Git，未部署、重啟或建立新標記**；正式 K 不受本輪更新干擾。

## 後續升級授權
- 2026-10-05 本人回覆「可以升級了 關了」，結束先前暫不上線的限制；本批與附件修正依既定固定版本 SOP 合併準備，核對正式程序及 47831 均已停止。完成乾淨候選、可退版保存及正式讀回後再記錄部署／GitHub 結果，尚未執行的步驟不先宣稱完成。

## 正式升級與讀回（2026-10-05 11:50–11:53，臺灣時間）
- 已部署固定程式 **`4ead4bf24ed609a01b4d6acfb4f5bdf48d574248`**，含本批與已複查的附件修正。先核對 K 自有程序為 0、47831 未監聽，沒有強制中斷工作。
- 從該 Git SHA 封存建立乾淨候選，沿用相同 lock 的現有套件，不安裝新套件、不升級原生核心。UI／擴充／啟動器建置成功，候選完整 **769/769** 再次通過。
- 490 個 Git 檔核對固定版本內容，510 個程式／建置檔與正式落地雜湊一致。首次 Git blob 比對因既有 `core.autocrlf=true` 產生 CRLF 差異而停止；核對 482 個差異均僅為文字換行，無其他內容差異後才繼續，未改 Git 設定或略過真實內容核對。
- 替換期間 **317 個保護檔案完全不變**，四帳號與目前帳號保留，本機 Node／語音設定保留；沒有複製登入憑證或操作 Windows 憑證管理員。退回前版 `e00e7acb715020ae860ececcd52ae26cd94dee2c` 的程式及啟動器保留於 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791172236206`，退版檔已核對；這不是對話資料快照。
- 由既有 `D:\K-harness\Start-K-Desktop.ps1` 正常重開。正式 native health 成功、K 視窗 Responding、3 個正式服務資產均 200 且與部署檔雜湊一致。未授權 `/` 與 `/api/state` 均 403；初次讀回腳本誤把未授權首頁預期為 200，依現行入口權限修正驗收預期，沒有讀取 cookie／啟動 token 或放寬控制。
- 正常重開後四帳號身分與目前帳號仍一致，沒有登入待處理或 uncertain；保護檔只有 `gemini-accounts.json` 隨正常啟動刷新帳號／額度狀態，其他保護檔不變。沒有為驗收送出、重播或修改任何真實工作。
- GitHub 已確認為既有私人儲存庫，程式已推 `origin/main` 並讀回上述完整 SHA；後續本節等純文件收尾另提交，不改正式程式版本。沒有新建／移動 tag，東區未更新。
- 正式證據：`D:\K-harness\.runtime\attachments-notices-deploy-20261005`，含 preparation、候選 build／full-tests、activation、保護檔前後比對、formal-readback、git-code-readback 及驗收腳本校正紀錄。重連／長時間行為沿用已完成的三種 UI 假事件實測並核對正式服務同一資產；未刻意斷開日常網路或製造真實長任務，也不假稱本人親自從 Explorer 啟動。
