# 2026-10-09 Claude Code 真討論與高關注開源側欄設計比較

## 任務／證據邊界

本人要求針對前輪三項查核（名稱、目前模式可見性、首次手動排序仍移位），問真正 Claude Code，並查使用者多／關注度高及介面可參考的開源工具。這輪只有研究、原生訂閱討論與記錄，不實作、不改本人排序、不部署／重啟 K、不干擾正式聊天室或搬憑證。

選樣用公開 GitHub 關注度，不把 stars 當活躍使用者、排名或體驗評分。12:55 的 GitHub REST API 實讀：OpenCode 212236、Cline 70040、Goose 55093、OpenChamber 11302。前三者作高關注樣本；OpenChamber 是較小但專門做 OpenCode 圖形介面的補充，不宣稱它排名前列或公認最好。沒有安裝／親自使用這些工具，此輪是官方文件與固定公開來源比較，不是使用者體驗測試。

公開證據、API metadata／commit、源码與討論原文：`D:\K-harness\.runtime\sidebar-design-comparison-20261009`。repos.json、sources.json 保存實查時刻與每個來源檔。曾猜測舊 Cline 路徑遭404，改查官方 tree 得到 apps/vscode 路徑；不沿用失效摘錄。

## 真正 Opus 5.5：完成，不冒稱內部權威

- 官方 Claude Code 2.1.294，authMethod=claude.ai、Pro、firstParty，沒有 API key／替代計費或換模；actual assistant model=`claude-opus-5-5`。
- 原生 session `17f22972-36e0-4e91-affa-267592f8a52d`，12:57 success，1 個公開 WebFetch。走既有 discussionOnly／plan／restricted／safe-mode，只允許 WebSearch/WebFetch，無 MCP／寫檔／派工／帳號工具。結束已 await close，只關此研究 host，不是關正式 K。
- 封包只有工程事實、公開程式摘錄與本人排序需求，沒有業務對話或私人圖片。原文 `opus-question.md`、`opus-reply.md`；身份與原始事件在 opus-identity.json、opus-preflight.json、opus-events.jsonl、opus-result.json。
- Opus 明說自己沒有 Claude Desktop 私有排序來源，只實抓官方 Desktop 頁面開頭。不得因「問了 Claude」就把回答當產品內部事實。Astra另完整核對官方文档 Manage sessions／Work in parallel 段落：頂部按狀態、專案、環境過濾及按專案分組；排序觸發沒有明確規格。

## 產品逐項比較

### Claude Code

[官方 Desktop 文件](https://code.claude.com/docs/en/desktop#work-in-parallel-with-sessions)：側欄頂部集中管理過濾／分組、多個 session 平行執行。官方 CLI 和 Desktop 各有列表。

[官方 session browser 範例](https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser)：last_modified newest-first；讀歷史是純讀檔、不啟動 agent。只能證明示範 API 語意，不能當 Desktop 私有側欄排序／點開是否移位的證據。真正詢問 Claude 也未補齊這項未知。

### OpenCode：更新優先，不是全部固定

固定SHA `388406238bd5ca15564a762840a2362c3a45bd9c`（當次default branch dev HEAD）。[layout/helpers.ts](https://github.com/anomalyco/opencode/blob/388406238bd5ca15564a762840a2362c3a45bd9c/packages/app/src/pages/layout/helpers.ts#L10-L24) 根聊天室按 time.updated，缺少則 created，降序同值比 ID。這是排序比較鍵，不是所有更新觸發的證據，不能由這個 helper 宣稱改名／開啟必定不移位或具有手動聊天室選單。

### Cline：歷史排序有明確名稱，但入口也可能不易察覺

固定SHA `fa840c741c3fc2eb49e7e0a4484895a99dae5cc5`。[VS Code HistoryView](https://github.com/cline/cline/blob/fa840c741c3fc2eb49e7e0a4484895a99dae5cc5/apps/vscode/webview-ui/src/components/history/HistoryView.tsx)：Newest／Oldest／Most Expensive／Most Tokens／Most Relevant，newest與oldest按 ts；Today／Older 分組。觸發 SelectTrigger 的 children 只有 FunnelIcon，沒有文字 SelectValue；展開項目才顯示名稱與選中標記。Astra全段源码可確認圖示入口，Opus僅看封包摘錄則較保守，不能把它未斷言當無證據。

可借鑑明確條件名稱、日期群組；**不能把高關注工具的隱藏圖示照搬成 K 的人因解答**。這個比較是 VS Code 歷史視圖，不混稱桌面版全部介面；桌面 example hook 另有按活動排序，但不足以建立私有正式桌面整體 UX 結論。

### Goose：最後訊息時間與日期群組

固定SHA `7bdeadb91617d00e7111f4a04e6b5ccfe1444afe`。[dateUtils](https://github.com/aaif-goose/goose/blob/7bdeadb91617d00e7111f4a04e6b5ccfe1444afe/ui/desktop/src/utils/dateUtils.ts)：sessionActivityAt=lastMessageAt，缺少才 updatedAt；分 Today／Yesterday／日期，群組最新優先。不冒稱其有手動排序，也不由此猜測 updatedAt 寫入全部觸發。

[SessionListView](https://github.com/aaif-goose/goose/blob/7bdeadb91617d00e7111f4a04e6b5ccfe1444afe/ui/desktop/src/components/sessions/SessionListView.tsx)：第一次載入顯示 skeleton，後續搜尋等更新原位，不反覆閃 loading 骨架；首批資料先顯示，剩餘頁背景補齊。這是歷史清單載入，不混稱聊天室完整 transcript 切換已用完全同樣策略。

### OpenChamber：穩定位置與活動列表分層，較直接對應本人困擾

固定SHA `74b79d41eac44ff38790c66f238050936083e0bb`。[useSessionDisplayStore](https://github.com/openchamber/openchamber/blob/74b79d41eac44ff38790c66f238050936083e0bb/packages/ui/src/stores/useSessionDisplayStore.ts)：專案／worktree 預設 manual，可另選 recent；迁移註解明確說活動排序會讓滑鼠下方的列移動，旁邊還有刪除 worktree 等操作，因此採穩定預設。project grouped 與 timeline 是不同檢視。

注意：**專案／worktree manual 不等於聊天室都固定**。[session-ordering](https://github.com/openchamber/openchamber/blob/74b79d41eac44ff38790c66f238050936083e0bb/packages/ui/src/sync/session-ordering.ts)：聊天室置頂優先、active／settled 狀態轉換調整排序；基線優先 idle，再 updated/created，註解明確排除 title／metadata churn 無故提昇。Recent 的 membership 與排序又分開處理。可借鑑內容活動和瀏覽／metadata的區分，不為 K 複製整套 rank／lifecycle store 架構。

## Opus 意見、Astra判斷及保留分歧

1. 同意自動排序並非本身錯誤；目前模式看不見、名稱不明確，與手動真行為錯誤是不同問題。只補文字不能宣稱 manual 已修。
2. Opus認為「最近活動」仍可能含點開／改名；「最近訊息／依最新訊息」較貼近 K，惟新房間沒有訊息卻有初始位置。Astra接受它比原先「最近活動」更精確，仍需選單一句說明新建房間規則，不能把候選名稱當已定案。
3. 雙方支持原入口直接顯示當前模式文字，不只圖示／hover；Astra傾向完整「最近訊息／手動排序」而非只有「最近／手動」，避免再次隱藏判準。觸控沒有 hover 的理由是 UX 推理，不是實機驗收。
4. manual 切入即保存目前排列；既有聊天室的新訊息／回覆不改变相對位置，仍保留現有上移／下移、置頂等明确操作。Opus提到拖曳只是一般契約表述，**不是新增 K 拖曳功能的需求或授權**。
5. 新房間置頂還是置底尚未定案；兩者都能保留原房間相對位置，但插在最前仍會改絕對列位置。不能把「相對順序固定」誇大成任何時刻位置都不動。新 ID 要按固定加入規則，不让它持續隨 recent 重排。
6. Opus指出游標下重排本身還有代價，即使名稱清楚也不消失；有OpenChamber來源可支持設計風險，但 K 當前沒有誤點證據。先不新增 hover 延遲／鎖定／通知／別套排序狀態；不擅自把本人 recent 切 manual。

## 狀態

真正 Opus 討論與公開 source 比較已完成；文件索引更新。這是研究建議，不是修正完成、審核通過或部署授權。K 正式仍5762d48；沒有產品diff、本人localStorage修改、測試正式聊天室、部署、push或重啟。
