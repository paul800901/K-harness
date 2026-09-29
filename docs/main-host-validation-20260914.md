# K 內主代理接入與驗收（2026-09-14）

## 已確認

K 現在有自己的文字對話入口 `Start-K.ps1`，使用官方本機 Codex App Server 執行 Astra／Sol，Pi／DeepSeek 仍負責工人。這不是另一個 Codex App 任務代操作，也不是把 ChatGPT 登入憑證交給 Pi。主對話與持續狀態由官方引擎管理；K 不自行重做 GPT 推理迴圈。

本機版本 `codex-cli 0.154.0-alpha.6.2`。官方 account/read 實測 type=chatgpt，Astra、Sol 均列於 model/list。未讀取 auth.json、未複製 OAuth token、未切換 OpenAI API 金鑰計費。主控接入依 [官方 App Server 文件](https://learn.chatgpt.com/docs/app-server)；登入模式依 [官方驗證文件](https://learn.chatgpt.com/docs/auth)。這些介面及本機版本仍有實驗性部分，不代表未來升級無需相容性檢查。

## 真實閉環

兩個主模型各自從 K 啟動、讀取人工 input/draft、自行找出三個錯誤，派一次 Flash 修訂，等待完成後再次讀取實際 corrected.json，最後自行接受。外層只給驗收規則與範圍，未替內層主模型寫修正答案或代替它決定接受。最後外層另讀回事件與成果核對。

| 主代理 | 原生對話 ID | 證據案例 | 結果 |
| --- | --- | --- | --- |
| Astra | 01a09f15-cdf1-7822-939c-f3c51c632a4b | .runtime/main-tests/case-cYowCN | 原稿拒絕；三項錯誤定位正確；一次 Flash start、一次 wait；實檔讀回後接受 |
| Sol | 01a09f15-f5a9-7dc3-8482-205dc5d16d31 | .runtime/main-tests/case-9PHmGl | 同上；首次 wait 指定 120000 ms 遭拒，改 60000 ms 成功，沒有重派工作 |

兩份輸入各有不同隨機 marker；應保留 IDs X、X、Y，總分鐘 13，unknownOwnerIds 僅 X。最後成果與主模型 verified 均正確，來源與錯誤初稿保持不變。兩次核准均依使用者本輪另行授權，限指定兩個讀檔及一個新輸出，沒有 session／always 核准。

主模型實際使用 thread/start 回傳的 low effort，沒有另外覆寫思考等級；不是 Astra/Sol Ultra 測試。Astra 完整回合約 38.386 秒、Sol 約 51.541 秒，從 turn/started 到 turn/completed，不含前置接線、失敗探索與最後外層驗收；沒有品質相當的速度／節費比較結論。

## 啟動與續聊

在 PowerShell 使用：

```powershell
& D:\K-harness\Start-K.ps1
& D:\K-harness\Start-K.ps1 -Model gpt-5.6-sol
& D:\K-harness\Start-K.ps1 -Model gpt-6-astra -ResumeThreadId 01a09f15-cdf1-7822-939c-f3c51c632a4b
```

這是真正的終端文字入口，還不是圖形聊天 App。`/exit` 結束。每次顯示對話 ID，K 保存不含憑證的連線紀錄於 `.runtime/main-sessions`；原對話由 Codex 執行引擎持續保存。

已實際啟動 Start-K.ps1，重開上述 Astra 對話，在全新程序只問先前 marker、三項錯誤與 correctedAccepted，未重新提供答案；畫面正確回覆 marker 與驗收結論並回到下一次輸入提示。其後正常 /exit。這證明此短對話可續聊，不是大量上下文壓縮、數日長程記憶或 Sol 續聊已驗證。

## 這輪修正的接入缺口

1. 依本機實際協定修正 sandbox 字串為 read-only（不是 readOnly）。錯誤請求未啟動模型。
2. 起初模型回報沒看到工人工具；新增 MCP ready 事件等待並讀回 k_flash 的 connected 與工具 schema，才開始模型回合。
3. never approval 會阻止標為 destructive 的 start。改用每個 K 對話的 on-request，沒有修改全域核准設定；K 自己顯示核准問題。
4. 本機實際工具核准走 mcpServer/elicitation/request form，不是一般問答。已按真實 payload 支援。先前兩次未處理的請求被拒絕，並非使用者親自拒絕；那些失敗與未建立的輸出均保留在舊案例，不改寫成成功。

日常 K 核准介面顯示工具參數，只有明確輸入 YES 才接受一次，空白或其他答案拒絕。不提供永久核准，不接受其他對話、密碼問答、未知表單或額外 filesystem/network 權限。一般問答則照實際選項編號回覆，不預設選擇同意。

## 驗證與設定邊界

完整離線回歸 52／52 通過，包含三項新核准介面測試。另有兩個真實主代理閉環、原生 MCP 派工、K 終端啟動／Astra 續聊。主代理目前以唯讀 shell 操作，寫檔由取得明確授權的工人執行；Pi 工具範圍不是 OS 沙箱，不適用惡意程式或敏感正式資料。

K `.codex/config.toml` 雜湊仍為 E83EAED986212B7DB9E0B0C0904D0A31DE3F2B0580A13EAB5712ED5A9BB57D63。全域 config 目前為 93666558B84081FB8144065643DA371B36D75CB8780556402143C3C31A9E69C8，和前輪不同；修改時間 16:30:19 早於首個主模型測試對話 16:36。本輪沒有發出 config/write 或修改該檔，不能確定此差異的來源，因此保留現況，不擅自還原。現行全域 model 是 terra、effort low；K 依啟動參數明確選 Astra／Sol，不改全域模型。

尚待：圖形介面、互動核准的人手操作實測、更多真實工作型態、主代理中斷時工人副作用的整體接續、主對話長程壓縮及可靠性、費用比較。不能據此宣布已全面替代 Codex App。
