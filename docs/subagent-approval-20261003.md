# 子代理權限與檔案核准修正（2026-10-03）

## 使用者決定與範圍

基於 `main` 的 `30d845c`，本機分支 `fix/subagent-approval`。不修改 `C:\K-harness工作區\antigravity-worker` 或其 `feature/antigravity-worker` 分支；推送前另問使用者。

Claude 主對話選「略過權限提示」（`claude-bypassPermissions`），或 Codex 主對話選完全信任／完整存取權（`danger-full-access`），即信任主代理。主代理決定子代理工作的核准與否，不再交給使用者；子代理不得超過主代理授權。其他模式維持原狀，包括 `claude-auto`、`claude-dontAsk`。

使用者已確認第 3 項：K 專用 Codex 家目錄缺少設定檔時建立 `[windows] sandbox = "unelevated"`，並套用東區；任何已有設定檔保留原樣。這不修改全域 Codex 設定，也不啟用 elevated 沙箱或改 Windows 帳號／ACL。

## 根因與修改

- `src/claude-controller.mjs`：原本除了 plan，所有 Claude 模式都派 `workspace-write` 工人，所以 bypass 主對話仍收到子代理核准。現在 bypass 對應 `danger-full-access`、plan 對應 `read-only`，其餘對應 `workspace-write`。保留工人未結束時拒絕權限切換；切換後關閉舊 bridge 並重新建立。`codexApproval(request,item)` 將 item 傳給 `approvalRequest`。
- `src/luna-bridge.mjs`：核准請求原本只傳 message，檔案變更 item 未傳入，導致 `changes` 空白、`canAccept` 為 false。現在從 `thread/read` 的對應 turn 找 `itemId`，傳給回呼；讀回期間完成或換 turn 時不再排入核准。實機再發現待核准 item 尚未出現在 `thread/read`，必須保留原生 `item/started` 提供的完整 fileChange，僅同一 thread／turn／item 可使用；操作／回合完成即清除。兩個來源都缺少實際內容時仍只能拒絕。子代理指示補上不得超過主代理授權。
- `scripts/install-runtime.mjs`：停止檢查通過後，啟用版本時以 `wx` 建立缺少的 K 私有 Codex `config.toml`；已存在則不修改。安裝、更新及既有回復流程共用此入口。南區已有設定不會被改寫。
- `AGENTS.md`：記錄兩家主代理的信任決定與 Windows 設定授權。
- `test/claude-controller.test.mjs`、`test/luna-bridge.test.mjs`、`test/install-runtime.test.mjs`：增加模式、切換、工人未結束、原生變更讀回、缺項／讀取失敗、讀回期間完成、設定建立與既有設定保留的回歸驗證。既有 Codex 主對話完整存取權測試一併執行。

Windows 設定依 OpenAI 的 [Config basics](https://learn.chatgpt.com/docs/config-file/config-basic) 核對：`unelevated` 是官方支援值；本輪依使用者明確選擇採用，不自行切換官方建議的 elevated。

## 驗證

- 東區環境保留 `K_DICTATION_PROVIDER=windows`，五個定向測試檔 **107/107 通過**。
- 首次新增測試有兩項失敗，原因是測試錯將布林 reply 介面傳入物件，以及嘗試回答介面已停用的接受動作；修正測試呼叫後通過，未因此放寬產品核准限制。
- 候選完整測試 **528/528 通過**，無跳過；介面、瀏覽器擴充與 C# 啟動器建置成功。候選使用 Git 提交 `419a01d4d5a5e6f7c6e25d3c0c19f2e08bdaaf61`，保留東區 `K_DICTATION_PROVIDER=windows`。證據：`.runtime/subagent-approval-targeted.log`、`.runtime/subagent-approval-prepare.log`。
- 首次真實 UI 驗證：Claude bypass → Luna/low 以 `danger-full-access` 成功建立標記檔，沒有核准提示。切回 manual 後，橋接確實使用新 `workspace-write`，但檔案核准仍不可接受；已從介面拒絕該請求，工人完成並確認檔案不存在，沒有重送該任務。原生診斷證據 `.runtime/bootstrap/subagent-native-approval-trace.json` 顯示 `item/started` 已有完整變更，而同一 host 的 `thread/read` 當時只含 userMessage。
- 補上待核准原生 item 後，五個定向測試檔 **108/108 通過**；包含未進 thread/read 的 live item、外來 thread／turn 不得覆蓋及完成後清除。補修後完整套件與正式 UI 重驗待執行。

## 正式部署與實測

首次套用前：Windows 視窗清單沒有 K；正式連接埠 47831 沒有監聽、K launcher／Electron／專用核心程序未在執行。已套用第一版 `419a01d`、建立 Windows 設定檔，保留原程式於 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1790964382189`。三個修改檔與 Git 內容一致（只正規化 CRLF／LF 比較）；證據 `.runtime/bootstrap/subagent-approval-activation.json`。

正式部署版本、可還原版本、設定讀回、Claude→Luna/low 真實派工及人工核准按鈕驗證：待後續補記，不以單元測試通過宣稱完成。
