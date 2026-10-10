# 2026-10-10 聊天室更新鎖／切換回跳修正與原生錯誤補查

## 結論與授權

本人要求現在修好 K，並最新明確說「先測試和修正；K 正在做一件事，等等我關」。本輪只在獨立候選修正／驗證，不停止、重啟、套用正式 K，不重送小說、不恢復目標、不 push／更新東區。正式版本現讀回為 `1a45a73440a5f948c5cec625de02340863b7c67d`；從該版本建立候選，沒有從較舊且已有修改的主工作區覆蓋正式版。

**已修候選：** 背景閒置檢查阻擋純查看、回跳，以及第一轮 Opus 找到的「非導航操作後被舊閒置檢查誤關」競態。
**未修／未證明：** 三間原生串流錯誤的共同根因、長期壓縮造成記憶漂移的因果、Pick Me Up 當時實際持鎖者。相同錯誤不等於同一根因；候選路徑重現不是歷史 trace。

## 最小修正與不變條件

`src/conversation-controller.mjs` 原先在等待 sessions／workers／browser 閒置讀取前就鎖住房間；`open()` 見鎖便拒絕，最後清除預覽，形成截圖中的更新提示與回跳。

- 必要閒置讀取使用既有 `abortable`；純導覽、同房間有明確操作、取消連線或關閉 K 會放棄過期檢查的等待。只取消自己的等待，**沒有取消底層原生讀取或工作**；晚到成功不能進入 close，晚到失敗也被觀察。
- 檢查不鎖查看；真正關閉前同步核對 abort、owner 仍登記、目前選取、導覽狀態／revision、已有鎖，再鎖住實際 close。最後也重新核對討論 busy／held。
- 已有鎖時，純查看只投影原 owner，不重開 native、不改設定；設定、送出、核准等仍沿原鎖拒絕。
- 真 close 已進入則不套逾時、不提前解鎖、不宣稱停止；如果此時選取該房間，保留其離線 owner。實際三家 adapter 拒絕離線送出；普通重新開啟保留原 thread，不重播工作。
- 保留現有序列釋放、active 加最近三個背景房間的策略，以及 busy／目標／核准／queue／worker／瀏覽器接手防護。没有新服務、K 自動重試、模型替換或記憶架構。

變更檔案：上列來源；`test/conversation-controller.test.mjs`、`test/discussion-conversations.test.mjs`、`test/conversation-native-regression.test.mjs`、`test/gemini-controller.test.mjs`，以及假資料 UI probe `test/room-lock-navigation-ui-probe.mjs`。工程紀錄為本文件與索引；沒有修改正式資料。

## 驗證與保留失敗

- 舊正式基線的三個精確回歸重現「此聊天室正在更新」，原版失敗 3/3，初始候選聚焦 43/43 通過。
- Opus B1 的 hidden-room discussion 回歸在第一輪候選確實失敗：owner 被 close 1 次，預期 0。另一個慢送出測試原本已由 unified queue sending 保護而通過，**不把它宣稱為 red**。補修後四檔聚焦 **76/76** 通過。
- V1 以真正 Codex／Claude／unified adapter 加 fake native host，核對 close 等待期間純查看、鎖內拒絕送出、離線兩次拒絕且不新增 host／原生 submit、普通同 ID reopen、重複 close。Gemini 實際 adapter 離線拒絕／重複 close 亦為 0 run。不是只修改 fake send 來冒充驗證。
- 初始完整序列回歸 1092/1092、actual fake-provider backend + built UI 桌面1440／手機390兩例通過。第二輪版本完整 **1097/1097**、兩尺寸 built UI 通過；Astra 隨後補驗再開後佇列（下段），故不把此結果當最新程式最終驗收。
- 最後 UI、瀏覽器擴充、桌面啟動器建置已成功。先借較舊主工作區 dependency junction 的 UI build 失敗（缺 assistant-ui），原文保留；只複製現有正式 dependencies 到候選後成功，沒有 install／更新全域。自己建立的舊 junction 改名原地保留，不刪來源。

證據目錄：`D:\K-harness\.runtime\room-lock-fix-20261010`。含 baseline-red、focused、full、UI、build、依賴複製、兩輪 Opus、native audit 原文。UI截圖／metadata 在候選 `.runtime/room-lock-ui`；全是假資料，沒有真帳號／小說／模型送出。

## 真正 Opus 5.5 複查

第一輪官方 Claude Code2.1.294／Claude.ai Pro／firstParty，assistant model `claude-opus-5-5`，session `0578ce16-21bd-4927-9bb7-c4dbfe0faaed`，exit0／success／is_error=false。指出 B1 必修與 V1 欠驗證，**當時沒有同意部署**。Astra 已獨立核对／補修、重現 B1 及真 adapter 驗證；第二輪同一 session 接續、exit0／success／is_error=false，實際 assistant model 仍為 `claude-opus-5-5`，判定 B1已消除／V1足夠／最小完整解、無阻擋；當時未收到 full/UI 結果，Astra 另外核對通過。不是失敗重試／換模。


### Astra 補驗：再開後佇列直接回歸

Opus 第二輪留下 input-queue 未見 source 的驗證缺口。Astra 實查發現：保留的已 idle-close unified owner 明確重開，queue.load 沒有清除 closed=true，新明確第一回合可開始，但排入的新明確第二則永遠不送。這是本修正保留 closed owner 直接暴露的回歸，不是無關清理。Codex／Claude actual adapter + fake host 均重現 red（預期兩個新 input 各一次，實際只有第一個）。

最小補修只在 `src/input-queue.mjs` 的 load 成功後把 closed=false；saved rows 仍 paused、原 sending 仍轉 uncertain，不自動 resume、不建立新 queue／state／API。補 unit 核明確 load 保存列不送，只有 explicit resume 才送，再明確 load 空列後新 input 正常；native regression 亦補完整 explicit first／queued second／completion／exactly 2 submit。追加檔為 input-queue 來源與 test，最新五檔聚焦 **103/103**、完整序列 **1098/1098**、真 fake-provider 後端與 built UI 兩尺寸 **2/2** 全部通過。Astra 讀回 log 與 UI result／手機截圖，核對 0 未授權原生送出、無回跳、無 JS 錯誤。


第三輪仍是同一官方訂閱／session，exit0／success／is_error=false，實際 assistant model `claude-opus-5-5`，確認 queue缺口是真的、load重新啟用為最小解，沒有實證競態或阻擋。三輪工具分別9／9／5次，均僅 Read／Glob／Grep，Astra檢查指定路徑位於限定證據封包。Opus封包未含最後修後完整／UI结果，因此由Astra另外驗證，不聲稱是Opus執行測試。

## 三間原生失敗：既有資料補查結果

沿用先前 [真正 Opus 診斷討論](native-failure-opus-investigation-20261010.md)，本輪只讀既有三個 rollout 與限定 SQLite 時窗；不新增模型壓縮測試、不開全量 DEBUG、不輸出小說／prompt／header／秘密、不上傳原始資料。Luna 限定只讀補查後，Astra 閱讀腳本並以錯誤本身必須包含 request ID 的條件獨立重跑，5/5 精確匹配。

| 本地時間（2026-10-10） | 房間 | request ID | 原生分類 |
|---|---|---|---|
| 06:54:04 | 拳王轉生 | 700a6114-5f5c-43b8-9b08-55eb0bc5a64b | stream_disconnected／other |
| 08:13:48 | 拳王轉生 | 57d7fe1e-2b9e-4615-ac5e-4191380cf5b8 | stream_disconnected／other |
| 12:38:56 | 鐵血獵犬 | 713b3361-7bae-49bd-9a15-f4e7a5c3fc85 | stream_disconnected／other |
| 07:04:57 | 我殺了學院玩家 | d666df30-1f12-491b-9508-01ec87fa44eb | stream_disconnected／other |
| 08:11:04 | 我殺了學院玩家 | 569402d0-b02a-4bf3-865a-43e888429270 | remote_compact_stream_disconnected／other |

- 取得對應 turn ID／事件型別／時間／失敗前最近同回合 token 用量。四筆是一般原生請求串流失敗，一筆明確遠端 compact task 失敗；五筆都沒有額外可直接歸屬的同回合 compaction 邊界，不借較晚無 turn 關聯的 `compacted` 當本筆證據。
- 鐵血12:38 ±5分：12筆 responses_retry WARN，其中7筆含明確 stream disconnect 字詞；另1筆 client WARN未分類。沒有可確定 retry attempt 編號，**12不是精確重試次數**。
- 同 thread 時窗9筆 HTTP client DEBUG status200，endpoint為 `chatgpt.com/backend-api/codex/responses`。未見 status≥400／明確 connection reset等詞彙；但200無法逐筆關聯失敗request，更不證明串流完整或排除上游／傳輸因素。
- `token_usage_record.usage` 與 `turn_token_usage` 分開保留，不把回合累計當單一 wire payload，不由數值或壓縮次數推定因果。历史 CLI version／當時 transport未知，不用目前 selected core版本補寫。
- 停止調查結論：**已定位原生請求失敗，根因仍 UNKNOWN**。K切換鎖是另一个有可重現來源的問題，這次修它不能宣稱原生 stream 或記憶問題已解決。

獨立重跑證據：`native-turn-independent.mjs/json`；原代理 `native-audit.json`、`native-turn-audit.mjs/json` 保留。腳本 SQLite readOnly，不 checkpoint、不複製漏WAL的檔案當一致快照。

## 正式部署／未完成

目前未部署／未停止／未重啟／未push，程式 candidate修正不等於正式成功。最新 queue補修版 **103/103聚焦、1098/1098完整、2/2 built UI** 已讀回；真正 Opus 第三輪亦無阻擋。固定候選將以本機 Git commit／source archive 建置 UI、擴充與啟動器，逐一讀回 source 與建置成果；版本及 prepared 位置見 `.runtime/room-lock-fix-20261010/fixed-source-readback.json`。待本人告知 K 關閉後，先重新核最新正式版本與確實無工作，再保留程式／啟動器可退版本，固定候選建置與讀回後套用；不還原／復活對話或工單，若正式版本已變需先比對整合，不能覆蓋。此次不建立排程等候部署。
