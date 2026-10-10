# Gemini 分支附件第二意見與實證反例（2026-10-10）

## 授權與目前狀態

使用者明確要求 Opus 沒額度時改問真正 Gemini 查盲點，並確認 Gemini 3.8 Flash 也可用。本轮是明確委派，不是暗換模型／換帳號／改 API 計費。

**候選仍未完整修復、未部署。** 正式仍 be1d976；原候選產品碼 83051b4 有下面新重現的歸屬缺口。新增存檔時序回歸後1174項通過，不覆蓋或抵銷獨立 red probe。原生 Claude 完整不變性及最後真正 Opus 複查未完成。

證據根目錄：`D:\K-harness\.runtime\fork-complete-fix-20261010`。

## 真正 Gemini 的三輪查核

沿 K 選定的官方 Antigravity 執行檔、訂閱及原生模型清單，本任務獨立 profile、read-only settings、plan、空 MCP。官方 `/usage` 確認登入；沒有讀／複製憑證、切帳號、安裝或 API fallback，未改正式 profile。selected 路徑名1.3.1，但實際 `--version` 是 **1.3.2**，本輪未發出更新命令，不能以目錄名宣稱版本。

- `gemini-independent`：init 實際 gemini-3.1-pro-high，code0 / SUCCESS。讀差異、helper、真 Claude 腳本及只讀證據；報告自述閱讀範圍大於實際工具記錄，不當完整源碼審核。
- `gemini-flash-followup`：init 實際 gemini-3.8-flash-high，code0 / SUCCESS，讀相關 Codex/Claude controller、helper、tests、docs及 Opus scope。指出 Pro 的路徑修法與既有合法祖先附件衝突。
- `gemini-flash-marker`：同真正 Flash High，code0 / SUCCESS。讀新增反例及 lineage、持久化證據，修正自己上一輪「界線防護完整」的判斷。

每輪保留 start/preflight/raw/result/review。只讀工具，沒有指令／改檔／外部操作／派工。前兩輪各有一個錯誤檔名讀取失敗，不當已讀證據或產品缺陷；Flash 後來讀到正確文件。

## 意見取捨不能以模型語氣代替證據

1. Pro 把切換工作資料夾誤當實體搬檔／改名。movedWorkspace 保留 references、不複製文件；刪／改名原實體目錄後，previousWorkspaces 也無法憑空找回，本批不新增搬移功能。
2. Pro 建議只搜当前＋previousWorkspaces，會拒绝祖房先 old→current、子房 current→destination 的正常附件；沒有採納。
3. Pro 建議 sleep100ms 不能確定落盤。Flash 首次建議公開 flushPersist API 也不必要；現有 close 已能排乾，不為測試增加產品 API。
4. Flash 最後建議限制直接父房 owner，同樣會拒绝真正祖父附件，未採納。原生 forkedFromId 已有實際證據，但 native/K alias 與舊父 K 紀錄消失的相容性不能猜。新增明文 marker 欄位也不是不可偽造證據。
5. 報告中的確定語氣及行號仍須核對。Flash 稱原生祖先封存就無法 read，本輪未驗證；不升格為事實。Claude 卡片來自 K 結構化投影，不能假定它必須跟 Codex 用同一 ancestry 查法。

## 已確定補正的存檔快照盲點

`gemini-supplemental-verified/probe.mjs` 使用全新假工作區／假 host，模型回合0。故意 hold result 觸發的原子 rename：busy已false，磁碟仍inFlight；close 在解除 hold 前不能完成。解除後快照確實落盤，before 原文保存，兩次 fake fork 後父投影 bytes/hash 一致。

新增 `test/claude-controller.test.mjs` 的 `Claude close drains result persistence before a durable immutable parent fork snapshot`：確定性驗證 close等待、父before實存、子／孫活動不改父投影與附件來源／metadata。單項通過；全套 **1174/1174 零失敗**，`gemini-supplemental-verified/full-tests.log`。產品碼未因此修改、不加sleep或公開flush API。

`native-claude-drained-ready/run.mjs` 已準備且 syntax check通過：close排乾後保存parent-before、保存全部附件metadata與hash，再做新假房native鏈。**尚未執行**，不能當原生验收；舊3回合未重播，遺失before不補造。首版合成probe缺背景終端列表fixture，close失敗，保留證據，另用新假目錄補正；不列為產品根因。

## 新重現的候選缺口：界線內假標記被升格為合法卡片

合成父房user text手寫正確instruction、JSON marker、id和originalPath，指向 unrelated 房的合法假附件記錄／檔案；該已完成turn位於保存的分支界線內。

實際候選控制器（`gemini-supplemental-verified/result.json`）：

- parent strict sessionAttachment拒绝，沒有卡片。
- child fork 的 inheritedAttachment反讀磁碟owner，再用owner自我驗證，接受並preview `UNRELATED_FAKE_ATTACHMENT`。
- `parentRejected=true`、`childAccepted=true`、`confirmedProjectionOwnershipGap=true`。

這證明 copied-turn界線不等於 marker已經由K確認屬合法來源。磁碟自我owner檢查只證明記錄／檔案一致，沒有證明owner是來源房。不能以同OS使用者本可讀檔、send/steer仍拒绝，而忽略投影／預覽的歸屬不一致。

這是合成反例，不證明已有真資料外洩；正式未部署此候選。反例是獨立red probe，尚未完成修復或passing回歸，因此1174項通過仍不放行。

真Codex0.161.0只讀前次已完成的3假房 thread/read，`native-fake-lineage.json`證實 forkedFromId為parent null、child→parent、grandchild→child；沒有resume/start/interrupt或讀小說。尚未證明legacy alias／祖先紀錄消失情況的完整修法。

## 未完成與交接

1. 針對重現的歸屬缺口決定最小完整來源證據方案，保留正常祖先附件、K/native alias、父K紀錄已不在等既有要求；不只限直接父，不把未知廣泛放行。反例與會破壞合法使用的建議一併交Opus。
2. 修正後將反例加入回歸，重做相稱 genuine Codex chain／實房只讀投影，驗證正常使用與外房拒绝。
3. 新假房 genuine Claude完整不變性，以及最後真正Opus差異／證據複查。
4. 阻擋解除後才核對閒置、固定版本、保留程式退版、部署／正式讀回；不恢復／重播小說，不push／更新東區。

本輪沒有正式停止／重啟／部署或完全修復宣稱。Gemini為實際第二意見，不冒充Opus已審。模型意見可發現盲點，也必須用反例與原始證據校正。
