我只讀了審查封包裡的檔案。結論：**沒有阻擋性的正確性或安全問題**。有 1 個中度相容性問題值得修，另有 2 處重複檢查可以直接刪。

## 值得修

**1. 中度：選定的核心檔不見時，K 正式入口會直接啟動失敗**
- 位置：`current/src/core-updates.mjs:14`、`:17-18`、`:25`；呼叫點 `current/src/isolated-launcher.mjs:60`。
- 情況：`selected-cores.json` 指向的 exe 如果被防毒隔離或手動刪掉，`realpath` 會丟出原始的 ENOENT。JSON 壞掉時也一樣會丟錯。這段在啟動時、沒有任何保護下執行，K 會整個打不開。
- 錯誤訊息沒有提到 `selected-cores.json`，使用者不知道刪掉這個檔就能恢復成原核心。
- 建議最小修法：讓錯誤訊息寫出這個檔案的完整路徑，並說明「刪除此檔即回到原核心」。不需要做自動回退或修復機制。

## 可刪的重複檢查

**2. `core-updates.mjs:93` 重複解析版本**
`inspect()`（第 79-83 行）已經回傳 `versionOf(stdout)`，第 93 行外面又包一層 `versionOf(...)`。沒有害處，但多餘，可以刪。

**3. `core-updates.mjs:101` 重複的目錄範圍檢查**
`downloadCoreRelease` 在第 77 行已經用 `selectedFile(directory, …)` 確認檔案在下載目錄內。這個目錄是第 99 行在 `root/updates` 底下 `mkdtemp` 建立的，第 101 行再對 `root` 檢查一次不會多擋到任何情況，可以刪。

## 低優先，可以不修

- **失敗的下載目錄會留著**（`core-updates.mjs:99-102`）。校驗或讀版本失敗時，`updates/<provider>-<ver>-xxxx` 和可能上百 MB 的檔案會留下。這不影響正確性；要清理的話在失敗時加一行刪除就好。
- **Codex 的 `-c check_for_update_on_startup=false`**（diff 的 codex-host 那段）。我推測這個設定只影響 TUI，對 `app-server` 可能沒有作用。你們說真 Codex 初始化已通過，所以這個參數至少不會出錯，留著無害。

## 我檢查過、看起來沒問題的部分

- **API 路由**：`/api/core-update` 走在 cookie、Origin、`X-K-Request` 和 JSON 檢查之後（`desktop-server.mjs:97-98`、`:136`），provider 也有用 `Object.hasOwn(names, …)` 做白名單。
- **下載來源**：下載網址是固定的供應商主機，或經過正則檢查（`:44-61`）。進資料夾路徑前會先驗證版本格式（`:95`）。先比對雜湊、再用 `--version` 讀回，兩項都過才寫入選定檔，而且用的是 `atomicWrite`。
- **新核心不會即時替換**：選定檔只在啟動時讀一次，`active` 在本次程序中固定不變；`close()` 會中止正在進行的下載並等待結束。
- **舊檔保留**：只留一個 previous 指標，舊檔都不刪。Gemini 第一次更新時只複製共用的 exe，不會改動原安裝或登入資料。
- **背景更新關閉**：Claude 的 `DISABLE_AUTOUPDATER` 同時加在 host 和 login 的環境裡。Gemini 的 `AGY_CLI_DISABLE_AUTO_UPDATE` 加在 `geminiEnvironment` 裡，那裡的環境變數是白名單，所以不會被其他設定蓋掉。
- **介面**：只有三個按鈕、一個 busy 狀態和結果訊息，沒有輪詢或通知，沒有過度設計。

## 實際讀過的檔案

- `changes.diff` 全部
- `current/src/core-updates.mjs` 全部
- `current/frontend/core-updates.jsx` 全部
- `current/src/isolated-launcher.mjs` 全部
- `current/src/isolated-desktop.mjs` 全部
- `current/src/desktop-server.mjs` 第 36-150 行
- `current/src/gemini-worker.mjs` 第 160-189 行
- 在 `current/` 裡搜尋 `geminiExecutable|K_GEMINI_EXECUTABLE|coreUpdates|core-update`

沒有讀：兩個測試檔的內容（只看到搜尋命中的行）、investigation 文件，以及 claude-host、claude-login、codex-host 在 diff 以外的部分。

## 沒有實測、需要 Astra 或現場確認的地方

這份 review 只是讀程式碼，不能當作測試結果。

1. **用新核心重新啟動後的實際使用**：寫入 `selected-cores.json`、重開 K，再用新的 Claude、Codex、agy 真的跑一次工作或登入。封包裡只有下載和 `--version` 讀回的證據，沒有這一段。
2. **Codex 改用直接執行 `codex.exe`**：原本經由 npm 啟動時，`vendor/.../path`（裡面有 `rg`）會被加進 PATH；直接執行就不會。模型在 shell 裡呼叫 `rg` 可能因此失敗。請確認舊的 `trusted-providers/codex/` 原本怎麼處理這件事。
3. **Gemini 登入用的是哪個 agy**：`gemini-login.mjs` 不在封包裡。如果它不是透過 `geminiExecutable(env)` 找執行檔，登入時會用舊的共用 agy，工作時則用新版。
4. **agy 從非標準位置執行**：新版 agy 放在 `trusted-providers/updates/...` 底下，它在這個位置的 print、models 和登入行為都沒有驗證過。

補充：這次是規劃模式，但我手上沒有寫檔工具，所以沒有建立計畫檔；我沒有改動任何檔案，也沒有執行任何程式。

---

# 修正後補查原文

我複查完了，**沒有剩下值得修的問題，也沒有過度設計**。這次只讀了封包裡的檔案，沒有執行任何程式，也不能當作實測。

## 上次的建議都已處理

- **選用紀錄或核心檔讀不到**：`core-updates.mjs:28` 的錯誤訊息現在會寫出 `selected-cores.json` 的完整路徑，也說明要依紀錄退回該核心。錯誤會帶著原始原因，不會自動換回舊核心。
- **重複的版本解析已刪**：`:103` 直接比對 `inspect()` 的回傳值。
- **重複的目錄檢查已刪**：`downloadCoreRelease` 最後只留 `selectedFile(directory, …)`（`:79`），這才是真正的來源檢查，下載完後沒有再對根目錄檢查一次。
- **關閉時的取消檢查**：`signal.throwIfAborted()`（`:114`）緊接在 `atomicWrite` 前面，兩者之間沒有 `await`，所以 K 關閉時不會在中間寫出半套選用紀錄。
- **Gemini 登入用的 agy**：`gemini-login.mjs:18` 和 `gemini-worker.mjs:171` 都透過 `geminiExecutable(env, …)` 找執行檔，而它會先讀 `K_GEMINI_EXECUTABLE`（`gemini-worker.mjs:12`）。所以查額度、列模型、`--version`、登入和實際工作都用同一個 agy。登入時 `Start-Process` 會沿用子程序的環境，背景更新的關閉設定也會一起帶過去。
- **失敗的下載保留、不新增清理器**：這符合你們的刪除規則，我同意。
- **Codex 啟動方式**：你們已用官方完整包和現行 wrapper 確認，我撤回上次對 PATH 的推測。

## 看到但不建議修

- Gemini 的「更新」只會更換已存在的 agy。如果本機根本沒有安裝，按下更新會直接出現執行檔找不到的錯誤。這是更新功能，不負責安裝，維持現狀即可。
- 選用紀錄壞掉時，`update()` 開頭也會讀到同一份壞紀錄並出錯。不過這種情況下 K 啟動時就會先停下來，實際上走不到這一步。

## 仍需現場確認

上次列的第 1 項和第 4 項還沒有實測證據：

- 用新核心重開 K 之後，Claude、Codex、agy 實際跑一次工作。
- 新位置的 agy 實際登入。

你們已經寫明這一輪沒有驗 Google 人工登入，這樣寫是正確的。

## 實際讀過的檔案

`changes.diff` 和 `current/src/core-updates.mjs`、`current/src/gemini-login.mjs` 都讀了全部。另外在 `current/` 裡搜尋了 `geminiExecutable` 和 `K_GEMINI_EXECUTABLE`。

這次是規劃模式，但我手上沒有寫檔工具，所以沒有建立計畫檔，也沒有改動任何檔案。