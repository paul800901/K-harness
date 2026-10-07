# 聊天室超連結修復（2026-10-07）

## 使用者要求與根因

使用者回報 K 聊天室的超連結無法按，並要求「K 無謂的限制，Codex／Claude Code／Antigravity 怎麼做，我們就怎麼做」。本批只處理網頁連結，不擴張為全面刪除權限、登入或原生工具限制。

正式程式讀回為 `e068ffa4dcc7d0da57e73d72a98111e925975fe4`；維護來源 `f0d32ef` 只比該版多文件。根目錄 checkout 是舊版並有其他修改，不以其舊程式代表正式 K，也未改動其他聊天室的維護工作樹。

`frontend/main.jsx` 的 SafeLink 已正確產生 HTTP/S、`target="_blank"` 連結；直接根因是 `src/electron-workbench.mjs` 的 window-open handler 只認 Codex／Claude 官方登入網址，其他目的地一律拒絕，連 Google 授權網頁也無法開啟。

## 最小修正與原生對照

- 只修改一個產品模組：以 `createExternalLinkWindowHandler` 取代登入網址限定 handler，移除兩個不再使用的官方登入網址 import。
- 有效 HTTP/S 連結不分網站，原樣交 Windows 預設瀏覽器；不建立網站白名單、額外核准、提示、按鈕或設定。原生模型、工具權限、登入、計費與資料均不變。
- K 聊天頁不導離，Electron 不建立第二個不受控視窗。非網頁目的地不交 OS protocol handler；前端原本就只把 HTTP/S 渲染為網頁連結。
- Codex 官方 [OSC 8 網頁連結實作說明](https://github.com/openai/codex/commit/7a26497836be29ec77fb8007347b33cad952b497) 明列 HTTP/S web links，排除 non-web Markdown destinations，沒有官方登入網站限定。
- [Claude Code 終端設定](https://code.claude.com/docs/en/terminal-config) 與 [Antigravity CLI reference](https://www.antigravity.google/docs/cli/reference/) 可以確認終端執行介面，但未取得兩者完整 URL scheme 規則或三家 GUI 同等實測。因此不宣稱三家所有連結細節一致，也不把 AI browser allowlist 等同人類點超連結。

## 檔案與驗證

- `src/electron-workbench.mjs`：上述 handler 與接線。
- `test/electron-workbench-permissions.test.mjs`：一般網站、本機 HTTP、Google/Codex/Claude 假授權網址原樣傳遞；非網頁 scheme、無效 URL 與 opener rejection。
- `test/chat-links-electron-probe.cjs`：真 Electron、建置後聊天室、假服務、隱藏視窗與座標點擊，攔截 shell opener，不開真 OAuth 網頁／預設瀏覽器、不呼叫模型、不搶前景。
- 舊正式模組先重現：5 個錨點已正確渲染，但第一個一般連結等待 opener 逾時，0/5。修後同一 probe **5/5** 原始 query／percent encoding／fragment 都送達 opener，聊天室 origin 不變，0 Electron popup、非網頁 scheme 不送 OS。
- 定向 **8/8**；來源完整 **951/951**、0 失敗／跳過（123,397.7523 ms）；UI build 成功。沿用現有依賴，lockfile 與正式一致，未安裝／升级套件。
- 主代理已獨立讀 diff、收據及真 Electron 截圖。沒有其他產品 import 舊 export；`package.json` 明確以 `test/*.test.mjs` 跑完整測試，因此不誤抓 Electron `.cjs` probe。
- 原始證據在 `D:\K-harness\.runtime\chat-links-20261007\`，Opus 原文與事件在 source 的 `.runtime/chat-links-20261007/opus-review3/`。保留舊版失敗與測試執行器首次太早讀結果的輸出，以最終收據判定，不將命令送出當完成。

## 真正 Opus 複查與取捨

官方 Claude 訂閱、真正 `claude-opus-5-5`，session `2e7e607c-c7eb-42fd-8d0e-6a41eb8c469a`，唯讀複查產品模組、diff、兩個測試檔與新舊 Electron 收據，沒有阻擋問題。它要求完整回歸、查清舊 export 與 probe glob；主代理均已核對。它沒有自行跑測試，完整 951/951 是主代理的結果。

非阻擋 logging 建議不納入本批：opener 失敗的靜默處理沿用既有行為，沒有本次 Windows opener 真失敗證據，不另加提示或診斷框架。mailto 等不是本輪需求，不擴張。

## 發布與未驗證事項

目前為已實作、來源驗證及真 Opus 複查通過；固定候選、正式部署與 GitHub 狀態另在本節追加。正式 K 當時仍執行，不強制停止，已請本人工作結束後「離開並停止 K」。

Electron probe 攔截 OS opener，尚未證明 Windows 真正開啟預設瀏覽器，未操作圖片中的 Ads 授權、接收器或原授權 URL。Google 登入／驗證仍由本人處理。本批不更換帳號、不恢復目標、不重派工人；東區不動。
