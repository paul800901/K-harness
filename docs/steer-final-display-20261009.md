# 工作中插話後，較早的完成回覆被隱藏（2026-10-09）

## 最新範圍與狀態

使用者交代查明保存／显示問題、修正並驗證，隨後明確要求「你修好就先停」。本批只完成候選，不部署、不重啟、不 push、不更新東區；不停止或重送正式聊天室，不修改 CaseAgent、StoreOps、其他專案、帳號、權限或計費。

現用正式程式實讀為 `f5e9e266b677dbb9d4d330729fbc66fa9d674e53`；根目錄 README 較舊的 c5d605d 不是本輪基線。新工作樹從現用完整 SHA 建立，根目錄既有未提交修改保留。沒有新增相依。

## 查明結果

- 目標 K thread：`claude-fe23633c-8a99-40c1-9e51-db83c523fd65`，標題「修規則」。
- 較早回覆 `claude-stream-msg_011CfqQboD43xbnEqUM5SGQY` 完整存在正式 K projection 與 Claude 原生 JSONL；有 completedAt，沒有 partial／streaming。
- 原組 `9ffd69ad-d79d-438d-abe3-1085d861d228` 有兩次 steer，以及兩則完成回覆，完成時間分別為臺灣 10/9 04:34:08、04:34:23。畫面只挑最後一則，不是收訊、寫檔或拆輪遺失。
- `groupConversationMessages.conclusion` 只取組內最後一則，`AssistantMessage` 對非該結論且非最新 partial 的訊息直接 return null。前一則完成回覆只留在最後結論的處理細節裡。
- 業務正文、患者內容與付款資料不寫入本工程文件或交付給 Opus 審查；本輪未重做任何原業務操作。

## 最小修正

產品只改 `frontend/main.jsx`：

1. 保留原本的組內結論與最新 partial 顯示，另显示確有 completedAt 且沒有 partial／streaming 的完成回覆。
2. 較早完成回覆可複製、引用、看完成時間；分支仍只限原 group.conclusion，不擴張原生 Claude 分支或跨模型交接語意。
3. 已顯示的完成回覆不重複塞入處理細節；中間 partial、工具及無完成時間的舊中間說明仍在細節內。討論模式的操作列維持原結論條件。

沒有改 provider controller、原生協定、groupId、projection 格式或既有資料，不做 migration、資料修補、重播或另一套持久化機制。較早原文已保存，套用修正後重新載入即可顯示，無須人工補寫該回覆。

## 驗證與界線

- `test/claude-controller.test.mjs` 新增 deterministic 回歸：工作→兩次插話→同組兩個 result／完整回覆→保存→重開，逐項比對訊息完整且中間內容仍 partial。定向 113/113 通過。
- `test/steer-final-ui-probe.mjs`：built UI 桌面 1440／手機 390，各以 Claude／GPT／Gemini 合成 SSE 驗證前一則完成回覆在下一 partial／完成後仍顯示，reload 仍在、複製／引用／時間正確、FIRST 不能分支而 SECOND 可以、處理細節不重複完成內容；全程沒有任何 POST／重送。
- 同 probe 只讀載入真既有目標 group，確實顯示完整原回覆及兩個使用者指定查找標記，後續回覆也顯示；不修改 projection，不複製原文進 Git。
- 真 Claude Opus 5.5／官方 Pro／CLI 2.1.294／low，session `da1063f1-4407-4e92-b9cb-2299130d8f1a`：只 Read 新建人工 sentinel，工具工作中送插話，完成回覆保存，host 關閉確認；真保存檔在最終 built UI 也確認顯示。
- 該次真原生試驗把補充合併成一個 result／一則完成回覆，**沒有重新產生原事件的兩個原生 result**。多 result 情境由原事件直接保存證據、deterministic controller 与六種 built UI 共同驗證，不把合成結果冒稱新的雙 result 原生重現。
- 討論模式桌面／手機三主題、長文與回到普通聊天室 built UI 通過。
- 完整測試第一版 1062/1062；最後小修完整結果、獨立 Opus 最終意見及固定程式 SHA 在下方收尾。

### 保留的失敗

初版 UI probe 的 reload 仍送舊 fake SSE initial；另既有歷史 fixture 的非 state 路由回空物件，造成載入後重新查找失敗。只修 fake fixture 的 reload snapshot／API shape，未改產品遮蔽失敗。分支測試首次誤用 title 作 accessible name，改為實際「分支」。相關失敗 log 保留。

額外 `process-details-ui-probe.mjs` 在長細節 pinned header 的 `collapse header remains visible` 斷言失敗；以未修改的正式 f5e9e26 frontend 重建再次出現同一失敗。這是本機舊 probe／baseline 已有未通過項，不宣稱全套視覺驗收成功，也不納入本次回覆保存顯示修正；本次完成回覆顯示、細節展收及不重複內容的定向 UI 通過。

## 真正 Opus 複查與裁決

第一輪 session `d05a5a87-2385-48de-b93a-e05c622884ad`，實際 claude-opus-5-5、CLI 2.1.294、官方 Pro、只讀 6 工具、success／code 0。

接受其實質阻擋：初版放寬舊回覆的分支按鈕，但現有交接按整組最後結論取內容，會選錯分支。已恢復 isConclusion 限制並加 FIRST=0／SECOND=1 斷言。另保留討論操作列；主代理查出 Codex 歷史 loader 不足以用 partial=false 當完成邊界，所以新增顯示只認實際 completedAt，沒有改歷史解析或新增資料修復。Opus 不曾冒稱親自執行測試。

證據目錄：`D:\K-harness\.runtime\steer-final-display-20261009`；事件讀回、原生假資料結果、兩輪只讀 review、各次建置／測試／UI 成敗均保留。工作樹：`C:\Users\Paulus\.codex\worktrees\steer-final-display\K-harness`。

## 最後收尾

- 固定程式候選：`9430c4551425397a6c40bd681b2aff3e9080cc57`（branch `codex/steer-final-display-20261009`）。只含 frontend/main.jsx、controller 回歸與新 built UI probe 三檔；文件收尾另作 commit，不混稱部署版本。
- 最後真正 Opus session `251f3ec8-4c1d-4286-a1d1-66634037abee`，實際 claude-opus-5-5／CLI 2.1.294／官方 Pro、success／code 0：確認顯示與細節條件互補、分支與討論限制不變、缺時間 legacy 相容、没有實質阻擋或過度工程化。其非阻擋 readability／helper建議不追加；本地 history probe 僅本次已知 fixture，不宣稱任意多final通用驗收。
- 主代理核對 worker completion 在 Claude 實作為 user 事件，不受 assistant 顯示新增條件影響。Codex／Gemini 真插話與歷史投影未另跑，合成 UI 不冒稱三家 native 實測；本次 root cause 和真保存／回讀證據為 Claude。
- 最後產品小差異對應完整 **1062/1062** 通過，最後六種 built UI＋真既有回覆只讀顯示、native 假資料保存檔顯示、討論三主題／長文皆通過；git diff --check 通過。額外 pinned-header probe 的 baseline 失敗仍保留，不修無關項。
- 依本人本輪後續要求立即停在候選。正式版本仍 `f5e9e266b677dbb9d4d330729fbc66fa9d674e53`，没有部署、重啟、push、tag、東區更新或原業務資料改寫。實際正式畫面恢復待本人之後允許套用，再做正式讀回；目前不是「已在正式 K 修復」。

## 本輪正式更新已完成（2026-10-09 06:50 臺灣時間）

本人後續明確允許與另一邊一起更新，取代本文件前面「修好先停」的當時部署限制。整合後固定程式為 `5762d48913ca185e68dad1709197ccfe47c7dc67`；真正 Opus 5.5 整合及 P2 收尾複查通過，固定低並行1077/1077、各項built UI通過。變更、原意見、失敗與驗證見 [整合收尾](sidebar-ux-fix-20261009.md)。

南區正式已套用此 SHA；程式／啟動器退版在 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791499740190`，不是對話資料快照。替換前後97233個既有檔案byte hash未變，非版本欄設定未變。真正正式 owner／登入後 built UI讀回通過：20聊天室、無不可讀、served資產與正式disk一致，0工作POST、無選取聊天室、既有事件投影未改；正常關閉後K仍停止。沒有恢復原業務、翻譯目標、派工或帳號切換。

本人Electron／手機實機體驗尚待日常使用；新功能行为證据是固定candidate真built UI，正式讀回不冒稱已重跑原業務。東區未更新。GitHub暫未push／tag：本版包含先前2026-10-08明確no push候選，本轮只明確一起更新本機，保守不以一般發布SOP默認撤回该限制；本機更新不因此延後。
