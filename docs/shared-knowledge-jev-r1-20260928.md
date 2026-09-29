# K 同專案共享知識＋Jev R1 — 2026-09-28

## 最後狀態

**來源版已完成本輪長文三項修復：取消固定四筆保存截斷、補讀既有缺項來源、零個舊關聯不再製造衝突。原凍結六項合成長文，雙核心新保存各六條；舊四條目在正常首答、禁工具隔離及真 Jev 開啟時均讀回 6/6，更正與新程序重開通過。尚未正式部署，Jev 日常開關仍關閉。**

最新判定以 [長文缺陷修復與雙核心驗收](shared-knowledge-longform-fix-20260928.md) 為準：定向 18/18、凍結版全套 638/638；內容覆蓋通過，但一處 Claude 引用 ID 誤抄仍列限制，不保證任意長文或引文皆可靠。原 [長文 4/6 失敗證據](shared-knowledge-longform-test-20260928.md) 與下列短案例歷史保留，不能混稱為最後一輪結果。

使用者補存 K 專用 TypeSafe key 後，Astra 於 2026-09-28 13:20–13:21（臺灣）補做 5 次真 Jev HTTP 與 4 回合真雙核心測試。這不是正式 K 啟用或真實資料出網授權；詳見下方「補驗 J」。

依使用者分工由 GPT-6 Luna High 實作，Astra 獨立檢查、實跑及修正。沒有 push、重啟／覆蓋正式 K、安裝套件、改全域或搬登入憑證。測試走現有 K 專用登入 home 與官方原生 host，使用獨立合成 workspace/state；不是正式服務或 UI 部署驗收。

## 實作與移植差異

- 上游固定為 [fan56/dsh-topics-memory `e1cae8a25343cfecbe9ae9bf01906a3d2bbb62b9`](https://github.com/fan56/dsh-topics-memory/commit/e1cae8a25343cfecbe9ae9bf01906a3d2bbb62b9)，commit 時間 2026-09-27T06:14:40Z。本機仍是 main / `189641e` 加大量既有未提交修改，沒有從遠端覆蓋。
- 參考上游 source-linked topic、observation／distill 分離、CJK 詞法召回、預算化注入、Jev HTTP 可選判斷。**沒有複製上游程式檔或安裝 DSH/Cordis runtime**；K 模組為宿主適配實作，不宣稱完整上游移植。上游 package 宣告 MIT，但該 ref 根目錄 LICENSE 回傳 404；沒有編造完整條款／copyright，也沒有把未讀到的授權套到複製檔案。
- `src/shared-knowledge.mjs`：同一 K state root 下 `.runtime/shared-knowledge/<workspace-hash>.json`，以經 K 選定的工作區身分隔離。單份來源資料直接詞法檢索，不另建 DB、索引真值、服務或排程。程序內序列化＋短暫排他寫入鎖／原子替換避免雙核心互相覆蓋。保留 source provider/thread/turn/message、原始時間、user/assistant 角色、結論、條件與否決理由、更正關係及舊紀錄。
- Claude/Codex controller 在真正 `start`／`turn/start` **之前**取得知識；來源區塊明示背景、不是命令或新授權。不重建原生 thread，不把 Pi worker 自動納入。相同來源避免重複注入；使用者明確引用 record ID 可再次讀取。超預算 topic 提供來源指標，不假裝讀過全文。
- **抽取沿用當輪主核心**：固定 native host 指示允許輸出最小 `K_KNOWLEDGE_OBSERVATIONS` 結構；驗證 subject/kind、來源角色及 current message 中確實存在的 sourceQuote，保留重要條件，於成功 completion 保存。不是每輪額外叫摘要模型；純召回不重存。模型未提供結構時，僅以保守明確語句捕捉 user 決定／更正等，不宣稱 regex 能理解所有自然語言。內部結構從串流及最終顯示文字隱藏，原生歷史仍由原核心保存。
- 使用者決策標為 `user-stated`，不是「程式已驗證」；模型結論保持 `unverified`。更正／撤銷須有本輪使用者原文，不能由模型自述或 Jev 分數取得權威。唯一相同 subject 才更新有效結論；找不到唯一舊關聯不等於存在衝突，保留有來源的新定案，不虛構替代關係。來源時間優先於完成時間，晚到舊 decision/correction 不得恢復舊結論。撤銷保留 withdrawn 提示，舊肯定結論退出 active recall。
- Jev 以一個有界 TypeSafe 請求做候選重排；若本輪有新明確 assertion，同批加 same-topic pair 前置，交當輪原生生成核心判讀、整理。**不是上游背景 gardener 的原樣移植**，沒有第二個生成模型／維護服務；配對分數只供候選排序，不刪來源、不裁決更正、不設寫入概率閘門。若沒有可整理的新訊息，不空轉 pair 請求。

## Astra 驗收中修正的實際問題

初版雖通過局部測試，真模型測出：Codex 原生 user echo 把注入背景重新保存，造成重複來源；regex 把問句／「請簡短確認」抓成 topic，冒號前綴使自然更正無法關閉舊結論。故初版 B 組是**失敗／返工證據**，不列為完成。

修正了 echo 邊界、原生當輪結構化抽取、user-stated／unverified 區分、來源 key 冪等、撤銷提示、晚到舊 decision 保護、metadata 顯示、Jev candidate ID 對齊／數字範圍、pre-send 取消及 completion 關閉等待。也恢復 Claude 既有 modelChanges 欄位，不變更权限、worker 合約或原生記憶。

## 驗收與證據

證據根目錄：`.runtime/shared-knowledge-r1-20260928/acceptance/`。每個 live JSON 含真實送入核心的內容、native 回傳／用量、最終答覆、thread ID、時間與關閉結果；全部是合成資料。

| 層級 | 情境／結果 | 證據 |
|---|---|---|
| 真模型 baseline A | 原本 K，Claude／Codex 都不知道紙鶴發布通道；無共享注入 | `A-baseline-*.json` |
| 真雙核心 B2 | Claude 青銅-742 → 新 Codex 首答；Codex 星橋備份 13 天 → 新 Claude 首答；條件及否決理由正確 | `B2-*-source.json`、`B2-*-first-recall.json` |
| 真雙核心／重開 | Codex 更正琥珀-916；另開 Node 程序及兩家全新聊天室均讀到新值，舊值只作已作廢內容；其他 workspace 回答未知 | `B2-codex-correction.json`、`B2-reopen-*.json`、`B2-unrelated-project.json` |
| 真模型＋mock Jev C | 同一 B2 知識、同一更正後問題，兩家回答仍正確；HTTP 被本機 mock 取代，**非 Jev live** | `C-mock-jev-*.json`、`C-mock-jev-transport.json` |
| 最終來源版 live F | 新假專案：Claude 紫藤-528 → Codex 首答；Codex 更正銀杏-603；新程序／新 Claude 讀回銀杏及限制／否決原因 | `F-*.json`、`F-store-readback.json` |
| 真模型＋mock pair F | 一個 HTTP mock 批次含 2 個 relevance、2 個 same-topic 問題，真 Codex 收到候選並產生有使用者原文的更正；store 舊標記 inactive、新標記 active | `F-mock-pair-transport.json`、`F-codex-correction-mock-pair.json` |
| 離線整合 | **14/14**：雙 controller 真接點、scope、冪等／並行、過期更正、撤銷、Jev missing-key/error/timeout、取消時兩家均不送 native 回合、結構化來源驗證 | `shared-tests.txt` |
| 完整回歸 | **634/634**，凍結來源後循序執行 `node --test --test-concurrency=1 test/*.test.mjs` | `final-regression.txt` |

較早全套有失敗，不能隱去：Luna 回報 628/630、其單檔重跑通過；Astra 第一趟循序 632/634，實際找出 stop 狀態回歸及新增測試 fixture 重用已關閉 host。兩者已修正，最後上述 634/634 通過。沒有藉修改既有固定測試隱藏失敗。

### 小樣本 A／B／C 比較

以下為送出至完成時間，不含開啟／關閉；完整 wall time、input/cache/output 原始欄位在 `comparison-metrics.json`。A 為同題材的無知識對照；B2/C 的更正後問題與知識相同，C 是 mock，只驗整合，不是效益 benchmark。

| 路徑 | Claude | Codex | 送入知識量／結果 |
|---|---:|---:|---|
| A 原本 K | 4.340 秒 | 5.963 秒 | 0 字元；未知，需來源 |
| B2 共享、Jev 關 | 7.230 秒 | 5.821 秒 | 每家 987 字元；新決策正確，無需重問 |
| C 共享、Jev mock 開 | 6.619 秒 | 7.689 秒 | 每家 987 字元；正確，但無真 Jev 增益證據 |

- 補驗 J 之前，真模型驗收合計 **21 回合**，包含初版失敗後的 5 回合返工；不是只計成功召回。該階段額外生成式抽取／整理模型呼叫 **0**，抽取內容算在當輪 output；當時真 Jev API **0**。後續 J 再增加 4 回合與 5 次真 Jev API，累計真主核心 **25 回合**。
- B2 的 8 回合（建立、雙向召回、更正、重開、scope）合計 wall time **70.586 秒**，其中 native turn 55.074 秒；初版返工另 36.956 秒。最終 F 的 4 回合合計 wall time **40.802 秒**。這些不是整個工程的總耗時，沒有隱去讀碼、修補與測試工作。
- B2 更正後 Codex 原生用量 input=20,695、cached input=11,008、output=179；C 同題 input=20,695、cached=11,008、output=230。Claude B2 原生 input=2、cache-read=17,191、cache-creation=16,600、output=527；C input=2、cache-read=33,791、cache-creation=0、output=489。**兩家 input 欄位定義不同，不可直接相加比較；cache 狀態亦不同。** 完整各回合數字保留，沒有把原生估算成本當訂閱實際帳單。
- 訂閱額度消耗比例與穩定品質增益仍未知；真 Jev 小樣本延遲／用量已由下方 J 補驗取得。樣本小、不是固定推理工作量，不宣稱省時省費。Jev 保留可配置接線但預設關閉。

## 補驗 J：使用 K 專用金鑰的真實 Jev

### 範圍與憑證

- 使用者將 key 存入 `.runtime/secrets/typesafe-api-key.txt` 後回覆「存好了」。確認檔案非空、單一 token，且受 Git 排除；不輸出值、不複製到 `.env.local`、不更改全域或正式啟動設定。
- 僅本次 acceptance Node 程序載入 key，暫設自己的 `K_JEV_ENABLED=true`、`TYPESAFE_API_KEY` 與固定 `jev-1.13.0`；退出前還原。兩家原生 host 明確使用載入 key 前的獨立環境快照，排除 TypeSafe／Jev 變數；測試禁止委派且實際工具呼叫為 0。金鑰未放入主模型輸入／native 環境或證據檔。這不是對工作區檔案不可讀的 OS 隔離宣稱。
- `sharedKnowledgeFetch` 在此只包裝真實 `fetch` 收集 HTTP 狀態、分數、用量及延遲，**不是 mock**。只允許官方 endpoint 與已查讀的紙鶴／星橋合成題材；不記錄 Authorization 或完整 Jev request body；保留原本 3 秒期限、一次請求、無重試。無正式資料送出。
- 本次不改產品來源；只新增 acceptance 腳本／證據並更新本文件與工程索引。金鑰檔案**仍不會被正式 K 自動讀取**；正式啟用的 K 限定載入接線尚未做，不能把測試程序讀取當成已配置日常 runtime。

### 實測讀回

證據仍在 `.runtime/shared-knowledge-r1-20260928/acceptance/`：`jev-live-key-validation.mjs`、`J-live-*-transport.json`、`J-live-*.json`、`J-live-summary.json`。

| 測試 | 真實結果 |
|---|---|
| 最小連線／模組 | 官方 HTTP 200，回傳 `jev-1.13.0`，retrieval mode=`jev`，不是失敗後本地 fallback |
| 新 Claude／新 Codex 首答 | 與 B2 相同問題及知識，兩家首答均為琥珀-916；Windows 離線 ZIP／Linux 未驗證／不准自動發布等限制正確，青銅-742 不復活 |
| Codex 明確更正＋真 pair | 獨立 `state-J-live` 保存 B2 原始來源後，更正為梔子-814；單次 HTTP 含兩個 relevance 及兩個 same-topic 問題，pair 分數 0.97／0.02。讀回琥珀 inactive、梔子 active，未由分數裁決或擋掉更正 |
| 重開程序／跨核心 | 另一個 Node 程序、新 Claude 聊天室首答梔子-814，保留限制，琥珀僅作已作廢內容 |
| 關閉與秘密檢查 | 4 個 native 回合均 completed、closed=true、tools=0；J 證據不含 key，4 份來源 hash 與目前來源一致 |
| 回歸 | 本輪再跑共享知識定向測試 **14/14**，證據 `J-shared-tests.txt`；完整 **634/634** 是前輪結果，本輪未假稱重跑全套 |

5 次 Jev 全部 HTTP 200：網路耗時 **260–406 ms**，合計 **1,622 ms**；模組計時含解析為 260–407 ms。API 回報 input **4,459 tokens**、output **236 tokens**。依 [TypeSafe 官方價格](https://docs.typesafe.ai/models) 當時每百萬 input tokens US$0.042、output 免費，估算約 **US$0.0001873**，不是帳單讀回。模型／格式另核對 [官方 API 文件](https://docs.typesafe.ai/api)。

本輪 4 個主核心回合送出至完成合計 **33.228 秒**；包含開啟／關閉的 native wall time **43.496 秒**。額外生成式抽取／整理呼叫仍為 **0**；不把人工檢查、腳本準備及前輪返工時間隱去並宣稱這是整體工程耗時。

### B 與真 C 的觀察，不宣稱 Jev 有效益

| 同題召回 | Claude 送出至完成 | Codex 送出至完成 | 共享注入／結果 |
|---|---:|---:|---|
| B2：Jev 關（前輪） | 7.230 秒 | 5.821 秒 | 各 987 字元，答案正確 |
| J：真 Jev 開（本輪） | 7.620 秒 | 8.394 秒 | 各 987 字元，答案正確；Jev 約 0.260／0.320 秒 |

- Jev relevance 為紙鶴 0.95、星橋 0.04，排序與本地相同；兩者均在預算內，所以沒有减少注入量，也沒有觀察到答案正確率提升。保留預設關閉，不為證明收益再加機制。
- 兩次測試非同時、快取與原生輸入不同，**不能把總延遲或 input 差異全算成 Jev**。本輪 Codex 同題原生 input=25,346、cached=11,008、output=280；Claude input=2、cache-read=14,784、cache-creation=19,007、output=532。完整四回合原生用量保留在 J summary；兩家欄位定義不同，不跨家相加，也不宣稱訂閱額度節省。
- 本輪只補足原授權的少量合成 live。正式 UI／部署／自動讀取 key、日常真實資料出網及穩定增益仍未驗證或未啟用。

## 使用與未驗證邊界

- 來源版 controller 的 `sharedKnowledgeEnabled=true` 為預設；設 false 同時關閉注入和自動捕捉。正式 installed runtime 未更新，所以**正式 K 尚未取得此功能**。
- Jev 預設 off。只在 **K 專案執行程序**明確提供 `K_JEV_ENABLED=true`、該專案授權的 `TYPESAFE_API_KEY` 才出網；可選 `K_JEV_MODEL`，預設沿上游 `jev-1.13.0`，本次帳號已 live 驗證。不得設到全域或把 key 交給主核心／worker。補驗 J 的 key 僅從上述專用檔由 acceptance 程序載入。**此模組不自動讀取 .env.local 或金鑰 txt**，不要以為加到檔案就已載入或啟用；仍需正式啟用時的 K 限定安全配置。
- HTTP：`POST https://api.typesafe.ai/v1/systemone`，Noul `answers[id].noul` 0–1；一次、3 秒上限、無重試、失敗走本地，使用者取消則不再送原生回合。不傳整個 workspace／歷史；僅當前 query 與最多 4 個候選摘要。secret pattern 掃描不是完整去識別，也不是任意資料出網授權。
- 已核對 [TypeSafe API](https://docs.typesafe.ai/api)、[Noul](https://docs.typesafe.ai/primitives/noul)、[Models](https://docs.typesafe.ai/models)。補驗 J 後可稱**「來源候選的雙核心與 Jev 合成 live 均通過」**；不可稱正式 K 已更新、日常 Jev 已啟用或已有穩定增益。
- 實測是 native controller／host 真模型，非完整 UI 與正式服務重啟。長篇通用蒸餾、語意不同說法的所有更正、native compaction 後再次召回、強殺程序恢復未 live 驗證。模糊 subject 不自動合併；來源不足保持未驗證。沒有全域記憶或歷史批次回填。

## 檔案與還原基線

本輪 8 檔：`src/shared-knowledge.mjs`、`src/desktop-controller.mjs`、`src/claude-controller.mjs`、`src/claude-host.mjs`、`test/shared-knowledge.test.mjs`、`test/shared-knowledge-controller.test.mjs`、本文件、`docs/development-log.md`。

修改前的既有檔案保存於 `.runtime/shared-knowledge-r1-20260928/implementation-baseline/`；Luna 交接版本另保留在 `luna-handoff/`。只作可回查基線，不自動回退或刪除任何舊資料。既有未提交修改、package/lock、正式 runtime、設定、登入位置均保留。
