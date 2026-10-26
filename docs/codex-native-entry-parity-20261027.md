# GPT 原生入口、規則載入與分工修正

日期：2026-10-27。本人要求 GPT 在 K 的操作順暢程度接近原生，按完成整件工作的品質與總消耗判斷，不以截短必要資料來省額度。平常工作與多數開發由 Opus／Flash 處理，GPT 額度優先留給病例討論及必要技術判斷、補修與驗收；當輪手動選模優先。

## 查明的原因

- K 使用原生 Codex app-server，保留原生 start／resume、歷史和工具迴圈，未用自製迴圈替換。查核版本為 Codex 0.164.0；不能把本次低效率概括成 K 換掉了核心。
- CaseAgent 的 AGENTS.md 為 36,862 bytes，超過原生 `project_doc_max_bytes=32768` 預設。原生渲染確認尾段遭截斷；前面大部分正式寫入閘門仍在，不能用此解釋所有返工。
- K 專用 home 少了兩個已存在的 CaseAgent workflow／guardrails skill 入口；原本仍可沿 AGENTS 路徑手動讀，並非完全沒有 SOP。
- Codex 原生 memories 預設關閉；Claude 的專案記憶則已有明文偏好。這是入口差異，不能保證只開記憶就能改善行為。
- 等待機制原本已有事件通知；問題是提示一面要求 active goal 等事件，一面無條件要求結束回合。修提示即可，不新增輪詢、等待器或記憶系統。
- 主代理反覆廣搜、輸出被截後重讀、未先備齊定稿與工單，也造成不必要消耗；不是只改載入容量就會自然消失。

## 並行與壓縮

同版本完全不經 K 的 `codex debug prompt-input` 預設也顯示四個含主代理的 slots，也就是三個子代理。程序內設定 `agents.max_concurrent_threads_per_session=64` 後顯示 65 slots，沒有啟動工人或推論。這是可調的原生預設，不是模型分工能力測驗，也不是 K 硬設三個。容量不代表必須派滿，總派工量與巢狀深度是另外的概念；本次不改深度。

臨時 home 的低層設定疊上 K 同形 `agents={enabled=true}` 高層 override，預覽仍顯示 65 slots。同層 CLI 旗標整段替換 agents 的結果不能當成 home 跨層被覆蓋的證據。K 實際以 thread/start 的 config.agents 傳入設定；空 thread RPC 沒有暴露合併後的 slots，需新 K 房間讀回才能確認這條路徑生效。原生預覽不等於 K 新房實測，也不是六十四個工人的負載測試。

返工較早時段的原生日誌沒有實際壓縮事件，後續長串查核才在臺灣時間 01:04:22 首次自然壓縮。實際單輪可用視窗為 475,000 tokens，auto-compaction 門檻為 450,000；不能把累計輸入當成單輪長度或訂閱扣款。這次不猜改模型 context window，也不把後來的自然壓縮倒算成前面低效率的原因。

## 本機設定（不進版控）

| 範圍 | 修改 | 讀回與邊界 |
| --- | --- | --- |
| CaseAgent `.codex/config.toml` | `project_doc_max_bytes = 65536` | 新原生 host 的 config/read 已確認；不改模型或推理程度。專案檔會隨既有 Drive 通道同步。 |
| K 專用 `.codex/skills` | workflow、guardrails 兩個 junction 指向既有正本 | 原生 skills/list 三個 CaseAgent 入口皆 enabled、errors 空；不是複製。依賴 `C:\Users\Paulus\.codex\skills\caseagent-workflows` 與 `caseagent-guardrails`，搬移前需檢查。 |
| K 專用 `.codex/config.toml` | `[agents] max_concurrent_threads_per_session = 64` | 現用 home 的原生預覽 65 slots，疊 K 同形 agents override 仍 65；保留其他鍵；thread/start 合併後 slots 尚未讀回，需新 K 房間確認，原有核心不保證熱載入。 |
| 同上 | `[features] memories = true` | 官方 stable 原生功能，保留為試用；沒有匯入 Claude 記憶、切帳號或改 API 計費。 |

本機設定的 before 副本、SHA 與原生查核報告留在 `D:\scratch\k-gpt-native-parity-20261027`，不把 native session、登入或病例資料送入儲存庫。原 home 設定 SHA 為 `17e7359ea088ac99e660ba1f798c186efd3a537a47183cb7fd3035a2084b847f`；只啟用 memories 後為 `f179e5b3e0edfd47a61ad46c4a5356d9a340e2a195f9c4bb1ba4c2124cc482aa`；再加並行設定後為 `5ddffff10023af66b876849e9f3530934bc25e258b063e000a492480f8ae69fc`。

memories 目前沒有已產生的整合內容，不能宣稱跨房記憶已修好。它可能以現有 Codex 訂閱做背景萃取，範圍包含共用 home 的 GPT 工人，實際消耗未知；歷史 thread 數不是已處理量。摘要位於本機 dedicated home，東區不會自動取得。關閉方式為設回 `memories = false`。確定性的分工偏好直接保留在共用入口，不依賴背景萃取何時完成。

skills junction、K home 設定都是南區本機差異；東區需另外核對，不能因推送程式就宣稱同步完成。既有 runtime 更新保留 native home 設定，不在啟動時覆寫使用者選擇。

## 程式與規則

`src/worker-policy.mjs` 將 scheduling.waiting 分成兩種：active goal 且無其他工作時用本入口 K 等待工具、略去 timeoutMs；沒有 active goal 時結束回合等既有完成通知。GPT 用 `gemini_wait`，Claude／Gemini 用 `luna_wait`，共享文字不寫死工具名。等待不構成 blocked，也不重播未知結果。

同步調整共用分工與 K AGENTS：GPT 主代理先完成判斷及含正文、來源、範圍、完成條件的工單，把大量執行交 Flash，再驗收成果與必要收據；保留按需親自補修能力，不新增硬性路由、模型切換或權限。已讀未變的規則不重讀，不用狀態輪詢消耗主代理。CaseAgent 仍沿既有正式 writer／finalizer 與讀回，不另建 SOP 或把病例資訊放進 K。

## 審核與驗證

Astra xhigh 以原生設定、渲染及日誌獨立查核。真正 Opus 5.5 第一輪指出兩項必修：等待工具跨入口錯名、分工新舊句互相衝突，皆已處理；保留 GPT 必要技術判斷與補修，沒有降成純監工。建議另加 CaseAgent 分工規則的部分不重複新增，現有 K 共用入口已承載通用分工偏好；本次未改 CaseAgent 專案的存入規則。

- 針對測試：`node --test test/worker-policy.test.mjs`，10/10；新增回歸覆蓋 GPT、Claude、Gemini 等待工具及 active goal 分流。
- 第一次完整測試 1,964/1,966：新 worktree 缺少 dist-ui，兩項 UI 檔案服務測試失敗；建置 `npm run build:ui` 後完整 1,966/1,966。
- 採納最終審核建議字句後完整測試 1,966/1,966（full-test-reviewed.log），86.8 秒；Opus 5.5 最終複核程式可合併；必修文件補記已依建議完成。
- K AGENTS 以 CRLF 計算 23,991 bytes，符合小於 24,000 閘門；未改畫面，不新增 UI 驗證矩陣。

設定讀回不等於模型行為改善已實測；本次沒有以真實病例重跑存入，也沒有啟動大量工人。既有聊天室不保證重載設定，需在新原生核心／房間確認。

## 部署與回復

程式 commit 為 `bb0b28b9998da5dbb5d90ea9b90fdf1f430d44ef`；文件分開提交，合併前核對最新 main。runtime 尚未套用；完成審核後交既有側欄更新按鈕，不從 K 內停止或覆蓋正在執行的自己。使用者按更新後才記錄部署讀回；東區另計。

程式可依既有版本回復；本機設定按保存副本／精確鍵回復，移除本次兩個 junction 不動其正本。不得用舊副本整檔蓋掉之後其他房間新增的設定。
