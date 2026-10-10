# 分支歷史附件完整修復候選／Opus 主導診斷（2026-10-10）

## 使用者要求與本輪狀態

使用者指出正式 Pick Me Up · 分支顯示「部分附件無法重新載入」，並明確要求真正 Opus 5.5 負責找問題與修復範圍判斷，Astra 負責執行；遇到問題先問 Opus，不把直接相關缺口列 non-blocking 後宣稱完整。

**目前僅完成候選實作與下列驗證，尚未完成 Opus 最後差異／完整證據複查，未部署。** Opus 第三輪詢問實測證據疑點時，官方回覆 `You've hit your session limit · resets 1am (Asia/Taipei)`，code 1 / is_error true；不是有效裁決或複查通過。沒有換模型、API 計費或繞過額度。下一次需先由真正 Opus 回覆待決問題，再完成最終複查與正式更新，不能因回歸數量或部分 native HTTP 成功而上線。

證據根目錄：`D:\K-harness\.runtime\fork-complete-fix-20261010`。

## 為何前批不完整

上一批 be1d976 修了 native fork 配置／先保存可見 identity／工人繼承界線，但沒有把「歷史附件卡片→預覽→下載→重開→再分支→討論上下文」當成完整使用鏈驗收。源碼中已知附件重開識別被留作非阻擋，本輪要求明確取代該範圍判断。不是原檔被刪除或上游壓縮，而是 K 的本房嚴格歸屬檢查沒有辨識真正繼承的歷史。

## 真正 Opus 5.5 診斷與裁決

同官方 Claude.ai Pro / firstParty、Claude Code 2.1.294，session `b8ba798d-d36a-449c-b948-281f550d6e49`：

- 第一輪 `opus-diagnosis`，code 0 / success，實際模型 claude-opus-5-5，22 次 Read/Glob/Grep。指出 Codex 重開、孫分支、預覽/下載、工作區變動、討論上下文、刪除父 K 紀錄後不應失去附件等相關缺口。
- 第二輪 `opus-scope`，code 0 / success，實際模型 claude-opus-5-5，14 次 Read/Glob/Grep。追加閱讀 Claude 原生分支，確認同根因必須同批修；改判不建立額外對照表，以已驗證訊息附件記錄作唯一依據，再讀磁碟核對 ID、owner、path。由 Opus 決定最小方案，不由 Astra 自行排除直接相關項目。
- 第三輪 `opus-evidence-questions`，7 次讀取後額度失敗，沒有取得裁決；保留原始輸出、官方限制與兩項問題，不把 partial read 當成最後審查。

## 已實作的最小修正

- `src/session-workspace.mjs`：`inheritedAttachment` 只接 Codex 保存分支界線內的原生使用者附件標記，從原上傳路徑找記錄並驗證 ID／磁碟 owner／完整原檔路徑；不讀父房 K 紀錄、不複製檔案或更改真附件 metadata。`messageAttachment` 只接本房訊息上已驗證的歷史附件卡片，重新核對原 owner 與檔案路徑；其他仍走本房嚴格檢查。無永久新 schema／額外 mapping 狀態。
- `src/desktop-controller.mjs`：首次／重開／孫分支使用同一歷史解析；预覽／下載接訊息附件記錄；取消開房一併恢復原 items、inheritedWorkerItems，與 restored messages 同步。
- `src/claude-controller.mjs`：已有結構化投影繼承的附件接同一預覽／下載驗證；不解析使用者文字、不新增分支界線。
- `src/conversation-controller.mjs`：討論上下文引用已驗證歷史附件，明確指定的輸入框附件仍嚴格查本房。圖片／影音不偽裝為已帶入討論內容。
- 三家 upload/send/steer 均保留原歸屬與原生權限；用父附件 ID 手動重新送出或 steer 仍拒絕。Gemini 沒有原生 fork，跨供應商交接本來不複製訊息卡片，沒有新增搬附件功能。
- 讀回 `codexInput` 呼叫鏈：K 系統工人回報/接續以 send 的一般文字輸入，沒有另附其他房 ID 或自行把原样附件標記作新的繼承卡片；真正繼承識別限保存的 copied-turn 界線。

## 已完成的驗證

- 新 `test/fork-attachments.test.mjs` 8 項：fresh controller 重開、二次分支、界線後/外房拒絕、搬工作區、父 K 紀錄不存在仍可讀、錯誤原檔路徑、界線後偽造標記、取消恢復、歷史投影 connecting 時預覽、舊房缺界線仍照實錯誤。另更新 `manual-fork.test.mjs` 取消後工人/工具歸屬、`claude-controller.test.mjs` 繼承預覽下載/重開/搬移/孫房/owner拒絕/不能送出或steer、`discussion-conversations.test.mjs` GPT/Claude上下文文字附件與明確外房拒絕。
- 固定舊 be1d976 的獨立來源配同批新測試，137 項中 **10 fail / 127 pass**，`red-final-chain.log`。其中直接觀察原歸屬錯誤、孫分支卡片遺失、討論開不起來及取消工人還原缺口，沒有修改舊版來源以迎合測試。
- 候選最新完整回歸 **1173/1173，零失敗**，`full-tests-final.log`；Vite built UI 成功。初稿 MCP fixture 錯誤不列為產品 red 證據；實際採用 fixed-source red-final-chain。原路径 guard、UI probe 與實測檢查失敗紀錄保留，不當成產品修復通過。
- 真 Codex 0.161.0、GPT-6.1 Sol medium、read-only，新假工作區：5 個新回合、2 次原生分支，child 初建/新附件/重開、grandchild 初建/重開共 5 個 HTTP 階段。文字及 PNG 預覽／下載 200、雜湊一致；界線後附件及外房 ID 拒絕；原父 turns、不變假檔、全部附件檔案及附件記錄 hash 前後不變。`native-codex/result.json`。
- 已完成 fake grandchild 的 desktop 1440×960 / mobile 390×844 built UI 讀回：三個真附件下載連結、image 預覽 endpoint、下載 bytes hash、無頁面錯誤/無 API POST/無新 native turn。`native-ui-readback.json`。既有人類 UI 是附件下載 chip，不是 inline thumbnail；第一版腳本錯猜縮圖而失敗，修正只讀腳本並保留 `ui-error.json`，沒有為迎合 probe 加新 UI。
- 真資料只讀 `real-branch-readonly.json`：候選只投影指定 native thread/read，截於 onHistory，不 resume/start/stop 真小說；root 改用獨立投影目錄，避免 main-session/timing 寫回正式。真正兩房原生歷史各 151 turns、存定界線 150，**只包含 a099... 這一個附件引用**，候選錯誤 null、預覽及下載 hash 同原檔，原 K 分支紀錄及兩張已保存圖片/記錄 hash 不變。第二張 d75b... 存在上傳區，但兩房 native user history 沒有其附件標記，不擅自把它帶入分支，也不宣稱它被刪除。盤點那一筆 Claude 原生分支投影沒有附件，記錄 hash 不變。
- 舊分支只讀盤點 `legacy-branch-inventory.json`：沒有 Codex 有 parent 卻缺 forkThroughTurnId 的 K 紀錄；兩筆是 Claude，一筆跨供應商／一筆 Claude 原生，後者本來使用已存結構化訊息而不需 Codex 界線。没有補寫真 metadata。

## 未完成／已交 Opus 的實測問題

1. 真 Claude 原生測試：官方 Opus 5.5、claude-plan、新假工作區，3 個已完成回合、2 次 native fork、五階段預覽下載/外房拒絕已通過。最終 parent projection 整份 rawhash 檢查失敗；before snapshot 在 RAM 且未先等 persistChain 排乾／沒有保存 before 檔，不能編造已逐欄比對。疑似腳本在 result 後搶讀 projection、fork flushPersist 才完成之前的寫入，但需 Opus 依程式碼裁決，不自判忽略。檔案/附件記錄最後 hash 檢查尚未走到。已存 `native-claude-evidence-status.json`；不宣稱 Claude 完整原生驗收通過，不重播已接受的回合。
2. 原始只讀脚本錯把「上傳區有兩張」當成「分支歷史有兩張」，後按实际 native history 修正預期只一個引用。已把問題問 Opus，第三輪因額度沒有回覆；最新只讀事实提供他复核，不能靠擴大界線來讓腳本通過。
3. Opus 最後差異/完整證據複查未完成；額度恢復後須先讀上述問題與事实，再决定剩餘最小驗證。不使用額度耗盡作為略過門檻的理由。

## 正式狀態

正式設定仍 **be1d976f2d70453fb033cd870dc283bd906a4c1b**，本批没有套用、停止、重啟、恢復/重播工作、push、更新東區或搬取憑證。21:22 臺灣只讀觀察 formal TCP 47831 拒絕連線、沒有該 formal base 的 Node/Electron 程序；不能由此猜是哪方關閉，未自行重開。`formal-unchanged.json`。

修復門檻依 Opus 裁定：解答仍待裁決的驗證問題、完成缺的實測不變性、最後真 Opus 審查，然後核對正式完全停止、保留程式退版、更新及正式安裝讀回。真小說畫面重開不偷渡 resume，由本人操作完成最終實房確認。到此為止狀態為 **候選已實作、部分真原生驗證完成、等待必需 Opus 裁決/最終複查，未正式修復完成**。
