# 原生合法 Unicode 被錯切，造成聊天室載入逾時（2026-10-12）

## 事故與直接根因

本人重新開啟「我殺了學院玩家」，先顯示載入骨架，再回空工作台，錯誤為 `Codex thread/read timed out; do not replay automatically.`。正式版本為 `3c2b0b5`，選用原生 Codex `0.161.0`。這與前一件手機 Tailscale 未啟動、由本人開啟後恢復連線的問題不同。

K 的 `codex-host.mjs` 使用 Node `readline.createInterface` 切分 JSONL。實際系統 Node 24.14.1，以及正式 Electron 44.4.5 內嵌 Node 24.21.0 的分界皆包含 LF、CR、U+2028、U+2029。後兩者是 JSON 字串內合法的 Unicode 字元，卻被當成整則協定訊息的終點。接著 `JSON.parse` 失敗被略過，原本已抵達的 RPC 回覆無法對上 pending request，30 秒後才報逾時。不能把這個錯誤歸因為模型失敗、服務未回覆或歷史必然過大。

正式讀回所見：該房 rollout 為 117,380,576 bytes、原生 `history_mode=paginated`，111 turns／5,184 items，其中一筆 item 含 literal U+2028。其他三個目前可見的 Codex 翻譯房，其當時 items 未找到 U+2028/U+2029；不據此宣稱它們未來不會收到這些合法字元。

## 隔離 A/B 證據

只在 Git 排除的工程目錄複製此房 rollout、此房原生 SQLite rows 及 schema/migrations；正式 DB 用唯讀方式開啟。未複製憑證、未呼叫 `thread/resume`、模型 turn 或原房工作。原生背景初始化的診斷另存，不當成推論成功證據。

- 第一個探針誤用未被選用的 base Codex 0.159.0，且缺少 paginated DB，返回零 turns。此失敗驗證方法保留，**不能用作成功證據**；後續依 `selected-cores.json` 固定 0.161.0，補齊此房限定 DB rows。
- 原讀法的全量 `thread/read` 已收到約 25 MB stdout，仍等到 240 秒探針期限；這不是原生 240 秒都沒回覆。
- 原讀法的分頁探針前 4,800 items 正常，第 49 頁被錯切而等到 30 秒。解析錯誤分別為字串未結束，以及下一片段不是合法 JSON。
- 將同一份原始 stdout 僅依 ASCII LF 分割，55 則訊息全部可正常解析。失敗頁原始 JSON 有 256,919 字元，位置 133,180 是 U+2028；沒有刪除或改寫其內容。
- **只改探針的接收分界**、不改核心／資料／30 秒 RPC 期限後，分頁完整返回 111 turns／5,184 items；同次全量 `thread/read` 亦在 **1,683 ms** 完整返回 25,013,322 bytes、111 turns／5,184 items，沒有 JSON 解析錯誤。

因此不採用延長 timeout、歷史裁切、分頁 UI、另造摘要或資料遷移。正式修正應只令原生 JSONL 以 LF framing 接收，保留 UTF-8 跨 chunk、CRLF、EOF 尾段及既有程序生命週期行為。Claude 同樣使用原生 JSONL 接收處須以具體回歸反例判定；啟動器的純文字控制協定不順手變更。

## 修正與驗收狀態

### 最小產品差異

- `src/native-jsonl.mjs`：共用約 30 行 LF reader，以 `StringDecoder` 保留跨 byte chunk 的 UTF-8；CRLF 與 EOF 未換行尾段正確送達，既有 close/abort/drain 語意不改。
- `src/codex-host.mjs`、`src/claude-host.mjs`：只將兩個 JSONL 接收點換成 LF reader，解析與 dispatch 路徑不變。Claude 亦有相同 literal Unicode 反例先失敗、修後成功，不是無證據順手修改。
- `test/native-jsonl-framing.test.mjs`：7 項 regression 包含 U+2028/U+2029、UTF-8 逐 byte、跨 chunk CRLF、25 MB、exit/EOF 尾段、abort、Claude control response。
- 不改 30 秒 RPC 期限、不加重試／快取／pagination／歷史裁切；`isolated-launcher` 純文字控制 reader 不動。

### 候選驗證

- 原實作 RED：7 項中 6 項失敗，既有 abort 場景通過，原 log 保留。
- 修改後 focused 33/33、完整 concurrency=4 **1303/1303**，UI build 成功。
- Astra 獨立檢查產品 diff，再以真正候選 `openCodexHost` 和固定 Codex 0.161.0 讀取同一隔離原始歷史：系統 Node 約 490 ms、正式 Electron 內嵌 Node 約 482 ms，均返回 111 turns／5,184 items。逐一 `deepEqual` 比對全部 5,184 筆 DB item 與 turn 順序，含 literal U+2028 的原項目完整保留；不是只比對數量或跑替代探針。
- 以上 native probe 只做 initialize／thread/read，未複製 auth、未開原房、未送模型 turn；兩次 host 正常關閉。耗時為本機本次讀回，不是效能保證。
- Built UI + 真 controller/open/projection + 假 transport 原封載入上述完整 native reply：1440×960／390×844 皆觀察到載入骨架→550 則歷史訊息→另一假房→切回，537 則 assistant text 與 native item 逐則一致、無退回空工作台、0 pageerror、0 turn/start。Astra 已讀回 receipt、driver 及兩尺寸截圖；這是完整真資料形狀的隔離 UI 驗證，不冒充真原房或實體手機。
- UI fixture 使用新 metadata 工作區、未複製原附件，因此截圖保留附件重新載入警告；沒有抹掉 warning 或宣稱原附件已逐一驗收，本批改動只解決原生 JSONL 丟訊息。

### 真正 Opus 5.5 複查與裁決

沿官方 Claude 訂閱執行，精確 model `claude-opus-5-5`、session `9267e909-d5c3-4964-8a50-ff503ed0dc60`。Opus 讀取 scope、最小 diff、兩 host、新 reader、新測試及原 tail 測試，未修改或執行測試；結論無 blocking，認為此為最小完整解。Astra 核對送審 hash 與候選一致，並獨立執行上方真 host 讀回。

非阻擋意見與取捨：close 移除 reader listener 不額外 pause，既有停止與 bounded drain 已處理；保留最小 CR 剝除與文字 chunk 相容，不新增抽象；100 ms Claude 測試觀測期限及 25 MB fixture 記憶體成本目前完整測試通過，不將理論風險擴成新產品機制。所有原始意見保留於私有 review，不刪減成只剩「通過」。

### 正式狀態

**候選已實作及上述驗證，尚未部署此修正**。正式仍為 `3c2b0b5`。本人已明確回覆「已離開並停止 K」，launcher 01:42:36 記錄 confirmed close，CIM／listener 讀回為 0 個 K 自有程序、0 個桌面 listener，外部 Chrome native host 保留。UI 讀回已完成，需固定版本及包裝驗證後才可正式套用，操作前再次核對停止。沒有重送工作或更換原生核心，未 push、未更新東區。

私人證據：`D:\K-harness\.runtime\thread-read-timeout-20261012\`。包含 `read-result.json`（不可採用的舊版探針）、`read-result-0161.json`、`pages-result-second.json`、`pages-result-third.json`、`pages-result-lf.json`、`novel-separator-audit.json`、`electron-framing-runtime.json`、`astra-candidate-host-node.json`、`astra-candidate-host-electron.json`、`framing-{red,focused-green,full-concurrency4}.log`、`framing-source-final.json`、`opus/` 與原始 stdout；真實對話、資料庫副本、截圖不提交 Git。

本修正不宣稱解決所有原生壓縮／供應商斷線，亦不把先前測試通過當成此資料形狀已被驗證。



