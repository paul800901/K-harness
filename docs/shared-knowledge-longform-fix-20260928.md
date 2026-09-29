# K 共享知識 R1 長文缺陷修復 — 2026-09-28

## 最終判定

**本輪三個根因已修：定案不再固定四筆截斷、舊四條目副本可補讀缺項來源、更正不再憑零個關聯製造衝突。原凍結六項合成長文的雙核心行為驗收完成。來源候選未正式部署，不代表任意長文皆可靠。**

GPT-6 Luna High 實作，Astra 獨立讀 diff、保存檔、原生輸入與回答，實測抓到缺陷後退回修正。最後 20 個讀回／更正回合使用同一凍結程式；保存另有 2 個成功來源回合。定向 18/18、最後凍結版全套循序回歸 **638/638**。

內容覆蓋通過不等於引文完美：最後 Jev-on Claude A 有一處 record UUID 誤抄，詳見限制。未 push、部署、重啟正式 K、安裝套件、改全域、放寬原生權限或開啟日常 Jev。

## 實際修改

- `src/shared-knowledge.mjs`：移除固定四筆保存提示／截斷與整份 >16,000 字元排除。明確要求記住時必須輸出來源充分的 metadata，不因可見答覆簡短或禁工具而省略；保留純回讀、明確禁止 metadata、整體 exact-output 例外。仍使用當輪原生生成，沒有追加摘要模型。
- 同檔：從既有 sourceExcerpt 按查詢補讀完整相關段落，保留相鄰條件、否決理由與 provider/thread/turn/message。不是命中全文卻回傳不相干 sourceQuote，也不將整篇注入。
- 保存上限與選材分開：讀取仍至多四個索引候選加四個去重來源片段；主題命中優先，來源補讀在只有弱正文交集的索引項目前。Jev 在既定優先組內重排，不取得保存／更正裁決權。
- 整體注入維持 **1,500 estimated tokens**；現按實際背景說明、分隔、配對說明扣預算。最後 20 回合 1,306–1,496 estimated tokens；這是 K 估算式，不冒充供應商精確 tokenizer。
- 同檔：零／多個舊候選不憑數量標記 correction/revocation 衝突，不虛構替代關係。唯一舊條目仍沿用 supersede/revoke。已有更正／撤銷的主題不由其他舊全文復活，未更正段落仍可補讀。
- Jev HTTP payload 每候選有明確 `candidateKey`，問句依 key 定位；`sourceRecordId` 僅供來源追溯。原本多個片段沿用同一 UUID，卻引用未明列的 candidate_N，曾造成錯排。沒有新 MCP、服務或供應商框架。
- `src/desktop-controller.mjs`、`src/claude-controller.mjs`：各一處已注入記號修正，讀過一段不等於讀過關聯條目或整篇。重開解析也不會把 `source-record=` 誤當 `record=` 已讀。
- `test/shared-knowledge.test.mjs`：自含長文保存、缺項補讀、後續另一主題、撤銷防復活、缺少關聯、候選定位及整體預算回歸；不依賴 Git 忽略的原凍結素材才能跑。
- 本報告、R1 主報告與 development-log 更新交接。未改兩顆核心原生記憶、host、權限或正式資料。

K 注入的逐字摘錄已是可引用的歷史陳述證據，不要求為證明看見摘錄而另搜空工作區；但它不是現況或已執行證據，必要工具核實與原生核准仍保留。

## 素材與新保存讀回

原始資料、題目、答案表與失敗報告均未改寫：

- `.runtime/shared-knowledge-r1-20260928/acceptance/longform-distributed/source.md`：21,527 字元；SHA-256 `0CB75DE87275BDCD9FD72B7B30E50D2C0EE3A472533C50AD6B64F73E51891192`。
- 同目錄 `fixture.json`：SHA-256 `C151B9BB9D54CABAA7BE882C10C4512FC6BE598019DE4D23F68A8AED98226ED8`。
- 原 `state-source` 仍四條，發布／回復缺少索引，但原文仍在。

成功保存證據：`.runtime/shared-knowledge-r1-longform-fix-20260928/acceptance-final/capture-receipt.json`。

| 來源核心 | 實際保存 | 原文引句 |
|---|---:|---|
| Claude Opus 5.5 | 6 條 | 6/6 與凍結六段 sourceQuote 逐字相符 |
| Codex GPT-6 Luna High | 6 條 | 6/6 與凍結六段 sourceQuote 逐字相符 |

包含 Windows／Linux／非完成限制、17／60 天與120 MB 理由、四次失敗與非對外授權、47／45／0 門檻、紫砂-205 順序及不可覆蓋、模型權限與自動修補否決理由。每條保留 21,625 字元 sourceExcerpt（長文加原使用者指示）。後續僅改引用說明、讀取選材及 Jev 定位，保存路徑未再改；最後讀取使用成功保存檔的逐位元副本。

## 最後雙核心實際回答

最後證據根目錄：`.runtime/shared-knowledge-r1-longform-fix-20260928/acceptance-closeout/`。各 `LF-*.json` 有實際 native input、原生回傳／用量、程式雜湊、工具、答案及關閉結果；`*-receipt.json` 為各組彙整，`acceptance-summary.json` 為完整數據與人工判讀。

沿用原 queryA（發布／備份／告警）與 queryB（驗收／回復／權限），沒有把答案放進題目。6/6 包含六項的重要條件與否決理由，不把另外未知的樣本清單或執行狀態算漏答。

| 測法 | Claude 新房 | Codex 新房 | 工具 |
|---|---:|---:|---|
| 新六條目，跨核心正常首答 | 6/6 | 6/6 | Claude 0；Codex B 2 次空工作區搜尋 |
| 舊四條目，原禁止工具隔離題 | 6/6 | 6/6 | 全部 0 |
| 舊四條目，正常權限、Jev 關 | 6/6 | 6/6 | 全部 0 |
| 舊四條目，正常權限、真 Jev 開 | 6/6 | 6/6 | 全部 0；Claude 有一處引用 ID 誤抄 |

新 Claude 讀 Codex 保存，新 Codex 讀 Claude 保存。舊副本各問題回合後仍只有四條，沒有補索引／全庫回填。正常測試沒有禁止工具，沒有要求使用者重貼、重述或指路，也沒有先答缺少定案再等提醒。**本次補讀由 K 在送出前本地完成**，不是宣稱原生工具額外開檔救回缺項；空目錄搜尋未提供答案。

### 更正、撤銷與新程序

- 新 Codex 將珊瑚-681 更正為雲母-392，保留 Windows-only、Linux 未驗證、否決全平台自動發布及不等於完成。
- 原來沒有發布索引；新 correction 實際為 `unresolved:false, relation:null`，未虛構舊關聯。
- 17 天舊條目 inactive；新 revocation 指向真正舊條目。新天數未知，不是 7 天。
- 結束程序後，新程序的新 Claude／Codex 均首答使用新通道、拒絕沿用 17 天、保留未知與操作限制，沒有無來源的衝突警告。
- 再用 queryB 問未更正部分，Codex 仍讀到停寫→比對→紫砂-205、不可覆蓋；它另做 2 次空目錄搜尋，沒有請使用者指路。
- 證據：`correction-receipt.json`、`reopen-receipt.json`；歷史及舊原文保留。

## Jev 關／開與用量

只用專案已授權的 TypeSafe key，由測試程序暫時啟用；原生 host 環境先移除 key/Jev 變數。只送合成 query 與有限候選，不送金鑰、整篇長文或其他專案資料。

最後四次真 HTTP 均 200，`jev-1.13.0`，每次 7 候選、選入5個，**244–392 ms**；合計 input **10,262**、output **520**。沒有重試。關／開選入條目／片段集合完全相同，部分順序改變，覆蓋相同。候選不全放得進預算，但本組仍未證明 Jev 增加覆蓋或節省成本。

以下各為兩題加總；不把訂閱登入的名目 API 價格當實際帳單：

| 核心／Jev | 原生 input | cached/read input | cache creation | output | 送出至完成 |
|---|---:|---:|---:|---:|---:|
| Claude 關 | 4 | 53,048 | 17,945 | 2,846 | 30.903秒 |
| Claude 開 | 4 | 35,122 | 35,871 | 2,487 | 27.111秒 |
| Codex 關 | 48,573 | 22,016（input子集） | 未另列 | 1,717 | 45.588秒 |
| Codex 開 | 53,224 | 29,184（input子集） | 未另列 | 1,624 | 55.075秒 |

Claude 三類 input 合計兩組都70,997；Codex 不重複加 cached input。樣本少、快取與答案長度不同，不能作速度／費用因果結論。產品額外生成式摘要／整理呼叫仍 **0**，沒有一個既存獨立摘要呼叫可宣稱被 Jev 省掉。日常 Jev 仍關閉。

## 返工證據保留

本輪共啟動 **50 個原生測試回合**：49 完成、1 因核准擴搜父目錄中止；完成不等於語意通過。最後結論採成功保存2回合及最後凍結版20回合；其餘28回合是保留的調試／中途驗證，不混入成功率。修復期間真 Jev 共8次，包含中途4次與最後4次；上方用量表僅列最後成對比較，不冒充整輪工程用量。

以下路徑相對於 `.runtime/shared-knowledge-r1-longform-fix-20260928/`：

- `acceptance/initial-review.json`：第一版原 query 仍漏發布／回復；退回，不採帶答案的題目當證明。
- `acceptance/capture-receipt.json`：Claude 實存6，Codex 說記住但實存0；收緊明確記住時的 metadata 契約後以新來源回合複驗。
- `acceptance-final/new-normal-receipt.json`：Claude 有摘錄仍要求擴搜父目錄。沒有批准讀取可能含答案的父目錄或放寬權限；釐清來源摘錄語意後重測。
- `acceptance-reviewed/`：背景說明變長後，完整注入估算曾達1,608；改依實際說明扣預算，沒有調大上限。
- `acceptance-verified/old-isolated-receipt.json`：禁工具 B 被弱索引擠掉回復，兩核心5/6。
- `acceptance-verified/old-jev-receipt.json`：候選定位不明前 Codex5/6，HTTP200仍判失敗。排序／candidateKey修正後原題兩核心6/6。
- 原 `docs/shared-knowledge-longform-test-20260928.md` 及原4/6失敗證據未覆寫。

## 限制與正式狀態

1. 只驗證本份六項明確定案、刻意配置干擾段落的合成長文，不保證任意自然對話、長度與查詢改寫。沒有來源或超預算時仍不可猜答案。
2. 最後 `LF-old-jev-claude-A.json` 把備份 UUID 誤抄為 `56aa309b-8fc1-45ff-bc07-385291b8a4cb`；正確是 `56aa309b-6509-43cf-bee1-13ca508a8900`。注入／保存 ID、逐字引文與定案內容正確，但不能稱模型引用全無錯誤；本輪不擴充引用校正系統。
3. 正常模式仍可能無必要地搜尋空工作區；不改核心原生行為，不以禁工具換取指標。
4. 使用 K 現行 controller／官方原生 host 與既有 K 專用登入 home，合成 workspace/state；不是正式 UI／安裝版／日常資料驗收。Claude 原生手動核准、Codex 原生唯讀，未使用 externalSandbox 或擴權。
5. 未證明一般大量候選下 Jev 優勢，未建立全庫遷移、記憶服務、向量庫或下一輪擴張。

必要修復、回歸與上述原生讀回已完成，停止實作與 live 呼叫；**正式部署尚未執行**。

