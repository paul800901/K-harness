# ExternalSandbox 外部驗證收尾（2026-09-26）

## 結論

- 僅在既有候選 `sandboxie-candidate-3b6c43ee` 的新假資料工作區完成 Codex 一回合讀／寫／讀回；產物實際位於候選 host workspace，非 Sandboxie FileRoot。
- 由同一候選 Sandboxie pool 跑的 fake boundary probe：vault/private-state sentinel 讀取與 append 寫入均遭 `EPERM`；候選 app 於 `127.0.0.1:47971` listening 時，隔離程序連線到 47971 得到 `EACCES`。47831 亦得到 `EACCES`，但測試當時該 port 沒有 listener，故不單獨視為服務可達性的拒絕證據。
- Claude 一回合送出後，官方 Claude Code 提出單次 PowerShell 核准，命令精確為 `node verify.mjs`，工作目錄為本次 fake workspace。因 one-shot runner 的核准白名單漏列 PowerShell，本次未送出 K 核准；沒有換路徑、重送回合或使用替代核准通道。標準 `app.close` 清理該待核准請求。
- Codex 的 `workspace-write` 回合用官方 `commandExecution` 完成精確 `node verify.mjs`。Codex 原生沒有提出 `requestApproval`；沒有為強制核准而嘗試 workspace 外操作。故這次實際證明 Codex workspace-local 寫入成功，**不**證明 Codex 原生必定對該工作區內命令提示核准。
- Claude 原生 Agent 子工具曾回報 `running`，未觀察到 completed metadata；正常關閉前未確認完成，因此不宣稱子代理驗證通過。

## 假資料範圍與讀回

唯一新建的模型工作目錄：

`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\workspace\external-live-20260926`

- `input.txt`：`K_FAKE_INPUT_V1`，值 `ALPHA-731`，SHA-256 `D0F2437542396F65F4EF782AFCE13AA8753E2E1DE1DD968964A13ED8EA155D40`。
- `verify.mjs`：固定假資料程式，只讀 input、以 `flag: wx` 新建 `result.json`、再讀回比較。回合後長度 922 bytes，SHA-256 `FCA996D06110D5B6DB302AE0F5CB74C4691057F294BD860A468F0D9091F28A20`。
- `result.json`：host 路徑直接讀回，長度 98 bytes，SHA-256 `70F42835FBDAE5B1F8A3FEC70A63C428AE00FA6A46461AEF7AA7EEB8E4593B28`，內容：

```json
{
  "schema": "K_FAKE_RESULT_V1",
  "source": "ALPHA-731",
  "operation": "read-write-readback"
}
```

Codex 的 completed command output 明確列出 `inputPath`、`outputPath` 和相同 readback；之後 host 直接讀取兩檔，輸入未變、結果存在於上列 host workspace。全程未使用 browser、connector、真實帳號資料或憑證檔；未修改 Sandboxie policy、ACL 或正式部署。

## Sandboxie 外層邊界讀回

候選內唯一新建的 sentinel：

`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\private-state\external-live-sentinel-20260926.txt`

固定假內容為 `K_FAKE_PRIVATE_SENTINEL_V1` / `DO_NOT_CHANGE_20260926`。隔離 Node 程序對該精確路徑的 `readFile` 與 `appendFile` 均回 `EPERM`；host readback 仍為原內容，SHA-256 `52DBDD5AE91CCFB82E0FC6CAF1F5E843FAF62D5CC16BF0DFA5794B1C56EA9E87`。

同一程序的 TCP probe 對 47971 與 47831 都回 `EACCES`。47971 是本次候選 K server 的 live listener；故 47971 結果是本次有效拒絕證據。47831 當時沒有 host listener，雖然錯誤碼為 EACCES，不能排除不存在 listener 的因素，不據此推論該 port 的服務隔離。

初次 probe 生成的 `node -e` 程式因字串換行轉義錯誤，在執行前 SyntaxError；沒有執行任何檔案或連線操作。修正後先對實際生成程式執行 `node --check`，通過後才進行一次 Sandboxie boundary probe。失敗探測與修正後結果均保留在 raw evidence。

## Policy 與候選啟動

- 啟動來源：根目錄現行 `src/isolated-desktop.mjs` 的 `startIsolatedDesktop`，`deployment:'isolated'`，port `47971`，候選 workspace 使用上列唯一假資料目錄。
- 根目錄現行 `src/isolated-desktop.mjs` 將 `isolatedCodexSandboxPolicy` 注入主 Codex controller。該 helper 對 `workspace-write` 產生 `externalSandbox` 且 `networkAccess: enabled`；approval policy 仍採原生 `on-request`，沒有加寬成自動核准。
- 此 one-shot runner 的狀態輸出未包含 `executionPolicy` 欄位，因此本次沒有把 K state field 當成獨立讀回證據。Policy 接線以現行 source 為準；外層的 sentinel/network denial 另有實際 Sandboxie command 證據。
- 啟動時 KCandidate1–8 全部通過 idle preflight。第一次正常 `app.close` 未確認，wrapper 僅記錄 AggregateError 外層訊息，沒有可用內層原因；當時八盒 `/listpids` 均空但 port 47971 尚 listening，不以 pool busy=false 宣稱關閉。一次正常 close retry 回報 confirmed；之後再次讀回 KCandidate1–8 `/listpids` 全空，47971 無 listener。
- 正式版未重啟或部署；所有候選程序已正常關閉，pool 已交還。

## Raw evidence

- `.runtime/closeout-20260926/external-live-validation-20260926.json`
- `.runtime/closeout-20260926/run-external-live-once.mjs`
- `.runtime/closeout-20260926/probe-generated-syntax-check.mjs`
