# Gemini 工作區 Google 試算表唯讀接線（2026-10-16）

## 問題與根因

本人在營運資料工作區詢問期間收入，Gemini 未回答而顯示 `agy no output produced（headless 無法核准工具）`。本次唯讀調查確認：

- 該聊天室為 workspace-write，沒有工作區 Google Sheets MCP 綁定。既有 `k_google_ops` 只有四項 GBP 查詢，不能讀試算表。
- 原生紀錄顯示列目錄命令被既定 command deny 拒絕；`.gsheet` 可讀不代表已讀到雲端儲存格；其後引用一份不存在的文件，最後跨工作區讀取暫存規則被拒。
- K 原本僅憑 `no output produced` 字串就顯示工具核准原因，缺少證據時也會如此。

不是已證實的算術、額度或 Google 登入故障。本次不修改營運正式資料、KAI、登入或計費。

## 本人授權與最小修正

本人明確同意：K 在該營運工作區沿用既有 Google Sheets 工具，**只開放唯讀查詢**；不修改 KAI、不複製憑證、不新增登入、不開放寫表。

- 新增 `src/google-sheets-mcp.mjs`：只提供 `sheets_metadata`、`sheets_read_values`，以參數陣列、無 shell 呼叫 owner 指定既有 CLI 的 `meta`／`get`。指定試算表清單由 owner 私有設定提供，模型不能改 CLI、清單或子命令。
- 既有工具自己使用原有授權。K 不匯入其驗證模組，不讀出、複製或保存 token。原工具具備寫入功能不代表接頭提供寫入入口；接頭沒有 update、append、clear、batch、create 或分享操作。
- 沿用 `gemini-project-mcp.mjs` 的 exact-workspace、`allowReadOnly` 和原生 MCP 設定。主對話／工人都走原有接線，不新增通用權限框架、彙總器、記憶、設定頁或服務。
- `gemini-worker.mjs`、`gemini-controller.mjs`：兩個原生入口加入相同工具指引，說明 .gsheet 不是資料、非完整存取不能跑命令、不可繞過拒絕，缺少工具要明確回報。只在 no-output 且有拒絕證據時說明權限原因，並列受阻工具／目標；未知原因保持未知，原生診斷保留。
- 不變更 command deny、不加 skip、不自動重播原對話、不切模型或帳號。

## 私有接線方式

使用既有私有狀態根目錄 `.runtime/gemini-mcp.json`，在本人核准的 exact-workspace 加入：

```json
{
  "workspace": "<已核准工作區完整路徑>",
  "mcpServers": {
    "k_sheets": {
      "command": "<既有 node.exe 完整路徑>",
      "args": ["<已驗收版本>/src/google-sheets-mcp.mjs", "--serve", "<已核准既有 google-sheets.mjs>", "<已核准 spreadsheet ID>"]
    }
  },
  "allowReadOnly": ["mcp(k_sheets/sheets_metadata)", "mcp(k_sheets/sheets_read_values)"],
  "allowWrite": []
}
```

這是本次明確授權的接線，不表示其他專案或試算表自動取得權限。實際路徑、試算表 ID、資料與憑證不提交公開 Git。既有 CLI 及接頭必須位於 Gemini 可寫工作區之外；本次選定路徑符合，不為沒有發生的其他部署形態加新機制。

## 驗證與限制

證據留在本工作樹 `.runtime/archive/gemini-sheets-20261016/`，不提交 Git。

- 定向初版：93/93。
- 完整測試第一次 1711/1713：乾淨工作樹未建置 `dist-ui`，兩個服務資產測試失敗；先建置介面，沒有改程式迎合缺檔。
- 建置後第二次 1712/1713：一項未修改的 Claude 非同步通知測試等待逾時，保留原錯誤。後續 `npm test -- --test-concurrency=1` 完整 **1713/1713 通過、0 失敗／跳過**（62.5 秒）。保留原錯誤，沒有修改無關測試或控制器。
- 真正 agy 1.4.0 初次權限八項行為全部通過；腳本留存證據路徑檢查仍指向舊 1.3.4 archive，導致最後報告 FAIL。未刪資料；修正本輪腳本路徑後以新假資料重驗 **8/8 PASS**，`permission-probe-v2.log`；原失敗保留，未刪資料、未換模型或版本。
- 已用既有 CLI live 讀回正確 metadata 與表頭；新接頭的原生 Gemini 查詢已通過，細節見下；正式接線尚未套用。

## Opus 5.5 審核與取捨

Claude Code 2.1.301、Claude.ai Pro / firstParty，實際 assistant 模型 `claude-opus-5-5`，session `1d3635ff-009f-42b0-8e4c-942de7009a50`，exit 0、success，12 次唯讀工具呼叫。原文 `review/review.md`、模型證據 `review/result.json`。

結論：程式沒有必修阻擋；部署前確認 (1) CLI 不在 Gemini 可寫範圍，(2) 原生 MCP 子程序繼承 Gemini 環境後仍能使用既有授權。

- (1) 本次營運工作區、既有 CLI、K 接頭路徑各自分離，已依實際路徑核對，不加第二層註冊系統。
- (2) 用真 Gemini 工具呼叫驗證，不能用直接 CLI 成功替代，已用候選 controller、實際營運工作區、workspace-write、Gemini 3.8 Flash high 和原生 agy 1.4.0 完成。實際 MCP 使用既有 OAuth 成功讀到儲存格，不靠直接 CLI 結果冒充。
- 未採納將所有 `-` 開頭一律拒絕的額外建議：既有 CLI 只解析 `--render`／`--raw`，目前排除 `--` 已覆蓋實際選項誤解；無任意命令入口。保留雙處 ID 檢查，分別保護 MCP handler 與可直接呼叫的執行函式，未新增 checker。
- 其他建議為非阻擋；主代理仍須獨立檢查 diff、測試與實際讀回，不將審核意見等同部署。

## 發布狀態

程式 commit：`e95b30afc21514fd106bb230212a471b93881707`。程式與文件分開提交，本批已具備本機驗收證據；本輪文件合回狀態於收尾核對。

本人最後要求「你做完後暫停等我回去再關 K」，因此不關閉 K、不部署、不 push，也不新增正式私有 MCP 綁定。等本人正常關閉後再接續。正式程式目前仍為 `0d14cbd14c3f5c841dda32db254665685ac0d5e6`，手機原聊天室不會因此自動重送或獲得新工具。

## 最終實際查詢驗收與接續

- 初次主對話測試腳本誤將 `workspace` 傳給 `open()`，但該 API 需先呼叫 `selectWorkspace()`。因此測試根目錄仍是候選工作槽、exact-workspace 正確不載入 MCP。失敗原結果留在 `native-result.json`，沒有為測試錯誤放寬產品接線。
- 改正測試入口、加入實際 `state.workspace` 核對，使用新的隔離測試對話（不是重送使用者的原對話），完成 `native-read-v2.mjs`。正式工作區、已核准表與日期範圍均相同，沒有切帳號、修改表格、建立報表或讀取客戶／病例欄位。
- 最終 `native-result-v2.json`：`status=completed`、`error=null`、模型 `gemini-3.8-flash`。成功呼叫 12 次 MCP（1 次 metadata、11 次範圍讀取），使用日期／服務狀態／金額／付款狀態欄；金額及納入筆數與獨立 live 四欄讀回一致。真實金額與資料 ID 留本機，不提交公開 Git。
- Gemini 另外猜讀一個不存在的 MCP instructions.md，收到找不到後仍完成工作；沒有權限拒絕，也沒有為此新增檔案或備援。成功不代表所有工具步驟零錯誤。
- 自動測試、真正原生權限、實際 Google Sheets 查詢、主代理 diff 檢查與 Opus 意見都各自保留，不把其中之一冒充其他層驗收。Opus 封包中的程式與最終 code commit 相同。

本人回來關閉 K 後：先確認本機 main 與其他聊天室最新已驗收批次及部署者，必要時以新基底重新驗證，不覆蓋其他工作。依 `Update-K.ps1` 指定完整已驗收 SHA；失敗保留原錯誤、不重試。成功後在正式私有 `.runtime/gemini-mcp.json` 合併本次 exact-workspace 唯讀綁定，指向正式 runtime 的接頭檔案與已核准既有 CLI／試算表清單，讀回原有綁定未損。重開後驗證正式設定與查詢能力，不重播原本收入查詢；最後才依規則 push 與遠端 SHA 讀回。以上目前均未執行。

### 本輪停止點讀回

程式與首份文件已於本輪 fast-forward 合回 `D:\K-harness` 的 main，讀回為 `01e1155fe9dadfd5fec723d83a905de93ec9025c`（後續本段為純文件收尾）。main 與候選工作樹皆無未提交程式變更。正式 47831 仍由原 K 程序監聽，`.local/runtime.json` 版本未變、正式 Gemini MCP 綁定檔仍不存在；符合本人先暫停、不關 K、不部署、不 push 的要求。

本輪證據實際保留於 `C:\Users\Paulus\.codex\worktrees\gemini-sheets-read\K-harness\.runtime\archive\gemini-sheets-20261016`。暫不封存該工作樹，避免遺失 Git 排除的原生驗證與審核紀錄；沒有複製原生帳號、登入或憑證。下一輪依本文件接續，不能只看到 main 新程式就當正式已更新。
