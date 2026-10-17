# Gemini 獨立額度查詢的 CLI 識別修正

## 需求與根因

2026-10-16，Claude、Codex 額度仍有資料，但五個 Gemini 帳號的獨立查詢都失敗。本批只修 Gemini 額度接頭，並重新查證 Gemini 4 可用性；不切換登入、不重播工作、不改計費或原生核心版本。

- 選用的 Antigravity CLI 實際為 **1.4.0**。
- 舊接頭向既有 `daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` 發送 `User-Agent: antigravity`。Google 回 HTTP 200，但只有 `3p-weekly`、`3p-5h`，沒有 Gemini 群組，因此原解析器正確拒絕並回 `QUOTA_SCHEMA`。
- 核對已安裝 CLI 的公開字串與針對性離線程式分析，確認原生客戶端識別格式為 `antigravity/cli/<版本>`。沒有攔截 TLS、輸出 token、修改核心或讀取其他專案的登入資料。
- 同一帳號、同一端點、同一空物件請求，改送 `antigravity/cli/1.4.0` 後，即回傳 `gemini-weekly`、`gemini-5h`。只有 `antigravity/1.4.0`、`antigravity/cli` 或在註解內附 CLI 用途均不足以修復。
- 修正後查到的百分比與同時執行原生 `/usage` 一致。診斷時另一個官方 host 回不同百分比，未採用：不能用不同額度來源的數字冒充本 CLI 額度。

## 修改範圍

- `scripts/gemini-quota.ps1`：用既有選用執行檔的 `--version` 組成 CLI 識別；隱藏視窗、環境白名單、關閉自動更新。版本不可確認即停止，不快取或編造版本。版本探測的 10 秒期限只作用於這次唯讀探測程序，不是工作期限。
- 兩個斜線是原生識別格式，但 .NET 的結構化 User-Agent 解析器不接受，因此在嚴格限制字串後用 `TryAddWithoutValidation` 送出。
- `test/gemini-quota-helper.test.mjs`：實際執行 Windows PowerShell 5.1 與 HttpClient，只替換 HTTP handler；依識別回傳兩種實際觀察到的資料形狀，驗證 Gemini 兩個窗口、端點與缺失時拒絕。
- 不改端點、OAuth client、帳號憑證位置、刷新規則、排程、資料解析、畫面或額度耗盡判定；不加備援入口或新設定。

## 驗證

- 移除新識別、恢復舊 header：新回歸測試確實因 `QUOTA_SCHEMA:Quota windows not uniquely provided.` 失敗；恢復修正後通過。
- 額度 helper／credential vault／accounts 相關測試 **157/157** 通過。
- 完整 `npm test` **1690/1690** 通過，0 失敗、取消、略過。畫面沒有修改，本批不新增或重跑介面測試。
- 16:15 +08:00 用本工作樹正式 helper 與 vault，逐一實查五個已保存帳號：全部 `authenticated`、`quota.ready`，身分吻合；Google 當次都回 5 小時及每週 100%。這是官方回傳，不是 K 補上的預設值，不表示未來仍維持 100%。目前原生登入前後相同。
- 秘密只在原有 Windows helper 內使用；Node 僅接收既有安全身分／額度中繼資料，工程證據省略帳號名稱與識別碼。
- 本機診斷及測試證據在 `.runtime/archive/gemini-quota-schema-20261016/`，不提交原始回覆、原生事件或執行資料。

## Gemini 4 查證

- 使用正確 CLI 識別、既有保存帳號逐一查 Google `fetchAvailableModels`。五個帳號都回 `models["gemini-4-argon-disabled"]`，其中 `displayName` 為 `Gemini 4 Argon`，`disabled` 為 `true`。
- 所以目前五個帳號均未獲得可選用的 Gemini 4。這是模型目錄回傳的禁用標記，不是 K 自訂的排除名單，更不是帳號整體被停用；沒有強行呼叫被禁用型號。
- 目前登入帳號的原生 `models` 同樣沒有可用 Gemini 4。未為檢查其他帳號而切換登入。
- [Google 官方模型說明](https://antigravity.google/docs/models/) 本次已列 Google AI Pro 非試用訂閱可用 Argon；一般方案規則不等於本次帳號已獲開放。回傳資料沒有足夠證據解釋本批帳號被禁用的原因，不由方案欄位猜測。

## Opus 5.5 複查與取捨

- 修法討論與最終複查均使用真正 `claude-opus-5-5`，原生 assistant 事件讀回確認。最終複查於 16:17 +08:00 完成，結論無必修問題，完整測試通過後可部署。
- 採納初審糾正：不能把原生 100% 及隨查詢時間移動的重設時間當成預設值；不能僅憑方案欄位推論帳號原因。最後以同端點、不同 CLI 識別及原生讀回確認根因。
- 最終複查同意不改 host、不加快取／備援／額外狀態；模擬 HTTP handler 負責回歸，實際 helper 實查負責證明 .NET 真正送出正確 header。
- 非阻擋限制：版本探測逾時仍統一回 `QUOTA_CLIENT:Native version unavailable.`，內部較細訊息會被覆蓋；分類及停止行為正確，本批不另擴張錯誤格式。未觀察到的未來核心子程序／家目錄需求不增加預防架構。

## 部署狀態

程式與測試提交：`b0559347f0fb81eece6a71f2a487f363121db086`。

以下保留首次部署受阻的歷史；後續南區已部署，正式讀回見本節末尾。東區未更新。

2026-10-16，對完整版本 `108cd8f5c9297ee1432ce78dbb2b6aaffde3a0a3` 執行一次更新。候選建置的完整測試為 **1689/1690 通過**，`test/fresh-target-model.test.mjs:147` 的 `fresh native selection: different model uses native default not unsupported source effort` 失敗，原始錯誤為 `Error: target handoff timed out`。更新程式停止於套用前；不能將開發工作樹的 1690/1690 當成這次部署通過，也尚未判定逾時原因。

- 已停止，沒有重試、略過測試、退版、強制結束程序或 push。
- 失敗後 `.local/runtime.json` 仍為 `be96457721bcade1249b6ad2b36c89a7e7f7377a`，未套用新版；K 保持關閉，47831 無 listener，沒有正式 K 自有程序。
- 部署前依三份退版保留規則，最舊的非 previous 程式退版已移至資源回收筒並讀回確認可還原；目前 previous 未動。沒有清理帳號或對話。
- 原始錯誤保存在 `.runtime/archive/gemini-quota-schema-20261016/deploy.log`；未套用候選 `prepare-1792138940127` 原地保留，未自行清除。
- 當時停止等待釐清部署測試逾時與繼續授權；後續本人已明確授權修復及部署，結果如下。

### 後續部署成功：2026-10-16 16:52 +08:00

- 原測試逾時已釐清並修正，另修正完整測試實際抓到的原生完成通知競態；真正 Opus 5.5 最終複查無必修項。見 [交接測試與通知競態紀錄](fresh-target-timeout-20261016.md)。
- 南區部署版本 **`0d14cbd14c3f5c841dda32db254665685ac0d5e6`**，包含本項程式提交。修正後開發工作樹兩次與更新器一次完整測試皆 **1697/1697**，更新器介面建置成功。
- `.local/runtime.json` 版本吻合，previous 為 `be96457721bcade1249b6ad2b36c89a7e7f7377a`；退版三份，根層無 `prepare-*.zip`；正式 helper 雜湊與驗收來源相同。
- K 只啟動一次，16:52:42 health **200／native**。外層驗證命令誤讀殘留退出碼的誤報與讀回過程已記於上列紀錄，沒有再次啟動。
- 正式 K 五帳號在 16:52:25 至 16:52:54 自行查詢並保存最新官方結果，全部 `authenticated`、`quota.ready`；當次每週、5 小時均 100%。目前登入仍是第二個保存帳號，未切換；這是正式後端讀回，非候選測試或畫面截圖。
- 額度恢復不等於 Gemini 4 開放，前述 Google 模型目錄的停用結論不變。
- 16:53:11 首次 push 後，GitHub `main` 與本機 SHA 皆為上述部署版本。公開差異已檢查秘密與私人資料；本次部署紀錄另作純文件提交，不重啟 K，不更新東區。
