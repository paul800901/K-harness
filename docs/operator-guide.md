# K HARNESS Worker MCP：操作者派工與失敗處理指南

2026-09-14 補充：本文描述新版 MCP 0.2.0。預設仍只有讀取／建立檔案權限；逐任務指定 `coding` 才可修改程式並跑固定測試。既有 App 任務仍載入舊 schema，尚待重啟及原生驗證，詳見[接線狀態](app-coding-integration-20260914.md)及[程式工人說明](coding-worker.md)。

本文件依 `src/mcp.mjs`、`src/dispatcher.mjs`、`src/worker.mjs`、`src/files.mjs`、`src/mcp-transport.mjs` 現行程式撰寫。架構前提：一個受信任 host、一個明確且已註冊的 workspace 與 model，於建立 server 時注入；沒有網路監聽、常駐 daemon、自動重啟或工作重播。以下 JSON-RPC 訊息僅示範格式，**請勿實際執行**。

## 1. 六個 MCP 工具與真實參數

- `k_worker_run`：普通串行工作的首選，參數沿用 `k_worker_start`，另有 0–60000 ms 的 `timeoutMs`。同一呼叫只啟動一次並等待；逾時不取消、不換 ID、不重送。

- `k_worker_start`：`requestId`（必填，須符合 `^[a-zA-Z0-9_-]{1,128}$`）、`task`（必填，去空白後不得為空）、`readFiles`（字串陣列，預設 `[]`）、`outputFiles`（字串陣列，預設 `[]`）、`coding`（選填，含非空 `editFiles`／`testFiles` 陣列及選填 100–60000 ms 的 `timeoutMs`，預設 10000）。每個程式／測試檔都須在 `readFiles`，測試保持唯讀且限明列 `.mjs`；沒有任意命令參數。此工具只啟動，**回傳時通常尚未完成**；適合長程或並行工作。因可修改既有程式檔，其 `destructiveHint` 為 true；這只是工具註記，不會替代任務授權。
- `k_worker_recover`：只讀現有 job、transcript 工具證據與目前檔案觀察；不讀檔案內容、不續跑、不重播、不判定驗收。
- `k_worker_wait`：`requestId`、`timeoutMs`（整數，0–60000，預設 60000）。不輪詢，等到終態或逾時就回 handoff 與證據路徑。
- `k_worker_inspect`：僅 `requestId`。只讀既有工作記錄，不執行、不重播，用於復原或確認狀態。
- `k_worker_cancel`：僅 `requestId`。要求取消本 host 的 worker，之後仍須 wait 確認終態；已建立的檔案保留。

四個工具皆以 strict schema 定義，未知欄位會被拒。因此 `thinkingLevel`、`workspace`、`model`、`stateDir`、`jobId`、`signal` 等**只在 dispatcher / worker 內部使用，不能從 MCP 傳入**（例如 `requestedThinkingLevel` 由 host 決定，MCP 端固定為 `null`）。回傳格式為 `content[0].text`（JSON 字串）加 `structuredContent`，欄位取自 `handoff()`：`status`、`acceptance`、`workspace`、`outputFiles`、`provider`、`model`、`thinkingLevel`、`output`、`partialOutput`、`sessionFile`、`modelTurns`、`toolCalls`、`toolErrors`、`startedAt`、`finishedAt`、`cancelRequested`、`timedOut`、`note`、`error`，僅有值者才出現。

依據（`mcp.mjs`）：

```
const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u);
task: z.string().refine((value) => value.trim().length > 0), readFiles: z.array(z.string()).default([]), outputFiles: z.array(z.string()).default([])
z.strictObject({ requestId, timeoutMs: z.number().int().min(0).max(60_000).default(60_000) })
const idInput = z.strictObject({ requestId });
'Start one authorized Flash file task; returns before completion. Reuse the same requestId only for the identical request.'
```

## 2. 最小 start / wait / inspect 範例

範例須滿足以下條件。路徑存在性等會在新工作建立前檢查；輸入及輸出的大小限制則於對應讀寫工具執行時檢查。不可一概推定違反任何條件都在 `start` 失敗，或一定沒有工作紀錄：

- 每個 `readFiles` 輸入檔須已存在，且為一般檔案；不能瀏覽目錄，輸入必須是既有的一般檔案。
- 每個 `outputFiles` 的父目錄須已存在且為目錄；輸出檔本身不得存在。
- 讀入與輸出每檔上限 256 KiB；只處理 UTF-8。來源的 `checkedPath` 僅允許輸出的最後一段為 `ENOENT`（即輸出檔尚不存在），父目錄不存在、符號連結或越界等情形一律失敗；`write_output` 另在寫入前檢查輸出位元組數。
- 檔名須為 workspace 相對路徑；符號連結／junction、越界與 `.env.local` 一律拒絕。

```jsonc
// 1) 派工（立刻回傳，工作仍在跑）
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"k_worker_start","arguments":{
  "requestId":"task-20260914-01",
  "task":"讀取 notes.md，輸出三點摘要到 summary.md",
  "readFiles":["notes.md"],
  "outputFiles":["summary.md"]}}}

// 2) 等待（預設 60 秒；勿輪詢）
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"k_worker_wait","arguments":{
  "requestId":"task-20260914-01","timeoutMs":60000}}}

// 3) 需要時只讀記錄（復原／狀態確認）
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"k_worker_inspect","arguments":{
  "requestId":"task-20260914-01"}}}
```

典型回傳（`structuredContent` 節錄）：

```json
{"requestId":"task-20260914-01","jobDirectory":"<stateDir>/task-20260914-01","status":"completed",
 "acceptance":"not-reviewed","workspace":"<固定 workspace>","outputFiles":["summary.md"],
 "provider":"<host 注入>","model":"<host 注入>","output":"…","modelTurns":2,"toolCalls":2,"toolErrors":0,
 "startedAt":"…","finishedAt":"…","cancelRequested":false,"timedOut":false}
```

`jobDirectory` 預設落在 `<repo>/.runtime/jobs/<requestId>`。正常建立的 worker 紀錄以空字串初始化 `output`；`handoff()` 傳回非 `undefined` 的欄位，未建立完整紀錄的失敗／未知結果不保證帶有 `output`。只有正常 `completed` 才會填入非空的最終 `output`，其餘情形查看實際回傳的 `partialOutput`、`error`、`note`；成果是否合格仍須驗收檔案。

## 3. 重複 requestId

一個任務用一個固定 ID。同 ID 重送時，記憶體中已有 entry 便以 `assertSame` 比對 `jobId`、`task`、`workspace`、`readFiles`、`outputFiles`、`provider`、`model`、`requestedThinkingLevel`，再比較正規化後的 `coding`：全同則直接回報現況，**不再跑一次**；任一不同即報衝突。舊紀錄未含 `coding` 與未授權 coding 相容，但不能以同 ID 增加或更換程式／測試權限。host 重啟後同理：磁碟上已有 `job.json` 時，相同就回讀、不重跑。若工作目錄存在但記錄不可讀，回 `unresolved` 並提示不要換新 ID 重送。所有例外在 MCP 層被收斂成固定錯誤文字，不會洩漏參數或 provider 訊息，因此看到該文字時應自行核對 requestId、固定 workspace 與既有證據，而不是換 ID 重試。

有 coding 任務時，同一 host 會拒絕與活動工作重疊的可寫／可讀檔案；不同檔案的獨立工作仍可並行。這只是本程序內的衝突檢查，不是跨 host 檔案鎖；派工者仍須確認獨占修改範圍。coding 回傳結果會附上實際 `coding` 權限，供主代理核對。

依據：

```
if (!isDeepStrictEqual(saved[key], request[key])) throw new Error('This request ID already belongs to a different request.');
const known = entries.get(request.jobId);
if (known) { assertSame(known.request, request); return inspect(request.jobId); }
'A reserved job directory has no readable record. Inspect it; do not resubmit with a new ID.'
'Request rejected or result unavailable. Check the request ID, fixed workspace and existing job evidence. Do not automatically retry under a new ID.'
```

## 4. wait 逾時與取消等待

`wait` 在「entry 完成」與 `timeoutMs` 計時器之間取先到者；逾時只把 `timedOut` 設為 true 並回報當下狀態，**worker 仍在執行**。`timeoutMs` 非整數或超出 0–60000 會被拒。若 ID 只存在於磁碟（例如重連後的新 host），`wait` 會直接讀記錄並回 `timedOut: false`，不會真的等。另一件事是「取消等待」：MCP 把 `context.mcpReq.signal` 傳入 `wait`，只中止這次等待（reject），不影響 worker。逾時後的正確動作是再 `wait` 或 `inspect`，不要輪詢，也不要用新 ID 重送。

依據：

```
if (!entry || entry.finished) return { ...await inspect(requestId), timedOut: false };
timer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs);
// Ending a wait does not cancel or replay its worker.
if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) throw new Error('timeoutMs must be an integer between 0 and 60000.');
signal: context.mcpReq.signal
```

## 5. cancel 與 EOF

`k_worker_cancel` 只對記憶體中「尚未 finished」的 entry 呼叫 `controller.abort()`，然後回 `inspect` 結果。取消只是請求，不是結果保證，須區分三種情況：

- 已結束的工作（含本 host 已 finished）：`cancel` 等同讀記錄，不會把已正常完成的工作變成 `cancelled`；既有檔案不回滾。
- 本 host 不持有、但磁碟上有 `job.json` 記錄的 ID：`cancel` 只讀該記錄（可能仍是非終態 `unresolved`），不會接管或中止別的 host 的工作。
- 完全未知的 ID：`inspect` 會拋出 `Unknown request ID.`，由 MCP 收斂為 `isError` 與固定錯誤文字；此時沒有任何已知終態可等，應先核對編號與既有證據，不要在未知狀態下自動重派。

host 關閉（stdin 收到 `end`、SIGINT、SIGTERM）會觸發 `stop` → `close()`：先 `closing = true` 拒收新工作，對所有進行中的 entry abort，等全部 `done` 後才關閉 transport。若無法確認結果，stderr 會寫固定訊息並把 `exitCode` 設為 1。既有的 `write_output` 檔案不會被刪除。關閉後重連只是讀既有 `job.json`，不會自動續跑或重播。

依據：

```
if (entry && !entry.finished) entry.controller.abort();
if (closing) throw new Error('The dispatcher is closing; no new work accepted.');
for (const entry of active) if (!entry.finished) entry.controller.abort();
throw new Error('Unknown request ID.');
process.stdin.once('end', stop);
process.stderr.write('K worker shutdown could not confirm all results; inspect job records before retry.\n');
```

## 6. 輸出已存在

建立工具前會逐一路徑檢查 `outputFiles`；若目標已存在，直接丟出「本 worker 永不覆寫」的錯誤，寫入時另以獨佔建立 `open(target, 'wx')` 再保證一次。此檢查發生在寫入 `job.json` 之前，所以這類失敗通常沒有可讀記錄，dispatcher 會記成 `status: "failed"` 並附 `Dispatch failed before a readable job record was available; no automatic retry.`——`start` 回傳的是這個狀態，不是 MCP 例外。

這屬於新工作預檢即可確認的失敗，和「同 ID 已完成任務」的直接回讀要分清楚：後者是既有工作已有記錄，`start`／`inspect` 會回讀原結果，不會重跑。是否重做須另行決定；若確認前次未實際執行並決定重做，可用新工作與新輸出檔名處理，不要自動重派，也不要把「必須換新 ID」當成所有失敗或未知狀態的通則。

依據（`files.mjs`／`dispatcher.mjs`）：

```
if (last && isOutput) throw new Error('Output already exists; this worker never overwrites files.');
const handle = await open(target, 'wx');
'Dispatch failed before a readable job record was available; no automatic retry.'
```

## 7. 已結束程序留下的非終態工作

若 `job.json` 仍是 `running`，`inspectJob` 會把它改報為 `unresolved` 並附註「可能仍在跑或被中斷，不要自動重播」。由於同 ID 的 `start` 不會重跑既有目錄（見第 3 節），正確做法是用 `k_worker_inspect` 讀既有證據：`status`、`note`、`partialOutput`、`outputFiles`、`sessionFile`、`modelTurns`、`toolCalls`、`toolErrors`、`cancelRequested`、`startedAt`／`finishedAt`，再人工判斷是否需人工補做；未知結果不要換 ID 重送相同工作。

依據（`worker.mjs`）：

```
status: state.status === 'running' ? 'unresolved' : state.status,
'The persisted run has no terminal record. It may still be running or have been interrupted; do not replay automatically.'
```

## 8. `completed` 與成果驗收的差別

只有當 agent 迴圈正常結束、最後一則 assistant 訊息的 `stopReason` 為 `stop`、且最終文字非空時，`status` 才是 `completed`（此時 `output` 才有非空值、`partialOutput` 清空），否則為 `cancelled` 或 `failed`。而 `acceptance` 在 worker 內固定是 `not-reviewed`，程式註解與工具說明都明講「完成不等於被接受」。因此驗收必須由 parent 自行讀取 `outputFiles` 內容、比對任務要求，必要時再看 `partialOutput` 判斷是否為半成品。

依據：

```
// A normal completed agent loop is not proof of task acceptance by the parent.
if (agentCompleted && lastAssistant?.stopReason === 'stop' && text.trim()) {
  state.status = 'completed';
acceptance: 'not-reviewed',
'Completed means the worker stopped normally, not that its output is accepted. Independently inspect outputs.'
```

## 9. 目前不能處理的任務

- 只能讀 `readFiles` 明列的 UTF-8 檔，每個上限 256 KiB；不能瀏覽目錄，輸入必須是既有的輸入檔。
- 檔名必須是 workspace 相對路徑：在 workspace 內、且已明確授權的相對子路徑可以讀寫（輸出時父目錄須已存在、輸出檔須不存在）。不接受絕對路徑、`:`、NUL、空分段或 `.`／`..`，也不允許符號連結或 junction；憑證檔 `.env.local` 永遠禁止作為輸入或輸出。
- `write_output` 只能新增 `outputFiles` 明列的檔案，永不覆寫；選擇性 `coding.editFiles` 才能透過 `replace_code` 修改已存在的授權程式檔，修改前保留完整備份。
- 沒有 shell、擴充、skills、prompt templates、context files；重試功能關閉（`retry.enabled: false`、`provider.maxRetries: 0`）。
- 臨床資料與機密不得作為輸入或輸出。
- 沒有 daemon、自動重啟或工作重播：host 不在時沒有任何背景進度。

沒有 coding 授權時，需要修改既有程式或跑測試只能回報 blocker；有 coding 時也僅限授權程式片段及預先指定的 Node 測試。任意命令、網路、額外權限或 workspace 外／未授權路徑仍不屬於工具授權。目前的限制不是作業系統沙箱，也沒有強制網路隔離，不能拿來執行惡意程式。

依據：

```
export const MAX_TEXT_BYTES = 256 * 1024;
if (typeof name !== 'string' || !name || path.isAbsolute(name) || /[:\0]/u.test(name))
if (info.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed.');
throw new Error('The K HARNESS credential file must never be a worker input or output.');
retry: { enabled: false, provider: { maxRetries: 0 } },
noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
'Default: explicitly listed UTF-8 inputs and new outputs, up to 256 KiB each. No edits unless coding is explicitly granted for this task.'
```
