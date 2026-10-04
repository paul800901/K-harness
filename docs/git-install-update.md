# K：Git 下載、安裝、更新與退版

## 使用方式

**先選已驗收的 Git 版本，再安裝或更新，不直接追最新版分支。** `origin/main` 用來取得已發布的來源；實際 `-Ref` 指定工程紀錄中的完整 commit SHA，或已核對對應 SHA 的版本標記。AI 先查 [最新工程索引](development-log.md)，區分正式程式版本與後續純文件版本，再執行。

截至 2026-10-04 20:02，南區已驗收程式為 **`k-gemini-media-20261004`**，遠端標記對應 `4b8029624549175f1df3c12422aafe1bf9407e34`，見 [Gemini 多模態與部署紀錄](gemini-capabilities-20261004.md)；這是目前基準，不是永遠固定使用此版。東區尚未更新。Gemini 仍需在該機安裝官方 Antigravity CLI 並由本人登入，Git 不帶入其他電腦的登入、對話或語音設定。Chrome 助手分開設定，舊版本標記保留不動。

## K 開發與發布 SOP

2026-10-04 使用者定案，後續每批程式開發按同一流程處理，不另建發布平台或管理介面：

1. **完成一批再驗收**：依已交代範圍實作，先做相關功能實測與完整程式測試；不可測的部分記清楚，不用測試數取代實際行為。
2. **主代理與 Opus 複查、討論**：真正 Opus 5.5 檢查正確性、錯誤處理與過度工程化；主代理核對意見、補修後重驗，記錄採納與未採納理由。不是只看一眼就算通過，也不是 Opus 說什麼都照做。未解決重大問題或 Opus 尚未完成，不發布成已驗收版。
3. **固定程式版本**：將本批程式提交 Git，以完整 SHA 準備乾淨候選並建置／測試；不部署混有未提交修改的資料夾。補修若改變程式，須重新確認候選與驗證對應的新版本。
4. **安全部署、正式讀回**：確認正式 K 無執行中工作，再保留上一版程式／啟動器，套用固定版本；核對功能及既有帳號、對話、設定。失敗先停止並依證據處理，不重送未知工作、不把失敗版標為可供東區更新。
5. **推 GitHub、核對版本**：上述通過後，接續推到既有私人儲存庫並讀回遠端 SHA。記下已部署程式 SHA、退版位置與 GitHub 發布狀態；若只有 docs 收尾比程式多一個 commit，分開寫清楚。push 失敗時仍明確區分「本機已部署／尚未發布」。既有 tag 不挪用；有新 tag 時核對它指向的固定程式版本。
6. **東區日後跟同一版**：到東區才更新；取工程紀錄中的已驗收版本，而非當時最新 `main`。更新後做當地讀回，南區成功不能代替東區驗收。

在已授權的 K 開發範圍內，流程通過即可部署與 push，不必每個小修再請使用者批准。只讀／不部署等當輪限制優先；無法確認工作停止，或涉及登入、計費、權限、不可相容資料格式等範圍改變時，先停在相應步驟。**純文件更新只核對文件，不因此重啟 K 或重跑與之無關的全套程式測試。**

每批沿用 docs 工程紀錄與 `development-log.md` 索引，保留實際 Opus 意見、處理方式、測試數、未驗證事項、南區／東區各自狀態，不增加另一套追蹤系統。

## 首次安裝

K 程式由私人儲存庫 `https://github.com/paul800901/K-harness` 取得；新電腦需先以本人 GitHub 帳號取得存取權。使用乾淨 clone，不把目前開發機整個資料夾複製過去。

```powershell
git clone https://github.com/paul800901/K-harness.git
cd K-harness
```

需要現有 Git、Node.js（符合 package.json，目前至少 22.19）、npm、PowerShell 及 .NET Framework C# 編譯器。K 不自動安裝全域環境，也不改帳號或計費。首次準備還需要官方 Codex／Claude Code 的原生 Windows exe；不是 cmd 包裝檔。Codex 的同目錄 exe 輔助程式會一起複製至 K 專用目錄，Claude 複製單一 exe；不複製任一登入憑證。

由 AI 確認本機官方執行檔實際路徑後執行：

```powershell
$release = '<工程紀錄中的已驗收完整 SHA 或版本標記>'
.\Setup-K.ps1 -Ref $release -CodexExecutable '<官方 codex.exe 完整路徑>' -ClaudeExecutable '<官方 claude.exe 完整路徑>'
.\Start-K-Desktop.ps1
```

首次啟動在 K 內重新登入兩家訂閱、選擇本機工作資料夾。沒有自動搬移其他電腦的登入或對話。

## 更新

```powershell
git fetch origin --tags
$release = '<工程紀錄中的已驗收完整 SHA 或版本標記>'
git rev-parse "$release^{commit}"
.\Update-K.ps1 -Ref $release
```

執行前由 AI 檢查工作樹與更新器版本，有待保留修改時不 reset 或覆寫。`git fetch` 只取得來源，不更換工作樹或正式 K；核對 `rev-parse` 結果與已驗收 SHA 相同後，更新器才套用指定版本。更新器會 fetch 現有 origin，再以指定 commit 建立候選，不 merge/reset 現有工作樹，不包含未提交的修改。依 lockfile 執行 npm ci、建置介面／擴充／啟動器及完整測試；失敗不動現用程式。更新器不更新三家的原生核心，核心升級另外驗證。

可先加 `-PrepareOnly` 完成候選建置而不套用。正式套用前請「離開並停止 K」，不要只關閉視窗；更新器不強制停止工作。成功後自行啟動 K。更新後若擴充有變更，執行瀏覽器設定腳本並在 Chrome 擴充頁重新載入；不能用程式已更新宣稱 Chrome 已載入新版。

## 退回上一版

```powershell
.\Update-K.ps1 -Rollback
.\Start-K-Desktop.ps1
```

同樣先離開 K。程式與啟動器退回上一版，退出版本也保留，不刪備份；**程式退版只退程式，不還原對話**。封存＝放棄；K 不提供封存對話的資料備份還原，程式備份也不是對話備份。未來涉及資料格式不相容的版本，必須另外評估，不能以這個程式回退保證跨版本資料相容。

## 資料位置

- `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime`：現用程式。歷史目錄名稱保留，**不需要 Sandboxie**。
- 同層 `agent-home`、`vault`、`workspace`、`browser-output`：本機帳號、對話、瀏覽器與輸出；更新不替換。
- 同層 `releases`：上一版程式；候選失敗產物也保留供診斷，不自動永久刪除。
- `.local/runtime.json`：本機 Node／語音位置、目前 commit 和還原位置，不進 Git。
- `installed/k-browser-assistant`：Chrome 載入的穩定擴充位置，不進 Git。

不要將這些個人目錄提交到 Git。原開發機根目錄有未合併實驗，請以目前 Git 發布版本為程式來源，不再整批複製舊根目錄程式。

## Chrome 助手

第一次明確執行 `scripts/Setup-K-Browser.ps1` 設定本機 Chrome 路徑及 K 專用原生訊息註冊；不新增開機啟動或服務。之後用「開啟K一般瀏覽器.cmd」開 K 專用 Chrome，在擴充頁載入 `installed/k-browser-assistant`，需要無痕時本人打開允許無痕。不接管日常 Chrome。

## 語音

語音來源由本機設定決定，更新會沿用。南區未設定 `dictationProvider` 時仍預設 Whisper，需要 NVIDIA 顯卡及相容 CUDA；Git 不含 Python 環境／模型，也不自動下載。可指定已驗證可用的本機位置：

```powershell
.\Setup-K.ps1 -DictationPython '<python.exe 路徑>' -DictationModel '<Whisper 模型資料夾>'
```

已有 K 核心時不必重複提供 Codex／Claude exe。語音位置存入 `.local/runtime.json`，後續更新沿用；也可用相對於安裝根目錄的位置。現有 helper 仍採 CUDA/float16，**不是 CPU 通用包**；新電腦的顯卡、CUDA 相依與實際辨識尚須驗證，不能把 Python venv 直接拷貝當成跨機可用。語音環境未備妥不影響文字對話。

東區使用已安裝的 Windows zh-TW 辨識引擎，可選 `Setup-K.ps1 -Ref $release -DictationProvider windows`，其中 `$release` 是前述已驗收版本；首次安裝同時提供官方核心路徑。此方案不需 Python、Whisper 或 NVIDIA。設定只存該機 `.local/runtime.json`，不隨 Git 搬到南區。

## 驗收邊界

Windows 10 實機、真正登入及新電腦麥克風仍待當地驗收。工程測試與本機更新結果見 `docs/git-install-update-20261001.md`；不以 Git clone 成功當作全功能驗收。


## 三家原生核心的手動更新

本入口已套用南區正式 K，其他電腦的版本／驗證界線見[黑窗與手動更新紀錄](console-flash-investigation-20261004.md)。在設定中按「更新 Claude Code／Codex／Antigravity」才查詢官方正式版本；有新版才下載到 K 專用目錄。準備完成後，先完成工作，再「離開並停止 K」並重新開啟。只關視窗不會換核心。

平常不自動查新版或更新，不影響目前工作、不改登入或計費。舊核心保留，可請 AI 協助退回。上述 `Update-K.ps1 -Rollback` 只退 K 程式；核心另以 `trusted-providers/selected-cores.json` 的上一版位置還原，不還原對話。

## Gemini 核心的本機位置

Gemini 的官方 `agy.exe` 應由 AI 驗證簽署／版本後，放入該台 K 自有的 `trusted-providers` 程式目錄，沿用既有 `selected-cores.json` 指向它；不複製登入資料，也不將執行檔或本機選用紀錄上 GitHub。這份副本是必要核心，不可當暫存清理；缺少已選定核心會阻止 K 啟動。已選用的核心在一般 K 程式更新時保持不變，後續按「更新 Antigravity」仍使用既有官方更新流程。

不能只因 Codex 工具可執行 `%LOCALAPPDATA%\agy\bin\agy.exe` 就判定日常 K 能用：封裝 App 可能把該路徑重新導向自己的私有資料區。驗收必須包含一般桌面啟動的 K，確認 Gemini 額度、更新檢查及聊天室均可使用。若遇 ENOENT，先核對失敗程序看到的實體位置，不要求使用者重新登入、不新增自動搜尋備援。實際案例與最小修正見 [agy 再次失聯根因](agy-recurrence-settings-20261004.md)。東區使用自己的官方安裝及登入，不搬南區帳號。
