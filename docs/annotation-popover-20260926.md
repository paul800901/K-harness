# 簡潔引用與選填留言（2026-09-26）

## 使用者要求與根因

使用者以 Codex 畫面指出之前交代的「加入聊天／選填留言／註解」沒有做成預期流程。本輪不是要求處理截圖反白的「系統匣正常停止」文字，而是要求 K 的註解操作介面。

主代理與獨立覆核都確認：正式 `trusted-runtime/dist-ui/index.html` 引用 `index-CG-G3PzN.js`，內含基本「加入聊天」、逐段註解、`k-response-annotations-v1` 送出格式。問題不是完全沒有引用功能，而是把入口放在整則回覆下面，新增後常駐大卡片、另設送出按鈕；缺少選取附近的小留言浮框、composer 的 N 則註解標記。只有引用無正文時，一般送出受 assistant-ui 的文字條件限制而不可用，只能走另外的引用送出按鈕。

## 本輪範圍

- 單一已完成助理回覆反白文字後，就近「加入聊天」。加入只存草稿，不送模型。
- 小浮框「新增選填留言…」，可留白、打字或沿用既有聽寫；仍限定原聊天室及原段落。
- 輸入框內顯示 N 則註解標記，按需查看／編輯／移除，不預設占用大塊版面，不另外設送出引用按鈕。
- 一般訊息送出帶上註解；只有引用也能由同一送出入口提交。保留引用原文只是上下文、留言才是使用者要求的契約。
- 保留多段／失敗保稿／切室隔離／成功後只清未再修改項目、單一聽寫及取消保護。既有後端與隔離規則不變。

## 狀態

**22:49 已合併部署；22:50 使用者由原捷徑開啟，22:51 正式視窗讀回完成。** 新版註解介面和上一輪四個後端／原生修正一起套用，原工作區與對話保留。主代理在正式 K 反白「更新程序」，實際看見選區附近的「加入聊天」浮框；沒有新增註解草稿、送模型或開麥克風。正式 JS 與已驗證 V3 指紋一致。部署、正常停止及還原證據見本文最後一節。

前一輪候選操作 **12/12** 通過後尚未部署，曾評估只更新前端、重載主介面，但假原生候選的 Ctrl+R／F5 均未觸發重載；未把該結果當正式鍵盤驗收，也沒有新增控制後門或強制終止 K。本次使用者明確要求「重啟套用」後才完成以下正式操作。

## 開源方案核對與取捨

使用者追加要求先查現成開源方案。主代理於本輪讀取上游官方文件，並比對本機已安裝來源，確認不是只存在於最新版文件的能力：

- [assistant-ui Quote](https://www.assistant-ui.com/elements/quote)：選取助理文字、貼近選取的浮動引用工具列、composer 預覽。
- [Quote Selected Text](https://www.assistant-ui.com/docs/guides/quoting)：原生只保留一筆引用，不包含 K 所需的多則選填留言；只有引用不會使 composer 成為可送出的非空內容。
- 本機 `@assistant-ui/react@0.15.19`（MIT）公開 `SelectionToolbarPrimitive.Root/Quote`，已處理選取事件、單一 message 範圍、body portal、按鈕點擊時保留反白，以及捲動時隱藏。不需升級或安裝。
- 決定直接使用公開 `SelectionToolbarPrimitive.Root` 作為入口，不另維護另一套選取監聽。自訂按鈕接回 K 原有多筆草稿／安全文字封裝；留言、聽寫與數量標記是 K 的必要補充，不使用只支援單筆的內建 Quote 狀態覆蓋多筆草稿。
- 原始碼內的 `useSelectionToolbarInfo` 沒有從套件 public exports 暴露，不使用深層匯入。上游基本定位未含視窗邊界避讓，K 僅補必要的邊界處理並由窄視窗實測驗證。
- 另核對 [Floating UI virtual elements](https://floating-ui.com/docs/virtual-elements)，支援 Range 選取定位；本輪已有直接相依可用的 assistant-ui 入口，不為此再引入新套件。

調研完成不等於 UI 驗證或正式部署完成，最終狀態仍以上方與後續實測紀錄為準。

## 實作與驗證紀錄

涉及 `frontend/main.jsx`、`frontend/response-annotations.jsx`、`frontend/response-annotations.css`、`frontend/response-annotations.mjs`，以及兩個 response-annotations 測試檔；未修改供應商路由、隔離或套件依賴。

- 單一公開選取工具列與 Messages 平行掛載；不讓上游無選取時的 `return null` 隱藏訊息。
- 留言浮框採矮橫列加既有聽寫入口。composer 放數量標記，只有使用者展開才顯示引用與留言。
- 常規送出箭頭和 Enter 都走原 K 的送出／排隊路徑。只有引用也可送；Shift+Enter、IME `isComposing`／229 不送。引用與使用者要求仍分欄封裝，不以引用文字作為授權。
- 定向測試 **16/16**。第一次主代理循序全套 **549/549**，139.95 秒，保存於 `full-regression.txt`；期間有一次 toolbar resize 行為調整，因此凍結 V3 後另跑最後全套 **549/549**，139.59 秒、無失敗／略過，最終證據為 `.runtime/annotation-popover-20260926/full-regression-final.txt`。
- 建置產物分開保留；目前候選 `build-v3/index.html` 指向 `index-Q9DXLedy.js`，來源指紋見 `source-baseline-v3.json`。既有大型 bundle 警告不在本輪擴大拆分範圍。
- 主代理在真 UI 前抓到初版漏匯入 `useLayoutEffect`，以及只 stopPropagation 不能阻止上游 Enter handler 的 IME 風險；已補匯入並用 `submitMode="none"` 接 K 自管 Enter。初版 build 保留，不交付為成功候選。
- 只讀 reviewer 對 CSS zoom 座標的初步疑慮沒有瀏覽器反證，已撤回為未證實假說；不因此更改正確的 viewport 座標或增加新抽象。

## 獨立原生候選操作結果

最終證據：`.runtime/annotation-popover-20260926/evidence/annotation-ui-2026-09-26T14-07-53-612Z.json`；`candidate-state-2026-09-26T14-07-53-612Z/candidate-result.json` 保存假送出 payload、操作檢查與幾何資訊。

- 真 Electron 視窗、專用暫存 profile、private CDP pipe、假 controller／假對話；沒有操作正式 K、真帳號／模型／麥克風。
- **12 項操作檢查通過**：可引用來源限制、選區附近入口、選填留言與取消保稿、多筆／留白／編輯移除、留言 Enter 不送、主輸入框 IME 229／isComposing 不送、只有引用用一般 Enter 送出、正文加引用由一般送出合併、純正文 Enter 保持原文、失敗保稿、跨聊天室隔離恢復、窄窗定位及無 renderer error（同一檢查項含相連子行為）。
- 760×640 實際 K 縮放方式：`#root` computed zoom 1.1、body/html 為 1。右側可見選區與浮框沒有超出視窗；未以全 html zoom 的人造條件修改產品定位。
- 主代理目視 `selection-toolbar.png`、`narrow-zoom-toolbar.png`、`optional-comment.png`，確認入口貼反白處、留言是一行加 mic、composer 保留小型數量標記。
- 最終 JS SHA-256：`0D8F7B99564C98BD0153361AF17E23F77A4DABC265A99B9A18E666AECA204D97`。`final-source-readback.json` 六個來源檔均與 V3 建置前指紋一致。

### 不隱藏的失敗與限制

前幾輪 fixture 錯誤與截圖仍保留於 evidence／candidate-state：新 `.cjs` 的 async 包装遺漏造成測試啟動失敗；連續 assistant 訊息被正常分組隱藏、按鈕名稱未精確比對，以及修改註解後仍比對舊值均修正測試本身。一次全 html zoom 測法不符合 K 的 `#root` 縮放方式，已撤回其產品缺陷判斷，改以正確方式重驗通過。這些失敗不算產品通過，也沒有刪除證據。

以上候選驗收不包含真實麥克風辨識準確度或真模型理解註解；僅確認前端實際操作與假 controller 收到的安全引用內容。正式載入已於下節補驗。沒有更改登入資料、秘密保護或 Sandboxie 設定。

## 22:49 合併部署與 22:51 正式讀回

- 使用者明確要求「重啟套用」。啟動紀錄顯示 22:45:45 `confirmed close`、正常退出碼 0；部署前核對沒有候選／正式 K 程序，47831 沒有監聽者，沒有中斷工作或強制結束程序。
- 主代理及 Luna 只讀覆核：上一輪五個產品來源（包含 voice-composer）與其 baseline 一致，本輪六個 source/test 也都符合 V3 baseline。全套 **549/549** 和 **12/12** UI 沿用同一凍結版的既有實測，不宣稱這次部署又重跑一次。
- 執行 `.runtime/annotation-popover-20260926/deploy-combined.ps1`，更新 **12 個目的地**：`trusted-runtime/src/` 的 desktop-server、local-dictation、electron-workbench、electron-owner-preload 四檔，以及 V3 的 index、JS、CSS、logo 分別至根目錄和 trusted-runtime 的 dist-ui。先複製 assets 再切 index；保留舊 assets、對話、設定、profile 和登入資料，不部署測試檔或候選資料。
- 備份：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\annotation-combined-backup-20260926-224928`。`receipt.json` 記每個目的地、新舊 hash 與備份位置；12 個目的地及所有已存在檔案的備份均讀回相符。
- 啟動工具曾在執行前回報 `blocked by policy`，沒有繞過或改用其他啟動通道。使用者隨後回覆「已開啟 K」；launcher.log 顯示 22:50:01 starting、22:50:03 native isolated workbench ready。
- 健康端點身分為 `k-harness-desktop`／`isolated`，workspace 精確為既有 candidate 的 `vault/private-state`。正式 `/assets/index-Q9DXLedy.js` 回應 200，SHA-256 為上列 V3 值。未帶可信桌面入口的首頁 HTTP 讀取被正常拒絕；沒有擷取 cookie 或繞過該檢查，首頁與操作由真正 K 視窗讀回。
- 真視窗顯示原工作區／原 Opus 5.5 對話與空白輸入草稿，沒有執行中工作；實際反白「更新程序」後，選區附近出現「加入聊天」，亦有 accessibility 按鈕讀回。最後取消反白、保持 K 開啟；沒有新增／移除使用者資料、送訊息或收音。
- 證據：同目錄的 `deployment-result.json`、`deployment-readback.json`、`formal-served-assets.json`、`formal-ui-readback.json`、`formal-restart-final.json`。正式這次驗收是啟動、隔離身分、載入指紋和引用入口，不冒充真麥克風／真模型整段註解流程已驗。

### 還原方式

先由正常系統匣入口完整停止 K，確認沒有工作／程序及 47831 listener；依上述備份 `receipt.json`，只把 `Existed: true` 的備份複製回各自 Destination，核對 OldHash。保留新舊 hashed assets，不須刪除；舊 index 會引用仍在的舊資產。再由原捷徑開啟、確認隔離健康與原畫面。這會一起還原註解 UI 及本次四個後端／原生檔；不動對話、設定或登入資料。

舊 `.runtime/opus-followup-20260926/deploy.ps1` 仍指向較早 UI，**不可再用它覆蓋這次版本**。
