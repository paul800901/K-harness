# Codex 原生容量處理與 Gemini 額度解析（2026-10-09）

## 現況／授權
- 使用者重新定案：只讓 Codex 原生核心負責重試／重連，撤銷 Luna→Sol 自動容量接續；不新增 K 層重送、接續回合或目標自動恢復。Gemini／Claude 執行重試不由此變更。
- 使用者允許額度百分比／reset 分離解析及週歸零摘要，要求真正 Opus 5.5 和 Gemini 討論。K 已由本人停止／關閉，本聊天室前批修正可驗證後一起更新。
- 工程基底已從 c5d605d 更新到當時正式 f5e9e266b677dbb9d4d330729fbc66fa9d674e53，保留新討論功能／既有額度抑制，不回退正式版本。舊未提交修正留 Git stash 作可還原紀錄。
- 候選：C:\Users\Paulus\.codex\worktrees\capacity-error-20261009\K-harness。證據：D:\K-harness\.runtime\capacity-error-20261009。
- 與「追查插話後最終回覆消失」聊天室協調：對方暫作單一部署者；本批固定版本、真複查與驗證完成後正常 Git 整合，不同時改正式 runtime。未恢復小說目標、重送工單、切帳號／權限／計費。此刻尚未部署／重啟／push／更新東區。

## 一、Codex 根因與最小變更
- 10/9 04:32:54 thread 01a11781-3936-7bd3-85ff-f18c5e987da5、turn 01a11d37-ca46-72b2-ae52-c2b209613e43 原生回報 failed／serverOverloaded，英文 Selected model is at capacity. Please try a different model.；模型 Sol／medium，不是 quota 用完。
- 原生 thread/read 讀回有 completed commandExecution，失敗不等於沒有成果。只讀 reader 未 resume／turn/start；小說內容及189/190工單不改。
- 原生 goal 失敗時 blocked；K Sol 支線未寫 blocked，獨立原生也讀到 blocked。後續04:59讀到paused，是外部狀態變更，非本批操作；內部精確轉換 trace 未取得。
- HTTP同turn兩筆200並非503證據、也不能拿來推論重試次數；未保存原始敏感headers。回合未提供 Retry-After，沒有證據可還原此次原生所有內部重試。
- 刪除 continueAfterCapacity／applyCapacityModel 與相關 task/start/handled、goal快照、pending/gate；不改原生模型／重試設定或 core。原生 willRetry 通知仍沿既有顯示／去重，最終failed保持原生error；用完整原生TurnError呈現繁中分類及按需原文，不假定容量恢復時間。
- 前一候選的「重開歷史失敗警告」及 work-status分類已放棄，避免舊快照覆新結果／搶questions優先序，不另增歷史旗標或可用性推算。既有 historical modelChanges 與容量系統事件 renderer保留，讓已保存對話繼續可讀。
- 測試發現工人完成通知的 native turn/completed 可早於 turn/start acknowledgement。既有交付ack會把已失敗回合重新標working並要求interruptfinished。最小修正只讓ack補ID，不覆原生已結束狀態；通知仍精確綁交付回合，不重送工人／結果。
- 保留使用者明確 goal_resume 與原生 status-only契約；本輪不操作真目標。

## 二、Gemini 額度
- 同批04:56查詢保存第一帳號週0／五小時100，第二帳號只有週0；100不是K缺值預設，—是沒有保存five_hour。未取得當時raw stdout，不能宣稱第二筆缺欄實際根因已查明。
- 假資料確認 geminiQuotaWindows 原本要求reset有效才保存百分比；缺／非法reset會丟掉合法100%。現在保留合法0~100百分比，未知reset=null；不編造時間，不改已知重設時間或percent。
- 帳號摘要只在既有quotaIsHistorical=false且有實查時間時顯示「上次實查：每週額度已用完」，失敗／離線／跨reset歷史不顯此新標籤。週0與短100並存，不改成雙0，不合併額度。
- quota-zero.mjs／gemini-accounts.mjs及帳號切換／派工邏輯未改；null reset仍依原契約不能抑制至某個捏造期限。沒有新增可用性模型、按鈕或設定。

## 三、真正模型意見與驗證
- 前輪容量候選兩次 genuine Opus：8ed8c7c6-e670-4aef-bc4a-e3cfb4400e05、4b8ecf08-8067-4bdc-9fc2-e7dfb5ee9384，正式claude-opus-5-5／Claude.ai。第二查的歷史警告／競態／狀態優先問題，透過刪除未部署功能而非新增狀態處理。這兩次不當作本輪撤fallback與Gemini修改已複查。
- 本輪Opus討論先遇官方 You've hit your session limit · resets 6:30am (Asia/Taipei)；沒有意見可用，不換模／API計費，也不把結果標成功。證據 quota-discussion/opus-events.jsonl。06:30前不重查；本輪真正 final code review待完成。
- Gemini 實際gemini-3.8-flash-high／Antigravity1.3.1，原生session 3ce08b3e-ec2f-4343-a8fd-ccc1369e446e、結果completed。支持解耦百分比/時間，保留原值，摘要綁實查時間並排除歷史／失敗；指出paul缺欄原因未知。沒有帳號切換或真工作區內容傳入。
- 新定向44/44，最終簡化fixture18/18，完整單程序1060/1060，build通過（既有>500k chunk警告保留）。前輪1013/1013是旧候選，不當本輪結果。
- built UI 1920／390：容量／quota／未知錯誤、單一通知、原文JSON；週0/短100/未知reset與歷史標籤消失，零POST，通過。手機截圖已視查，百分比與週歸零說明清楚、未知時間顯示官方未提供。
- 保留失敗證據：最初相依指向舊root缺assistant-ui，改借既有正式相依，不安裝套件；前輪空state明細crash已修存在判斷；前輪並行既有40ms時序失敗保留；本輪移除fallback後交付ack競態已修且測試通過；fixture精簡第一次漏移除failStart變數造成測試自身ReferenceError，補移除後18/18；UI手機未展開側欄不能找到用量按鈕，修測試操作後通過。未以放寬assert掩蓋產品失敗。

## 修改與未完成
src/desktop-controller.mjs、src/gemini-login.mjs；frontend/main.jsx/native-notices.mjs/native-ui.jsx/style.css/usage.jsx/quota-display.mjs；test/codex-capacity-fallback.test.mjs/native-notices.test.mjs/gemini-login.test.mjs/quota-display.test.mjs；AGENTS.md、README.md、本文件與工程索引。

尚待真正Opus5.5本輪複查、處理實證問題、兩邊固定SHA整合、整合驗證、部署者核對無工作及保留退版後正式讀回。沒有宣稱OpenAI容量修復或Google原始缺欄原因查明。不推論Gemini／Claude從來不會容量不足；本輪Codex執行變更只限Codex。

原生策略參考：[0.161.0官方原始碼](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/protocol/src/error.rs#L363-L425)、[官方config](https://learn.chatgpt.com/docs/config-file/config-reference)；Google週／短期限額分開，見[官方plans](https://antigravity.google/docs/plans/)。不是把一般串流5次套成這次容量錯誤5次。

## 本輪正式更新已完成（2026-10-09 06:50 臺灣時間）

本人後續明確允許與另一邊一起更新，取代本文件前面「修好先停」的當時部署限制。整合後固定程式為 `5762d48913ca185e68dad1709197ccfe47c7dc67`；真正 Opus 5.5 整合及 P2 收尾複查通過，固定低並行1077/1077、各項built UI通過。變更、原意見、失敗與驗證見 [整合收尾](sidebar-ux-fix-20261009.md)。

南區正式已套用此 SHA；程式／啟動器退版在 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791499740190`，不是對話資料快照。替換前後97233個既有檔案byte hash未變，非版本欄設定未變。真正正式 owner／登入後 built UI讀回通過：20聊天室、無不可讀、served資產與正式disk一致，0工作POST、無選取聊天室、既有事件投影未改；正常關閉後K仍停止。沒有恢復原業務、翻譯目標、派工或帳號切換。

本人Electron／手機實機體驗尚待日常使用；新功能行为證据是固定candidate真built UI，正式讀回不冒稱已重跑原業務。東區未更新。GitHub暫未push／tag：本版包含先前2026-10-08明確no push候選，本轮只明確一起更新本機，保守不以一般發布SOP默認撤回该限制；本機更新不因此延後。
