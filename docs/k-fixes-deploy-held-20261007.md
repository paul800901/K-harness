# 南區三項 K 修正：已套用、保持關閉（2026-10-07）

## 結論與授權

使用者先交代「關了K，上線修好這幾樣」，隨後追加「修好後先別開，另一邊也要修」。本批已套用程式，**未啟動 K、未 push、未更新東區**；交由另一批 Gemini 修正整合後一起驗證。這不是正式執行／三真 Chrome profile 全部通過的宣告。

## 固定版本與來源

- 正式程式 commit：**c8942217303cb5f03471994ec4b91b8fddb1d14e**。
- 開發來源：`D:\K-harness\.runtime\chat-links-20261007\source`，分支 `codex/k-diagnostic-fixes-20261007`；先前純文件 HEAD 為 `2a14b2917c1c5ca8c3019e6b30cd0391b51b12f5`。整合此版本時須保留祖先中的 `c7bb4cedf390fa0e0d9a828b8138b5f4458f3856` 左鍵修正，不只摘取最後一個 diff。
- 套用位置：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\trusted-runtime`。
- 舊正式版：`e068ffa4dcc7d0da57e73d72a98111e925975fe4`。未部署主工作樹的髒版本，也未使用舊 `prepare-chat-links-c7bb4ce`。
- 2026-10-07 **21:20:11 台北時間**套用完成；**21:20:57**核對全部 569 個正式 tracked 檔與固定 Git archive 相符（部分僅 CRLF/LF 不同，無內容差異）。`.local/runtime.json` 指向上述程式 SHA，語音及 Node 路徑保留。

## 三項內容與實際更新範圍

1. **聊天室連結**：納入先前未上線的 HTTP/S 左鍵外開修正，以及右鍵「複製連結網址」。保留 URL query／fragment、原文字選單與導覽／非網頁協定防護。已完成候選真 Electron／建置 UI 的隱藏測試，shell 被攔截；本次按使用者要求不啟動正式 K，**正式 OS 外開／右鍵操作仍待整合後驗收**。
2. **多 Chrome 設定檔**：每個 profile 的本機固定 ID、獨立描述檔與驗證路由；AI 工具可列出／指定 profile，工作不因其他 profile 重連而換帳戶。可持續新增帳戶設定檔，不寫死三個。未新增人用設定面板、輪詢或備援管道。
3. **Codex 診斷**：限量／去敏事件與 stderr 分類蒐集；精確工程警告不常駐一般 banner，原事件保留。**歷史 SQLite 寫入失敗原因仍 unknown**，本批不是 SQLite 根因修復，沒有修改 DB／WAL／SHM 或送 feedback。

完整根因、契約、取捨、未驗證內容及兩輪真正 Opus 5.5 審核，見 `D:\K-harness\docs\k-fixes-candidate-20261007.md`；最初唯讀診斷見 `D:\K-harness\docs\k-diagnostics-20261007.md`。

## 實際 vault host 與 installed 擴充已一起對齊

- 註冊仍是 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.k_harness.browser_assistant`，仍指向 vault 原 `com.k_harness.browser_assistant.json`。
- 更新 **實際** `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\k-browser-native-host\host.mjs`，讀回與新正式 `scripts\k-browser-native-host.mjs` 完全相同。未盲跑會改註冊路徑的 Setup-K-Browser。
- 更新 `D:\K-harness\installed\k-browser-assistant` 至 **0.1.3**，所有新建置產物逐檔 hash 與正式 dist 一致；同一 manifest key／extension ID `jhbfglfjhiebacbkjnohgmpgcppadblm`。
- 原生 manifest、host.bat、config、既有 K Codex config 與 Start-K-Desktop.ps1 的 hash 均未變；沒有讀取／複製 Chrome cookie、密碼或帳號資料。
- **檔案已更新不代表 Chrome 已載入。** 本次未 reload／關閉使用者 Chrome；原三個 host PID 35616、31932、32960 仍存活，仍是先前已載入程式。未以磁碟版號冒稱三 profile 連線成功。0.1.3 的 storage 權限如需 Chrome 確認，由本人處理，不代按核准。

## 保留與退版

- 程式、啟動器及設定退版位置：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791379211228`。
- 瀏覽器程式備份：`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\browser-program-before-1791379211175`，含原 host.mjs、installed 0.1.2 與安全讀回。
- **退版須對齊上述兩組程式，不只退 trusted-runtime。** 如需退版，先確認 K 已停止，使用既有 runtime rollback，再恢復原 host／installed 程式檔；不得回復／搬移登入或對話資料。這些是程式可退回版本，不是使用者資料快照。
- 未停止任何既有 native Chrome 程序、未重播工作、未強制結束其他程序、未搬資料、未改全域／防護／權限。主工作樹八個原有髒檔 hash 維持，工程索引只追加。

## 建置與驗證，以及保留的失敗

- 從固定 Git SHA 新建乾淨 prepared，複製候選既有相依，lockfile 相同；未 npm install／下載或升級環境。UI、extension、launcher 建置成功。
- Windows tar.exe 初次解 UTF-8 中文檔名失敗，保留該新建 prepared／archive，正式未動；改走專案更新器既有 Git ZIP＋Expand-Archive 流程。
- 新 prepared 預設並行全測 **962/963**：`codex-capacity-fallback.test.mjs:130` 在限時持久化讀回仍見舊模型；之前三次 turn/start 與 Sol 呼叫斷言已通過。這不是本批修改的程式／測試，負載下限時讀回是合理假設，底層原因未確認，不能歸因 SQLite 警告或 Gemini 真執行。保留原失敗，不改 assertion 或掩蓋。
- 該 fake-flow 獨立測試 **22/22**；相同未改動 prepared 以四個測試檔並行完整回歸 **963/963**，fail／skip／cancel=0，49.384 秒。此前候選也已 full 963/963 與真正 Opus 5.5 兩輪審核。
- 套用前、後均確認 47831 無 listener，無 trusted-runtime K 工作程序；僅三個既有 Chrome native host 保持。**沒有启动正式程式來驗收。**
- 證據：`D:\K-harness\.runtime\k-fixes-20261007\deployment` 的 `prepared.json`、`activated.json`、`formal-source-readback.json`、`processes-after-activation.json`、失敗／成功 test logs。來源與部署快照不含 token／完整提示詞。

## 接續 Gemini 批次的必要驗收

1. 以固定 c894221 與 Gemini 固定版本整合，完成整合測試及真正 Opus 5.5 複查，另記**整合後**程式 SHA；本批 SHA 不冒充含 Gemini PATHEXT 修正。
2. 在保持 K 關閉下交接正式目錄，避免兩邊同時改；保留本輪與下一輪退版位置，確認實際 host／installed 擴充仍與整合版相符。
3. 三個真 Chrome profile 載入 0.1.3 後，使用 K 的 `browser_profiles` → 每 ID `browser_session` → 無敏感 sentinel／公開讀頁，驗證「選誰、讀到誰」；profile ID 不直接等於 Google 帳號，需要可靠對應，不可把一個測試頁當三個全通過。
4. 整合後正式 K 左鍵外開、右鍵精確 href 與原文字選單驗收；正常 native host 接線／安全診斷路徑讀回，不刻意鎖正式 DB 製造警告。
5. 使用者最新要求是**先別開**；是否啟動／發布以後续人類指示及另一批明確授權為準。本批沒有 push，GitHub／東區仍未更新。
