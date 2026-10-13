# 共享記憶替代方案：上游更新、公開方案與隔離試跑（2026-09-30）

後續使用者已授權並執行原生核心試驗，見 [Basic Memory 原生核心實測](basic-memory-native-pilot-20260930.md)。該輪 Codex 自主首答 6/6，但模型改寫原文、Claude 來源受阻，尚未通過雙核心及更正驗收。以下保留本次研究與工具層結果，不以後續部分成功抹去限制。

## 範圍與判斷標準

使用者反映實際使用仍不滿意，要求查原作者更新、尋找較有實績的公開 GitHub 方案並下載試跑。過去凍結合成案例通過，不足以推翻使用者的實際失敗，也不等於正式 K 已有可靠記憶。

本輪只查公開來源、下載固定版本，在 `D:\K-harness\.runtime\memory-alternatives-20260930` 用合成資料測工具層。使用者另明確批准 Basic Memory 在此獨立實驗範圍安裝相依；不改全域、不接正式 K、不啟用付費 API。Luna 負責限定研究與 Basic Memory 安裝，Astra 獨立核對上游差異、原碼及實際工具讀寫。

共享知識仍遵守 9/30 正式規則：**排除於正式 K／R2，不因本輪下載或成功啟動而納入。** 本輪沒有修改 K 產品程式、push、部署或重啟正式 K；其他工程工作的正式狀態由其各自報告記錄。

成功分三層，不互相代替：

1. 公開實績：維護、採用、研究評測；星數不是正確率。
2. 本機工具：保存、搜尋、來源補讀、指定更正與程序重開。
3. 使用者真正需要的行為：新 Claude／Codex 不用使用者重貼或指路，在第一個實質回答自行找對來源、採用最新定案、正確引用。**本輪工具試跑不等於第 3 層驗收。**

## 原作者確實更新，但沒有新的記憶核心修正

查核時 `fan56/dsh-topics-memory` HEAD 為 `69cfe2f2441af756d5a68137c3c23ef894375d52`，2026-09-29 23:04:41（臺灣時間）。相較原固定的 `e1cae8a25343cfecbe9ae9bf01906a3d2bbb62b9`，新增 2 個提交：

- [`2498951`](https://github.com/fan56/dsh-topics-memory/commit/2498951c1d8d30784fd0a4d1d520d0c6c9625d02)：配合 DSH 0.2.0-rc.2 調整依賴與相容版本。
- [`69cfe2f`](https://github.com/fan56/dsh-topics-memory/commit/69cfe2f2441af756d5a68137c3c23ef894375d52)：容器測試改由 dist-tags 選 DSH，避免安裝失敗卻被當成功。

獨立 compare 讀回共 7 檔：`CHANGELOG.md`、兩份 README、`e2e/Containerfile`、`e2e/run-e2e.sh`、`package-lock.json`、`package.json`。**沒有修改 src 記憶核心；不是修復 K 跨聊天室漏讀的證據。** 不建議只因有新提交就再移植一次。Jev 仍是重排／配對前置，不是完整保存、原文回讀或正誤裁決的替代品。

REST 差異讀回：`D:\K-harness\.runtime\memory-alternatives-20260930\upstream-compare.json`。後續公共 GitHub REST 額度用盡，本輪沒有借用登入憑證或繼續反覆重試。

## 候選比較

採用量是 9/30 查核時的約略星數，只用來分辨有無相當社群，不用來認定可靠或排名準確率。

| 公開專案 | 可查到的實績／設計 | 對 K 的價值與限制 | 本輪選擇 |
|---|---|---|---|
| [Basic Memory](https://github.com/basicmachines-co/basic-memory) | 約 4,000 星；本機 Markdown、MCP 讀寫搜尋；AGPL-3.0-or-later | 保存原文、明確來源及有限片段回讀，符合目前缺口；不會單憑安裝就自動記住所有對話 | 優先實驗；安裝固定 main 原碼而非冒稱穩定發行版 |
| [Engram](https://github.com/Gentleman-Programming/engram) | 約 7,000 星；Go 單檔、SQLite／FTS5、MCP；MIT | Windows 可攜、低整合負擔；單條記錄大小與全文問句搜尋仍要實測 | 已下載官方 Windows v2.2.1，實測結果見下 |
| [Hindsight](https://github.com/vectorize-io/hindsight) | 約 43,000 星；有公開記憶評測論文；MIT | 可作研究型對照；需資料庫、模型處理與檢索元件，遠重於薄接頭 | 暫不安裝；不是本輪最小試驗 |
| [claude-mem](https://github.com/thedotmack/claude-mem) | 約 95,000 星；跨回合 hooks、背景整理與檢索；Apache-2.0 | 更接近自動捕捉，但安裝與背景模型路徑較侵入，不應直接套進現有雙核心 | 查原碼／文件，未執行安裝器 |
| [Mem0](https://github.com/mem0ai/mem0) | 約 66,000 星；通用記憶 SDK；Apache-2.0 | 可配置模型／向量後端；官網或 README 的最新託管平台成績不能全算成下載版 OSS 實績 | 不先增一套模型／儲存服務 |
| [Graphiti](https://github.com/getzep/graphiti) | 約 31,000 星；時序知識圖譜；Apache-2.0 | 時間有效性、來源關係值得參考，但需圖資料庫與抽取／嵌入，整合成本高 | 先不採用完整框架 |

Hindsight 的[作者論文](https://arxiv.org/abs/2512.12818)報告 LongMemEval 91.4%、LoCoMo 89.61%（各自實驗設定）；這比單純展示有更多評測依據，但仍是作者報告，不是本機重現，更不是繁中 K／兩家訂閱核心的成績。不能據此承諾裝上即成功。

Basic Memory 採本次原碼的理由：最新穩定 release 頁為 [v0.23.2](https://github.com/basicmachines-co/basic-memory/releases/tag/v0.23.2)，main 已包含 CJK 搜尋補強與按行讀取；不應拿不同版本混測。固定原碼中的 `repository/script_ngrams.py`、`mcp/tools/read_note.py`、`mcp/tools/posix_tools.py` 可直接核對，而非只依 README 標語。

研究期間曾有子代理把 issue 編號與問題對錯；主代理要求逐條重查，已撤回那些說法。本報告不以錯誤／未確認的 issue 狀態判斷產品。不宣稱 claude-mem 沒有中文修復，也不把已關閉的歷史問題寫成現行未修缺陷。

## Engram v2.2.1：本機真工具結果

固定 release 對應原碼 `818be842f57a95063f62f1b745297a96c407c143`，不是當日較新的 main。Windows amd64 官方壓縮檔 SHA-256 與 release asset digest 一致：

`c66947b2468d27104296fedb1bb8416f45fd880262606759217193a4bab9be0f`

MCP stdio 直接呼叫官方 exe，不開 HTTP、不接雲端、不安裝 agent hooks。為避開上游啟動時搜尋／搬移其他磁碟 orphan DB 的分支，先在實驗資料夾建立有效空 SQLite 檔；明確設定實驗 `ENGRAM_DATA_DIR`，關閉更新檢查與雲端同步，子程序只繼承必要 OS 變數及假的 home。

使用原 9/28 凍結合成稿與問題，**手動將答案表中的六個原文引句寫入**。這是儲存／查詢，不是模型抽取測試。

| 項目 | 實際結果 |
|---|---|
| 六條明確記錄寫入與逐筆讀回 | 6/6 引句完整 |
| 繁中短查詢：發布通道、備份、回復順序、告警 | 各取回正確 1 筆，二字「備份」也可查 |
| 不存在的銀河設定 | 無結果，沒有亂造記錄 |
| 原自然語言長問句 queryA、queryB | 預設 match-all 下均 0 筆；不能將整段提問原封不動交給此關鍵字檢索後保證召回 |
| 指定同一 topic_key 更正發布通道 | 原 ID 更新為雲母-392；不需額外裁決，讀回正確 |
| 關閉、另開程序 | 更正仍在；明確指定未知專案被拒絕 |
| 61,793-byte 完整來源當單條 observation | **被截到 50,000 bytes，工具有明確警告**；不能直接當無損原文庫 |

舊珊瑚-681 無結果的檢查是在另存歷史原文之前；不能延伸為保留歷史原文後全庫都不會再搜到舊值。長問句 0 筆也不能推廣成模型自行拆查詢後必然失敗。

證據：`engram-tool-schemas.json`、`engram-storage-v3.json`、`engram-reopen.json`、`engram-data-v3/engram.db`，均在上述實驗根目錄。SQLite integrity_check 為 ok。

先前 `engram-storage.json`、`engram-storage-v2.json` 留存兩次**試驗器**問題：回傳縮排造成等候逾時、把 JSON 文字回覆誤當純文字 ID；不是 Engram 產品失敗。重開試驗最後的未知專案回覆是預期拒絕，但試驗器將其當異常退出；正向重開讀回與原始工具錯誤均保留，不用退出碼掩蓋實際行為。

## Basic Memory：隔離安裝及主代理驗收

固定來源 commit：`88c3990c9a1747096c78fe330e97722a1b898f2f`。
來源 zip SHA-256：`39a7aae9ae014252111f72ef4ceaadb55e6333d462b9be653f08462fdfc78e30`。

### 安裝與隔離

- 使用既有 Python 3.12.14，在 `basic-memory-env/venv` 建獨立環境；套件快取、暫存、假 home、設定、SQLite 與筆記都在 `basic-memory-env` 下。
- 依固定 `uv.lock`、非開發相依安裝；本輪只驗本地文字模式，明確不安裝 `fastembed`、`sqlite-vec`、`openai`、`litellm` 四個直列依賴，停用語意搜尋與 reranker。**不是官方完整預設依賴／語意搜尋驗收。** 其餘傳遞相依帶有 onnxruntime 套件及小型內建測試資料，未要求下載或載入嵌入模型權重。
- 來源壓縮檔無 `.git`，使用上游打包 fallback `0.0.0`；CLI 常數顯示 `0.23.2`，都不能拿來冒稱正式 release。實驗身分以完整 commit 為準。
- 停用 Basic Memory 自動更新、Logfire、cloud mode，僅 MCP stdio、不開 HTTP listener。`bm --version`、help、初始化及 27 項工具清單成功。
- **非零網路聲明：** 安裝需要公開套件下載；前兩次 FastMCP 啟動觸發預設 PyPI 版本檢查。發現後以子程序 `FASTMCP_CHECK_FOR_UPDATES=off` 關閉，最終握手與主代理測試沿用此值。沒有呼叫生成模型／付費 API、傳入登入憑證或啟用雲端同步。

可重跑啟動設定與完整白名單環境：`D:\K-harness\.runtime\memory-alternatives-20260930\basic-memory-env\launcher.json`。
安裝／工具 schema：同目錄 `logs/install.log`、`logs/tools-schema.json`、`logs/stdio-probe.log`。

### 主代理真正 MCP 寫入、搜尋與讀回

沒有修改 Basic Memory 原碼，也沒有靠 shell 直接寫入它的筆記假裝工具成功。主代理經官方套件的 MCP 工具操作，再獨立從磁碟及 SQLite 讀回。

**先只保存原始長文，不先建立六個答案條目：**

| 項目 | 實際結果 |
|---|---|
| 61,793-byte／21,527 字元原文保存 | 完整；MCP read_note 與磁碟 Markdown 本文皆一致（比對容許外圍空白，讀回本文 bytes 仍為 61,793） |
| 六個繁中短查詢 | 發布通道、備份、告警、驗收門檻、回復順序、模型權限各找到同一原文 |
| 原 queryA／queryB 整段自然語言問題 | 純文字搜尋均 0 筆；沒有啟用向量／語意模式，不泛指產品所有模式 |
| 未存在的銀河設定 | 0 筆 |
| 缺項定位及局部補讀 | grep 回傳行號，再 read_note 讀發布通道 **49–51 行，100 字元**；回復順序 **341–343 行，80 字元**，完整取得兩項定案 |

局部補讀的行號來自工具回覆，不是答案表預先指定；這時全庫只有一份原文，沒有獨立發布／回復條目。試驗器依回覆中的「正式定案」挑片段再讀，**不是模型自行決定補讀的證據**。上述 180 字元只計兩次補讀的本文，不是整個搜尋／工具流程總 token；grep 及 metadata 另有開銷。

**後續才手動建立六個明確記錄，測試工具端更新：**

- 六個原文引句逐筆寫入／讀回 **6/6**；屬人工答案表種資料，未驗模型抽取。
- 指定 find_replace 將有效發布通道改為雲母-392；將備份記錄改為 17 天已撤銷、新天數未知、不是 7 天。兩筆當下逐字讀回正確。
- 關閉程序後另開：原始長文完整，更正與撤銷仍正確；三個正向持久性檢查通過。磁碟亦保存原文舊通道、有效決策新通道，沒有把歷史原文覆寫掉。
- **額外發現，不能省略：** 搜尋完整代號 `雲母-392`（含引號也一樣）為 0 筆；另開診斷程序，分搜 `雲母` 或 `392` 各正確 1 筆。`發布通道` 找到目前記錄＋歷史原文共 2 筆。讀回內容存在，所以這是本輪文字查詢的召回限制，不是資料消失；未追到足以宣稱唯一根因，也未修改上游修復。
- 使用 `--project main` 的單專案模式；對未知 project 的查詢回空，**不能當作跨專案拒讀／隔離驗收**。
- SQLite integrity_check 為 ok；四次主代理實驗程序都正常 exit 0，結束後未留本輪工具程序。

證據全在實驗根目錄：

- `basic_memory_probe.py`：一次性工具試驗器，避免覆蓋證據／重播寫入。
- `basic-memory-source.json`：只存原文時的實際請求、搜尋、行號與補讀。
- `basic-memory-records.json`：六條寫入、明確更正與撤銷。
- `basic-memory-reopen.json`：新程序持久性與完整代號搜尋 0 筆。
- `basic-memory-search-diagnostics.json`：複合代號與拆開查詢的差異。
- `primary-disk-readback.json`：主代理獨立磁碟本文／資料庫讀回。

## 判斷與下一個必要驗收

**Basic Memory 是較適合下一步的小型候選，不是已可替換正式 K 的答案。** 它在本輪確實顯示「完整原文不依賴事先抽成條目，也能以有限片段補讀」；Engram 適合輕量記錄，但直接拿單條 observation 收整份長文會遇到 50 KB 上限。兩者都不是把任意長問句直接丟進文字搜尋就能完成任務的回答引擎。

下一個有價值的試驗不是繼續堆記憶架構或再開 Jev，而是在獨立候選、相同凍結材料／注入限制下，讓 **Claude 與 Codex 實際自行使用同一套 Basic Memory 工具**：

1. 來源回合實際保存，不由試驗器預先種好六個答案。
2. 新聊天室只交原問題，正常工具權限；不給正確關鍵字／行號／答案，觀察第一個實質回答是否完成並正確引用。
3. 另一聊天室明確更正與撤銷；重開後須分清目前有效、歷史作廢與未知，不能只列出互相矛盾的搜尋結果。
4. 保留整句查詢及複合代號失敗證據，評估模型能否自主改查詢；不由使用者提醒後才補救，不硬編碼答案。

**這組雙核心驗收本輪尚未執行，也未新增 K adapter 或安裝全域 hooks。** 工具層有進展，但不能再將其升格成跨聊天室記憶已成功。

## 尚未證明的事

- 自動捕捉整個 Claude／Codex 來源回合，且沒有漏掉明確定案。
- 新聊天室在首個實質回答自行搜尋、補讀、判斷更正／撤銷、正確引用。
- 一般自然長文、足量不相干候選、不同中文問法與多次更正的可靠性。
- 相對原 K 的總完成時間、訂閱額度或實際成本改善。
- 任何 Jev 增益或正式 K 整合／部署。

**先確認來源能完整保存及取回，再驗模型真的會使用；不把工具啟動、星數、單元測試或人為種好的答案當成產品成功。**
