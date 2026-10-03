# Gemini／Flash／四帳號與額度頁：Opus 集中回查（2026-10-03）

## 結論與狀態

使用者先問「Opus 看過你程式碼？」；在明確區分「先前帳號批次看過、最新額度排版尚未看」後，要求「都回來看一次」。本輪由 **真正的 Claude Opus 5.5** 重新檢查近期整批程式，Astra 獨立核對接線並用假資料重現。不以 Astra 自查冒充 Opus，也不把原先 R3 的 Codex 原生審查混為這一次。

**本輪只複查、測試與記錄，沒有補修產品程式、部署、重啟 K、push 或打版本標記。** 四個帳號、登入憑證、對話、正式權限與計費未改動；東區仍延後處理。

重點結果：額度頁未找到新問題；確認有中斷復原、同帳號並行派工、完成回報等待額度、錯誤資料污染快取等問題。這不是「全部通過無問題」，也沒有發現足以判定必須立即停用正式功能的已重現問題。Opus 原稿有幾項過度推論，補讀上層接線後已更正，**不能按原稿直接拆掉安全防護**。

## 審查版本、實際能力與邊界

- 維護來源：`C:\Users\Paulus\.codex\worktrees\r2-simplification\K-harness`，分支 `codex/r3-2`。
- 複查基準：`0ae4be1` → `2957aa4c117a25b96d170661643299e4a532c798`；正式程式為 `df9bc7f339c4a82557c3cec50cdd9e3c97e221ee`，後一提交只補部署紀錄。
- 範圍：Gemini 主代理後續接線、圖片／瀏覽器相關改動、GPT 與 Claude 派 Flash、工人完成回來源對話、多帳號保存／新增／取消／切換、Windows 憑證 helper、額度與模型選單，以及本批測試。不是重新逐行審整個歷史 repository。
- Astra 從固定 Git 提交匯出非秘密 source／tests 與 diff；211 個參考檔已備妥，另補 launcher 關閉呼叫端。**提供 211 個檔案不代表 Opus 逐行讀過 211 個檔案。** 原文附錄列出實際閱讀範圍與限制。
- 匯出時比對 108 個來源／介面／shared／scripts 檔與正式 runtime，僅正規化 CRLF 後全部相同；這由 Astra 執行，不是 Opus 自己驗證。
- 執行核心：K 專用官方 Claude Code `2.1.285`，先確認 `claude.ai`／`firstParty` 訂閱，再明確指定 `claude-opus-5-5`；原生回傳模型也為 `claude-opus-5-5`。沒有改走 API 計費或其他模型。
- 審查模式僅 `Read,Glob,Grep`，`restricted`／`safe-mode`／`plan`，MCP 空清單、停用 Chrome 與 slash commands；沒有 shell、寫檔工具或真憑證材料。沒有把工具被拒當作審查完成。
- 原生 session：`b4a6a3ef-1de6-45f3-a8d3-b399ff53328c`。初查及後續補讀的原始事件、結果、要求與 stderr 都留在 `.runtime/opus-full-review-20261003/`；最終文字原樣收錄於下方。
- 三次原生呼叫均正常結束（exit 0、success、is_error=false），模型皆為 Opus 5.5：初查 59 turns／58 次工具呼叫，補讀 13／12，末次接線補讀 18／17。初查兩次整份 diff 讀取超過原生 25,000 tokens 限制，後改分段讀取；失敗原文保留，不藏成全程零錯誤。三次均無 permission denial，工具實際清單只有上述唯讀工具。
- 能做到：讀取具體程式與 diff、追查呼叫關係、指出缺測與條件式風險、在收到反證後更正結論。不能僅憑閱讀證明真實耗盡接手、Windows 殘留程序、官方模型目錄順序或原生核准行為。

## Astra 最終裁定與未處理原因

下表優先於附錄原稿中的初步定性或修法；所有項目本輪都未修改產品程式。

| 項目 | 最終判斷與證據 | 處理方式／未處理原因 |
|---|---|---|
| F1 中斷後的 Flash 紀錄無安全收尾途徑 | 已以真 desktop controller＋真 bridge、假原生 host 與假歷史紀錄重現：停止失敗、狀態變 uncertain、該房間送出被擋、close 失敗。**不是整個 K 不能切聊天室／工作區**；新房間另有 controller。一般關閉可能失敗，重啟後查回舊紀錄也可能再遇到。 | 優先修，但需先確認「程序確已停止」與「結果仍未知」的分離方式。不能以「本程序不擁有它」就推定安全，更不能把 unresolved 改成功或自動重播。涉及中斷／復原語意，先列出供使用者決定。 |
| F2 開著官方 Antigravity／agy 時拒絕開始工作 | 假程序防護已重現；共用同一 Windows 原生登入槽是實際理由，官方程式可能切換登入。Opus 已撤回「直接刪 assertIdle」建議。現有錯誤文字只提帳號操作，沒說明工作為何受阻。 | 保留防護；警告文字可做窄幅修正。同帳號與官方 IDE 並用要另外設計，不當作本輪可直接解鎖。 |
| F3 同帳號同時派工互相拒絕 | 已用假 vault 重現：即使已有工作 lease，兩個新增 acquire 重疊仍可能一個被拒。因此不是只有「第一次」。**既已開始的 refresh 會被等候，不是每次刷新都造成拒絕**，反證也已通過。 | 應只協調必要的帳號檢查，不任意排隊／重播模型工作、不將真正登入切換衝突吞掉。需併同 F1 確认小範圍修法與回歸。 |
| F4 工作已完成仍等額度查詢 | 假模型完成後，release 的額度查詢尚未完成，結果確實還沒回給呼叫端。僅證明等待關係，**沒有實測正式多等幾秒**。 | 可解開完成回報與額度更新的等待，但必須保留後續帳號切換協調與錯誤可見性；本輪不直接改成無條件丟棄錯誤。 |
| F5 語法有效但格式錯誤的帳號 JSON 污染快取 | 假檔 `null` 已重現：list 拒絕後 cachedUsage 仍拋錯。**一般 JSON 語法解析失敗不會先寫入快取**；原稿泛稱「檔案損毀」過廣。沒有動正式帳號檔。 | 最小修法是先用區域變數解析／驗證，再更新快取，不需新增資料備份還原機制。本輪先記錄，未補修。 |
| F6 開始新增前保存原登入 | 撤回 bug 定性。保存原帳號是取消新增時可回復原登入的必要契約；未知卡片未顯示成已驗證。 | 保留。零帳號取消後，下次新增會保存當時官方登入，可補說明，不刪保存或 journal。 |
| F7 登入中的顯示與額外刷新 | 零帳號新增期間 auth 回 **400，不是原稿所稱 500**；完成／取消不因此失效。部分操作會再查其他供應商額度。 | 低影響顯示／效率問題，非授權失效或資料丟失；尚未修正。 |
| N1 未來 Flash 目錄可能有不相容的預設推理程度 | 原始碼可構造條件，但目前取得的官方 Flash 選項為 low／medium／high，未重現原稿假設的 xhigh／max。伺服器會拒絕不合法政策，不會假成功。 | 條件式風險，不列目前已確認缺陷；沒有實際第二案例前，不加新抽象或機制。 |

### 末次接線補讀的裁定

- Claude `recordWorker` 依 parentId 過濾，完成通知先保存送出狀態、只回來源房間；Opus 補讀完整 controller 與相關測試後沒有新 finding，Astra 亦讀回關鍵接線。
- F1 還可能阻止該房間自動送出排隊訊息。「立即送出」只避開佇列的等待條件，**不等於可繞過 controller 的 uncertain 限制**，不把它寫成保證可恢復的步驟。
- 正常關閉未確認時，既有啟動器提供本人確認的強制停止、預設為「否」，只針對它自己啟動的 supervisor 程序樹。保留此界線；本輪只讀程式，沒有實際強制停止測試。
- 重啟不能清除磁碟上的歷史 unresolved。原稿／第一次補充的「重啟脫困」說法已撤回，不能列為可靠修復方式。需要修的是安全收尾的缺口，不是掩蓋未知結果。
- Opus 在末次補讀後回報本批產品 diff hunk 已涵蓋；未逐行讀完無關舊程式、全部 tests 或 docs。本輪不宣稱 repository 全量逐行審查或全供應商安全驗收。

### 權限、安全及精簡提議的界線

- 未找到本批 helper 把秘密直接回傳給模型的路徑；**這不是作業系統秘密隔離證明**。Windows 憑證管理員仍屬同一 Windows 使用者，具足夠本機權限的程式可能讀取；K 原生權限薄接殼不承諾消除此風險。
- Opus 提到 Claude 手動／dontAsk 對應 Flash workspace-write、Flash 可能有原生網路工具、GPT 原生子代理可能繼承 MCP 等事項。這些需要核對原生派工核准與真實工具行為；本輪沒有執行該類真實權限試驗，**不能直接定性為已證明越權，也不能宣稱已排除**。
- helper 操作前 Node 的重複 assertIdle、不用 Win32 API 的操作仍編譯 Add-Type、重複組裝額度等可列精簡候選；helper 內部真正檢查、登入 journal、身分前後比對、未知狀態人工刷新要保留。
- startLogin 的 capture／prepareLogin 不能只看兩次保存便刪：必須先保存原登入資訊，才可清除共用槽並安全取消。原稿建議不等於已核准修法。
- 沒有因「只供本人使用」取消原生核准、G 級防護或把錯誤降成成功。

## 本輪驗證

| 驗證 | 結果與界線 |
|---|---|
| 完整自動測試 | **646／646 通過**，失敗／取消／跳過／todo 皆 0，34,165.5596 ms；本輪重新執行。不是 Opus 執行，也不代表正式真人操作驗收。 |
| Astra 獨立重現 | **6／6 診斷斷言通過**：F1、F2、F3、F3 刷新反證、F4、F5；其中數項「通過」是確認缺陷存在，不是已修好。 |
| 來源對正式程式 | 108 個檔相同，CRLF 正規化比對；正式版本讀回 df9bc7f。 |
| 額度／帳號 UI | Opus 補讀本批 fake API probes 與程式，未找到新問題。既有 UI 實測／部署證據沿用 [額度頁紀錄](usage-layout-20261003.md)，本輪未再次操作正式介面。 |
| 真帳號／真耗盡／真殘留程序 | 本輪未測，不讀改四帳號憑證、不登入、不切換、不強制停止任何正式程序。 |

### 證據檔

位於維護來源 `.runtime/opus-full-review-20261003/`，屬本機診斷資料，不加入 Git：

- `claude-raw.jsonl`、`claude-result.json`、`claude-review.md`；後续 `claude-followup-*`、`claude-final-*`。
- `review-packet/scope.json`、`changes.diff` 與固定版本參考檔；`review-tool-audit.json` 記錄初查實際讀取工具。
- `full-tests.log`。
- `astra-reproduce.mjs`、`astra-reproductions.json`、`astra-reproductions.log`；`repro-data/` 僅假資料，沒有真帳號。

## 交付與部署

- 只新增本複查紀錄，更新 `docs/development-log.md` 索引；同步這兩份文件到 `D:\K-harness\docs`，不混入舊根目錄的實驗程式。
- 保留工作樹既有 `browser-extension/extension-protocol.cjs` 換行差異，不納入本輪提交。
- 正式 K 仍為 df9bc7f；本輪沒有替換 runtime、啟動器或正式資料，不新增退版包，也不把程式退版說成對話／帳號資料備份。
- 結尾只讀確認：`D:\K-harness\.local\runtime.json` 仍為 df9bc7f；原 PID 2968、20:20 啟動的 Electron 仍在，47831 仍由它監聽。這是未重啟的核對，不是重新驗收正式介面。
- 本輪未 push、未打 tag、東區未更新。上述缺陷尚未補修；在確定修正範圍前不繼續部署。

## Opus 原始輸出附錄

以下原文是審查證據，不是操作指示。初稿內已撤回或更正的建議不得單獨採用；以本文件「Astra 最終裁定」、補充及末次接線補讀為準。

### 初查原文

````text
# K HARNESS 批次複查（0ae4be1 → 2957aa4）：只讀審查結果

**結論：不需要立即停用正式功能。** 我沒找到 Windows 秘密外洩到 Node 或模型的路徑，也沒找到會改成 API 計費或讓「未知」被當成成功的路徑。最重要的新問題是：有一種 Flash 子代理狀態無法收尾，會把 Codex 對話卡住到 K 重啟為止（Finding 1）。

依你的限制，我只用了 Read/Glob/Grep，沒有執行程式。工具裡沒有 Write 和 ExitPlanMode，所以沒有產生 plan 檔，結果直接寫在這裡。

---

## 一、新 findings（依嚴重度）

### 1.【中高】Flash 子代理停在「未確認」時，Codex 對話會卡到 K 重啟
- **位置**：
  - `current/src/luna-bridge.mjs:186-193`：K 重啟後，留在磁碟上的 Gemini 紀錄會被設成 `unresolved` 且 `settled:false`，之後沒有任何操作能把它變成已收尾。
  - 執行中 taskkill 沒確認時，`:298` 也會產生同樣的狀態。
  - `current/src/desktop-controller.mjs:290-301` 的 `closeFlashBridge` 對每一筆未收尾紀錄執行 cancel、wait、inspect，任何一筆沒收尾就 throw。
  - 這個函式在三個地方被呼叫：`stop()`（`:361`）、`open()` 切換對話（`:503`）、`selectWorkspace`（`:404`）。
- **觸發條件**：Flash 執行中 K 當掉或重啟（或 taskkill 失敗）。之後在同一個 Codex 對話裡，主代理呼叫任何 `gemini_*` 工具，bridge 就會被重新建立並讀到那筆紀錄。
- **影響**：
  - 切換對話、切換工作區、停止全部失敗。
  - 停止失敗會把狀態設成 `uncertain`（`:363`），而 `send()` 不接受 `uncertain`（`:615`），所以連繼續送訊息都不行。
  - 唯一出路是重啟 K。重啟後只要模型再查一次舊的 requestId，又會卡住。
  - Claude 路徑（`claude-controller.mjs:329-340`、`:468`）本來就有同樣行為，不是這批新增的；這批把它擴大到 Codex。
- **最小修正**：維持 `unresolved`、禁止重播、禁止 handoff。但關閉 bridge 時，跳過「這個 process 並不擁有」的 Gemini 紀錄：bridge 根本殺不到那支程序，關閉 bridge 也不會改變它的狀態。具體做法是 `luna-bridge` 對外標示一個「是否在 `geminiRuns` 裡」的欄位，`closeFlashBridge`/`closeWorkers` 只等自己擁有的那些。
- **測試缺口**：`test/gemini-worker.test.mjs:134` 只在 bridge 層斷言 `close()` 會被拒絕，等於把卡死行為固定成預期。沒有任何 controller 層測試涵蓋「卡住之後怎麼脫困」。

### 2.【中】只要有任何 Antigravity/agy 程序，所有 Gemini 工作都被拒，即使根本不換帳號
- **位置**：
  - `current/src/gemini-accounts.mjs:118`：只要有已加入的帳號且 `running===0`，每一次 acquire（Gemini 主對話送出、每個 Flash）都會先呼叫 `vault.assertIdle()`。
  - `scripts/gemini-credentials.ps1:73`：只要有任何名為 `agy` 或 `Antigravity` 的程序就判定為忙碌。
- **影響**：使用者自己開著 Antigravity IDE 或 agy 時，K 的 Gemini 主對話和所有 Flash 子代理都會失敗，錯誤訊息卻寫「請先關閉官方視窗…再新增、保存、取消或切換帳號」，跟實際情況不符。
  - 只有在切換帳號時才需要確認沒有程序在跑；而 `activate()`（`:51`）和 helper 本身都已經各自檢查過了。
  - 如果這行的用意是偵測 K 當掉後殘留的 agy：同一個帳號上同時跑多支 agy 本來就允許，所以這個檢查對不換帳號的工作沒有作用。
- **最小修正**：刪掉 `:118` 的 `if(!running)await vault.assertIdle();`，只保留切換路徑上的檢查。
- **需要你確認**：這行是否有我沒看到的意圖。
- **測試缺口**：沒有測試涵蓋「不是閒置，但不換帳號就直接 acquire」的情況（`gemini-accounts.test.mjs` 只測了 startLogin 和 refresh 的忙碌情況，`:219`、`:336`）。

### 3.【中，是已知限制的更正】並行碰撞不只發生在「第一次」
- **位置**：`gemini-accounts.mjs:113-114`（acquire）和 `:66`（inspect）遇到 `changing` 會直接 throw，而不是排隊等候。
- **實際範圍**：每一次 acquire 都至少要跑一次 PowerShell 的 `current()`（`:118`），沒有工作在跑時還會加上 assertIdle 與查詢。只要兩個 Flash start 時間重疊、或剛好遇到每 60 秒的自動 refresh，其中一個就會被拒。
  - 被拒的錯誤訊息寫「Gemini 正在切換帳號或登入」，但實際上可能根本沒有在切換。
  - Gemini 主對話的 `open()`/`models()` 也會被拒。
- **最小修正**：把 acquire、inspect、exclusive 改成同一條 promise 排隊鏈，用排隊取代 throw。

### 4.【中低】每次工作結束都要等額度查詢完，才會顯示完成
- **位置**：
  - `gemini-accounts.mjs:145`：`release()` 會 `await api.refresh()`，內含 PowerShell 和 `agy --version` + `agy -p /usage`，後者最多 30 秒逾時。
  - `gemini-controller.mjs:179-180`：Gemini 主對話要等 release 完成才會設 `busy=false`。
  - `luna-bridge` 的 cancel 會 await `handle.completion`。
- **影響**：
  - Gemini 主回合答完後，畫面還會顯示「工作中」好幾秒。
  - 按停止、Flash 完成通知都會被延後。
  - 一次切換帳號大約要啟動 6 次 PowerShell，每次都要做一次 Add-Type 編譯（見「可刪的過度防禦」第 1 點）。
- **最小修正**：在 release 裡改成 `void api.refresh().catch(()=>{})`，不要 await；之後的 acquire 本來就會等 `refreshPending`，不影響正確性。

### 5.【低】帳號紀錄檔損毀時，整個 UI 的狀態推送會壞掉
- **位置**：`gemini-accounts.mjs:16` 先把解析結果指派給 `data`，之後才驗證格式。
- **影響**：如果檔案內容是 `null`，或 `accounts` 不是陣列，`cachedUsage`（`:64`）會在 `desktop-server.mjs:35` 的 `publicState()` 裡 throw，`/api/state` 和 SSE 都會壞掉，而不只是 Gemini 區塊出錯。atomicWrite 讓這種情況很少見。
- **最小修正**：先解析到區域變數、驗證通過後才指派給 `data`。

### 6.【低】帳號卡片的語意不一致
- `startLogin`（`:72`）會把一個沒加入 K 的目前登入，自動變成一張卡片，而且沒有驗證。這包含使用者剛按「取消新增」、留在官方程式裡的那個登入。
- `capture`（`:67`）先把卡片加進去才查詢驗證，跟 `finishLogin`「先驗證、後加入」的做法不一致。
- 兩者都不會把未知顯示成成功（卡片會顯示「尚未確認」），但會出現使用者沒明確保存過的卡片。

### 7.【低】一些顯示面與效率上的小問題
- **登入中沒有帳號時的錯誤**：在沒有任何帳號的狀態下登入中，`/api/gemini/auth` 經過 `inspect` 會因為 `loginPending` 回 500（`desktop-server.mjs:108`、`gemini-accounts.mjs:66`），UI 會顯示「無法確認 Antigravity 狀態」。完成和取消兩個按鈕不受影響。
- **帳號操作會強制刷新所有供應商**：`usage.jsx:14` 在每次帳號操作後強制刷新全部供應商，可能額外開一個暫時的 Claude/Codex host；而且 activate 剛做完的 `/usage` 查詢又會再查一次。

---

## 二、既有行為（不是這批新增，但跟你的第 2 點有關）

- **Claude 的 Flash 權限可能超過主代理**：`claude-controller.mjs:351` 把 `claude-manual` 和 `claude-dontAsk` 對應成 Flash 的 `workspace-write`。Flash 可以不經核准寫入工作區，但主代理在這兩種模式下每次編輯都要核准或直接拒絕。這是既有的對應方式（Codex Luna 也一樣），但嚴格說，以「核准」的角度看，Flash 權限高於主代理。
- **待驗證：Flash 的網路權限**：`gemini-worker.mjs:24-35` 沒有拒絕 agy 可能內建的網路或搜尋工具；Codex `workspace-write` 主代理是 `networkAccess:false`。agy 實際有哪些工具我沒辦法從程式確認。
- **待驗證：GPT 子代理會不會繼承 `k_gemini`**：`desktop-controller.mjs:568` 把 `k_gemini` 掛在主 thread 上。如果 Codex 原生 GPT 子代理會繼承 `mcp_servers`，它就能自己派 Flash，而結果會被當成主代理的派工送回主代理。
- **憑證副本可被同使用者程序讀取**：受管理的憑證以 Persist=2 存在 Windows Credential Manager，同一個使用者的任何程序都讀得到，包括有 shell 權限的代理。K 沒有把秘密輸出出去，但現在一共有 4 個帳號的 token 存在那裡，可能外洩的範圍跟著放大。

## 三、已知問題（跟新 findings 分開；主代理提供的證據，不是我的實測）

- **第一次並行 acquire 被拒**：實際範圍更大，見 Finding 3。
- **沒有實測額度耗盡接手、token 長時間過期**：
  - helper 是從 id_token 取得 email（`ps1:59-68`）。如果 agy 刷新 token 後不再保留 id_token，`current()` 會失敗，Gemini 會整個被擋住。這是待驗證的風險，沒有重現。
  - 自動換到其他帳號只看 `remainingPercent===0`；如果還有其他工作在跑，release 時的額度刷新會被跳過，也不會自動換帳號（`:122`、`:128`）。
- **切回 A 時兩次官方查詢未確認**：讀程式確認，這種情況只會記成 `unknown`，不會被當成成功（`query()` `:45-46`；acquire 在 `:133-137` 會重新查詢）。
- **舊的 compact probe 找不到「登入 Gemini 訂閱」按鈕而失敗**：`model-picker-compact-ui-probe.mjs:212` 仍在找已移除的按鈕。

## 四、已確認沒有問題的項目

- **秘密不外流**：PowerShell helper 只輸出 email/accountId；錯誤時只回一個 errorCode，stderr 是固定字串；Node 端還會用雜湊比對 email 與 accountId（`vault.mjs:16`）。
- **不改計費**：Codex 和 Luna 都要求帳號是 `chatgpt`；Gemini 只用 agy 原生登入；子程序環境變數用白名單，排除了所有供應商的 key。
- **送出狀態未知時不重播**：Gemini 主對話有 `nativeStarted` 和 `nativeSessionId` 防護；Flash 會用 requestId 去重、handoff 要求舊工作已收尾；完成通知不會重送。
- **帳號綁定**：Gemini 主對話會綁定帳號；有其他工作在跑時不能換帳號（`:128`）；沒有綁定的舊對話會被拒（`:119`）。
- **額度彈窗**：
  - 順序是 Claude → GPT → Gemini（`usage.jsx:41-78`）。
  - 0% 顯示「0%」，未知顯示「—」；有「目前使用」標示；舊資料有提示；每個帳號可以展開看明細。
  - CSS 只作用在 usage 元件內，設定頁和登入流程沒有被呈現修改影響。
  - 側邊欄精簡列的順序是 Codex → Claude → Gemini，跟彈窗不同；我把它當成觀察，不算 finding。

## 五、可刪的過度防禦
1. **重複的 PowerShell 檢查**：Node 端 `vault.capture/activate/prepareLogin` 會先額外 `invoke('assertIdle')`（`vault.mjs:57-59`），但 helper 內部已經做了。`accounts.activate`（`:51`）和 `startLogin`（`:69`）又各自再呼叫一次。另外，assertIdle 這個操作本身不需要 Add-Type，卻也會執行（`ps1:80`）。
2. **startLogin 重複保存**：startLogin 先 `vault.capture()` 再 `prepareLogin()`，兩次都在保存同一份憑證。可以讓 prepareLogin 直接回傳身分，省掉 capture。
3. **永遠不會命中的程序名**：程序名清單裡的 `'Antigravity.exe'` 不會被比對到，因為 ProcessName 不含副檔名。
4. **三條重疊的 Gemini 額度路徑**：`/api/usage` 又呼叫一次 `geminiAccounts.usage(false)`（`desktop-server.mjs:126`），`publicState` 也會覆寫成 `cachedUsage`，`usage()` 又重新組了一次 `cachedUsage`。
5. **舊路由沒有 UI 呼叫**：`POST /api/gemini/login`（`desktop-server.mjs:157-160`）現在只剩舊測試和舊 probe 在用。

身分前後比對、登入 journal、「uncertain 必須手動刷新」這三項，我判斷是必要的防護，不建議刪。

---

## 六、實際閱讀範圍
- **全文讀過**：
  - `src/` 下的 `gemini-accounts.mjs`、`gemini-credential-vault.mjs`、`gemini-login.mjs`、`gemini-controller.mjs`、`gemini-worker.mjs`、`luna-bridge.mjs`、`luna-gateway.mjs`、`worker-policy.mjs`
  - `scripts/gemini-credentials.ps1`
  - `frontend/usage.jsx`、`frontend/account-connections.jsx`
  - `scope.json`
- **部分讀過**：
  - `desktop-controller.mjs` 第 200-665 行；`claude-controller.mjs` 第 300-580 行；`desktop-server.mjs` 第 60-180 行；`isolated-desktop.mjs` 第 30-79 行
  - `changes.diff` 的 138-470、746-825、1283-1575 行（包含 model-picker、usage.css、main-sessions、worker-policy 的 diff）
  - 測試：`codex-flash.test.mjs` 第 1-180 行、`gemini-worker.test.mjs` 第 120-160 行，以及在 `gemini-accounts.test.mjs`、`claude-controller.test.mjs` 裡的 grep
- **沒讀**：
  - `model-picker.jsx` 全文；`unified-controller.mjs` 和 `conversation-controller.mjs`（只 grep 了 usage）；`main-sessions.mjs` 全文
  - `desktop-controller.mjs` 第 1-200 行和 665 行以後；`claude-controller.mjs` 第 1-300 行和 580 行以後
  - 其餘大部分測試和全部 UI probe；`docs/`、`AGENTS.md`、`README.md`
  - 與本批無關的其他原始檔
- **沒能做的事**：沒執行任何程式或測試，646 個測試和 probe 的結果我都沒有驗證；也沒有比對 diff 與正式 runtime。

## 七、未驗證事項
- agy 實際有哪些工具（網路／搜尋）、會不會有常駐的 language server 改寫目前登入的憑證、token 刷新後是否保留 id_token。
- Codex 原生子代理會不會繼承 `mcp_servers`。
- Antigravity IDE 實際的程序名。
- Add-Type 每次的實際耗時。
- 真實額度耗盡時的接手流程，以及 K 當掉後殘留的 agy 程序在 Windows 上的行為。
````

### 補充審查原文

````text
# 補充審查（原報告保留不改）

這次一樣只用 Read/Glob/Grep 讀 review-packet，沒有執行程式、沒有部署，也沒有用真憑證。依你的六點逐一處理，結果如下。

| 原項目 | 處理 | 嚴重度 |
|---|---|---|
| F1 Flash 未收尾卡住 | 更正範圍 | 中高 → 中 |
| F2 有 agy 程序就拒絕所有工作 | 撤回「必刪」建議，改為文案與設計待決 | 中 → 低 |
| F3 並行碰撞 | 更正：撤回「碰到 refresh 就被拒」 | 中 → 低至中 |
| F4 工作結束要等額度查詢 | 維持 | 中低 |
| F5 帳號紀錄檔損毀 | 部分更正 | 低 |
| F6 帳號卡片語意 | 撤回 bug 定性，改為「應說明」 | — |
| F7 `/api/gemini/auth` 錯誤 | 更正 HTTP 狀態碼 | 低 |
| N1 Flash 預設推理程度 | 新增 | 低 |

---

## F1：更正範圍（中高 → 中）

### 實際接線
- **切換聊天室不會卡住整個 K。** `conversation-controller.mjs:86-104` 對新的對話會建立新的 controller，不會在舊 controller 上重開。舊房間留在原處，因為 `safelyIdle()`（`:43`、`:53`）把 `unresolved` 視為不閒置，所以它不會被自動釋放（`:65`）。
- **`selectWorkspace` 也會建立新的 controller**（`:113`），不會卡。
- **真正卡住的是那一個房間自己的原生控制器**，觸發點有三個：
  - 在該房間按停止：`desktop-controller.mjs:361` 會失敗並把狀態設成 `uncertain`。之後 `send()` 被擋（`:615`）。
  - 重開該房間以恢復、或變更權限／設定：`conversation-controller.mjs:95-96` → `existing.open` → `desktop-controller.mjs:503` 的 `closeFlashBridge` 會 throw。
  - 送出時切換權限：`:626` 會走 `this.open`，結果同上。
- **沒按停止也沒改設定的話，這個房間仍然可以正常送訊息。**
- **K 正常關閉會失敗。** 路徑是 `desktop-controller.mjs:685` 的 `close()` → `closeFlashGateway` throw → `conversation-controller.mjs:165-167` 回 AggregateError → `desktop-server.mjs:47-54` 回 503「K 尚未完全關閉」。launcher 收到 503 之後怎麼處理我沒讀，所以不往外推論。
- **觸發條件仍是兩步**：先有 K 當掉或重啟、或 taskkill 沒確認；之後模型在該房間呼叫 `gemini_*` 工具，bridge 才會被建立。bridge 是延遲建立的，`workers()` 不會主動建立它。

### 安全界線（不拆 guard）
我先前寫「只要不在 `geminiRuns` 裡就跳過關閉」，這個建議有誤判風險，在此撤回。「這支 process 不擁有該程序」不等於「該程序已經停止」：K 當掉後殘留的 agy 在 Windows 上可能還在跑、還在寫檔。

建議的界線是：

1. **繼續擋著的條件改成「程序可能仍在執行」，而不是「結果未知」。** 只有同時滿足以下兩點，才允許關閉這個 bridge：
   - 當下做一次 Windows 程序檢查，確認沒有任何 agy 程序。用跟 `Assert-Idle` 一樣保守的範圍：任何 agy 或 Antigravity 程序都算。
   - 本人明確確認「已查看工作區」。
2. **關閉之後，紀錄本身維持不變：**
   - 狀態仍是 `unresolved`，`acceptance` 仍是 `not-reviewed`。
   - handoff 仍然禁止（`luna-bridge.mjs:281` 要求 `settled===true`），也不重播。
   - 可以另外加一個持久的「已人工確認沒有殘留程序」標記，只用來解除關閉的阻擋。
3. **只要偵測到 agy 或 IDE 程序，就繼續擋**，並在提示裡寫明要先關閉哪些程式。
4. **權衡**：沒有殘留程序，只能證明副作用已經沒有在發生，不能證明副作用沒有發生過或發生了什麼，所以紀錄仍必須保持 `unresolved`。

測試缺口仍在：`gemini-worker.test.mjs:134` 和 `codex-flash.test.mjs:170-174` 只斷言「會被擋」，沒有任何脫困路徑的測試。

## F2：撤回「刪掉 `:118`」，改為「文案與設計待決」（中 → 低）

我承認：共用的 Windows 登入槽是真實風險。K 無法阻止官方 IDE 或 agy 在工作期間切換登入，所以單純移除 assertIdle 並不能證明這個風險已經解除。

`:118` 實際有兩個作用：
- 在工作開始時確認沒有官方程式正在改登入。
- 在 K 重啟後偵測殘留的 agy。

它有一個限制：`running>0` 時會跳過檢查，所以只保護第一個工作的起點；工作開始後才打開的 IDE 也擋不到。

我把它拆成兩件事：
- **錯誤文案（應修）**：現在的文案寫「再新增、保存、取消或切換帳號」，跟「拒絕啟動工作」的實際原因不符。建議改成「偵測到官方 Antigravity/agy 正在執行；它與 K 共用同一個 Windows 登入槽，為避免工作期間被換登入，K 暫不啟動 Gemini 工作」。
- **同一帳號與 IDE 並用（產品需求）**：這要另外設計，例如在工作前後各比對一次身分，類似 `query()` 已經在做的那樣，不能直接刪掉這個 guard。

原報告「可刪的過度防禦」第 1 點也要收窄：只有 Node 端在 helper 操作前多呼叫的 assertIdle（`vault.mjs:57-59`、`accounts:51`）是重複的，因為 helper 自己的 capture、activate、prepareLogin 都會再檢查一次。`:118` 不在可刪範圍內。

## F3：更正（撤回「碰到每 60 秒 refresh 就被拒」）

讀完整個 `gemini-accounts.test.mjs` 之後：

- **acquire 和 inspect 不會因為 refresh 被拒。** 測試 `:65-80` 確認兩者都會等 refresh 完成。
  - 微任務順序如果是 acquire 先拿到鎖，被拒的是 refresh，而且 `usage()` 會把錯誤吞掉；acquire 本身照常進行。
- **refresh 本身失敗時，正在等候的 acquire 會一起失敗。** 這是 `:82-94` 刻意測試的行為，不是碰撞。
- **帳號切換進行中 acquire 被拒**，也是刻意設計（`:96-102`）。
- **真正的碰撞仍然是兩個 acquire 互斥**（也包括 acquire 對上 inspect）。這屬於已知限制。我的補充只有：
  - 不只第一次會發生。
  - 第一個工作開始後，碰撞窗口縮小到一次 `current()` 的 PowerShell 執行時間，所以後續碰撞的機率比第一次低。

**新的小發現（低）**：`inspect` 遇到 `changing` 會直接 throw（`:66`），而且沒有測試涵蓋。Flash 正在 acquire 時剛好打開模型選單，`unified-controller.mjs:73` 會得到暫時的「gemini 目錄暫時不可用」警告，不影響正確性。

`codex-flash.test.mjs` 全文讀過，沒有發現跟 acquire 並行有關的測試。

## F4：維持（中低）

`release` 會 await refresh（`:145`），帳號測試沒有涵蓋這段延遲。實際延遲幾秒沒有實測。

## F5：部分更正（低）

- JSON 語法錯誤的情況已有測試（`:324-331`）：`JSON.parse` 失敗時不會指派 `data`，原判斷不適用。
- 我仍保留的只有一種情況：JSON 語法正確、但形狀錯誤，例如內容是 `null`，或 `accounts` 不是陣列。這種情況下 `data` 已先被指派，之後 `publicState` 會 throw。

## F6：撤回 bug 定性，改為「必要保留／應說明」

- **startLogin 先保存原登入是刻意的契約**：讓本人新增 B 後取消時能回到 A。測試 `:153-164`、`:176-192`、`:207-214` 都斷言了這點，必須保留。
- **零帳號取消後保留官方登入**：已有測試（`:223-228`）和 UI probe（`gemini-accounts-ui-probe.mjs:169-173`）。
- **未知從未被當成成功**：`finishLogin` 會先驗證（`:194-205`）；`capture` 只在官方登入已驗證時才提供，未驗證的卡片顯示「尚未確認」。
- **應說明的只剩一點**：零帳號時取消的那個官方登入，下次新增時會被當成「原帳號」自動變成卡片。這是保存原登入的必要副作用，建議在 UI 補一句說明，而不是改程式。

## F7：更正

`desktop-server.mjs:190` 是 `e.statusCode??400`，所以回的是 **400，不是 500**。fake probe 也模擬成 400（`gemini-accounts-ui-probe.mjs:40`）。影響仍只是顯示面。

## N1（新增，低）：Flash 子代理的預設推理程度可能不合法
- **位置**：`model-picker.jsx:148` 選 Flash 時，推理程度取 `model.defaultReasoningEffort??'high'`。這個值來自 `gemini-controller.mjs:26`：agy 列表中第一個出現的推理程度後綴，可能是 xhigh 或 max。
- **影響**：
  - UI 會顯示「（目錄未提供）」，但「建立對話」按鈕不會被停用（`invalidWorker` 只檢查 gateway）。
  - 送出後伺服器端 `validateWorkerPolicy` 會拒絕，所以不會假成功，只是使用體驗差。
- **待驗證**：agy 實際列出模型的順序。

## 補看後無新 finding 的部分
- **`main-sessions`**：本批只新增 `workerNotifications`，Gemini 帳號綁定不存在這裡。帳號綁定存在 gemini-sessions 紀錄裡（`gemini-controller.mjs:49`、`:111`、`:139`），`metadata` 會保留它。
- **`owner-browser-registry`**：Gemini 瀏覽器權限只開 `workspace-write` 和 `danger-full-access`，不含唯讀，跟 `gemini-controller.mjs:66` 一致。
- **`unified-controller`**：`geminiGateway` 來自 Codex 目錄。跨供應商的 `open` 在房間架構下不會走到同一個實例，不擴大影響。
- **模型選單的 Flash 政策**：
  - Claude 一律提供 Flash；Codex 只在 gateway 存在、且目錄裡有 Flash 時才提供。
  - Gemini 主代理顯示「未接入子代理」。
- **兩個 UI probe**：
  - `usage-layout-ui-probe` 斷言了：Claude → GPT → Gemini 的順序、四列精簡帳號列、只有一個「目前使用」、0% 與「—」的區別、已登出／尚未確認的顯示、舊資料提示、刷新只送 `?refresh=1`、離線時停用刷新、390px 寬度不出現橫向捲動、沒有任何非 GET 請求。
  - `gemini-accounts-ui-probe` 斷言了：登入、取消、完成失敗後仍可取消、忙碌與 uncertain 時的停用狀態、只刷新目前帳號、額度不加總、不呼叫舊的 `/api/gemini/login`。
  - 兩者都是 fake API，**不涵蓋後端的 acquire、assertIdle 或 Flash 卡住問題**。

## 精確補看範圍（全文）
- `src/conversation-controller.mjs`、`src/unified-controller.mjs`、`frontend/model-picker.jsx`
- `test/gemini-accounts.test.mjs`、`test/codex-flash.test.mjs`
- `test/usage-layout-ui-probe.mjs`、`test/gemini-accounts-ui-probe.mjs`

另外補讀：
- `desktop-controller.mjs:664-687`（`close()`）
- `desktop-server.mjs:40-61`、`:190`
- 先前已讀的 `main-sessions`、`owner-browser-registry`、`worker-policy` 的 diff

## 仍未讀或未驗證
- 沒讀：launcher／Electron 收到關閉 503 時怎麼處理；`claude-controller` 的 `recordWorker` 與跨對話過濾；`input-queue`；docs。
- 沒驗證：agy 的模型列表順序、殘留程序的實際行為、IDE 的程序名、release 延遲的實際秒數。
- 所有結論都來自讀程式，沒有任何一項是實測。

**是否需要立即停用**：維持原判斷，不需要。F1 修正前，建議先在 runbook 註明：遇到這種狀態時，先確認沒有 agy 程序，再重啟 K。
````

### 最後接線補讀原文

````text
# 最後補充：Claude 接線、關閉 503 與重啟能否脫困

這次一樣只用 Read/Glob/Grep 讀 review-packet，沒有改檔或執行。Claude 這一側沒有新 finding。F1 維持「中」，但「重啟就能恢復」要撤回：重啟只能暫時避開，不能讓問題消失。N1 維持條件式。

## 一、Claude 結果會回到原本的房間
- `recordWorker`（`claude-controller.mjs:150-168`）會先比對 `parentId`，不是這個房間的就不收。
- 「是否已派工」和「是否已通知」這兩份記錄都屬於各自的 controller，而每個房間有自己的 controller（見前一次補充的 conversation-controller）。
- 完成通知只在 `state.status==='completed'` 時才送，送出前會先存成 `delivery-attempted`；送出狀態不確定就設為 `uncertain`，不重送（`:118-148`）。
- 有測試涵蓋：
  - 別的房間的結果不會被收進來（`claude-controller.test.mjs:49-60`）。
  - Codex 和 Gemini 的完成通知只喚醒原本的 Claude 一次（`:443-457`）。
  - 停止後晚到的完成通知不會喚醒主代理（`:458-466`）。
  - 通知送出狀態不明時不會重送（`:467-476`）。
  - 未收尾的觀察結果不會吃掉真正的完成通知（`:555-563`）。
  - 切換工作區後晚到的事件會被忽略（`:574-583`）。
  - 呼叫 `gemini_accounts` 不會啟動任何工作（`:867-874`）。
- 結論：沒有新 finding。

## 二、F1 補充（維持「中」；「重啟就能恢復」撤回）

**1. Claude 一樣會卡，這部分是本批之前就有的。** `closeWorkers`（`:329-340`）遇到 bridge 仍有未收尾紀錄就 throw，而以下三處都會先呼叫它：
- 開啟對話（`:468`）
- 停止（`:390`）
- 關閉（`:611`）

所以 Claude 房間一旦卡住，連重開恢復都做不到。

**2. 連唯讀查詢也會重新觸發。** Codex 的 `lazyFlashBridge.accounts`（`desktop-controller.mjs:276`）和 Claude 的 `lazyBridge.accounts`（`:367`）都會建立 bridge。一旦 bridge 存在，關閉時就會列出磁碟上的所有歷史紀錄（`luna-bridge.mjs:368`）。所以除了 start/inspect，模型只要呼叫唯讀的 `gemini_accounts`，問題就會再出現。

**3. 該房間的自動佇列會一直停住。**
- `input-queue.mjs:11-12` 把 `unresolved` 也算成「工作進行中」，所以排隊中的訊息會一直顯示「等待 Luna 完成」。
- 手動「立即送出」不經過這個檢查（`:36` → `deliver(row,true)`），可以繞過。
- 補充一點：只有在該房間的 bridge 已建立、`state.workers` 裡有這筆紀錄時，才會出現這個停住的狀況。

**4. 重啟不保證能脫困。** 這筆歷史紀錄會一直留在 `.runtime/luna-bridge/<parentId>/`，狀態永遠是 `unresolved`，而且沒有任何操作能把它收尾。
- 重啟後 bridge 是延遲建立的，所以一開始看起來正常。
- 只要模型在該房間再呼叫任何 `gemini_*`（Claude 則是 `luna_*`）工具，前面說的停止／重開／關閉失敗就會再出現。
- 原本建議在 runbook 寫「確認沒有 agy 程序後再重啟」，這只是暫時避開，不能寫成恢復步驟。

**5. 關閉失敗之後實際會怎樣（已讀過程式，不是推測）：**
- 關閉的呼叫鏈：`desktop-server` 回 503 → `isolated-launcher.mjs:88` 送出 `closed:false` → `electron-isolated-main.cjs:72` 回覆失敗，並保持執行。
- 系統匣啟動器（`KTrayLauncher.cs:241-300`）收到失敗後，會跳出強制結束的確認視窗：
  - 預設選「否」（`:285`）。
  - 只會 `taskkill /T /F` 啟動器自己啟動的 supervisor 程序樹，不會依名稱或連接埠找程序（`:283`、`:291`）。
  - 如果不能確認已結束，就不啟動新服務（`:232-234`）。
- 這套由本人確認的強制結束應該保留。

**6. 修正 F1 的安全界線（補充前一次建議）：**
- 強制結束會殺掉當時還在程序樹下的 agy，但 K 無法把「已被殺」寫回那筆紀錄，所以它仍是 `unresolved`。
- 更早之前 K 當掉、已經脫離程序樹的殘留 agy，不會被這次 taskkill 殺到。
- 因此仍需要一個由本人執行、以「確認沒有殘留程序」為前提的步驟，用來解除這筆紀錄造成的阻擋；紀錄本身仍維持 `unresolved`、不能 handoff、不能重播。不建議自動跳過檢查。

**7. 相關但不是本批新增的舊程式：** `electron-isolated-main.cjs:20-24` 在 supervisor 斷線或收到 SIGTERM 時，即使關閉失敗仍會 `quit()`。這正是會產生「脫離程序樹的殘留 agy」以及歷史 `unresolved` 紀錄的路徑之一。我只標出它和 F1 有關，不列為新 finding。

## 三、N1：維持條件式
在目前官方 Flash 目錄只有 low/medium/high 的情況下，`defaultReasoningEffort` 只會是這三者之一，或因為是空值而改用 `'high'`。所以目前不是 bug。只有當 agy 未來先列出 xhigh 或 max 時，才會出現 UI 可以送出、但伺服器拒絕的情況，而且不會被當成成功。

## 四、changes.diff 的閱讀覆蓋
- 這次補讀了 `desktop-controller.mjs` 的 diff hunk：import 和建構參數（`:476-499`）、`persistFlashNotifications`，以及 `turn/completed` 之後接上 `deliverFlashResults`（`:503-511`）。沒有新問題。
- 本批改到的產品程式，加上三次審查讀過的段落，已涵蓋所有 diff hunk。
- 只剩 `desktop-controller.mjs` 第 1-200 行中跟 diff 無關的舊碼沒讀。
- 測試部分只讀了這三次指定的檔案。

## 五、這次讀過的範圍
- **全文**：
  - `src/claude-controller.mjs`（第 1-300、579-614 行，加上前兩次讀過的 300-580）
  - `src/input-queue.mjs`、`src/electron-isolated-main.cjs`、`src/electron-isolated-launcher.mjs`
  - `local-launcher/KTrayLauncher.cs`
- **部分**：
  - `electron-workbench.mjs` 第 70-119 行
  - `isolated-launcher.mjs` 中關於關閉結果輸出的部分（grep，第 87-89 行）
  - `claude-controller.test.mjs` 第 45-60、440-620、860-875 行
  - `changes.diff` 第 472-516 行

## 六、剩餘未驗證
- 都沒有實測，包括：
  - 系統匣的強制結束實際能殺到哪些 agy；
  - Electron 在斷線時退出，是否真的會留下殘留 agy；
  - 歷史 `unresolved` 紀錄被模型重新查詢的頻率。
- 沒讀：`isolated-launcher.mjs` 全文、`desktop-controller.mjs` 第 1-200 行中跟 diff 無關的部分、其餘測試與 docs。
- **是否需要立即停用**：維持不需要。
````
