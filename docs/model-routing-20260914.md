# 模型選擇與派工修正（2026-09-14）

## 使用者確認的定位

K 是通用工作台，目標是保留接近 Codex App／Claude Code 的工作能力，補上跨供應商的子代理選擇。不是主代理只准判斷、Flash 被迫執行所有事情的產品。

- 主代理模型自由選擇，不固定「Astra 複雜／Sol 日常」。
- 只在需要時委派。一般子代理預設 Flash，可以改選適合的模型。
- 圖像判讀子代理依使用者要求固定 Luna；不交給 Flash。
- 其他便宜供應商是後續可接入方向，尚未接上者不做假選項或暗中切換憑證。

## 本次已接線

- `GET /api/models` 讀官方 Codex `model/list` 的可見清單及分頁；本機實際提供 Astra、Sol、Terra、Luna、GPT-5.5、Codex Spark。UI 不硬編模型數量、用途或推理級別。
- 新對話可分開選主模型、推理程度、預設子代理。GPT 子代理設定使用 native `agents.default_subagent_model`；Flash 保留 Pi/MCP 路徑，不能把 DeepSeek 模型名稱塞進 Codex 原生模型欄位。
- 派工偏好附加於既有 developer instructions 後；保留「不需要就不派工」、圖像 Luna、不可靜默換計費、能力不等於權限。這是模型可讀的路由政策，不是對任意任務的機械式分類保證。
- 對話保存 workerPolicy 及推理程度；模型下架也不抹除歷史，重新執行時仍確認目前模型可用。
- 原生 `subAgentActivity` 與相容的 `collabAgentToolCall` 可顯示於活動及子代理狀態。停止時讀子代理的 parentThreadId 與 active turn，僅中止確認屬於本主對話的回合；未確認停止不冒稱完成。
- 移除輸入框下方「訂閱主代理 / Flash API · 非臨床工作」、空白頁 Astra/Sol 固定分工及設定中的重複連線介紹。
- 淺色／暖色／深色獨立；字級 14～22 每個整數都可選。

## 真實驗證

2026-09-14 23:30 左右，以 UI 建立 Terra / medium 主代理、Luna 預設子代理；後端讀回模型、effort 與 workerPolicy 一致。

- 主對話：`01a0a08a-af61-72c1-b9e3-6c22e6ed0194`。
- 原生子代理：`01a0a08b-7f99-75b3-b400-2c6fa378c13b`，parentThreadId 精確對上主對話。
- 子代理原始 turn context 模型為 `gpt-5.6-luna`；官方 thread/read 看到實際 `imageView`，路徑為 K 的人工 fixture `.runtime/ui-acceptance/two-colours.png`。
- 主代理本身未代讀圖片；Luna 回覆左紅右藍，與本輪獨立看圖相符。沒有呼叫 Flash、寫檔或讀其他工作區。
- 後端重開並接續原對話後，原始回覆與原生子代理 completed 狀態可讀回，沒有重新派工。
- 對同一 Terra 對話再開啟且不傳入 effort，後端仍讀回 medium，確認推理程度隨對話保存。
- UI 實際顯示六個模型，Luna 不顯示不支援的 Ultra；主代理與子代理選擇互相獨立。色彩與 19px 重載保存亦已在瀏覽器實測。
- 本輪最終 `npm test`：95／95 通過，無失敗或略過；原生停止測試屬模擬模型測試，不冒充真實 GPT 工作中的停止證據。

協定依據：[Codex App Server 模型目錄](https://learn.chatgpt.com/docs/app-server#models)、[原生子代理設定](https://learn.chatgpt.com/docs/config-file/config-reference)。另核對已安裝 Codex `0.154.0-alpha.6.2` 產生的實際 schema。新格式以真實 thread/read 為準，不能只憑舊 collab 格式推論。

## 尚未完成，不能宣稱同等 Codex App

- 主代理目前仍為 read-only，通用寫檔、命令執行核准、完整 Blender 工具工作流尚未接齊；模型選單與一次看圖成功不等於這些能力完成。
- 除 DeepSeek Flash 與原生 Codex GPT 路線外，其他供應商未接入。
- 圖像 Luna 已做一次真實派工驗證；沒有宣稱所有模型、任務分類、長程恢復或任意多層子代理皆通過。
- 原生子代理停止邏輯有獨立模型 fixture 測試；尚未以正在執行的真實 GPT 子代理做停止驗收。
- 目前子代理偏好在建立對話時選擇；尚未做任意既有對話的即時切換設定視窗。
- 此處的偏好接線限桌面主控；舊 CLI 已支援完整主模型清單，但尚未補完整的子代理偏好與活動 UI。

接下來真正的工程缺口是主代理通用工具與可核准執行，以及原生／外部子代理一致的生命週期驗證，而不是繼續增加固定角色文案。
