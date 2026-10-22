# 提問面板超出畫面無法送出（2026-10-23）

## 問題

本人在 CaseAgent「交接」聊天室收到 Claude 的三題提問（第一題四個多選＋K 補的 Other）。桌面版提問區被撐出視窗，第三題與「送出回答」按鈕被切掉，無法送出，聊天室卡在待確認。

## 原因

1. `frontend/style.css` 的 `.inline-requests` 桌面版沒有高度上限；手機版（`mobile.css`）已有 `max-height:35dvh`，桌面版漏了。
2. `frontend/model-picker.css` 的多選選項樣式（`.claude-question-options label/input`）特異度低於通用的 `.approval-card form label{display:block;margin:15px 0}` 與 `.approval-card input{width:100%}`，勾選框被撐成整行置中、每個選項變很高，使溢出更嚴重。

## 修正

- `.inline-requests` 加 `max-height:55dvh;overflow:auto;overscroll-behavior:contain`，超出時在提問區內捲動。手機版的 35dvh 仍以媒體查詢覆蓋。
- 多選選項規則改為 `.approval-card .claude-question-options …`，恢復勾選框在左、文字在右的緊湊排版（`margin:0`、`width:auto`）。

程式 commit：`c2544753ea44d553a8a98e4134dc0c595b7b4525`（分支 `fix/question-panel-overflow`）。

## 驗證

- `npm ci`（主工作樹 `node_modules` 為空，依 lockfile 還原）後 `npm run build:ui`、`npm run test:ui` 50/50。
- `npm test` 1821/1821。
- 未新增專屬 UI 探測；未在正式 K 實機目視。

## 當下處置

本機 API 有工作階段 Cookie 保護，AI 不繞過，未替本人送出。改由主代理從原生紀錄讀出完整三題，本人在另一聊天室作答，整理成文字讓本人以鍵盤 Tab 送出或停止後以一般訊息送出。

## 複查與部署

- 主代理為 Opus 5.5，CSS 兩行修改自查；未另派 Fable 第二審（改動範圍小）。
- 南區於 **2026-10-23 02:15:50（臺灣時間）**完成部署，部署 SHA：`c2544753ea44d553a8a98e4134dc0c595b7b4525`。在 K 外執行 `Update-K.ps1 -Ref c2544753ea44d553a8a98e4134dc0c595b7b4525`，更新器結束碼 0。
- 部署前確認正式 K 服務已停止、無 K 執行程序；CaseAgent「交接」已有本人回答及取消提問訊息，提問工具已標失敗，未強制結束、未重送工作。兩筆歷史 `unresolved` 工單的 PID 均不存在，未改寫其未知結果或宣稱已完成。
- 更新器依 lockfile 準備候選，完成介面、瀏覽器擴充與啟動器建置，完整測試 **1821/1821**（失敗、取消、跳過均為 0）。建置有非阻斷警告：主介面 chunk 超過 500 kB、擴充的 build.outDir 與 root 重疊；測試另有 PDF 物件索引警告。無更新失敗或退版回收失敗警告，未修改測試。
- **02:16:16（臺灣時間）正式檔案讀回通過**：`.local/runtime.json` 的 `version` 為上述完整 SHA；正式 runtime 的 `dist-ui/assets/index-nbqv4iug.css` 含 `.inline-requests` 的 `max-height:55dvh`、`overflow:auto`、`overscroll-behavior:contain`，以及 `.approval-card .claude-question-options label` 的 `display:flex`、`margin:0` 與 input 的 `width:auto`。
- 退版保留最近三份：`before-1792678220506`、`before-1792681002929`、`before-1792692950125`；`.local/runtime.json` 的 `previous` 指向最後一份，其 runtime 存在。帳號、對話、工作區及瀏覽器輸出目錄保留原處；未讀取或搬移憑證。
- push 前核對待發布內容只有兩個 CSS 與本項工程文件，秘密樣式掃描無命中，Git 未追蹤本機執行、帳號或對話資料目錄。`main` 首次 push 成功，遠端 `refs/heads/main` 讀回 **`a92d21d7767d91ecfb165585d3699fd227946a73`**；本次部署收尾另作純文件 commit，推送後再次核對遠端，不重啟 K。
- 更新器完整輸出與正式檔案讀回保留於本機 `.runtime/archive/question-panel-overflow-deploy-20261023/`（不進 Git）。本次未啟動 K、未在正式桌面重現三題提問或目視驗收，不將 CSS 檔案讀回稱為互動實測。
- 東區未更新。
