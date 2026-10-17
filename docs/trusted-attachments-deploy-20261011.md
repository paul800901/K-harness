# 附件可信投影與 remote compact 提示正式安裝（2026-10-11）

## 授權與部署界線

本人本輪要求真正 GPT-6.1 Sol 先安裝已驗收新版，再查三項根因，並明確確認 K 已關閉、目前使用 Codex App。Astra 將本段限定為**先部署**，根因調查另分派；沒有沿用過往部署權限自行擴大。程式／測試 `0b345a08a1032ee1f22cfccfc5143e2e8bb21465`、候選文件 HEAD `92a11c4337ed4a4c8d6c19b1ee77c5efd3f6ce25`，此前真正 Opus 首審blocking補修後增量無blocking、Astra獨立驗收，最終回歸1187/1187，本段不重做無目的複審或全測。

**正式已安裝 `92a11c4337ed4a4c8d6c19b1ee77c5efd3f6ce25`（產品來源0b345a0），完成限定安裝／呈現／只讀附件讀回，日常 K 保持關閉。** 沒有 resume/start/stop 原小說、恢復目標、重送、push或更新東區。本人實際重開／操作原書分支仍由本人確認，沒有把唯讀投影當實房續行。

工程來源只用 `C:\Users\Paulus\.codex\worktrees\room-lock-fix-20261010\K-harness`，不修改 `D:\K-harness` stale/dirty產品來源；D盤只更新既有正式runtime、根啟動器／runtime設定及新增部署證據。兩個已知untracked `node_modules-root-link/`、`test/fixtures/descendant.pid` 保留、不提交、不清理。

## 正式操作及可退版

證據根：`D:\K-harness\.runtime\trusted-attachments-deploy-20261011`。

1. `stopped-process-inventory.json` 與套用前 `pre-activation-recheck.json`：正式47831無listener、K base／supervisor／Electron／供應商工人與其他部署無匹配程序，無Running K服務。Codex App自身程序／沙箱服務未觸碰，没有強制停止。
2. 從固定92a11c4輸出獨立prepared；固定Git來源的 package／lock與既有installed位元組完全相同，複製現有standalone node_modules（robocopy exit1成功），未安裝套件或改Node／登入／憑證。UI、extension、launcher建置code0；installed聚焦附件／main／notices／capacity **61/61**。沒有再次跑整套1187或舊模型回合。
3. 沿既有 `activateRuntime` 交易切換。原be1d976程式、launcher、Start-K-Desktop、settings保留於 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791653705579`。這是程式退版，不是聊天備份／還原；agent-home、private-state、profiles、providers原處保留。runtime.json除version／previous外不變。
4. `installed-source.json`：**665固定來源檔全部逐位元相同，零差異**。正式runtime為原既有trusted-runtime路徑；root launcher及entry由同prepared交付。`activation.json`、`preserved.json` 保留完整路徑及設定讀回。

## 限定正式讀回

- `formal-readback.json`：真正正式owner與實際served JS／CSS hash相同，health200、未登入state403；headless桌面1440×960／手機390×844，25房metadata可列出，分支原ID／user／forkThrough／未封存保留。視查兩尺寸截圖正常；controller始終未選房、idle，API POST0、pageerror0，手機只展開側欄，不開小說。這不是啟動日常Electron視窗；無搶前景。
- `installed-real-branch-readonly/result.json`：使用**已安裝**的controller及host，只把明列Pick parent／child metadata複製工程假根、exact兩ID native thread/read、onHistory截止。只恢復native歷史實際引用第一張附件，preview／完整原檔hash一致，未引用第二張拒絕；原兩房metadata、兩附件bytes與record前後不變，0模型回合、沒有resume/start/stop，未保存或輸出小說原文。沒有把上傳區存在的第二張擅自加回卡片。
- `installed-stream-ui/result.json`：已安裝built assets，純假snapshot的一般stream／remote compact×桌面1440／手機393共 **4/4**；精確中文「原生壓縮」提示、原始error/request ID、willRetry、部分進度、手機已連線保留，0POST／pageerror。視查手機摘要，原始詳情入口保留；不表示上游stream根因已修。
- `final-preservation-stopped.json`：**73個 main-session 檔案 hash 全部不變（正式UI列出25房）**；臨時owner、preview及native唯讀host正常關閉，沒有K程序及47831／5199listener，沒有強制停止，日常K不重開。

## 失敗／副作用如實保留

- 初始依賴檢查錯用working checkout raw hash，CRLF不同但固定Git blob相同；在輸出／copy前中止，`prepare-initial-raw-lock-mismatch.json` 保留。後改比對fixed Git來源與installed精確bytes，不改套件。
- Git archive依現行autocrlf產生655個tracked文字CRLF，舊validator只准extension生成檔換行故先拒`.claude/settings.json`；未套用正式。逐檔核對**只有換行差異**後，prepared還原成固定Git bytes，記於 `validation.json`／`validate-fixed-source-bytes.mjs`。不是改權限規則或任意放行來源差異；正式665檔再核對零差異。
- activation時Gemini帳號metadata hash不變；正式idle UI既有自動usage查詢使 `gemini-accounts.json` 在01:35:57更新。唯一新query時間為當前帳號，其他4筆仍舊，loginPending=null、uncertain=false；這是既有官方額度查詢／auth timestamp cache路徑的可見副作用，不宣稱該檔全程未變。沒有手動登入、保存／切帳號或搬憑證。部署前只留此檔hash，未保存原JSON，所以全欄位／account ID前後相等缺少原值逐欄證據；不猜、不回寫舊cache。選定core、Codex config、projects及兩書房metadata hash均仍一致。

## 尚未完成／下一段

本段只完成安裝與限定正式讀回。長任務偏移、上游stream／remote compact失敗與正常close根因仍UNKNOWN；沒有因此改產品或診斷協定。本人實際書房操作確認尚未執行。Astra另有關閉現場的read-only overload／thread/read時序線索，交下一段查證，不當本段已證明唯一根因。

Astra已獨立讀正式runtime、activation、665來源與各讀回receipt，逐檔核9個已審source／test與installed正規化換行相同、視查手機圖及當前兩port無listener，裁定**本批正式部署驗收通過**。原房仍僅只讀clone；Gemini cache沒有before欄位內容，不宣稱只改特定欄位。
