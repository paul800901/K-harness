# 2026-10-09 排序規則、名稱與可見性嚴格核對

## 範圍與結論

本人在12:46截圖確認勾選「最近使用」，要求不能亂改排序：規則寫什麼就做什麼；問題是目前排序模式藏在圖示選單，日常畫面感受不到。這次只讀產品、公開來源及 DSH 工程來源，另跑隔離假資料重現；沒有改產品、本人設定、正式資料或部署／重啟 K，不中斷目前工作。

正式 runtime.json 讀回仍 `5762d48913ca185e68dad1709197ccfe47c7dc67`。核對用工作樹 `C:\Users\Paulus\.codex\worktrees\steer-final-display\K-harness`，不是有其他修改的根目錄舊 source。

## K：規則與介面分開判斷

- `frontend/main.jsx:52-53,162,227-228,289-305`：預設 recent，模式／手動順序分別留 localStorage。本人截圖的 current client 明確勾 recent；按鈕只有圖示、提示「檢視選項」，關閉選單沒有目前排序文字。這是模式不易察覺的直接證據，不是本人操作錯誤。
- `frontend/project-groups.mjs:4-20`：置頂優先，recent 按 sortAt 降序，同時點以 ID 作穩定比較。主清單分組與單一清單沿用該排序。搜尋結果另按 recent，不冒稱也是固定手動位置。
- `src/main-sessions.mjs:25-51,70`：metadata 保存保留既有 sortAt，旧資料沒有 sortAt 以既有 mtime 錨定；不是每次開啟都算最新使用。新建房有初始時間。
- `src/desktop-controller.mjs:285,842,860`、`src/claude-controller.mjs:416,685,720`、`src/gemini-controller.mjs:193,203`：已接受的新訊息／插話與有助理回覆的回合結束推進活動時間；單純瀏覽、改名及設定保存不推進。故目前較接近「最近活動」，不能把「最近使用」直接理解成最後點開時間。
- Pick Me Up 現場先前的原瞬間仍未知；同房實際新訊息與 sortAt 對得上，但不能倒推當時只是點開或指認本人記錯。前次隔離真 HTTP/SSE/disk/built DOM 重現只點開不移位，送假訊息才移位，證據另見 sidebar-ux-fix 最後追加。

### 真正的手動規則缺口

`main.jsx:275,301` 切 manual 只改模式，沒有保存當時完整位置；`project-groups.mjs:12-19` 對尚未出現在 manualOrder 的 ID，仍退回 recent。第一次切 manual、還未做上移／下移時 order 為空，所以原有聊天室仍會隨新活動移位。這與手動排序應保留既有位置的預期不符，不能只補名稱便宣稱排序契約全部正確。

12:51 隔離實測：複用正式 source、正式 dist-ui 與假 native transport，實際點開「檢視選項」→「手動排序」，讀回 localStorage mode=manual、order=[]。順序 Recent/Middle/Pick；只點開不動；送一則假訊息後變 Pick/Recent/Middle，假回覆完成保持該順序。0 pageerror，1 次假 turn/start、0 次真模型呼叫，沒有正式 state/profile 寫入。這裡 result.passed=true 表示重現判定成立，**不是手動排序驗收通過**。

證據：`D:\K-harness\.runtime\sidebar-sort-audit-20261009\manual-ui-probe.mjs`、`result.json`、`manual-ui-probe.txt`、`manual-new-message-order.png`。純 fixture，沒有新增常駐驗證機制。

## 參考工具：不可混同版本、設定與行為

- Codex App：本次 list_threads 實讀 shared sidebarPreferences：chats/projects=`updated_at`、pinned=`manual`，grouping=project、surface=work。這證明本機不是全部固定排序，但不證明私有產品每個點擊／回覆事件的重排時點；未操作本人其他聊天測試。
- OpenCode：固定公開 commit `388406238bd5ca15564a762840a2362c3a45bd9c` 的 [layout/helpers.ts](https://github.com/anomalyco/opencode/blob/388406238bd5ca15564a762840a2362c3a45bd9c/packages/app/src/pages/layout/helpers.ts#L10-L24) 明確依 `time.updated`，缺少時用 created；不是所有工具永不移動。此證據只界定比較鍵，不冒稱所有 timestamp 寫入觸發與 K 相同。
- Claude：[官方 session browser 範例](https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser) 以最後修改時間提供 newest-first 列表，讀訊息是純檔案讀取、不啟動 agent；[CLI 官方文件](https://code.claude.com/docs/en/sessions#use-the-session-picker) 顯示最後活動時間。官方也說 CLI／桌面／網頁各有自己的列表；不能由範例推論全部介面排序完全一致。
- DSH：只讀本機 `D:\DSH架構\DeepSeekHarness-0.2.1-alpha.1-local\packages\client\ui-workspace\src\client` 的 locales.ts（「最近更新」／「手動排序」）、tree.ts:140-195（updatedAt／保存的手動位置）、stores.ts:94-98 與 rows/WorkspaceBrowser.tsx:1279（切 manual 當下保存 activeSessionOrders）。可參考的是「進入手動即保存現有排列」。該版也把選項放在圖示選單，不能當成人因已充分解決。
- DSH 版本界線：桌面啟動器指向官方桌面版客製 app；build-result.json 記 baseVersion=0.2.0-rc.2。上述0.2.1工程來源不是這個 binary 的 live 驗證，不操作 DSH 或臨床資料、不宣稱正式 DSH 現況已實測。

## 最小修正候選，尚未實作

1. 保留自動／手動及置頂規則，不因一次跳位取消自動排序或強制更換本人目前選項。
2. 自動選项改為與現有觸發相符的「最近活動」；原按鈕直接顯示目前「最近活動／手動排序」，不只顯示圖示、不新增設定頁或確認流程。
3. 原選單短句說明「新訊息或回覆會重排；只開啟查看不重排」。不承諾每個工具事件都會移位。
4. 若進行修正，切 manual 當下保存現有排列，後續活動不改既有相對位置；新房間位置另用既有最小规则處理，不能繼續讓未列入 order 的既有房間暗用 recent。

驗收需分開測：recent 的新內容移位／只看不移位；manual 初次切換、不上移下移也固定、再收到內容與 reload 固定；置頂／分組不破壞。這是後續實作的直接範圍，不是本輪已完成修正。
