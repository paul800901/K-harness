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

臨時 home 的低層設定疊上 K 同形 `agents={enabled=true}` 高層 override，預覽仍顯示 65 slots。同層 CLI 旗標整段替換 agents 的結果不能當成 home 跨層被覆蓋的證據。K 實際以 thread/start 的 config.agents 傳入設定；部署前空 thread RPC 沒有暴露合併後的 slots。2026-10-27 重啟後，本主對話原生 metadata 已回報 65 個含主代理名額，補完 K 端生效驗收；沒有進行六十四個工人的負載測試。

返工較早時段的原生日誌沒有實際壓縮事件，後續長串查核才在臺灣時間 01:04:22 首次自然壓縮。實際單輪可用視窗為 475,000 tokens，auto-compaction 門檻為 450,000；不能把累計輸入當成單輪長度或訂閱扣款。這次不猜改模型 context window，也不把後來的自然壓縮倒算成前面低效率的原因。

## 本機設定（不進版控）

| 範圍 | 修改 | 讀回與邊界 |
| --- | --- | --- |
| CaseAgent `.codex/config.toml` | `project_doc_max_bytes = 65536` | 新原生 host 的 config/read 已確認；不改模型或推理程度。專案檔會隨既有 Drive 通道同步。 |
| K 專用 `.codex/skills` | workflow、guardrails 兩個 junction 指向既有正本 | 原生 skills/list 三個 CaseAgent 入口皆 enabled、errors 空；不是複製。依賴 `C:\Users\Paulus\.codex\skills\caseagent-workflows` 與 `caseagent-guardrails`，搬移前需檢查。 |
| K 專用 `.codex/config.toml` | `[agents] max_concurrent_threads_per_session = 64` | 原生預覽 65；2026-10-27 重啟後 K 主對話實際回報 65（主代理 1＋子代理 64），其餘鍵保留。 |
| 同上 | `[features] memories = true` | 官方 stable 原生功能，保留為試用；沒有匯入 Claude 記憶、切帳號或改 API 計費。 |

本機設定的 before 副本、SHA 與原生查核報告留在 `D:\scratch\k-gpt-native-parity-20261027`，不把 native session、登入或病例資料送入儲存庫。原 home 設定 SHA 為 `17e7359ea088ac99e660ba1f798c186efd3a537a47183cb7fd3035a2084b847f`；只啟用 memories 後為 `f179e5b3e0edfd47a61ad46c4a5356d9a340e2a195f9c4bb1ba4c2124cc482aa`；再加並行設定後為 `5ddffff10023af66b876849e9f3530934bc25e258b063e000a492480f8ae69fc`。

啟用時尚無整合內容；本輪只讀檢查已見四筆初步萃取結果，MEMORY.md 與 memory_summary.md 均有內容，確認開始產生記憶，跨房取用效果仍待實際觀察。它可能以現有 Codex 訂閱做背景萃取，範圍包含共用 home 的 GPT 工人，實際消耗未知；歷史 thread 數不是已處理量。摘要位於本機 dedicated home，東區不會自動取得。關閉方式為設回 `memories = false`。確定性的分工偏好直接保留在共用入口，不依賴背景萃取何時完成。

skills junction、K home 設定都是南區本機差異；東區需另外核對，不能因推送程式就宣稱同步完成。既有 runtime 更新保留 native home 設定，不在啟動時覆寫使用者選擇。

## 程式與規則

`src/worker-policy.mjs` 將 scheduling.waiting 分成兩種：active goal 且無其他工作時用本入口 K 等待工具、略去 timeoutMs；沒有 active goal 時結束回合等既有完成通知。GPT 用 `gemini_wait`，Claude／Gemini 用 `luna_wait`，共享文字不寫死工具名。等待不構成 blocked，也不重播未知結果。

同步調整共用分工與 K AGENTS：GPT 主代理先完成判斷及含正文、來源、範圍、完成條件的工單，把大量執行交 Flash，再驗收成果與必要收據；保留按需親自補修能力，不新增硬性路由、模型切換或權限。已讀未變的規則不重讀，不用狀態輪詢消耗主代理。CaseAgent 仍沿既有正式 writer／finalizer 與讀回，不另建 SOP 或把病例資訊放進 K。

## 審核與驗證

Astra xhigh 以原生設定、渲染及日誌獨立查核。真正 Opus 5.5 第一輪指出兩項必修：等待工具跨入口錯名、分工新舊句互相衝突，皆已處理；保留 GPT 必要技術判斷與補修，沒有降成純監工。建議另加 CaseAgent 分工規則的部分不重複新增，現有 K 共用入口已承載通用分工偏好；本次未改 CaseAgent 專案的存入規則。

- 針對測試：`node --test test/worker-policy.test.mjs`，10/10；新增回歸覆蓋 GPT、Claude、Gemini 等待工具及 active goal 分流。
- 第一次完整測試 1,964/1,966：新 worktree 缺少 dist-ui，兩項 UI 檔案服務測試失敗；建置 `npm run build:ui` 後完整 1,966/1,966。
- 採納最終審核建議字句後完整測試 1,966/1,966（full-test-reviewed.log），86.8 秒；Opus 5.5 最終複核程式可合併；必修文件補記已依建議完成。
- 統合後在 main 重新建置並驗證畫面：`npm run build:ui`、`npm run test:ui` 52/52（combined-ui-test.log）；本輪沒有再改程式。
- 初次 GPT 原生修正時 K AGENTS 以 CRLF 計算 23,991 bytes，符合小於 24,000 閘門；未改畫面，不新增 UI 驗證矩陣。

本輪已確認新核心實際載入 65 個名額；病例討論、分工與跨房記憶的行為改善仍待日常使用觀察。本次沒有重跑任何真實病例存入，也沒有啟動大量工人。

## 各原生核心與 K 通用記憶的界線

2026-10-27 本人明確裁決：K 是多核心；Codex、Claude Code、Antigravity 及未來新增核心，各自保存原生記憶。K 通用記憶／規則與原生記憶分開；單一核心的經驗不自動混入、搬到其他核心或升格通用，升格須本人明示。Gemini 多帳號共用自身 learned-rules 仍屬 Gemini 範圍，不等於跨核心通用記憶。既有授權的專案正式資料仍按專案來源讀取，與自動搬用核心記憶有別。

本次只將界線併入 K AGENTS，精簡導言與重複用語以維持 agy 24,000 bytes 門檻；不改 runtime、各核心設定、原生記憶內容或帳號，不建立共用記憶服務，不需要再次更新 K。驗證：AGENTS 以 CRLF 計 23,994 bytes、git diff --check 通過、完整 npm test 1966/1966；真正 Opus 5.5 審核可提交，無必要修正。選擇性建議的專案資料共用說明已在本節保留，不再增加入口長度。

## 部署與回復

程式 commit 為 `bb0b28b9998da5dbb5d90ea9b90fdf1f430d44ef`。南區已由本人按鈕於 2026-10-27 01:47:28 部署統合版本 `04d0b96222f8ee2ae213ddf2568f2edf3ed4535b`（前版 `04193bd`）；self-update-result 為 ok，更新器完整測試 1966/1966，runtime 版本相符。東區未更新。

2026-10-27 本人指定由本輪主代理統合排程頁並接手部署讀回及 GitHub 收尾。已核對 `f2f172c` 與 `bb0b28b` 均包含於本次版本；五個適用後端原始檔與部署 commit 一致，目前頁面引用的 JS、CSS、圖示與驗收建置逐檔 SHA 相符，授權 gateway 可讀回四筆排程。更新前畫面驗證為 52/52；部署後以實際檔案及清單讀回確認。
重啟後本主對話的原生 multi_agent_role 已實際回報 65 個含主代理名額（64 子代理），完成先前保留的 K 原生設定讀回；未做 64 工人負載測試。project_doc_max_bytes=65536、三個 CaseAgent skills 入口與 memories=true 均仍在；memories 內容效果仍屬試用。工程收據與精確遠端 SHA 留在 `D:\scratch\k-gpt-native-parity-20261027\combined-update-plan.json`，原始碼與本次文件統一推送 main 並讀回；此純文件收尾不再觸發更新。

程式可依既有版本回復；本機設定按保存副本／精確鍵回復，移除本次兩個 junction 不動其正本。不得用舊副本整檔蓋掉之後其他房間新增的設定。
