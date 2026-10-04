# Google 商家營運 API 接入（2026-10-04）

## 範圍與授權

- 使用者要求先推 GitHub，再接 Google 商家營運 API；後續說明經營工作改由 Gemini／Opus／Sol（本人選用時 Astra）分工，K 共用既有工具及專案資料，不另建營運系統。
- 前批網頁／Chrome 程式及正式紀錄已推既有私人 `origin/main`，遠端 SHA 讀回 `2c9d5f7e292f9cf49002639eadfd67500c87c03f`，未移動 tag、未更新東區。
- 本批只接商家帳號、據點、評論、既有貼文的查詢。**沒有回評、發文、上傳、廣告異動工具**；Google 商家 API 接入不等於先前盤點中的五套 Google 服務全部完成。
- 使用者另行明確允許只在既有專案啟用 `mybusiness.googleapis.com`，並在看到條款後同意 Google APIs Terms of Service／Google Business Profile API 條款。隨後授權接續全權處理；部署仍須確認 K 閒置、保留退版版本並讀回，不碰看診系統。

## 最小接法

- `src/google-ops-mcp.mjs`：沿用已安裝的官方 MCP SDK，以 stdio 提供四個固定唯讀工具。沒有新網路服務、任意命令／URL 代理、重試、排程或人用設定。
- `src/google-ops-reader.py`：沿用 AdsControl 現有 `google_ops_client.py` 的 OAuth refresh 與 HTTP 函式；只建固定 GET URL。沒有執行會寫 SQLite／`.env` 的 `sync_*`，未修改 AdsControl 原碼。
- 由 K 私有狀態 `.runtime/google-ops.json` 綁定本機既有 AdsControl 位置（只記路徑、不含秘密）；只有選定該工作區或直接父層 ObserveOpsControl 時掛載。工作區不能靠自行新建同名 client／Python 自動註冊可執行程式。其他專案不掃描登入或商家資料，也不自動安裝相依。
- GPT／Claude／Gemini 主代理與 Flash 工人接同一個 `k_google_ops`。GPT／Claude 原生核准照舊；Gemini 只加入此固定唯讀 MCP 的許可，保留寫檔、指令與其他 MCP 限制。唯讀模式也能查詢，不必啟用 Chrome。
- 商家憑證仍留 AdsControl 本機，僅既有 Python client 載入，不搬進 K 設定／Git。Gemini 四個 Pro 帳號是模型額度身分，不會改變這套商家 API 的授權帳號。
- 回傳官方原始分頁、`nextPageToken` 與 UTC `fetchedAt`。有下一頁不能說已讀全部；每次一頁，不自動掃完整評論庫。例外只回有限原因，不回原始秘密／stack／HTTP payload。Python 使用 `-I -S -B`，不載入 site 套件／.pth、不產生 pycache。

## 真實根因與處理

1. OAuth refresh 與帳號查詢成功；1 個商家帳號、3 個據點。舊文件的 quota 0 不是此次現況。
2. 初次評論／貼文皆 403；Google 回 `SERVICE_DISABLED`，服務為 `mybusiness.googleapis.com`。不是登入失效或 Pro 額度問題。
3. 本人明確授權並同意條款後，在既有 **Observe YouTube API** 專案按一次啟用；Google Cloud 讀回 **已啟用**。沒有新增專案、改計費、IAM、OAuth scope 或 token。
4. 啟用後 MCP 真實查詢 **8/8 成功**：帳號、據點及 3 據點各一次評論／貼文。評論第一頁分別 50／2／50 筆，其中兩處尚有下一頁；貼文 4／1／4 筆。這是接線抽驗，不是評論總數／經營成效，也不表示三個據點都仍營業。
5. 前後 AdsControl `.env` 雜湊相同；資料未同步入 DB，沒有公開內容異動。

## Opus 初查與補修

- 真 Opus 5.5（session `93ecfb83-f8fd-4aae-8ca3-1d74b7403068`）指出：Gemini 工作區可寫時能先改 client，再藉 MCP 執行，會繞過禁止命令。
- 已依現有原生規則，非完整存取 Gemini 明確禁止改 `google_ops_worker` 與 `.venv`；不新增權限框架或核准按鈕。另取消依專案檔案自動發現執行程式，改用 K owner 私有路徑綁定，避免工作區新建假 client 就觸發可執行掛載；加 `-S` 排除 Python .pth。
- GPT／Claude 可修改並執行工作區程式，仍保留原生 MCP 核准；本機工具不是 OS 隔離，核准畫面不能反映 client 是否遭修改，不宣稱可防止主代理修改自身工具。不要將「四個唯讀 API」誤當作整個本機程序的防竄改保證。
- Opus 補查（session `0aff10fb-736c-4977-953c-bcea9f6109d6`）指出選配接線目錄失效會阻止一般 session。已改為缺少目錄／client／Python 時不掛載，不讓商家工具拖累其他聊天室；新增回歸。
- 依補查實測原生拒寫：直接工作區、直接父層均擋下；**第一次 junction／大小寫別名測試失敗**，兩個新建假檔被改，沒有碰正式 client。原因是 agy 依文字路徑比對，而非解析 junction。最小補修是同時禁止原始實體路徑與選定工作區別名路徑；MCP 執行仍固定 owner 綁定的實體路徑。補後父層及 junction／大小寫兩組共 4 次拒寫全部通過，假 client／pyvenv.cfg 不變；不新增 OS 隔離或任意連結掃描。
- 已檢查既有 client：只 import 標準函式庫，OAuth URL 固定為 Google，不從 `.env` 讀自訂 token/API endpoint。`-S` 補後主代理與工人皆真實完成四工具及評論第二頁，並非只測修改前版本。另補既有 client 包裝 URLError 時的安全錯誤分類，不回原文或重試。
- 帳號清單頁面大小改依官方上限 20；其餘清單 50。保留 Python 入參檢查，因 helper 是可獨立啟動的程序邊界；保留實際觀察過的 403／quota 0 診斷，不做重試。
- Opus 最後補查（session `00351060-1d4e-431d-afb8-7a02bd1b4b0c`）結論為沒有阻擋部署的程式錯誤、別名拒寫足夠精簡；採納 `realpathSync.native` 與非同步 resolver 同用原生路徑解析。不照建議擅自用管理員更改磁碟的短檔名設定，也不新增隔離框架。
- 限制：評論／貼文是外部不可信文字，工具說明明示不得當作指令。本批沒有把既有工作區 `.env` 移走或建立全面秘密讀取隔離；能讀工作區又能連網的主代理／工人仍須遵守不讀取、洩漏憑證的任務規則。唯讀商家工具與原生核准不是全面的防提示注入保證。

## 驗證與待完成

- 最終來源 Node 完整測試 **674/674**，0 失敗、0 跳過（前次 670／672／673 是中途版本，非最終數字）。
- Python adapter 測試 6/6：固定 URL、資源識別、分頁、授權過期、服務未開通／拒絕／額度／網路錯誤與秘密不回傳。
- 真 Gemini 3.8 Flash low 工人與 Gemini 主代理各完成帳號→據點→評論→貼文→評論第二頁，共 **10 次真 MCP 成功**，零工具錯誤，未寫業務檔、換帳號或切計費。驗證的是原生 `call_mcp_tool` 的 DONE，不只讀到工具定義。原生自行讀取 MCP 定義與原生結果檔是工具使用流程，不是讀取其他業務檔案。
- 真 Opus 最後收尾已完成；乾淨 Git 候選建置、正式部署與新版 push 尚待以下收尾紀錄；不要將候選驗證當成正式版已更新。
- GPT／Claude 目前取得設定層測試，尚未宣稱兩者各自真模型呼叫已驗收。
- Search Console、GA4、YouTube、Google Ads 與商家寫入尚未在本批加入；不是「有 OAuth 就全部接好」。

本機證據：維護工作樹 `.runtime/google-ops-20261004/` 的 `live-mcp-before-enable.json`、`live-mcp-result.json`、`cloud-enabled.png`、`native-1791079596330/summary.json`、`guard-1791080024340/result.json`、`guard-parent-1791080110537/result.json`（失敗）、`guard-parent-1791080293735/result.json`（補後成功）、`final-fixed-tests.log` 與 `final-python-tests.log`。實際回應內容不進 Git，只記查詢成功、筆數及時間。

## 本機設定與退版界線

接線位置在 K 私有 state root 的 `.runtime/google-ops.json`，僅 `directory` 欄位指向本台既有 AdsControl。東區若日後使用，須在當地確認 client、Python 與本人授權，不能從 Git 取得南區登入。選配工具缺檔時不掛載，不另裝套件或改全域設定。

程式退版不撤銷 Google Cloud 已啟用的服務，也不還原對話；本批不自動停用 Google 服務。

## 官方介面依據

- [商家據點分頁與 readMask](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list)
- [評論查詢與分頁](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list)
- [既有貼文查詢](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/list)

原盤點差異見 [Google Ops 盤點核對](google-ops-audit-20261004.md)。
