# 桌面權限選單與真實驗收

日期：2026-09-15。範圍僅 D:\K-harness；沿用 Codex 訂閱與原生 App Server。未修改 DSH、全域設定、登入、金鑰、計費或 Pi 工人權限。

## 已交付

- 輸入區與建立對話視窗共用選單：要求核准、代我核准、完整存取權；唯讀位於進階選項。
- 參考 Codex 的圖示、說明、目前選項勾選與橘色完整存取呈現，沿用 K 主題與縮放。
- 點外部或 Escape 關閉；鍵盤可開啟、選取。原生彈出層不受輸入框或建立視窗裁切。
- 首次改用代我核准或完整存取需確認影響。取消不改原選項；新建或下次送出才生效，不更動其他對話。
- 後端在未傳入明確確認時拒絕升權；已保存模式可恢復。選項不是全域設定。
- 原生自動審查的狀態、理由與來源顯示於右側活動；只有目前 thread、turn 的通知會寫入，沒有本地代按核准或重送。

## 原生模式對應

| 介面 | 沙箱 | 核准策略 | 審查者 |
| --- | --- | --- | --- |
| 要求核准 | workspace-write，網路不預先放行 | on-request | user |
| 代我核准 | workspace-write，網路不預先放行 | on-request | auto_review |
| 完整存取權 | danger-full-access | never | user（一般操作不發核准要求） |
| 唯讀 | read-only | on-request | user |

thread/start、thread/resume、turn/start 使用一致設定。外部工人仍受其逐任務工具與檔案授權限制；不能用主代理完整存取代替工人授權。

依 OpenAI Docs 技能核對官方[權限模式](https://learn.chatgpt.com/docs/permission-modes)與[自動審查](https://learn.chatgpt.com/docs/sandboxing/auto-review)，並對照本機協定。自動審查仍可能誤判，並非安全保證；其他工具自己的確認也不因本選單而一律消失。

## 真實驗收

使用者另行明確授權兩個 Luna 低推理測試。工作目錄為 `D:\K-harness\.runtime\專案介面驗收`；唯一輸出為工作目錄以外、仍在 K 下的兩份人工檔案，沒有讀取其他工作資料、呼叫其他子代理或使用網路工具。

### A：代我核准

- thread：`01a0a42b-aba0-7250-b333-cb5186a6da66`。
- 寫檔 turn：`01a0a42c-2319-79f3-b266-febe88a96440`。
- apply_patch 建立 `D:\K-harness\.runtime\permission-live-20260915\auto-review.txt`。
- 收到原生 review `364c9317-dd84-4e4b-bbd5-7797df411728`，`decisionSource=agent`、`status=approved`，不是 K 或驗收者按下同意。
- 官方回傳理由為使用者已授權指定單一檔案、可逆且沒有網路或敏感資料外洩；右側活動實際顯示「自動核准審查／已核准」與原始理由。
- Luna 完成讀回後，主驗收者再次精確比對 `K-PERM-AUTO-915\n`，16 bytes。
- 原生 turn_context 證實 `on-request / auto_review / workspace-write`。
- 後續無工具回合 `01a0a42d-300b-7683-a893-51b89c00201c` 已切回 `on-request / user / workspace-write`。

### B：完整存取

- thread：`01a0a42d-faaf-7150-be49-84a152ae881a`。
- 寫檔 turn：`01a0a42e-493e-7543-b7da-c77f0cc2a8b6`。
- apply_patch 建立 `D:\K-harness\.runtime\permission-live-20260915\full-access.txt`，直接執行，沒有逐次核准或自動審查事件。
- Luna 完成讀回後，主驗收者再次精確比對 `K-PERM-FULL-915\n`，16 bytes。
- 原生 turn_context 證實 `never / user / danger-full-access`。
- 後續無工具回合 `01a0a42e-dc04-73c2-b028-ae10dc35438a` 已切回 `on-request / user / workspace-write`。

兩個新對話的最新保存值均為 workspace-write；原有 Terra 對話 `01a0a40c-6257-7932-8961-23bc404fef3e` 仍為 read-only。兩份測試檔保留，沒有刪除資料。

原生紀錄：

- `C:\Users\Paulus\.codex\sessions\2026\09\15\rollout-2026-09-15T16-25-20-01a0a42b-aba0-7250-b333-cb5186a6da66.jsonl`
- `C:\Users\Paulus\.codex\sessions\2026\09\15\rollout-2026-09-15T16-27-51-01a0a42d-faaf-7150-be49-84a152ae881a.jsonl`

## 其他驗證與限制

- `npm run build:ui` 成功；原有 bundle 大小警告仍存在。
- 主驗收者獨立執行完整測試：135／135 通過。包含四模式新建／恢復／後續回合對應、未確認時拒絕、失敗不降級、不重試、審查事件歸屬、舊權限保存及既有功能回歸。
- 真實瀏覽器：既有唯讀不變、三主選項、進階唯讀、點外部／Escape 關閉、鍵盤開啟、取消升權、建立視窗內選單、真實自動審查顯示與兩模式切回，均已操作驗證。
- 這次證明兩個指定本機檔案案例；沒有測任意網路服務、其他外掛、所有拒絕情境或所有長程工作。拒絕／錯誤分支屬測試程式驗證，不冒充真實服務拒絕測試。

## 修改與還原

前端：`frontend/permission-picker.jsx`、`frontend/permission-picker.css`（新增），`frontend/main.jsx`、`frontend/model-picker.jsx`。

後端：`src/desktop-permissions.mjs`、`src/desktop-controller.mjs`。

測試：`test/desktop-permissions.test.mjs`、`test/desktop-permission-modes.test.mjs`（新增）。另更新 AGENTS.md、README.md、本文件並重建 dist-ui。

修改前備份：

- `D:\K-harness\.runtime\permission-ui-before-a38cb12c1a8742ad99396090449a1e79`
- `D:\K-harness\.runtime\permission-backend-before-e9e2fe8e-f50d-4ce1-8769-3fcf1bec7236`

本機後端已透過既有啟動器更新，瀏覽器已載入新版。若要還原，需依本次修改清單及備份逐檔比對；不可整個覆蓋後續使用者變更。
