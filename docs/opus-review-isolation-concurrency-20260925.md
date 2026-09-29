# Opus 複查：登入隔離試點、聊天室並行（2026-09-25）

審查對象：`browser-isolation-pilot-20260925.md`、`concurrent-conversations-20260925.md`。
`npm test` 363/363（Opus 重跑）。正式開關 `.runtime/browser-mcp.json` 不存在；Opus 沒有重啟正式後端，也沒有使用模型回合。

## 一、登入隔離試點

### 判定同意：不能開放真實登入
- 試點設計嚴謹：拒絕項必須是 ACCESS_DENIED，不以「檔案不存在」算通過；確認子程序 SID；測試後停用帳號；失敗的第一次也保留紀錄。
- VM_READ 反證的解讀正確：`CreateProcessWithLogonW` 會沿用呼叫端的 logon SID，而人類端程序的預設 DACL 給 logon SID `0x121411`，其中包含 VM_READ。所以換 user SID 不等於有了新的隔離邊界。
- **補充這個反證的影響範圍**：這條啟動路徑下，低權限帳號不只拿得到 K 後端的 VM_READ，還拿得到**同一個登入工作階段裡人類的所有預設 DACL 程序**，例如日常使用的瀏覽器、密碼管理器。所以這條路徑對某些威脅來說，比完全不隔離更糟，**不能用它做任何部分上線**。

### 新 gateway：方向正確
- AI 只拿到 HTTP MCP 的 URL 和 AI token；人工控制只在可信程序的物件方法裡；`publishDescriptor:false` 模式不寫 `live.json`；重複 request ID 回 409；斷線走安全關閉。這些都補上了 Opus 先前指出的 `live.json` 問題（前提是程序記憶體隔離能夠成立）。
- Astra 另外找出的三個正式接入前提都很重要，同意列為必要條件：
  1. `GET /` 會對任何 loopback 呼叫者發 cookie；
  2. 可信部署不能是 AI 可以修改的 checkout；
  3. Codex、Claude、Luna 所有代理路徑都要一起降權，不能留同身分的旁路。

### 下一輪候選：先評估現成的 `codex sandbox`
- 本機安裝的 Codex CLI 有 `codex sandbox [COMMAND]...`，說明寫的是「Full command args to run under Windows restricted token sandbox」。runner 走的是 `CreateProcessAsUserW`，而且 Astra 引用的官方 `desktop.rs` 和 `token.rs` 已經處理 logon SID 和 default DACL。
- 建議先評估能不能用它來承載 Claude Code CLI 和 Luna 工人，把 Codex 現成的 Windows 沙箱當成共用的低權限 runner，不必自己寫 restricted token runner。要驗證的項目：
  1. 在 `codex sandbox` 之內，對 K 後端和人類測試程序呼叫 `OpenProcess(PROCESS_VM_READ)` 必須被拒（直接重跑本輪失敗的那一項）；
  2. 讀取假 cookie、假 token 必須被拒；
  3. Claude CLI 需要連到 Anthropic API，要確認沙箱的網路規則能不能只放行必要的網路；
  4. Claude 的訂閱登入憑證在沙箱身分下怎麼存放，不能直接複製使用者原本的 `.credentials.json`；
  5. stdio 串流、權限核准和停止在沙箱內是否正常。
- 這個指令可能觸發沙箱設定（ACL 授權），**必須先取得使用者授權才能實測**。

### Opus 操作揭露
- Opus 為了查看說明，執行了 `codex sandbox --help` 和 `codex sandbox windows --help`。後者被 runner 當成要在沙箱裡執行的指令 `windows`，在 cwd `D:\K-harness` 嘗試執行，結果因為找不到檔案（CreateProcessAsUserW error 2）而失敗，沒有執行任何程式。
- 事後讀回 `D:\K-harness` 的 ACL，有一條非繼承的 `PAULUS\CodexSandboxUsers : Modify`。使用者平常就在這個目錄用 Codex App 的 elevated 沙箱工作，這條權限**很可能事先就存在**；但 Opus 沒有執行前的讀回，**無法證明不是這次執行新增的**。沒有其他變更，Opus 也沒有嘗試修改或移除。

## 二、聊天室並行

### 確認正確
- 根因分析正確：不只是前端的 disabled，單一 Unified controller 只持有一個作用中對話；改成每個聊天室一個 controller pool，畫面選擇只切換顯示，原生執行和歷史不動，符合「薄接頭」原則。
- 所有操作都要帶 threadId，缺少或未知就拒絕，不預設操作目前畫面（`conversation-controller.mjs:19`）。停止、核准、佇列、草稿、附件都綁定來源聊天室。
- 找出並修好「A 送出中切到 B、A 失敗後草稿消失」。修前修後都有反證，這是並行化直接引出的問題，處理得很好。
- 如實寫明：正式後端還沒重啟，真正的 Claude 和 Codex 並行還沒實測。

### 建議
1. **閒置聊天室會累積背景處理程序（中低）**：每個開過的聊天室都保留自己的原生 host（Claude Code 處理程序、Codex app-server、Luna bridge），紀錄也承認沒有自動回收。開十幾個聊天室一整天，記憶體會明顯上升。建議只保留最近 N 個（例如 4 個），其餘在完全閒置時自動關閉，條件是不忙碌、沒有待送訊息、沒有待核准、沒有未結束的工人。下次切回再用原生 resume 開啟，不重送任何東西。
2. 同一個工作區被多個聊天室同時修改時，衝突需要自行分工。紀錄已明示，建議之後在側欄或送出前提示「另一個聊天室正在同一工作區工作」。

### 重啟後的正式驗收（尚未執行）
依紀錄第 65 行：A 工作中開 B 並送出 → 切回 A 看進度 → 停止 B 不影響 A。Claude 和 Codex 各跑一次，用非敏感的短任務。
