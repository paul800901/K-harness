# Gemini 多模態與專案工具（2026-10-04）

## 要求與界線

使用者要求依 Gemini 提出的體檢方向，發揮多模態與原生工具能力。先查官方介面及本機 agy 1.2.16，不把模型／官方 App／SDK 的能力混成 CLI 接頭已支援。沿用 Antigravity 訂閱，不安裝新套件、不改登入／計費／原生權限模式、不讀或上傳真實錄音與素材，不發文、回評或操作廣告。東區不動。

## 查證與處理

### 已實作候選：原生多模態

- Gemini 3.8／3.7／3.6 Flash、3.1 Pro 可以用原生 `view_file` 讀圖、PDF、音訊與 MP4；先前僅放行 Flash 3.8 圖片是 K 的保守限制，不是 Pro 不能看圖。
- Gemini 附件現在保留原始 PDF（包括掃描頁／圖像），不先抹去圖像變成逐字稿；音訊 WAV／MP3／M4A、影片 MP4 直接交原生工具。沒有自行抽幀、OCR、轉錄或另造多模態 API。
- 保留每檔 8 MiB、每則 8 份、PDF 60 頁、原工作區／對話歸屬與下載。較大的既有檔案可由 AI 依明確授權用工作區路徑讀取，仍受原生限制；本次短假素材結果不保證任意長片可完整讀取。
- GPT／Claude 附件路徑不擴張；未知的新 Gemini 型號仍不冒稱已驗證。模型目錄與推理程度仍跟隨原生，沒有換模。
- Flash 工人原本即有 `view_file`；本批補上同一份 AI 用法指引，不增加人用功能設定。錯誤須如實回報，不能把讀取失敗寫成已看／已聽。

### 已實作候選：通用、工作區限定的 MCP 接口

- 沿用官方 `mcpServers` 格式，K 主對話及 Flash 共用一個小型工作區選擇器；未配置時不改現有行為。保留 `k_browser`、`k_google_ops` 既有接線及保護，不順手重構它們。
- 綁定存在 K 私有狀態根目錄的 `.runtime/gemini-mcp.json`，不從可編輯的任務文字／附件取得核准。實際 workspace 的 realpath 必須一致；子資料夾不自動繼承。換工作區即重新生成該對話的 native config，不全域掛載。
- `allowReadOnly` 是使用者預先授權的唯讀工具；`allowWrite` 只在非唯讀模式加入。都只能是已登記 server 的原生 `mcp(server/tool)` 規則；不能藉此放行 shell 或取代 K 內建工具。這是既有授權的預先設定，不是假冒執行中核准。
- 原生核心自己仍可能發現工作區 `.agents/mcp_config.json`；K 不將它視為預先核准來源。這不是 OS 沙箱，完整存取仍是使用者選擇的原生完整存取，不能宣稱能隔離任意惡意專案或全面阻止設定檔被修改。
- 本次只用假 MCP 驗收，正式不新增任何 Google 寫入工具、遠端伺服器或權限。後續接 YouTube／GA4 等仍需確認工具目的、既有憑證使用邊界與操作授權，不會因有接孔便自動啟用。

本機設定範例（工程／AI 接線用，不新增設定頁）：

```json
[
  {
    "workspace": "D:\\已授權工作區",
    "mcpServers": {
      "approved_tools": { "command": "D:\\工具\\server.exe", "args": [] }
    },
    "allowReadOnly": ["mcp(approved_tools/list_items)"],
    "allowWrite": ["mcp(approved_tools/update_item)"]
  }
]
```

設定及秘密不提交 Git；新增執行檔／連線不是一般文件修改，需明確授權。請勿把寫入工具列入 `allowReadOnly`。

### 未假裝接通的部分／原報告更正

1. **互動核准**：官方 headless 的 `--input-format stream-json` 只接受文字，明確拒絕 `control_request`／`control_response`；需要 Ask 的工具會 soft-deny。K 不能用任意 JSON 回覆核准。保留原生拒絕，未改成 skip、模擬終端點選、核准後重播整回合或另一套工具代理。未接入。
2. **執行中引導**：官方文件描述逐回合 stdin，不是保證 mid-turn steer。保留待送佇列與停止，不偽稱只能強制結束或乾等。
3. **計畫／目標**：CLI 的計畫工作流程不等於 Codex 的 goal 協定；不只把 `goal=true`。本批未加第二套目標儀表板，仍可用原生文字／工具與成果。原報告 `/goal` 宣稱未經證實。
4. **原生子代理**：真實 init 已列 `define_subagent`、`invoke_subagent`、`manage_subagents`、`schedule`；不能說 Gemini 主對話完全無此工具。本批未驗證整段派工，亦不以工具存在宣稱已驗收。Flash 工人禁止再委派／啟動背景服務是既有明確工作邊界，不刪掉。Gemini 反向派 GPT／Claude 本來就不是使用者需求。
5. 官方 Python SDK 可接多模態與 policies，但其 quickstart 使用 API key，不是本案四個 Pro 訂閱接法；沒有為了功能改計費或安裝 SDK。

官方依據：
- [Headless 輸入、事件與權限](https://antigravity.google/docs/cli/headless/)
- [CLI 互動式媒體附件](https://antigravity.google/docs/cli/prompting/)
- [原生 MCP 設定與權限](https://antigravity.google/docs/mcp/)
- [SDK 接入與計費入口](https://antigravity.google/docs/sdk/overview/)

## 實測證據

證據根目錄：維護 checkout 的 `.runtime/gemini-capabilities-20261004/`。只含本輪假資料、原始 stream／結果；不把原生日誌、帳號資料或本機設定提交 Git。

- Flash 3.8、3.7、3.6 與 Pro 3.1：讀同一份只有圖片的雙頁 PDF，辨識第二頁橙色三角形與 `ORANGE 314`；聽合成 WAV 正確辨識 `seven purple umbrellas`；看四秒 MP4 正確辨識紫色圓形→橙色三角形。原始 stream 均為 `view_file`，未跑命令、抽文字、換模或取用外部資料。
- Pro 3.1：另用 PNG 驗證紫色圓形、`VIOLET 627`。Flash 3.8 另驗證 MP3／M4A，同樣正確轉述合成語句。格式組合不是全部模型×編碼的笛卡兒積驗收，長音訊／長影片未驗。
- 試驗產生音訊時指定的英文語音未安裝，改由既有預設語音產生有效 WAV；沒有安裝語音。首次 61 頁測試夾具只有偽造頁數被 PDF parser 更正，已修夾具為真 61 頁，不改程式去迎合壞測試。
- K 主對話：六個原始附件（PNG、圖像 PDF、WAV、MP3、M4A、MP4）由 `upload` 到 `send` 真回合全部辨識正確；`k-turn-1-*` 留原始證據。
- K Flash 工人：原生 `view_file` 讀 PDF、WAV、MP4 並取得假 MCP 的隨機標記，`completed`、零工具錯誤，未寫入檔案。`integration-2/worker-result.json`。
- 假 MCP：主對話／工人已授權的 `luna_inspect` 正確呼叫；唯讀主對話嘗試只列在 `allowWrite` 的 `luna_cancel`，原生拒絕且伺服器未收到 cancel。換另一個工作區後 native config 不含假工具。`integration-2/result.json`。
- 初次整合測試把刻意拒絕的回合也要求 `completed`，因此測試中斷；實際核心正確拒絕並回傳 no output，K 正確標示失敗。已改測試預期，以新的假回合分別檢查成功／拒絕，不把拒絕改為成功、不重送真工作；原失敗 `k-turn-2-*` 留存。
- 真瀏覽器／假 API UI：Gemini 可選及附上 WAV，GPT／Claude 不開放影音；三供應商通過、零頁面錯誤，附件卡片截圖另經目視檢查。`ui/result.json`、`ui/gemini-audio-chip.png`。
- 初版完整 696/696；Opus 建議補修及 HTTP 測試後，完整 **697/697**，0 失敗／跳過；UI 建置成功，僅既有大 bundle 提醒。`full-tests.txt`、`full-tests-final.txt`、`build.txt`。

## Opus 複查

- 真正 Claude Code 2.1.289／Claude.ai Pro 訂閱，回傳模型 `claude-opus-5-5`；第一輪 session `e635d33c-020c-4625-abea-87ff676716bf`。原文留 `opus/opus-review.md`，完整事件與模型證據留同目錄，非其他模型代審。
- 結論：沒有阻擋部署的必修，loader 大小合適，未找到多餘防禦；保留雙層附件閘門（上傳／送出）及原生拒絕。要求更新已完成的整合測試結果，已補記；部署尚未完成就仍標示未部署，不提前改為已部署。
- 採納兩項最小補修：未驗證的新型號不再收到「可讀影音」指引；其他工作區路徑中段變成檔案（ENOTDIR）與不存在（ENOENT）同樣略過，避免阻塞無關對話。各有定向測試，沒有新增備援或許可。
- 命名限制保留英數／底線／連字號，本次沒有實際需點號的 server；未改成通用註冊框架。
- 補驗 PDF／影音的 HTTP 路由：下載保留 attachment disposition、正確 MIME 與位元組；非圖片預覽仍回檔案資訊，不宣稱新增影音播放器。
- 同名 MCP 假資料實測：工作區 `.agents/mcp_config.json` 放同名、另一個假 HTTP server，實際只有 owner profile 的 server 被呼叫；唯讀／工作區編輯結果分別見 `native-config-precedence/result.json`、`native-config-precedence-write/result.json`。這只證明本版實測，不是作業系統安全隔離或未來版本保證。

- 最後補查 session `948437f1-aaa3-4a51-8067-caa82ac18d4c`，原始回傳 `claude-opus-5-5`／success，結論「可以部署」。確認兩修無回歸、沒有多餘防禦；要求更新 697 測試數及 workspace-write 補驗結果，皆已補上。原文 `opus-final/opus-review.md`。

## 修改檔案

- `src/desktop-files.mjs`：依能力保留原始 PDF、影音附件及 MIME；一般文件路徑不變。
- `src/gemini-controller.mjs`、`src/gemini-worker.mjs`、新增 `src/gemini-project-mcp.mjs`：模型能力、原檔路徑、共用 AI 指引及專案工具接線。
- `frontend/main.jsx`：既有選檔入口依模型加入影音，不新增控制項。
- `test/gemini-controller.test.mjs`、新增 `test/gemini-media.test.mjs`、`test/gemini-project-mcp.test.mjs`、`test/gemini-media-ui-probe.mjs`：回歸與 UI 驗收。
- `AGENTS.md`、`README.md`、本文件、`docs/development-log.md`：使用者決定、現況／能力界線與發布紀錄。

## 部署與 Git

- 固定程式 commit：`4b8029624549175f1df3c12422aafe1bf9407e34`。13 個檔案，303 行增加／26 行刪除；無關的 extension-protocol 行尾變更未納入。
- 已從該 Git SHA 匯出乾淨候選 `D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\prepare-gemini-capabilities-1791113307704`，相依定義未改，重用已安裝相依；UI、擴充、啟動器建置及完整 **697/697** 再次通過，沒有安裝新套件。準備與測試記錄：`D:\K-harness\.runtime\gemini-capabilities-deploy-20261004`。
- **已實作且候選驗證完成，尚未部署、push 或建立發布 tag。** 正式 K 仍為 `fffe4266f82890742ec67e772531ff217ff80a17`，程序／47831 仍開著；已請本人完成工作後「離開並停止 K」，沒有把未確認閒置當成通過，也未強制停止。
- 本批不動四帳號、對話、登入、核心選用及目前工作。東區不動。收到退出回覆後，重新核對程序／連接埠、記錄保護項目，再用既有啟用器保留退版、套用、正式讀回並推私人 GitHub／建立新的固定標記；不能把本次候選測試當成正式驗收。
