# API 模型只作討論參與者：設計討論（2026-10-09）

## 本人需求與狀態

本人希望參考 VS Code 的供應商／API key／endpoint設定，在平行比較、交叉審查、多人討論的「加入參與者」選單提供API模型；明確排除一般對話主模型、子代理及派工。另要求與真正Opus5.5討論。本輪僅查核／設計討論，沒有實作、金鑰保存、API模型目錄實查、付費API呼叫或更新K授權；既有DeepSeek工人移除決定不被恢復。

正式指標讀回 `1a45a73440a5f948c5cec625de02340863b7c67d`。當前discussion-native只接Codex／Claude／Gemini原生訂閱，參與者沿共用原生目錄驗證；前端平列option，沒有API連線設定／API討論session。不是「已支持但藏在UI」。

## 外部參考

- [VS Code官方模型設定](https://code.visualstudio.com/docs/agent-customization/language-models)：BYOK提供供應商、分組名、key／endpoint，自訂服務有Chat Completions／Responses／Messages，可自動查模型或填模型設定。只參考本人所需功能，不搬整個管理中心。
- [DeepSeek官方模型目錄](https://api-docs.deepseek.com/api/list-models/)：GET/models提供模型ID、顯示名稱、模態、上下文及effort。官方示例不是本人的帳號查詢；不將口述V4.1等名称寫死為可選模型。

## 真正Opus第二意見與Astra裁決

官方Claude Code2.1.294／Pro訂閱，實際`claude-opus-5-5`，session `238904b9-8a70-4cbc-b99e-ac9bc18eec7a`，exit0／success、7次Read／Grep；只讀五個討論相關原碼與scope，沒有Shell／寫入／瀏覽器／MCP／API模型呼叫。原文與封包保留於 `D:\K-harness\.runtime\discussion-api-design-20261009`。

兩者支持以下方向，仍是待本人採用的設計，不是已實作契約：

1. 主模型、子代理保持原生訂閱清單。另提供討論專用目錄；API只有參與者身分，主持／背景整理仍由原生主模型負責。後端也拒絕API進一般工作，不只隱藏按鈕。
2. 參與者選單分組為OpenAI/Codex（訂閱）、Claude（訂閱）、Gemini（訂閱）及各供應商API（按API計費）。設定只增加「討論用API」連線，不增加一般agent框架。
3. 第一批可限定DeepSeek及相容Chat Completions端點，純文字、無工具、無工作區讀寫／派工。沿既有討論ask／close接點，不重寫討論排程；其他協定不能冒稱相容。
4. 連線及model分開識別，避免原生／API同名碰撞。目錄以實際服務提供內容為準；無目錄服務可明確填官方modelID並標未確認。推理程度依服務能力，不自造等級；目錄列出不等於本人key已成功完成推論。
5. 金鑰只在K後端安全保存，前端只看已設定／未設定；不讀歷史DeepSeek key，不寫入討論紀錄／錯誤。外部HTTPS端點不允許把帶金鑰請求重導往別站。失敗、取消不暗換模型／帳號或自動重送。
6. 選API後常駐顯示供應商、API計費及實際外送資料，不每輪加彈窗，不預設選入API。服務端alias可能升級；K只能保證不自行更換ID／連線，回應model有提供才記錄，不誇大底層版本固定。

Opus指出的真正盲點：勾選帶入前文時，不只是新問題，還有原生主持整理的前文摘要，以及前文文字附件全文；交叉審查也有被審查內容。互動模式另傳送其他參與者發言／本人補充，因此揭露不能只寫「議題」。Astra核對askBatch後修正Opus「所有模式每輪都外送其他參與者原文」的概括：首輪independent不帶其他答案，parallel後續只帶使用者新訊息；原有平行互不可見必須保留。

不採用Opus的「每一次真正API請求都須另問授權」字面規則：本輪確實無API操作授權，但未來本人明確保存連線／按查模型／選定API送出討論，在已確認範圍內可作操作授權，不要求每個內部HTTP回合再問。不能把一次討論授權擴為背景自動消費、工具或全工作區外送。

尚待本人決定：第一批供應商範圍、自訂端點、金鑰保存授權及API討論的前文帶入預設。不暗改既有原生討論設定；暫不做預算平台、價格表、key輪替、通用外掛或API主／子代理。沒有產品diff、測試或正式部署；研究記錄不改AGENTS.md規則。
