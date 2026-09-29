# 已登錄 K 專案工作區的秘密檔隔離實測

## 結論與範圍

2026-09-26 18:34:50–18:34:53（臺灣時間），在正式正在使用的 `KCandidate1` 中完成一次不讀內容的開檔測試。有效工作區開放規則確實包含 `D:\K-harness\*`；一般工作區假檔可取得讀取 handle，真正的 `.env.local` 與實際受保護 vault 內的新假檔均被 `EPERM` 拒絕。

這回答使用者縮限後的問題：「把整個 K 專案登錄為工作區，是否仍能擋住這兩處？」本次觀察為可以。沒有執行先前提到的整套功能測試，也不把本結果擴張為所有路徑、所有憑證或所有攻擊方式的隔離保證。

## 方法與結果

- 本機只核對真正 `D:\K-harness\.env.local` 的存在、一般檔案類型與實際路徑，沒有在隔離外打開或讀取內容。
- 透過現有 Sandboxie 官方單次啟動入口，將 probe 放入 `KCandidate1`。先取得 probe PID `35332`，由盒內程序清單確認其身分，再送出允許本次測試的假資料旗標。
- 使用既有 `scripts/query-sandboxie-workspace.ps1` 讀回 effective OpenFilePath；測試前與實際開檔前都包含 `D:\K-harness\*`，不是僅憑 INI 推論。
- probe 對三個指定路徑只執行 `openSync(path, 'r')`；成功即關閉，不呼叫任何內容讀取方法。

| 指定目標 | 結果 |
| --- | --- |
| `.runtime\isolation-pilot\workspace-secret-open-20260926-183416\ordinary-workspace-file.fake` | 可開啟，作為工作區權限有效的正向對照 |
| `D:\K-harness\.env.local`（真正既有檔案） | 拒絕：`EPERM`，errno `-4048` |
| `.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\workspace-secret-open-20260926-183416.fake`（新建非秘密假檔） | 拒絕：`EPERM`，errno `-4048` |

受保護檔案讀取位元組數為 **0**。未打開 vault 裡任何既有 cookie、帳號或登入資料；vault 測試用的是相同受保護目錄中的假檔，不是另設較嚴格權限的替身目錄。

## 未干擾正在執行的工作

- 未呼叫工作區準備、政策改寫、box stop 或 terminate；未更改 ACL、帳號、Sandboxie 規則、服務或驅動。
- 不使用會在結束時停止整個 box 的一般模型 runner；只執行單次 probe，正常自行退出，exit code `0`。
- 原有五個 PID 在測試前後一致：`40268, 21560, 50196, 17832, 24492`。此為前後觀察，非對所有未來程序狀態的保證。
- Sandboxie INI 在本次測試前後 SHA-256 相同：`94d69a9b58fced198d257c2e6bb0cc76350a5c046ac74959512fa659e098c3a9`。工作區設定本來可以隨使用者選擇變更；本次 hash 僅用來確認本次 probe 沒有改它，不作永久不變條件。
- 只新增測試腳本、假檔及結果；未刪除任何既有內容。正式 K 沒有更新、重啟或重新整理，官網評論工作未由本測試停止或操作。

## 證據與限制

- 結果：`D:\K-harness\.runtime\isolation-pilot\workspace-secret-open-20260926-183416\result.json`
- 父程序與盒內腳本：同目錄 `probe.mjs`、`child.cjs`；結果保留於 `child-result.json`。
- 有效規則另包含候選的 `agent-home\*` 及 `browser-output\*`。本次不查官方 CLI 必需的 agent-home，也不宣稱該目錄不可讀。
- vault 指的是上述正式隔離 runtime 的受保護 vault，並非任意名稱叫 vault 的目錄。
- 本次只驗證讀取 handle 的拒絕，沒有試讀秘密、測試寫入、搜尋其他憑證、列舉既有 vault 內容或嘗試繞過。
- 沒有修改產品程式或部署；安全疑問在本次指定範圍內已取得直接執行證據。語音辨識修正屬另一項工作，另行記錄。
