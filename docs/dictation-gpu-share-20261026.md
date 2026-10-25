# 聽寫與批次轉錄共用顯卡：先到先用，後到的聽寫改用 CPU（2026-10-26）

## 起因

10-26 00:35 本人在「錄音轉文字」聊天室讓 Gemini 用顯卡跑兩個 m4a 的逐字稿（工作單明確寫 `cuda / float16`，專案預設其實是 CPU），00:39 在 CaseAgent 房按麥克風聽寫。K 的「動態平衡」（[聽寫預先載入](dictation-prewarm-20261023.md)）只看剩餘顯存，當時放得下，聽寫也上了顯卡：GPU 100%、7.6/8.2GB，兩個 Whisper 在一張 RTX 4060 上互搶，聽寫十幾分鐘還在轉，16 核 CPU 與 64GB 記憶體閒著。

本人接著在 K-harness 房講了一大段聽寫，按停止後後端因「同時只能一筆」回 `LOCAL_DICTATION_BUSY`，前端把整段錄音丟掉、只閃一行錯誤，切房回來什麼都沒有。那段錄音無法救回。

本人要求：「能偵測是不是真的忙…然後分攤，不是這樣搶一張 4060」「誰時間戳先拿，誰就先用…聽寫是後面，那自然要去協調用別的資源」。轉錄急著討論病例，所以本人主動讓轉錄走顯卡、聽寫慢一點沒關係（可以切去別的聊天室工作）；本人自己指定 CPU 的批次照 CPU 跑。

## 討論

GPT-6 Astra（xhigh，唯讀）評估：GPU-Util 只代表取樣期間有 kernel 在跑，不能單獨判斷「誰在忙」；WDDM 下逐程序顯存是 N/A，`--query-compute-apps` 連 Chrome 都列出。建議兩專案共用一把 OS 鎖，鎖之外再以短時間多次取樣避開其他程式的持續負載；不建議「批次跑到一半把顯卡讓出來」（一段 180～300 秒音訊、模型生命週期與成果紀錄都沒有為中途搬移設計）。CPU 推論只能保證「能用」，幾分鐘的聽寫落到 CPU 要以分鐘級等待規劃。

Opus 提出「後到的批次也改 CPU」不划算（一段短聽寫讓整批改 CPU），本人選：後到的聽寫用 CPU，後到的 GPU 批次等聽寫用完。

## 修正

### 共用鎖（兩個專案）

- Windows 具名 mutex `Local\WhisperGpuShared-v1`（ctypes，明確宣告 `HANDLE`/`DWORD` 型別，不新增套件）。持有程序結束或當掉時由 Windows 釋放（`WAIT_ABANDONED` 視為取得）。
- K 聽寫 `scripts/local-dictation.py`：載模型前 0ms 嘗試取得。取不到 → CPU int8、8 緒（舊量測 8 緒最快）。取得後約 1 秒內取 3 次 `nvidia-smi` 使用率與剩餘顯存：2 次 ≥70%、顯存低於既有門檻、或查詢失敗／格式異常 → 釋放鎖改 CPU（取代舊的「查不到就 float16」）。用顯卡就持有到程序結束；GPU 載入或辨識失敗時，在 except 區塊外 `gc.collect()` 釋放顯卡資源後才放鎖，再用 CPU 跑。已在 CPU 的不搬回顯卡。
- 錄音轉文字 `src/transcript_workspace/pipeline.py`：只有 `device == "cuda"` 時在載模型前阻塞等鎖（log：`waiting for shared GPU`／`acquired shared GPU`），取不到就直接報錯、不載 CUDA 模型；持有到 GPU 模型生命週期結束。finally 中先丟掉模型、清除傳遞中例外整條鏈（含 `__cause__`／`__context__`）的 traceback frame、`gc.collect()`，才放鎖。CPU 路線完全不碰鎖，預設 device 與工作單格式不變。新增 `gpu_mutex.py`。

### K 聽寫可同時多筆、失敗保留錄音

- `src/local-dictation.mjs`：單一 `active` 改為最多 3 個輔助程序（以 id 為鍵）；超過才回 BUSY。prepare 與 transcribe 用前端產生的同一個 id 配對，只接手同 id 的預熱程序，取消只釋放自己那個。「停止未確認」只占自己的槽位；`busy`（更新前的閒置檢查）在任何程序仍存活時為真。同 id 仍在進行時回 BUSY；等舊預熱結束後重新檢查是否正在關閉。
- `src/desktop-server.mjs`：`/api/dictation/prepare` body 改為只允許 `{id}`，transcribe 為 `{id, audioBase64}`（id 為 1～128 字元字串）。手機遠端走同一路由。
- `frontend/native-dictation.mjs`：每次錄音產生 id；失敗時把該次 WAV 與送出意圖交回上層；新增 `session.retry(audioBase64, send)`（只在閒置時有效，新 id，狀態同樣 transcribing→idle，取消會中止）。
- `frontend/voice-composer.jsx`、`frontend/main.jsx`、`frontend/style.css`：只有主輸入框保留失敗的錄音（記憶體，依聊天室）；提示列出現「重新辨識」，本人按了才送，沿用一般聽寫的同一套 session（換房轉背景、取消、回原房送出都一樣）。成功、取消或開始新錄音時清除；換房回來仍在。引用註解的聽寫不保留、也不會清掉主輸入框保留的錄音。不自動重試、不寫檔。

## 實作分工與複查

Opus 寫規格，Gemini 3.8 Flash 實作兩個分支。Flash 跑測試時一支新測試卡住 5 分鐘，Opus 只結束該測試程序讓它自行修正。

Opus 複查修正：kernel32 呼叫補型別；補回被刪的程式說明；同 id 重入；批次檔開頭 BOM；GPU 失敗時模型釋放後才放鎖；移除誤加入版控的 `__pycache__`。

GPT-6.1 Sol（xhigh）第一輪 7 項必修，Opus 逐項處理：

1. 高：批次 `acquire()` 失敗仍載 CUDA 模型 → 改為報錯。
2. 高：Flash 自寫的 fetch 版重新辨識沒有工作歸屬，換房後可重複辨識與回填 → 刪除，改為 `session.retry` 並與開始錄音共用 `beginNative`。
3. 中：失敗路徑放鎖時模型仍被 traceback 持有 → 見上。
4. 中：回到來源房後才失敗不顯示按鈕 → 透過目前接手的 view 更新。
5. 中：引用註解的錄音被主輸入框接走 → 只保留主輸入框。
6. 中：`close()` 後仍可能啟動新程序 → 等待後重新檢查。
7. 中：`busy` 把停止未確認的程序當閒置 → 任何存活程序都算忙。

Sol 複核：6 項通過；第 3 項批次端遺漏例外鏈（`raise … from`、隱式 context 時放鎖當下模型仍存活）→ 改為清整條鏈，補兩項測試，拿舊程式跑時兩項失敗、新程式通過。Flash 那個只測自己複製邏輯的前端測試已刪除，改以 session 真實行為測試。

## 驗證

- K：分支 `aefdabf` 完整 `npm test` **1956/1956**；合併成果欄批後的 main `df53745` 重新 `build:ui`，完整 **1956/1956**、`npm run test:ui` **51/51**（含使用真 Whisper 的 voice-composer 與 voice-room-switch）。
- 錄音轉文字：`test_gpu_mutex` 9 項與既有 `test_local_retry`／`test_qc_ledger`／`test_consensus`／`test_output_integrity` 共 **104/104**（不載模型）。
- 跨程序實測（真 Windows mutex）：一方持有時另一方取不到、放開後取得；`WAIT_ABANDONED` 可接手（Sol 以測試專用名稱另驗）。
- 真模型實測（顯卡閒置時，K 子程序相同環境，7.2 秒合成語音，含載入）：

  | 情境 | 結果 |
  |---|---|
  | 顯卡空著 | 顯卡，5.9 秒，峰值約 4.7GB |
  | 鑰匙被別的程式持有 | CPU，15.6 秒，顯存不變 |
  | 兩筆聽寫同時 | 第一筆顯卡 7.5 秒；第二筆 CPU 16.1 秒 |
  | 聽寫持有中，批次後到 | 批次等 4.2 秒，聽寫結束即取得 |

  四種文字相同。第一次實測缺 K 會加在 PATH 前的 `nvidia\*\bin`，顯卡辨識報 `cublas64_12.dll` 找不到而退 CPU；舊版程式在同一條件下相同，屬實測環境差異，補上後正常。
- 腳本與測試紀錄在本機 `.runtime/archive/dictation-gpu-share-20261026/`（不進 Git）。
- 未驗證：真人麥克風在批次 GPU 執行中的實際等待；手機遠端的重新辨識；遊戲／LM Studio 持續負載下的 70% 門檻；幾分鐘長聽寫走 CPU 的實際時間。

## 取捨

- 不做常駐推論服務、批次中途讓出顯卡、人用設定或開關；「重新辨識」是本人遺失錄音後的實際需要。
- 其他不遵守這把鎖的程式（遊戲、LM Studio）只靠取樣避開，無法保證全機排程。
- 兩個專案各有一份極小的 mutex 程式，不建立共用套件。

## 部署狀態

- K 程式：分支 `dictation-gpu-share-20261026` 以 squash 合回 main `df53745`（接在 [成果欄不自動打開](results-panel-no-autoopen-20261026.md) `e949bf1` 之後，兩批一起更新）。
- 錄音轉文字：分支 `gpu-share-20261026` 快轉合回其 main `16df134`；該資料夾原有未提交的 `AGENTS.md`、`TOOL_INDEX.md`、`scripts/transcribe_desktop_audio.ps1` 未動。批次程式下次執行即生效，不需部署。
- 已寫 `.local/update-ready.json` 指向 `dec52f8`（main `df53745` 加上讓 Python 測試不留 `__pycache__`、沒有 python 時略過的測試修正；取代原本指向 `e949bf1` 的標記），待本人按側欄「更新」；push 待部署讀回後處理。
- 東區未更新。
