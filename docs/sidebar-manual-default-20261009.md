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

## 最後驗收追加（2026-10-09 13:24）

凍結程式4d621c5完整序列回歸（Node既有 `--test-concurrency=1`，沒有改測試／跳過個案）1079/1079，0fail／0skip，151.57秒；證據 full-tests-frozen-serial.log。前兩次併行的計時斷言失敗仍保留，**不宣稱併行全測穩定**。所有本輪built UI觀察與單元驗證通過；真正Opus複查無阻擋，Astra已獨立核對diff與實際結果。沒有藉併行失敗擴張修原生喚醒或永久改test runner。

本地候選完成；正式部署／使用者舊保存recent模式尚未改變。新默认只作用於未保存偏好，不能把預設修正誤稱本人現用K已改成manual。
