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
