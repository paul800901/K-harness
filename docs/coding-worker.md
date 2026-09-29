# 限定程式工人（2026-09-14）

已實作並完成一次修正後的 DeepSeek live 驗收。僅涉及 K 內新建的人工案例；沒有更動既有 App 派工設定、其他專案或正式資料。

## 實際能力與入口

`runWorker`、`dispatcher.start` 與新版 MCP `k_worker_start` 均接受選擇性 `coding`；CLI 從明確指定的 request.json 讀取。未指定時維持原本 read/create-only 行為。App 設定不變，但既有 App 任務目前仍載入舊 schema；需要重新啟動 MCP 再驗證原生 coding 派工，詳見[接線狀態](app-coding-integration-20260914.md)。

範例參數片段（不是可直接執行的完整任務）：

```json
{
  "readFiles": ["summary.mjs", "checks.mjs"],
  "coding": {
    "editFiles": ["summary.mjs"],
    "testFiles": ["checks.mjs"],
    "timeoutMs": 10000
  }
}
```

主程式必須先確認指定工作區可獨占修改、內容非敏感，且程式與測試可信、不含惡意行為。每個程式／測試檔都必須同時列入 `readFiles`；測試只能是明確的 `.mjs` 檔案，不搜尋目錄、不執行 npm scripts，也不安裝套件。

- `replace_code(path, expectedText, newText)`：只替換指定檔案內唯一匹配的非空原文片段；原文不存在或有多處匹配就拒絕。保留其餘內容、換行及修改前完整備份。拒絕未授權檔案、測試檔別名及硬連結；單一程式檔仍以 256 KiB 為上限。每次修改在備份後重新核對整份前像，但這不是跨程序檔案鎖。
- `run_tests()`：模型不能指定命令或參數。由主程式固定使用目前 Node 執行檔，依序載入授權測試，由 `node:test` 執行；不使用 shell。結果含真實退出碼、狀態、輸出及保存位置。預設 10 秒，主程式可設 100–60000 ms；輸出上限 64 KiB。逾時、取消或超出輸出上限會終止這個測試子程序並等待其關閉。
- 只向測試子程序傳入 Windows 必要的 `SystemRoot`／`WINDIR`（若存在），不繼承 API key、`NODE_OPTIONS`、PATH 或其他環境變數。模型產生的程式不匯入持有憑證的主程序。
- `completed` 仍只表示模型正常結束，任務紀錄仍是 `acceptance: "not-reviewed"`。測試退出碼 0 也不是獨立品質驗收；必須檢查實際 diff、測試內容及結果。

## 安全與恢復限制

這不是惡意程式的隔離環境。Node Permission Model 僅作誤操作防護；本機 Node 24.14.1 沒有可用的網路權限旗標，本實作**沒有網路隔離**。模型提示中的禁止網路不是強制隔離。不能藉此開放陌生儲存庫、下載程式或敏感資料；Node 官方也明確說明 permission model 不能作為惡意程式的安全沙箱。[Node 安全模型](https://github.com/nodejs/node/blob/main/SECURITY.md)

一般檔案 API 的讀取僅授權逐一列出的 inputs，不授權寫入、子程序、workers 或原生 addons。離線測試已驗證普通越界讀取、寫入及再啟程序會被拒絕；這不是對所有繞過手法的安全證明。

每次修改的原文位於該任務 `edits/edit-*/before.txt`，同目錄 `target.json` 記錄工作區相對路徑。修改採原檔寫入以保留檔案屬性；硬中斷可能留下部分內容，備份供人工恢復，不自動回復或重播。取消不能撤銷已完成的修改。主程式必須避免不同工人同時修改同一工作區。

每次測試在任務的 `test-*/result.json` 保留實際結果。若程序在保存前中斷，可能只剩目錄；依原本 `unresolved` 規則先查看證據，不自動補跑。

## 驗證與觀察

程式工人階段 36／36 通過：原有 26 項加 10 項 coding 測試，包含實際 Pi 工具循環、前像備份、唯一匹配、換行保留、授權邊界、環境隔離、固定測試執行、逾時、取消及輸出上限。後續 dispatcher／MCP 接線新增 5 項測試，最新完整結果 41／41 通過。

第一輪 live 使用整份原文匹配介面，工人約 13.18 秒完成修復，指定測試 4／4、主代理額外案例也通過，但因檔尾換行差異產生兩次可恢復的修改拒絕。原始報告另把「沒有任何工具錯誤」設成通過條件，所以其 `accepted` 為 false；保留此原始結果，不回寫歷史。這不表示修復產物有錯，而是早期驗收條件把可恢復錯誤與成果失敗混為一談。

依這項實測，改為唯一原文片段匹配，並把工具錯誤保留為觀察數，不單獨否決已正確完成的成果。增加相應 regression 後，使用全新合成目錄重新跑完整流程，不重播旧任務。

第二輪 live（UTC 06:55:16–06:55:25）：

- Flash 工人 8,758 ms，5 次模型請求、5 次工具呼叫、0 次工具錯誤；未指定新的 reasoning effort，實際紀錄為 high。
- 先讀兩檔，重現 4 項失敗；僅改 summary.mjs 的 4 個錯誤：不去重列數、加總從 0 開始、保留 ID 順序、只有嚴格 null 算未知 owner。
- 工人測試 4／4 通過；主程式獨立重跑 4／4，再用未提供給工人的額外案例測到共 5／5 通過。額外案例包含重複 ID、小數分鐘、全部 pending。
- 原始測試檔未變、修改前原文可讀回、沒有其他工人產物、紀錄未出現金鑰。主代理另外讀回程式並核對邏輯，沒有代改 Flash 成果。
- 自動流程從啟動至額外測試完成約 8.96 秒；**不含人工架構、工程、主代理審閱與本說明撰寫**，不能當作整輪端到端時間或對 Luna 的優勢。

最新證據：[live 報告](../.runtime/coding-tests/live-UkPWWF/report.json)、[工作紀錄](../.runtime/jobs/job-VHqGXi/job.json)、[修改結果](../.runtime/coding-tests/live-UkPWWF/workspace/summary.mjs)。第一輪：[原始報告](../.runtime/coding-tests/live-YjFhfV/report.json)。記錄由 Git 排除，搬移專案時不可假定會一併帶入。

目前結論：**小型、範圍明確的修程式工作可以交由 Flash 執行並驗收。** 這不是任意儲存庫安全執行、完整通用 harness、Sol 接入、長任務記憶或同品質成本／速度優勢的證明。

## 重現入口

```powershell
# 僅离線測試，不呼叫模型。
node --test test/coding.test.mjs

# 新建非敏感合成案例並實際呼叫 DeepSeek；需相應 live 授權。
node scripts/coding-smoke.mjs --live --key-file .env.local
```

live 腳本最多 12 次官方 DeepSeek 請求、180 秒，不自動重試或更換模型。API 用量保留於報告，不依舊 Pi 模型目錄計算美元費用，也不宣稱訂閱節省比例。
