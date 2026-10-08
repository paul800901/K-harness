# 多模型討論工程（2026-10-08）

## 範圍及最新狀態
使用者指定 Astra 執行、真正 Claude Opus 5.5 輔助討論並複查程式是否過度防禦。三種模式與兩種入口的需求見 [定案文件](multi-model-discussion-design-20261008.md)。本批只改 K；一般原生對話、既有子代理與其他聊天室的成果保留，不改 DSH/KAI、登入或 API 計費。

工程在獨立工作樹 C:\Users\Paulus\.codex\worktrees\multi-model-discussion-20261008\K-harness。最初基底4a6c482f2df01e1b31216cffc9ec7a98088bdee9；另一聊天室先部署新正式版本後，僅將本批變更 rebase 到 c5d605d146e10080502fbec61a8f0c2a8b114af3，保留最新原生模型、手機附件與子代理快覽。根目錄既有未提交修改不改動。

目前為已實作、來源驗證階段，正式套用及最後 Opus 修正後複查結果待下方追加。固定程式 SHA、退版與正式讀回另記，不把候選測試當正式成功。既有發布 SOP 只明確授權私人庫；現有 origin 為公開庫，已另詢問，本批未 push／更新東區。

## 本人可觀察的結果與使用方式
- 輸入框上方選「平行比較」「交叉審查」「多人討論」。可在新空白聊天室第一則前選，或從既有單模型討論直接開始，不需要等不滿意才用，三種模式可各自選用而非固定流水線。
- 「參與者與背景」指定各家原生目錄模型／推理程度，至少兩位，可加入同家不同等級。由目前主模型主持；不是固定某模型做裁判。帶入前面對話由 AI 整理需求、使用者修正、已知證據及分歧，摘要顯示在聊天，能直接補充更正，不要求整理背景封包。
- 平行比較的首答互不可見，整理前不轉互评；主持人不能把舊候選答案當獨立比較背景。這是流程獨立，不是形式上證明模型沒有相同訓練資料或偏誤。
- 交叉審查填入明確目標；留白採最近完整回覆。多人討論讓必要的人針對別人的原論點互相回應。AI 按實質未解問題安排及結束，無固定輪數、逐輪按繼續、投票或硬湊共識。
- 工作中可補充給 AI 安排、全體或指定模型。既有停止按鈕停止整組；切到其他聊天室不停止／重送原組，也不把補充或停止送錯聊天室。原生工作／核准／佇列未結束前不混開討論。
- 每位模型的原始答案、身分／推理程度、背景、本人插話及整理留在同一聊天。回到「一般對話」後，下一則明確指示將原始意見交回原模型；保留原生 room ID，不假装原生共享历史，後續不重複交接。
- 討論不自動取得實作或寫入授權。首版只使用本人提供的文字、已擷取文字的文件及原生公開網頁；不直接讀工作區檔案、寫檔、執行命令、派工或帶入其他 MCP。圖片／影音明示未讀，可回一般原生對話處理。普通對話的附件能力不縮限。

## 最小實作與檔案
- shared/discussion.mjs：三模式／狀態及主持人決策格式，無判分或能力分類。
- src/discussion-controller.mjs：同房原始紀錄、AI 背景／調度、插話、停止、native session 所有權與一次明確交接。持久化僅一份同房 JSON；不用另一個代理核心、broker、投票、共享知識或永久主持人。各 native session 首次提供材料，其後只傳新增原文，不每輪重送完整附件與歷史。
- src/discussion-native.mjs：原生 Codex thread/turn、Claude stream-json、Antigravity stdin event:user/message.content + --conversation。各家自行歷史／壓縮；討論 session 不列作新普通側欄聊天室。
- src/claude-host.mjs 僅新增 discussionOnly 分支，保留當前 worker 專用設定；src/gemini-worker.mjs 僅補 stdin input，未改原生普通工人路由。
- src/conversation-controller.mjs、isolated-desktop.mjs、desktop-server.mjs、remote-access.mjs：綁來源房、現有原生 catalog／account manager、兩條討論入口，沿既有 stop。刪無人使用的獨立 stop route。
- src/claude-controller.mjs、gemini-controller.mjs：各新增當次 send 的 local attempted 記號，只在尚未送交 native 時標 notSent，供交接確定拒絕時還原；未知是否送出不還原／重播。
- src/archive-delete.mjs：既有可恢復刪除包納入討論 JSON；原生三家歷史同既有確認文字保留，不擴成刪除所有 native profile。
- frontend/discussion-controls.jsx、discussion.css、main.jsx：共用既有輸入框及逐模型答案，無獨立管理頁。手機設定限高可內捲，輸入及送出可見，開始後自動收合參與設定。
- test/discussion-{controller,conversations,native}.test.mjs、discussion-ui-probe.mjs 及既有 archive-delete／Claude／Gemini controller 定向回歸。

## 真正 Opus 討論、問題與 Astra 裁決
證據目錄 D:\K-harness\.runtime\multi-model-discussion-build-20261008；全部官方 Claude.ai Pro／CLI2.1.294／實際 claude-opus-5-5、code0、success、is_error=false，僅只讀工具。
- 需求兩輪另見定案文件：1d335b7b-9963-49f9-9cd1-b21deff56333、14b91c4d-dfec-40f1-b073-f8796624b05c。撤回人逐輪按繼續，依本人確認由 AI 調度，不以 Opus 意見當本人授權。
- 工程 planning：0df46db2-552f-4df2-b69c-36471bf5b5d5。採房生命週期、避免继承派工指示／跨供應商檔案工具、嚴格空 MCP、Gemini 帳號 lease／原生歷史。獨立核對官方 stdin/--conversation，沒有採他的「CLI不能接續」猜測，也不另造 gateway 或 fork 框架。
- 第一輪實際 code review：f2f6c1f4-80a6-4653-8661-5bac7b1bda9e，13 Read。判架構最小，但指出1P1、3P2：歷史 uncertain 永久鎖房；已確定未送出的交接沒有恢復；每輪重送全部材料；刪房漏討論資料。均做窄修。仍持有未停程序時保留鎖，重啟後舊紀錄標未知但不阻止獨立新工作；unknown 不重播。一次原生交接的 notSent 實際來源已查三核心而非假定。
- 可選刪減採用未使用錯誤投影、重複 send guard、獨立 stop route；parallel 改直接 Markdown 整理，不再要求無用途的 speak JSON；close 只移除確實關閉的 owned session；錯誤文字改實際可做的操作。保留真正有用途的 participant defaults effect（lazy catalog 到達後顯示與送出一致）、原始診斷／身份證據；沒有按建議機械刪掉。
- Claude WebFetch exact allow 後真官方頁讀取成功；Gemini 原生工具拒絕另驗。修正後第二輪複查待追加。

## 驗證與失敗紀錄
來源證據 C:\Users\Paulus\.codex\worktrees\multi-model-discussion-20261008\K-harness\.runtime\discussion-evidence。
- 首次完整來源失敗是新 UI hooks／CSS 嚴格規則，已修；rebase 後完整1031/1032一次既有 native-wakeup 計時測試受高並行負載失敗，檔未改，定向18/18。保留原始失敗，未加 retry 或產品防禦掩蓋。限制測試並行4後1032/1032，Opus第一輪修正後全套1037/1037、定向41/41。新增兩 native confirmed-unsent 回歸125/125；最終全套待追加。
- built UI + 真 HTTP/SSE/controller、假模型答案：第一則前選模式／既有房直接進入、3種模式、逐模型原文、指定模型插話、整組停止、一般續接、390px手機无横向overflow／展開設定時send仍可見／pageerror0。截圖 discussion-desktop.png、discussion-mobile.png 已目視。這是自動化窄視窗，不是本人 Android 實機。
- 真原生各兩回合同 ID：Codex Sol medium 01a11a23-317d-7db3-a2b7-5801ed92f893；Opus medium db7af56a-b7e5-4729-99fa-5d1c6fd4a680；Flash low a318ca78-15c4-43e3-9336-69fb9a3a92c2，全部確認關閉。
- 真三模型模式：parallel feature-aJFYWr completed6則；review feature-CUFkDT completed6則；meeting feature-TNdzcp completed8則，Flash/Sol 真正針對別人的理由互答，不只平行答案。早期 feature-cSHIXZ 亦有 Sol/Opus 真互答。保留本人修正、各原文、不同意見／未知，全部 closed。
- 真整組停止 feature-klHSa6：先觀察三位均 streaming 再停止，interrupted、stopped:true、closed:true，保留已產生／部分答案，未重送。背景A切至5房仍活著／來源A停止不動B為合成controller證據，不冒稱真三模型加切房完整實機。
- Gemini 真94340字 distinct prompt：feature-Ds5N2k、native383f9072-dbcb-4956-83b3-a0aa7da6146f，stdin成功原生回覆及關閉。早期 --print stdin grammar code2/code1保留；40051字重複中文 feature-6bJPbM 原生code0無最終文字，已誠實failed／closed，不重播、不當成所有長輸入可靠。
- 權限真假檔：Codex feature-2TNnEO、Opus feature-qEQdUa 原生無本機讀寫工具，假marker未讀／寫檔未發生；不是實際deny事件。Flash feature-LIipv6 原生實際 read_file/write_file 拒絕；程序關閉。fake unit確認MCP/command工具設定及一個account lease維持至closed，不宣稱OS隔離。
- 真 Claude WebFetch：web-tJucX1、native9cbfb26e-7167-4b29-bf72-e7d277e9cc91，events具 WebFetch https://example.com，回 Example Domain，closed；不是憑記憶網頁宣稱成功。
- 原生測試全部新建假資料及既有訂閱。沒有換帳號、搬憑證、安裝依賴或更新核心。formal factory接現有Gemini manager，真standalone未带該manager；實際manager與多Gemini參與者帳號阻止切換為fake integration證據，不冒稱真多帳號驗收。模型目錄可選不等於每款都真回合驗證。

## 原生來源與未驗證界線
[Codex App Server](https://developers.openai.com/codex/app-server/)、[Antigravity headless CLI](https://antigravity.google/docs/cli/headless/)、[Antigravity permissions](https://antigravity.google/docs/permissions?tab=cli) 及本機 Claude --help 核對，協定存在不等於所有模型／工具能力本次驗收。未評量長會議品質、所有模型／effort、用量節省／總完成時間優勢、不保證主持人任何任務都能最佳停止。無固定輪數由模型決定、本人仍可停止，不添評分／巡邏／用量管理框架。

### 修正後複查與最後來源回歸
真正 Opus 第二輪 session d6de211c-4327-44ce-8821-8926529549be，16 Read、code0/success/is_error=false，確認上輪1P1/3P2在可讀封包已閉合、無新阻擋與無不必要防禦。唯一缺證據是封包缺 Codex desktop-controller；Astra實際核對發現它原本部分狀態錯誤有notSent，但前置驗證／附件錯誤漏掉，窄補同樣 local attempted，刪兩個重複手動標記；native拒絕僅沿既有已確認 restoreRejectedEmpty 判斷，transport未知不重播。unified changing的一行確定未送出標記也補上。

已確認失敗但native仍保留user歷史時，交接只退cursor，不刪human顯示mapping，避免顯示長JSON。定向Codex與討論65/65。Gemini帳號release actual已具released冪等guard，因此沒為Opus P3假想風險再添狀態或cleanup抽象。最後Codex窄修真Opus覆核待後續追加。

最後完整來源 full-test-5.log 1039/1039（Codex最後窄修前）；build及UI實測passed。補Gemini真權限 read-tools-kBpXqb、nativefe880978-9ee9-4f54-979b-a86fc5b49a44：actual run_command dir遭command(dir) deny，隨機假檔名／內容未讀，closed。沒有list_dir/grep原生事件，不把工具不存在／未嘗試算作那些工具的deny實測。

正式K在本批收尾期間已由本人重新啟動，本機讀回47831 Listen、launcher/node/electron程序在；正式指標仍c5d605d。本批不停止／取代這些工作，先完成固定候選並等待本人「離開並停止」。候選或正式交換前都需再次確認，不沿用先前閒置快照。

### 最後真正 Opus 放行與完整來源驗證
Codex小差異第三輪真正 Opus session533527c5-6a86-4f71-8c7a-1ab25b0118ae（8 Read、官方Pro、實際claude-opus-5-5、CLI2.1.294、code0/success/is_error=false）確認前置notSent／native未知不回復／顯示mapping正確、無P1/P2與多餘防禦，不要求再添架構。Opus只讀沒有重跑測試；Astra獨立執行最後來源全套 full-test-6.log **1041/1041**，0fail/cancel/skip。未知native送出與既有保守UI狀態不額外改路由／回放。本批所有模型測試程序已關閉。

## 固定候選收尾：已實作／驗證，未正式套用
- 固定程式 commit **a693ba44a2715e490dda039d72b24f6a5fd4a35a**（承接c5d605d）。候選 **D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\prepare-discussion-a693ba44a271**，從該 SHA 的 git archive 全新展開，只複製既有正式依賴到新候選；沒有 npm install／更新Electron或原生核心，沒有保留指向將來退版資料夾的node_modules junction。
- UI、既有Chrome擴充與既有Windows launcher建置成功；乾淨固定候選全套 **1041/1041**、built desktop/mobile discussion UI passed（0pageerror）；來源1041/1041，候選不是未測dirty copy。
- 初次固定來源逐檔讀回发现extension-protocol.cjs唯一差異：建置由固定來源CRLF轉LF，UTF8内容正規化完全相同，並非新的程式差異。只在新候選用固定archive原位還原該檔，不改工作樹、正式K或其他資料；45/45瀏覽器回歸通過。最終 **596/596 Git檔案逐位元一致**、差異0，證據 fixed-source-readback-final.json。原始差異收據保留，不把第一次當成功。
- 所有候選證據在其 .runtime/discussion-evidence：clean-full-test.log、clean-ui-probe.log、build/extension-build/launcher-build.log、extension-exact-source-tests.log、fixed-source-readback{,-final}.json、ui-result.json與兩尺寸截圖。真原生及Opus原始收據仍在上列來源／根.runtime證據目錄，未公開。
- **2026-10-08 07:07:30 UTC正式讀回**：47831仍Listen（PID27960），正式版本c5d605d146e10080502fbec61a8f0c2a8b114af3。本批没有強制停止、交換runtime、啟動新正式版、恢復／重派任務、動登入或對話。不是已部署；目前候選ready，需本人在正式K「離開並停止」後再確認無程序與新正式版本變化，保留當時版本再套用／讀回。
- 無正式退版操作／位置，本批尚未交換；既有previous位置屬前批，不冒稱本批備份。東區未更新。公開GitHub push問題已詢問，尚無本輪公開發布授權，未push、未移動main/tag。
- 此後文件收尾commit只補實際證據與狀態，正式程式要用上方完整固定 SHA，不把文件較新當程式已重部署。

## 已套用南區正式 K（2026-10-08，取代上方待更新階段）
本人本輪明確表示「我的K已经关掉，你现在可以更新了」。依該授權執行一次正式交換，不再以先前仍開著的快照當現況。
- 部署前本機確認47831無Listen、K launcher／node／electron／原生模型程序0；原正式版本仍c5d605d，沒有覆盖另一批新版。固定候選596/596再次逐位元核對一致、physical node_modules無junction；prepared／trusted-runtime／releases的實體絕對路徑確認都在本次K runtime根內。
- 使用既有 scripts/install-runtime.mjs 的 activateRuntime 一次交換，**正式程式 a693ba44a2715e490dda039d72b24f6a5fd4a35a**。没有重新安裝相依、升級核心／改全域或切計費，也不把文件收尾commit當程式版本。
- 可退回程式位置：**D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\releases\before-1791444459727**；保留原runtime、launcher.exe、Start-K-Desktop.ps1、settings.json（原c5d605d）。這是程式退版，不是對話資料快照／還原。
- 交換前後65檔（main session headers、Gemini帳號清單、projects、Codex config、selected-cores）hash差異0，原node／語音設定值不變。state vault、原生登入家目錄、Chrome profiles留原位，沒有讀取／搬取登入憑證。沒有恢復、續跑或重送暫停／未知工作。
- 正常由 Start-K-Desktop.ps1 啟動；2026-10-08 07:28:56 UTC正式health200/deployment:native，workspace仍原private-state，.local/runtime.json完整SHA及previous讀回一致。兩個當次正式JS/CSS資產HTTP200／hash與正式disk一致，live JS含平行比較／交叉審查／多人討論。
- 本次正式讀回没有繞過登入：未帶會話的/及/api/state都是403，符合原授權邊界。第一次只讀驗證helper誤要求未登入/回200，改helper依實際403契約讀取disk index對應的公開asset；沒有改產品權限、重新部署或重送工作。首次helper的退出assertion與說明保留 first-readback-assumption.txt。
- **驗收界線**：本次正式驗證是程式／啟動／health／live資產／原權限保護；未自動開新正式聊天室、沒有借取Electron cookie去做登入後UI／三模型互答。真三模式／三模型／停止及desktop/mobile UI仍以上方已驗收固定候選證據為準；本人Android實機未重測。
- deployment-preflight.json、deployment-start.json、deployment-activation.json、deployment-preserved.json、formal-live-readback.json在D:\K-harness\.runtime\multi-model-discussion-build-20261008。原clean候選證據隨程式目錄現在在trusted-runtime\.runtime\discussion-evidence；來源原生測試收據仍在managed worktree。没有刪除／清理其他資料。
- **本次完成南區正式套用、正常重啟與上述正式讀回。** GitHub未push、未移動main/tag；東區未更新。僅補部署文件時不再次交換正式程式或重啟K。
