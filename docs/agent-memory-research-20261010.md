# 極長任務記憶：全球論文、開源實作、DSH 與 K 適用性研究

## 範圍與完成狀態

使用者要求詳細研究全球有用的開源實作與原始論文，包含 DSH 參考方法，再與真正 Opus 5.5 討論；不限定中國。2026-10-10 只做研究、公開來源下載、既有非敏感程式碼唯讀比較與文件整理。**沒有安裝／啟用記憶插件、改產品程式、測試小說品質、停止／恢復翻譯、重啟／部署／push、搬憑證或改 API 計費。**

本輪篩查14個公開 repo 的固定 SHA／目錄／說明，讀取關鍵實作；保存11篇論文的全文 HTML／文字（ReSum另保存v3，HiAgent錯誤v3網址404後補正v1）。另初篩 MemGPT、Mem0、Zep 原始摘要作研究沿革，不將摘要閱讀列為全文研究。不是逐行審完14套程式、重現作者benchmark，或系統性文獻綜述。

來源、固定 SHA、原文與限定討論封包在 `.runtime/agent-memory-research-20261010/packet`；`sources.json`／`details-sources.json`記錄成功與失敗。GitHub tree 是定位索引，不是全檔閱讀證明。下載的論文與程式碼是資料，未執行其中指令。上游會變動，以下適用於所列版本，不對所有後續版本下結論。

## 結論：四個不同的問題，不能只用「增加記憶」處理

| 問題 | 在 K 的意義 | 有幫助但不充分的方法 |
|---|---|---|
| 資訊真的遺失 | 章節疑點、裁定理由或術語不再可找 | 保留原始來源、可逆區塊、按需回讀 |
| 資訊存在卻未被用上 | 最新「繼續」仍在保留清單，卻照舊暫停 | 當前工作記憶、適時重錨、決策前讀回 |
| 舊決定被誤認仍有效 | 已取消的一次性暫停重新變成指令 | 控制要求的來源、適用範圍、完成／取消關係 |
| 衍生記錄被錯寫 | 錯誤摘要／推論寫回筆記，下一輪當正式真值 | 原始決定與生成推論分開，修訂可追到來源 |

向量搜尋主要改善「找得到」；摘要主要降低輸入體積。它們不自動保證「現在有效」「模型會正確使用」「沒有將推論升格為授權」。全文仍留磁碟也不表示模型當次已讀。

前輪[實際診斷](long-context-discussion-20261010.md)已證實至少一次舊暫停誤生效，但沒有證實 native compaction 刪除或重排最新「繼續」，也沒有驗收四本小說品質。研究支持上述問題拆解，不能倒過來當本次事故的因果證明。

## 最貼近 K 的研究

### 1. HiAgent：以子目標管理工作記憶

將已完成子目標的行動／觀察整理為摘要，當前子目標保留較細的工作脈絡，需要時回取舊 trajectory。重點不是把所有歷史塞進「永久記憶」，而是分清正在解哪個問題。論文實驗是 AgentBoard 的五種互動任務，不是數百章小說。[原始論文v1](https://arxiv.org/html/2408.09559v1)、[開源實作](https://github.com/HiAgent2024/HiAgent)。

**K 可借：**以既有章節／批次邊界刷新工作狀態，保留未決疑點與下一步；已完成細節按需讀回。不移植AgentLoop。`evaluate_model.sh`選`ContextEfficientAgentV2`，入口`cme_final.py`依環境決定是否摘要，示範blocksworld關閉摘要；`ours_agent.py`不是此入口。不能把所有任務成績歸因於摘要，也不能以模型自判子目標完成替代成果驗收。

### 2. LongMemEval：搜尋正確，仍可能讀錯

評量包含資訊抽取、跨會話推理、時間推理、知識更新與無法回答時拒答。作者區分 indexing／retrieval／reading：保存對話回合與擴充搜尋鍵，而非只把對話拆成孤立事實；即使完美取回，閱讀策略仍影響正確率。[原始論文v2](https://arxiv.org/html/2410.10813v2)。

**K 可借：**搜尋結果帶角色、原始次序與來源範圍；最新更正與它取代的決定一起看。不能拿 LoCoMo／LongMemEval 的問答分數當作目標暫停／續行、章節不重做或文學品質驗收。

### 3. Revoked but Still Authoritative：失效資料不能只貼標籤

這篇預印本直接測試舊規則被取回後是否影響行動，另檢查代理將錯誤決定寫回造成失效標記不再附著的問題。正文區分不同配置：mem0預設能排除已標失效記錄，但自然語文更正未被標記時無法靠這項過濾解決；暴露臂使用flag override。不能照摘要泛稱全部系統預設失敗。衝突guard也有誤攔及部分場景惡化。[論文v1](https://arxiv.org/html/2609.08258v1)、[實驗與guard原碼](https://github.com/VulcanLab/Memory-Rebirth-Attack)。

**K 可借：**同一控制要求的完成／取消應連回原始要求；衍生摘要不能重新創造授權。**不採其guard直接部署**：固定原碼`guard/stale_guard.py::_tokens`使用`[a-z0-9$]+`與英語反義詞，不能直接處理中文「暫停／繼續」。即使另做中文分類，也不能用「時間最新」取代適用範圍、條件與權限判斷。

### 4. Proactive Memory Agent：在需要時讓記憶影響下一個動作

將需求、環境事實、失敗嘗試、診斷、未決子目標保存為工作狀態，額外記憶代理決定給提醒或沉默。Terminal-Bench／tau²-Bench有行為實驗；但always-inject等消融只在tau²測，always-inject的micro均值略高、selective的macro較平衡，**不支持「選擇性必然較好」**，更沒測K小說。[論文v1](https://arxiv.org/html/2607.08716v1)、[開源實作](https://github.com/yifannnwu/proactive-memory-agent)。

**K 可借：**在少數邊界讀回小份現況，不先加第二代理。實作需LiteLLM／Harbor等與額外模型調用，不是K原生CLI插件。主實驗固定間隔喚起，再選是否提醒；事件驅動只是候選。其always-inject仍由模型合成提醒，不能由它證明「固定貼短現況」已有效。

### 5. ReSum：摘要有效，但模型是否適應摘要也很重要

訓練前就有外部summary-tool方案，另用ReSum-GRPO訓練模型適應壓縮後脈絡。不能把訓練增益直接套到未訓練的訂閱模型。實驗主要為網頁搜尋代理。[最新版論文v3](https://arxiv.org/html/2509.13313v3)、[WebResummer實作](https://github.com/Alibaba-NLP/DeepResearch/tree/main/WebAgent/WebResummer)。

**K 可借：**壓縮後接續需要驗證行為，不是摘要生成成功就算完成。**不採：**在K再加一套ReSum摘要，或改閉源訂閱模型權重。

## 其他有用方案：有價值，但不是全部搬進 K

| 方案與原始來源 | 可借做法 | 與本任務的落差／成本 |
|---|---|---|
| [SimpleMem](https://arxiv.org/html/2601.02553v1)、[code](https://github.com/aiming-lab/SimpleMem) | 消除代詞歧義、轉絕對時間、密集記錄與混合檢索 | `semantic lossless`是設計目標，不是形式無損保證。當前text core有write-time synthesis，不能沿用舊評論稱Stage2未實作；Evolve／Omni與原論文版本另分。需要抽取／生成模型及索引。 |
| [EverMemOS](https://arxiv.org/html/2601.02163v1)、[目前EverOS](https://github.com/EverMind-AI/EverOS) | episode／atomic fact／臨時foresight與有效期，穩定知識與暫時狀態分開 | LLM推定有效期不是使用者授權的可靠來源。舊repo已重導EverOS，當前Markdown＋SQLite＋LanceDB不能直接繼承舊論文實驗成績。 |
| [MemOS](https://arxiv.org/html/2507.03724v4)、[MemTensor code](https://github.com/MemTensor/MemOS) | MemCube附來源、版本、生命週期；現有DSH插件可參考 | 原論文還含activation／parameter memory，閉原生核心不能任意修改。當前本地插件仍有模型抽取／過濾／演化，儲存本地不等於所有模型處理離線。 |
| [MemoryOS](https://arxiv.org/html/2506.06326v1)、[BAI-LAB code](https://github.com/BAI-LAB/MemoryOS) | 短中長記憶更新、對話鏈／分頁 | 與MemOS不同專案。偏個人化跨會話記憶；多層資料與摘要操作尚無證據是K第一批所需。 |
| [A-MEM](https://arxiv.org/html/2502.12110v11)、[研究code](https://github.com/WujiangXu/A-mem) | 結構化notes、關聯與可演化記憶 | 自動改寫既有note也可能傳播錯誤推論。研究repo與README所指A-mem-sys產品實作要分開；本輪未審後者。 |
| [Hindsight](https://arxiv.org/html/2512.12818v1)、[code](https://github.com/vectorize-io/hindsight) | 分開外部事實、經驗、歸納觀察與意見／belief，保留證據來源 | 可借「推論不等於正式決定」，不必先搬PostgreSQL與完整retain／recall／reflect服務；新增模型處理成本須計。 |
| [Graphiti code](https://github.com/getzep/graphiti)、[Zep原始論文](https://arxiv.org/abs/2501.13956) | 時間有效性、來源與關係查詢 | 當前SearchFilters有valid_at／invalid_at／expired_at欄位，不等於呼叫者已正確使用，或自然語言取消一定已被記錄。沒有必要先把K做成知識圖譜。 |

[MemGPT](https://arxiv.org/abs/2310.08560)的虛擬脈絡／分層記憶、[Mem0](https://arxiv.org/abs/2504.19413)的抽取／整合／取回亦是重要沿革。本輪僅初篩兩篇摘要，不做特定現行實作可靠性結論，不按不同論文、模型、資料集的百分比排列誰最強。

## DSH 到底有什麼，以及本機是否有用上

### 官方原生能力

只讀核對`D:\DSH架構\DeepSeekHarness-0.2.1-alpha.1-local`，HEAD`28bd1fe6bc7b504ca2a2d4949f332df0e0caad39`。參考資料README明確區分公開alpha來源與實際桌面0.2.0-rc.2，不能當成完全相同runtime。沒有讀取DSH會話／家目錄設定／憑證／臨床資料。

- 官方將append-only原始事件與當前derived surface分開；compaction以替換可見區段呈現，不刪原log，來源可回溯。[官方compaction說明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md)。
- 本機`compaction-basic/src/summarizer.ts`是結構化checkpoint，明確要求合併prior checkpoint、保留仍真、丟掉過期內容。這仍是模型摘要，不保證每次正確；DSH官方不是「完全不會重壓舊摘要」。
- `session-query`有bounded event讀取、原始log／surface、search與trace的服務介面；全文排名需相應SQLite backend。服務存在不等於模型在該桌面有可呼叫工具或實際會用。

**本機可見local-plugins只有繁中、字型與workspace-trash。沒有取得專門記憶插件已在目前桌面使用的證據。**不排除其他位置或過去候選有試驗，但不能用使用者印象推定正式已啟用。

### 三種第三方策略

| 插件 | 實作上真的做什麼 | K 判斷 |
|---|---|---|
| [dsh-infinite-context](https://github.com/chocobo77/dsh-infinite-context/blob/1988fae1ef7c2678a85a643e8b690a753f6d0649/ARCHITECTURE.md) | 擴充BasicCompactionEngine；SQLite＋embedding／取回，多層summary、mergedFrom、合併後降級與遺忘，原碼亦trim舊long memories | 有可學的來源與按需取回；多層摘要仍可能失真，遺忘不能用於未決工作或正式授權。不能直接移植DSH內部接點到K。 |
| [billion-context](https://github.com/ranxianglei/billion-context) | 增量區塊fold、search／decompress、保護近期；有代理／原生整合分支 | 可逆來源區塊值得研究。通用proxy改baseURL／stream並注入工具，不是本次K授權。作者自列單一使用者、觀察性資料、小pilot／部分節省推估、summary品質未量化、英語規則等限制；十億tokens含累計cache重讀，非同時可見容量。 |
| [dsh-topics-memory](https://github.com/fan56/dsh-topics-memory) | 編輯當前topic結論、source／status、budgeted詞彙與CJK取回、git歷史、observer／distill | 比無限制累積更貼近最新裁定。hot-path詞彙取回免LLM不表示整套免費；當前還有Jev／蒸餾等路徑。只存結論不能代替當前章節疑點，原樣部署也違反K現行共享知識排除邊界。 |

`billion-context`的API metadata license是NOASSERTION，但固定SHA的LICENSE原文是MIT；不以GitHub自動標籤取代實際LICENSE。其他授權見各metadata／LICENSE。只讀研究不代表已做移植授權／相容性審查。

## 對 K 的候選順序：先取得確實會生效的入口

### 第一階段：不建立新的記憶平台

1. **先probe原生接點。**新建假資料對話確認回合內原生自行壓縮、goal續行、訊息／來源讀回與非使用者提示入口；不拿正在翻譯的四個聊天室測。確認注入角色、時機、模型可見性，不假扮本人新命令、不打斷工具。只在open/resume刷新不够。
2. **沿既有記錄保留當前工作。**在自然章節／批次交接時刷新已驗收範圍、正在處理處、工單ID／成果位置、未決疑點與下步。持久術語／裁定仍留原本正式位置，不複製成第二本真值帳。
3. **控制與知識分開。**一次性暫停、延後暫停、已取消／已完成要求不能作為永久偏好；保留原始來源和適用對象，明確繼續不由舊摘要再次撤銷。新的合法pending pause須持續有效，不能見native active就自行取消。本人訊息id／順序只證明來源與次序，不自動解析自由中文語意；native goal是目前觀察、可能已被錯改，不能反過來當授權。先查既有可靠控制事件；沒有時保留本人來源、後續取消／繼續與未知，不承諾純確定性推導，也不默認新增通用NLP分類器。
4. **來源先於衍生解釋。**筆記中的裁定可回讀本人原始更正；模型推論／未決與核定事項分開。抽取或更新的錯誤應能修正而不覆寫原始證據。已失效記錄可供歷史查詢，但不當現行操作授權；資料來源相同不表示現在有效。
5. **選擇性重錨。**壓縮後、工作批次接續、準備改控制狀態前，讀入小份必要現況／指標；不每輪貼整庫，不設每N次自動換房。唯讀工具不能保證模型會呼叫；注入有效也不等於原生update_goal已被K阻擋。

這不是零機制：需要確實可接的讀回／呈現與既有狀態更新，但第一批不預設embedding服務、knowledge graph、常駐memory agent、多層OS、全域記憶庫或新的人用設定。

### 第二階段：有實證缺口才比較較強方案

- 若原始決定常找不到，先比較bounded全文／詞彙＋回合來源與檢索鍵，再考慮語義或混合檢索。
- 若取得正確資料仍反覆不用，隔離比較Proactive風格的選擇性記憶代理；所有額外模型調用、工人費用、主代理額度和延遲須計入。不是本輪授權開API或新增常駐模型。
- 若原生同一session仍反覆出錯／壓縮失敗，再於安全批次邊界測新session與來源交接。一般fork複製歷史不等於清空；未知工單先查結果，不重送。
- 區塊可逆壓縮可研究，但先走公開擴充。只有具體限制與新授權才能考慮改原生核心／代理流，不以插件支援標章假定K可用。

## 相稱的驗證：可靠性與成本都要看

採同模型／effort／工具／任務材料比較現況與候選，不只比token縮減。先小型probe，再逐步覆蓋本次觀察的長度；短測試成功不能宣稱數十至上百次壓縮可靠。測試必須真的跨原生壓縮／自動續行，不只人工寫摘要假裝。

- 舊暫停→繼續→多次壓縮後不復活；轉述／引用舊要求不應變新命令。
- 新暫停有效、等待已派工自然收尾的pending pause有效、中途取消有效；不能為避免誤停而一概不停。
- 永久更正不退回、臨時規則不永久化；刻意錯寫衍生筆記時能回讀原始來源，不自我加強。
- 四個獨立聊天室互不污染；已完成工單不重做、未知結果不猜；核准／權限／額度語意保留。
- 翻譯另看完整原文與成果的忠實度、事件／人物／時間／術語一致、遺漏／重複、接受的潤色規則。問答benchmark與快照不是替代品。
- 記錄總完成時間、實際驗收結果、原生能取得的用量／額度及全部新增記憶處理成本。無法取得的計費／額度保持UNKNOWN；本地儲存不是隱私或額外模型零成本證據。
- 記錄新增提問／誤報頻率：不能以每次都問本人來換取表面正確率，將工程工作交回使用者。

## 真正 Opus 5.5 討論與 Astra 獨立複核

官方Claude Code **2.1.294／Pro訂閱**，實際assistant model **`claude-opus-5-5`**，session **`0535505e-6c2a-42a2-a0b4-0bf60d88a371`**。兩輪exit0、success、is_error=false；第一輪20次Read／Glob／Grep，第二輪4次，Astra逐項核對具名路徑均在限定packet，無其他工具。第二輪是同一已完成session的明確接續，不是失敗重試。preflight核對claude.ai／firstParty，未改登入／API計費，沒有調用其他模型。

原始`raw.jsonl`、`result.json`、`review.md`與第二輪問題／輸出保留在研究目錄及`round2`。工具模型回報的duration_ms為154894／43528；兩輪usage合計input_tokens34、cache_creation_input_tokens75809、cache_read_input_tokens862465、output_tokens16191。這是討論額外推論工作，不是記憶方案成本實驗，也不是訂閱實際扣額或美元帳單；不能用cache重讀量當獨特資料量。

### 採納的補強

- 筆記錯寫可能放大舊規則；因此**控制授權不能由模型生成的進度敘述創造／恢復**。這強化前輪原始來源優先，不是已證實K發生write-back污染。
- 小說工作記憶照常更新：已驗收進度、術語、人物事件與本人核定更正仍必要，不能因怕錯寫就全禁止。保留可回讀的來源，不另外造一份真假值帳。
- 第一候選只有三項實質機制：控制來源讀回、章節粒度工作記憶、少數邊界的來源化重錨。檢索鍵／語義搜尋與第二記憶代理，等有相應缺口再比較。
- 回讀不能只列兩句等價的新舊文本；要呈現角色、原始次序、相同要求的前後關係及其不確定性。這仍要實測，不宣稱加註順序就必然解決。

### Astra指出、Opus已撤回／修正的過度推論

1. 「由訊息id＋native goal＋工人即時推導控制狀態、完全不用保存」沒有解決自由中文語意、條件／引用／延後暫停，也沒有算搜尋與模型判讀成本。Opus撤回。native goal可能是誤改結果，不是本人授權。
2. mem0「只直接插入才有預設filter」混淆機制與標記是否產生；修成能排除已標失效，不保證自然語文更正已標。
3. 「選擇性提醒一定勝過always-on」不受完整消融結果支持；修成邊界短提示可以比較，但未證實K有效。
4. 「受測模型都不是Codex」混淆產品與model：論文有OpenAI模型，但未測本次K版本／模型／goal續行／反覆壓縮組合。ReSum也不是K新native session交接的直接驗證。

**Astra未採第二輪剩餘的過度限制：**缺少結構化控制事件不等於「沒有任何可用授權」。本人明確原句就是來源，不能要求每個一般要求再確認一次或全部標UNKNOWN；只有確實會影響操作的語意歧義才另問。也不將不支援注入時的唯讀tool候選稱作等效修復；模型是否會用仍需驗證。

本輪完成的是研究與討論，不是候選實作／行為regression。沒有證據設定固定壓縮次數門檻，沒有證明外掛記憶可消除全部翻譯偏移；**也不能以未知根因為由維持現況不處理——應先以假資料確認可接入口與上述三項機制，再按實際長任務結果決定是否需要更強方案。**

## 固定公開來源版本

| repo（重導後名稱） | SHA |
|---|---|
| chocobo77/dsh-infinite-context | `1988fae1ef7c2678a85a643e8b690a753f6d0649` |
| ranxianglei/billion-context | `7201b454f7119bd9a1a65551940c703cd2315dd7` |
| fan56/dsh-topics-memory | `611c00b43859b243a39e6fd458b0135e05a46f34` |
| MemTensor/MemOS | `a7367d07e55db61099f7b4e2c1108bc5831a24f3` |
| BAI-LAB/MemoryOS | `587ed7755c7aed179965792830ff1b5ad9a6fa92` |
| EverMind-AI/EverOS | `824dfc784d65ac3628c212b8c3d9cd8511d3d815` |
| aiming-lab/SimpleMem | `db80b6a7c591e0ea730a058e9f5fc4eb06572299` |
| HiAgent2024/HiAgent | `cebdd8e4eacec1a532ce2c0041db8902217b90ba` |
| vectorize-io/hindsight | `44d5340148fd47efb34e184d61f87ab5e2d8d1e2` |
| WujiangXu/A-mem | `0c8039f28fdcc08189a23c07a3437d9d2482f9c2` |
| getzep/graphiti | `a9ef13f7e2cce23e92abd2f76947f42e270da25a` |
| VulcanLab/Memory-Rebirth-Attack | `89ed1ef1a190aa762da5f67b4ba97c256112f8be` |
| Alibaba-NLP/DeepResearch | `f72f75d8c3eb842f2bbbab096a12206ff66e270f` |
| yifannnwu/proactive-memory-agent | `89e5c0d6aadfe531a1aee42fd290d48be89973dd` |

查閱記憶只用來找DSH既有邊界與成本比較要求；實際路徑／源碼／版本已本輪讀回，未用歷史記憶宣稱現行部署。前次共享記憶研究是定位材料，不繼承其「手動預置事實能回答」作自主記憶或最新更正驗收。本輪尚無候選行為實驗結果。
