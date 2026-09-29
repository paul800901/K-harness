# 側欄、封存與 Windows 資料夾選擇

本輪依使用者提供的 DSH 與 ChatGPT 畫面調整 K 的入口，保留 K 的既有對話、權限及模型執行流程。

## 操作

- **新對話**：側欄獨立大按鈕，選擇工作區和主代理後建立聊天。
- **工作區**：本機資料夾的分組，每個工作區可有多筆聊天。
- **搜尋對話**：獨立視窗，查標題、工作區名稱與模型；含封存聊天並標示狀態。目前不是訊息全文搜尋。
- **檢視選項**：依工作區／單一清單；最近使用／手動排序。手動模式透過對話選單的上移、下移調序，釘選仍在前方。顯示偏好保存在本機瀏覽器。
- **新增工作區**：開啟 Windows 原生資料夾選擇視窗，選擇後加入清單，不切換目前對話。取消不新增工作區。
- **已封存**：開啟平面對話清單，不受工作區收合影響；可開啟原對話或移回清單。日期來自現有 `lastOpenedAt`，不冒充建立或封存時間。

## 原生資料夾視窗

已從本機 DSH 0.1.5-rc.2 的 `packages/host/directory-picker-native/src/native-picker.ts` 確認，其 Windows 實作使用系統 `IFileOpenDialog`。K 以 Windows 內建 PowerShell 的 STA 子程序呼叫相同系統介面，不引入 DSH 執行服務、Koffi 或 Electron，不安裝套件。

- [Microsoft IFileDialog 文件](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ifiledialog)
- `scripts/pick-workspace.ps1`：原生視窗與選取結果。
- `src/workspace-picker.mjs`：固定腳本、標準輸入傳入路徑、UTF-8 結果、中止子程序。
- `POST /api/pick-workspace`：沿用本機 Cookie／同源／明確請求檢查；一次一個視窗，連線中斷或 K 結束時取消。選擇器本身只回傳資料夾，新增仍走既有專案入口。

## 驗收

### 後續前景問題修正

使用者回報：從 K 的新增工作區按鈕開啟時，原生視窗仍可能留在背景，因此先前單獨開窗確認不能代表按鈕流程通過。已將無 owner 的 `Show(IntPtr.Zero)` 改為帶有臨時置頂 owner 的原生視窗；選取或取消後釋放 owner。使用 Windows 內建 Forms，不新增套件。參考 [Microsoft TopMost 說明](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.form.topmost?view=netframework-4.8.1)。

Windows PowerShell 5.1 編譯與 3 項選擇器 API 回歸通過。使用者關閉舊視窗後，重新從 K 按「新增工作區」，已確認「有，直接顯示在最前面」，不必點工作列。

- 使用者已確認真實 Windows 視窗出現在前景；按取消後程序實際回傳 `{cancelled:true}` 並退出。
- 自動測試確認選擇／取消不更動目前工作區、對話或權限；拒絕無權限呼叫、不合法選取及重複開窗，連線中斷能取消原視窗。
- 49 項相關回歸通過，`npm run build:ui` 完成。涵蓋對話讀回／切換、權限、工作區、資料夾選擇入口、搜尋、分組與排序。建置仍有既有 bundle 大小提示。
- 實際瀏覽器驗收（獨立資料與模擬模型）：收合工作區後開啟封存清單可見兩筆；開啟封存對話保留其封存狀態；逐筆還原後有成功訊息及空清單提示；搜尋含封存標示／無結果提示；搜尋視窗自動聚焦，Escape 回到觸發按鈕；單一清單及手動下移後重新整理仍保留；新對話建立成功。
- 正在執行的 K 已重新載入後端並恢復原對話。讀回仍為 17 筆聊天、2 筆封存；除重開時間外，各筆中繼資料、目前模型與權限保持一致。真實兩筆封存聊天也已從新視窗讀回。
- 原生資料夾的前景顯示與取消為真實驗證；選取路徑的驗證及回傳為隔離 API 測試，尚未把真實 Windows 手動選取後的新增全流程列為實測。此輪沒有模型推論或派出 K 產品內的工人。
