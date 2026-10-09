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

## 本人允許後的整合正式更新（2026-10-09，取代前文候選停等狀態）

- 本人最新明確允許「可以關掉，可以更新」；兩邊協調由「追查插話後最終回覆消失」單一部署者整合，peer确认無新增產品修改或阻擋。停止核對時47831不可連線，K桌面／Electron／K專用三核心工作程序均未執行；只有既有外部Chrome／瀏覽器助手保留，沒有強制結束或停止它們。
- 以正式5762d489為基底，sidebar 4d621c5與peer附件95fba565重放92a9861，自動整合main.jsx無衝突；規則／文件併入後固定完整SHA **6138b578b20540dcfeaaa2cc47270d59cd4aba74**。root開發區原有dirty內容未reset或覆蓋，不是用舊root整包更新。未保存偏好預設依工作區＋manual；已保存recent／分組不變，舊環境需自行切一次手動，不宣稱現用設定已被遷移。
- 從Git archive乾淨候選建置UI／擴充／C#啟動器；只複製現用已安裝相依的實體副本，未安裝／更新核心。建置後616個tracked檔逐位元一致；generator只產生extension-protocol換行差異，還原archive bytes，完整回歸後再次616/616核對。沒有部署指向退版位置的node_modules連結。
- 整合版**完整序列1084/1084，0fail／0skip**；建置側欄延遲／唯讀導航三主題×兩尺寸6/6；實際桌面HTTP／SSE／假native與磁碟的manual/recent互切、送出／回覆／reload、新房尾端／上移及430px模式可見全部通過；三核心×1920／390附件-only六組全通過，包括空白／上傳中禁止、無字送圖、busy待送、歷史附件、清空queue文字及失敗圖檔保留。沒有用正式工作或圖片重送作驗證。
- 真正Opus5.5整合複查：官方Claude.ai Pro／firstParty、CLI2.1.294，session **49aab930-51b2-4f62-8593-79c38c46b808**，actual claude-opus-5-5、9個Read/Grep、exit0／success／is_error=false；明確無阻擋。Astra自行檢查全diff、13份review封包與候選逐位元一致、616份tracked source、完整回歸／built結果；不把代理回覆當成驗收。
- Opus非阻擋意見：已存recent保留、每次recent→manual捕捉當下且不恢復舊manual，均是明確契約並已說明；空白Claude steer原樣保存不順手改；Codex純圖steer**真原生回聲未特別實測**。Astra另讀原回聲程式以完整codexInput文字（含附件上下文）對應，非只比acceptedText，未发现阻擋但不升級為真原生驗證。多模型討論的原有未擷取附件拒絕仍由conversation-controller處理，不把一般原生圖片能力扩成討論。
- 失敗保留：先用PowerShell5.1執行建置時，把Vite既有bundle警告的stderr誤当NativeCommandError；未動正式程式，改用本機既有PowerShell7完成，未安裝／改環境。第一次完整序列1083/1084，在未改動的browser-native-profiles等候新descriptor時失敗；原log clean-full-test.log完整保留。該檔重跑3/3，再同版本全測1084/1084；沒有放寬測試／timeout或改產品，不把推測的負載原因當已確認根因。前批並行native-wakeup失敗亦仍保留。
- 正式activate成功，version **6138b578b20540dcfeaaa2cc47270d59cd4aba74**；上一版程式／啟動器 **D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1791524572264**。98756個既有狀態／profiles／原生設定檔更新前後hash相同；非version／previous本機設定不變。這是程式退版，不把它當對話還原，也沒移動登入資料／模型或改計費。
- 台灣13:44正式owner讀回：health200，未授權首頁／state403；新JS/CSS served bytes與正式磁碟SHA256相同；authenticated built首頁20聊天室、unreadable0，新的空白瀏覽器default grouped/manual模式文字實際可見；0 POST／0pageerror、selectedThread=null、busy=false，原遺失回覆projection hash仍相同。沒選取／resume／send任何現有聊天室，不恢復暫停小說或其他工作。這是正式owner／built UI，非本人Electron／實體手機觸控驗收。
- 讀回後正常close，確認47831不可連線，**K保持關閉，已可重新開啟**。正式指標及退版位置已讀回；不push／打tag，不更新東區。之後docs收尾commit只記錄，不把它當再次部署程式SHA。

本批完整證據：**D:/K-harness/.runtime/sidebar-attachment-deploy-20261009**（candidate.json、source.zip、fixed-source-readback.json、clean-full-test.log、clean-full-test-rerun.log、manual-ui/result.json、attachment-ui/result.json、review、acceptance.json、deployment-activation.json、deployment-preserved.json、formal-readback.json）。
