# 原生瀏覽器正式更新紀錄（2026-09-26）

## 最新狀態

2026-09-26 18:20（臺灣）：**正式 K 已從原系統匣啟動入口成功開啟，正式健康狀態及非空白原生視窗已讀回。** 啟動失敗的直接根因和修正如下。正式網頁操作仍以前輪候選的限定互動證據為準，本次沒有新增真實網站登入或模型回合。

### 18:12 啟動失敗與 18:20 修復

- 實際紀錄：18:12:47 啟動後，18:14:48 回報省略的 stderr；3 個 Electron 程序存在，但沒有 K 視窗、47831 服務及 `vault/native-shell`。不是「沒有瀏覽器」或使用者操作錯誤。
- 直接根因：正式 CJS 入口使用 `require.main === module` 判斷自動啟動。Electron 44.4.5 的 default loader 擁有 `require.main`，實際值 filename=`electron`，即使直接執行 K 的入口該判斷仍為 false，`startNativeOwner()` 根本沒呼叫。最小 Electron 實測證據：`.runtime/electron-cache/entry-identity-probe.json`。
- 前輪測試缺口：entry/model fixture 引用模組後直接呼叫 `startNativeOwner()`，繞過了正式入口的自啟動判斷；所以候選成功沒有涵蓋這個錯誤。沒有將這次失敗歸咎於環境。
- 修正 `src/electron-isolated-main.cjs`：改為以 `process.argv[1]` 的正規化路徑判斷是否直接執行該檔；fixture 引用不自啟。Electron app 物件在模組載入時取得，避免初始化前的 close／disconnect 因 app 尚未賦值而無法退出。
- 停止舊失敗程序前，確認 8 個 Sandboxie 盒全 idle、47831 無服務，並核對 PID／父子關係／執行檔。僅終止卡住的 Electron main 35656；所屬 2 個 helper 與 Node 30888 一併退出，原系統匣 3012 保留。沒有停止其他 Node、模型、工作或桌面應用程式。
- 本輪修改檔案僅上述 main、`test/isolated-launcher.test.mjs`、新增 `test/electron-entry-dispatch.test.mjs` 及工程文件；沒有手動改隔離政策、憑證、帳號或計費設定。
- 測試：主代理重跑定向 **13/13 通過**（`.runtime/electron-cache/startup-entry-fix-focused.log`）；VM 執行實際主模組，覆蓋 Electron loader dispatch、fixture 不自啟、初始化前 close／disconnect。真正 Electron 直接執行主入口但無 private supervisor 時於 133ms 退出，沒有服務啟動（`.runtime/electron-cache/entry-disconnected-probe.json`）。本輪未重跑全套，原 513 項不宣稱是這次版本的全套結果。
- 正式部署：覆寫前保留 `vault/native-entry-fix-backup-20260926-1818/electron-isolated-main.cjs`，詳細時間、原檔及新檔 hash 在同目錄 `deployment.json`。正式 main SHA-256：`744f04a90ea8da2c8fec70a08c3b977d45010c5d329da78f72ccf55cc135e823`。亦同步修正獨立候選副本，沒有改 launcher EXE 或重新安裝套件。
- 與使用者相同入口實測：18:20:28 原系統匣啟動 Node／Electron，18:20:31 記錄 `native isolated workbench ready`；本輪啟動命令成功執行，沒有繞過前輪工具拒絕或切换成另一種啟動途徑。47831 回報 `app=k-harness-desktop`、`deployment=isolated`、workspace 精確等於既有 `vault/private-state`。
- 原生 K 視窗 PID 32956、window handle 1770630；主代理擷取並查看實際視窗，首頁、原有 K-harness 工作區與對話可見。證據 `.runtime/electron-cache/formal-native-startup-20260926.png` 及同名 JSON。保留正式 K 執行中供使用者使用，不再停止。
- 正式執行後，既有工作區準備流程會依已登錄的工作區更換各盒 `OpenFilePath`；觀察到部分盒改為使用者既有的 `D:\K-harness\*`。因此整份 `Sandboxie.ini` hash 已改變，不能把前輪靜態 hash 當成執行期間的不變條件。已重新讀回 8 盒：人類入口 47831／47971 阻擋、vault／使用者目錄／秘密與舊 browser profile 拒讀、降權、剪貼簿限制與唯一 agent pipe 規則均仍存在，所有 OpenFilePath 都屬既有基準或已登錄工作區；讀回當下 hash 與檢查結果保存在正式 JSON。未手動還原或覆蓋運行中的設定。
- 舊版完整回復位置仍為下方 17:24 備份；本次 18:20 小備份保留的是「入口有錯的原生候選」而非建議恢復版本，不應直接還原該錯誤入口。

### 17:24 更新歷史

2026-09-26 17:24（臺灣）：**正式檔案已更新並核對雜湊，啟動尚未完成，不能宣稱正式驗收完成。**

- 更新前 K 系統匣啟動器未執行，47831／47971 沒有 listener，KCandidate1–8 全部 idle。
- 完整候選互動、雙模型與 Sandboxie 假資料隔離證據見 [候選驗證紀錄](native-browser-candidate-20260926.md)。主代理已看過最終 1000px 與 1920px 原生視窗截圖。
- 正式啟動動作在執行前被工具 policy 拒絕，沒有執行 `Start-Process`。後續只讀確認仍無 K 啟動器及服務。沒有改用另一個工具或命令繞過；已請使用者從原桌面捷徑開啟，再做正式健康狀態及畫面讀回。

## 實際更新與還原版本

可信執行目錄：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\trusted-runtime`。

備份：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\native-browser-deploy-backup-2026-09-26T09-24-27-863Z`。該目錄的 `deployment.json` 列出每個覆寫檔、來源／目標、原檔備份及前後 SHA-256。

- 新增 7 個來源：`electron-browser-views.mjs`、`electron-scoped-context.mjs`、`electron-workbench.mjs`、`electron-owner-preload.cjs`、`electron-isolated-main.cjs`、`electron-isolated-launcher.mjs`、`electron-download.mjs`。
- 更新 6 個來源：`browser-live-session.mjs`、`browser-mcp-stdio.mjs`、`browser-owner-gateway.mjs`、`desktop-server.mjs`、`isolated-launcher.mjs`、`owner-browser-registry.mjs`。
- 同步專案的 `package.json`、`package-lock.json`，複製已驗證的 K 專案內 Electron 44.4.5 至可信執行目錄；未再安裝套件或修改全域。
- 將本輪編譯完成的系統匣啟動器更新到 `D:\K-harness\local-launcher\dist\K桌面啟動器.exe`。
- 最新 `.runtime/electron-native-ui` 的 13 個檔案逐一雜湊比對後，同步至可信執行目錄和專案根目錄的 `dist-ui`。舊資產未刪除；舊的兩份完整 `dist-ui` 另有備份。
- 正式 `private-state` 在相同 vault 內備份供還原；未搬移 `agent-home` 的既有官方登入資料或瀏覽器 profiles，未更改其他專案。

正式 UI index SHA-256：`3919470bb2ad2706863003bdd4d0477303d8fe712dfaddfbae42d3c9e4145a04`。

Electron 執行檔 SHA-256：`bd14928e0728366fd3f41499cb398ff3f4304dab259a3e605077899a6f8c748e`。

更新後 Sandboxie policy SHA-256 仍為 `12d9e6e0398ec4a7bf3c6c29af84b067bc319de22f313ca7a5904864d25cdc2e`；本輪未放寬 ACL、Sandboxie 或 Windows 安全設定。

## 還原方式

先正常停止 K 並確認沒有工作、待核准或未結束的盒內程序。依備份 `deployment.json` 將有原檔備份的來源、package／lock 與啟動器覆回原位置，還原兩份 `dist-ui`；未使用的新 Electron／來源檔可原處保留，不必刪除。舊啟動器只使用原有的**隔離版**啟動路徑，不回到未隔離 host。`private-state` 僅在有確切資料損壞且確認不會覆掉更新後使用者工作時才還原，不隨程式回退直接覆蓋。

## 接續驗收及限制

- 正式啟動與非空白原生視窗已於 18:20 完成；本輪只處理啟動故障，沒有替使用者送出模型工作或登入其他網站。
- 候選已以真 Claude／Codex 各兩回合驗證官方 MCP 操作與人工輸入接續；人工事件由測試程式送入原生網頁，不是使用者本人操作。
- 沒有登入其他真實網站，不宣稱所有 OAuth、CAPTCHA、網站限制均可通過。
- 最終 14 項真 UI 檢查通過；有一次已關閉 popup 的延遲 present 請求被拒，沒有主程序崩潰或錯誤對話框。1000px 仍沿用原有的浮動右側面板，不在本輪重做版面。
