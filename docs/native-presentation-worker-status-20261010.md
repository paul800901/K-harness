# 原生內容呈現／歷史子代理假待確認修正（2026-10-10）

**最新：正式版本1b3749e已更新並啟動，驗證完成；下方候選段落保留為當時工程歷史，正式結果見末段。**

## 範圍與現況

本人指出本機交接連結被 K 變成只有標籤，並要求不再默默擋掉原生內容；Pick Me Up 同時出現數百個「模型待確認」，與模型逐筆查核的終態矛盾。本輪修正這兩個已觀察缺口。K 原生權限、帳號／計費、壓縮與真正未知工作不得重播的邊界不變。

**固定程式候選為 1b3749eecf914d4e8c7ac84eda3cfbf2dbaaeaec，正式 K 仍為 a454a8bb。** 未停止／更新正式程式，未恢復小說任務、重派工人、push 或更新東區。舊批未全面修復原生呈現，不能據先前壓縮輔助驗證宣稱全部修好。

## 根因與差異

1. `frontend/main.jsx` 的 URL 預設過濾會消除 Windows 磁碟路徑；舊 SafeLink 再限制只有成果清單可預覽，其餘非 HTTP(S) 目的地僅顯示標籤。圖片元件一律變成「外部圖片未自動載入」，CSP 又禁止網路圖片。這些都是 K 額外加的呈現限制，不是原生模型沒保存檔案。
2. 原生 Markdown URL 保留；Windows 反斜線被 CommonMark 當跳脫符的情況從原文 span 等價還原，支持括號、標題、參考式及巢狀圖片連結，不覆蓋不等價目的地。檔案連結交給既有預覽／完整下載，毋須新 fileChange 或成果登記；圖片接本機檔案讀取／原網址，桌面與已授權手機共用。HTML 保留為可見文字而不是執行，其他 URI 顯示原目的地，不任意啟動 OS 協定；HTTP(S)、mailto、tel 人類點擊可用。這區分內容保留與程式執行，不放寬原生核准。
3. 新 `shared/native-content.mjs`、`src/native-message-file.mjs` 與 `/api/message-file`：要求目前來源聊天室助理原文實際提供該檔案目的地，沿用服務認證及來源對話。只讀該檔案，允許原生提供的工作區外檔案；不把此入口變成任意路徑查詢。原工人工具的 `checkedPath` 不變。新增呈現 MIME 不擴張附件送入模型的圖片種類。
4. `src/native-workers.mjs` 舊版同時查全部歷史子代理，使原生 request queue 過載；查不到便保留 unresolved，因此畫面堆疊假待確認。改為最多 12 筆並行、維持原順序及 parent 歸屬／最新原生回合判定，保留真失敗與未知；每筆原查詢只執行一次，不加 retry、工人重派或任務重播。錯誤原文留診斷。

修改檔案：上述新檔，以及 `frontend/main.jsx`、`frontend/style.css`、`src/conversation-controller.mjs`、`src/desktop-files.mjs`、`src/desktop-server.mjs`、`src/electron-workbench.mjs`、`src/native-workers.mjs`、`src/remote-access.mjs`；測試 `test/native-content.test.mjs`、`test/native-content-ui-probe.mjs`、`test/native-workers.test.mjs`、`test/electron-workbench-permissions.test.mjs`、`test/conversation-controller.test.mjs`。

## 實際證據

工程目錄 `D:\K-harness\.runtime\native-presentation-fix-20261010`。

- 同一 Pick Me Up 原生父對話 `01a11caf-223c-7963-87fe-4628b6553927`、官方 Codex 0.161.0，獨立 app-server 只讀 metadata／最新 summary，無 resume/start/interrupt。`native-fanout-before.json`：461 筆中 259 settled、202 unresolved／error，原生回傳包含 `Server overloaded; retry later.` 與讀回逾時；`native-fanout-after.json`：461 settled、零 error，460 completed／1 failed，322 ms。這重現原因與修正效果；不是把歷史失敗改成成功，也不假定與截圖 234 的每一筆錯誤一一對應。
- Built UI 使用真正 K HTTP 服務＋既有 Chromium，三個 provider 投影 × 1440／390 寬共六組假資料，檔案在假工作區外且無成果事件；Windows／file URI／相對／行號／括號／標題／參考式／巢狀圖片九種預覽及下載與原始 bytes 相符，本機與網路圖片 naturalWidth > 0、HTML／程式碼／其他目的地可見，461 歷史終態不列 pending，不相關路徑拒絕，無 page error。`C:\Users\Paulus\.codex\worktrees\room-lock-fix-20261010\K-harness\.runtime\native-content-ui\result.json` 及六組 PNG。網路圖片由假路由回傳現有測試圖，不外傳正式資料。這不是三家模型真回合驗證。
- 全測第二輪 `full-test-round2.txt`：1152/1152 通過，零 fail；新增後第三輪 `full-test-round3.txt`：1154/1154，零 fail。第一輪 1151/1152，舊測試仍要求 mailto 被阻擋；依新明確呈現需求，更新為允許 mailto/tel 人點入口，同時維持 javascript/data/file/custom 的任意 OS launch 拒絕。失敗原文保留，不放寬其他權限測試。
- UI 初期測試封包缺少 sessions 方法、相對 GET 缺 base URL 等測試自身錯誤保留；Windows 反斜線與網路圖片 CSP 問題則修產品後驗證，不將 fixture 修正當產品修復。

## 複查／未完成

真正官方 Claude Opus 5.5 訂閱、唯讀限制工具，第一輪未发现安全阻擋，但指出括號／巢狀連結還原與討論投影來源比對兩個正常輸入缺口，已修正。追加真 conversation-controller＋discussion-controller 的已存假討論檔案測試，選 B 後讀 A 成功、B／未開房間拒絕；聚焦 40/40 通過。來源／stderr／原始事件／結果位於 `opus-review` 及 `opus-review-round2`；第二輪已確認两項修正正確、無新增阻擋，接受已觀察呈現及假待確認範圍。另採納其最小補充，加入行內括號 title 出處匹配兩個判斷與測試；不增加框架，第三輪 `opus-final` 明確確認這一行補充與最終範圍可接受，真 modelNames=claude-opus-5-5、code=0。

既有預覽／下載仍先整檔讀入記憶體，超大檔案受 Node／記憶體限制；本轮未有實際大檔失敗，不以此擴充另一套下載機制。web 圖片會照原網址向外請求，no-referrer 不等於阻止原 URL 本身含外送參數；這是原生 web 圖片顯示的邊界，不隱瞞。

待複查收尾與固定候選驗證後，再在確認正式工作停止且可還原前提下更新，取得正式畫面讀回。此輪尚未證明所有原生功能完整等價，也不宣稱極長任務偏移或原生 stream disconnected 根因已解決。

## 固定候選驗證收尾（2026-10-10 19:26 臺灣）

固定程式 `1b3749eecf914d4e8c7ac84eda3cfbf2dbaaeaec` 已從 Git 原始位元組準備獨立候選，既有相同 lock 相依複製，沒有安裝或升級。`D:\K-harness\.runtime\native-presentation-deploy-20261010\validation.json`：介面、瀏覽器擴充、桌面啟動器建置均 code=0；固定候選全測 1154/1154，658 個 tracked 來源與固定提交位元組一致、零差異。固定候選 built UI 再跑六組、每組九個連結與三張圖片成功，原始 bytes 一致。

第一次 archive 隨 Git core.autocrlf 轉 CRLF，使嚴格來源比對報 `.claude/settings.json` 不符；不是正式設定被修改。原 `source.zip` 保留，重製 `core.autocrlf=false` 的 `source-raw.zip`；先核对648筆差異全部僅換行，才將自建候選還原為原始 bytes，重新完成全測及來源讀回。證據 `archive-newline-repair.json`，沒有放寬來源比對或動正式檔案。

**已具備更新候選；尚未部署。** 正式版本仍 a454a8bb，K 程式仍開著，已請本人等現有工作結束後「離開並停止 K」。不代替本人強制停止，不恢復／重派／重送任何小說工作。實際更新、程式可退回與正式 UI／歷史計數讀回仍待安全停止後完成。


## 正式更新完成（2026-10-10 19:58 臺灣，取代上方候選停等狀態）

本人明確回覆「正常關閉完成 可以更新」。更新前47831沒有服務，沒有K Node／Electron／原生工人程序；只看到本次診斷自己的PowerShell，未強制結束任何程序。

- 正式程式 **1b3749eecf914d4e8c7ac84eda3cfbf2dbaaeaec**，由 a454a8bb 更新。只從驗證過的獨立固定候選套用，不部署 D:\K-harness 根工作樹未提交內容。
- 程式／啟動器可退回位置 **D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791633196178**。這只是程式退版，不宣稱是對話資料備份。provider家目錄／vault／profiles位置保留，部署前後四份非秘密設定hash、五個目錄身分／第一層項目及其餘runtime設定一致；不讀憑證明文、不改模型／原生權限／計費。
- 原候選1154/1154、真Opus三輪證據仍有效；正式安裝後 **658來源逐位元組零差異**，JS／CSS實際服務資產hash一致。
- 真正式owner：health200、未認證state403；1440×960／390×844認證介面讀回，24個既有聊天室可列，選中thread=null、busy=false、無pageerror、無POST。未開原小說房、未新送模型任務，截圖已檢視。
- 在正式安裝來源再跑相同六組built UI假內容：每組九種本機連結預覽／完整下載與三張圖片均通過。不把三provider投影當三家真模型回合。
- 正式安裝的checkNativeWorkers實際只讀相同父對話461個工人，**460 completed、1 failed、0 unresolved／error，317ms**。無resume/start/interrupt、無任務重播。這是原生真狀態讀回；沒有為驗畫面打開或恢復原小說工作。
- 使用原本Start-K-Desktop.ps1 **只啟動一次**。正式Node父程序PID10456、Electron主程序PID33352、K視窗存在且標題正確、health200；工作台已開啟，不恢復／重送舊工作。
- 第一次啟動讀回錯找Electron的.mjs入口而報not found；实际入口是electron-isolated-main.cjs，由Node的.mjs父程序啟動。只修診斷比對、核對父子身分，未重新啟動或改產品，失敗記錄保留於restart-readback。

證據 **D:/K-harness/.runtime/native-presentation-deploy-20261010**：activation／preserved／formal-source-readback／formal-readback及截圖、native-worker-formal／restart-readback／closeout。只提交這批工程文件；不因此重部署、不push／更新東區、不清理原工作樹或node_modules-root-link。

本輪已部署的是已觀察到的原生呈現及假待確認修正，不宣稱所有原生能力完整等價、上百次壓縮偏移或原生stream斷線已解決。原文／native權限保留；HTML／危險協定不任意執行，大檔記憶體等前述限制仍在。
