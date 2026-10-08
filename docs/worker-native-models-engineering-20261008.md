# 子代理快覽、動態原生模型與 Claude 工人整批工程（2026-10-08）

## 最新授權與狀態
使用者要求真正 Opus 5.5 共同討論、複查正確性與過度工程化，並與前面未更新的手機附件、三核心附件、原生子代理終態喚醒一起更新。本輪使用者臨時派工時已停止部署；隨後明確表示「K停止了，你等等可以直接更新」。不強制關閉、不恢復／重派暫停目標、不 push、不更新東區、不改登入或計費。

候選沿用 C:\Users\Paulus\.codex\worktrees\mobile-image-upload\K-harness，基底48e6d40973eea14c6a7e0737e07f9f20d4c3b2bf；正式更新前基線4a6c482f2df01e1b31216cffc9ec7a98088bdee9。此文件建立時尚未交換正式程式；後續正式套用與讀回另追加在本檔，不把候選當正式。

## 使用者可觀察的改變
- 上方保持原有點擊彈出方式，只看本聊天室未結束且仍有執行歸屬的子代理；名稱用暱稱／工人識別碼，旁邊只列健康、等待、近期活動或未知，不列派工指令、模型、原始工具及歷史。
- 主代理待命、子代理仍活著時明確顯示仍在工作；mixed 狀態不冒稱全在執行。久未回報不判定卡死／空燒 Token；離線保留最後列但標未知，不用假的0。已知零為非點擊提示。
- 右側子代理維持次要詳細頁，按需看來源、型號、任務、交付、最近工具、最後讀回、錯誤及歷史查核；其他聊天室不混入。查看不改原工單、不停止背景工作。
- 子代理第一項保留 AI 自動選擇；手選按 GPT／Claude／Gemini 分組，取目前本機原生目錄、實際已接路線，不再固定 Sol／Luna／Flash 三款。高階模型也可作限定第二意見，角色不是能力排序；手動設定／當輪指定優先，不加 K classifier、排行、評分或失敗換模。
- 本輪實讀可選21型號：7 GPT、10 Claude（含Opus/Sonnet/Haiku5.5）、4 Gemini家族。Haiku4.5 dated ID沒有effort→null，Haiku5.5有五項effort；Gemini3.1Pro只low/high。Fable因額外計費未授權排除；語音Alpaca不編造ID。既有已保存但目錄消失的設定保留、拒絕新執行，不暗改auto。

## 最小實作及範圍
src/worker-policy.mjs、frontend/model-picker.jsx移除固定模型/effort清單；現有unified catalog供兩家主核心產生逐模型派工指示。GPT的native agents只接GPT，非GPT不寫入default_subagent_model。Claude主核心已帶MODEL_ROLE_GUIDANCE，不重複附第二份。

新src/claude-worker.mjs是唯一新增執行器。一個有範圍task→一個原生Claude session，沿既有luna bridge/gateway/records/process handles、核准、查詢、取消及完成事件；不新增MCP框架、registry、目錄cache、後端輪詢或模型管理頁。GPT用既有k_gemini/gemini_start派Gemini或Claude，保留名稱相容且描述明示Claude；Claude用既有k_luna/luna_start派全部K選定工人。Gemini主代理不做反向派工，Claude原生Agent保留本人明確要求時使用。

UUID在spawn前寫入既有工單；fresh host原生model/effort先驗證才送任務。worker不继承main派工指示，strict空MCP、不Agent/Task/ExitPlanMode；只載user設定並disableAllHooks，避免工作區hook繞過工具限制。nonfull不允許命令／網路；workspace-write只允許工作區內的原生寫檔並透過ask強制callback；最近既有祖先realpath核對，防junction逃出，不用會拒絕所有覆寫/新巢狀目錄的checkedPath。正常主核心設定／權限／MCP不改。這不是OS隔離，managed policy仍由原生核心控制。

GPT/Claude核准都綁parent，主回合idle仍可處理自己活著child的核准；缺實際變更內容不能accept。測試找到Claude answer先刪pending才驗證reply的真錯，窄改為先驗證再刪，失敗後仍可明確拒絕。失去process歸屬的舊工單維持unresolved，不resume/adopt/replay；close失敗不稱停止。nativeclosed但無result為failed/settled、副作用未知不重播；取消不附誤導的原生失敗文字，空outputFiles不證明無成果。

## 真正 Opus 討論與獨立裁決
证據D:\K-harness\.runtime\worker-model-engineering-20261008；全部官方Claude.ai Pro、實際claude-opus-5-5、CLI2.1.294，只Read/Glob/Grep。
- 工程討論session31b4c0a1-8f1a-4a85-9ea2-c6e472270f75：同意共用既有bridge，要求process歷史/取消、父對話核准、worker短指示、strictMCP、實際effort及安全写入。指出Haiku能力需依本機原生清單，不能沿用他的「Haiku無effort」概括。
- 收尾session6a7b4b38-7014-4e88-bf7b-f24f93827c98：認為沒有過度工程化，但發現explicit null effort被??defaults覆蓋，要求一行修正+bridge回歸。已改effort!==undefined，新增auto與manualhigh兩種預設的explicitnull測試。小項取消文案/空清單說明/重複角色提示也窄修；沒有增加cache或junction支援架構。
- 最後小差異複查尚待讀回，下方追加結果。

## 驗證證據與未驗證界線
- 完整測試第一次987項：983pass、3fail、1cancel。保留失敗紀錄；兩項root因為legacy僅model的high預設／新UI字重；空聊天室測試因讀全目錄意外用真Claude/Gemini，改真正全fakefixture而非延長timeout；capacity既有時序載入問題定向正常，不改產品遮蔽。
- 窄修後完整1004/1004；後續Opus null修正定向19/19，最終固定程式候選全套還要再跑。parent來源、核准與通知回歸121/121；Gemini动态family/原生effort53/53。沒有安裝新相依。
- 真原生Claude新工人：Haiku5.5 session524de956-46b8-4425-a43a-b1bbd2ea2550、Sonnet5.5 7ff54bf1-90d2-43fa-a6c9-bab839aa68b8、Opus5.5 854e9423-efca-446c-afd2-5838ad39ef4a，均low/Read新假sentinel、actualmodel相符、host.closed=true。另真Haiku原生Write經callback精確核准新假檔成功。
- 最後host安全設定真Haiku：workspace外Write被K拒絕、內部Write經callback核准；工作區local broad Write/Edit allow不繞過，Read PostToolUse假hook未跑。另一真Haiku唯讀在nativeRead tool_use後取消，nativehost確認closed、settledcancelled，未重送。見native-boundaries/evidence.json、cancel.json。
- 上方/右側built UI桌面與手機fakefixture、roomscope/zero/unknown/無寫入、worker-wait四尺寸、reconciliation、activity與mobile-remote通過。主代理獨立重跑worker-count和模型選單兩尺寸、建置及diffcheck通過；新worker-model-picker probe21模型+auto、future新增、hidden/unavailable/Fable排除、null提交、missingmanual不改換、Gemini不顯示反向工人設定。
- GPT/Claude父模型通知／核准／idle子代理仍活動／重啟不重播屬合成controller整合；新Claude執行器/bridge是真的原生回合，不將它誤稱兩家真正主模型完整派工回合均已驗收。21型號不是逐一做全部能力真回合。桌面／手機畫面是built fake probe，不是本人手機實機。
- 模型選單跟原生目錄，CLI執行檔更新與新協定能力接線分開。本輪實讀selected-cores為Codex0.161.0、Claude2.1.294、agy1.3.1；相較前批0.160.1/2.1.292的指標變化在本輪前已發生，不冒稱本輪下載/切換。這次不寫selected-cores。
- 暫留限制：工作區本身是junction時Claude workspace-write可能保守拒絕；目錄暫時不可用時手動指定模型會拒絕開啟而不是換模；新對話完整目錄查询可能較慢，沒有真慢問題前不增cache。native內部Agent計費選擇不是本批全面封鎖。

## 待正式套用讀回
只交換程式及啟動器、保留可退版本；登入/對話/瀏覽器資料位置不搬動。正式結果待下方追加。

### 最後 Opus 小差異複查讀回
session5b53f353-ddeb-401d-a604-c3b6d077aa56，官方Pro／實際claude-opus-5-5／2.1.294、code0/success/is_error=false，9Read/Glob，確認null必修及三個窄修正確、無阻擋部署。主代理另獨立確認src/claude-host.mjs的HOST_INSTRUCTIONS直接包含MODEL_ROLE_GUIDANCE（該檔未放此次小封包，Opus未假稱已確認）；既有claude-host nativefake測試亦驗普通主核心附該文本。既有legacy僅model且漏effort的bridge呼叫可能拒絕，沒有暗換模型；正式新UI與保存設定均有effort，不另造migration。沒有擴張cache或junction處理。
