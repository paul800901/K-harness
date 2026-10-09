# K 附件-only 修正與延後上線（2026-10-09）

## 結論／授權
- 已完成候選實作、真原生測試、完整回歸及真正 Opus 5.5 程式複查。**停止等待本人明確通知，不部署／重啟／push，不干擾正式 K 正在進行的工作。**
- 本人要求 K 不以自製非空文字規則拒絕三核心可處理的附件；隨後明確要求修完先停，等排序／其他更新及 K 工作停下來，再通知上線。此要求取代本批依例行 SOP 直接發布。
- 基底為當時正式程式 5762d48913ca185e68dad1709197ccfe47c7dc67；固定本批程式提交 **95fba5658ea650e2d524645b7f03eaaf0f8538e8**，branch codex/attachment-only-20261009，工作樹 C:\Users\Paulus\.codex\worktrees\capacity-error-20261009\K-harness。未整合其他聊天室的新排序修正；將來上線須在當時最新整合基底納入本批、重做相稱驗證，不能直接覆蓋其他修正。

## 根因與最小修正
- 共用主輸入框的 submitText／queueDraft／idle arrow／busy arrow 都只接受非空文字或引用；三核心 controller、兩家 steer、待送佇列 enqueue／edit-save 也拒絕空字。因此光放寬按鈕仍會被後端擋住。
- 改為文字／引用或已保存附件至少一項即可。完全空白、上傳中、超過 32,000 字元、非字串文字、無效／跨聊天室附件、原生模態限制、狀態／停止／權限及未知結果不重送規則仍保留。附件-only 的佇列編輯可以清空文字，但沒有附件的項目不能清空。
- 不補寫「看這張圖」或使用者指令。Codex 沿既有 localImage 與附件上下文；Claude 只送 image，不插空 text 區塊；Gemini 沿既有原生檔案參照，不把 image 塞入只支援 text 的串流協定。原生可能詢問使用者要做什麼，K 不代答。
- Claude 原 appendMessage 因空字回 null，放寬輸入後 sentMessage.id 會失敗；必要窄修允許已驗證的 user 附件訊息空字，assistant 的空訊息抑制仍保留。無文字的新對話標題用第一附件名稱，不改已存在標題。
- 修改六份產品來源：frontend/main.jsx、frontend/queued-messages.jsx、src/desktop-controller.mjs、src/claude-controller.mjs、src/gemini-controller.mjs、src/input-queue.mjs；四份既有測試加定向案例。沒有新增框架、狀態、retry／fallback／自動換模或人用設定。
- 多模型「討論」目前不接圖片／影音（conversation-controller 明確拒絕未擷取文字的顯式附件），不是三核心原生圖片入口；本批不擴充該契約，不把一般對話可讀圖宣稱為討論模式已接圖。

## 實際驗證
- 定向 **206/206**；全套單程序 **1082/1082**，154 秒；UI 建置成功，僅原有大型 chunk 警告；git diff --check 通過。
- 1920／390 兩尺寸 × Codex／Claude／Gemini 六組建置介面：空白與上傳中不可送；圖片完成後無文字箭頭可送；桌面 Enter／手機按箭頭；busy 圖片-only 送入待送；原生歷史空文字仍顯示附件下載；有附件佇列空字可以儲存；模擬送出失敗保留圖檔與空草稿，全部通過、零頁面錯誤。手機截圖已視查；這不是實體手機驗收。
- 本候選 controllers 真正新對話，使用者 text=''、同一張自製 2304-byte 白底紅方形／藍圓形／PIC-7429 圖；圖形與代碼不放文字。**Luna 低推理、Haiku 4.5、Flash 3.8 low 均 completed 且正確讀圖**，各一個初始回合，沒有重送、Opus 圖片測試、帳號切換或權限放寬。Claude delivery 僅 image；Gemini init 確認 gemini-3.8-flash-low，原生 view_file 讀原圖；Codex 原生 turn/start 確認 localImage。三個測試 host 已正常關閉。
- 使用 K 原有訂閱與已選核心 Codex 0.161.0／Claude 2.1.294／Antigravity 1.3.1，不搬憑證或改 API 計費。早先只測原生入口的結果另見 image-only-native-probe-20261009.md。

## 真正 Opus 5.5 與 Astra 核對
- Claude.ai Pro／firstParty，實際 claude-opus-5-5，session **a74af914-7edb-4402-b746-be46ccb040bf**，20 次 Read／Glob／Grep，exit 0、success、is_error=false。此為專案要求的程式複查，不拿 Opus 跑圖片模態測試。結論通過、無阻擋問題；沒有模型代替審核。
- 確認前後端所有一般送出入口一致、Claude 空訊息修正必要、三家組裝／歷史與佇列正確，沒有多餘抽象／狀態或放寬權限。
- 意見 1：初版 UI 報告其餘五組 failedSendPreservesAttachment=false 是**未測**，不是失敗，scope 的敘述不夠精確。保留初報告 result-first-scope.json；補測全部六組後該項都 true，見 ui/result.json。完整回歸在審核期間完成 1082/1082；不拿 reviewer 當時說仍在跑冒充完成。
- 意見 2：Astra 讀回 conversation-controller 的明確討論附件拒絕，確認契約沒有擴張。意見 3：Claude 既有 send 在檢查附件前加入 user，非法附件會留未送訊息；本批只記錄，未擴成附帶重構。意見 4：僅附件的待送文字前有分隔符號，外觀小問題不影響送出，未追加改動。
- Astra 獨立檢查固定提交 diff、native delivery／結果、UI／完整回歸及審核封包十檔逐位元一致，接受複查結論，不只依代理口頭回報。

## 保留的失敗與停止讀回
- 第一個定向測試暴露 Claude appendMessage 的空字 null，已修根因。其後測試因既有非法附件留下未送 user 紀錄，斷言改為核對真正含附件的兩筆；非法附件仍另驗未送原生，未放寬成功條件。
- UI 舊候選 dependencies 路徑因先前部署搬移而找不到，改用現存正式相依，未安裝。UI 探針等待「保存」進度字串逾時，改以已到假伺服器且保留 loading 的實際事件驗證，不依賴進度文案。
- 2026-10-09 13:25 唯讀核對正式版本仍 **5762d48913ca185e68dad1709197ccfe47c7dc67**，六個相關正式來源與該基底相同（正規化既有 CRLF／LF）。沒有正式 stop／open／send／部署／重啟、push 或預先排程；既有 K 工作不動。
- 已停在待整合／上線候選。本人未再明確通知前，不執行發布；東區也未更新。

證據：D:\K-harness\.runtime\attachment-only-fix-20261009（native.mjs、三家 candidate、ui、review、review-packet-readback.json、formal-unchanged.json）；工作樹 .runtime\attachment-only（focused-final.txt、full.txt、build-final.txt、ui-verified-all.txt）。
