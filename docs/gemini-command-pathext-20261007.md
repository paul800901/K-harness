# Gemini 指令輸出消失與延遲執行：PATHEXT 修正

狀態：候選已實作、真正 Opus 5.5 複查通過；尚未正式套用／push。本人本輪確認「仍有工作，先保留修正版」，因此不關閉、不更新或重啟正式 K。此記錄不是三核心全面零故障保證。

## 結論與前因

先前社群素材工人有多次 Python 指令回傳 0 卻沒有輸出；之後改用 Start-Process 並出現可見終端。10/7 共用派工提醒已限制開窗、盲目重試及未知結果重播，但提醒不會修復命令執行環境。10/4 原生自更新開窗則是另一個問題，不能混為一談。

本輪找到可重現的 K 缺陷：`geminiEnvironment` 的環境白名單移除了 Windows `PATHEXT`。同一個 PowerShell／Python 假資料指令，缺少它時沒有 stdout/stderr、退出碼 7 被回傳為 0，檔案卻在工具返回後才出現；只補來源 PATHEXT 就恢復同步輸出及非零退出碼。這種延遲副作用會讓模型誤認沒有執行，再次執行可能重複工作。

**不能全歸因於模型能力不足。** 本輪證實 K 環境問題，但未用當時的 agy 1.2.16 重播原素材工作，不能聲稱已證明所有歷史開窗／錯誤都由它造成。未隱藏的 Start-Process、參數寫錯、中文編碼等仍是不同因素。

## 最小修正與影響範圍

- `src/gemini-worker.mjs`：既有大小寫不敏感白名單僅增加 `PATHEXT`。不增加 ComSpec、APPDATA、LOCALAPPDATA 或任何提供者秘密變數，不造缺值預設。
- `test/gemini-worker.test.mjs`：混合大小寫 `PathExt` 與秘密剔除讀回；增加 Windows PowerShell 5.1 → 真 Node 程式的 stdout/stderr、新中文路徑檔案及退出碼 7 regression。
- Gemini 主對話與 Flash 工人共用這個函式，因此兩者都受益；GPT／Claude 原生環境與路由不變。
- 原生權限、核准、帳號、訂閱、模型選擇、歷史、長工作生命週期與未知結果不重播保持不變。非完整存取仍禁止 `command(*)`；Skill 不擴權。
- 沒有改全域 Windows 變數、安裝套件、更新核心、搬登入、建立通用 runner／新 MCP／重試或監控服務。

## 假資料實測

工程證據：`D:\K-harness\.runtime\gemini-reliability-20261007`。只使用新建假檔；沒有跑原 ASR 工作、讀真人影音或送營運操作。

| 範圍 | 已觀察 |
|---|---|
| PS 5.1 原 env／單補 PATHEXT | 原白名單丟失輸出與失敗碼；補回後 stdout、stderr、檔案及 0／7 正常 |
| PS 7.6.6 同一 Python 矩陣 | 原白名單及單補 ComSpec／SystemDrive／LOCALAPPDATA／APPDATA 仍失敗；單補 PATHEXT 或 PATHEXT+ComSpec 成功 |
| 延遲副作用 | PS 7 各組用唯一新檔名；失敗組在命令 close 當下 MISSING，500ms 後檔案存在。不能把空輸出當成未執行 |
| 真 agy 1.3.1／Flash high 指令入口 | 原生回報 PS 7.6.6 與完整 PATHEXT；兩個 Python 呼叫各一次，兩個輸出標記均回傳，假檔中文讀回正確；刻意 exit7 於原生層轉成 exit1，保住非零、不是精確 7 |
| 可見視窗 | 120秒觀測涵蓋兩個原生命令時段 19:49:58–59、19:50:04–05；該時段未觀測到新終端視窗。期間另一未修 env 合成矩陣在 19:49:39–49 開出10個 WindowsTerminal；全域數量不能歸給 Gemini |
| Skill 提示式使用 | 新假資料工作區 `.agents/skills/inspect-local-wav`；沒有給名稱、路徑或答案，但有「如有相關 Skill」提示。原生確實讀 SKILL.md、執行既定標準庫腳本，取得 1聲道／8000Hz／8000frames／1秒與腳本 revision |
| Skill 自由選方法／格式失敗 | 新回合只要求檢查 second.wav、broken.wav 的格式，未提 Skill、命令或執行次數；原生第一步讀同一 SKILL.md，兩次 run_command 分別檢查不同檔案。正確取得2聲道／24000Hz／36000frames／1.5秒；壞檔回非零後改用 view_file 查原因，回報原 wave.Error，沒有再次執行壞檔、修改或假稱成功 |

限制：首次 Skill 視窗觀測開始時間晚於任務完成，其零視窗不能當成執行證據。PID 親緣快照可能受復用影響；不以「後代沒有視窗」保證 WindowsTerminal 沒開窗。原生命令合併兩個輸出串流，不能稱各自分離；合成 probe 才直接分別收 stdout/stderr。

後補自由選方法回合的獨立視窗觀測：19:59:50–20:02:50 全程180秒，涵蓋原生回合與兩個腳本呼叫、最後回答；170筆事件中沒有觀測到可見且有實際尺寸的 Console／WindowsTerminal 視窗（0 new terminal SHOW、0 visible sample）。這是本回合觀測結果，不是對未來任意工作強制封鎖開窗的保證。壞檔只被檢查一次並如實回報，外層「檢查任務完成」不表示壞檔讀取成功。證據 `skill-free-{start,result,windows}.json` 及對應原生 transcript。

Skill fixture 只供接線驗證，沒有安裝全域或放進其他專案。它不是完整 ASR／素材化 Skill，也不代表工具已硬收斂、所有同類任務必會選用，或 runHome 能繼承全域 Skill。自由選擇回合證明本案例無須提示也能選用，不升級成全面保證。正式固定工作應封裝各自已驗收的現有入口，而非重寫影音引擎或把命令權限繞過。

## Regression、建置與複查

- 定向 52/52。介面建置成功，沿用既有依賴 junction，未安裝／升級套件。
- 首次全測沒有 dist-ui，失敗屬候選尚未建置；建置後預設並行 950/951，既有 codex-capacity 持久化測試3秒等待未達預期。
- 未改該測試或產品邏輯；`node --test --test-concurrency=2 test/*.test.mjs` 全套 **951/951**，70.46秒。預設並行的不穩定測試保留記錄，不宣稱預設全綠。
- 新 regression 未在舊程式上實際跑紅；舊環境的同機矩陣重現與修後 regression 是不同證據，不寫成已驗證紅轉綠。
- 真正官方 Claude.ai Pro／Claude Code 2.1.292、實際模型 `claude-opus-5-5`，沿用 session `93810ea4-02cd-417a-b8cf-7b51136a91af`，只讀去敏感封包討論根因、測試計畫與候選差異。沒有改 API 計費或用其他模型冒充。
- Opus 中途要求補 PS7、檢查延遲副作用、核對原生 PATHEXT 及非後代的 WindowsTerminal；已實測並修正證據描述。
- 最終複查沒有阻擋，認為可發布；採納註解改成實測事實，不把「當成文件開啟」推論寫成已證实；採納串流合併、非零碼、提示式 Skill 與視窗時間覆蓋的限制。原文保留於 `D:\K-harness\.runtime\gemini-skill-opus-discussion-20261007\opus-final-pathext-review.md`。
- Opus 指出的無提示 Skill／自由選方法缺口，後續由主代理以第二個新 WAV 與壞檔回合補測；已自行逐筆檢查原生工具呼叫與完整覆蓋的視窗事件，沒有把模型自述或思考當成執行證明。補測沒有增加產品程式差異。

## 正式狀態與剩餘事項

本候選基於固定來源 `f0d32ef263e71bced827d264bbaaa71f1f8132b1`，程式基線與正式 `e068ffa4dcc7d0da57e73d72a98111e925975fe4` 相符。沒有覆蓋舊根工作樹或別項工程候選。

正式安裝仍為 e068ffa；依本人本輪指示尚未部署／重啟／push，不能把候選測試當成使用者已在用。未來更新前需確認閒置、核對其他批次沒有更新正式版本，保留程式退版，正常關閉後套用固定 SHA 並正式讀回；不能以修改一個執行中檔案冒充生效。

中文 stdout 的編碼問題、原素材流程的專用 Skill、全域／runHome Skill 繼承及部署後自由選方法的長期行為尚未驗收。本修正處理已證實的命令入口缺陷，不保證所有供應商或任意子命令以後零錯誤。
