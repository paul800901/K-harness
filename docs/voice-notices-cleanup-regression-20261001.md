# 工程通知退至後台、原生語音接線修復與 R3-2 回查（2026-10-01）

## 範圍與狀態

使用者要求工程訊息不要佔據人類介面；隨後回報語音失敗，並明確要求關閉 K 後直接套用、啟動及比對上次清理有無功能喪失。來源為 `C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`，基準 `2e76523`；只部署本次前端修正，不整批覆蓋根目錄旧實驗來源。

## 根因與修改

- R3-2 的 `0df3bf7` 刪除內嵌瀏覽器 preload 的 `kBrowser.present`，但 `frontend/voice-composer.jsx` 仍用它判斷原生版。實際 preload 只保留 `onPageChanged/onWindowHidden`，故舊判斷為 false，誤走已知在 Electron 失敗的 Web Speech 路徑。這是清理造成的確定回歸，不是麥克風或本機 Whisper 壞掉。
- 語音產品只改一行：以仍存在、語音本身也使用的原生 `onWindowHidden` 接口判定。未恢復已移除的瀏覽器 API，不添加替代供應商、重試、常駐服務或付費路徑。
- `frontend/native-notices.mjs` 僅在呈現時濾掉 status、deprecationNotice、configWarning、windowsWorldWritableWarning、windowsSandboxReadiness、windowsSandboxSetupCompleted。保留通用未知 warning、guardianWarning、modelRerouted、nativeError；額度錯誤去重／繁中化、核准與登入流程不改。
- 原始通知仍在既有後端 `state.notices`；**這不是新增永久日誌**。原陣列最多 100 筆，切室會重設，目前沒有新 AI 通知查詢工具。此次沒有移植 Codex 分頁歷史協定，所以 deprecation 的來源仍待後续協定維護，不聲稱只藏提示就修好協定。

## 驗證

- 用真正 preload 建出的 bridge 計算舊／新原生判斷：**false → true**。自動測試同步覆蓋無 bridge 與非瀏覽器環境。
- 定向語音、HTTP、通知及視窗關閉：**28/28**；完整測試 **499/499**，0 失敗、0 略過；建置成功，僅既有 bundle 大小提示。
- 獨立、隱藏的 Electron：正式 preload + 建置 UI + 正式 HTTP 路由 + 本機 Whisper，使用既有合成測試 WAV，沒有真麥克風、帳號或聊天模型。實際輸出填在「原草稿保留」之後，包含「這是一段語音輸入測試。請保留原本的文字,不要自動送出。」；裝置循環亦帶出下一句開頭，不宣稱逐字準確度驗收。
- 同一原生 UI probe 通過停止不送出、取消不呼叫轉錄且保稿、失敗保稿且無送出。聊天模型呼叫 0 次。
- 通知建置 UI：六類工程通知無橫幅、空白區或確認按鈕；有意義警告/錯誤仍顯示；Claude 額度通知只有一條且為正體中文。不重送工作。
- 初期 probe 失敗如實保留：錯誤的 textarea selector、隱藏 Electron 截圖逾時、假錯誤預期未符合現有 HTTP 訊息整理。只改測試定位／移除非必要隱藏視窗截圖／修正預期，未改產品來迎合測試。最终以原生 DOM/文字讀回驗證語音結果，通知畫面另有 headless Edge 截圖並已檢視。
- 候選與正式 `local-dictation.mjs`／Python helper 為換行差異，`git diff --no-index` 無內容差異；preload 及 desktop-server 位元組一致。本輪不更動 ASR 後端。

證據在來源 checkout 的 `.runtime/voice-notices-20261001/`：`native-route-before-after.json`、`targeted-tests.log`、`full-tests.log`、`build.log`、`native-ui-1~4` 對應執行紀錄（第一輪名 `native-ui.log`）、最終 `native-ui-l7rS4p/result.json`。通知證據在 `.runtime/engineering-notices-20261001/ui/`。

## R3-2 清理前後對照

以 `0df3bf7^`／`0df3bf7` 與目前來源比對，並重跑現行完整測試：

| 保留功能 | 接線／驗證 | 結論與邊界 |
| --- | --- | --- |
| 桌面語音 | preload → hook → native PCM → HTTP → Whisper | 確認一處判斷失配，本次修好並實際跑通合成音訊 |
| 外部 Chrome | k-browser-assistant、owner registry、MCP、browser/state | 未找到被刪的 API 殘留 caller；移除的是內嵌頁面，不是擴充路徑；本輪無真 Chrome 操作 |
| Codex／Claude 主代理與 GPT 子代理 | native hosts、controller、luna bridge/gateway | 未找到指回已刪 DeepSeek/Pi 的執行接線；假 host regression 通過，未消耗真模型回合 |
| 草稿／引用 | response-annotations 與 composer 保存／送出 | 測試通過；語音草稿另有原生 UI 實測 |
| 工作區／停止／成果附件 | server routes 與 controllers | 相關假資料測試通過，未發現已刪 API 仍被呼叫 |
| 狀態串流 | 同版 server snapshot/patch → applyStateEvent | 同版匹配；新版 UI 不支援舊 bare-state backend，部署不混搭。通知 probe 的舊假串流亦已修正 |

目前只有語音是證據充分的功能斷路。這不是保證所有真實操作均無問題；未恢復使用者已決定移除的 DeepSeek/Pi、Sandboxie 執行、內嵌瀏覽器、舊 web。真麥克風／口音／長段收音待使用者日常驗收。

## 正式套用

**01:46 已正式套用並從原啟動入口重開。** 部署前確認 47831 無 listening、無正式 K launcher／Electron／Node 程序，沒有强制中止任何工作。

- 正式只更新兩個前端來源、一個新雜湊 JS、index 共 **4 檔**；CSS／圖片與現用檔完全一致。正式檔案逐一 hash 讀回相符。
- 備份：`D:\K-harness\.runtime\releases\voice-notices-before-20261001-014616`。舊雜湊資產保留；還原時正常停 K，把備份的 index／原有來源複製回去即可，新增但未引用的資產不需刪除。
- 收據：`D:\K-harness\.runtime\voice-notices-release-20261001\deployment-receipt.json`；正式 health 為 native、資料仍在既有 vault/private-state。正式 HTTP 200 回傳新 JS 785,317 bytes，SHA-256 `B6220B4C250F5B198C5AADD07FD51261CB41251173D84685E1EAFC4702E9F0D9` 與建置／部署一致。
- 原生正式視窗讀回：首頁、原有三個聊天室與額度顯示正常，沒有錯誤視窗，K 保持開啟。未代為啟用使用者麥克風、未送模型回合。正式本人收音仍待日常測試，不能把合成音訊等同真麥克風準確度。
- 主要測試與 UI 結果亦複製至上述 release 的 `evidence`，供正式 K 中的 AI 直接讀取；未複製登入或對話資料。
