# 舊 Gemini 工單查詢與等待狀態補修（2026-10-07）

## 問題與直接證據

- 使用者在「穿越30年依舊是序章」看到「已確認執行中 0、待確認 1、主代理待命／等待子代理」。Luna 先以 Codex 原生 `list_agents` 的空清單判定沒有工人，之後錯將 K Chrome 助手離線當成無法查工單的原因。
- 05:25–05:26 原生回合工具紀錄顯示：確實呼叫原生 list_agents；工具搜尋結果已有 `gemini_inspect(requestId)`，但未呼叫。改走瀏覽器後收到離線錯誤。現況缺少的是從目前對話列出 K 工單 requestId 的模型入口，不是 inspect 依賴 Chrome。
- 正式 K 唯一未結案舊工單為 `30years_ch019_P01_translation_20261005_r1`，開始於臺灣 10/5 20:27；status=unresolved、settled=false，記錄原因為重啟後 agy 程序與完成結果無法確認、未重播。保存 PID 已被 10/7 的 conhost 使用，不能据此採用或終止程序。另有同 P01 的 completed recovery-review 紀錄，但本輪沒有驗收小說成果，不藉此改寫舊工單完成狀態。
- 使用者先要求修好，後明確回覆「我已關K等等一起修好」。本批併入已授權的 [Gemini 背景行為規則](gemini-worker-console-20261007.md)，通過完整驗證與真正 Opus 複查後才套用。不停止、恢復或重派真實任務。

## 最小變更

- `src/luna-gateway.mjs`：新增空參數 `gemini_list`／`luna_list`，限定既有對話綁定的 bridge。只列未 settled 的必要摘要，不傳任務全文、輸出、PID 或帳號。使用 `list(false)`，不呼叫 inspect、resultReady、派工、取消、換帳號或瀏覽器；讀取錯誤仍回未知，不偽裝空清單。inspect 描述指向 list。
- `src/luna-bridge.mjs`：從磁碟載入未結案 Gemini 紀錄時只在記憶體標記 `executionUnowned`／unresolved，原記錄不因 list 被覆寫，不採用舊 PID、不改 settled；真正 inspect 的既有持久化及安全規則保留。新建、仍由本 bridge 管理的工人不標成歷史。
- `src/worker-policy.mjs`／`src/claude-host.mjs`：主模型指引說明 K 工單不在原生 list_agents；ID 不明先用本對話 list，再 inspect，無需 Chrome。不改選模或原生權限。
- `src/conversation-controller.mjs`／`frontend/work-status.mjs`／`frontend/worker-activity-popover.jsx`：歷史待確認獨立計數與黃字明細，桌面、手機及主代理待命文字不再把它說成等待活工人。未知仍是未知，不改底層停止、交接或通知規則。
- 沒有新增監工、常駐服務、輪詢、重試、資料遷移、結果確認按鈕或自動判死；Gemini 不開黑窗的要求仍是派工行為規則，不是 OS 強制隔離。

## 驗證

- 定向 bridge、gateway HTTP、conversation projection、worker policy、UI status 106/106 通過。
- 完整來源測試 927/927 通過；UI build 成功。
- 真 built UI＋假事件／工單：1920×1080、1100×760／125%、900×700／150%、390×750，4/4 通過、page errors=[]。Astra 目視手機舊工單明細截圖，未裁切。包含正常、未知、舊紀錄、混合工人、斷線、彈出明細與最後選項；不當成 Android 實機。
- 首輪新測試 mock 未回 onStart 卻斷言 running，已修 fake 的啟動通知；首輪 UI probe 在切回正常案例時未清舊 fixture，已讓工單明細與 count 同步，第二輪通過。這兩項為測試情境修正，沒有用放寬產品斷言遮過失敗。
- 證據保留 `.runtime/worker-recovery-20261007/`；真原生 Luna 工具實測、Opus 複查與正式部署結果續記下方，不以候選測試充當完成。

## 狀態

目前為候選已實作及本機測試驗證；待真正 Opus 複查、Luna 工具實測、固定版本與部署讀回。原對話／帳號／手機登入及舊未知工單保持原樣。東區未更新。

## 真正 Opus 複查與必要補修

- 第一輪官方訂閱 Opus 5.5，session `1350e608-978d-47ae-b219-b4e1e17687fa`，在唯讀 packet 中指出：即使 UI 已分開歷史，list 會初始化 bridge，既有 Stop／關閉仍會反覆取消無 owner 的舊工單，永遠無法確認，造成操作卡住。屬本問題必要根因，不以 UI 改字遮過。
- 採最小修正：bridge.close、GPT／Claude 工人收尾、Claude 切換設定的未結案檢查，只略過從磁碟恢复且沒有本次執行 owner 的 Gemini 舊紀錄；不 cancel、不改 settled、不採用 PID。仍由本次 K 啟動、停止尚未確認的工人照常拒絕關閉／切換，原生 Codex 子代理也不因此放行。舊歷史未知不代表已停止。
- 原入口 log 讀回 05:35:26 正常關閉未能確認，05:35:27 留有使用者操作後的本次 supervisor 強制停止紀錄；本工程代理沒有強制終止。此症狀與舊工單阻擋的程式路徑相符，但日誌本身沒有列出工單 ID，不能單憑該行斷定唯一原因。
- 51/51 Gemini bridge 單元測試通過，涵蓋 list 不改磁碟、close 保留舊 unresolved、owned 未確認仍阻擋與不採用 PID。控制器混合新／舊工單回歸與最終完整測試續記。

## 真正 Luna 原生查詢實測

- 新合成工作區，官方 K Codex 訂閱 `account/read` 本次確認 ChatGPT Pro；`model/list` 本次確認 `gpt-6-luna` 支援 high。只建立新測試對話 `01a1132c-123a-7931-9cd3-68d03e3ddce6`，不重用翻譯對話，不讀原資料或認證檔。
- 使用者測試提示只有「K 顯示 1 個待確認工人，請查原因。」真正 Luna high/read-only 自行依序呼叫新真 gateway 的 `gemini_list`、`gemini_inspect`，查到合成舊工單，正確回報重啟後未知，不代表仍在跑或已停止。
- 原生回合 completed；沒有 browser、Gemini start/cancel/wait/accounts 呼叫、沒有工人重送；僅測試自有 controller/host 正常關閉。結果及原生 tool item 在 `.runtime/worker-recovery-20261007/native-luna/result.json`。
- 這是「真正 Luna＋真正 gateway＋合成工單」證據，不是對真小說結果已完成的認證。Gemini 真模型背景程序遵規仍未驗證。

## 最終驗收與範圍收束

- 第二輪真正官方 Opus 5.5，session `27154783-211c-4ec5-9d8f-c13b844a6a34`：前次 close 阻擋已解，沒有阻擋級問題。複查確認不會將 current owned 工作誤標 historical、close 失敗仍保有原 bridge，list 無確認／取消／換帳號副作用；行為規則未新增強制架構。
- Opus 複查為程式碼層級；其未驗證欄如實保留。主代理另外核對本次真 Luna 結果、工具明細、UI 截圖與完整測試，不把 Opus 沒讀的實測說成 Opus 已驗證。
- 補修後 GPT／Claude 控制器 109/109、Gemini bridge 51/51；最後完整來源套件 **930/930**（`source-tests-final.log`）。目前 owned 未確認停止仍拒絕、混合新／舊只取消本次工作、舊記錄不改 settled／requestId、不派新工作。
- 非阻擋既有範圍：fork／移動工作區／閒置回收的未知工作守衛仍保守，未藉本批一併放寬；未接受「新任務自己宣稱互動窗授權」，原 delegated-task 不擴權規則保留。list 不寫記錄；inspect 沿既有流程會寫回觀察，不能把兩者混稱唯讀位元組不變。
- 目前 ready for deployment，尚未套用正式。下一步固定 Git 程式 SHA，乾淨候選建置／930 項回歸，確認 K 停止、保留退版、交換程式並做正式讀回；手機殼未改，無需重裝 App。依既有 SOP 完成後推現有私人 GitHub，不更新東區。

## 南區正式套用與讀回（05:54）

- 固定程式版本 `6dbd8cfb733e144c14c35b8077611a0028fa8936`，前版為 `e0d552c20eac96b15e6a5677314d2a09a349be8a`。乾淨 Git archive 候選 UI／擴充／啟動器建置成功，完整 **930/930**；只複製 lock 相同的既有實體相依，未安裝套件。六個現用 UI 檔位元組一致，manifest JSON 等價（換行不同）。
- 套用前確認原入口的 K 程序與 47831／54832 listener 均已停止。只透過既有安裝交換程式與啟動器；退版保存在 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791323617619`，不還原或搬動對話資料。
- 交換前後 **39,057** 個既有資料／設定／原生執行檔雜湊一致；五個 Gemini 帳號及選定身分不變。相關 close 補修檔為 `src/desktop-controller.mjs`、`src/claude-controller.mjs` 及 `src/luna-bridge.mjs`，沒有以廣泛解除 unknown 守衛代替修復。
- **正式舊紀錄實讀**：用已安裝版本讀原對話 348 筆工單，唯一未結案 `30years_ch019_P01_translation_20261005_r1` 正確為 unresolved／settled=false／executionUnowned=true；該 bridge 正常 close。全部 348 筆 JSON 雜湊不變，原生啟動／onChange 次數皆 0，沒有取消、重派或把舊結果假標完成。這不是小說成果驗收，也不是使用者操作整個桌面關閉的端到端驗收。
- 從原本 `D:\K-harness\Start-K-Desktop.ps1` 開啟，launcher 05:54:22 回 ready；未另起替代後端。正式設定 SHA、**79 個程式產物**及三個 HTTP UI 資產皆一致；health=native，未授權首頁／state 仍為 403。
- 真正私人 HTTPS 在 1440×1000、390×750 兩尺寸接通、無 page error／橫向溢出；沒有送工作、改目標、切帳號或選其他聊天室。暫時驗收登入已登出，全部原手機登入雜湊仍在；訊息、當前對話及目標前後相同。這是桌面 headless 瀏覽器讀回，不是本輪 Android 實機。
- 正常重開後保護清單只有 Gemini 帳號 metadata、原生 cli.log 與一個既有 crash log 雜湊變動；帳號 IDs／active identity 不變。部署交換時的 39,057 檔完全一致與重開後原生狀態更新分開記錄，未宣稱整個啟動期間磁碟完全不寫入。
- 程式已推既有私人 `origin/main` 並精確讀回 `6dbd8cfb733e144c14c35b8077611a0028fa8936`；後續文件收尾另 commit，不重部署。收據保留 `.runtime/worker-recovery-20261007/` 及 `D:\K-harness\.runtime\worker-recovery-deploy-20261007/`。
- **現在狀態：南區程式已部署並正式讀回；東區未更新。** 手機殼不變，不需重裝；Gemini 新規則實際是否遵守仍待新任務觀察，不能宣稱已硬性封鎖黑窗或卡頓根因全數解決。沒有恢復真實翻譯目標、重播影音工單或改使用者工作結果。
