# 重用瀏覽器資料後的下載崩潰：隔離修正與複查交接

日期：2026-09-25。狀態：已實作並完成本機假資料驗證，可交 Opus 複查；正式瀏覽器仍關閉，未重啟正式後端。

後續：備份已補[去重與新版 5 批保留上限](browser-download-retention-20260925.md)，340 項回歸通過。下方每次完整備份、334 項測試等敘述是本次相容性定位的原始紀錄；現行保留規則與隱私限制以後續文件為準。

## 結論與範圍

本次把觸發範圍縮到 Chromium／Edge 的 **舊下載紀錄恢復**，不是 cookie、整份 profile、K 的來源標記或一般保存錯誤。採取啟動前的相容性處理：只將三張原生下載紀錄表搬存到同資料庫的 K 備份表，其他資料不動。這是 K 的相容性修補，不是修好了 Chromium 的原生程式碼，也不能保證所有瀏覽器崩潰都被解決。

另外找到並修正 MCP 斷線時未正常關閉瀏覽器的問題：客戶端結束標準輸入後，現在先完整關閉 K 瀏覽器工作階段，讓資料有機會正常寫回，不再等客戶端逾時強制殺掉程序。

## 上游查證

- Microsoft Playwright [issue #42506](https://github.com/microsoft/playwright/issues/42506) 已有人報告相同的「persistent profile 第二次啟動，下載時原生 0xC0000005」；查詢時仍 Open，標籤 upstream。報告的 Edge／Chromium 版本不同，不能把它當成本機原生呼叫堆疊已確認。
- Chromium [DownloadManagerImpl](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/download/download_manager_impl.cc) 會從下載紀錄重建 DownloadItem。這支持調查方向，但目前仍沒有本機 faulting module／C++ stack，不能指認是哪一行原生程式崩潰。
- [CDP Browser 協定](https://chromedevtools.github.io/devtools-protocol/tot/Browser/) 有下載允許／保存與取消控制，沒有對等的下載歷史清除介面。[chrome.downloads.erase](https://developer.chrome.com/docs/extensions/reference/api/downloads) 是擴充功能介面；本輪遵守使用者「不做擴充功能」，也不新增依賴或改上游套件。

## 對照與反證

所有 profile 都是本輪建立或此前確認的假資料 fixture，不讀日常 Chrome／Edge 資料。

| 對照 | 觀察 | 證據根目錄（皆在 `.runtime`） |
| --- | --- | --- |
| 同一 seed 的未修改 clone | 重開下載崩潰 | `profile-download-probe/c838303d-b920-4bab-b5ef-d5e31743ced5` |
| 不複製 History，或只清三張 downloads 表 | 下載通過、假 cookie 保留 | 同上 |
| 只移除 url chains／downloads 主表 | 通過；只移除 slices 仍失敗 | `profile-download-probe/0fdb2756-4749-43ee-afa4-234c17cd5623` |
| 不改資料、只 SQLite 唯讀／讀寫開啟、空交易、刪零列 | 七個未清紀錄對照全部失敗；移除完成紀錄通過 | `profile-download-probe/1422a7be-3c87-4d99-a444-2f691e13511f` |
| 啟動後先等 5 秒 | 仍失敗，不能靠等待解決 | `profile-download-probe/8a174a90-2bcd-4ef4-9626-f50385a08185` |
| Chromium 154 完成紀錄處理後連續重開 | 四次下載通過，假 cookie 保留 | `profile-download-probe/bf7ca543-59f8-4e29-8d43-25651059aae2` |
| 只保留取消下載的 seed | 未處理仍崩潰；只處理完成紀錄並不可靠 | `profile-download-probe/97821857-bc52-4e91-853a-5c9b12e08045` 及 `profile-download-canceled-controls.log` |
| 取消 seed 搬走終止狀態／全部下載紀錄 | 兩者通過，未處理對照失敗 | `profile-download-probe/1e854ec0-9ed7-4f9b-a421-b29f375a970a` |
| K 完整流程、只搬完成紀錄 | 第一次通過；第二次假 cookie／localStorage／IndexedDB 都保留，但第一筆下載失敗 | `persistent-download-probe/b6ed0614-3c24-4af4-8690-9315e4898c62`、`persistent-download-probe/9ba0bd8d-16d3-4339-8cef-467c14738464` |

因此 **已否決「只處理 state=1 就足夠」**。最終處理對象是三張下載紀錄表的全部舊列（含取消、未完成與孤立關聯列），不是依某個狀態枚舉猜測哪些列安全。未完成下載不會由這項修補自動恢復或重送；只有確認該 profile 沒有執行中的瀏覽器才處理。

前輪的 `download.path()`／`saveAs()` 例外只是觀察到原生崩潰的地方，不足以證明它們就是原生崩潰發生點。

## 實作與保存邊界

- `src/browser-download-history.mjs`：只處理 `Default/History` 裡 `downloads`、`downloads_url_chains`、`downloads_slices`。原列先搬存到 `k_download_history_backup_<批次 UUID>_*`，再從原生表移除，同一 SQLite transaction，出錯 rollback。
- 備份保存列資料與欄位，不是整個資料庫／索引／約束的完整快照。可以離線復原列，但復原原生下載表可能重新觸發崩潰，不自動復原。
- 不刪下載檔、不清 cookie、localStorage、IndexedDB、瀏覽網址／訪問紀錄；不改 Safe Browsing、SmartScreen 或啟动安全旗標。
- 啟動前搬存 History 的原生下載列，並非承諾舊下載永遠不會再出現在原生表；實測瀏覽器重開後仍會出現先前列。K 原本就沒有跨工作階段重載下載清單，本輪沒有宣稱補齊此功能。
- profile 各層、History 與 sidecar 不接受符號連結；表形態／必要欄位／trigger 不符合時拒絕，不猜測新版本結構。
- `src/browser-live-session.mjs`：Windows 在 context 啟動前確認同 profile 沒有 Chrome／Edge 程序。CIM 失敗或仍存在的程序 command line 無法讀取亦拒絕；使用中的 profile 不改資料。已退出的暫態程序不當成使用中。這只是避免誤寫使用中的資料庫，不是 OS 隔離，程序檢查到啟動間仍有競爭窗口。
- `src/browser-mcp-stdio.mjs`：補標準輸入 EOF 的正常 shutdown，正常關閉瀏覽器／HTTP listener。不是保證斷電或強制終止也能保存最後一筆資料。
- 沒有修改 `node_modules`、套件版本、正式 Edge 預設、Windows 帳號／ACL、模型計費或全域設定。

## 正常斷線保存的真實反證與驗證

Root 用真正 K MCP stdio 入口、SDK client、官方 navigate/click、K live 下載取回路徑，連續三個不同程序重用同一 fake profile。

- 修前：第二個程序的首頁沒有假登入 cookie，下載本身成功。原因讀到目前 SDK 的 StdioServerTransport 沒有 EOF close，live HTTP listener 讓程序存活，client 等待後強制終止。證據 `persistent-mcp-download-probe/8ef7660d-a685-4aa9-a787-c0e38335b1fb/summary.json`。
- 修後：三次下載、K 與上游保存檔的 bytes／Zone.Identifier、後兩次首頁假 cookie 全通過。沒有額外 browser_close 工具，只有一般 client.close。證據 `persistent-mcp-download-probe/03b0d752-eab7-4b8c-8da1-c617dc35928c/summary.json`。
- 可重跑的本機探測保留於 `.runtime/persistent-mcp-download-probe.mjs`；無模型回合、無 API 費用，也不冒稱重新驗證 Claude／Codex 原生核准。
- 使用中保護：真實 Edge 開啟含空白路徑的同 profile 時，K 拒絕第二次準備；History SHA-256 不變、原瀏覽器仍可用。最終讀回 `download-profile-busy-probe/8406af4b-4c35-4664-b2f0-05ef899385db/result.json`。

## 最終驗收與 Opus 複查

### 最終版本的實際驗證

| 驗證 | 結果 | 證據（`.runtime/` 下） |
| --- | --- | --- |
| Edge 153，seed + 三次獨立程序重開 | 4/4；每輪 txt／假 exe／blob 保存、來源標記、取消後繼續工作通過 | `persistent-download-probe/c46c2cc7-d3b5-4968-bbeb-328a3ad1ff1b/summary.json` |
| 專案 Chromium 154，同條件 | 4/4；原預設仍保留 Edge | `persistent-download-probe/7e4b7573-81fa-4347-9f27-d6bc1e3f7884/summary.json` |
| Astra 獨立再跑最終 Edge probe | 4/4、12 個保存檔全數仍在且內容／來源標記正確 | `persistent-download-probe/48439dba-db64-4d8a-9b71-0096d3d19f45/summary.json` |
| 最終三表版 K MCP 入口，連續三個程序 | 3/3 下載、兩條保存路徑 bytes／Zone.Identifier、fake cookie、正常 EOF 全過 | `persistent-mcp-download-probe/cbe45243-469c-4688-9c1e-f90eb24e574e/summary.json` |
| 主代理全套 regression | **334/334，0 失敗、0 skip** | `download-history-final-tests.log` |

上述每組 service probe 的後三輪：只在第一輪設一次假登入，後續讀回 cookie、伺服器認證結果、localStorage、IndexedDB 都相同；沒有每次重新注入。每輪僅被刻意取消的那一筆 failed，失敗文字仍在人工接手的狀態快照，沒有藏掉錯誤。人工點選、輸入、接手中 AI 拒絕、交回後恢復均通過。這是 K service／proxy 真實瀏覽器驗證，不是 React 面板點擊驗收，也不是 Claude／Codex 模型回合。

最終 helper 的 6 項測試涵蓋：所有狀態及孤立關聯列搬存與讀回复原、其他資料不變、重用 ID 不覆寫先前批次、全空 no-op、新 profile、錯誤 schema、連結拒絕（部分條件在同一項測試內）。另補 1 項 EOF 真程序退出 regression。

**計數解讀限制：** 原生 History 會重新出現舊列，備份批次也有重疊。例 `28023e5e-b41d-4d5e-b76e-ace16c5dad96` 最終 native 為 16 筆（12 完成 + 4 取消），三個 backup 各有 4／8／12 列；summary 的 native+backup=40 是保存列的觀察數，不是 40 次唯一下載。本輪真正完成檔案數按逐筆 bytes 與檔案讀回計算（每組 12），不靠這個累加值宣稱額外下載成功。沒有證據指認其他原生資料庫的重建機制。

中途失敗證據保留：completed-only 修法失敗並未算成功；初版探測腳本的子程序結果捕捉／人工作業頁選取已修正。另有一次兩個獨立測試同時啟動時，CIM 對正在退出的程序讀不到 command line，防護拒絕啟動（沒有修改 profile、沒有崩潰）；已改為確認該程序是否仍存在，仍無法確定時保持拒絕而非放行。

本輪只改後端和測試／文件，未改 UI，沒有用 UI build 代替行為驗證。

02:27 最終讀回：`.runtime/browser-mcp.json` 不存在；正式後端 PID 37400，啟動時間仍為 00:57:30，早於本輪修正；本輪未重啟。上述探測目錄所屬的 Edge／Chrome 程序殘留數為 0，證據 `.runtime/download-history-final-status.json`。`git diff --check` 仍指出既有 `frontend/main.jsx:167` 行尾空白；本輪未改該檔，也沒有把此全樹檢查宣稱通過。

複查重點：備份與原生刪列同交易、取消紀錄也處理、假登入資料不是每次重新注入、保存檔不被移除、EOF 沒有強制關閉遺漏。`scripts/browser-profile-download-probe.mjs` 是根因對照；`scripts/browser-persistent-download-probe.mjs --run [--chromium]` 是真實 K service 假資料回歸，兩者預設 dry run。

## 明確未包含

- 正式開關未開、後端未重啟、未在右側面板用真實模型重跑、未登入真實帳號。
- **登入資料／人工控制憑證與模型 shell 的 OS 隔離仍另案未完成**。本輪假 cookie 保留只證明資料延續，不代表可安全登入重要帳號。
- 未驗證任意 browser 版本／任意惡意網頁。備份表會累積；上游升級前需重跑此 regression，不能永久當成不需維護的官方 API。
- 測試導航與下載目標是 localhost 假站；本機伺服器 request log 不是整個瀏覽器背景網路流量的封鎖／稽核證明。
- 注音候選字視窗仍待使用者親自確認；本輪沒有把瀏覽器下載問題和輸入法問題混在一起。
