# Gemini 與聊天室／Chrome／Codex 修正合併驗證（2026-10-07）

## 授權、協調與範圍

使用者要求與「修復聊天室超連結無法點擊」聊天協調：那邊先完成套用但保持 K 關閉，這邊接續 Gemini 修正，全部整合後一起驗證。已向該聊天明確交接、取得保持關閉及不 push 的回覆；兩邊不得同時交換正式程式目錄。不強制停止工作、不重派舊工單、不更改帳號／原生權限／訂閱，不更新東區。

合併来源：
- A：`2a14b29`，程式 `c8942217303cb5f03471994ec4b91b8fddb1d14e`，HTTP/S 連結及複製網址、獨立 Chrome profile 連線、Codex 有界去敏感診斷。詳見 `k-fixes-candidate-20261007.md`。
- B：`e420fff659194346016910d7d2aaf65434a4a2c4`，Gemini 主／工人共用環境只保留原 Windows PATHEXT。詳見 `gemini-command-pathext-20261007.md`。
- 合併僅有開發索引文字衝突，保留兩批索引；沒有改寫兩批程式實作。

## 已完成的合併驗證

- 沿用現有依賴，未安裝或升級。介面及擴充建置通過。
- 合併工作樹全套 `node --test --test-concurrency=2 test/*.test.mjs`：**964/964**，72.27 秒。這不是將兩批測試數相加。B 原本預設並行的既有 codex-capacity 時序失敗仍記錄於 B 文件，不改產品或測試去遮蔽。
- 真 Electron／built UI 隱藏假資料回合：5 個 HTTP/S 完整網址原樣送到攔截的 OS opener、聊天室未跳離、右鍵複製完整網址、拒絕非網頁協定；沒有 Electron popup 或真 OS 網站開啟。不能把攔截 opener 當成使用者預設瀏覽器已正式驗收。
- 真正官方 Claude Code 2.1.292／Claude.ai Pro，實際模型 `claude-opus-5-5`，只讀去敏感封包做整合複查：**沒有阻擋**。覆核 Gemini 的三個環境入口、主／工人接線、權限與取消、與 A／Codex／Claude／Chrome 無交集；沒有新增 fallback、重試、runner、MCP 或設定。
- Astra 額外確認 `startIsolatedOwner` 從 sourceEnv 保留 PATHEXT，Electron 環境只剔除自身旗標及 NODE_OPTIONS，沒有上游先丟掉 PATHEXT。正式原生指令仍需讀回。
- Opus 沒有重新審 A 完整 diff；A 自己的兩輪 Opus 複查另存 A 證據。B 的自由選用 Skill 及完整視窗觀測是 Astra 獨立補測，不冒稱本次 Opus 覆核了未附 transcript。

合併證據：`D:\K-harness\.runtime\gemini-integration-20261007`；建置及全測記錄在合併 worktree `.runtime/integrated-*.txt`。

## 本檔建立時狀態與必要收尾

本檔建立時只完成合併工作樹驗證，尚未由本聊天交換正式 runtime 或啟動 K，尚未 push。下一步在固定 SHA 的乾淨候選重跑全測；取得另一邊正式交接，核對無執行中工作、保留程式還原版，再套用及讀回。原生帳號、對話與 Chrome 資料不搬移。

正式 runtime、實際 vault native host 與 installed extension 必須一致。三個真 Chrome profile 的連線、明確選擇及工作綁定必須用真流程驗收；假 profile 測試不替代這項驗收，不讀 cookies／密碼、不關閉人類正在使用的 Chrome、不搶前景。

歴史 SQLite 根因、所有歷史黑窗的完整原因、中文 stdout 編碼、完整素材／ASR Skill 與任意任務長期遵規仍未解決或未驗證。本批修已證實根因與具體操作問題，不宣稱 K 永遠零錯誤。

## 正式套用、啟動及共同驗收讀回

以下為本檔建立後的正式結果，取代上節當時「尚未套用」的階段狀態。

- 另一邊明確交接已套用 A、釋放正式目錄；正式當時為 `c8942217303cb5f03471994ec4b91b8fddb1d14e`，K 關閉。其交接文件為 `D:\K-harness\docs\k-fixes-deploy-held-20261007.md`（純文件來源 `efbd899a37a29ba42dde868fccab296f7b2b404c`），沒有後續程式改動。
- 本聊天固定合併 SHA **`4a6c482f2df01e1b31216cffc9ec7a98088bdee9`**，乾淨 Git archive 候選 UI／extension／launcher 建置成功、既有 physical 相依及 lockfile 一致、全套 **964/964**，78.43 秒。隱藏真 Electron 連結 probe 再通過；572 個 tracked 檔全數符合固定版本。
- 套用前 47831 無 listener，沒有正式 K／原生核心工作程序；只有三個本人重載後的 Chrome native host，不停止它們。21:25 完成程式交換，`.local/runtime.json` 與正式 572 檔讀回一致；既有設定（除版本與 previous）、Codex config、核心選用、native manifest／config／host.bat／host.mjs hash 不變。
- 實際 vault native host 與 15 個 installed 0.1.3 擴充產物符合合併版。這次未重寫已由另一邊正確更新的 host 或擴充，避免改到本人剛重載的程序；沒有改註冊或搬帳號。
- 新程式還原位置：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791379532496`，可回到 A 的 c894221。若回到 A 前的 e068ffa，需搭配另一邊的 runtime 與 browser-program 備份一起對齊，不能只退程式而留下不相容擴充；帳號／對話不是退版資料。
- 本人確認三個助手已重載後，正式 `browser_profiles` 讀到三個不同 ID、均 connected。直接走正式 gateway 的 `browser_session`，各自到同一個新 localhost 假資料來源、同一 storage key 寫不同 sentinel；全部寫完後交叉讀回仍各自保留，**三個真 profile routing／storage 隔離 3/3**，三個 gateway 正常 detach。未登入網站、未讀 cookie／密碼、未枚舉私人頁面、不等於 Google email 身分驗證；未發出 foreground 操作。
- 正式 Gemini 模組及真 owner env 建構 → 真 Flash high 新假資料回合，讀到完整 PATHEXT 與 PS 7.6.6；Python 兩組各一次，輸出 K_FORMAL_STDOUT／K_FORMAL_STDERR、檔案內容讀回及原 Python LASTEXITCODE 0／7 正確。180秒觀測涵蓋回合，106筆事件中無可見終端事件。**模型尾加 Write-Output，所以此回合的 7 是明確輸出的 LASTEXITCODE，不是原生工具以非零終態回傳的證據**；B 先前不加尾部指令的非零回合另存，沒有混稱。
- 第一次本項一次性 probe 錯把 models() 回傳 Set 當 Array 呼叫 includes，於派任務前失敗；已保留失敗說明。只改 probe 為 Set.has、採全新假資料回合，不改 K、不重派任何舊工作、不覆寫失敗成成功。
- 本人後續明確回覆「現在重開 K，一起驗證」，由正常 `Start-K-Desktop.ps1` 啟動。正式 `/health` native 200，3 個建置資產 HTTP 200／hash 一致；無授權首頁與 state 仍 403，沒有放寬原權限。
- Windows UIA 讀到正式 K 工作台與原工作區／聊天室、子代理執行中0；未送出訊息或重播工作。本人仍在遊戲時沒有操作前景；本人之後明確表示暫停、要求切前景，才由既有 Computer Use 啟用正式 K 並取得真畫面。本人明確回覆「左鍵能開網頁，右鍵也有複製連結」，這是本人實機確認，與先前攔截 opener 的假資料證據分開標示。

證據：`D:\K-harness\.runtime\gemini-integration-20261007` 的 `fixed-candidate/prepared.json`、`activated.json`、`formal-source-readback.json`、`formal-http-readback.json`、`real-profiles/result.json`／`rpc-fake-evidence.json`／`close.json`、`formal-gemini-2/independent-readback.json`／`windows.json`、真正 Opus 整合審核收據。本人開頁／右鍵回覆保留在本聊天，不造系統自動點擊收據。

正式已合併套用並重開；**沒有 push、打 tag 或更新東區**。固定工作 Skill 本輪只有工作區假資料原生選用驗證，未把完整 ASR／素材化工作封裝或部署；這不是已完成的產品功能。SQLite 歷史根因與前述長期／編碼限制仍保留未知，不用正常畫面冒稱全部根因已解。
