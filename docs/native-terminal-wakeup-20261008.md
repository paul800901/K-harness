# 原生子代理終止後父對話結果驗收候選

日期：2026-10-08，Asia/Taipei。**僅候選實作與測試，未更新正式 K；併同手機／三核心附件候選，停止等本人通知。**

## 接收與範圍

已讀桌面 `C:\Users\Paulus\Desktop\K_HARNESS_子代理拒絕未喚醒_工程交接_20261008.md`，工程來源副本 `D:\K-harness\docs\native-subagent-refusal-wakeup-incident-20261008.md`。依當輪要求由 Astra 查真實紀錄、實作與獨立驗收，和真正 Opus 5.5 討論、澄清及最後複查；未靜默切換主代理，未另建代理群。

候選沿用 `codex/native-attachments-20261008`，工作樹 `C:\Users\Paulus\.codex\worktrees\mobile-image-upload\K-harness`。基於前批文件收尾 dc3f674，包含手機 picker 2073a6b、三核心附件 972963e；本批不改這些附件來源。原小說來源已完成下載並開始翻譯，**不重播下載、不改小說正文、不操控或停止正式翻譯對話**。

## 已核實根因，而非消息遺失

正式 K 專用 CODEX_HOME 的來源父對話 `01a1181f-1a05-7d71-93be-e6589464430d`，工作區 D:\小說翻譯潤色。只讀父／指定 child 原生紀錄及工程 metadata；沒有 resume/start 這個正式對話，也沒有解密 encrypted arguments。

- 原生 `download_web_novel` child：01a11826-7f43-7fc1-a5ea-22d0f4e51732。
- 問題晚到的 `luna_source_fetch` child：01a1182f-a15b-71c1-b6bb-b85cdc998695。
- UTC 2026-10-07 21:06:08.125 父回合結束仍稱在下載；21:06:56.253 子回合 completed，但 final 明示未保存正文；23:09:01.945 本人追問才有下一父回合，23:09:05.931 這個 final notification 才寫入父歷史。相差約 2 小時 2 分。換算臺灣時間為 10/8 05:06、07:09。
- 所查父紀錄的 inter_agent notifications 皆 trigger_turn:false。消息存在，**completed 是原生回合終止，不是任務交付成功**。
- Codex 0.160.1 官方 app-server 生成協定及本次實測未找到可用的 idle 自動喚醒選項，不把它泛稱為所有 OpenAI 產品皆無此能力。公開 thread/read 不啟動對話；turn/start 可傳 toolOutput。
- K 既有 child 事件與 parent subAgentActivity 只更新 workers 狀態；只有 Flash 結果有閒置父回合接續，因此這次 native terminal 沒促成主代理重新驗收。主代理事前誤報、未收尾的責任仍保留，不說全部是消息被 K 吞掉。

安全、工程限定證據：`D:\K-harness\.runtime\native-wakeup-20261008` 的 incident-timeline.json、native-parent-read.json、native-baseline、protocol。官方協定參考：[app-server 文件](https://learn.chatgpt.com/docs/app-server)。

## 最小實作與檔案

固定程式：**bd6556467ffd4e2f365f8b0ba228f9cfb662855f**。只有以下五檔，程式／測試與文件收尾分開 commit。

| 檔案 | 差異 |
|---|---|
| src/desktop-controller.mjs | live child turn/started arm 同一 requestEpoch；terminal 先讀回核對，再加入既有結果佇列；閒置／父 completed 時沿用單一 turn/start 協調。停止／暫停／關閉／重開清除；送出與 goal finally 排空；讀回勝出時直接觸發既有接續，避免競態漏叫。 |
| src/native-workers.mjs | 所有既有 ownership／settled 規則不變，只讀回最新 turnId 作事件對應。 |
| src/worker-watch.mjs | 只對既有 native requestId codex:<thread> 用 codex.<thread>.<turn> 去重與最新狀態核對；Claude gateway codex job 仍維持原通知 key，不能按 provider 一刀切。 |
| test/native-workers.test.mjs | 驗 settled 讀回的 turnId。 |
| test/native-wakeup.test.mjs | 18 個定向案例：idle 拒絕/completed、failed/cancelled、busy 批次、partial 保留、他房來源、同 child 新回合、重複／父 activity 競態、stop/paused、歷史、來源／回合／讀回未知、傳輸不確定、goal confirmed rejection、send ack 邊界、延遲讀回。 |

通知只含原生 child ID、turn ID、終態與固定提醒。正文不複製；主代理按需用原生工具／實際成果核對。用真核心驗證過的 `k_native_subagent_terminal`／`turnTrigger:subagent`，不冒用 Gemini 工具名，無執行時動態備援。沿用原模型、強度、服務等級、權限與原對話；不對 child 送新工作。

不比對「拒絕」字詞，不用 final_answer 時間猜已讀／已驗收；忙碌的 live terminal 一律先排隊。可能多一個結果核對回合，但不建立內容判決系統，也不保證模型一定正確驗收／絕不重做。提醒不能替代模型責任。

未新增 registry、ledger、UI 設定、輪詢、計時器、安裝、憑證、跨 App 橋接或換模／重派機制。去重沿用既有 workerNotifications。既有 Flash quiet watch 沒有新增或調整輪詢。

## 真核心執行與失敗保留

全部使用現有官方 Codex 0.160.1／ChatGPT 訂閱登入，新建工程假資料父子對話；不換帳號／API 計費。主 gpt-6.1-sol low、child gpt-6-luna low。

1. native-baseline：child 正常執行 8 秒 sleep 後 REFUSED_… 任務未交付；父早已 PARENT_IDLE，25 秒後仍沒有第二回合，缺陷重現。
2. native-tool-output：在上一個**測試**父對話手動驗 toolOutput 名稱，核心接受，父正確說交付否；不算自動喚醒驗收，不操作正式原對話。
3. native-candidate：第一次修法仍失敗，parent activity 更新最後一個 worker read，只有 child read 的 then 呼叫 delivery，造成已排隊但未喚醒；180 秒收尾保留，已確認該 child 終止，不重播。該樣本 child 未照要求 sleep，僅作終止事件競態證據。
4. native-candidate-fixed：修隊列建立時的喚醒後只有一次自動接續；但原假資料指令禁止所有工具，父如實說無法確認 finalmessage。只算喚醒成功，不算內容驗收；發現原生通知正文不保證在那一刻直接附入，改為明確按需 native 讀回。
5. native-candidate-acceptance：獨立新工作明確允許一次讀本次唯一 child 結果。child 執行 sleep exit0，父由核心工具核對後回覆 **REFUSED_1c9ab3d02c 任務未交付**。父 2 個回合（原工作＋結果核對），通知 **1 次**，無模型變更、無再派工。父 23:43:12.316Z 結束，child 23:43:22.663Z 終止，結果核對回合 23:43:22.771Z 開始，約 108ms。

各 test controller／host 的 closed.json 已確認關閉；不留常駐候選或排程。native-acceptance-summary.json 是上述具體摘要，不用 marker 出現本身冒稱成功。

## 回歸與已保留失敗

- 舊程式 red：13 案例 4 通過／9 失敗，涵蓋 wake/failed/busy/followup 與警告缺口；原始建置缺 shared 模組的失敗另保留，不當 red 行為證據。
- 新 test fixture 最初因臨時 host close/reuse、等待保存與 key 字元契約不符而失敗；全部保留，修正到達後的真通知與保存讀回。
- 定向 providers **141/141**；最後新增的兩案與 worker-watch 本次再跑 **23/23**。
- 第一次全套 **976/978**：shared worker-watch 影響 Claude gateway codex completion／quiet keys，已修為 native requestId 專用判斷；未犧牲原通知行為。
- 修後完整 **983/983**（73.554s）；再跑 frozen **982/983** 與 browser-native-profiles 獨立 **2/3**，是未改動的 reconnect descriptor/token 時序失敗，保留完整紀錄，不冒稱隔離即通過、不假定 UI 並行是根因，也不順手改瀏覽器。
- 最後完整读回 **983/983**（73.942s），fail/cancel/skip0，`node --test --test-concurrency=2 test/*.test.mjs`；full-tests-readback.txt。既有 browser 測試不穩是限制，不用最後一次 pass 抹去。
- build:ui 通過，沿用原 bundle-size warning；built browser 手機 File/XHR＋真 K 保存 probe **13/13**、10 種 suffix bytes 正確，mobile-ui.txt。SSE／native host 為 fixture，**不是真 Android 手機驗收**。
- git diff --check 通過，未裝套件或改 lockfile。

## 真正 Opus 5.5 討論、減法與複查

官方 Claude Code 2.1.292，claude.ai Pro／firstParty，三次都讀包限定、實際 assistant **claude-opus-5-5**、success／exit0，不冒稱其他模型為 Opus。

- 設計 session ec842a6f-f8d2-469d-a5f8-373be5bf3c20，15 次只讀工具。
- 澄清 session 319071ef-5505-4621-a03e-bf7cb7b73fad，8 次：Opus 採納 Astra 的反證，刪掉「final 前抵達就視為已讀」啟發式，接受 busy queue。
- 最後 session **1a7aac3d-67b1-4e3f-a7bf-28e8a482874d**，16 次：逐讀實際三份來源、diff、tests、live 證據，結論 **沒有阻擋缺陷、没有過度工程化，維持候選停止等待**。

最後 Opus 核對的完整測試證據含第一次失敗與 983/983；其後 frozen／browser 獨立失敗及最終 983/983 另如實列於上節，不能說 Opus 當時看過尚未產生的最後 log。Astra 獨立核對 diff、原生事件時間、2父回合／1通知、保留原權限、非重派、正式九來源相同，再接受其結論。

## 跨聊天工具討論決定

這次現有 Codex App 工程聊天已接收 handoff；不用再造聊天室或另開代理群。Codex App 提供的 create_thread/send_message 不等於 K 原生 CLI 已有該 App 控制能力。討論後本批只保留**專案交接檔＋既有聊天**，不增加未證明公開接入的跨 App bridge，也不把 K 房間／原生 thread 假稱 App 新聊天室。本輪沒有對外投遞或新增 App 聊天操作。

## 直接限制、正式狀態與停止

- 只修 Codex 原生子回合 terminal 協調；不是三家所有子代理格式的重新設計。Claude/Gemini既有流程走原入口，回歸保留。
- 只 arm 本次 live child turn/started。重連只有 terminal 沒有 started 不自動喚醒；歷史不補發、不重播。既有重開會先核對停止 child；不另做回放機制。
- 父 failed/interrupted 不自動開驗收回合，通知保留待本人接續到 completed；讀回來源／最新回合未知不猜。
- Flash bridge list 拋錯可能留下 completionPending 待下個正常事件核對；未為此加輪詢備援。
- 真模型拒絕／內容品質由主代理核對，K不自行宣告來源下載/翻譯成功，也不改授權或著作權政策。
- formal-unchanged.json 已重新驗：正式 runtime version **4a6c482f2df01e1b31216cffc9ec7a98088bdee9**，九份相關來源與該 baseline 相同。沒有部署、push、正式停止／重啟、帳號切換、譯文寫入。根工作樹原有變更保留。

**本批程式與前面手機／三核心附件修改已在同一候選。停止等待本人確認翻譯工作告一段落且可以升級；不預先排程或自動更新。** 文件收尾 commit SHA 存本機 closeout.json，不回寫文件自身 hash。
