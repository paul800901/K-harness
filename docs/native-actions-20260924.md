# 原生 Codex 審查與工作區檔案搜尋

## 已接入

- `POST /api/native/review` 接受 `{ "confirmed": true }`。K 只對目前 Codex 對話呼叫官方 `review/start`，target 固定為 `uncommittedChanges`、delivery 固定為 `inline`。不會自動開始，不支援 detached review；拒絕未確認、忙碌、切換中、待送或有待處理核准的狀態。於請求前先保留 busy 狀態並建立新的 UI 回合群組，不虛構使用者訊息。可從 ready 或已結束的正常回合狀態啟動；以 Codex 原生回合事件追蹤。啟動結果逾時時標示不確定，不自動重送。
- `POST /api/native/files/search` 接受 `{ "query": "..." }`。K 使用 `fuzzyFileSearch`，roots 固定為目前工作區，不採納呼叫端 roots；只回傳工作區內相對候選路徑及檔名、類型、分數等搜尋中繼資料。搜尋不讀候選檔內容，也不自動把路徑加入訊息或附件。空字串及超過 256 字元的查詢會被拒絕。
- Claude 對話明確回覆不支援這些 Codex 原生能力；不以 Claude 操作模擬。

## 協定依據與測試

依本機 `.runtime/codex-protocol-schema/v2/ReviewStartParams.json`、`ReviewStartResponse.json` 與 `FuzzyFileSearchResponse.json` 實作。新增單元及整合測試涵蓋確認閘、busy guard、工作區 roots 強制、越界候選排除、Claude 不支援與 HTTP POST 防偽請求契約。

驗證：

```text
node --test test/native-actions.test.mjs test/desktop.test.mjs test/unified-controller.test.mjs
```

尚未以使用者桌面中的 Codex app-server 實際啟動審查或執行搜尋；目前是本機協定讀取與合成測試，live 行為仍未驗證。沒有新增套件、API 計費、對話歷史寫入或正式工作區檔案修改。

## 主代理後續只讀驗證
官方 app-server fuzzyFileSearch 已在隔離假檔實測成功（非正式對話），證據 .runtime/native-readonly-proof/evidence.json。沒有模型回合；review/start 尚未真實執行。UI @ 搜尋選取只填草稿驗收通過。
