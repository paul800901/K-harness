# 側欄狀態、舊聊天室切換與查看跳序：診斷及方案（2026-10-09）

## 範圍及狀態

使用者要求查工作中／完成圓點太接近、舊聊天室切換像卡住、只查看就跳到專案頂端；要求真正 Opus 5.5 討論及開源研究。本輪是工程診斷、公開研究及方案，未實作、部署、啟停 K、push、改帳號或計費、安裝套件；先前插話最終回覆修正候選不動。

依現行正式 f5e9e266b677dbb9d4d330729fbc66fa9d674e53 原始碼查證，不以舊根目錄 source 推定正式狀態。正式程式位於 D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\trusted-runtime。

## 一、圓點：已確定的問題

- frontend/project-sidebar.jsx:44–52：待確認優先、其次 busy、再其次 completionAttention 未讀、最後日期。
- frontend/sidebar.css:26–29：工作中與完成未讀都是 6px 實心圓；前者金棕加 opacity pulse，後者深棕靜態。工作中無可見文字，只在 aria/title。
- 深色圓點其實是「這輪新回覆尚未查看」，不是所有已完成聊天室，更不是整項任務驗收通過。看過後消失，歷史聊天室沒有訊號則顯日期。
- 既有 completion-attention 的目標、待確認、工人及主代理回合結束條件不應改成「沒有 busy 就成功」。

建議：不同形狀＋明確狀態語意，不只換色。工作中用缺口環／spinner（title/aria 為「處理中」）；新回覆用靜態訊息標記（title/aria 為「有新回覆」）；需人處理用警告形狀＋可見「待確認」；一般已讀仍顯日期。不要每列長駐文字擠掉標題。避免綠勾暗示整個任務驗收成功，不加設定、彈窗或整列染色；減少動畫模式仍須辨識。

## 二、舊聊天室：確定的等待路徑，未知的耗時比例

- src/conversation-controller.mjs:124–140 保留目前及最近三個隱藏 controllers；其他安全閒置者釋放，工作中／待確認／不確定者保留。
- :149–174，保留中的聊天室重用；cold room 需 selectWorkspace→native open→loadDiscussion 全部完成才切 active。即使 candidate 已載入歷史，main view 仍是舊聊天室。
- frontend/main.jsx:199,247,274：open 經全域 action busy；disabled = busy || connecting || !online。因此載入條下仍是舊內容且側欄 disabled，符合截圖的凍結感。
- Codex cold open（src/desktop-controller.mjs:727–872）包含模型／工作區檢查、原生 host/account、完整 thread/read、歷史轉換、browser/Flash 設定、thread/resume、沙箱 readiness、goal 與保存。Claude 載入既有投影後還要等 gateway/native host；Gemini prepare/save 後才回傳。
- 「久未開」可因不在保留池而冷啟動，不等同歷史很長。尚未量測每步時間及 renderer 成本，不能宣稱某一步佔最大或保證快幾秒。

最小方向：立即回應目標選擇，視圖與原生可送出狀態分開。目標有已確認歷史就先供閱讀，無內容才顯目標骨架；不能把舊內容／舊輸入當成已切入目標。背景連線期間可閱讀不等於可送出；錯誤／取消仍綁正確目標，不重送、不重播、不停止原背景工作。草稿、附件、核准及停止保持原對話歸屬，原生權限與目標恢復不省略。分頁／虛擬化／額外快取先量測再決定；不新建持久資料庫，不預熱所有聊天室或只提高常駐原生程序數量。

## 三、查看跳序：直接原因及假資料重現

- frontend/project-groups.mjs:4–7 使用 lastOpenedAt 降序；手排及釘選另有原規則。
- src/main-sessions.mjs:59 的 lastOpenedAt 取索引檔 mtime。cold open 三家均保存索引，因此查看／重新連線／某些設定寫入被誤作新活動；hot room 單純切換不一定保存，行為不一致。
- 使用正式 saveMainSession/listMainSessions/sortSessions，在新建假資料目錄建 A 再 B：排序 B,A；沒有新訊息，僅再存 A metadata 後變 A,B。這是儲存與排序鏈的實測，不是操作正式 UI。
- 證據：D:\K-harness\.runtime\sidebar-status-research-20261009\sort-current-behavior.json。

建議：單純查看不改排序。若「最近活動」排序則依真正對話內容活動，而非查看／連線／檔案修改時間。維持手排及釘選，不讓使用者靠手排規避 bug。歷史 timestamp 尚需實作前核對，不捏造過往活動時間或本輪自動遷移資料。

## 公開來源及借鏡

1. [OpenCode 狀態元件](https://github.com/anomalyco/opencode/blob/388406238bd5ca15564a762840a2362c3a45bd9c/packages/app/src/pages/layout/sidebar-items.tsx#L92-L172)：工作中 spinner，未讀、核准、錯誤另用 dot。借鏡不同形狀，不照抄其他色點。
2. [AI Terminal Sessions](https://github.com/visul/ai-terminal-sessions/blob/a9da354319ba3ca223e91241d5cf80479d154f50/README.md)：working spinner、需人處理 warning；頁籤與側欄訊息層次不同。不搬入技術工人樹／監控面板。
3. [OpenCode 訊息快取及淘汰](https://github.com/anomalyco/opencode/blob/388406238bd5ca15564a762840a2362c3a45bd9c/packages/app/src/context/global-sync/session-cache.ts)：UI 訊息等資料有上限與淘汰，資料快取不等同每份歷史各維持常駐原生代理。不因此要求 K 改其完整架構或任意提高保留池。
4. [Codex 官方 app-server](https://learn.chatgpt.com/docs/app-server)：thread/read 可不 resume 讀歷史；thread/turns/list 可 newest-first 分頁，但為實驗能力，未證明 K 選用 binary 已支援。
5. [Claude 官方 Session Browser](https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser)：清單及歷史是純檔案讀取，不需 spawn agent，長歷史可讀 window；官方說這個 pattern 用在 Claude Code Desktop／VSCode 側欄。只研究，不安裝 SDK、不採示範 API key 計費。

Codex／Claude 桌面完整切換 UI 實作未由公開資料確定；不能把上述能力說成已證明桌面的全部預載、快取或排序細節。Goose 本輪讀到 history list，OpenChamber 初步讀到 row composition/cache，未由不足資料宣稱其完整實作。

公開快照、SHA、時間：D:\K-harness\.runtime\sidebar-status-research-20261009\sources.json。截圖只在本機觀察，未交給 Opus 真聊天室、帳號、業務內容或附件。

## 若後續實作，必要驗收

- 三個既有主題、窄側欄及靜止／減少動畫：處理中、新回覆、待確認清楚且標題不被擠掉；不誤宣稱整體任務成功。
- 三核心 cold/hot、短/長歷史：量測點擊→目標回應→首段可讀→可送出；分清感受改善與真正加速。
- 慢 B 載入時選 C，晚到 B 不蓋 C；失敗／取消不串房，輸入／附件／核准／停止精確歸屬，背景工作不中止／重送。
- 查看冷／熱聊天室、查連線、設定保存不跳序；真正內容活動按選定規則排序；釘選、手排、相同時間及重開保持穩定。
- 新回覆訊號的清除需對應真正顯示的目標，而非僅按過側欄。

## 真 Opus 5.5 討論

官方 Claude Code 2.1.294、claude.ai Pro 訂閱，實際回傳模型 claude-opus-5-5；session 6c014866-6d13-4b62-beb1-3332e515565d，exit 0 / success，4 次只讀工具。沒有換模或 API 計費。封包只有工程摘錄及公開資料，原文留 D:\K-harness\.runtime\sidebar-status-research-20261009\opus-discussion\review.md。

Opus 同意三項直接機制，建議 spinner／警告／未讀標記、唯讀 preview 而非提早把 candidate 當 active、單筆索引讀取、實質活動排序。反對每列都加「處理中」文字，避免窄側欄標題被擠掉；提醒草稿、附件、核准、成果面板、goal 未知及晚到結果的歸屬。

Astra 獨立覆核／採納與保留：
- 在實際 main.jsx:199,247,274,302 及 project-sidebar.jsx 的 disabled 傳遞確認：action busy 確實鎖住側欄，不再只是 Opus 因封包摘錄不足而標的推論。
- 實際 completion-attention 對 failed/interrupted/offline/error/uncertain disarm；本輪不把該訊號改成任意「非 busy」。Opus 此項未知已由正式來源查明，不需新增防禦系統。
- 視覺採缺口環與靜態新訊息標記做形狀差異；狀態短字不要全列長駐，待確認保留可見短字，其餘 title/aria 語意明確。具體大小與窄側欄可辨識性留實作 UI 驗收，不假稱已畫好正式 UI。
- 保持真正 active owner 不變，目標 preview 是唯讀，待完整連線／權限／goal 狀態已知才可送出。不是讓多個原生核心共用 owner 或提早重設 active。
- Opus 提出的 goal/get 移至 ready 後不直接採納：它與活躍目標的背景繼續／可送出及回收安全有關，不能把未讀回當沒有目標。先解視圖等待，不移除必要門檻；readiness 是否可獨立補讀及索引精準讀取仍需實測再定。
- 舊紀錄先存寫前 mtime 可用作「凍結原排序的相容錨點」，但不能把它宣稱為真實 lastActivityAt。活動時間須來自可信內容／原生資料，缺少則保留未知；第一次查看也不能藉預設 now 跳序。精確相容方式尚未實作。
- 最後點擊為準只取消尚在開啟的導航／候選，不得取消原聊天室工作或有副作用的已送出操作。新導航仍需等待前候選可確認收尾，不能強殺／重播。

以上是討論及方案判斷，不是程式驗收。

## 差異與正式狀態

本輪只新增本診斷文件、development-log 索引及專案內研究／假資料證據；產品程式與正式資料未改。未部署、重啟或 push。先前插話修正候選不動；沒有宣稱產品 regression 或 UI 修正通過。