# 2026-10-09 K 專用 Chrome 離線恢復

使用者在實際網頁唯讀核對任務中要求先排除Chrome未連線，並明確要求開啟原K專用Chrome及保存的sl800901設定檔。

## 實查與處理

- 起始browser_profiles三個保存的profileId均connected=false；browser_session未指定profileId明確拒絕，不曾切換日常Chrome作備援。
- 當時只有日常Chrome主程序；原K專用user-data-dir未執行。舊native link指向已退出程序。診斷另記parent_mismatch，與日常Chrome不符合既有專用profile邊界一致；未放寬此guard。
- 使用既有Chrome執行檔與原vault/k-chrome-profile開啟，不新增user-data-dir、不讀或搬取密碼／cookie。先開到原last-used的Profile 2，發現使用者指定帳戶在Default後，再明確開Default；Profile 2未進行帳號寫入。這不是產品自動開窗或新備援路由。
- Default保存帳戶label為sl800901；本轮以native link啟動時間與profile啟用結果定位8b2868aca25e4139907a71ce055cf2aa，再用正式browser_session regular顯式選取。
- 真browser_profiles已connected=true且提供regular/incognito；以browser_tabs及browser_snapshot成功讀取使用者指定的已登入正式網站頁面，頁面與使用者提供畫面吻合。具體業務內容／網址／患者資料不複製進K工程庫。
- 從網站根頁首次進入曾顯示Business ID登入，點既有登入後回400但正文「您已登入」；按使用者提供的已登入服務頁網址重新導航，正式頁面正常。沒有輸入或取得密碼、沒有改登入帳戶。
- 嘗試chrome://version內部頁遭Page.navigate Detached；普通HTTPS頁與snapshot後續正常，未將內部頁失敗當成助手仍斷線。

## 狀態與未改範圍

本次是既有執行環境恢復及真網頁讀回，不是程式修改；未修改原生host註冊、guard、模型、權限、帳號、Chrome登入資料、正式程式／部署版本，未重啟K、未push或更新東區。未新增常駐檢查或自動開窗。文件與索引本輪更新；沒有程式碼需要Opus程式審核。

恢復後回到原授權的網頁唯讀工作；傳訊或其他網站寫入仍依業務任務授權。原盤點中「本輪Chrome未連線」只適用恢復前截點，不能再用作後續OA無法核對的結論。
