# 已完成 Luna 歷史工作阻止停止：修正與驗證

## 根因與邊界

`thread/read` 可讀取未載入的原生歷史；`thread/backgroundTerminals/list` 只適用目前 host 已載入的工作。原本 bridge.close 對所有歷史紀錄呼叫 cancel，再無條件查背景命令；notLoaded 工作因此收到 thread not found。catch 又把已完成結果覆寫為 unresolved，最後關閉請求失敗。啟動器忽略停止失敗並繼續 StartK，造成第二則「已在執行」通知。

官方契約：https://learn.chatgpt.com/docs/app-server （Read a thread、Clean background terminals）。本機正式 Codex executable 的唯讀探測亦重現兩種 API 的差異。

## 本次程式差異

- `src/luna-bridge.mjs`：cancel 在驗證 thread 身分與 workspace 後，對 notLoaded 要求最新回合與紀錄 turnId 相符、明確 completed/interrupted/failed 且無 inProgress。符合才保存原生結果並返回，不 resume、不重送、不呼叫 loaded-only terminal API。未知、錯誤歸屬與未完成仍阻擋。已載入工作仍完整清理背景命令並讀回。清理失敗寫 cleanupError、保留工作結果並拋錯，成功重試清除 cleanupError。
- `src/claude-controller.mjs`：關閉失敗顯示實際錯誤，不再只顯示泛稱子代理停止未確認。
- `local-launcher/KTrayLauncher.cs`：StopK 回傳成功與否；停止失敗不重啟、不退出啟動器；連接埠未釋放不启动；HTTP 錯誤讀取後端 error 內容。
- `test/luna-bridge.test.mjs`：新增未載入完成歷史、未知/執行中/錯誤回合/錯誤工作區，以及已載入背景查詢失敗保留結果與重試的回歸測試。

## 證據

- 全套 255/255 通過：`.runtime/shutdown-diagnosis-20260924/all-tests.txt`。
- 原生工作副本測試：`.runtime/shutdown-diagnosis-20260924/fixed-1790246143313/evidence.json`。修正後 close 成功，正式紀錄 SHA-256 前後相同；沒有 turn/start、resume、interrupt 或 clean。
- 啟動器 C# 編譯成功，隔離候選：`.runtime/shutdown-diagnosis-20260924/KLauncher-fixed.exe`，不是正式安裝位置，勿直接從該路徑使用（啟動器以所在位置推導專案路徑）。
- 實際 RestartK 方法的相依項替身測試：`.runtime/shutdown-diagnosis-20260924/LauncherProbe.cs`、`LauncherProbe.exe`。停止失敗不啟動、連接埠仍占用不啟動、停止確認後只啟動一次，3/3 通過。這不是正式桌面 UI 驗收。

## 狀態

已修正並完成本地／隔離原生驗證。未強制關閉正式 47831，未修改正式工作紀錄，未替換執行中的啟動器、未部署或 push。舊程序尚未載入本次修正，因此不宣稱正式卡住狀態已恢復。不得只把正式 JSON 改成 completed 來繞過停止檢查。

## 後續正式恢復（取代上段部署狀態）

使用者另行明確同意確認工作結束後，終止僅屬舊 K 的殘留程序並恢復。實查舊 37224 後端仍占用 47831；六筆工人的原生最新回合皆 completed，主代理 busy=false。核對程序身分與建立時間後，終止該 K 的程序樹，確認連接埠釋放，再以專案啟動腳本啟動修正版。

- 已備份舊啟動器到 `.runtime/shutdown-diagnosis-20260924/launcher-before-install.exe`，重新編譯並安裝至 `local-launcher/dist/K桌面啟動器.exe`。
- 補修 Claude open：舊連線清理成功前不清空 host；清理失敗保留連線供重試，不在 catch 重複清理或遺失控制權。新增失敗後重開回歸，全套 256/256 通過。
- 正式 `/api/open` 已恢復「第一次開工」，原 threadId 不變、status=ready、busy=false、error=null、40 則訊息。未呼叫 send/steer，未重送任何訊息。
- 證據：`pre-recovery-workers.json`、`recovery-processes.json`、`formal-reopened.json`、`reopen-all-tests.txt`，皆在 `.runtime/shutdown-diagnosis-20260924/`。
- 後續正式正常停止／再次重開的驗收命令被工具政策拒絕，沒有執行；未繞過。因此確認的是正式連線恢復，不宣稱正式正常停止循環已驗收。新版系統匣啟動器已安裝，但本次尚未啟動。
