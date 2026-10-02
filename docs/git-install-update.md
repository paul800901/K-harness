# K：Git 下載、安裝、更新與退版

## 使用方式

目前安裝與更新來源使用 **`origin/main`**：包含沒有瀏覽器助手也能開文字聊天室、本機聽寫免 K 重複同意、設定內兩家訂閱登入、官方登入頁及工作列品牌修正。Chrome 助手仍為分開設定。舊標記保留不動，最新整合與發布狀態見 [東區合入 main 紀錄](dongqu-main-publish-20261003.md)。

K 程式由私人儲存庫 `https://github.com/paul800901/K-harness` 取得；新電腦需先以本人 GitHub 帳號取得存取權。使用乾淨 clone，不把目前開發機整個資料夾複製過去。

```powershell
git clone https://github.com/paul800901/K-harness.git
cd K-harness
```

需要現有 Git、Node.js（符合 package.json，目前至少 22.19）、npm、PowerShell 及 .NET Framework C# 編譯器。K 不自動安裝全域環境，也不改帳號或計費。首次準備還需要官方 Codex／Claude Code 的原生 Windows exe；不是 cmd 包裝檔。Codex 的同目錄 exe 輔助程式會一起複製至 K 專用目錄，Claude 複製單一 exe；不複製任一登入憑證。

由 AI 確認本機官方執行檔實際路徑後執行：

```powershell
.\Setup-K.ps1 -Ref 'origin/main' -CodexExecutable '<官方 codex.exe 完整路徑>' -ClaudeExecutable '<官方 claude.exe 完整路徑>'
.\Start-K-Desktop.ps1
```

首次啟動在 K 內重新登入兩家訂閱、選擇本機工作資料夾。沒有自動搬移其他電腦的登入或對話。

## 更新

```powershell
git pull --ff-only origin main
.\Update-K.ps1 -Ref 'origin/main'
```

上方 Git 更新適用於已在 `main` 且無待保留本機修改的工作樹；有分支差異時先檢查，不 reset 或覆寫。`git pull` 只取得来源，第二步才套用正式 K。更新器會 fetch 現有 origin，再以指定 commit 建立候選，不 merge/reset 現有工作樹，不包含未提交的修改。依 lockfile 執行 npm ci、建置介面／擴充／啟動器及完整測試；失敗不動現用程式。更新器不更新兩家的 CLI，核心升級另外驗證。

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

東區使用已安裝的 Windows zh-TW 辨識引擎，可選 `Setup-K.ps1 -Ref 'origin/main' -DictationProvider windows`；首次安裝同時提供前述官方核心路徑。此方案不需 Python、Whisper 或 NVIDIA。設定只存該機 `.local/runtime.json`，不隨 Git 搬到南區。

## 驗收邊界

Windows 10 實機、真正登入及新電腦麥克風仍待當地驗收。工程測試與本機更新結果見 `docs/git-install-update-20261001.md`；不以 Git clone 成功當作全功能驗收。

