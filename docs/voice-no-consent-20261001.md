# 個人本機聽寫：移除重複同意（2026-10-01）

## 使用者要求與根因

使用者指出 K 供本人使用，重開後又要確認聽寫沒有必要；隨後回覆「已經關掉了，你可以試，都把它弄好」，可在驗證及停止查核後正式套用。

K 原本把本機聽寫同意寫在 sessionStorage，每次重開視窗／程序會失去暫存。共用語音 hook、主輸入框與引用註解三處都先查同意，再開始聽寫；這是 K 自加確認，不是 Windows 麥克風權限或 Whisper 必要步驟。

## 最小處理

- `frontend/voice-composer.jsx`：本機路徑不查同意儲存；保留瀏覽器 Web Speech 同意（音訊可能交外部供應商），移除不再使用的本機同意 key。
- `frontend/main.jsx`／`frontend/response-annotations.jsx`：主輸入與註解本機聽寫先取得既有麥克風互斥鎖後直接開始；刪除走不到的本機同意文案。沒有改為永久記憶同意、沒有新增設定或按鈕。
- 原生同源／僅 audio 的麥克風授權、系統權限、停止／取消、切室／隱藏取消、5 分鐘上限、草稿歸屬與本人按箭頭才轉錄後送出均維持。未改登入、模型、計費或語音辨識方式。
- `test/voice-consent.test.mjs` 新增 3 個回歸，涵蓋本機重開、瀏覽器仍需同意、兩個入口的互斥鎖；`test/voice-composer-ui-probe.mjs` 改測直接開始及全新 Electron 程序／儲存仍免確認。

## 驗證

- 未修版新增測試 **0/3**；未修版實際原生 UI 顯示一個本機同意區，免確認斷言 **1 ≠ 0**。原失敗日誌保留，沒有用失敗結果部署。
- 定向回歸 **33/33**，含語音取消、原生權限、註解歸屬及互斥鎖。
- 完整來源測試 **512/512，0 fail／0 skip**，36.73 秒；UI 建置成功（7.93 秒），只有既有 bundle 大小提示。
- 以現用 runtime 複製並僅覆蓋本次檔案的候選完整測試 **512/512，0 fail／0 skip**，35.03 秒。
- 隱藏 Electron＋真正 preload／HTTP／本機 Whisper，用既有合成 WAV，沒有真麥克風或聊天模型回合：直接點聽寫即錄音、停止填入保留的草稿、取消不呼叫轉錄、辨識錯誤保稿且未送出均通過。另關閉並建立全新 Electron 程序與全新 userData，再點聽寫直接錄音、沒有同意框，取消後轉錄呼叫 0。
- 本輪明確以既有 `.local/runtime.json` 的 Whisper Python／模型路徑設定 probe 環境，不冒用未配置的預設環境；只借用既有程式與模型，不讀其他專案原錄音。
- 實體麥克風準確度與另一台電腦未重測；未宣稱已改用 Windows 語音。

### 正式目錄補驗與未處理事項

- 套用後於 `trusted-runtime` 額外重跑完整測試：**511/512，1 fail／0 skip**，33.80 秒。唯一失敗是既有 `test/isolated-launcher.test.mjs:35` 的「launcher defaults to the module candidate」：測試把程式目錄當成候選根；正式安裝時程式在 `trusted-runtime`，既有實作刻意回到上一層候選根。測試期待多一層 `trusted-runtime`，不是聽寫失敗。
- 該測試及 `src/isolated-launcher.mjs` 均與上一版逐位元一致，證據雜湊見 `formal-file-readback.json`。來源／準備候選的 512/512 不能冒稱正式目錄全過；此舊測試的安裝目錄假設記錄保留，不為本次聽寫小修更動無關測試或啟動規則。實際正式啟動與資料位置另外讀回正確。
- 正式 runtime 的 UI／preload／本機 Whisper 再以隱藏假資料外殼實測 **6 項全過**：直接聽寫、合成 WAV 真辨識、停止不送出、取消保稿不轉錄、辨識錯誤保稿、新程序及全新儲存仍免確認。沒有操作使用者實體麥克風或送聊天模型工作。

證據：`D:\K-harness\.runtime\voice-no-consent-20261001` 內 `before-tests.log`、`before-native-ui.log`、`after-tests.log`、`build.log`、`after-native-ui.log`、`full-tests.log`、`prepared-tests.log`、`formal-tests.log`、`formal-native-ui.log`。真 Whisper probe 結果另在維護樹 `.runtime/voice-notices-20261001/native-ui-O0wikI/result.json`；正式 runtime 的假資料結果在 `.runtime/voice-notices-20261001/native-ui-tnp08B/result.json`。

## 正式狀態與還原

程式來源本機 commit `ad1fa984329a22e624cd41de1391d71cbcd017a9`。本次聽寫部署完成時尚未 push，沒有移動 GitHub 的 k-r3-git-20261001b。之後使用者另行明確授權為東區發布最新修正與文件；2026-10-01 23:45 已發布新標記 **`k-r3-git-20261001c`**（固定 commit `50ee11e1b11358e1c93d7ee62d71938ea471e370`）並完成遠端／乾淨下載讀回。詳見 [發布紀錄](r3-git-release-c-20261001.md)，不把本機部署當成 Git 發布，也不再次部署或重啟 K。

使用者已停止 K，2026-10-01 22:47:14 查核 47831 無 listener、無正式 K 自有程序；斷線後先讀回既有進度與停止狀態，沒有重送已完成的更新交易。22:58:45 透過既有 `activateRuntime` 交易完成套用，版本為 `ad1fa984329a22e624cd41de1391d71cbcd017a9`。

- 可還原上一版：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1790866725325`，含完整舊 runtime、啟動器、入口與設定；設定 `previous` 已指向此處。需要退程式時，先離開並停止 K，再依 [Git 安裝更新說明](git-install-update.md) 退版；不還原對話。
- 一次性候選準備誤把維護樹累積的舊 UI 資產一起複製，啟動正式 K 前讀回時發現並修正。僅把本輪新增且未引用的 **203** 個資產移至證據目錄 `extra-assets-not-deployed`，逐一核對來源／目的絕對路徑及雜湊；未刪除，也未移動舊正式資產。最後只保留原有 3 個資產及本次新 JS（共 4 個），清單與讀回見 `asset-scope-correction.json`。未再次執行套用交易。
- 3 個前端檔、2 個測試檔、UI index 與新 JS 對照來源一致；其餘 **14,882** 個原有檔案對照上一版一致（舊測試暫存不配送，完整原 runtime 仍保留）。完整測試寫入的原生訊息診斷已還原原值；Node／語音位置、啟動器及入口不變，不替換對話、帳號、瀏覽器與工作資料夾。
- **23:10:38** 從原 `Start-K-Desktop.ps1` 啟動，正式 Electron「K 執行中樞」視窗、啟動器→Node→Electron 程序歸屬、47831 listener 與 `/health` 的 `native`／既有 `vault/private-state` 位置均讀回正確。**23:11:05** HTTP 讀回本次 index 引用的 JS／CSS／logo 與檔案逐位元一致；未登入的 `/`、`/api/state` 仍為 403，未繞過原生入口授權。
- 根目錄舊實驗程式不整批覆寫；前一輪僅文件整理沒有整批帶入正式程式。新紀錄及本次索引條目另行同步，不搬先前 README／AGENTS 等文件。

正式狀態：**已更新、已重開、檔案／HTTP／程序讀回完成**。不以假音訊通過冒稱實體麥克風、新電腦或全部功能驗收。部署與讀回證據：`deployment.json`、`asset-scope-correction.json`、`formal-file-readback.json`、`formal-start-readback.json`、`formal-http-readback.json`。
