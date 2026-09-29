# K UI parity 實作與 Opus 複查交接

日期：2026-09-24。此文件記錄本輪實作，不覆蓋 Opus 原始規格；若不同，以下使用者後續定案優先。

## 使用者定案

- K 僅維持共用介面、待送輸入與交接投影；Claude Code / Codex app-server 維持各自原生歷史、執行、核准與壓縮。
- 同對話不切換供應商；跨供應商必須分支至新對話。分支升為本輪優先實作。
- 分支視窗可選供應商、模型、強度、權限；同供應商預設目前權限。不同供應商權限語意不能直接等同，因此需在視窗選新供應商的原生權限。
- 「建立並接續」立即開始。接續指令可空白；空白即繼續尚未完成事項，已完成則回報，不自行增加工作。
- A 工作中送 B、C、D，預設持久排隊；可挑任一列立即送入。例如 C 先送，B、D 次序不變。停止暫停佇列；重新開啟有待送項目時亦暫停待確認。送出狀態不明不重播。
- 聽寫先用 Windows Win+H，只填草稿不自動送出；不裝本機語音模型、不換 API、不新增錄音保存。

## 已實作

1. 最低限度 `.env.local` deny、realpath 憑證比對、啟動器完整工作區比對、Claude 成功登入檢查五分鐘快取、無主代理 host 時額度五分鐘節流。安全證據與殘餘風險見 `ui-parity-security-20260924.md`。
2. 共用分組摺疊、完整結論、單列複製／分支／時間；新訊息時間投影不改原生歷史，舊訊息不補造時間。
3. SSE 初始／重連快照，之後訊息 append、工具 output tail 與其他變動欄位；第二 client 連入前先 flush 已排程的變動，避免原 client 漏更新。
4. 共用待送佇列、任意項目立即送入、停止暫停、未確認送出不可自動重播。Claude 透過 stream-json user UUID + 官方 replay 確認接收；Codex 使用原生 turn/steer。
5. 同供應商原生 fork；跨供應商在工作區 `.runtime/handoffs/` 產生只含截止點前使用者訊息、各組结論及可歸屬成果清單的交接檔。新對話第一則僅短概要、檔案路徑及本次指令。
6. Windows 聽寫提示與輸入框聚焦入口；按鈕不是自行啟動或模擬系統熱鍵。

## 真原生驗證（隔離資料目錄，不是正式 47831）

證據根目錄：`D:\K-harness\.runtime\ui-parity-20260924`。

- `native/claude-probe.json`、`native/claude-tool-probe.json`：Claude 工作中 user message，工具中／文字輸出中／停止競態、原生 fork。第一次工具 probe 錯以 Bash 比對，PowerShell 被拒；保留失敗紀錄。修正後只放行合成 fixture 的等待命令，工具執行與補充結果通過。文字輸出時補充可能接到下一個原生回合，不能宣稱按立即送入必定立刻打斷。UUID replay 是接收證據，不是工作完成。
- `native/codex-probe.json`：原生 thread/fork + lastTurnId 選較早回合，child 能回憶選點前 marker、不含其後 marker；parent 不變。
- `native/unified-integration.json`：實際呼叫統一 controller，Codex 原生分支、Codex→Claude、Claude 原生分支、Claude→Codex，四項皆回讀 `K_INTEGRATION_6385` 正確。交接兩側實際讀取交接檔；沒有 API 計費替代。
- `native/queue-integration.json`：Claude、GPT-6 Sol 各一次，A 中排 B、C、D，點 C 立即送入，投影 user 次序均為 A,C,B,D，最後都輸出 QUEUE_D_OK，沒有殘留待送項。
- `security/claude-deny-test.txt`：只拿假的 `.env.local` 實測 Read 被拒，不讀真金鑰。

## 效能證據與限制

`stream/benchmark.json` 是 Node 合成資料測量：50 個工具共 1 MB 輸出、80 訊息、60 ms 一次，共 120 次。全快照估計 17,490,244 bytes/s；變動推送約 2,203 bytes/s。此值不包含初始快照，不代表所有工作負載，Node reducer 時間不是瀏覽器畫面渲染時間。

## 明確限制

- Claude 原生同供應商分支目前只開最新結論；較早回合的原生定位尚未驗證。Codex 可指定已驗證的原生 turn 邊界。跨供應商可用各組結論截止點。
- 執行中的工作、待核准、未完成／unresolved 工人及尚未處理的待送訊息會擋分支，避免來源狀態被切斷。先處理待送項目再分支。
- 執行中立即送入先支援文字；附件仍可排隊依序送出。
- 舊歷史缺乏分組／成果歸屬證據時，不捏造時間或把之後的成果清單混入較早交接。
- Windows 10 東區電腦的語音語言、準確度與麥克風尚待實機；本轮不宣稱已測那台電腦。
- `.env.local` deny 不是 OS 沙箱，未解決 Bash／Codex／Luna 讀取。真金鑰未搬移；根本解仍需另行授權。
- 正式 47831 後端本輪未重啟、未部署、未 push。建置與隔離原生測試成功不等於正式後端已載入。

## 複查資料

本輪開始前的原始碼快照：`.runtime/ui-parity-20260924/before/`。工作區原本已有大量修改及 untracked 檔案，因此應以該快照比對本輪 scoped diff，而不能把整份 git diff 當成本輪變更。

## 最後整合審查

- 補上停止／失敗／斷線時 partial 投影：未完成輸出保留可讀，但不能作為已完成結論分支。重新開啟 Codex 時以原生 turn 狀態為準，原生已完成會覆蓋舊 partial 投影。
- 舊正式後端仍送裸狀態時，前端亦可讀回；新 snapshot／patch 協定不變，避免只更新 UI 後舊後端畫面空白。
- 使用者分支明確標記 `branchType:user`，側欄保持可见；未標記的原生工人 child 維持原本隱藏規則。
- 真瀏覽器隔離畫面確認：收合不掛載過程細節、展開後顯示工具與兩則 K 系統事件、工作中 Enter 可排隊且清空草稿、分支模型／強度／權限選項正確、跨供應商要求明確權限選擇。
- 一次兩組合成資料的展開操作，透過 Chrome Performance counters 量得 Layout 3.514 ms、RecalcStyle 0.692 ms、Script 3.025 ms、Task 20.075 ms。這是操作區間累計，不是純 React commit 時間，也不是 50 工具長對話串流 benchmark；不外推到東區電腦。
- 另完成真瀏覽器長對話測量（`stream/browser-benchmark.json`）：80 訊息／40 組、50 工具共 1 MB 輸出，120 次每 60 ms 合成增量。Chrome 累計 Layout 353.102 ms、RecalcStyle 20.397 ms、Script 1960.283 ms、Task 2908.920 ms；末尾「增量119」及回合完成已讀回。40 組過程均可收合，收合時掛載過程 section 數為 0。未測舊版本瀏覽器基準，因此只報新版本實測，不宣稱此耗時的改善百分比。
- 既有「第一次開工」投影只讀檢查（`legacy-layout-check.json`）：40 訊息分成 12 組，5 則 worker-completion 沒有生成額外使用者 root（0 個）；12 組均有結論，沒有舊時間資料的 12 組未補造時間。沒有操作或重啟這個正式對話。

## 最終驗證與交付

- 最終專案測試 `npm test`：252/252 通過，0 fail。紀錄：`.runtime/ui-parity-20260924/full-tests-final.txt`。
- 最終 UI 建置成功。紀錄：`.runtime/ui-parity-20260924/build-final.txt`。主 JS 約 731.58 kB（gzip 220.50 kB），仍有超過 500 kB 的 Vite 警告；本輪未為消除警告另作無關拆包。
- 精確本輪差異：`.runtime/ui-parity-20260924/review.diff`；變更檔案清單：`.runtime/ui-parity-20260924/changed-files.json`。這兩份以本輪開工快照為基準，不混入之前尚未提交的改動。
- 程式碼修改與隔離驗收完成；未 push、未安装相依、未搬移真金鑰、未改全域設定。正式 47831 後端未重啟；需在沒有工作執行時重新啟動 K 才載入新版後端，再做正式 UI smoke check。
- 最終純讀 `/health` 顯示正式工作區帶尾反斜線；啟動器補正尾分隔符正規化後再比完整路徑。隔離 C# DLL 對實際 47831 health 回傳 true，`K-harness-alt` 與子目錄均 false；未置換正式 launcher EXE。證據：`security/launcher-healthfix-tests.txt`。
- 加入 partial 修正後，再跑一次四路真原生分支及兩家指定 C 插隊；全部再次通過，最新證據已保存於相同的 native integration JSON。
