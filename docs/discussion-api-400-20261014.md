# 討論 API HTTP 400：診斷與接續欄位保真（2026-10-14）

## 使用者可見問題與證據邊界

本人回報同一場交叉審查出現兩條相同的「API 討論失敗（HTTP 400）；未重送或換模型」。正式版本為 `65c4fc0ba0bd4bf6d148194ee1cfbeda6e31487f`，原始碼 main（含部署文件）為 `c9510c87f8537d64be8bac15683dcf8a1a90d16d`。

僅核對該場討論的狀態與參與者摘要：GLM-5.3 與 DeepSeek-V4-Pro 都未完成，GLM 保存 36 字可見輸出，DeepSeek 為 0 字；GPT 與 Opus 的獨立答案保留。僅輸出必要狀態摘要，未檢視或外送原討論材料內容，未讀取憑證、其他專案資料或重送原討論。

**本次兩家 400 的實際原因尚未確定。** 舊版 `src/discussion-api.mjs` 在非成功狀態直接丟棄 HTTP body，故舊紀錄無法找回供應商具體拒絕原因；不能由狀態碼猜成 Key 錯誤、沒錢、同一原因或已修復。

## 已確認缺口與最小修正

程式提交：`82069b90636a9bae0aea8527ef1ab678f624c29f`，分支 `codex/discussion-api-400-20261014`。

- `src/discussion-api.mjs`：工具接續將空的 `content` 改成 null，並丟掉明確回傳的空 `reasoning_content`。現在保留字串原值；供應商從未送 reasoning 欄位時仍不編造。
- 依 [DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/) 與 [Z.ai 思考模式](https://docs.z.ai/guides/capabilities/thinking-mode) 的官方接續範例核對：其空字串保持字串，思考內容依原樣帶回。**此欄位保真缺口可在本機重現，但尚不能證明就是本次真服務 400 的根因。** 不為推測改 schema、模型、effort、工具串流協定或自動補內容。
- HTTP 拒絕只取 JSON 的 `error.message`／`message`，遮掉目前 Key、去控制字元並限制顯示長度 300 字；不顯示 raw HTML/text、headers，也不新增持久化原始請求／回應。
- `src/discussion-controller.mjs`：沿既有錯誤字串加失敗參與者名稱，不新增狀態、通知或重試。成功同伴的答案與失敗參與者的部分內容照常保存。
- `test/discussion-api.test.mjs`、`test/discussion-controller.test.mjs`：新增欄位保真、供應商錯誤資訊／Key 遮罩／不重送，以及同時失敗的歸屬測試。

## 驗證

- 三項新增回歸先在舊碼執行，各自失敗；嚴格假 API 在欄位被改成 null／遺失時拒絕接續，修正後成功。此為人工契約測試，不是真服務失敗重現。
- 修改後 focused **32／32**，UI 建置成功，完整測試 **1649／1649**（0 fail/cancelled/skipped）。
- 複查後再補「原本未回傳 reasoning 欄位就不得編造」斷言，focused 再次 **32／32**；只加測試，產品程式未變。
- 沒有呼叫真實 DeepSeek／GLM／Kimi API，沒有測試付費服務、讀取 Key、操作本人原討論或停止正式 K。

## Opus 5.5 複查與取捨

真正 Claude Opus 5.5 經 K 專用 Claude Code 2.1.296／Pro 訂閱完成獨立唯讀複查，實際模型 `claude-opus-5-5`，session `b831ef18-10d7-474f-80e4-92309df0cf12`，exit 0、success、is_error=false；10 個 Read／Glob／Grep 呼叫皆在非敏感原始碼封包內，主代理逐項核對。結論無 blocker、可合併，且明示真 400 原因仍未知。

- 採納：補未送 reasoning 欄位不編造的測試。
- 未擴張：更多 Unicode 控制字元、surrogate 顯示截斷、錯誤 body 大小界限、部分／變形 Key、同名參與者辨識皆非本次已有失敗證據，保留最小修正。完整目前 Key 已先於截斷遮掉，純文字錯誤 body 仍不顯示。
- Opus 對歷史思考內容的供應商要求保留疑問；主代理以當日官方文件核對，目前 DeepSeek 帶 tools 時要求帶回、Z.ai 工具接續也要求保留，沒有為舊版模型行為更改現在路由。
- 不把複查結論、完整測試或狀態碼當成真 API 已接通的證明。

## 狀態與下一步

**僅本地候選驗證完成；未合回 main、未部署、未 push。** 修正保存在上述獨立分支，正式 K 持續使用原版本。

已詢問本人是否允許經 K 既有連線各做一次小型診斷（DeepSeek／GLM 各最多 2 次請求，只傳人工測試文字，不重送原討論、不顯示或搬移 Key，可能少量 API 費用）；尚未收到回覆前不執行。此診斷用來確認實際拒絕原因，不以本機測試冒充解決。

本機證據在本工作樹 `.runtime/archive/discussion-api-400-20261014/`（修正前失敗、focused、完整測試、UI 建置、Opus 封包與回覆）；私人執行紀錄不提交。東區未更新。
