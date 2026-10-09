# 2026-10-09 側欄預設手動排序（候選）

## 本人最新定案與可見結果

本人要求預設不要用「最近」，避免未預期移位；這是先前研究後的新決定，不是把自動排序當成錯誤。候選未保存／無效偏好時採「依工作區＋手動排序」；保留自行選用「最近訊息」及既有分組設定。

- 手動模式固定當下排列，訊息／回覆／單純點開不改位置。第一次進入就補齊排列，不必先按上移／下移。
- 從最近訊息切入手動，保存切換當下順序，不還原先前手動排列。新聊天室加尾端；釘選的既有優先規則不變。
- 側欄直接顯示「手動排序／最近訊息」，不再只靠圖示／滑鼠提示。舊「最近使用」選項改稱「最近訊息」；不把專案分組改為跨專案時間線。
- 舊版會自動保存 recent，無法分辨原預設與本人選用。本批不覆寫已保存的模式；舊介面要改為手動，需自行切換一次。本輪沒有代操作正式使用者設定。

## 根因、修改與範圍

舊 manual 首次只有 mode 改變、order=[]，所有位置都缺失，sortSessions 仍落到 recent 次序。沿用既有 manualOrder/localStorage：純函式 completeSessionOrder 補齊可見主對話 ID；已有 ID 不隨 sortAt 重排，沒有新增 ID 回傳同一陣列。useLayoutEffect 在 paint 前完成補齊；切 manual 時一次捕捉當下順序。

凍結產品程式：`4d621c545ba697a83bdc497c3d5fa5f916d49f1c`，分支 `codex/steer-final-display-20261009`；來源工作樹 `C:/Users/Paulus/.codex/worktrees/steer-final-display/K-harness`。產品／測試修改只有：

- frontend/main.jsx：預設、排列補齊、切換 handler、目前模式文字與選項名稱。
- frontend/project-groups.mjs：補齊 ID 的純函式。
- frontend/sidebar.css：現有排序按鈕文字布局。
- test/sidebar-data.test.mjs：初次捕捉、活動不移位、新房間、分支／釘選／封存單元驗證。

README 與本工程索引另記候選與部署界線。沒有修改 backend、原生核心、資料位置、模型、權限、工作、登入／計費；沒有新增設定頁、通知、排序延遲或新架構。

## 驗證與保留失敗

證據目錄 `D:/K-harness/.runtime/sidebar-manual-default-20261009`。

- 目標測試18/18；UI build成功，只有既有bundle大小警告。
- 實際 built UI／桌面 HTTP、API、SSE、假 session 磁碟資料：冷開／暖開／重載不動；預設grouped/manual；假新訊息＋完成回覆不動；recent會按活動排序；切manual保存當下，再有其他房訊息不動；新房加尾；上移有效；430px手機目前模式可見、已選recent重載保留。result.json有完整observations，只有兩次假turn/start，pageerror=0；沒有正式profile或真模型工作。
- 首次UI probe最後一步使用錯誤定位名稱「展開工作區」，真實名稱為「展開側欄」。只修測試定位後重跑通過，未為此修改產品。截圖desktop-manual.png／mobile-manual.png已目視手機模式文字。
- 程式凍結前全測1079/1079。凍結後兩次預設併行全測各有2項既有 native-wakeup 計時等待斷言失敗（兩輪項目不完全相同）；失敗原文保留 full-tests-frozen.log、full-tests-frozen-rerun.log。單檔重跑18/18；未改後端／測試、未跳過個案。完整序列測試結果另追加，不以先前綠燈抹掉失敗。

## 真正 Opus 5.5 複查與 Astra 驗收

官方 Claude Code 2.1.294／Claude.ai Pro／firstParty；原生 session `883e9102-21a7-4d80-839c-6663396f5aad`；實際assistant model為claude-opus-5-5。唯讀受限討論，提供完整本批 diff 與驗證摘要，不讀私人資料；不是讓另一模型執行K工作。

Opus結論沒有阻擋，支持根因修正／layout時序／既有偏好保留／最小範圍；提醒舊版保存recent所以不會自動變手動、切入manual不恢復舊manual。Astra獨立核對完整sortSessions、moveSessionOrder與IconButton：目前className正常覆寫；manual顯示維持pin優先。原有上移／下移會丟掉不在傳入可见清單的封存 ID，隨後補在尾端，因此**不宣稱所有取消封存情境都回原位置**；這是既有行為，未擴張本批去重做封存排序。已刪除ID保留亦不新增清理機制。

原始 opus-preflight.json、opus-identity.json、opus-events.jsonl、opus-reply.md、opus-result.json保留；Opus只複查給定packet，並非讀完整repo的審查。Astra不把模型結論替代built UI／自身diff核對。

## 正式部署狀態

**僅候選，未部署、未重啟／停止 K。** 本輪讀回正式runtime指標仍 `5762d48913ca185e68dad1709197ccfe47c7dc67`，沒有更改既有對話或儲存偏好；不打斷背景工作、不恢復／重播。不push、不更新東區。本文件複製工程根目錄供另一聊天室整合，但不搬覆整份程式或共同索引；是否正式套用另依閒置與協調結果記錄。

## 最後驗收追加（2026-10-09）

凍結程式4d621c5完整序列回歸（Node既有 `--test-concurrency=1`，沒有改測試／跳過個案）1079/1079，0fail／0skip，151.57秒；證據 full-tests-frozen-serial.log。前兩次併行的計時斷言失敗仍保留，**不宣稱併行全測穩定**。所有本輪built UI觀察與單元驗證通過；真正Opus複查無阻擋，Astra已獨立核對diff與實際結果。沒有藉併行失敗擴張修原生喚醒或永久改test runner。

本地候選完成；正式部署／使用者舊保存recent模式尚未改變。新默认只作用於未保存偏好，不能把預設修正誤稱本人現用K已改成manual。

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
