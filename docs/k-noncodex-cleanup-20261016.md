# K 非 Codex 部分整理（2026-10-16 起）

[GPT 遺留程式整理](gpt-legacy-cleanup-20261015.md) 第 5 項。Opus 與 Astra（`gpt-6-astra`，xhigh）各自只讀盤點後比對，兩邊同意的做法才動手。Codex 主控（`desktop-controller` 拆分、臨時程序讀模型目錄）屬第 7 項，本批不碰。

## 盤點結論（兩邊比對後）

1. 工人狀態判斷：結束狀態清單 6 份（後端 5、前端 1）；`workers()` 回傳形狀相容寫法 5 處。各處判斷不完全等價：畫面、完成通知只看「是否已結束」，閒置釋放、刪除、換工作區要看「是否可能還活著」（`running + settled:true` 這類矛盾紀錄仍要擋）；`failed + settled:false` 是「失敗但停止未確認」，不算結束。所以只共用詞表與兩個判斷，不合成一個布林。
2. 瀏覽器與本機工具伺服器：Bearer 比對 3 份、外層 gateway 以 HTTP 轉送到同程序的內層 gateway。分兩批：先共用驗證函式、拓樸不變；再把內層 HTTP 改成直接呼叫，須接回斷線即取消、串流讀完才釋放等行為，另批驗收並實測。
3. `isolated-desktop`：同一個「只允許已登記工作區」檢查包在聊天室路由層與 provider 層各一次。路由層的選擇本來就交給 provider 層，可拿掉；路由層的「移動」預檢要留（它在載入未開啟的聊天室之前就擋下非法目的地）。
4. 讀原始碼字串的測試：逐功能換成行為測試，跟各批重構一起做；樣式守門等合理的靜態規則保留。
5. 前端 `App`（`main.jsx` 約 1,740 行）：先拆設定視窗，再拆右側呈現；跨聊天室的非同步防護（`navigationId`、`previewRequest`、來源 threadId、逐房操作鎖）不合併。

另列待本人決定：切換供應商的阻擋條件是 `settled:false` 或 `running／starting／pending`，`unresolved` 本身不在其中；`unresolved` 搭配 `settled:false` 仍會擋，差別只在 `settled` 不是 `false` 的紀錄。分支與移動工作區的同類判斷則有列 `unresolved`。補上會改變行為（這類舊工單可能擋住切換），未在本批處理。

## 第一批：工人狀態共用、移除重複的工作區包裝

### 修改
- 新增 `src/worker-status.mjs`：`workerEnded`（`settled:true` 優先；`settled:false` 一律不算結束；結束狀態含讀取相容的 `canceled`）與 `workerMayBeLive`（`settled:false`、`running/starting/pending/unresolved`、或未證明結束）。
- `src/completion-attention.mjs`、`src/conversation-controller.mjs`（工人摘要、工人明細、閒置釋放前後兩次檢查）改用共用判斷；閒置釋放在瀏覽器檢查前後各讀一次工人的設計保留。
- `frontend/work-status.mjs` 的 `workerEnded` 改用共用判斷，另保留 UI 摘要狀態 `ended`（只在畫面認列，不擴張後端釋放條件）。
- 刪除 5 處 `Array.isArray(result) ? result : result?.workers` 相容寫法：三家 controller 與所有測試假件的 `workers()` 都回傳陣列。
- `src/isolated-desktop.mjs`：拆成 `restrictMove`（只包移動）與 `restrictWorkspace`（選擇＋移動）；聊天室路由層只套 `restrictMove`，provider 層照舊套 `restrictWorkspace`。
- 測試：新增 `test/worker-status.test.mjs`（兩種取消拼字、`failed + settled:false`、未知狀態、`running + settled:true`、UI 的 `ended`）；`test/isolated-desktop.test.mjs` 補「直接選 state 目錄被拒」。

### 驗證
- 基準（同一工作樹、未建置 UI）：`npm test` 1705 項，2 項失敗，皆因工作樹沒有 `dist-ui`。
- 修改後：受影響的 6 個測試檔 92 項全過；`npm run build:ui` 後 `npm test` 1707 項全過（多的 2 項是新測試）；`npm run test:ui` 48/48 通過（工作樹的 `node_modules`、`.runtime/playwright-browsers` 以 junction 指向主樹，只讀使用）。

### 複查與部署
- Astra 複查「同意」（提交 `2941297`）：逐處核對與原條件等價，另以 128 組狀態、2,688 次比較對照基準原判斷式零差異；三家 `workers()` 回傳契約支持直接刪除相容寫法（原盤點建議的 helper 不需要）；選擇、新建／重開、內部接續都經 provider 層登記檢查，移動預檢仍在載入聊天室之前。它在自己的 scratch 副本另跑 3 項邊界測試（state 目錄 junction 別名、三家保存對話的未登記工作區、未載入聊天室的非法移動目的地）全過；這些測試未加入本 repo。
- 採納的文件補正：切換供應商與 `unresolved` 的說法收窄（見上）；補 `development-log.md` 索引。
- 部署：本批與第 5 項後續批次一起，待 K 完全停止後在 K 外執行 `Update-K.ps1`，由本人安排；合回 main 不等於正式 K 已更新。
