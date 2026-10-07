# 三原生核心附件交付修正候選（2026-10-08）

## 結論與授權

使用者要求依真正 Opus 5.5 建議修好、實測討論，然後停止等待；**不更新現有 K，不重啟／停止翻譯，不部署、不 push、不更新東區**。本批是獨立候選工程，不是正式驗收或發布。沒有安裝／升級、改全域設定、改訂閱計費、保存／切換帳號或搬憑證。

K 的契約不是三家格式的交集或聯集：**保存完整原檔，依各核心原生入口交付；是否讀懂由該核心實際能力與回應決定。** 不新增全域副檔名白名單、能力資料庫、轉檔／OCR、重試／換模、服務或人用設定。

- 正式基線：`4a6c482f2df01e1b31216cffc9ec7a98088bdee9`。
- 候選工作樹：`C:\Users\Paulus\.codex\worktrees\mobile-image-upload\K-harness`，本批分支 `codex/native-attachments-20261008`。
- 基底包含上一批手機 picker 修正程式 `2073a6bbee0d81e1412988f5c6ad4859503ac50e` 與文件收尾 `7ea292263ad1ed2a7d6e6184ff72c1a71d01aacc`，詳見 [手機 picker 候選](mobile-attachment-picker-20261008.md)。
- 本機完整原生證據與限定測試腳本：`D:\K-harness\.runtime\native-attachments-20261008`。未刪除測試檔、失敗紀錄或原生計畫。

## 最小修正及檔案

產品僅兩處：

1. `src/gemini-controller.mjs`：刪除未知型號圖片的 K 自製拒絕閘門。Gemini 只交原檔路徑，由原生檔案工具判斷；保留「不代表模型已驗證此模態」提示、來源對話驗證、既有 PDF 路徑選擇與已驗證媒體指引。
2. `src/claude-controller.mjs`：附件有 `warning` 時，在既有 `<K_ATTACHMENT>` 加入經既有 escape 處理的 warning 屬性。PDF／DOCX 擷取文字不再失去「不保證圖片／版面完整」資訊；原檔、擷取文字與 image block 入口不變。

測試：`test/gemini-controller.test.mjs` 更新原有未知型號案例，驗證不被 K 擋住、交付原檔路徑且不冒稱能力；`test/claude-controller.test.mjs` 補擷取失敗 warning 與原檔保留案例。`desktop-files`、Codex 原生模態檢查、三家權限與模型路由不改。

## 真原生測試，不能混同 UI 模擬

每家都走 K controller 的 `uploadStream`、`send` 與實際官方原生核心，新建獨立工作區／對話。每份保存檔實際 bytes 與來源相等；原生事件及交付紀錄已保存。

同批 PNG、PDF、未知 `.kdat`、MP4 視覺代碼為隨機值，只在檔案內容，不在檔名、模型提示或 metadata；expected 檔不在模型工作區。基線／候選使用同一組檔案做比較，不宣稱每回合重新產生。WAV 用現有 System.Speech 合成固定句，**不是盲隨機 token 測試**。PDF 第 1 頁為文字，第 2 頁只有點陣圖；第 2 頁代碼在 pypdf 文字層及所有 K `content.txt` 都不存在。

| 核心／限定型號 | PNG | 混合 PDF | 未知 `.kdat` 文字 | WAV | MP4 |
|---|---|---|---|---|---|
| Codex 0.160.1，指定 GPT-6 Luna／low | 完整代碼、藍圓正確，localImage | 只讀到文字頁；明說未看到第 2 頁 | 正確，原生唯讀指令 | 讀出二進位，未轉錄；明說未知 | 未測 |
| Claude 2.1.292，Opus 5.5，基線 | 正確，base64 image block | 原生 Read pages 1–2，點陣代碼與橘方形正確 | 正確，Read | Read 明確拒絕 binary WAV | 未測 |
| Claude 2.1.292，Opus 5.5，修後候選 | 原生計畫報告正確 | 原生 Read pages 1–2；計畫報告點陣代碼正確 | 原生計畫報告正確 | Read 同樣拒絕；計畫明說未知 | 未測 |
| agy 1.3.1，Gemini 3.8 Flash／low | 正確 | 兩頁及點陣代碼正確 | 正確 | 合成句正確 | 兩個代碼、紅方形→綠圓順序正確 |

- Gemini 五檔均為原生 `view_file`；init 明確回傳 `gemini-3.8-flash-low`。Claude assistant message 明確回傳 `claude-opus-5-5`、官方 firstParty 訂閱。
- Codex `turn/start`／K state 指定 `gpt-6-luna`，modelChanges 空；app-server 本次沒有獨立 actualModel 欄位，不補造。這回合的 PDF／WAV結果**不是 Codex 的格式能力硬上限**，可能只是本次工具選擇；不重試、不加強制渲染／轉錄或跨核心備援。
- Gemini 目前官方清單只有 3.8／3.7／3.6 Flash、3.1 Pro，都在原已驗證名單。沒有可測未知型號；未知型號放行是單元 red→green，**尚無未知型號真實驗收**。
- 本批未窮舉所有格式；GIF／HEIC 等仍可存原檔與交路徑，但不能聲稱任一核心已讀懂。ZIP／DOCX 等手機 UI 原檔接納證據與真正模型理解證據分開。

### Claude 候選 plan-mode 限制（完整保留）

修後 Claude 的 PDF 原生 Read、PNG／PDF／kdat 正確代碼已出現在原生 `ExitPlanMode` 計畫內容與 K 核准事件，**不是最後聊天文字**。模型讀完後自行使用原生 Write，在其既有 K 專用 Claude 家目錄 `plans` 產生一個測試計畫；這不是正式程式、權限設定或翻譯檔。測試 handler 拒絕離開 plan mode，不放寬權限，沒有重送。最後聊天只說核准被拒，不包含代碼。

因此 `native-summary.json` 保留 final tokenHits=false 與 nativePlanTokenHits=true 的區別；不把它包裝成修後最終聊天報告完整通過，也不宣稱完全無寫檔。原生測試皆已 close；原生計畫與歷史留存。這一次 plan-mode 行為不證明 warning 是原因，亦不構成本批擴張通用計畫 UI／核心流程的依據。

## 驗證與保留的失敗

- `regression-red.txt`：兩個回歸在修改產品前均失敗，分別確證 Gemini 自製閘門與 Claude warning 缺失。
- `regression-green.txt`：兩份 controller 測試 **117/117**。
- 首次預設並行全套 `full-tests.txt`：**964/965**，唯一失敗為無關 browser-native-profiles 重新連線 descriptor token 競態；未更改該來源或測試，沒有刪失敗。
- 同一 browser 套件獨立 **3/3**；完整限制併發 `node --test --test-concurrency=2 test/*.test.mjs` **965/965**，71.632 秒；證據 `full-tests-bounded.txt`。
- `npm run build:ui` 通過；只有原本大型 bundle 警告，不順手拆分。
- 本批重跑真正瀏覽器 File／XHR＋K 保存、模擬 SSE／controller 的手機 viewport probe：**13/13**，10 種 suffix 原始 bytes 正確；`mobile-ui-regression.txt`。**不是真 Android 手機／三家核心測試**；真手機選檔驗收仍需更新後本人操作。
- `git diff --check` 通過。

## Opus 討論與取捨

先前真 Opus 建議：`D:\K-harness\.runtime\attachment-contract-opus-20261008\discussion\review.md`，官方 2.1.292／Pro／firstParty、實際 `claude-opus-5-5`，session `4ad0000f-446d-499d-b050-1e56403feb46`。

本批最終真正 Opus 5.5 複查：官方 Claude Code **2.1.292／Pro／firstParty**，assistant 實際模型 **claude-opus-5-5**；session **5e66decf-5a85-4062-972e-cc82879539ee**，success／exit 0，13 次只讀工具呼叫。證據 `final/result.json`、`final/review.md`。

- Opus 同意兩個修法正確、測試針對缺陷、沒有過度工程化，**無阻擋缺陷，固定候選後停止等待**。
- 不改一次樣本的 plan-mode 通用行為；不把 warning 修正說成改善模型答案的因果證據（基線本來就會讀 PDF 原檔），修法依據是已證明的資訊遺失。
- 不把本次 GPT 工具選擇當原生能力上限；Gemini 未知型號沒有真測就明列未知。
- 採納查相同自製閘門的建議，本批已 grep `src`／`frontend`，同錯誤字串不再存在；Gemini controller／worker 無其他等價圖片模態拒絕。Codex 明確原生模態檢查仍保留，不能混同。
- Astra 獨立核對本批四檔 diff、native delivery／原生 Read/view_file 路徑與結果、Claude 計畫核准/拒絕證據、正式來源仍相同，再採納；沒有依 Opus 建議新增系統。
- Opus 收回先前「容量接手是暗換模型」與「隨機碼答錯即捏造」兩個說法；既有容量接手有先前授權、本批未發生，OCR 誤差亦須與冒稱已讀分開。

## 固定版本與停止讀回

本批固定候選程式 **972963e12a4fa35b7e32a089490c17a57434be80**，只含上述兩份產品來源與兩份測試；手機 picker 基底一併在歷史中。程式與本檔／development-log 文件收尾分成不同 commit；文件-only 不代表再部署。文件收尾完整 SHA 另存本機 `closeout.json` 與最終回報，不將文件自身 SHA 回寫產生循環。

正式 `.local/runtime.json.version` 仍 `4a6c482f2df01e1b31216cffc9ec7a98088bdee9`；七個相關正式來源逐一比對該基線相同（`formal-unchanged.json`）。本輪未呼叫正式部署、supervisor停止、重啟、push 或帳號切換；沒有為候選建立排程。

**僅候選實作／測試，等待使用者，不部署。** 後續更新必須依本人新指示、確認翻譯工作告一段落及可安全更新，再依固定版本流程處理；本輪不預先排程或自動發布。
