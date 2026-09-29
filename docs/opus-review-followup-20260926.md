# Opus 複查後三項收尾（2026-09-26）

## 授權與範圍

使用者明確授權自主完成 K 修復；本輪限定處理 `opus-review-local-voice-20260926.md` 的異常關閉、可信主介面媒體權限、可信程式區寫入隔離實測。先做本機／獨立候選驗證，再依既有授權保留還原版本、確認正式 K 沒有工作後更新與重啟。

- 不使用真麥克風／攝影機、不讀原錄音／逐字稿／登入資料，不改其他專案、全域環境、帳號、計費或 Sandboxie 政策／ACL。
- 寫入試驗只使用新命名假資料：一般工作區作成功對照，`trusted-runtime` 內新建假檔與預建假檔作保護目標，不改任何正式程式檔。
- 新讀回發現正式 K 已有另一輪 Opus 官網審查正在執行，因此不中斷、不重啟、不操作該瀏覽器；部署前重新核對。
- 額度用於修復、回歸和獨立覆核，不增加無產出的工作。

## 已修正

1. `src/desktop-server.mjs`：關閉改為單次進行、逐項收集失敗、只記住已成功關閉的元件；失敗的元件可再試。辨識程序未確認退出時仍關閉其餘元件，回報 503，保留健康／狀態與重試入口並拒絕新工作，不宣稱整體已關閉。`src/local-dictation.mjs` 只增加可注入的停止期限以測試，正式預設仍為五秒，不提前釋放 child lock。
2. `src/electron-workbench.mjs`：可信 owner session 設 request、check 及 display handlers。只放行 owner 同源主框架的純音訊，拒絕鏡頭、混合音訊／影像、螢幕擷取、剪貼簿讀取及其他權限。實測發現一律拒絕會破壞原本「複製」功能，因此另外只允許 focused owner 同源主框架的 `clipboard-sanitized-write`；沒有開放讀取。Electron callback 沒有 userGesture 欄位，不能宣稱此 handler 獨立證明使用者手勢。依據：[Electron Session](https://www.electronjs.org/docs/latest/api/session)。
3. 複查追加的直接相關問題：X 只隱藏視窗時，收音可能繼續。`src/electron-owner-preload.cjs` 接收專屬 `k-native-window-hidden` 訊號，`frontend/voice-composer.jsx` 取消錄音或待完成轉錄，保留原稿、不送出；不因一般失焦或切換應用程式取消。Workbench 在隱藏前發送；後台模型工作仍維持原語意，不因關視窗停止。

## 驗證

- 主代理循序全套 **544/544 通過**，0 失敗、0 跳過，143.19 秒：`.runtime/opus-followup-20260926/full-regression.txt`。五個產品來源檔測試前後 SHA-256 一致，基準 `source-test-baseline.json`。主代理另跑關閉定向 **11/11**。
- 新增 `test/electron-workbench-permissions.test.mjs`、`test/voice-composer-window-hidden.test.mjs` 並擴充 `test/local-dictation.test.mjs`；後者驗證不退出的 fake child、保留 busy lock、晚退後重試、其他組件關閉、503 與新工作 gate。
- 新 UI build 在 `.runtime/opus-followup-20260926/build`；僅既有大 bundle 提示，建置成功。
- 真原生獨立候選 **11/11**：`.runtime/voice-repair-20260926/ui-probe/evidence/ui-probe-2026-09-26T12-47-02-292Z.json`，對應 `candidate-state-2026-09-26T12-47-02-292Z/native-voice-ui-evidence.json`。使用 fake-device/file，**移除 fake-UI permission bypass**。實際純音訊 request 獲准；真實 fake-device camera-only 與 mixed getUserMedia 均 `NotAllowedError` 且 handler 讀回拒絕；真 Whisper HTTP 回填草稿、不送模型。X 關閉使 tracks ended、保留草稿且未送轉錄／模型。複製按鈕顯示成功。
- 同源／外部 iframe 和 display 是 handler 測試，不冒充真 iframe 或實際桌面擷取測試。未啟動真麥克風／攝影機，也未驗真實噪音、口音或長段準確度。
- 主代理另看最終候選截圖：`real-whisper-filled-draft.png` 沿用舊檔名，實際是最後 X 隱藏／重開後的 `X_HIDE_DRAFT` 與取消提示；不可把這張圖當成 Whisper 回填當下畫面。真 Whisper 流程由該次 JSON 與測試斷言作證。
- 複製回歸把假字串 `VOICE_QUOTE_SEED 可供本機聽寫測試。` 寫入系統剪貼簿；未讀取原剪貼簿，因此沒有擅自回復其原內容。

## 可信程式區實測

20:48 正式官網回合已不再忙碌後，主代理執行經審查的一次性 `scripts/probe-sandboxie-trusted-runtime-write-once.mjs`。證據：`.runtime/isolation-pilot/trusted-runtime-write-20260926-review-01/result.json`。

- 盒內 PID 3808 已核實屬 KCandidate1；有效 OpenFilePath 在開始、寫入當下、結束均包含 `D:\K-harness\*` 且一致。
- 一般工作區假檔寫入成功，host 讀回相符。
- trusted-runtime 新假檔建立及本輪預建 canary 覆寫皆 **EPERM**；host 新檔不存在、canary 原值未變，並非只因虛擬重導向而看不見。
- 原有五個 PID 前後保留、Sandboxie.ini hash 不變。無 box 停止、設定／ACL 更改、真程式覆寫或秘密內容讀取。假資料原處保留。
- 證明範圍是本次 KCandidate1 的建立／覆寫拒絕，非所有 box、任意路徑、刪除／改名或所有隔離攻擊都已測過。

## 保留的失敗與限制

- 第一版 owner deny-all 使複製失敗；早期 probe 的 fake-UI 開關也會跳過 permission handler。已據實修正並重新測，早期 evidence 保留，不當作最終通過。
- 一位代理在來源修改期間跑定向測試，截斷輸出有三項失敗且遺失執行 session ID，不能找回完整診斷或判定根因。其 PID 31300／11460 經完整命令與建立時間核對後，只停止這組遺留 fake 測試；程序讀回存於 `.runtime/opus-followup-20260926/abandoned-test-processes.json`。不將後續主代理全套通過倒寫成該輪通過。
- 對斷線 response 寫入可能異常的另一項建議，未取得實際錯誤；現有取消測試與完整回歸通過，因此沒有為推測另加修補。

## 正式部署

**22:49 已與新版註解介面合併部署，22:50 原捷徑重開、22:51 正式讀回完成。** 四個後端／原生檔與本篇來源 baseline 一致；voice-composer 視窗隱藏取消邏輯一併包含於最新 build-v3。使用者要求「重啟套用」後，核對正常退出、無程序及無正式 port listener，先備份再更新 12 個目的地。工具啟動被 policy 拒絕後，使用者親自開啟 K；沒有繞過或強制終止。隔離健康、原對話、正式 JS hash 和新版引用入口均已讀回。

完整收據、備份 `annotation-combined-backup-20260926-224928` 及還原方法見 [合併部署與正式驗收](annotation-popover-20260926.md#2249-合併部署與-2251-正式讀回)。本篇 **544/544、11/11** 為當時實測；合併版凍結來源另有 **549/549、12/12 註解 UI**，不把假音訊或本次啟動當成真麥克風端到端驗收。

### 前輪未部署原因（歷史）

前輪完成實作與候選驗證時仍未部署。`.runtime/opus-followup-20260926/deploy.ps1` 當時只準備好、沒有執行；現在它仍指向較早 UI，**不能用來覆蓋最新註解版本**。本次實際使用 `.runtime/annotation-popover-20260926/deploy-combined.ps1`。

正常完整停止入口是系統匣「停止 K」／「離開並停止 K」：由原 launcher 的私有 stdin 傳 close，等 owner services、瀏覽器儲存 flush、pool、視窗及 Electron 完成關閉。現有 Computer Use 只列出 K 主視窗、ChatGPT 與 Chrome，沒有可操作的系統匣；已核對正常入口和公開工具，未取得其他正常停止方式。

主介面「停止後端」只有 HTTP／controller 關閉，不能替代整個原生外殼的關閉；所以前輪沒有點它製造半關閉狀態，也沒有擷取 cookie、私有 pipe handle、新增控制後門或強制終止正式 K。當時保持原對話開啟並等待正常停止。後續正式部署／重啟狀態以上方 22:49–22:51 紀錄為準。
