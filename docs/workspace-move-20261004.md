# 聊天室移至另一工作區（2026-10-04）

## 需求與邊界

使用者要求像 Codex App 一樣，把既有聊天室拖到另一個工作區，延續脈絡並切換後續工作位置。授權自行驗收、真正 Opus 5.5 複查，條件通過後部署南區並推私人 GitHub；東區等下次更新。

- 同一供應商、同一原生對話 ID；不複製訊息建立假續接、不重播工作、不換帳號／模型／權限。
- 不搬移專案檔案或憑證。工作區決定後續 cwd、規則與專案工具掛載；既有對話內容刻意保留，不是清空舊資訊或新增作業系統隔離。
- 主工作、子代理、待核准、待送佇列、背景命令或瀏覽器接手未結束時，不中止它們來移動。其他聊天室可繼續工作。
- Codex 尚未送出訊息的空白對話未必已有可恢復的原生歷史；這種情況先完成一回合再移動，不銷毀其唯一原生連線。

## 實作

- 側欄聊天室原生 HTML 拖曳到工作區名稱；選單亦可選「移至工作區…」。沒有新增套件或管理面板。
- `/api/workspace/move` 經原有本機請求保護，只接受正式組裝中已登記的工作資料夾。
- 三核心以原生 ID 在新工作區恢復；重建 workspace-bound MCP，移出 Google 綁定工作區時移除 Google 工具。Codex 明確覆蓋為停用，避免沿用先前設定。
- 主紀錄只增加可選的 `previousWorkspaces`、`previousArtifacts`，保留舊附件／成果的原位置。仍檢查附件所屬聊天室、成果精確清單與路徑邊界；不複製檔案，也不建立資料遷移系統。
- 已移動對話的三家 AI 入口附上現在的工作位置，避免模型把歷史中的舊路徑誤當現在位置。

涉及檔案：`frontend/main.jsx`、`project-sidebar.jsx`、`sidebar.css`；`src/session-workspace.mjs`、`main-sessions.mjs`、`conversation-controller.mjs`、`unified-controller.mjs`、`desktop-server.mjs`、`isolated-desktop.mjs`、三家 controller、`claude-host.mjs`、`background-terminals.mjs`；對應回歸測試與文件。原有 `browser-extension/extension-protocol.cjs` 工作樹換行差異不納入。

## 實際驗收與失敗紀錄

證據根目錄：開發工作樹 `.runtime/workspace-move-20261004/`，假資料與登入／原生紀錄不進 Git。

1. 初始原生探針：Gemini、Claude 能同 ID 在 A/B 接續，記得隨機代碼。Gemini 沒有新工作位置指引時，先讀錯 A 路徑才改讀 B；因此補的是實際核心指引，不只改側欄歸類。
2. 正式候選 API 實測：`live-1791086635666/`。Gemini 3.8 Flash、Claude Opus 5.5、GPT-6.1 Sol 均保留原對話、模型與權限，記得只在前文出現的代碼，讀出 B 的 `WORKSPACE_B`，再移回 A。Gemini 加指引後第一次就讀 B；舊草稿附件原檔可開啟。
3. Codex 第一次測試禁止 shell，卻要求不存在的獨立 read-file 工具；模型正確拒絕而沒有捏造檔案。補做明確限定的唯讀 `Get-Content destination.txt`，同一對話完成，沒有重播副作用；見 `codex-readback.json`。
4. 真介面：使用既有 Chromium、獨立假資料、隱藏測試視窗。三家實際聊天室都由側欄拖曳 A→B，再經選單 B→A，原生 ID／脈絡保留，無前端例外；`ui-result.json` 與 `sidebar-move.png`。非示意 UI，也不操作日常 Chrome。
5. 第一輪完整測試 683 項中 682 通過、1 失敗：新增拖曳樣式誤用未宣告色彩變數；改用既有語意色後該項通過。最終來源完整測試 **691/691** 通過，0 失敗、0 跳過。
6. Opus 要求的加強接續測試：A 記住代碼一 → B 再記代碼二 → 回 A 同時回想，三家全部成功；見 `roundtrip-outside-repo-result.json`。不只檢查最早的 A 訊息。
7. Codex 新規則首次驗收未讀到 B marker。查到測試資料位於 K 的 42,052-byte AGENTS.md 下層，原生 `project_doc_max_bytes=32768`、`instructionSources` 只有 K 根檔；不是 resume 忽略新 cwd。改用 Temp 下新建獨立假資料 A/B，再以同一原生 ID 移動，無工具讀檔即正確回答 B 的隨機規則 marker。**沒有**提高原生上限、另造規則載入器或宣稱超長規則全被載入；此原生限制仍在。
8. Claude 背景命令條件已實測：假資料目錄只核准精確 `sleep 15`，原生真的回傳 `task_started/local_bash`、`task_notification/completed`。沿用既有工作清單呈現與防止移動，不另建背景管理系統；原生 requesting 事件讓完成後的自動回覆仍視為工作中。K 真組裝測試主回覆已結束而 sleep 尚未結束時拒絕移動，完成後才成功，見 `claude-background-k-result.json`。沒有讀取真實業務資料或放寬正式權限。

9. Codex 真實成果：原生 apply_patch 在 A 建立 artifact.txt，B 有同名但不同內容檔案。原生 fileChange.path 實際為絕對路徑，移動後仍只列出／預覽原本 A 的成果，未誤讀 B；見 codex-artifact-live.json。沒有為假設中的相對原生事件新增另一套成果追蹤。
10. Codex 原生背景終端清單的「執行中→自然結束」條件未取得有效樣本：三次各新建假工作要求有限時 sleep，原生只回 code-mode cell ID，未取得 command session ID，清單始終空。保留失敗紀錄，不宣稱真實生命週期已驗收；原有清單非空即拒絕移動的保守機制及不關閉／不clean回歸測試保留，沒有觀察到已結束項目殘留。
11. 最後 UI 再驗收：三家的真實聊天室再跑拖曳／選單往返均通過。補測使用真 external browser gateway、尚未啟動瀏覽器狀態可以移動，且沒有啟動 Chrome；中斷、人工接手、未知不可用狀態仍拒絕。

## 真正 Opus 5.5 複查

原生 Claude Code 2.1.289、官方 Claude.ai 訂閱，唯讀工具及 plan 模式；原始 stream-json、模型名、最終輸出保留在 `opus/`、`opus-final/`、`opus-closeout/`、`opus-final-fix/`，不以自查冒稱 Opus。

初查實際模型 `claude-opus-5-5`，session `b1cb16ad-bb68-4366-bfae-be37c135ac25`：
- 要求補 B 新訊息回 A 的接續及 Codex 規則驗收：已補，結果如上。
- settled failed 的 Gemini 不能移動：讓移動接受已結束失敗；一般閒置回收仍不接受 failed，不重送失敗回合。
- 未載入房間開啟失敗留下 controller：沿用既有清理；關閉失敗仍保留供正式停止處理，避免孤兒程序。
- Claude 從移動後聊天室分支遺失舊成果根路徑：分支繼承既有路徑參照，保存／重開回歸通過。
- Claude 背景 Bash 可能被關閉：先取得真實原生事件證據，再接入既有工作清單，真 K 驗證通過。
- 未發現需要新增框架的過度工程化；保留原生核准、工作中保護、精確附件所屬與成果白名單。

二查 session `17b69f52-b692-4d0d-b062-9e8d3e4024b5`（實際模型 claude-opus-5-5）沒有提出部署阻擋項，但指出：
- Gemini 移動失敗後仍可送訊息並默默存成新位置：採納單行修正，relocation 失敗改 error、拒絕 send，重開依已保存的舊位置；補 prepare 失敗回歸。
- 啟用瀏覽器但從未使用的聊天室可能被擋：真 gateway 證實 available=false，只有 external=true、browserMode=null、AI、非 busy、無 recovery 的已知未啟動情況允許；不是一律忽略 unavailable。
- Codex 背景清單生命週期：補探針但未取得有效樣本，界線如上。Opus 另指出既有隱藏閒置 Codex 房間回收可能關閉背景終端，這是既有行為而非本次移動引入；記錄另案，不藉此擴成背景工作管理重構。

三查 session `655fa724-2c35-4832-8976-d9a8a8681c3e`（實際模型 claude-opus-5-5）：
- 確認尚未啟動瀏覽器的精確例外正確，不算過度工程化。
- 接受 Codex 原生背景清單的未驗證界線，不因此擋本次發布；保守拒絕與限制必須留記錄。
- 再指出 Gemini error 狀態雖不能 send，但改名／釘選／選模型仍會保存 B。先補 regression 重現紅燈，再於 relocation 失敗時還原原工作位置、舊工作區、舊成果參照及成果清單；不另建交易／migration 系統。確認 metadata、選模型、上傳及重開仍在 A，測試轉綠。

四查 session `5603e6fa-6918-4754-aa8c-ed8b6dc5956f`（實際模型 claude-opus-5-5）確認最後狀態還原小修正確、可關閉問題並部署。可選的額外同快照檔案／非空成果斷言沒有觀察到新的故障，不再擴大驗證架構；主代理已核對 diff 與完整 **691/691** 零跳過結果。

## 複查／部署狀態

- 實作、完整 691 項測試及真正 Opus 5.5 四次複查／收尾已完成；可準備固定 Git 候選。
- 本程式提交建立後，以該固定 SHA 從 Git archive 建置並再跑完整測試；正式部署、遠端版本與退版位置將於收尾文件提交補記。目前尚未部署／push。
- 東區未更新。既有四個帳號、計費、正式對話與 Google 業務資料不因本功能測試變更；本輪沒有執行商家發文／回評或重新授權。
