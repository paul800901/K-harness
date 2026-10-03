# 多帳號子代理接手研究：Gemini 優先（2026-10-03）

## 使用者要的結果與本輪範圍

使用者有約四至五個 Google AI Pro 帳號，重點是 Gemini 子代理：帳號 A 的子代理額度不足後，以帳號 B 開新的子代理，讀取已完成成果與剩餘工作，繼續處理；主代理不需要換帳號，也不要求原子代理在同一個原生對話內換帳號。GPT／Codex 與 Claude 一併研究，但不是優先目標。

開新子代理交接不是主要障礙；必須先確認新子代理確實使用另一個帳號。多開程序或設定目錄，不能直接當成不同帳號的證據。

本輪是研究與文件，不是實作授權：未安裝帳號管理工具、未登出／登入、未讀取或保存真實憑證、未更改計費、未送模型回合。東區更新仍延後，南區正式 K 不動。前一輪圖片／瀏覽器候選及其他未提交修改保留。

## 結論

| 路徑 | 已查到的能力 | 本輪判定 |
| --- | --- | --- |
| Gemini／Antigravity 原生 | 官方登出、瀏覽器登入及 OS 安全登入儲存；本機 agy 1.2.16 公開 help 沒有逐次指定帳號的參數 | 未找到符合 K 邊界的多帳號獨立選用入口；不宣稱永久不可能 |
| Gemini／Antigravity 第三方帳號工具 | AISW 有帳號保存與切換實作，但會讀存憑證、替換共享登入，並同步設定樹 | 是可研究線索，不是原生多帳號；不能直接安裝或接到正式 K |
| GPT／Codex | 官方 CODEX_HOME 與登入儲存機制可作分帳號啟動基礎 | 可行性較明確；仍須真雙帳號驗證及 K 接線 |
| Claude Code | 官方明確記載各帳號用不同 CLAUDE_CONFIG_DIR | 原生文件最明確；仍不代表目前 K 已有帳號選用 |

因此不先建立四個看似不同、實際同登入的 Flash 工人，也不把子代理交接擴成原生歷史搬移或另一套記憶系統。

## 1. Gemini：原生能做什麼、不能據此推論什麼

### 本機與現有 K

- 本輪只執行 `agy --version` 與 `agy --help`，實際版本 **1.2.16**；公開參數有模型、effort、project、conversation，沒有 account/profile 身分選擇參數。這只是本版本公開介面的查核，不是對所有內部能力的否定。
- `src/gemini-worker.mjs` 的 profile 由工作區及權限決定，`geminiEnvironment` 只分 HOME／USERPROFILE 等執行環境；沒有帳號參數。
- 先前真實研究已觀察到：把 HOME／USERPROFILE 等指到空資料夾仍可取得訂閱回答。因此不能把 K 設定目錄隔離當作登入隔離。本輪沒有重跑真帳號試驗；原證據見維護來源 `docs/antigravity-worker-20261003.md` 階段 0 與修訂設計。
- `src/luna-gateway.mjs` 的派工參數是 requestId／model／effort／task；`src/luna-bridge.mjs` 保存每次工作及結果，沒有 accountId。現有 Flash worker 使用相同 Windows 登入來源。

### 官方查核

1. [安裝與登入](https://antigravity.google/docs/cli/install/)：本機優先用 OS keyring 已保存登入；Windows 使用 Credential Manager。`/logout` 清除保存的登入，後續由本人走官方瀏覽器登入。
2. [CLI reference](https://antigravity.google/docs/cli/reference/)：`/switch` 是切換對話，不是切換 Google 帳號；不能因名稱像帳號切換就直接採用。
3. [IDE extensions](https://antigravity.google/docs/ide/extensions/)：官方描述 CLI、桌面與 IDE 使用統一認證體系。這提示共享登入變更可能影響其他 Antigravity 使用情境；本輪沒有實測每個介面如何更新帳號。
4. [方案](https://antigravity.google/docs/plans/)：Pro 有 Antigravity 使用額度及週期限制。使用者提供「四至五個都是 Pro」是需求背景，本輪未逐帳號驗證資格／剩餘額度，不把數量乘成已確認可用額度。

**可先成立的人工流程**是：所有使用該登入的 Gemini 工作結束後，由本人官方登出／登入 B，再核對帳號與額度，開新子代理接手。這不等於背景自動輪替，而且本輪未實做換帳號。

## 2. 找到的現成工具：AISW，但不是可直接套用的答案

查讀作者的 [AISW 原始專案](https://github.com/burakdede/aisw)，固定研究版本為 `00b4c24895e64234a89df55abfa12655711141ce`（GitHub commit 時間 2026-10-02 20:35:55 UTC）。只有下載公開原始碼與授權文字作閱讀，沒有編譯、安裝、執行 AISW。

作者明說 Antigravity 沒有已知的每帳號 auth root，OAuth 切換取代共享 live session。主代理另外逐項讀原始碼，而非只採信 README 的支援表：

- [antigravity.rs](https://github.com/burakdede/aisw/blob/00b4c24895e64234a89df55abfa12655711141ce/src/auth/antigravity.rs) 的 `capture_live_snapshot` 讀取 keyring 登入秘密及兩棵設定目錄；`persist_managed_secret` 將秘密另外保存至檔案或系統 keyring。
- `apply_live_credentials` 把保存的秘密寫回共享登入位置，並同步 `.gemini/antigravity-cli`、`.gemini/config` 的設定樹。同步包含寫入與刪除差異，不只是選擇一個帳號。
- [system_keyring.rs](https://github.com/burakdede/aisw/blob/00b4c24895e64234a89df55abfa12655711141ce/src/auth/system_keyring.rs) 有真正讀寫系統 keyring 的路徑。這是作者程式的能力，不代表本機四個 Google 帳號已測過。

對 K 的含意：

1. 這是「保存登入後依序切換」的候選方式，不是四個帳號可獨立並行的證明。
2. 與 K 現行「不讀、不複製登入憑證；不改使用者真實 `.gemini`」邊界不同，**研究要求不授權這些操作**。
3. 原樣套用可能連帶變更日常設定、MCP 或其他共享資料；不能只看到 Windows 支援就直接執行。
4. 若日後選這條路，須先限定僅處理使用者指定的 Antigravity 登入，審查保存／刷新／還原與秘密遮蔽，再由本人登入做兩帳號實測；本輪不取得密碼、不碰秘密、不改既有規則。

這次是定位接法及影響，不是 AISW 全專案安全審查，也沒有保證 Google 支援或承諾這種切換方式。

## 3. 沒有採用的替代方案

- **Antigravity SDK**：[官方快速入門](https://antigravity.google/docs/sdk/overview/) 是 Gemini API key，另有 Enterprise／Cloud 認證；不能因此宣稱可把四個 Pro 訂閱交給 SDK 輪替。未安裝、未改 API 計費。
- **回到舊 Gemini CLI**：Google 官方於 [2026-06-18 公告](https://github.com/google-gemini/gemini-cli/discussions/28017)停止個人 Pro／Ultra／free 帳號在舊 Gemini CLI 的服務，指向 Antigravity。不能拿舊 CLI 的帳號目錄方法當成現在的 Pro 方案解答。
- **API key、Enterprise ADC、代理轉接端點**：不是本次使用既有 Pro 訂閱的等價方案，不靜默改用。
- **新增 Windows 使用者／虛擬機**：會擴大系統設定與操作成本，本輪不建立，也未驗證可作 K 的無人值守多帳號入口。

## 4. GPT／Codex 與 Claude：次要比較

### GPT／Codex

- 官方 [環境變數文件](https://learn.chatgpt.com/docs/config-file/environment-variables) 說明 `CODEX_HOME` 指定設定、認證及工作紀錄的根目錄；[登入文件](https://learn.chatgpt.com/docs/auth) 明確指出 `file` 儲存模式把登入資料放在該目錄的 `auth.json`。這提供各帳號由本人分別登入、分目錄啟動的原生基礎，不必讓 K 解析或複製 token。
- 同一文件也提供 keyring／auto 等儲存方式，但本輪查讀的公開說明未明確保證不同 `CODEX_HOME` 的 keyring 身分隔離。本輪沒有讀取實際登入設定或秘密，因此不能直接宣稱目前 K 已用 file，也不能只改目錄就宣稱分帳號完成。
- K 的 `src/isolated-launcher.mjs` 目前設定單一 `CODEX_HOME`，`src/isolated-desktop.mjs` 的主代理及 GPT 子代理沿用同一組執行環境；現有派工參數沒有帳號選擇。

### Claude Code

- 官方 [多帳號登入文件](https://code.claude.com/docs/en/authentication#log-in-with-multiple-accounts) 明確支援每個帳號各用一個 `CLAUDE_CONFIG_DIR`，各自保存設定、歷史與 claude.ai 登入。這是三者中目前查到最直接的原生多帳號說明。
- 官方另列例外：不使用 API key 的 Claude Console 登入不按上述目錄分開；本次要的是訂閱帳號，不把 Console 或 API 計費混入方案。
- K 啟動器目前同樣只設定一個 `CLAUDE_CONFIG_DIR`，也沒有既有的跨帳號 Claude 子代理派工路徑。官方能力不等於 K 已接入。

兩者未來都先用兩個帳號驗證：本人登入後，新程序讀回正確身分，主代理登入不受影響，再以新子代理接手假資料任務；不搬原生對話、不改 API 計費。本輪未做這些真帳號試驗，不先開發次要供應商而偏離 Gemini 重點。

## 5. 新子代理接手的最小設計方向（尚未實作）

沿用現有主代理、工作檔案與派工紀錄即可，不需要複製原生 session：

1. 舊工作 A 確認已結束；若程序是否仍執行不明，先確認，不啟動另一個會重複寫入的工作。
2. 主代理讀取 A 的結果及實際檔案，整理已完成、未完成、驗證狀態。不能要求額度已耗盡的 A 再消耗額度寫交接；也不能只憑 git status 宣稱知道全部內容差異。
3. 確認帳號 B 的登入與使用資格，保持原模型及已選 effort／權限，不因帳號有不同模型清單就暗換型號。
4. 以新的 requestId 開 B 的新子代理，只交剩餘任務與必要檔案。新工作可記錄前一工作 ID，但不把相同 requestId 當成重送入口。
5. 主代理照原方式接收結果、驗證並回報。這不是整份原工作重播，也不是原生對話跨帳號移轉。

現有 `geminiOutcome` 把額度不足與速率限制一起呈現為失敗訊息，沒有可靠的輪替分類。後續若實作，須先分清可確認的帳號額度不足、短暫速率限制、網路錯誤、登入問題與權限拒絕；不能對所有失敗一律換帳號。這只列必要前提，不在研究階段新增重試器或排程系統。

## 6. 下一步判斷

優先順序維持 Gemini，不因 Codex／Claude 接法較清楚就先替使用者開發不重要的部分。

- 若維持「K 及輔助工具完全不讀存登入憑證、不動共享設定」，目前只有官方人工重登的候選路線，不能承諾四帳號背景自動接手。
- 若願意另行授權限定的本機登入保存／切換，可再審查 AISW 或更窄的接法，**先做假資料試驗，再由本人登入兩個帳號驗證**；先不用四至五個帳號全部加入，也不做大管理介面。
- 不論選哪一條，都應以「另一個帳號的新子代理接手」為核心，不做同一代理執行中熱切帳號。

## 驗證、檔案與部署狀態

- 本輪產品程式修改 **0**；新帳號登入 **0**；真模型回合 **0**；安裝／部署／push／tag **0**。
- 已執行：本機 agy 版本與公開 help 讀回；現有 K 派工與登入接線閱讀；官方文件及指定 AISW 原始碼閱讀。
- 未執行完整測試：本輪只有研究文件，不改產品。前一輪 586/586 是圖片／瀏覽器候選的證據，不算本次多帳號驗收。
- 公開資料及本機 help：`D:\K-harness\.runtime\multi-account-research-20261003`；沒有真實 token、密碼或登入快照。
- 新增本紀錄，更新 `docs/development-log.md` 索引；維護來源為 `C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`。根目錄 `D:\K-harness\docs` 只同步這份新紀錄及索引，不覆蓋舊實驗工作樹。
